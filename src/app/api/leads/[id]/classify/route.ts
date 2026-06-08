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

    // CSR review flag (separate from classification)
    if (body.requires_csr_review !== undefined && !body.stage) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const csrData: Record<string, any> = {
        requires_csr_review: body.requires_csr_review,
      }
      if (body.requires_csr_review) {
        csrData.csr_review_category = body.csr_review_category || null
        csrData.csr_review_note = body.csr_review_note || null
      } else {
        csrData.csr_review_category = null
        csrData.csr_review_note = null
      }
      await adminDb.collection('crm_lead_overrides').doc(opportunityId).set(csrData, { merge: true })
      return Response.json({ ok: true })
    }

    const { stage, sub_status, loss_reason, note, exclude_from_analysis } = body

    if (!stage || !sub_status) {
      return Response.json({ error: 'stage and sub_status required' }, { status: 400 })
    }

    // Auto-translate legacy values on write
    let finalSubStatus = sub_status
    let finalLossReason = loss_reason
    let requiresCsrReview = false
    // CSR Failure → Customer Unresponsive + requires_csr_review
    if (sub_status === 'CSR Failure' || loss_reason === 'CSR Failure') {
      finalSubStatus = sub_status === 'CSR Failure' ? 'Customer Unresponsive' : sub_status
      finalLossReason = loss_reason === 'CSR Failure' ? null : loss_reason
      requiresCsrReview = true
    }
    // Lost / Unresponsive → Customer Unresponsive
    if (finalSubStatus === 'Lost / Unresponsive') finalSubStatus = 'Customer Unresponsive'

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: Record<string, any> = {
      opportunity_id: opportunityId,
      stage,
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
