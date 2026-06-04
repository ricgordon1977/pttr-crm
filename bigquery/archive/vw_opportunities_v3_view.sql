-- vw_opportunities v3: connected-component clustering on phone OR email within 30 days
-- AroFlo COD jobs are graph nodes. PM/Account work excluded.
-- 5 rounds of label propagation for transitive merging.
CREATE OR REPLACE VIEW `pttr-taskdata.ds_crm.vw_opportunities` AS
WITH
-- ====== STEP 1: Event nodes ======
spine_events AS (
  SELECT lead_id AS event_id, source_type, lead_timestamp AS event_ts,
    phone, LOWER(TRIM(email)) AS email,
    duration_sec, queue_ext, queue_name, is_business_hours,
    attribution_source, wc_lead_id, channel, source, medium,
    campaign, keyword, profile, tracking_number, direct_subtype,
    call_outcome, answered, contact_name
  FROM `pttr-taskdata.ds_crm.vw_leads_unified`
  WHERE call_outcome IN ('connected', 'form_submit')
),

job_events AS (
  SELECT jobnumber AS event_id,
    TIMESTAMP(requested_date_parsed) AS event_ts,
    id_phone, norm_client_phone, LOWER(TRIM(norm_client_email)) AS job_email,
    jobnumber, task_type AS job_task_type, display_status AS job_display_status,
    status AS aroflo_status, job_status AS aroflo_job_status,
    task_invoices_total_ex, customer_type, client_name
  FROM `pttr-taskdata.ds_aroflo.tasks_complete`
  WHERE customer_type != 'Account'
),

-- ====== STEP 2: Contact-point mapping ======
contact_points AS (
  -- Spine phones
  SELECT 'S' AS src, event_id, event_ts, phone AS cp, 'phone' AS cp_type
  FROM spine_events WHERE phone IS NOT NULL AND phone != ''
  UNION ALL
  -- Spine emails
  SELECT 'S', event_id, event_ts, email, 'email'
  FROM spine_events WHERE email IS NOT NULL AND email != ''
  UNION ALL
  -- Job id_phone
  SELECT 'J', event_id, event_ts, id_phone, 'phone'
  FROM job_events WHERE id_phone IS NOT NULL AND id_phone != ''
  UNION ALL
  -- Job norm_client_phone (if different from id_phone)
  SELECT 'J', event_id, event_ts, norm_client_phone, 'phone'
  FROM job_events WHERE norm_client_phone IS NOT NULL AND norm_client_phone != ''
    AND (id_phone IS NULL OR norm_client_phone != id_phone)
  UNION ALL
  -- Job emails
  SELECT 'J', event_id, event_ts, job_email, 'email'
  FROM job_events WHERE job_email IS NOT NULL AND job_email != ''
),

-- Prefix event_ids to avoid collision between call_ids and jobnumbers
prefixed_cp AS (
  SELECT CONCAT(src, '-', event_id) AS eid, event_ts, cp, cp_type FROM contact_points
),

-- All unique event IDs
all_eids AS (
  SELECT DISTINCT eid FROM prefixed_cp
  UNION DISTINCT
  -- Include events with NO contact points (will be singletons)
  SELECT CONCAT('S-', event_id) FROM spine_events WHERE
    (phone IS NULL OR phone = '') AND (email IS NULL OR email = '')
),

-- ====== STEP 3: Edges (shared contact point within 30 days) ======
edges AS (
  SELECT DISTINCT a.eid AS src, b.eid AS dst
  FROM prefixed_cp a
  JOIN prefixed_cp b
    ON a.cp = b.cp AND a.cp_type = b.cp_type
    AND a.eid < b.eid
    AND ABS(TIMESTAMP_DIFF(a.event_ts, b.event_ts, SECOND)) <= 2592000
),
bi_edges AS (
  SELECT src, dst FROM edges UNION ALL SELECT dst, src FROM edges
),

-- ====== STEP 4: Label propagation (5 rounds) ======
r0 AS (SELECT eid, eid AS comp FROM all_eids),
r1 AS (
  SELECT r.eid, LEAST(r.comp, COALESCE(MIN(rn.comp), r.comp)) AS comp
  FROM r0 r LEFT JOIN bi_edges e ON r.eid = e.src LEFT JOIN r0 rn ON e.dst = rn.eid
  GROUP BY r.eid, r.comp
),
r2 AS (
  SELECT r.eid, LEAST(r.comp, COALESCE(MIN(rn.comp), r.comp)) AS comp
  FROM r1 r LEFT JOIN bi_edges e ON r.eid = e.src LEFT JOIN r1 rn ON e.dst = rn.eid
  GROUP BY r.eid, r.comp
),
r3 AS (
  SELECT r.eid, LEAST(r.comp, COALESCE(MIN(rn.comp), r.comp)) AS comp
  FROM r2 r LEFT JOIN bi_edges e ON r.eid = e.src LEFT JOIN r2 rn ON e.dst = rn.eid
  GROUP BY r.eid, r.comp
),
r4 AS (
  SELECT r.eid, LEAST(r.comp, COALESCE(MIN(rn.comp), r.comp)) AS comp
  FROM r3 r LEFT JOIN bi_edges e ON r.eid = e.src LEFT JOIN r3 rn ON e.dst = rn.eid
  GROUP BY r.eid, r.comp
),
r5 AS (
  SELECT r.eid, LEAST(r.comp, COALESCE(MIN(rn.comp), r.comp)) AS comp
  FROM r4 r LEFT JOIN bi_edges e ON r.eid = e.src LEFT JOIN r4 rn ON e.dst = rn.eid
  GROUP BY r.eid, r.comp
),

-- ====== STEP 5: Aggregate per component ======
-- Collect contact points per component
comp_cp_deduped AS (
  SELECT DISTINCT r5.comp, cp.cp, cp.cp_type
  FROM r5
  LEFT JOIN prefixed_cp cp ON r5.eid = cp.eid
  WHERE cp.cp IS NOT NULL
),
comp_contacts AS (
  SELECT comp,
    STRING_AGG(CASE WHEN cp_type = 'phone' THEN cp END ORDER BY cp) AS matched_phones,
    STRING_AGG(CASE WHEN cp_type = 'email' THEN cp END ORDER BY cp) AS matched_emails
  FROM comp_cp_deduped
  GROUP BY comp
),

-- Spine event aggregates per component
comp_spine AS (
  SELECT r5.comp,
    COUNT(*) AS spine_event_count,
    COUNTIF(s.source_type = 'call') AS call_count,
    COUNTIF(s.source_type = 'form') AS form_count,
    MAX(s.duration_sec) AS max_duration_sec,
    LOGICAL_OR(s.answered = 'Answered') AS has_answered_call,
    ARRAY_AGG(STRUCT(
      s.event_id, s.source_type, s.event_ts, s.phone, s.email,
      s.duration_sec, s.queue_ext, s.queue_name, s.is_business_hours,
      s.attribution_source, s.wc_lead_id, s.channel, s.source, s.medium,
      s.campaign, s.keyword, s.profile, s.tracking_number, s.direct_subtype,
      s.call_outcome, s.answered, s.contact_name
    ) ORDER BY s.event_ts LIMIT 1)[OFFSET(0)] AS first_event
  FROM r5
  JOIN spine_events s ON r5.eid = CONCAT('S-', s.event_id)
  GROUP BY r5.comp
),

-- Job aggregates per component
comp_jobs AS (
  SELECT r5.comp,
    MIN(j.jobnumber) AS jobnumber,
    COUNT(DISTINCT j.jobnumber) AS job_count,
    STRING_AGG(DISTINCT j.jobnumber ORDER BY j.jobnumber) AS all_jobnumbers,
    ARRAY_AGG(STRUCT(
      j.jobnumber, j.job_task_type, j.job_display_status,
      j.aroflo_status, j.aroflo_job_status,
      j.task_invoices_total_ex, j.client_name
    ) ORDER BY j.jobnumber LIMIT 1)[OFFSET(0)] AS first_job
  FROM r5
  JOIN job_events j ON r5.eid = CONCAT('J-', j.event_id)
  GROUP BY r5.comp
),

-- All distinct components
all_comps AS (SELECT DISTINCT comp FROM r5),

-- Min timestamp per component (across spine + jobs)
comp_ts AS (
  SELECT r5.comp, MIN(
    CASE WHEN r5.eid LIKE 'S-%' THEN s.event_ts ELSE j.event_ts END
  ) AS min_ts
  FROM r5
  LEFT JOIN spine_events s ON r5.eid = CONCAT('S-', s.event_id)
  LEFT JOIN job_events j ON r5.eid = CONCAT('J-', j.event_id)
  GROUP BY r5.comp
),

-- is_existing_customer: any matched phone has a prior AroFlo job
phone_first_job AS (
  SELECT phone, MIN(requested_date_parsed) AS first_job_date FROM (
    SELECT norm_client_mobile AS phone, requested_date_parsed FROM `pttr-taskdata.ds_aroflo.tasks_complete` WHERE norm_client_mobile IS NOT NULL AND norm_client_mobile != ''
    UNION ALL
    SELECT id_phone, requested_date_parsed FROM `pttr-taskdata.ds_aroflo.tasks_complete` WHERE id_phone IS NOT NULL AND id_phone != ''
  ) GROUP BY phone
)

-- ====== STEP 6: Final output ======
SELECT
  -- Deterministic opportunity_id
  CASE
    WHEN cj.jobnumber IS NOT NULL THEN CONCAT('J-', cj.jobnumber)
    ELSE CONCAT('G-', TO_HEX(MD5(CONCAT(ac.comp, '|',
      COALESCE(cc.matched_phones, ''), '|', COALESCE(cc.matched_emails, '')))))
  END AS opportunity_id,

  -- Primary phone (earliest spine event, fallback to first matched phone)
  COALESCE(cs.first_event.phone, SPLIT(cc.matched_phones, ', ')[SAFE_OFFSET(0)]) AS phone,

  -- Job fields
  cj.jobnumber,
  cj.first_job.job_task_type AS job_task_type,
  cj.first_job.job_display_status AS job_status,
  COALESCE(cj.job_count, 0) AS job_count,
  cj.all_jobnumbers,

  -- Timestamps
  ct.min_ts AS opportunity_timestamp,
  DATETIME(ct.min_ts, 'Australia/Sydney') AS opportunity_timestamp_sydney,

  -- Counts
  COALESCE(cs.call_count, 0) AS call_count,
  COALESCE(cs.form_count, 0) AS form_count,
  COALESCE(cs.max_duration_sec, 0) AS max_duration_sec,

  -- Type
  CASE
    WHEN cs.comp IS NULL THEN 'no_inbound'
    WHEN cj.jobnumber IS NOT NULL THEN 'job_matched'
    ELSE 'gap_based'
  END AS opp_type,

  -- Attribution (from earliest spine event; NULLs for job-only opps)
  cs.first_event.is_business_hours,
  COALESCE(cs.first_event.attribution_source, 'direct_booking') AS attribution_source,
  COALESCE(cs.first_event.channel, 'Direct Booking') AS channel,
  COALESCE(cs.first_event.source, 'direct') AS source,
  COALESCE(cs.first_event.medium, '(none)') AS medium,
  cs.first_event.campaign,
  cs.first_event.keyword,
  cs.first_event.profile,
  cs.first_event.wc_lead_id,
  cs.first_event.direct_subtype,
  cs.first_event.queue_ext,
  cs.first_event.queue_name,
  cs.first_event.contact_name,

  -- Audit
  cc.matched_phones,
  cc.matched_emails,
  cs.comp IS NULL AS is_no_inbound_enquiry,
  COALESCE(cs.has_answered_call, FALSE) AS has_answered_call,

  -- Existing customer (any matched phone has a prior job)
  EXISTS(
    SELECT 1 FROM UNNEST(SPLIT(COALESCE(cc.matched_phones, ''), ', ')) AS p
    JOIN phone_first_job pfj ON p = pfj.phone
    WHERE pfj.first_job_date < DATE(ct.min_ts)
  ) AS is_existing_customer

FROM all_comps ac
JOIN comp_ts ct ON ac.comp = ct.comp
LEFT JOIN comp_contacts cc ON ac.comp = cc.comp
LEFT JOIN comp_spine cs ON ac.comp = cs.comp
LEFT JOIN comp_jobs cj ON ac.comp = cj.comp;
