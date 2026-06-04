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
    WITH leads AS (
      SELECT * FROM \`${DS}.vw_leads\`
      WHERE funnel_stage != 'Repeat'
      ORDER BY lead_date DESC
      LIMIT @limit
    ),
    -- First interaction operator per lead (single name, longest duration)
    lead_operators AS (
      SELECT li.lead_id,
        FIRST_VALUE(
          COALESCE(
            agent.callee_name,
            CASE WHEN REGEXP_CONTAINS(COALESCE(li.operator_name, ''), r'^[A-Z][a-z]+ [A-Z][a-z]+$')
                  AND li.operator_name NOT LIKE '%->%'
                  AND li.operator_name NOT IN ('Mr Washer Generic', 'Mr Washer Temp', 'Plumber Rescue')
                 THEN li.operator_name END,
            CASE WHEN REGEXP_CONTAINS(COALESCE(rc.callee_name, ''), r'^[A-Z][a-z]+ [A-Z][a-z]+$')
                  AND rc.callee_name NOT IN ('Mr Washer Generic', 'Mr Washer Temp', 'Plumber Rescue')
                 THEN rc.callee_name END
          )
        ) OVER (PARTITION BY li.lead_id ORDER BY li.contact_datetime ASC) AS first_operator,
        ROW_NUMBER() OVER (PARTITION BY li.lead_id ORDER BY li.contact_datetime ASC) AS rn
      FROM \`${DS}.lead_interactions\` li
      LEFT JOIN \`${DS}.raw_calls\` rc ON li.call_id = rc.call_id
      LEFT JOIN (
        SELECT parent_call_id, callee_name,
               ROW_NUMBER() OVER (
                 PARTITION BY parent_call_id
                 ORDER BY TIMESTAMP_DIFF(disconnected_time, start_time, SECOND) DESC, start_time DESC
               ) AS lrn
        FROM \`${DS}.raw_call_legs\`
        WHERE answered = 'Answered' AND direction = 'Internal'
          AND parent_call_id IS NOT NULL
          AND callee NOT LIKE 'CallForking%' AND callee NOT LIKE 'RingGroup%' AND callee NOT LIKE 'AutoAttendant%'
          AND REGEXP_CONTAINS(callee_name, r'^[A-Z][a-z]+ [A-Z][a-z]+$')
          AND callee_name NOT IN ('Mr Washer Generic', 'Mr Washer Temp', 'Plumber Rescue')
      ) agent ON rc.call_id = agent.parent_call_id AND agent.lrn = 1
      WHERE li.contact_type = 'Phone'
    ),
    -- Existing client: has jobs BEFORE the lead date
    existing_clients AS (
      SELECT DISTINCT vl.lead_id
      FROM leads vl
      JOIN \`pttr-taskdata.ds_aroflo.tasks_complete\` tc
        ON (RIGHT(REGEXP_REPLACE(tc.norm_client_mobile, r'[^0-9]', ''), 9) = RIGHT(REGEXP_REPLACE(vl.phone_norm, r'[^0-9]', ''), 9) AND LENGTH(vl.phone_norm) >= 9)
        OR (LOWER(tc.norm_client_email) = LOWER(vl.email) AND vl.email IS NOT NULL AND vl.email != '')
        OR (LOWER(tc.id_email) = LOWER(vl.email) AND vl.email IS NOT NULL AND vl.email != '')
      WHERE SAFE.PARSE_DATE('%Y/%m/%d', tc.requested_date) < vl.lead_date
        OR tc.requested_date_parsed < vl.lead_date
    ),
    -- Job value: invoiced amount from jobs within 30 days after lead
    job_values AS (
      SELECT vl.lead_id,
        MAX(tc.task_invoices_total_ex) AS job_invoice_value
      FROM leads vl
      JOIN \`pttr-taskdata.ds_aroflo.tasks_complete\` tc
        ON (RIGHT(REGEXP_REPLACE(tc.norm_client_mobile, r'[^0-9]', ''), 9) = RIGHT(REGEXP_REPLACE(vl.phone_norm, r'[^0-9]', ''), 9) AND LENGTH(vl.phone_norm) >= 9)
        OR (LOWER(tc.norm_client_email) = LOWER(vl.email) AND vl.email IS NOT NULL AND vl.email != '')
        OR (LOWER(tc.id_email) = LOWER(vl.email) AND vl.email IS NOT NULL AND vl.email != '')
      WHERE (SAFE.PARSE_DATE('%Y/%m/%d', tc.requested_date) BETWEEN vl.lead_date AND DATE_ADD(vl.lead_date, INTERVAL 30 DAY))
         OR (tc.requested_date_parsed BETWEEN vl.lead_date AND DATE_ADD(vl.lead_date, INTERVAL 30 DAY))
      GROUP BY vl.lead_id
    )
    SELECT l.* EXCEPT(contact_name),
      CASE
        WHEN UPPER(TRIM(COALESCE(l.contact_name, alc.caller_name, ''))) IN ('AUSTRALIA', 'INTERNATIONAL', 'NEW ZEALAND', 'UNITED STATES', 'UNITED KINGDOM', '') THEN NULL
        ELSE COALESCE(NULLIF(TRIM(l.contact_name), ''), INITCAP(NULLIF(TRIM(alc.caller_name), '')))
      END AS contact_name,
      lo.first_operator AS operator,
      ec.lead_id IS NOT NULL AS is_existing_client,
      COALESCE(jv.job_invoice_value, l.sales_value) AS job_value
    FROM leads l
    LEFT JOIN lead_operators lo ON l.lead_id = lo.lead_id AND lo.rn = 1
    LEFT JOIN existing_clients ec ON l.lead_id = ec.lead_id
    LEFT JOIN job_values jv ON l.lead_id = jv.lead_id
    LEFT JOIN \`pttr-taskdata.gd_WhatConverts.all_leads_classified\` alc ON l.lead_id = alc.lead_id
    ORDER BY l.lead_date DESC
  `, { limit })
}

export async function getLeadDetail(leadId: string) {
  // lead_id from WhatConverts is numeric — try INT64 first, fall back to string
  const numericId = Number(leadId)
  const isNumeric = !isNaN(numericId) && String(numericId) === leadId

  if (isNumeric) {
    const rows = await query(`
      SELECT * FROM \`${DS}.vw_lead_detail\`
      WHERE lead_id = @leadId
      ORDER BY interaction_datetime DESC
    `, { leadId: numericId })
    if (rows.length > 0) return rows
  }

  // Fall back to string comparison
  return query(`
    SELECT * FROM \`${DS}.vw_lead_detail\`
    WHERE CAST(lead_id AS STRING) = @leadId
    ORDER BY interaction_datetime DESC
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
export async function getJobHistory(phoneNorm: string, email: string) {
  // Strip phone to last 9 digits for flexible matching across formats
  // E.164 +61437694614 → 437694614, local 0437694614 → 437694614
  const phoneDigits = (phoneNorm || '').replace(/\D/g, '')
  const phoneLast9 = phoneDigits.length >= 9 ? phoneDigits.slice(-9) : ''

  // Union completed jobs (tasks_complete) with booked/in-progress jobs (tasks_deduped)
  // tasks_deduped matches via client_clientid → clients_deduped phone/email
  // LEFT JOIN task_customfields_deduped for primary_work_type
  return query(`
    WITH matched_clients AS (
      SELECT clientid
      FROM \`pttr-taskdata.ds_aroflo.clients_deduped\`
      WHERE (RIGHT(REGEXP_REPLACE(mobile, r'[^0-9]', ''), 9) = @phoneLast9 AND @phoneLast9 != '')
         OR (RIGHT(REGEXP_REPLACE(phone, r'[^0-9]', ''), 9) = @phoneLast9 AND @phoneLast9 != '')
         OR (LOWER(email) = LOWER(@email) AND @email != '')
    ),
    completed_jobs AS (
      SELECT tc.jobnumber, tc.requested_date, tc.task_type, tc.display_status, tc.task_invoices_total_ex, tc.client_name, 'completed' AS job_source,
             COALESCE(NULLIF(tc.location, ''), NULLIF(tc.address, ''), NULLIF(td.location_locationname, ''), NULLIF(td.location_address, ''), NULLIF(td.tasklocation_locationname, '')) AS job_address,
             COALESCE(NULLIF(tc.address_suburb, ''), NULLIF(td.location_suburb, ''), REGEXP_EXTRACT(td.tasklocation_locationname, r',\s*(.+)$')) AS job_suburb,
             td.description,
             SAFE_CAST(td.quote_totalex AS NUMERIC) AS quote_totalex
      FROM \`pttr-taskdata.ds_aroflo.tasks_complete\` tc
      LEFT JOIN \`pttr-taskdata.ds_aroflo.tasks_deduped\` td ON tc.jobnumber = td.jobnumber
      WHERE (tc.norm_client_phone = @phoneNorm AND @phoneNorm != '')
         OR (tc.norm_client_mobile = @phoneNorm AND @phoneNorm != '')
         OR (tc.id_phone = @phoneNorm AND @phoneNorm != '')
         OR (RIGHT(REGEXP_REPLACE(tc.id_phone, r'[^0-9]', ''), 9) = @phoneLast9 AND @phoneLast9 != '')
         OR (RIGHT(REGEXP_REPLACE(tc.norm_client_mobile, r'[^0-9]', ''), 9) = @phoneLast9 AND @phoneLast9 != '')
         OR (LOWER(tc.norm_client_email) = LOWER(@email) AND @email != '')
         OR (LOWER(tc.id_email) = LOWER(@email) AND @email != '')
    ),
    active_jobs AS (
      SELECT td.jobnumber, td.requestdate AS requested_date, td.tasktasktype_tasktype AS task_type,
             td.status AS display_status, SAFE_CAST(td.quote_totalex AS NUMERIC) AS task_invoices_total_ex,
             td.client_clientname AS client_name, 'active' AS job_source,
             COALESCE(NULLIF(td.location_locationname, ''), NULLIF(td.location_address, ''), NULLIF(td.tasklocation_locationname, '')) AS job_address,
             COALESCE(NULLIF(td.location_suburb, ''), REGEXP_EXTRACT(td.tasklocation_locationname, r',\s*(.+)$')) AS job_suburb,
             td.description,
             SAFE_CAST(td.quote_totalex AS NUMERIC) AS quote_totalex
      FROM \`pttr-taskdata.ds_aroflo.tasks_deduped\` td
      JOIN matched_clients mc ON td.client_clientid = mc.clientid
      WHERE td.jobnumber NOT IN (SELECT jobnumber FROM completed_jobs)
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
  `, { phoneNorm: phoneNorm || '', phoneLast9, email: email || '' })
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
    FROM \`${DS}.unified_leads\` ul
    JOIN \`${DS}.lead_interactions\` li ON ul.lead_id = li.lead_id
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
    WHERE REGEXP_CONTAINS(CONCAT(',', REPLACE(ul.job_numbers, ' ', ''), ','), CONCAT(',', @jobId, ','))
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
      COUNTIF(is_booking) AS bookings,
      COUNTIF(is_converted_job) AS conversions,
      ROUND(SAFE_DIVIDE(COUNTIF(is_booking), COUNT(*)) * 100, 1) AS booking_rate,
      SUM(sales_value) AS revenue
    FROM \`${DS}.vw_leads\`
    WHERE lead_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
    AND funnel_stage != 'Repeat'
  `)
}
