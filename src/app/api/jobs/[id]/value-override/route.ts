import { NextRequest } from 'next/server'
import { verifyAuth } from '@/lib/auth/verify-token'
import { adminDb } from '@/lib/firebase/admin'

// GET: read the current override value
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await verifyAuth(request) } catch (e) { return e as Response }
  const { id: jobId } = await params

  const doc = await adminDb.collection('crm_job_value_overrides').doc(jobId).get()
  if (!doc.exists) return Response.json({})
  return Response.json(doc.data())
}

// POST: save the override value
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await verifyAuth(request) } catch (e) { return e as Response }
  const { id: jobId } = await params
  const body = await request.json()

  const value = parseFloat(body.job_value_override)
  if (isNaN(value) || value < 0) {
    return Response.json({ error: 'Invalid value' }, { status: 400 })
  }

  await adminDb.collection('crm_job_value_overrides').doc(jobId).set({
    job_id: jobId,
    job_value_override: value,
    updated_by: 'admin',
    updated_at: new Date(),
  })

  return Response.json({ ok: true, job_value_override: value })
}
