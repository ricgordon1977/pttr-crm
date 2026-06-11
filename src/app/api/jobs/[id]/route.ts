import { getJobDetail, getJobLabour, getJobInteractions, getJobInteractionsByOppId, getJobNotes } from '@/lib/bigquery/queries'
import { adminDb } from '@/lib/firebase/admin'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const [taskRows, labour, bqInteractions, notes] = await Promise.all([
      getJobDetail(id),
      getJobLabour(id),
      getJobInteractions(id),
      getJobNotes(id),
    ])

    const task = (taskRows as Record<string, unknown>[])[0] ?? null
    if (!task) {
      return Response.json({ error: 'Job not found' }, { status: 404 })
    }

    // Path 1 result: interactions found via opp.all_jobnumbers (COD jobs in build)
    let interactions = bqInteractions as Record<string, unknown>[]

    // Path 2: if BQ found nothing, check Firestore manual links.
    // A crm_lead_overrides doc with manual_job_number = this job points to the
    // opportunity whose WC lead originated this job (Account/manually-linked jobs).
    if (interactions.length === 0) {
      const overrideSnap = await adminDb.collection('crm_lead_overrides')
        .where('manual_job_number', '==', id)
        .limit(1)
        .get()
      if (!overrideSnap.empty) {
        const oppId = overrideSnap.docs[0].id
        interactions = await getJobInteractionsByOppId(oppId) as Record<string, unknown>[]
      }
    }

    return Response.json({
      ...task,
      labour,
      materials: [],
      interactions,
      notes,
    })
  } catch (error) {
    console.error('Job detail error:', error)
    return Response.json({ error: 'Failed to fetch job' }, { status: 500 })
  }
}
