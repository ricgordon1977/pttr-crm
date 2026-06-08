import { NextRequest } from 'next/server'
import { verifyAuth } from '@/lib/auth/verify-token'
import { query } from '@/lib/bigquery/client'

const DS = 'pttr-taskdata.ds_crm'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await verifyAuth(request) } catch (e) { return e as Response }
  await params
  const { searchParams } = request.nextUrl
  const type = searchParams.get('type')
  const callId = searchParams.get('call_id')
  const datetime = searchParams.get('datetime')

  if (!type) {
    return Response.json({ error: 'Missing type param' }, { status: 400 })
  }

  try {
    if (type === 'call' && callId) {
      // Direct call_id lookup — works for both WC-linked and direct calls
      const rows = await query(`
        SELECT
          rc.call_id,
          DATETIME(rc.start_time, 'Australia/Sydney') AS call_datetime,
          rc.norm_caller_phone AS caller_phone,
          COALESCE(
            agent.callee_name,
            rec.operator_name,
            CASE WHEN REGEXP_CONTAINS(COALESCE(rc.callee_name, ''), r'^[A-Z][a-z]+ [A-Z][a-z]+$')
              AND rc.callee_name NOT IN ('Mr Washer Generic', 'Mr Washer Temp', 'Plumber Rescue')
              THEN rc.callee_name END
          ) AS operator,
          CASE
            WHEN rc.talk_time IS NOT NULL AND REGEXP_CONTAINS(rc.talk_time, r'^\\d{2}:\\d{2}:\\d{2}$')
            THEN CAST(SPLIT(rc.talk_time, ':')[OFFSET(0)] AS INT64) * 3600
               + CAST(SPLIT(rc.talk_time, ':')[OFFSET(1)] AS INT64) * 60
               + CAST(SPLIT(rc.talk_time, ':')[OFFSET(2)] AS INT64)
            ELSE NULL
          END AS duration_seconds,
          COALESCE(ct.full_transcript, li.contact_content, ale.call_transcription) AS full_transcript,
          CASE
            WHEN ct.full_transcript IS NOT NULL THEN '8x8'
            WHEN li.contact_content IS NOT NULL THEN '8x8'
            WHEN ale.call_transcription IS NOT NULL THEN 'whatconverts'
            ELSE NULL
          END AS transcript_source,
          rr.gcs_uri AS recording_url,
          COALESCE(wce.recording_url, wcp.recording_url) AS wc_recording_url
        FROM \`${DS}.raw_calls\` rc
        LEFT JOIN \`${DS}.call_transcripts\` ct ON rc.call_id = ct.call_id
        LEFT JOIN \`${DS}.raw_recordings\` rr ON rc.call_id = rr.call_id
        LEFT JOIN \`${DS}.lead_interactions\` li ON rc.call_id = li.call_id
        LEFT JOIN \`pttr-taskdata.gd_WhatConverts.all_leads_enriched\` ale
          ON li.lead_id IS NOT NULL AND CAST(li.lead_id AS INT64) = ale.lead_id
          AND ale.call_transcription IS NOT NULL
        LEFT JOIN (
          SELECT parent_call_id, callee_name,
            ROW_NUMBER() OVER (PARTITION BY parent_call_id
              ORDER BY TIMESTAMP_DIFF(disconnected_time, start_time, SECOND) DESC) AS rn
          FROM \`${DS}.raw_call_legs\`
          WHERE answered = 'Answered' AND direction = 'Internal'
            AND parent_call_id IS NOT NULL
            AND callee NOT LIKE 'CallForking%' AND callee NOT LIKE 'RingGroup%'
            AND REGEXP_CONTAINS(callee_name, r'^[A-Z][a-z]+ [A-Z][a-z]+$')
            AND callee_name NOT IN ('Mr Washer Generic', 'Mr Washer Temp', 'Plumber Rescue')
        ) agent ON rc.call_id = agent.parent_call_id AND agent.rn = 1
        LEFT JOIN (
          SELECT call_id, ARRAY_AGG(operator_name ORDER BY operator_name LIMIT 1)[OFFSET(0)] AS operator_name
          FROM \`${DS}.raw_recordings\`
          WHERE operator_name IS NOT NULL AND operator_name != ''
          GROUP BY call_id
        ) rec ON rc.call_id = rec.call_id
        LEFT JOIN \`pttr-taskdata.gd_WhatConverts.ettr_leads\` wce ON CAST(li.lead_id AS STRING) = CAST(wce.lead_id AS STRING)
        LEFT JOIN \`pttr-taskdata.gd_WhatConverts.pttr_leads\` wcp ON CAST(li.lead_id AS STRING) = CAST(wcp.lead_id AS STRING)
        WHERE rc.call_id = @callId
        LIMIT 1
      `, { callId })

      return Response.json(rows.length > 0 ? JSON.parse(JSON.stringify(rows[0])) : null)
    }

    if (type === 'email') {
      const messageId = searchParams.get('call_id') // reused param name for email message_id
      // Try raw_emails_received first (for reply-thread emails + form originals)
      // Prefer body_preview: it preserves line breaks from structured emails (e.g. OfficeHQ).
      // body_text is often a flat single-line strip of the HTML.
      if (messageId) {
        const rows = await query(`
          SELECT
            DATETIME(received_at, 'Australia/Sydney') AS submitted_at,
            from_email AS from_address,
            to_email AS to_address,
            subject,
            COALESCE(body_preview, body_text) AS email_body
          FROM \`${DS}.raw_emails_received\`
          WHERE message_id = @messageId
          LIMIT 1
        `, { messageId })
        if (rows.length > 0) return Response.json(JSON.parse(JSON.stringify(rows[0])))
      }
      // Fallback: lead_interactions by datetime
      if (datetime) {
        const rows = await query(`
          SELECT
            li.contact_datetime_sydney AS submitted_at,
            li.contact_from AS from_address,
            li.contact_to AS to_address,
            li.contact_subject AS subject,
            li.contact_content AS email_body
          FROM \`${DS}.lead_interactions\` li
          WHERE li.contact_datetime_sydney = @datetime
            AND li.contact_type != 'Phone'
          LIMIT 1
        `, { datetime })
        return Response.json(rows.length > 0 ? JSON.parse(JSON.stringify(rows[0])) : null)
      }
      return Response.json(null)
    }

    if (type === 'form') {
      // Form detail — WC form or email-parsed form
      const formId = callId // interaction_id passed as call_id param
      if (formId?.startsWith('wc-form-')) {
        const wcId = formId.replace('wc-form-', '')
        const rows = await query(`
          SELECT
            DATETIME(date_created, 'Australia/Sydney') AS submitted_at,
            'Form Submission' AS subject,
            contact_name, contact_phone_number AS phone, contact_email_address AS email_address,
            city, state, country,
            form_my_name, form_my_phone, form_my_email, form_my_address, form_my_problem,
            form_service_type, form_date, form_time, form_book_a_job,
            lead_source, lead_medium, lead_keyword, landing_url, lead_url
          FROM \`pttr-taskdata.gd_WhatConverts.all_leads_enriched\`
          WHERE lead_id = @wcId
          LIMIT 1
        `, { wcId: Number(wcId) })
        if (rows.length > 0) {
          const r = rows[0] as Record<string, unknown>
          // Build a readable form body from the fields
          const fields = [
            r.form_my_name || r.contact_name ? `Name: ${r.form_my_name || r.contact_name}` : null,
            r.form_my_phone || r.phone ? `Phone: ${r.form_my_phone || r.phone}` : null,
            r.form_my_email || r.email_address ? `Email: ${r.form_my_email || r.email_address}` : null,
            r.form_my_address ? `Address: ${r.form_my_address}` : null,
            r.city ? `Suburb: ${r.city}${r.state ? `, ${r.state}` : ''}${r.country && r.country !== 'AU' && r.country !== 'Australia' ? ` (${r.country})` : ''}` : null,
            r.form_my_problem ? `\nProblem:\n${r.form_my_problem}` : null,
            r.form_service_type && r.form_service_type !== 'Select One' ? `Service Type: ${r.form_service_type}` : null,
            r.form_date ? `Requested Date: ${r.form_date}${r.form_time ? ` ${r.form_time}` : ''}` : null,
            r.form_book_a_job ? `Intent: ${r.form_book_a_job}` : null,
            r.lead_source ? `\nSource: ${r.lead_source} / ${r.lead_medium || '(none)'}` : null,
            r.lead_keyword ? `Keyword: ${r.lead_keyword}` : null,
            r.lead_url ? `Page: ${r.lead_url}` : null,
          ].filter(Boolean).join('\n')
          return Response.json(JSON.parse(JSON.stringify({
            submitted_at: r.submitted_at,
            subject: 'Form Submission',
            from_address: String(r.lead_url || 'Website'),
            to_address: 'jobs@mrwasher.com.au',
            email_body: fields,
          })))
        }
      }
      // Email-parsed form
      if (formId?.startsWith('email-')) {
        const messageId = formId.replace('email-', '')
        const rows = await query(`
          SELECT
            DATETIME(received_at, 'Australia/Sydney') AS submitted_at,
            subject,
            from_email AS from_address,
            to_email AS to_address,
            COALESCE(body_text, body_preview) AS email_body
          FROM \`${DS}.raw_emails_received\`
          WHERE message_id = @messageId
          LIMIT 1
        `, { messageId })
        if (rows.length > 0) return Response.json(JSON.parse(JSON.stringify(rows[0])))
      }
      return Response.json(null)
    }

    return Response.json(null)
  } catch (error) {
    console.error('Interaction detail error:', error)
    return Response.json({ error: 'Failed to fetch interaction detail' }, { status: 500 })
  }
}
