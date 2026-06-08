import { NextRequest } from 'next/server'
import { verifyAuth } from '@/lib/auth/verify-token'
import { adminDb } from '@/lib/firebase/admin'
import { query } from '@/lib/bigquery/client'

const WC = 'pttr-taskdata.gd_WhatConverts'

// GET: validate a WC lead ID — returns lead summary or 404
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await verifyAuth(request) } catch (e) { return e as Response }
  await params

  const wcId = request.nextUrl.searchParams.get('wc_lead_id')?.trim()
  if (!wcId || !/^\d{6,12}$/.test(wcId)) {
    return Response.json({ error: 'Invalid WhatConverts lead ID' }, { status: 400 })
  }

  const rows = await query(`
    SELECT lead_id, contact_name, date_created, lead_type, lead_source, lead_medium,
      call_duration_seconds, norm_phone, city, profile,
      LEFT(COALESCE(form_my_problem, ''), 120) AS problem_preview
    FROM \`${WC}.all_leads_enriched\`
    WHERE lead_id = @wcId
  `, { wcId: Number(wcId) })

  if (!rows.length) {
    return Response.json({ error: 'WhatConverts lead not found' }, { status: 404 })
  }

  return Response.json(JSON.parse(JSON.stringify(rows[0])))
}

// POST: save the manual WC lead link
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await verifyAuth(request) } catch (e) { return e as Response }
  const { id: opportunityId } = await params

  const body = await request.json()
  const wcId = String(body.wc_lead_id || '').trim()
  if (!wcId || !/^\d{6,12}$/.test(wcId)) {
    return Response.json({ error: 'Invalid WhatConverts lead ID' }, { status: 400 })
  }

  // Validate exists
  const rows = await query(`
    SELECT lead_id FROM \`${WC}.all_leads_enriched\` WHERE lead_id = @wcId
  `, { wcId: Number(wcId) })
  if (!rows.length) {
    return Response.json({ error: 'WhatConverts lead not found' }, { status: 404 })
  }

  await adminDb.collection('crm_lead_overrides').doc(opportunityId).set({
    manual_wc_lead_id: Number(wcId),
    manual_wc_linked_at: new Date(),
    manual_wc_linked_by: 'admin',
  }, { merge: true })

  return Response.json({ ok: true, wc_lead_id: Number(wcId) })
}

// DELETE: remove the manual WC lead link
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await verifyAuth(request) } catch (e) { return e as Response }
  const { id: opportunityId } = await params
  const { FieldValue } = await import('firebase-admin/firestore')

  await adminDb.collection('crm_lead_overrides').doc(opportunityId).update({
    manual_wc_lead_id: FieldValue.delete(),
    manual_wc_linked_at: FieldValue.delete(),
    manual_wc_linked_by: FieldValue.delete(),
  })

  return Response.json({ ok: true })
}
