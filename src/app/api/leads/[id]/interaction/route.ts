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
          COALESCE(ct.full_transcript, li.contact_content) AS full_transcript,
          rr.gcs_uri AS recording_url,
          COALESCE(wce.recording_url, wcp.recording_url) AS wc_recording_url
        FROM \`${DS}.raw_calls\` rc
        LEFT JOIN \`${DS}.call_transcripts\` ct ON rc.call_id = ct.call_id
        LEFT JOIN \`${DS}.raw_recordings\` rr ON rc.call_id = rr.call_id
        LEFT JOIN \`${DS}.lead_interactions\` li ON rc.call_id = li.call_id
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

    if (type === 'email' && datetime) {
      // Email detail — lookup by lead_id (from lead_interactions) + datetime
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
  } catch (error) {
    console.error('Interaction detail error:', error)
    return Response.json({ error: 'Failed to fetch interaction detail' }, { status: 500 })
  }
}
