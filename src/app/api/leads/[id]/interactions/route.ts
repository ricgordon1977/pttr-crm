import { NextRequest } from 'next/server'
import { verifyAuth } from '@/lib/auth/verify-token'
import { query } from '@/lib/bigquery/client'

const DS = 'pttr-taskdata.ds_crm'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await verifyAuth(request) } catch (e) { return e as Response }
  const { id: opportunityId } = await params

  try {
    // Resolve the opportunity's contact points
    const [opp] = await query(`
      SELECT matched_phones, matched_emails, wc_lead_id, opportunity_timestamp
      FROM \`${DS}.opportunities\`
      WHERE opportunity_id = @opportunityId
    `, { opportunityId })

    if (!opp) return Response.json([])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const oppData = opp as any
    const phones = (oppData.matched_phones as string || '').split(',').map((p: string) => p.trim()).filter(Boolean)
    const wc_lead_id = oppData.wc_lead_id

    // Two-source interaction query:
    // 1. lead_interactions by wc_lead_id (if exists)
    // 2. raw_calls by matched_phones (for direct/untracked)
    // UNION and dedupe by call_id
    const rows = await query(`
      WITH
      -- Source 1: WC-linked interactions via lead_interactions
      wc_interactions AS (
        SELECT
          li.call_id AS interaction_id,
          li.lead_id,
          CASE
            WHEN li.contact_type = 'Phone' AND li.direction = 'inbound' THEN 'Inbound Call'
            WHEN li.contact_type = 'Phone' AND li.direction = 'outbound' THEN 'Outbound Call'
            WHEN li.contact_type = 'Phone' THEN 'Inbound Call'
            WHEN li.direction = 'inbound' THEN 'Inbound Email'
            WHEN li.direction = 'outbound' THEN 'Outbound Email'
            ELSE li.contact_type
          END AS interaction_type,
          li.contact_datetime_sydney AS interaction_datetime,
          DATE(li.contact_datetime_sydney) AS interaction_date,
          FORMAT_DATETIME('%H:%M', li.contact_datetime_sydney) AS interaction_time,
          COALESCE(
            agent.callee_name,
            CASE WHEN li.operator_name NOT LIKE '%->%' THEN li.operator_name END,
            rc.callee_name
          ) AS interaction_operator,
          CASE
            WHEN rc.talk_time IS NOT NULL AND REGEXP_CONTAINS(rc.talk_time, r'^\\d{2}:\\d{2}:\\d{2}$')
            THEN CAST(SPLIT(rc.talk_time, ':')[OFFSET(0)] AS INT64) * 3600
               + CAST(SPLIT(rc.talk_time, ':')[OFFSET(1)] AS INT64) * 60
               + CAST(SPLIT(rc.talk_time, ':')[OFFSET(2)] AS INT64)
            ELSE NULL
          END AS interaction_duration_seconds,
          LEFT(COALESCE(li.contact_subject, li.contact_content, ''), 120) AS interaction_summary,
          li.call_id
        FROM \`${DS}.lead_interactions\` li
        LEFT JOIN \`${DS}.raw_calls\` rc ON li.call_id = rc.call_id
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
        WHERE li.lead_id = @wcLeadId AND @wcLeadId IS NOT NULL
      ),
      -- Source 2: raw_calls by matched_phones (catches direct/untracked)
      phone_calls AS (
        SELECT
          rc.call_id AS interaction_id,
          CAST(NULL AS INT64) AS lead_id,
          CASE rc.direction
            WHEN 'Incoming' THEN 'Inbound Call'
            WHEN 'Outgoing' THEN 'Outbound Call'
            ELSE 'Call'
          END AS interaction_type,
          DATETIME(rc.start_time, 'Australia/Sydney') AS interaction_datetime,
          DATE(DATETIME(rc.start_time, 'Australia/Sydney')) AS interaction_date,
          FORMAT_DATETIME('%H:%M', DATETIME(rc.start_time, 'Australia/Sydney')) AS interaction_time,
          COALESCE(
            agent.callee_name,
            rec.operator_name,
            CASE WHEN REGEXP_CONTAINS(COALESCE(rc.callee_name, ''), r'^[A-Z][a-z]+ [A-Z][a-z]+$')
              AND rc.callee_name NOT IN ('Mr Washer Generic', 'Mr Washer Temp', 'Plumber Rescue',
                'Strata Account', 'Plumbing Rescue', 'Electrician Rescue')
              THEN rc.callee_name END
          ) AS interaction_operator,
          CASE
            WHEN rc.talk_time IS NOT NULL AND REGEXP_CONTAINS(rc.talk_time, r'^\\d{2}:\\d{2}:\\d{2}$')
            THEN CAST(SPLIT(rc.talk_time, ':')[OFFSET(0)] AS INT64) * 3600
               + CAST(SPLIT(rc.talk_time, ':')[OFFSET(1)] AS INT64) * 60
               + CAST(SPLIT(rc.talk_time, ':')[OFFSET(2)] AS INT64)
            ELSE NULL
          END AS interaction_duration_seconds,
          CAST(NULL AS STRING) AS interaction_summary,
          rc.call_id
        FROM \`${DS}.raw_calls\` rc
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
        WHERE rc.norm_caller_phone IN UNNEST(@phones)
          AND rc.start_time BETWEEN
            TIMESTAMP_SUB(@oppTimestamp, INTERVAL 300 SECOND)
            AND TIMESTAMP_ADD(@oppTimestamp, INTERVAL 2592000 SECOND)
      ),
      -- Combine + dedupe by call_id (prefer WC-linked if both exist)
      combined AS (
        SELECT * FROM wc_interactions
        UNION ALL
        SELECT * FROM phone_calls pc
        WHERE pc.call_id NOT IN (SELECT call_id FROM wc_interactions WHERE call_id IS NOT NULL)
      )
      SELECT interaction_id, lead_id, interaction_type, interaction_datetime,
        interaction_date, interaction_time, interaction_operator,
        interaction_duration_seconds, interaction_summary, call_id
      FROM combined
      ORDER BY interaction_datetime DESC
    `, {
      wcLeadId: wc_lead_id || null,
      phones,
      oppTimestamp: String(oppData.opportunity_timestamp),
    }, {
      wcLeadId: 'INT64',
      phones: { type: 'ARRAY', arrayType: { type: 'STRING' } },
      oppTimestamp: 'TIMESTAMP',
    })

    return Response.json(JSON.parse(JSON.stringify(rows)))
  } catch (error) {
    console.error('Interactions error:', error)
    return Response.json([])
  }
}
