import { getLeads } from '@/lib/bigquery/queries'
import { verifyAuth } from '@/lib/auth/verify-token'
import { adminDb } from '@/lib/firebase/admin'

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

  // Auto-classify after-hours gap calls (<20s) that have no override yet.
  // These have no content at any source — nothing to review. Write to Firestore
  // so they clear needs-review. ≥20s gap calls stay unclassified (needs-review)
  // as an answering-service performance signal.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const autoClassifyBatch: { id: string; data: Record<string, unknown> }[] = []
  for (const lead of leads as any[]) {
    if (
      lead.is_after_hours_gap &&
      !lead.captured &&
      !overrideMap[lead.lead_id as string]
    ) {
      const data = {
        opportunity_id: lead.lead_id,
        stage: 'Not Captured',
        sub_status: 'Dropped Call',
        loss_reason: null,
        note: 'Auto-classified: after-hours gap call <20s, no content at any source',
        exclude_from_analysis: false,
        updated_by: 'auto_rule:ah_gap_short',
        updated_at: new Date(),
      }
      autoClassifyBatch.push({ id: lead.lead_id as string, data })
      overrideMap[lead.lead_id as string] = data
    }
  }
  // Fire-and-forget batch write (don't block response)
  if (autoClassifyBatch.length > 0) {
    const batch = adminDb.batch()
    for (const { id, data } of autoClassifyBatch) {
      batch.set(adminDb.collection('crm_lead_overrides').doc(id), data)
    }
    batch.commit().catch(err => console.error('Auto-classify batch write failed:', err))
  }

  // Merge: override wins for stage/sub_status UNLESS objective facts override.
  // Objective auto-classify beats "Unable to Classify": if BQ says Booked/Completed,
  // the human verdict doesn't hold — the lead auto-flips and exclude_from_analysis clears.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const merged = (leads as any[]).map((lead) => {
    const ov = overrideMap[lead.lead_id as string]
    if (!ov) return { ...lead, is_overridden: false, exclude_from_analysis: false }

    // Objective facts win: if BQ says Booked or Paid Job, ignore the override
    const objectiveWins = lead.booking_status === 'Booked' || lead.completed === true
    if (objectiveWins && ov.sub_status === 'Unable to Classify') {
      return { ...lead, is_overridden: false, exclude_from_analysis: false }
    }

    return {
      ...lead,
      funnel_stage: ov.stage as string,
      sub_status: ov.sub_status as string,
      loss_reason: ov.loss_reason || null,
      is_overridden: true,
      exclude_from_analysis: ov.exclude_from_analysis || false,
    }
  })

  return Response.json(merged)
}
