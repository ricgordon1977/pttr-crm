import { NextRequest } from 'next/server'
import { verifyAuth } from '@/lib/auth/verify-token'
import { adminDb } from '@/lib/firebase/admin'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await verifyAuth(request) } catch (e) { return e as Response }
  const { id: opportunityId } = await params

  try {
    const body = await request.json()

    // Profile override (separate from classification)
    if (body.profile_override !== undefined) {
      await adminDb.collection('crm_lead_overrides').doc(opportunityId).set({
        profile_override: body.profile_override,
        profile_overridden_at: new Date(),
      }, { merge: true })
      return Response.json({ ok: true })
    }

    // CSR review flag toggle (separate from classification)
    if (body.requires_csr_review !== undefined && !body.stage) {
      await adminDb.collection('crm_lead_overrides').doc(opportunityId).set({
        requires_csr_review: body.requires_csr_review,
      }, { merge: true })
      return Response.json({ ok: true })
    }

    const { stage, sub_status, loss_reason, note, exclude_from_analysis } = body

    if (!stage || !sub_status) {
      return Response.json({ error: 'stage and sub_status required' }, { status: 400 })
    }

    // Auto-translate "CSR Failure" → "Lost / Unresponsive" + requires_csr_review
    // CSR Failure removed from UI; this catches legacy values, AI classifier, imports
    let finalSubStatus = sub_status
    let finalLossReason = loss_reason
    let requiresCsrReview = false
    if (sub_status === 'CSR Failure' || loss_reason === 'CSR Failure') {
      finalSubStatus = sub_status === 'CSR Failure' ? 'Lost / Unresponsive' : sub_status
      finalLossReason = loss_reason === 'CSR Failure' ? 'Lost / Unresponsive' : (loss_reason || 'Lost / Unresponsive')
      requiresCsrReview = true
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: Record<string, any> = {
      opportunity_id: opportunityId,
      stage: finalSubStatus === 'Lost / Unresponsive' && stage === 'Not Booked' ? stage : stage,
      sub_status: finalSubStatus,
      loss_reason: finalLossReason || null,
      note: note || null,
      exclude_from_analysis: exclude_from_analysis || false,
      requires_csr_review: requiresCsrReview || false,
      updated_by: 'admin',
      updated_at: new Date(),
    }

    // Pending status: stamp pending_since on set, clear on anything else
    if (sub_status === 'Pending') {
      data.pending_since = new Date()
    } else {
      data.pending_since = null
    }

    await adminDb.collection('crm_lead_overrides').doc(opportunityId).set(data, { merge: true })

    return Response.json({ ok: true })
  } catch (error) {
    console.error('Classification error:', error)
    return Response.json({ error: 'Failed to save classification' }, { status: 500 })
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await verifyAuth(request) } catch (e) { return e as Response }
  const { id: opportunityId } = await params

  try {
    const doc = await adminDb.collection('crm_lead_overrides').doc(opportunityId).get()
    if (!doc.exists) return Response.json(null)
    return Response.json(doc.data())
  } catch (error) {
    console.error('Classification read error:', error)
    return Response.json(null)
  }
}
