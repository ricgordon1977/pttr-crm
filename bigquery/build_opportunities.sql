-- build_opportunities.sql: Materialized connected-component opportunity clustering
-- Run as a script to populate ds_crm.opportunities (table, not view).
-- Re-run is idempotent (CREATE OR REPLACE).
--
-- Third-stream amendment (2026-06-10): WhatConverts is now a third origination
-- source. WC leads not already in the spine seed new opportunities; those that
-- match existing events enrich via the wc_leads array. Attribution uses WC
-- primacy (§8a.1) and tiered defaults (§8a.2).

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
  -- Free-text extraction: ONLY when all structured levels are null (legacy, for desc_phone)
  CASE WHEN COALESCE(id_phone, '') = '' AND COALESCE(norm_client_phone, '') = ''
        AND contact_mobile IS NULL AND site_phone IS NULL
    THEN extract_au_phone(desc_text) ELSE NULL END AS desc_phone,
  CASE WHEN COALESCE(job_email, '') = '' AND contact_email IS NULL AND site_email IS NULL
    THEN extract_email(desc_text) ELSE NULL END AS desc_email,
  -- OfficeHQ pager "Caller ID:" phone — always extracted (not gated on structured fields).
  norm_au_phone(REGEXP_EXTRACT(
    strip_html(desc_text),
    r'Caller\s+ID\s*:\s*(\+?\d[\d\s\-\.]{7,15})'
  )) AS callerid_phone,
  -- T3: UN-GATED description phone extraction (always runs, even when structured phones exist).
  -- Uses LABELED patterns only (Phone:, m), Caller ID:, Contact...(M)) — same regex as
  -- extract_au_phone(). Bare mobile patterns are too noisy for auto-linking (secondary contacts
  -- create false merges — validated: 27 false-positive merges with bare regex, zero with labeled).
  extract_au_phone(desc_text) AS t3_desc_phone
FROM raw_jobs;

-- ====== T3: Task-notes and labour-notes phone extraction ======
-- Extract customer phones from notes text. One extracted phone per job (first match).
-- These are additional match keys fed into the clustering graph.
CREATE TEMP TABLE t3_notes_phones AS
WITH task_note_phones AS (
  SELECT jobnumber,
    norm_au_phone(REGEXP_EXTRACT(
      REGEXP_REPLACE(REGEXP_REPLACE(note_clean, r'<[^>]+>', ' '), r'&[a-zA-Z]+;|&#\d+;', ' '),
      r'(?:Phone|Caller ID|Contact[^)]*\(M(?:ob)?\)|(?:^|[\s>])m\))\s*[:\s]*(\+?6?1?\s*0?[2-8][\d\s\-\.]{7,12})'
    )) AS extracted_phone
  FROM `pttr-taskdata.ds_aroflo.task_notes_deduped`
  WHERE note_clean IS NOT NULL
),
labour_note_phones AS (
  SELECT task_jobnumber AS jobnumber,
    norm_au_phone(REGEXP_EXTRACT(
      note,
      r'(?:Phone|Contact|m\)|M\))\s*[:\s]*(\+?6?1?\s*0?[2-8][\d\s\-\.]{7,12})'
    )) AS extracted_phone
  FROM `pttr-taskdata.ds_aroflo.tasklabours_raw`
  WHERE note IS NOT NULL AND (deleted IS NULL OR deleted = 'false')
),
all_note_phones AS (
  SELECT DISTINCT jobnumber, extracted_phone
  FROM (
    SELECT * FROM task_note_phones WHERE extracted_phone IS NOT NULL
    UNION ALL
    SELECT * FROM labour_note_phones WHERE extracted_phone IS NOT NULL
  )
)
-- Non-customer exclusion: filter out staff/internal phones
SELECT anp.jobnumber, anp.extracted_phone
FROM all_note_phones anp
WHERE anp.extracted_phone NOT IN (
  -- Staff phones (≥10 outbound, 0 jobs)
  SELECT phone FROM (
    SELECT rc.norm_callee_phone AS phone, COUNT(*) AS cnt
    FROM `pttr-taskdata.ds_crm.raw_calls` rc
    WHERE rc.direction = 'Outgoing' AND rc.norm_callee_phone IS NOT NULL AND rc.norm_callee_phone != ''
    GROUP BY 1 HAVING COUNT(*) >= 10
  )
  WHERE phone NOT IN (
    SELECT DISTINCT phone FROM (
      SELECT norm_client_mobile AS phone FROM `pttr-taskdata.ds_aroflo.tasks_complete` WHERE norm_client_mobile IS NOT NULL AND norm_client_mobile != ''
      UNION DISTINCT
      SELECT id_phone FROM `pttr-taskdata.ds_aroflo.tasks_complete` WHERE id_phone IS NOT NULL AND id_phone != ''
    )
  )
)
-- Exclude known CSR/office extensions (8583-xxxx range)
AND NOT REGEXP_CONTAINS(anp.extracted_phone, r'\+618583');

-- ====== STEP 1a: WC-only event nodes (third-stream) ======
-- Eligible WC leads NOT already represented in the spine via ±5s match.
-- These enter the graph as 'W'-prefixed nodes. The clustering algorithm
-- naturally handles ENRICH (clusters with existing events via phone/email)
-- vs SEED (forms new standalone components).
CREATE TEMP TABLE wc_events AS
SELECT
  CAST(wc.lead_id AS STRING) AS event_id,
  wc.lead_id AS wc_lead_id,
  wc.date_created AS event_ts,
  NULLIF(wc.norm_phone, '') AS phone,
  LOWER(NULLIF(TRIM(wc.norm_email), '')) AS email,
  wc.lead_source AS source,
  wc.lead_medium AS medium,
  wc.lead_keyword AS keyword,
  wc.lead_campaign AS campaign,
  CASE WHEN wc.lead_type = 'Phone Call' THEN wc.lead_type
       WHEN wc.lead_type = 'Web Form' THEN wc.lead_type
       ELSE wc.lead_type END AS channel,
  wc.profile,
  wc.lead_type,
  wc.contact_name
FROM `pttr-taskdata.gd_WhatConverts.all_leads_enriched` wc
LEFT JOIN (
  SELECT DISTINCT wc_lead_id FROM spine_events WHERE wc_lead_id IS NOT NULL
) existing ON wc.lead_id = existing.wc_lead_id
WHERE wc.lead_status = 'Unique'
  AND wc.spam = FALSE
  AND wc.is_test_lead = FALSE
  AND existing.wc_lead_id IS NULL;

-- ====== STEP 2: Contact-point mapping ======
CREATE TEMP TABLE contact_points AS
-- Spine events
SELECT 'S' AS src, event_id, event_ts, phone AS cp, 'phone' AS cp_type FROM spine_events WHERE phone IS NOT NULL AND phone != ''
UNION ALL
SELECT 'S', event_id, event_ts, email, 'email' FROM spine_events WHERE email IS NOT NULL AND email != ''
UNION ALL
-- Job events (all contact levels)
SELECT 'J', event_id, event_ts, id_phone, 'phone' FROM job_events WHERE id_phone IS NOT NULL AND id_phone != ''
UNION ALL
SELECT 'J', event_id, event_ts, norm_client_phone, 'phone' FROM job_events
  WHERE norm_client_phone IS NOT NULL AND norm_client_phone != '' AND (id_phone IS NULL OR norm_client_phone != id_phone)
UNION ALL
SELECT 'J', event_id, event_ts, job_email, 'email' FROM job_events WHERE job_email IS NOT NULL AND job_email != ''
UNION ALL
SELECT 'J', event_id, event_ts, contact_mobile, 'phone' FROM job_events
  WHERE contact_mobile IS NOT NULL
    AND contact_mobile != COALESCE(id_phone, '') AND contact_mobile != COALESCE(norm_client_phone, '')
UNION ALL
SELECT 'J', event_id, event_ts, contact_email, 'email' FROM job_events
  WHERE contact_email IS NOT NULL
    AND contact_email != COALESCE(job_email, '')
UNION ALL
SELECT 'J', event_id, event_ts, site_phone, 'phone' FROM job_events
  WHERE site_phone IS NOT NULL
    AND site_phone != COALESCE(id_phone, '') AND site_phone != COALESCE(norm_client_phone, '')
    AND site_phone != COALESCE(contact_mobile, '')
UNION ALL
SELECT 'J', event_id, event_ts, site_email, 'email' FROM job_events
  WHERE site_email IS NOT NULL
    AND site_email != COALESCE(job_email, '') AND site_email != COALESCE(contact_email, '')
UNION ALL
SELECT 'J', event_id, event_ts, desc_phone, 'phone' FROM job_events
  WHERE desc_phone IS NOT NULL
UNION ALL
SELECT 'J', event_id, event_ts, desc_email, 'email' FROM job_events
  WHERE desc_email IS NOT NULL
UNION ALL
SELECT 'J', event_id, event_ts, callerid_phone, 'phone' FROM job_events
  WHERE callerid_phone IS NOT NULL
    AND callerid_phone != COALESCE(id_phone, '')
    AND callerid_phone != COALESCE(norm_client_phone, '')
    AND callerid_phone != COALESCE(contact_mobile, '')
    AND callerid_phone != COALESCE(site_phone, '')
    AND callerid_phone != COALESCE(desc_phone, '')
UNION ALL
-- T3: UN-GATED description phone (captures alternate customer phones even when structured exist)
SELECT 'J', event_id, event_ts, t3_desc_phone, 'phone' FROM job_events
  WHERE t3_desc_phone IS NOT NULL
    -- Dedup: only add if different from ALL structured phones
    AND t3_desc_phone != COALESCE(id_phone, '')
    AND t3_desc_phone != COALESCE(norm_client_phone, '')
    AND t3_desc_phone != COALESCE(contact_mobile, '')
    AND t3_desc_phone != COALESCE(site_phone, '')
    AND t3_desc_phone != COALESCE(desc_phone, '')
    AND t3_desc_phone != COALESCE(callerid_phone, '')
    -- Non-customer exclusion: not a staff/internal phone
    AND t3_desc_phone NOT IN (
      SELECT phone FROM (
        SELECT rc.norm_callee_phone AS phone, COUNT(*) AS cnt
        FROM `pttr-taskdata.ds_crm.raw_calls` rc
        WHERE rc.direction = 'Outgoing' AND rc.norm_callee_phone IS NOT NULL GROUP BY 1 HAVING COUNT(*) >= 10
      ) WHERE phone NOT IN (
        SELECT DISTINCT p FROM (
          SELECT norm_client_mobile AS p FROM `pttr-taskdata.ds_aroflo.tasks_complete` WHERE norm_client_mobile IS NOT NULL AND norm_client_mobile != ''
          UNION DISTINCT SELECT id_phone FROM `pttr-taskdata.ds_aroflo.tasks_complete` WHERE id_phone IS NOT NULL AND id_phone != ''
        )
      )
    )
    AND NOT REGEXP_CONTAINS(t3_desc_phone, r'\+618583')
UNION ALL
-- T3: Task/labour notes extracted phones
SELECT 'J', j.event_id, j.event_ts, np.extracted_phone, 'phone'
FROM t3_notes_phones np
JOIN job_events j ON np.jobnumber = j.event_id
WHERE np.extracted_phone != COALESCE(j.id_phone, '')
  AND np.extracted_phone != COALESCE(j.norm_client_phone, '')
  AND np.extracted_phone != COALESCE(j.contact_mobile, '')
  AND np.extracted_phone != COALESCE(j.site_phone, '')
  AND np.extracted_phone != COALESCE(j.desc_phone, '')
  AND np.extracted_phone != COALESCE(j.callerid_phone, '')
  AND np.extracted_phone != COALESCE(j.t3_desc_phone, '')
UNION ALL
-- WC-only events (third-stream nodes)
SELECT 'W', event_id, event_ts, phone, 'phone' FROM wc_events WHERE phone IS NOT NULL
UNION ALL
SELECT 'W', event_id, event_ts, email, 'email' FROM wc_events WHERE email IS NOT NULL;

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
  AND desc_email IS NULL
  AND callerid_phone IS NULL
UNION DISTINCT
-- Anonymous WC events (no phone, no email) — standalone singletons
SELECT CONCAT('W-', event_id) FROM wc_events WHERE phone IS NULL AND email IS NULL;

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
  ) ORDER BY s.event_ts LIMIT 1)[OFFSET(0)] AS first_event,
  -- All WC-linked events in the cluster from the spine (lossless record)
  ARRAY_AGG(
    IF(s.wc_lead_id IS NOT NULL,
      STRUCT(
        s.wc_lead_id,
        s.source,
        s.medium,
        s.keyword,
        s.campaign,
        s.channel,
        s.event_ts
      ), NULL)
    IGNORE NULLS ORDER BY s.event_ts
  ) AS wc_leads
FROM r5
JOIN spine_events s ON r5.eid = CONCAT('S-', s.event_id)
GROUP BY r5.comp;

-- WC-only events per component (third-stream nodes not already in spine)
CREATE TEMP TABLE comp_wc AS
SELECT r5.comp,
  COUNT(*) AS wc_event_count,
  -- WC leads from third-stream nodes (for merging into wc_leads array)
  ARRAY_AGG(STRUCT(
    w.wc_lead_id,
    w.source,
    w.medium,
    w.keyword,
    w.campaign,
    w.channel,
    w.event_ts
  ) ORDER BY w.event_ts) AS wc_only_leads,
  -- First WC event metadata (for WC-seeded opps with no spine events)
  ARRAY_AGG(STRUCT(
    w.phone, w.email, w.profile, w.contact_name, w.event_ts,
    w.source, w.medium, w.keyword, w.campaign, w.channel, w.lead_type
  ) ORDER BY w.event_ts LIMIT 1)[OFFSET(0)] AS first_wc_event
FROM r5
JOIN wc_events w ON r5.eid = CONCAT('W-', w.event_id)
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

-- Timestamps: include spine, job, AND WC event timestamps
CREATE TEMP TABLE comp_ts AS
SELECT r5.comp, MIN(
  CASE
    WHEN r5.eid LIKE 'S-%' THEN s.event_ts
    WHEN r5.eid LIKE 'J-%' THEN j.event_ts
    WHEN r5.eid LIKE 'W-%' THEN w.event_ts
  END
) AS min_ts
FROM r5
LEFT JOIN spine_events s ON r5.eid = CONCAT('S-', s.event_id)
LEFT JOIN job_events j ON r5.eid = CONCAT('J-', j.event_id)
LEFT JOIN wc_events w ON r5.eid = CONCAT('W-', w.event_id)
GROUP BY r5.comp;

CREATE TEMP TABLE phone_first_job AS
SELECT phone, MIN(requested_date_parsed) AS first_job_date FROM (
  -- Client-level phones (already E.164)
  SELECT norm_client_mobile AS phone, requested_date_parsed FROM `pttr-taskdata.ds_aroflo.tasks_complete` WHERE norm_client_mobile IS NOT NULL AND norm_client_mobile != ''
  UNION ALL
  SELECT id_phone, requested_date_parsed FROM `pttr-taskdata.ds_aroflo.tasks_complete` WHERE id_phone IS NOT NULL AND id_phone != ''
  UNION ALL
  -- Contact-level phones (raw AU format → normalize to E.164)
  SELECT
    CONCAT('+61', SUBSTR(REGEXP_REPLACE(cd.mobile, r'[^0-9]', ''), 2)) AS phone,
    tc.requested_date_parsed
  FROM `pttr-taskdata.ds_aroflo.contacts_deduped` cd
  JOIN `pttr-taskdata.ds_aroflo.tasks_deduped` td ON cd.userid = td.contact_userid
  JOIN `pttr-taskdata.ds_aroflo.tasks_complete` tc ON td.jobnumber = tc.jobnumber
  WHERE cd.mobile IS NOT NULL AND cd.mobile != ''
    AND REGEXP_REPLACE(cd.mobile, r'[^0-9]', '') LIKE '04%'
    AND LENGTH(REGEXP_REPLACE(cd.mobile, r'[^0-9]', '')) = 10
  UNION ALL
  SELECT
    CONCAT('+61', SUBSTR(REGEXP_REPLACE(cd.phone, r'[^0-9]', ''), 2)) AS phone,
    tc.requested_date_parsed
  FROM `pttr-taskdata.ds_aroflo.contacts_deduped` cd
  JOIN `pttr-taskdata.ds_aroflo.tasks_deduped` td ON cd.userid = td.contact_userid
  JOIN `pttr-taskdata.ds_aroflo.tasks_complete` tc ON td.jobnumber = tc.jobnumber
  WHERE cd.phone IS NOT NULL AND cd.phone != ''
    AND (REGEXP_REPLACE(cd.phone, r'[^0-9]', '') LIKE '02%'
      OR REGEXP_REPLACE(cd.phone, r'[^0-9]', '') LIKE '03%'
      OR REGEXP_REPLACE(cd.phone, r'[^0-9]', '') LIKE '04%'
      OR REGEXP_REPLACE(cd.phone, r'[^0-9]', '') LIKE '07%'
      OR REGEXP_REPLACE(cd.phone, r'[^0-9]', '') LIKE '08%')
    AND LENGTH(REGEXP_REPLACE(cd.phone, r'[^0-9]', '')) = 10
) GROUP BY phone;

-- ====== STEP 6: Materialize final table ======
-- Attribution logic:
--   1. WC primacy (§8a.1): when wc_leads has entries, ALL primary attribution
--      (source/medium/campaign/keyword) comes from the first WC touch — never
--      from first_event. This fixes the Frankenstein-row bug.
--   2. Attribution tiers (§8a.2) for opps with NO WC touches:
--      a. Quinn form (any) → google/cpc
--      b. WPForms → organic
--      c. Direct DID / jobs_email → existing tags (channel-level)
--   3. Attribution-as-a-unit: all fields from the SAME array element or tier.
CREATE OR REPLACE TABLE `pttr-taskdata.ds_crm.opportunities` AS
WITH all_comps AS (SELECT DISTINCT comp FROM r5),
-- Merge wc_leads arrays: spine-matched WC events + third-stream WC-only events
merged_wc AS (
  SELECT
    ac.comp,
    ARRAY(
      SELECT AS STRUCT wc_lead_id, source, medium, keyword, campaign, channel, event_ts
      FROM (
        SELECT * FROM UNNEST(COALESCE(cs.wc_leads,
          ARRAY<STRUCT<wc_lead_id INT64, source STRING, medium STRING, keyword STRING, campaign STRING, channel STRING, event_ts TIMESTAMP>>[]))
        UNION ALL
        SELECT * FROM UNNEST(COALESCE(cw.wc_only_leads,
          ARRAY<STRUCT<wc_lead_id INT64, source STRING, medium STRING, keyword STRING, campaign STRING, channel STRING, event_ts TIMESTAMP>>[]))
      )
      ORDER BY event_ts
    ) AS all_wc_leads
  FROM all_comps ac
  LEFT JOIN comp_spine cs ON ac.comp = cs.comp
  LEFT JOIN comp_wc cw ON ac.comp = cw.comp
)
SELECT
  CASE
    WHEN cj.jobnumber IS NOT NULL THEN CONCAT('J-', cj.jobnumber)
    ELSE CONCAT('G-', TO_HEX(MD5(CONCAT(ac.comp, '|',
      COALESCE(cc.matched_phones, ''), '|', COALESCE(cc.matched_emails, '')))))
  END AS opportunity_id,
  -- phone: spine first, then WC-seeded, then matched_phones
  COALESCE(
    cs.first_event.phone,
    cw.first_wc_event.phone,
    SPLIT(cc.matched_phones, ',')[SAFE_OFFSET(0)]
  ) AS phone,
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
    WHEN cs.comp IS NULL AND cw.comp IS NULL THEN 'no_inbound'
    WHEN cj.jobnumber IS NOT NULL THEN 'job_matched'
    ELSE 'gap_based'
  END AS opp_type,
  COALESCE(cs.first_event.is_business_hours,
    CASE WHEN cw.first_wc_event IS NOT NULL THEN
      EXTRACT(HOUR FROM DATETIME(cw.first_wc_event.event_ts, 'Australia/Sydney')) BETWEEN 7 AND 17
    END
  ) AS is_business_hours,
  -- Attribution source tag
  CASE
    WHEN ARRAY_LENGTH(mw.all_wc_leads) > 0 THEN 'whatconverts'
    WHEN cs.first_event.attribution_source IS NOT NULL THEN cs.first_event.attribution_source
    WHEN cw.comp IS NOT NULL THEN 'whatconverts'
    ELSE 'direct_booking'
  END AS attribution_source,
  -- === ATTRIBUTION: WC primacy + tiered defaults ===
  -- Channel
  CASE
    WHEN ARRAY_LENGTH(mw.all_wc_leads) > 0 THEN COALESCE(mw.all_wc_leads[OFFSET(0)].channel, cs.first_event.channel)
    WHEN cs.first_event.attribution_source = 'quinn_lp' THEN cs.first_event.channel
    WHEN cs.first_event.attribution_source = 'email_form' AND cs.first_event.channel = 'Organic - Landing Page' THEN 'Paid Search (Quinn LP)'
    WHEN cs.first_event.attribution_source = 'email_form' AND cs.first_event.channel = 'Website Form' THEN 'Organic - Website Form'
    WHEN cs.first_event.channel IS NOT NULL THEN cs.first_event.channel
    WHEN cw.first_wc_event IS NOT NULL THEN cw.first_wc_event.channel
    ELSE 'Direct Booking'
  END AS channel,
  -- Source: WC primacy → Quinn=google → WPForms=organic → existing
  CASE
    WHEN ARRAY_LENGTH(mw.all_wc_leads) > 0 THEN mw.all_wc_leads[OFFSET(0)].source
    WHEN cs.first_event.attribution_source = 'quinn_lp' THEN 'google'
    WHEN cs.first_event.attribution_source = 'email_form' AND cs.first_event.channel = 'Organic - Landing Page' THEN 'google'
    WHEN cs.first_event.attribution_source = 'email_form' AND cs.first_event.channel = 'Website Form' THEN 'organic'
    WHEN cs.first_event.source IS NOT NULL THEN cs.first_event.source
    WHEN cw.first_wc_event IS NOT NULL THEN cw.first_wc_event.source
    ELSE 'direct'
  END AS source,
  -- Medium
  CASE
    WHEN ARRAY_LENGTH(mw.all_wc_leads) > 0 THEN mw.all_wc_leads[OFFSET(0)].medium
    WHEN cs.first_event.attribution_source = 'quinn_lp' THEN 'cpc'
    WHEN cs.first_event.attribution_source = 'email_form' AND cs.first_event.channel = 'Organic - Landing Page' THEN 'cpc'
    WHEN cs.first_event.attribution_source = 'email_form' AND cs.first_event.channel = 'Website Form' THEN '(none)'
    WHEN cs.first_event.medium IS NOT NULL THEN cs.first_event.medium
    WHEN cw.first_wc_event IS NOT NULL THEN cw.first_wc_event.medium
    ELSE '(none)'
  END AS medium,
  -- Campaign: from same attribution unit
  CASE
    WHEN ARRAY_LENGTH(mw.all_wc_leads) > 0 THEN mw.all_wc_leads[OFFSET(0)].campaign
    WHEN cs.first_event.attribution_source IN ('quinn_lp', 'email_form') THEN cs.first_event.campaign
    WHEN cs.first_event.campaign IS NOT NULL THEN cs.first_event.campaign
    WHEN cw.first_wc_event IS NOT NULL THEN cw.first_wc_event.campaign
    ELSE NULL
  END AS campaign,
  -- Keyword: from same attribution unit
  CASE
    WHEN ARRAY_LENGTH(mw.all_wc_leads) > 0 THEN mw.all_wc_leads[OFFSET(0)].keyword
    WHEN cs.first_event.attribution_source IN ('quinn_lp', 'email_form') THEN cs.first_event.keyword
    WHEN cs.first_event.keyword IS NOT NULL THEN cs.first_event.keyword
    WHEN cw.first_wc_event IS NOT NULL THEN cw.first_wc_event.keyword
    ELSE NULL
  END AS keyword,
  -- Profile
  COALESCE(cs.first_event.profile, cw.first_wc_event.profile) AS profile,
  -- Primary WC lead: first-touch among ALL WC events (merged array, swappable)
  mw.all_wc_leads[SAFE_OFFSET(0)].wc_lead_id AS wc_lead_id,
  -- Full merged set of WC leads in this cluster (lossless)
  mw.all_wc_leads AS wc_leads,
  cs.first_event.direct_subtype,
  cs.first_event.queue_ext,
  cs.first_event.queue_name,
  COALESCE(cs.first_event.contact_name, cw.first_wc_event.contact_name) AS contact_name,
  cc.matched_phones,
  cc.matched_emails,
  -- is_no_inbound_enquiry: no spine events AND no WC events (job-only)
  (cs.comp IS NULL AND cw.comp IS NULL) AS is_no_inbound_enquiry,
  COALESCE(cs.has_answered_call, FALSE) AS has_answered_call,
  FALSE AS is_existing_customer,
  -- Third-stream tagging
  CASE
    WHEN cs.comp IS NULL AND cw.comp IS NOT NULL THEN 'whatconverts'
    ELSE NULL
  END AS origination_source,
  CASE
    WHEN cs.comp IS NULL AND cw.comp IS NOT NULL
      AND cw.first_wc_event.phone IS NULL AND cw.first_wc_event.email IS NULL
      THEN 'anonymous'
    ELSE NULL
  END AS identity
FROM all_comps ac
JOIN comp_ts ct ON ac.comp = ct.comp
LEFT JOIN comp_contacts cc ON ac.comp = cc.comp
LEFT JOIN comp_spine cs ON ac.comp = cs.comp
LEFT JOIN comp_wc cw ON ac.comp = cw.comp
LEFT JOIN comp_jobs cj ON ac.comp = cj.comp
LEFT JOIN merged_wc mw ON ac.comp = mw.comp;

-- Post-hoc: set is_existing_customer via phone lookup
UPDATE `pttr-taskdata.ds_crm.opportunities` o
SET is_existing_customer = TRUE
WHERE EXISTS (
  SELECT 1 FROM phone_first_job pfj
  WHERE pfj.phone = o.phone
    AND pfj.first_job_date < DATE(o.opportunity_timestamp_sydney)
);
