import { getLeads } from '@/lib/bigquery/queries'
import { verifyAuth } from '@/lib/auth/verify-token'
import { adminDb } from '@/lib/firebase/admin'
import { query } from '@/lib/bigquery/client'

export async function GET(request: Request) {
  try { await verifyAuth(request) } catch (e) { return e as Response }
  const leads = await getLeads()

  // Batch-fetch overrides for all opportunity_ids on this page
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ids = (leads as any[]).map((l) => l.lead_id as string).filter(Boolean)

  if (ids.length === 0) return Response.json(leads)

  // Firestore getAll supports up to 500 doc refs per call
  const overrideMap: Record<string, Record<string, unknown>> = {}
  const batchSize = 500
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize)
    const refs = batch.map(id => adminDb.collection('crm_lead_overrides').doc(id))
    const docs = await adminDb.getAll(...refs)
    for (const doc of docs) {
      if (doc.exists) {
        overrideMap[doc.id] = doc.data()!
      }
    }
  }

  // Resolve manual job links: batch-fetch job details for any overrides with manual_job_number
  const manualJobNumbers = [...new Set(
    Object.values(overrideMap)
      .map(ov => ov.manual_job_number as string)
      .filter(Boolean)
  )]
  const manualJobMap: Record<string, Record<string, unknown>> = {}
  if (manualJobNumbers.length > 0) {
    const jobRows = await query(`
      SELECT tc.jobnumber, tc.client_name, tc.task_type, tc.status, tc.job_status, tc.display_status,
        SAFE_CAST(tc.task_invoices_total_ex AS FLOAT64) AS job_value, tc.customer_type,
        tc.norm_client_email,
        COALESCE(
          NULLIF(TRIM(tc.address_suburb), ''),
          NULLIF(TRIM(td.location_suburb), ''),
          NULLIF(TRIM(REGEXP_EXTRACT(td.tasklocation_locationname, r',\\s*([^,]+)$')), '')
        ) AS suburb
      FROM \`pttr-taskdata.ds_aroflo.tasks_complete\` tc
      LEFT JOIN \`pttr-taskdata.ds_aroflo.tasks_deduped\` td ON tc.jobnumber = td.jobnumber
      WHERE tc.jobnumber IN UNNEST(@jobnumbers)
    `, { jobnumbers: manualJobNumbers })
    for (const row of jobRows) {
      manualJobMap[(row as Record<string, unknown>).jobnumber as string] = row as Record<string, unknown>
    }
  }

  // Merge: override wins for stage/sub_status UNLESS objective facts override.
  // Objective auto-classify beats "Unable to Classify": if BQ says Booked/Completed,
  // the human verdict doesn't hold — the lead auto-flips and exclude_from_analysis clears.
  // Manual job links promote the opportunity to Booked/Completed with job value.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const merged = (leads as any[]).map((lead) => {
    const ov = overrideMap[lead.lead_id as string]
    if (!ov) return { ...lead, is_overridden: false, exclude_from_analysis: false }

    // Manual job link: promote opportunity + resolve name/suburb/email from job
    const manualJn = ov.manual_job_number as string | undefined
    const manualJob = manualJn ? manualJobMap[manualJn] : null
    let jobOverrides = {}
    if (manualJob && !lead.all_jobnumbers) {
      const isCompleted = manualJob.status === 'Archived'
        && manualJob.job_status === 'Completed'
        && (manualJob.job_value as number) > 0
      jobOverrides = {
        booking_status: 'Booked',
        completed: isCompleted || lead.completed,
        job_value: (manualJob.job_value as number) || lead.job_value,
        all_jobnumbers: manualJn,
        job_count: 1,
        funnel_stage: isCompleted ? 'Paid Job' : 'Booked',
        manual_job_number: manualJn,
        // Resolve identity from the linked job when lead has no name/suburb/email
        ...(lead.contact_name ? {} : { contact_name: manualJob.client_name || null }),
        ...(lead.suburb ? {} : { suburb: manualJob.suburb || null }),
        ...(lead.email ? {} : { email: manualJob.norm_client_email || null }),
      }
    } else if (manualJn) {
      jobOverrides = { manual_job_number: manualJn }
    }

    // Profile override
    const profileOverride = ov.profile_override as string | undefined
    const profileFields = profileOverride ? {
      profile: profileOverride === 'PTTR' ? 'Plumber to the Rescue' : profileOverride === 'ETTR' ? 'Electrician to the Rescue' : lead.profile,
      service: profileOverride || lead.service,
      profile_override: profileOverride,
    } : {}

    // Account attribution
    const accountFields = ov.is_account ? {
      is_account: true,
      account_id: ov.account_id as string,
      account_name: ov.account_name as string,
      account_contact_id: ov.account_contact_id as string || null,
      account_contact_name: ov.account_contact_name as string || null,
      exclude_from_analysis: true,
      is_overridden: true,
      funnel_stage: 'Account',
    } : {}

    // Pending metadata
    const pendingFields = ov.pending_since ? {
      pending_since: typeof ov.pending_since === 'object' && '_seconds' in (ov.pending_since as object)
        ? new Date((ov.pending_since as { _seconds: number })._seconds * 1000).toISOString()
        : String(ov.pending_since),
    } : {}

    // Auto-translate legacy values on read
    let subStatus = ov.sub_status as string
    let lossReason = ov.loss_reason as string | null
    let requiresCsrReview = ov.requires_csr_review as boolean || false
    // CSR Failure → Customer Unresponsive + requires_csr_review
    if (subStatus === 'CSR Failure' || lossReason === 'CSR Failure') {
      subStatus = subStatus === 'CSR Failure' ? 'Customer Unresponsive' : subStatus
      lossReason = lossReason === 'CSR Failure' ? null : lossReason
      requiresCsrReview = true
    }
    // Lost / Unresponsive → Customer Unresponsive
    if (subStatus === 'Lost / Unresponsive') subStatus = 'Customer Unresponsive'

    // Objective facts win: if BQ says Booked or Paid Job, ignore the classification override
    const objectiveWins = lead.booking_status === 'Booked' || lead.completed === true
    if (objectiveWins && (subStatus === 'Unable to Classify' || subStatus === 'Pending')) {
      return { ...lead, ...jobOverrides, ...profileFields, is_overridden: false, exclude_from_analysis: false }
    }

    // Account flag overrides everything — excluded from COD funnel
    if (ov.is_account) {
      return {
        ...lead,
        ...profileFields,
        ...accountFields,
      }
    }

    return {
      ...lead,
      ...jobOverrides,
      ...profileFields,
      ...pendingFields,
      funnel_stage: (jobOverrides as Record<string, unknown>).funnel_stage || ov.stage as string || lead.funnel_stage,
      sub_status: subStatus,
      loss_reason: lossReason || null,
      is_overridden: true,
      exclude_from_analysis: ov.exclude_from_analysis || false,
      requires_csr_review: requiresCsrReview,
    }
  })

  // Suppress no_inbound job-only opps when their job has been manually linked
  // to another opportunity (the manual link is the real inbound for that job).
  const manuallyClaimedJobs = new Set(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    merged.filter((l: any) => l.manual_job_number && l.lead_id !== `J-${l.manual_job_number}`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((l: any) => `J-${l.manual_job_number}`)
  )
  const filtered = manuallyClaimedJobs.size > 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? merged.filter((l: any) => !manuallyClaimedJobs.has(l.lead_id))
    : merged

  return Response.json(filtered)
}
