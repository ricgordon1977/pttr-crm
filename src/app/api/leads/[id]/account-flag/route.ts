import { NextRequest } from 'next/server'
import { verifyAuth } from '@/lib/auth/verify-token'
import { adminDb } from '@/lib/firebase/admin'

// POST: set account attribution
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await verifyAuth(request) } catch (e) { return e as Response }
  const { id: opportunityId } = await params
  const body = await request.json()

  const { account_id, account_name, contact_id, contact_name } = body
  if (!account_id || !account_name) {
    return Response.json({ error: 'account_id and account_name required' }, { status: 400 })
  }

  await adminDb.collection('crm_lead_overrides').doc(opportunityId).set({
    is_account: true,
    account_id,
    account_name,
    account_contact_id: contact_id || null,
    account_contact_name: contact_name || null,
    exclude_from_analysis: true,
    account_flagged_by: 'admin',
    account_flagged_at: new Date(),
  }, { merge: true })

  return Response.json({ ok: true })
}

// DELETE: remove account attribution
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await verifyAuth(request) } catch (e) { return e as Response }
  const { id: opportunityId } = await params
  const { FieldValue } = await import('firebase-admin/firestore')

  await adminDb.collection('crm_lead_overrides').doc(opportunityId).update({
    is_account: FieldValue.delete(),
    account_id: FieldValue.delete(),
    account_name: FieldValue.delete(),
    account_contact_id: FieldValue.delete(),
    account_contact_name: FieldValue.delete(),
    exclude_from_analysis: false,
    account_flagged_by: FieldValue.delete(),
    account_flagged_at: FieldValue.delete(),
  })

  return Response.json({ ok: true })
}
