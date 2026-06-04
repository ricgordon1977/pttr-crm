-- build_opportunities.sql: Materialized connected-component opportunity clustering
-- Run as a script to populate ds_crm.opportunities (table, not view).
-- Re-run is idempotent (CREATE OR REPLACE).

-- ====== STEP 1: Collect event nodes ======
CREATE TEMP TABLE spine_events AS
SELECT lead_id AS event_id, source_type, lead_timestamp AS event_ts,
  phone, LOWER(TRIM(email)) AS email,
  duration_sec, queue_ext, queue_name, is_business_hours,
  attribution_source, wc_lead_id, channel, source, medium,
  campaign, keyword, profile, tracking_number, direct_subtype,
  call_outcome, answered, contact_name
FROM `pttr-taskdata.ds_crm.vw_leads_unified`
WHERE call_outcome IN ('connected', 'dropped', 'missed', 'form_submit');

-- Phone normalization helper (reused for multiple fields)
CREATE TEMP FUNCTION norm_au_phone(raw STRING) AS (
  CASE
    WHEN raw IS NULL OR TRIM(raw) = '' THEN NULL
    WHEN REGEXP_CONTAINS(REGEXP_REPLACE(raw, r'[^0-9]', ''), r'^61[2-9]')
      THEN CONCAT('+', REGEXP_REPLACE(raw, r'[^0-9]', ''))
    WHEN REGEXP_CONTAINS(REGEXP_REPLACE(raw, r'[^0-9]', ''), r'^0[2-9]')
      THEN CONCAT('+61', SUBSTR(REGEXP_REPLACE(raw, r'[^0-9]', ''), 2))
    WHEN REGEXP_CONTAINS(REGEXP_REPLACE(raw, r'[^0-9]', ''), r'^[4][0-9]{8}$')
      THEN CONCAT('+61', REGEXP_REPLACE(raw, r'[^0-9]', ''))
    ELSE NULL
  END
);

-- Helper: strip HTML tags and entities from text
CREATE TEMP FUNCTION strip_html(txt STRING) AS (
  REGEXP_REPLACE(REGEXP_REPLACE(txt, r'<[^>]+>', ' '), r'&[a-zA-Z]+;|&#\d+;', ' ')
);

-- Helper: extract first AU phone from free text
CREATE TEMP FUNCTION extract_au_phone(txt STRING) AS (
  (SELECT norm_au_phone(REGEXP_EXTRACT(
    strip_html(txt),
    r'(?:Phone|Caller ID|Contact[^)]*\(M(?:ob)?\)|(?:^|[\s>])m\))\s*[:\s]*(\+?6?1?\s*0?[2-8][\d\s\-\.]{7,12})'
  )))
);

-- Helper: extract first email from free text
CREATE TEMP FUNCTION extract_email(txt STRING) AS (
  (SELECT LOWER(REGEXP_EXTRACT(
    strip_html(txt),
    r'(?:^|[\s>])e\)\s*([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})'
  )))
);

CREATE TEMP TABLE job_events AS
WITH raw_jobs AS (
  SELECT tc.jobnumber AS event_id,
    TIMESTAMP(tc.requested_date_parsed) AS event_ts,
    -- Client-level contacts
    tc.id_phone, tc.norm_client_phone, LOWER(TRIM(tc.norm_client_email)) AS job_email,
    -- Task contact (via contacts_deduped — the CUSTOMER, not the CSR)
    norm_au_phone(cd.mobile) AS contact_mobile,
    CASE WHEN COALESCE(TRIM(cd.email), '') != '' THEN LOWER(TRIM(cd.email)) ELSE NULL END AS contact_email,
    -- Location site contacts (secondary fallback)
    norm_au_phone(td.location_SitePhone) AS site_phone,
    CASE WHEN COALESCE(TRIM(td.location_SiteEmail), '') != '' THEN LOWER(TRIM(td.location_SiteEmail)) ELSE NULL END AS site_email,
    -- Description text for free-text extraction (final rung)
    COALESCE(td.description, tc.description) AS desc_text,
    tc.jobnumber, tc.task_type AS job_task_type, tc.display_status AS job_display_status,
    tc.status AS aroflo_status, tc.job_status AS aroflo_job_status,
    tc.task_invoices_total_ex, tc.customer_type, tc.client_name
  FROM `pttr-taskdata.ds_aroflo.tasks_complete` tc
  LEFT JOIN `pttr-taskdata.ds_aroflo.tasks_deduped` td ON tc.jobnumber = td.jobnumber
  LEFT JOIN `pttr-taskdata.ds_aroflo.contacts_deduped` cd
    ON td.contact_userid = cd.userid AND td.contact_userid IS NOT NULL AND td.contact_userid != ''
  WHERE tc.customer_type != 'Account'
    -- Exclude test clients
    AND LOWER(tc.client_name) NOT LIKE '%test%'
)
SELECT *,
  -- Free-text extraction: ONLY when all structured levels are null
  CASE WHEN COALESCE(id_phone, '') = '' AND COALESCE(norm_client_phone, '') = ''
        AND contact_mobile IS NULL AND site_phone IS NULL
    THEN extract_au_phone(desc_text) ELSE NULL END AS desc_phone,
  CASE WHEN COALESCE(job_email, '') = '' AND contact_email IS NULL AND site_email IS NULL
    THEN extract_email(desc_text) ELSE NULL END AS desc_email
FROM raw_jobs;

-- ====== STEP 2: Contact-point mapping ======
CREATE TEMP TABLE contact_points AS
SELECT 'S' AS src, event_id, event_ts, phone AS cp, 'phone' AS cp_type FROM spine_events WHERE phone IS NOT NULL AND phone != ''
UNION ALL
SELECT 'S', event_id, event_ts, email, 'email' FROM spine_events WHERE email IS NOT NULL AND email != ''
UNION ALL
SELECT 'J', event_id, event_ts, id_phone, 'phone' FROM job_events WHERE id_phone IS NOT NULL AND id_phone != ''
UNION ALL
SELECT 'J', event_id, event_ts, norm_client_phone, 'phone' FROM job_events
  WHERE norm_client_phone IS NOT NULL AND norm_client_phone != '' AND (id_phone IS NULL OR norm_client_phone != id_phone)
UNION ALL
SELECT 'J', event_id, event_ts, job_email, 'email' FROM job_events WHERE job_email IS NOT NULL AND job_email != ''
UNION ALL
-- Task contact mobile (highest priority for MISC COD / placeholder clients)
SELECT 'J', event_id, event_ts, contact_mobile, 'phone' FROM job_events
  WHERE contact_mobile IS NOT NULL
    AND contact_mobile != COALESCE(id_phone, '') AND contact_mobile != COALESCE(norm_client_phone, '')
UNION ALL
-- Task contact email
SELECT 'J', event_id, event_ts, contact_email, 'email' FROM job_events
  WHERE contact_email IS NOT NULL
    AND contact_email != COALESCE(job_email, '')
UNION ALL
-- Location site phone (when different from all above)
SELECT 'J', event_id, event_ts, site_phone, 'phone' FROM job_events
  WHERE site_phone IS NOT NULL
    AND site_phone != COALESCE(id_phone, '') AND site_phone != COALESCE(norm_client_phone, '')
    AND site_phone != COALESCE(contact_mobile, '')
UNION ALL
-- Location site email (when different from all above)
SELECT 'J', event_id, event_ts, site_email, 'email' FROM job_events
  WHERE site_email IS NOT NULL
    AND site_email != COALESCE(job_email, '') AND site_email != COALESCE(contact_email, '')
UNION ALL
-- Description-extracted phone (final rung, only when all structured null)
SELECT 'J', event_id, event_ts, desc_phone, 'phone' FROM job_events
  WHERE desc_phone IS NOT NULL
UNION ALL
-- Description-extracted email (final rung)
SELECT 'J', event_id, event_ts, desc_email, 'email' FROM job_events
  WHERE desc_email IS NOT NULL;

-- Prefix event_ids
CREATE TEMP TABLE prefixed_cp AS
SELECT CONCAT(src, '-', event_id) AS eid, event_ts, cp, cp_type FROM contact_points;

-- All unique event IDs (including contactless singletons)
CREATE TEMP TABLE all_eids AS
SELECT DISTINCT eid FROM prefixed_cp
UNION DISTINCT
-- Contactless spine events (singletons)
SELECT CONCAT('S-', event_id) FROM spine_events WHERE (phone IS NULL OR phone = '') AND (email IS NULL OR email = '')
UNION DISTINCT
-- Contactless job events (singletons) — ensures every COD job yields an opportunity
SELECT CONCAT('J-', event_id) FROM job_events
WHERE (id_phone IS NULL OR id_phone = '')
  AND (norm_client_phone IS NULL OR norm_client_phone = '')
  AND (job_email IS NULL OR job_email = '')
  AND contact_mobile IS NULL
  AND contact_email IS NULL
  AND site_phone IS NULL
  AND site_email IS NULL
  AND desc_phone IS NULL
  AND desc_email IS NULL;

-- ====== STEP 3: Edges ======
CREATE TEMP TABLE bi_edges AS
WITH directed AS (
  SELECT DISTINCT a.eid AS src, b.eid AS dst
  FROM prefixed_cp a JOIN prefixed_cp b
    ON a.cp = b.cp AND a.cp_type = b.cp_type AND a.eid < b.eid
    AND ABS(TIMESTAMP_DIFF(a.event_ts, b.event_ts, SECOND)) <= 2592000
)
SELECT src, dst FROM directed
UNION ALL
SELECT dst, src FROM directed;

-- ====== STEP 4: Label propagation ======
CREATE TEMP TABLE r0 AS SELECT eid, eid AS comp FROM all_eids;

CREATE TEMP TABLE r1 AS
SELECT r.eid, LEAST(r.comp, COALESCE(MIN(rn.comp), r.comp)) AS comp
FROM r0 r LEFT JOIN bi_edges e ON r.eid = e.src LEFT JOIN r0 rn ON e.dst = rn.eid
GROUP BY r.eid, r.comp;

CREATE TEMP TABLE r2 AS
SELECT r.eid, LEAST(r.comp, COALESCE(MIN(rn.comp), r.comp)) AS comp
FROM r1 r LEFT JOIN bi_edges e ON r.eid = e.src LEFT JOIN r1 rn ON e.dst = rn.eid
GROUP BY r.eid, r.comp;

CREATE TEMP TABLE r3 AS
SELECT r.eid, LEAST(r.comp, COALESCE(MIN(rn.comp), r.comp)) AS comp
FROM r2 r LEFT JOIN bi_edges e ON r.eid = e.src LEFT JOIN r2 rn ON e.dst = rn.eid
GROUP BY r.eid, r.comp;

CREATE TEMP TABLE r4 AS
SELECT r.eid, LEAST(r.comp, COALESCE(MIN(rn.comp), r.comp)) AS comp
FROM r3 r LEFT JOIN bi_edges e ON r.eid = e.src LEFT JOIN r3 rn ON e.dst = rn.eid
GROUP BY r.eid, r.comp;

CREATE TEMP TABLE r5 AS
SELECT r.eid, LEAST(r.comp, COALESCE(MIN(rn.comp), r.comp)) AS comp
FROM r4 r LEFT JOIN bi_edges e ON r.eid = e.src LEFT JOIN r4 rn ON e.dst = rn.eid
GROUP BY r.eid, r.comp;

-- ====== STEP 5: Aggregate per component ======
CREATE TEMP TABLE comp_contacts AS
WITH deduped AS (
  SELECT DISTINCT r5.comp, cp.cp, cp.cp_type
  FROM r5 JOIN prefixed_cp cp ON r5.eid = cp.eid
)
SELECT comp,
  STRING_AGG(CASE WHEN cp_type = 'phone' THEN cp END ORDER BY cp) AS matched_phones,
  STRING_AGG(CASE WHEN cp_type = 'email' THEN cp END ORDER BY cp) AS matched_emails
FROM deduped GROUP BY comp;

CREATE TEMP TABLE comp_spine AS
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
GROUP BY r5.comp;

CREATE TEMP TABLE comp_jobs AS
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
GROUP BY r5.comp;

CREATE TEMP TABLE comp_ts AS
SELECT r5.comp, MIN(
  CASE WHEN r5.eid LIKE 'S-%' THEN s.event_ts ELSE j.event_ts END
) AS min_ts
FROM r5
LEFT JOIN spine_events s ON r5.eid = CONCAT('S-', s.event_id)
LEFT JOIN job_events j ON r5.eid = CONCAT('J-', j.event_id)
GROUP BY r5.comp;

CREATE TEMP TABLE phone_first_job AS
SELECT phone, MIN(requested_date_parsed) AS first_job_date FROM (
  SELECT norm_client_mobile AS phone, requested_date_parsed FROM `pttr-taskdata.ds_aroflo.tasks_complete` WHERE norm_client_mobile IS NOT NULL AND norm_client_mobile != ''
  UNION ALL
  SELECT id_phone, requested_date_parsed FROM `pttr-taskdata.ds_aroflo.tasks_complete` WHERE id_phone IS NOT NULL AND id_phone != ''
) GROUP BY phone;

-- ====== STEP 6: Materialize final table ======
CREATE OR REPLACE TABLE `pttr-taskdata.ds_crm.opportunities` AS
WITH all_comps AS (SELECT DISTINCT comp FROM r5)
SELECT
  CASE
    WHEN cj.jobnumber IS NOT NULL THEN CONCAT('J-', cj.jobnumber)
    ELSE CONCAT('G-', TO_HEX(MD5(CONCAT(ac.comp, '|',
      COALESCE(cc.matched_phones, ''), '|', COALESCE(cc.matched_emails, '')))))
  END AS opportunity_id,
  COALESCE(cs.first_event.phone, SPLIT(cc.matched_phones, ',')[SAFE_OFFSET(0)]) AS phone,
  cj.jobnumber,
  cj.first_job.job_task_type AS job_task_type,
  cj.first_job.job_display_status AS job_status,
  COALESCE(cj.job_count, 0) AS job_count,
  cj.all_jobnumbers,
  ct.min_ts AS opportunity_timestamp,
  DATETIME(ct.min_ts, 'Australia/Sydney') AS opportunity_timestamp_sydney,
  COALESCE(cs.call_count, 0) AS call_count,
  COALESCE(cs.form_count, 0) AS form_count,
  COALESCE(cs.max_duration_sec, 0) AS max_duration_sec,
  CASE
    WHEN cs.comp IS NULL THEN 'no_inbound'
    WHEN cj.jobnumber IS NOT NULL THEN 'job_matched'
    ELSE 'gap_based'
  END AS opp_type,
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
  cc.matched_phones,
  cc.matched_emails,
  cs.comp IS NULL AS is_no_inbound_enquiry,
  COALESCE(cs.has_answered_call, FALSE) AS has_answered_call,
  -- is_existing_customer: filled via post-hoc join
  FALSE AS is_existing_customer
FROM all_comps ac
JOIN comp_ts ct ON ac.comp = ct.comp
LEFT JOIN comp_contacts cc ON ac.comp = cc.comp
LEFT JOIN comp_spine cs ON ac.comp = cs.comp
LEFT JOIN comp_jobs cj ON ac.comp = cj.comp;

-- Post-hoc: set is_existing_customer via phone lookup
UPDATE `pttr-taskdata.ds_crm.opportunities` o
SET is_existing_customer = TRUE
WHERE EXISTS (
  SELECT 1 FROM phone_first_job pfj
  WHERE pfj.phone = o.phone
    AND pfj.first_job_date < DATE(o.opportunity_timestamp_sydney)
);
