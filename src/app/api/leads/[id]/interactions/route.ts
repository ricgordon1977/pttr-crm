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

    // Three-source interaction query:
    // 1. lead_interactions by wc_lead_id (if exists)
    // 2. raw_calls by matched_phones (for direct/untracked)
    // 3. email reply threads by conversation_id (RE:/FW: on form threads)
    // UNION and dedupe
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
            TIMESTAMP_SUB(CAST(@oppTimestamp AS TIMESTAMP), INTERVAL 300 SECOND)
            AND TIMESTAMP_ADD(CAST(@oppTimestamp AS TIMESTAMP), INTERVAL 2592000 SECOND)
      ),
      -- Source 3: email reply threads (RE:/FW: on form conversation threads)
      email_thread_replies AS (
        SELECT
          reply.message_id AS interaction_id,
          CAST(NULL AS INT64) AS lead_id,
          CASE
            WHEN reply.from_email LIKE '%@mrwasher%' OR reply.from_email LIKE '%plumber%' OR reply.from_email LIKE '%electrician%'
              THEN 'Outbound Email'
            ELSE 'Inbound Email'
          END AS interaction_type,
          DATETIME(reply.received_at, 'Australia/Sydney') AS interaction_datetime,
          DATE(DATETIME(reply.received_at, 'Australia/Sydney')) AS interaction_date,
          FORMAT_DATETIME('%H:%M', DATETIME(reply.received_at, 'Australia/Sydney')) AS interaction_time,
          reply.from_name AS interaction_operator,
          CAST(NULL AS INT64) AS interaction_duration_seconds,
          LEFT(COALESCE(reply.subject, reply.body_preview, ''), 120) AS interaction_summary,
          CAST(NULL AS STRING) AS call_id
        FROM \`${DS}.raw_emails_received\` reply
        JOIN (
          -- Find conversation_ids of the original email forms for this opp
          SELECT DISTINCT orig.conversation_id
          FROM \`${DS}.vw_leads_unified\` lu
          JOIN \`${DS}.raw_emails_received\` orig ON CONCAT('email-', orig.message_id) = lu.lead_id
          WHERE lu.source_type = 'email'
            AND (lu.phone IN UNNEST(@phones) OR lu.phone IS NULL)
            AND lu.lead_timestamp BETWEEN
              TIMESTAMP_SUB(CAST(@oppTimestamp AS TIMESTAMP), INTERVAL 300 SECOND)
              AND TIMESTAMP_ADD(CAST(@oppTimestamp AS TIMESTAMP), INTERVAL 2592000 SECOND)
        ) thread ON reply.conversation_id = thread.conversation_id
        WHERE (reply.subject LIKE 'RE:%' OR reply.subject LIKE 'Re:%'
          OR reply.subject LIKE 'FW:%' OR reply.subject LIKE 'Fw:%')
      ),
      -- Source 4: form submissions as interactions (WC forms + email-parsed forms)
      form_submissions AS (
        -- WC form submission
        SELECT
          CONCAT('wc-form-', CAST(wc.lead_id AS STRING)) AS interaction_id,
          wc.lead_id AS lead_id,
          'Form Submission' AS interaction_type,
          DATETIME(wc.date_created, 'Australia/Sydney') AS interaction_datetime,
          DATE(DATETIME(wc.date_created, 'Australia/Sydney')) AS interaction_date,
          FORMAT_DATETIME('%H:%M', DATETIME(wc.date_created, 'Australia/Sydney')) AS interaction_time,
          'Website' AS interaction_operator,
          CAST(NULL AS INT64) AS interaction_duration_seconds,
          LEFT(COALESCE(wc.form_my_problem, ''), 120) AS interaction_summary,
          CAST(NULL AS STRING) AS call_id
        FROM \`pttr-taskdata.gd_WhatConverts.all_leads_enriched\` wc
        WHERE wc.lead_id = @wcLeadId AND @wcLeadId IS NOT NULL
          AND wc.lead_type = 'Web Form'

        UNION ALL

        -- Email-parsed form submission
        SELECT
          lu.lead_id AS interaction_id,
          CAST(NULL AS INT64) AS lead_id,
          'Form Submission' AS interaction_type,
          lu.lead_timestamp_sydney AS interaction_datetime,
          DATE(lu.lead_timestamp_sydney) AS interaction_date,
          FORMAT_DATETIME('%H:%M', lu.lead_timestamp_sydney) AS interaction_time,
          'Website' AS interaction_operator,
          CAST(NULL AS INT64) AS interaction_duration_seconds,
          LEFT(COALESCE(lu.form_problem, ''), 120) AS interaction_summary,
          CAST(NULL AS STRING) AS call_id
        FROM \`${DS}.vw_leads_unified\` lu
        WHERE lu.source_type = 'email'
          AND lu.phone IN UNNEST(@phones)
          AND lu.lead_timestamp BETWEEN
            TIMESTAMP_SUB(CAST(@oppTimestamp AS TIMESTAMP), INTERVAL 300 SECOND)
            AND TIMESTAMP_ADD(CAST(@oppTimestamp AS TIMESTAMP), INTERVAL 2592000 SECOND)
      ),
      -- Source 5: OfficeHQ answering-service emails matched by phone + time window
      -- These carry customer name, phone, address, reason for call — critical for
      -- after-hours calls with no 8x8 recording/transcript.
      ohq_emails AS (
        SELECT
          e.message_id AS interaction_id,
          CAST(NULL AS INT64) AS lead_id,
          'Answering Service' AS interaction_type,
          DATETIME(e.received_at, 'Australia/Sydney') AS interaction_datetime,
          DATE(DATETIME(e.received_at, 'Australia/Sydney')) AS interaction_date,
          FORMAT_DATETIME('%H:%M', DATETIME(e.received_at, 'Australia/Sydney')) AS interaction_time,
          'OfficeHQ' AS interaction_operator,
          CAST(NULL AS INT64) AS interaction_duration_seconds,
          LEFT(e.body_preview, 120) AS interaction_summary,
          CAST(NULL AS STRING) AS call_id
        FROM \`${DS}.raw_emails_received\` e
        WHERE LOWER(e.from_email) LIKE '%myreceptionist%'
          AND (
            -- Match E.164 format in Caller ID field
            EXISTS (SELECT 1 FROM UNNEST(@phones) AS p WHERE e.body_preview LIKE CONCAT('%', p, '%'))
            -- Match 0-prefix format (spaces stripped) in Phone field
            OR EXISTS (SELECT 1 FROM UNNEST(@phones) AS p WHERE REPLACE(e.body_preview, ' ', '') LIKE CONCAT('%', REPLACE(p, '+61', '0'), '%'))
          )
          AND TIMESTAMP(e.received_at) BETWEEN
            TIMESTAMP_SUB(CAST(@oppTimestamp AS TIMESTAMP), INTERVAL 60 SECOND)
            AND TIMESTAMP_ADD(CAST(@oppTimestamp AS TIMESTAMP), INTERVAL 2592000 SECOND)
      ),
      -- Combine + dedupe (prefer WC-linked, then calls, then forms, then email threads, then OHQ)
      combined AS (
        SELECT * FROM wc_interactions
        UNION ALL
        SELECT * FROM phone_calls pc
        WHERE pc.call_id NOT IN (SELECT call_id FROM wc_interactions WHERE call_id IS NOT NULL)
        UNION ALL
        SELECT * FROM form_submissions
        UNION ALL
        SELECT * FROM email_thread_replies
        UNION ALL
        SELECT * FROM ohq_emails
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
      phones: ['STRING'],
    })

    return Response.json(JSON.parse(JSON.stringify(rows)))
  } catch (error) {
    console.error('Interactions error:', error)
    return Response.json([])
  }
}
