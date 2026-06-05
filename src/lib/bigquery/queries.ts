import { query } from './client'

const DS = 'pttr-taskdata.ds_crm'

// ─── ACCOUNTS ────────────────────────────────────────────────────────────────
export async function getAccounts() {
  return query(`
    SELECT * FROM \`${DS}.vw_accounts\`
    ORDER BY rank ASC
  `)
}

export async function getAccountLocations(accountId: string) {
  return query(`
    SELECT * FROM \`${DS}.vw_account_locations\`
    WHERE account_id = @accountId
    ORDER BY location_rank ASC
  `, { accountId })
}

// ─── CONTACTS ────────────────────────────────────────────────────────────────
export async function getContacts() {
  return query(`
    SELECT * FROM \`${DS}.vw_contacts\`
    ORDER BY revenue_l12m DESC NULLS LAST
  `)
}

export async function getContactTimeline(contactId: string) {
  return query(`
    SELECT * FROM \`${DS}.vw_contact_timeline\`
    WHERE contact_id = @contactId
    ORDER BY event_date DESC
  `, { contactId })
}

// ─── LEADS ───────────────────────────────────────────────────────────────────
export async function getLeads(limit = 500) {
  return query(`
    SELECT
      opportunity_id AS lead_id,
      DATE(created_at_sydney) AS lead_date,
      created_at_sydney AS lead_datetime,
      channel,
      CASE
        WHEN service = 'PTTR' THEN 'Plumber to the Rescue'
        WHEN service = 'ETTR' THEN 'Electrician to the Rescue'
        ELSE service
      END AS profile,
      contact_name,
      phone AS phone_norm,
      email,
      suburb,
      source AS lead_source,
      medium AS lead_medium,
      campaign_name AS lead_campaign,
      keyword AS lead_keyword,
      funnel_stage,
      CAST(NULL AS STRING) AS dnp_reason,
      CASE WHEN is_after_hours THEN 'After Hours' ELSE 'Business Hours' END AS business_hours_flag,
      call_count,
      form_count,
      operator,
      is_existing_customer AS is_existing_client,
      job_value,
      wc_lead_id,
      booking_status,
      completed,
      answered,
      captured,
      service,
      lead_type,
      campaign_type,
      all_jobnumbers,
      job_count
    FROM \`${DS}.vw_lead_enriched\`
    ORDER BY created_at_sydney DESC
    LIMIT @limit
  `, { limit })
}

export async function getLeadDetail(leadId: string) {
  // leadId is now opportunity_id (string, e.g. "J-141428" or "G-abc123...")
  return query(`
    SELECT
      opportunity_id AS lead_id,
      DATE(created_at_sydney) AS lead_date,
      created_at_sydney AS lead_datetime,
      channel,
      CASE
        WHEN service = 'PTTR' THEN 'Plumber to the Rescue'
        WHEN service = 'ETTR' THEN 'Electrician to the Rescue'
        ELSE service
      END AS profile,
      contact_name,
      phone AS phone_norm,
      email,
      suburb,
      source AS lead_source,
      medium AS lead_medium,
      campaign_name AS lead_campaign,
      keyword AS lead_keyword,
      funnel_stage,
      CAST(NULL AS STRING) AS dnp_reason,
      CASE WHEN is_after_hours THEN 'After Hours' ELSE 'Business Hours' END AS business_hours_flag,
      call_count,
      form_count,
      operator,
      is_existing_customer AS is_existing_client,
      job_value,
      wc_lead_id,
      booking_status,
      completed,
      answered,
      captured,
      service,
      lead_type,
      campaign_type,
      all_jobnumbers,
      job_count,
      matched_phones,
      matched_emails,
      is_no_inbound_enquiry
    FROM \`${DS}.vw_lead_enriched\`
    WHERE opportunity_id = @leadId
  `, { leadId })
}

// ─── INTERACTION DETAIL ─────────────────────────────────────────────────────
export async function getCallDetail(leadId: number, dt: string) {
  // Pass 1: exact call_id join (works when WhatConverts and 8x8 IDs match)
  // Agent name: call_legs answered leg → operator_name → raw_calls callee_name
  const rows = await query(`
    SELECT
      li.lead_id,
      li.contact_datetime_sydney AS call_datetime,
      rc.norm_caller_phone AS caller_phone,
      COALESCE(agent.callee_name, CASE WHEN li.operator_name NOT LIKE '%->%' THEN li.operator_name END, rc.callee_name) AS operator,
      li.operator_name,
      CASE
        WHEN rc.talk_time IS NOT NULL AND REGEXP_CONTAINS(rc.talk_time, r'^\d{2}:\d{2}:\d{2}$')
        THEN CAST(SPLIT(rc.talk_time, ':')[OFFSET(0)] AS INT64) * 3600
           + CAST(SPLIT(rc.talk_time, ':')[OFFSET(1)] AS INT64) * 60
           + CAST(SPLIT(rc.talk_time, ':')[OFFSET(2)] AS INT64)
        ELSE NULL
      END AS duration_seconds,
      COALESCE(ct.full_transcript, li.contact_content, alc.call_transcription) AS full_transcript,
      COALESCE(rr.gcs_uri, li.gcs_uri) AS recording_url,
      COALESCE(wce.recording_url, wcp.recording_url) AS wc_recording_url
    FROM \`${DS}.lead_interactions\` li
    JOIN \`${DS}.raw_calls\` rc ON li.call_id = rc.call_id
    LEFT JOIN \`${DS}.call_transcripts\` ct ON li.call_id = ct.call_id
    LEFT JOIN \`${DS}.raw_recordings\` rr ON li.call_id = rr.call_id
    LEFT JOIN \`pttr-taskdata.gd_WhatConverts.ettr_leads\` wce ON CAST(li.lead_id AS STRING) = CAST(wce.lead_id AS STRING)
    LEFT JOIN \`pttr-taskdata.gd_WhatConverts.pttr_leads\` wcp ON CAST(li.lead_id AS STRING) = CAST(wcp.lead_id AS STRING)
    LEFT JOIN \`pttr-taskdata.gd_WhatConverts.all_leads_classified\` alc ON li.lead_id = alc.lead_id
    LEFT JOIN (
      SELECT parent_call_id, callee_name,
             ROW_NUMBER() OVER (PARTITION BY parent_call_id ORDER BY TIMESTAMP_DIFF(disconnected_time, start_time, SECOND) DESC, start_time DESC) AS rn
      FROM \`${DS}.raw_call_legs\`
      WHERE answered = 'Answered'
        AND direction = 'Internal'
        AND parent_call_id IS NOT NULL
        AND callee NOT LIKE 'CallForking%'
        AND callee NOT LIKE 'RingGroup%'
        AND callee NOT LIKE 'AutoAttendant%'
        AND REGEXP_CONTAINS(callee_name, r'^[A-Z][a-z]+ [A-Z][a-z]+$')
        AND callee_name NOT IN ('Mr Washer Generic', 'Mr Washer Temp', 'Plumber Rescue')
    ) agent ON rc.call_id = agent.parent_call_id AND agent.rn = 1
    WHERE li.lead_id = @leadId
      AND li.contact_type = 'Phone'
      AND li.contact_datetime_sydney BETWEEN
        DATETIME_SUB(CAST(@dt AS DATETIME), INTERVAL 5 SECOND)
        AND DATETIME_ADD(CAST(@dt AS DATETIME), INTERVAL 5 SECOND)
    LIMIT 1
  `, { leadId, dt })

  if (rows.length > 0) return rows

  // Pass 2: fallback — match by datetime + tracking number
  // WhatConverts tracking number (li.contact_to) shows as caller in 8x8 (rc.caller)
  // Use ±30 second window for clock drift between systems
  // For afterhours calls with no 8x8 match, show "Afterhours Service"
  return query(`
    SELECT
      li.lead_id,
      li.contact_datetime_sydney AS call_datetime,
      rc.norm_caller_phone AS caller_phone,
      COALESCE(
        agent.callee_name,
        CASE WHEN li.operator_name NOT LIKE '%->%' THEN li.operator_name END,
        rc.callee_name,
        CASE WHEN (
          -- After hours: before 7am or after 4:30pm weekdays, or weekends
          EXTRACT(DAYOFWEEK FROM CAST(li.contact_datetime_sydney AS DATETIME)) IN (1, 7)
          OR EXTRACT(HOUR FROM CAST(li.contact_datetime_sydney AS DATETIME)) < 7
          OR (EXTRACT(HOUR FROM CAST(li.contact_datetime_sydney AS DATETIME)) = 16
              AND EXTRACT(MINUTE FROM CAST(li.contact_datetime_sydney AS DATETIME)) >= 30)
          OR EXTRACT(HOUR FROM CAST(li.contact_datetime_sydney AS DATETIME)) >= 17
          -- NSW public holidays (2026)
          OR DATE(CAST(li.contact_datetime_sydney AS DATETIME)) IN (
            '2026-01-01', '2026-01-26', '2026-01-27',
            '2026-04-03', '2026-04-04', '2026-04-06',
            '2026-04-25', '2026-06-08', '2026-08-03',
            '2026-10-05', '2026-12-25', '2026-12-26',
            '2026-12-28'
          )
        ) THEN 'Afterhours Service' END
      ) AS operator,
      li.operator_name,
      CASE
        WHEN rc.talk_time IS NOT NULL AND REGEXP_CONTAINS(rc.talk_time, r'^\d{2}:\d{2}:\d{2}$')
        THEN CAST(SPLIT(rc.talk_time, ':')[OFFSET(0)] AS INT64) * 3600
           + CAST(SPLIT(rc.talk_time, ':')[OFFSET(1)] AS INT64) * 60
           + CAST(SPLIT(rc.talk_time, ':')[OFFSET(2)] AS INT64)
        ELSE NULL
      END AS duration_seconds,
      COALESCE(ct.full_transcript, li.contact_content, alc.call_transcription) AS full_transcript,
      COALESCE(rr.gcs_uri, li.gcs_uri) AS recording_url,
      COALESCE(wce.recording_url, wcp.recording_url) AS wc_recording_url
    FROM \`${DS}.lead_interactions\` li
    LEFT JOIN \`${DS}.raw_calls\` rc
      ON rc.caller = li.contact_to
      AND rc.start_time BETWEEN
        TIMESTAMP_SUB(CAST(li.contact_datetime AS TIMESTAMP), INTERVAL 30 SECOND)
        AND TIMESTAMP_ADD(CAST(li.contact_datetime AS TIMESTAMP), INTERVAL 30 SECOND)
    LEFT JOIN \`${DS}.call_transcripts\` ct ON rc.call_id = ct.call_id
    LEFT JOIN \`${DS}.raw_recordings\` rr ON rc.call_id = rr.call_id
    LEFT JOIN \`pttr-taskdata.gd_WhatConverts.ettr_leads\` wce ON CAST(li.lead_id AS STRING) = CAST(wce.lead_id AS STRING)
    LEFT JOIN \`pttr-taskdata.gd_WhatConverts.pttr_leads\` wcp ON CAST(li.lead_id AS STRING) = CAST(wcp.lead_id AS STRING)
    LEFT JOIN \`pttr-taskdata.gd_WhatConverts.all_leads_classified\` alc ON li.lead_id = alc.lead_id
    LEFT JOIN (
      SELECT parent_call_id, callee_name,
             ROW_NUMBER() OVER (PARTITION BY parent_call_id ORDER BY TIMESTAMP_DIFF(disconnected_time, start_time, SECOND) DESC, start_time DESC) AS rn
      FROM \`${DS}.raw_call_legs\`
      WHERE answered = 'Answered'
        AND direction = 'Internal'
        AND parent_call_id IS NOT NULL
        AND callee NOT LIKE 'CallForking%'
        AND callee NOT LIKE 'RingGroup%'
        AND callee NOT LIKE 'AutoAttendant%'
        AND REGEXP_CONTAINS(callee_name, r'^[A-Z][a-z]+ [A-Z][a-z]+$')
        AND callee_name NOT IN ('Mr Washer Generic', 'Mr Washer Temp', 'Plumber Rescue')
    ) agent ON rc.call_id = agent.parent_call_id AND agent.rn = 1
    WHERE li.lead_id = @leadId
      AND li.contact_type = 'Phone'
      AND li.contact_datetime_sydney BETWEEN
        DATETIME_SUB(CAST(@dt AS DATETIME), INTERVAL 5 SECOND)
        AND DATETIME_ADD(CAST(@dt AS DATETIME), INTERVAL 5 SECOND)
    LIMIT 1
  `, { leadId, dt })
}

export async function getEmailDetail(leadId: number, dt: string) {
  return query(`
    SELECT
      li.lead_id,
      li.contact_datetime_sydney AS submitted_at,
      li.contact_from AS from_address,
      li.contact_to AS to_address,
      li.contact_subject AS subject,
      li.contact_content AS email_body
    FROM \`${DS}.lead_interactions\` li
    WHERE li.lead_id = @leadId
      AND li.contact_type = 'Email'
      AND li.contact_datetime_sydney BETWEEN
        DATETIME_SUB(CAST(@dt AS DATETIME), INTERVAL 5 SECOND)
        AND DATETIME_ADD(CAST(@dt AS DATETIME), INTERVAL 5 SECOND)
    LIMIT 1
  `, { leadId, dt })
}

// ─── JOB HISTORY ────────────────────────────────────────────────────────────
export async function getJobHistory(opportunityId: string) {
  // Use precomputed all_jobnumbers from the opportunity cluster
  return query(`
    WITH opp AS (
      SELECT all_jobnumbers, matched_phones
      FROM \`${DS}.opportunities\`
      WHERE opportunity_id = @opportunityId
    ),
    job_numbers AS (
      SELECT TRIM(jn) AS jobnumber FROM opp, UNNEST(SPLIT(opp.all_jobnumbers, ',')) jn
      WHERE opp.all_jobnumbers IS NOT NULL
    ),
    -- Also find active jobs via phone matching (not yet in opportunities)
    active_jobs AS (
      SELECT td.jobnumber, td.requestdate AS requested_date, td.tasktasktype_tasktype AS task_type,
             td.status AS display_status, SAFE_CAST(td.quote_totalex AS NUMERIC) AS task_invoices_total_ex,
             td.client_clientname AS client_name, 'active' AS job_source,
             COALESCE(NULLIF(td.location_locationname, ''), NULLIF(td.location_address, ''), NULLIF(td.tasklocation_locationname, '')) AS job_address,
             COALESCE(NULLIF(td.location_suburb, ''), REGEXP_EXTRACT(td.tasklocation_locationname, r',\\s*(.+)$')) AS job_suburb,
             td.description,
             SAFE_CAST(td.quote_totalex AS NUMERIC) AS quote_totalex
      FROM \`pttr-taskdata.ds_aroflo.tasks_deduped\` td
      WHERE td.status NOT IN ('Archived', 'Completed')
        AND td.jobnumber NOT IN (SELECT jobnumber FROM job_numbers)
        AND EXISTS (
          SELECT 1 FROM opp
          WHERE opp.matched_phones LIKE CONCAT('%', COALESCE(
            NULLIF(td.client_clientid, ''), 'NOMATCH'
          ), '%')
        )
    ),
    completed_jobs AS (
      SELECT tc.jobnumber, tc.requested_date, tc.task_type, tc.display_status, tc.task_invoices_total_ex, tc.client_name, 'completed' AS job_source,
             COALESCE(NULLIF(tc.location, ''), NULLIF(tc.address, ''), NULLIF(td.location_locationname, ''), NULLIF(td.location_address, ''), NULLIF(td.tasklocation_locationname, '')) AS job_address,
             COALESCE(NULLIF(tc.address_suburb, ''), NULLIF(td.location_suburb, ''), REGEXP_EXTRACT(td.tasklocation_locationname, r',\\s*(.+)$')) AS job_suburb,
             td.description,
             SAFE_CAST(td.quote_totalex AS NUMERIC) AS quote_totalex
      FROM job_numbers jn
      JOIN \`pttr-taskdata.ds_aroflo.tasks_complete\` tc ON jn.jobnumber = tc.jobnumber
      LEFT JOIN \`pttr-taskdata.ds_aroflo.tasks_deduped\` td ON tc.jobnumber = td.jobnumber
    ),
    all_jobs AS (
      SELECT * FROM completed_jobs
      UNION ALL
      SELECT * FROM active_jobs
    ),
    task_notes_agg AS (
      SELECT jobnumber,
             STRING_AGG(CONCAT(COALESCE(dateposted, ''), ' — ', COALESCE(username, ''), ': ', COALESCE(note_clean, '')), '\\n' ORDER BY dateposted DESC) AS task_notes
      FROM \`pttr-taskdata.ds_aroflo.task_notes_deduped\`
      GROUP BY jobnumber
    )
    SELECT aj.*, cf.primary_work_type, tn.task_notes
    FROM all_jobs aj
    LEFT JOIN \`pttr-taskdata.ds_aroflo.task_customfields_deduped\` cf ON aj.jobnumber = cf.jobnumber
    LEFT JOIN task_notes_agg tn ON aj.jobnumber = tn.jobnumber
    ORDER BY aj.requested_date DESC
    LIMIT 50
  `, { opportunityId })
}

// ─── JOBS ───────────────────────────────────────────────────────────────────
export async function getJobs(limit = 500) {
  return query(`
    SELECT job_id, job_no, ref_no, address, client_name, client_phone, client_email,
           task_type, status, grade, assigned, salesperson,
           logged_date, due_date, completed_date, last_updated, job_value
    FROM \`${DS}.vw_tasks\`
    WHERE status IN ('open', 'quote')
       OR logged_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH)
    ORDER BY logged_date DESC
    LIMIT @limit
  `, { limit })
}

export async function getJobDetail(jobId: string) {
  return query(`
    SELECT * FROM \`${DS}.vw_tasks\`
    WHERE job_id = @jobId
  `, { jobId })
}

export async function getJobLabour(jobId: string) {
  return query(`
    SELECT user_username, worktype, hours, cost, sell, workdate, note
    FROM \`pttr-taskdata.ds_aroflo.tasklabours_raw\`
    WHERE task_jobnumber = @jobId
      AND (deleted IS NULL OR deleted != 'true')
    ORDER BY workdate DESC
  `, { jobId })
}

export async function getJobInteractions(jobId: string) {
  return query(`
    SELECT
      COALESCE(li.call_id, CAST(li.contact_datetime AS STRING)) AS interaction_id,
      li.lead_id,
      CASE
        WHEN li.contact_type = 'Phone' THEN 'call'
        ELSE 'email'
      END AS type,
      li.direction,
      li.contact_datetime_sydney AS datetime,
      COALESCE(
        agent.callee_name,
        CASE WHEN li.operator_name NOT LIKE '%->%' THEN li.operator_name END,
        ro.operators
      ) AS operator,
      CASE
        WHEN li.contact_type = 'Phone' AND rc.talk_time IS NOT NULL
          AND REGEXP_CONTAINS(rc.talk_time, r'^\\d{2}:\\d{2}:\\d{2}$')
        THEN CAST(SPLIT(rc.talk_time, ':')[OFFSET(0)] AS INT64) * 3600
           + CAST(SPLIT(rc.talk_time, ':')[OFFSET(1)] AS INT64) * 60
           + CAST(SPLIT(rc.talk_time, ':')[OFFSET(2)] AS INT64)
        ELSE NULL
      END AS duration,
      CASE
        WHEN li.contact_type = 'Phone' THEN LEFT(COALESCE(li.contact_content, ''), 120)
        ELSE LEFT(COALESCE(li.contact_subject, li.contact_content, ''), 120)
      END AS summary
    FROM \`${DS}.opportunities\` opp
    JOIN \`${DS}.lead_interactions\` li ON li.lead_id = opp.wc_lead_id
    LEFT JOIN \`${DS}.raw_calls\` rc ON li.call_id = rc.call_id AND li.contact_type = 'Phone'
    LEFT JOIN (
      SELECT parent_call_id, callee_name,
             ROW_NUMBER() OVER (PARTITION BY parent_call_id ORDER BY TIMESTAMP_DIFF(disconnected_time, start_time, SECOND) DESC, start_time DESC) AS rn
      FROM \`${DS}.raw_call_legs\`
      WHERE answered = 'Answered' AND direction = 'Internal'
        AND parent_call_id IS NOT NULL
        AND callee NOT LIKE 'CallForking%' AND callee NOT LIKE 'RingGroup%' AND callee NOT LIKE 'AutoAttendant%'
        AND REGEXP_CONTAINS(callee_name, r'^[A-Z][a-z]+ [A-Z][a-z]+$')
        AND callee_name NOT IN ('Mr Washer Generic', 'Mr Washer Temp', 'Plumber Rescue')
    ) agent ON rc.call_id = agent.parent_call_id AND agent.rn = 1
    LEFT JOIN (
      SELECT call_id, STRING_AGG(DISTINCT operator_name, ', ' ORDER BY operator_name) AS operators
      FROM \`${DS}.raw_recordings\`
      WHERE operator_name IS NOT NULL AND operator_name != ''
      GROUP BY call_id
    ) ro ON li.call_id = ro.call_id AND li.contact_type = 'Phone'
    WHERE REGEXP_CONTAINS(CONCAT(',', REPLACE(COALESCE(opp.all_jobnumbers, ''), ' ', ''), ','), CONCAT(',', @jobId, ','))
    ORDER BY li.contact_datetime_sydney DESC
  `, { jobId })
}

export async function getJobCallDetail(callId: string) {
  // Mirrors getCallDetail: two-pass matching, same fallback chain
  // Pass 1: exact call_id join to raw_calls (works for 8x8 call IDs)
  const rows = await query(`
    SELECT
      li.lead_id,
      li.contact_datetime_sydney AS call_datetime,
      rc.norm_caller_phone AS caller_phone,
      COALESCE(agent.callee_name, CASE WHEN li.operator_name NOT LIKE '%->%' THEN li.operator_name END, rc.callee_name) AS operator,
      CASE
        WHEN rc.talk_time IS NOT NULL AND REGEXP_CONTAINS(rc.talk_time, r'^\d{2}:\d{2}:\d{2}$')
        THEN CAST(SPLIT(rc.talk_time, ':')[OFFSET(0)] AS INT64) * 3600
           + CAST(SPLIT(rc.talk_time, ':')[OFFSET(1)] AS INT64) * 60
           + CAST(SPLIT(rc.talk_time, ':')[OFFSET(2)] AS INT64)
        ELSE NULL
      END AS duration_seconds,
      COALESCE(ct.full_transcript, li.contact_content, alc.call_transcription) AS full_transcript,
      COALESCE(rr.gcs_uri, li.gcs_uri) AS recording_gcs_uri,
      COALESCE(wce.recording_url, wcp.recording_url) AS wc_recording_url
    FROM \`${DS}.lead_interactions\` li
    JOIN \`${DS}.raw_calls\` rc ON li.call_id = rc.call_id
    LEFT JOIN \`${DS}.call_transcripts\` ct ON li.call_id = ct.call_id
    LEFT JOIN \`${DS}.raw_recordings\` rr ON li.call_id = rr.call_id
    LEFT JOIN \`pttr-taskdata.gd_WhatConverts.ettr_leads\` wce ON CAST(li.lead_id AS STRING) = CAST(wce.lead_id AS STRING)
    LEFT JOIN \`pttr-taskdata.gd_WhatConverts.pttr_leads\` wcp ON CAST(li.lead_id AS STRING) = CAST(wcp.lead_id AS STRING)
    LEFT JOIN \`pttr-taskdata.gd_WhatConverts.all_leads_classified\` alc ON li.lead_id = alc.lead_id
    LEFT JOIN (
      SELECT parent_call_id, callee_name,
             ROW_NUMBER() OVER (PARTITION BY parent_call_id ORDER BY TIMESTAMP_DIFF(disconnected_time, start_time, SECOND) DESC, start_time DESC) AS rn
      FROM \`${DS}.raw_call_legs\`
      WHERE answered = 'Answered' AND direction = 'Internal' AND parent_call_id IS NOT NULL
        AND callee NOT LIKE 'CallForking%' AND callee NOT LIKE 'RingGroup%' AND callee NOT LIKE 'AutoAttendant%'
        AND REGEXP_CONTAINS(callee_name, r'^[A-Z][a-z]+ [A-Z][a-z]+$')
        AND callee_name NOT IN ('Mr Washer Generic', 'Mr Washer Temp', 'Plumber Rescue')
    ) agent ON rc.call_id = agent.parent_call_id AND agent.rn = 1
    WHERE li.call_id = @callId
    LIMIT 1
  `, { callId })

  if (rows.length > 0) return rows

  // Pass 2: WhatConverts call_id — no raw_calls match
  // Fall back to tracking-number match ±30s, or return WC data directly
  return query(`
    SELECT
      li.lead_id,
      li.contact_datetime_sydney AS call_datetime,
      COALESCE(rc.norm_caller_phone, li.contact_from) AS caller_phone,
      COALESCE(
        agent.callee_name,
        CASE WHEN li.operator_name NOT LIKE '%->%' THEN li.operator_name END,
        rc.callee_name,
        CASE WHEN (
          EXTRACT(DAYOFWEEK FROM CAST(li.contact_datetime_sydney AS DATETIME)) IN (1, 7)
          OR EXTRACT(HOUR FROM CAST(li.contact_datetime_sydney AS DATETIME)) < 7
          OR (EXTRACT(HOUR FROM CAST(li.contact_datetime_sydney AS DATETIME)) = 16
              AND EXTRACT(MINUTE FROM CAST(li.contact_datetime_sydney AS DATETIME)) >= 30)
          OR EXTRACT(HOUR FROM CAST(li.contact_datetime_sydney AS DATETIME)) >= 17
        ) THEN 'Afterhours Service' END
      ) AS operator,
      CASE
        WHEN rc.talk_time IS NOT NULL AND REGEXP_CONTAINS(rc.talk_time, r'^\d{2}:\d{2}:\d{2}$')
        THEN CAST(SPLIT(rc.talk_time, ':')[OFFSET(0)] AS INT64) * 3600
           + CAST(SPLIT(rc.talk_time, ':')[OFFSET(1)] AS INT64) * 60
           + CAST(SPLIT(rc.talk_time, ':')[OFFSET(2)] AS INT64)
        ELSE NULL
      END AS duration_seconds,
      COALESCE(ct.full_transcript, li.contact_content, alc.call_transcription) AS full_transcript,
      COALESCE(rr.gcs_uri, li.gcs_uri) AS recording_gcs_uri,
      COALESCE(wce.recording_url, wcp.recording_url) AS wc_recording_url
    FROM \`${DS}.lead_interactions\` li
    LEFT JOIN \`${DS}.raw_calls\` rc
      ON rc.caller = li.contact_to
      AND rc.start_time BETWEEN
        TIMESTAMP_SUB(CAST(li.contact_datetime AS TIMESTAMP), INTERVAL 30 SECOND)
        AND TIMESTAMP_ADD(CAST(li.contact_datetime AS TIMESTAMP), INTERVAL 30 SECOND)
    LEFT JOIN \`${DS}.call_transcripts\` ct ON rc.call_id = ct.call_id
    LEFT JOIN \`${DS}.raw_recordings\` rr ON rc.call_id = rr.call_id
    LEFT JOIN \`pttr-taskdata.gd_WhatConverts.ettr_leads\` wce ON CAST(li.lead_id AS STRING) = CAST(wce.lead_id AS STRING)
    LEFT JOIN \`pttr-taskdata.gd_WhatConverts.pttr_leads\` wcp ON CAST(li.lead_id AS STRING) = CAST(wcp.lead_id AS STRING)
    LEFT JOIN \`pttr-taskdata.gd_WhatConverts.all_leads_classified\` alc ON li.lead_id = alc.lead_id
    LEFT JOIN (
      SELECT parent_call_id, callee_name,
             ROW_NUMBER() OVER (PARTITION BY parent_call_id ORDER BY TIMESTAMP_DIFF(disconnected_time, start_time, SECOND) DESC, start_time DESC) AS rn
      FROM \`${DS}.raw_call_legs\`
      WHERE answered = 'Answered' AND direction = 'Internal' AND parent_call_id IS NOT NULL
        AND callee NOT LIKE 'CallForking%' AND callee NOT LIKE 'RingGroup%' AND callee NOT LIKE 'AutoAttendant%'
        AND REGEXP_CONTAINS(callee_name, r'^[A-Z][a-z]+ [A-Z][a-z]+$')
        AND callee_name NOT IN ('Mr Washer Generic', 'Mr Washer Temp', 'Plumber Rescue')
    ) agent ON rc.call_id = agent.parent_call_id AND agent.rn = 1
    WHERE li.call_id = @callId
    LIMIT 1
  `, { callId })
}

export async function getJobEmailDetail(leadId: number, datetime: string) {
  return query(`
    SELECT
      li.contact_datetime_sydney AS submitted_at,
      li.contact_from AS from_address,
      li.contact_to AS to_address,
      li.contact_subject AS subject,
      li.contact_content AS email_body
    FROM \`${DS}.lead_interactions\` li
    WHERE li.lead_id = @leadId
      AND li.contact_type = 'Email'
      AND CAST(li.contact_datetime AS STRING) = @datetime
    LIMIT 1
  `, { leadId, datetime })
}

export async function getJobNotes(jobId: string) {
  return query(`
    SELECT username, dateposted, timeposted, filter, note_clean
    FROM \`pttr-taskdata.ds_aroflo.task_notes_deduped\`
    WHERE jobnumber = @jobId
    ORDER BY dateposted DESC, timeposted DESC
  `, { jobId })
}

// ─── SEARCH ──────────────────────────────────────────────────────────────────
export async function search(term: string) {
  return query(`
    SELECT * FROM \`${DS}.vw_search\`
    WHERE LOWER(display_name) LIKE LOWER(@term)
       OR LOWER(phone) LIKE LOWER(@term)
       OR LOWER(email) LIKE LOWER(@term)
    LIMIT 50
  `, { term: `%${term}%` })
}

// ─── DASHBOARD ───────────────────────────────────────────────────────────────
export async function getDashboardStats() {
  return query(`
    SELECT
      COUNT(*) AS total_leads,
      COUNTIF(booking_status = 'Booked') AS bookings,
      COUNTIF(completed = TRUE) AS conversions,
      ROUND(SAFE_DIVIDE(COUNTIF(booking_status = 'Booked'), COUNT(*)) * 100, 1) AS booking_rate,
      SUM(CASE WHEN completed = TRUE THEN COALESCE(job_value, 0) ELSE 0 END) AS revenue
    FROM \`${DS}.vw_lead_enriched\`
    WHERE DATE(created_at_sydney) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
  `)
}
