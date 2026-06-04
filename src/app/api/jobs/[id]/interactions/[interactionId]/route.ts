import { getJobCallDetail, getJobEmailDetail } from '@/lib/bigquery/queries'
import { getSignedUrl } from '@/lib/gcs/signed-url'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; interactionId: string }> }
) {
  const { interactionId } = await params
  const url = new URL(request.url)
  const type = url.searchParams.get('type')
  const leadId = url.searchParams.get('leadId')

  try {
    if (type === 'call') {
      const rows = await getJobCallDetail(interactionId)
      const row = (rows as Record<string, unknown>[])[0]
      const gcsUri = (row?.recording_gcs_uri as string) ?? null
      const wcUrl = (row?.wc_recording_url as string) ?? null
      // Prefer signed GCS URL (8x8), fall back to WhatConverts recording URL
      const recordingUrl = (await getSignedUrl(gcsUri)) ?? wcUrl

      return Response.json({
        type: 'call',
        call_datetime: row?.call_datetime ?? null,
        caller_phone: row?.caller_phone ?? null,
        operator: row?.operator ?? null,
        duration_seconds: row?.duration_seconds ?? null,
        full_transcript: row?.full_transcript ?? null,
        recording_url: recordingUrl,
      })
    }

    if (type === 'email' && leadId) {
      const rows = await getJobEmailDetail(Number(leadId), interactionId)
      const row = (rows as Record<string, unknown>[])[0]

      return Response.json({
        type: 'email',
        submitted_at: row?.submitted_at ?? null,
        from_address: row?.from_address ?? null,
        to_address: row?.to_address ?? null,
        subject: row?.subject ?? null,
        email_body: row?.email_body ?? null,
      })
    }

    return Response.json({ error: 'type param required (call|email)' }, { status: 400 })
  } catch (error) {
    console.error('Job interaction detail error:', error)
    return Response.json({ error: 'Failed to fetch interaction' }, { status: 500 })
  }
}
