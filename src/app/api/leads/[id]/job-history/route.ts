import { getJobHistory } from '@/lib/bigquery/queries'
import { NextRequest } from 'next/server'
import { verifyAuth } from '@/lib/auth/verify-token'
import { adminDb } from '@/lib/firebase/admin'
import { query } from '@/lib/bigquery/client'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await verifyAuth(request) } catch (e) { return e as Response }
  const { id } = await params

  if (!id) {
    return Response.json([])
  }

  try {
    const rows = await getJobHistory(id)

    // Check for manual job link in Firestore
    const doc = await adminDb.collection('crm_lead_overrides').doc(id).get()
    const manualJn = doc.exists ? doc.data()?.manual_job_number : null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (manualJn && !rows.some((r: any) => r.jobnumber === manualJn)) {
      // Fetch the manual job and prepend it
      const manualRows = await query(`
        SELECT tc.jobnumber, tc.requested_date, td.duedate AS due_date, tc.task_type, tc.display_status,
          tc.task_invoices_total_ex, tc.client_name, 'completed' AS job_source,
          COALESCE(NULLIF(tc.location, ''), NULLIF(tc.address, '')) AS job_address,
          tc.address_suburb AS job_suburb,
          td.description,
          SAFE_CAST(td.quote_totalex AS NUMERIC) AS quote_totalex,
          cf.primary_work_type,
          CAST(NULL AS STRING) AS task_notes
        FROM \`pttr-taskdata.ds_aroflo.tasks_complete\` tc
        LEFT JOIN \`pttr-taskdata.ds_aroflo.tasks_deduped\` td ON tc.jobnumber = td.jobnumber
        LEFT JOIN \`pttr-taskdata.ds_aroflo.task_customfields_deduped\` cf ON tc.jobnumber = cf.jobnumber
        WHERE tc.jobnumber = @jobnumber
      `, { jobnumber: manualJn })

      if (manualRows.length > 0) {
        // Mark as manually linked
        const manualJob = { ...manualRows[0] as Record<string, unknown>, manual_link: true }
        return Response.json([manualJob, ...rows])
      }
    }

    return Response.json(rows)
  } catch (error) {
    console.error('Job history error:', error)
    return Response.json([])
  }
}
