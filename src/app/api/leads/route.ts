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

  // Merge: override wins for funnel_stage, adds sub_status/loss_reason/is_overridden
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const merged = (leads as any[]).map((lead) => {
    const ov = overrideMap[lead.lead_id as string]
    if (!ov) return { ...lead, is_overridden: false }
    return {
      ...lead,
      funnel_stage: ov.stage as string,
      sub_status: ov.sub_status as string,
      loss_reason: ov.loss_reason || null,
      is_overridden: true,
    }
  })

  return Response.json(merged)
}
