-- BigQuery View Definitions Backup
-- Updated: 2026-06-04T03:00:28.643Z

-- View: ds_crm.vw_account_locations
CREATE OR REPLACE VIEW `pttr-taskdata.ds_crm.vw_account_locations` AS
WITH account_ids AS (
  SELECT clientid AS account_id
  FROM `pttr-taskdata.ds_aroflo.clients_deduped`
  WHERE terms = '30 Days'
),

location_jobs AS (
  SELECT
    td.client_clientid     AS account_id,
    td.location_locationid AS location_id,
    COUNT(DISTINCT tc.jobnumber) AS jobs_total,
    COUNT(DISTINCT IF(
      PARSE_DATE('%Y/%m/%d', tc.requested_date) >= DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH),
      tc.jobnumber, NULL)) AS jobs_l12m,
    ROUND(SUM(SAFE_CAST(tc.task_invoices_total_ex AS NUMERIC)), 2) AS revenue_total,
    ROUND(SUM(IF(
      PARSE_DATE('%Y/%m/%d', tc.requested_date) >= DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH),
      SAFE_CAST(tc.task_invoices_total_ex AS NUMERIC), 0)), 2) AS revenue_l12m,
    COUNT(DISTINCT IF(
      tc.status NOT IN ('Completed', 'Archived'),
      tc.jobnumber, NULL)) AS open_jobs,
    MAX(PARSE_DATE('%Y/%m/%d', tc.requested_date)) AS last_job_date
  FROM `pttr-taskdata.ds_aroflo.tasks_complete` tc
  JOIN `pttr-taskdata.ds_aroflo.tasks_deduped` td ON tc.jobnumber = td.jobnumber
  WHERE td.client_clientid IN (SELECT account_id FROM account_ids)
    AND td.location_locationid IS NOT NULL
  GROUP BY 1, 2
),

location_top_contact AS (
  SELECT
    client_clientid AS account_id,
    location_locationid AS location_id,
    ARRAY_AGG(contactname ORDER BY job_count DESC LIMIT 1)[OFFSET(0)] AS primary_contact
  FROM (
    SELECT client_clientid, location_locationid, contactname, COUNT(*) AS job_count
    FROM `pttr-taskdata.ds_aroflo.tasks_deduped`
    WHERE client_clientid IN (SELECT account_id FROM account_ids)
      AND location_locationid IS NOT NULL
      AND contactname IS NOT NULL AND contactname != ''
    GROUP BY 1, 2, 3
  )
  GROUP BY 1, 2
)

SELECT
  ai.account_id,
  c.clientname         AS account_name,
  ld.locationid        AS location_id,
  ld.locationname      AS location_name,
  CONCAT(COALESCE(ld.suburb, ''),
    IF(COALESCE(ld.state, '') != '', CONCAT(', ', ld.state), ''),
    IF(COALESCE(ld.postcode, '') != '', CONCAT(' ', ld.postcode), '')) AS address,
  CONCAT(ld.locationname, ', ', INITCAP(COALESCE(ld.suburb, '')), ', ', COALESCE(ld.state, ''), ' ', COALESCE(ld.postcode, '')) AS full_address,
  COALESCE(ld.suburb, '')    AS suburb,
  COALESCE(ld.state, '')     AS state,
  COALESCE(ld.postcode, '')  AS postcode,
  COALESCE(lj.jobs_total, 0)     AS jobs_total,
  COALESCE(lj.jobs_l12m, 0)     AS jobs_l12m,
  COALESCE(lj.revenue_total, 0) AS revenue_total,
  COALESCE(lj.revenue_l12m, 0)  AS revenue_l12m,
  RANK() OVER (PARTITION BY ai.account_id ORDER BY COALESCE(lj.revenue_total, 0) DESC) AS location_rank,
  COALESCE(lj.open_jobs, 0)     AS open_jobs,
  lj.last_job_date,
  COALESCE(ltc.primary_contact, '') AS primary_contact,
  ld.SiteContact   AS site_contact,
  ld.SitePhone     AS site_phone,
  ld.SiteEmail     AS site_email
FROM account_ids ai
JOIN `pttr-taskdata.ds_aroflo.clients_deduped` c
  ON ai.account_id = c.clientid
JOIN `pttr-taskdata.ds_aroflo.locations_deduped` ld
  ON ld.linkedto_linkedtoid = ai.account_id
  AND ld.linkedto_linkedtotype = 'client'
LEFT JOIN location_jobs lj
  ON lj.account_id = ai.account_id
  AND lj.location_id = ld.locationid
LEFT JOIN location_top_contact ltc
  ON ltc.account_id = ai.account_id
  AND ltc.location_id = ld.locationid;

-- View: ds_crm.vw_accounts
CREATE OR REPLACE VIEW `pttr-taskdata.ds_crm.vw_accounts` AS
WITH -- Infer original category for Do Not Trade clients
dnt_job_types AS (
  SELECT
    td.client_clientid AS clientid,
    COUNTIF(tc.customer_type = 'Account') AS account_jobs,
    COUNTIF(tc.customer_type != 'Account' OR tc.customer_type IS NULL) AS non_account_jobs
  FROM `pttr-taskdata.ds_aroflo.clients_deduped` c
  JOIN `pttr-taskdata.ds_aroflo.tasks_deduped` td ON c.clientid = td.client_clientid
  JOIN `pttr-taskdata.ds_aroflo.tasks_complete` tc ON td.jobnumber = tc.jobnumber
  WHERE c.terms = 'Do Not Trade'
  GROUP BY 1
),

job_stats AS (
  SELECT
    td.client_clientid AS account_id,
    COUNT(DISTINCT tc.jobnumber) AS total_jobs,
    ROUND(SUM(SAFE_CAST(tc.task_invoices_total_ex AS NUMERIC)), 2) AS total_revenue,
    COUNT(DISTINCT IF(
      PARSE_DATE('%Y/%m/%d', tc.requested_date) >= DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH),
      tc.jobnumber, NULL)) AS jobs_l12m,
    ROUND(SUM(IF(
      PARSE_DATE('%Y/%m/%d', tc.requested_date) >= DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH),
      SAFE_CAST(tc.task_invoices_total_ex AS NUMERIC), 0)), 2) AS revenue_l12m,
    COUNT(DISTINCT IF(
      tc.status NOT IN ('Completed', 'Archived'),
      tc.jobnumber, NULL)) AS open_jobs,
    MAX(PARSE_DATE('%Y/%m/%d', tc.requested_date)) AS last_activity
  FROM `pttr-taskdata.ds_aroflo.tasks_complete` tc
  JOIN `pttr-taskdata.ds_aroflo.tasks_deduped` td ON tc.jobnumber = td.jobnumber
  GROUP BY 1
),

contact_counts AS (
  SELECT client_clientid AS account_id,
         COUNT(DISTINCT contactname) AS contacts_count
  FROM `pttr-taskdata.ds_aroflo.tasks_deduped`
  WHERE contactname IS NOT NULL AND contactname != ''
  GROUP BY 1
),

top_contacts AS (
  SELECT
    client_clientid AS account_id,
    ARRAY_AGG(contactname ORDER BY job_count DESC LIMIT 1)[OFFSET(0)] AS top_contact_name
  FROM (
    SELECT client_clientid, contactname, COUNT(*) AS job_count
    FROM `pttr-taskdata.ds_aroflo.tasks_deduped`
    WHERE contactname IS NOT NULL AND contactname != ''
    GROUP BY 1, 2
  )
  GROUP BY 1
),

location_counts AS (
  SELECT linkedto_linkedtoid AS account_id,
         COUNT(DISTINCT locationid) AS locations_count
  FROM `pttr-taskdata.ds_aroflo.locations_deduped`
  WHERE linkedto_linkedtotype = 'client'
  GROUP BY 1
)

SELECT
  c.clientid           AS account_id,
  c.clientname         AS account_name,
  c.terms = 'Do Not Trade'  AS is_do_not_trade,
  CASE
    WHEN c.terms = '30 Days' THEN 'Account'
    WHEN c.terms = 'COD'     THEN 'COD'
    WHEN c.terms = 'Do Not Trade' THEN
      CASE
        WHEN COALESCE(c.abn, '') != '' THEN 'Account (inferred)'
        WHEN COALESCE(dnt.account_jobs, 0) > COALESCE(dnt.non_account_jobs, 0) THEN 'Account (inferred)'
        ELSE 'COD (inferred)'
      END
    ELSE 'Other'
  END                        AS client_category,
  COALESCE(cc.contacts_count, 0)     AS contacts_count,
  COALESCE(lc.locations_count, 0)    AS locations_count,
  COALESCE(tcn.top_contact_name, '') AS top_contact_name,
  COALESCE(js.total_jobs, 0)        AS total_jobs,
  COALESCE(js.total_revenue, 0)     AS total_revenue,
  COALESCE(js.jobs_l12m, 0)         AS jobs_l12m,
  COALESCE(js.revenue_l12m, 0)      AS revenue_l12m,
  RANK() OVER (ORDER BY COALESCE(js.total_revenue, 0) DESC) AS rank,
  COALESCE(js.open_jobs, 0)         AS open_jobs,
  js.last_activity,
  c.abn,
  c.phone,
  c.fax,
  c.email,
  c.address_addressline1,
  c.address_addressline2,
  c.address_suburb,
  c.address_state,
  c.address_postcode,
  c.notes,
  TRIM(CONCAT(COALESCE(c.firstname, ''), ' ', COALESCE(c.surname, ''))) AS primary_contact,
  c.datecreated,
  c.website
FROM `pttr-taskdata.ds_aroflo.clients_deduped` c
LEFT JOIN dnt_job_types dnt   ON c.clientid = dnt.clientid
LEFT JOIN job_stats js        ON c.clientid = js.account_id
LEFT JOIN contact_counts cc   ON c.clientid = cc.account_id
LEFT JOIN top_contacts tcn    ON c.clientid = tcn.account_id
LEFT JOIN location_counts lc  ON c.clientid = lc.account_id
WHERE c.terms = '30 Days'
   OR (c.terms = 'Do Not Trade'
       AND (COALESCE(c.abn, '') != ''
         OR COALESCE(dnt.account_jobs, 0) > COALESCE(dnt.non_account_jobs, 0)));

-- View: ds_crm.vw_clients
CREATE OR REPLACE VIEW `pttr-taskdata.ds_crm.vw_clients` AS
WITH job_stats AS (
  SELECT
    td.client_clientid AS client_id,
    ARRAY_AGG(tc.customer_type ORDER BY tc.requested_date DESC LIMIT 1)[OFFSET(0)] AS client_type,
    COUNT(DISTINCT IF(
      PARSE_DATE('%Y/%m/%d', tc.requested_date) >= DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH),
      tc.jobnumber, NULL)) AS jobs_l12m,
    ROUND(SUM(IF(
      PARSE_DATE('%Y/%m/%d', tc.requested_date) >= DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH),
      SAFE_CAST(tc.task_invoices_total_ex AS NUMERIC), 0)), 2) AS revenue_l12m,
    COUNT(DISTINCT IF(
      tc.status NOT IN ('Completed','Archived'),
      tc.jobnumber, NULL)) AS open_jobs,
    MAX(PARSE_DATE('%Y/%m/%d', tc.requested_date)) AS last_job_date
  FROM `pttr-taskdata.ds_aroflo.tasks_complete` tc
  JOIN `pttr-taskdata.ds_aroflo.tasks_deduped` td ON tc.jobnumber = td.jobnumber
  GROUP BY 1
)
SELECT
  c.clientid   AS client_id,
  c.clientname AS client_name,
  COALESCE(js.client_type, 'COD') AS client_type,
  COALESCE(c.address_suburb, '') AS suburb,
  c.phone,
  c.mobile,
  c.email,
  COALESCE(js.jobs_l12m, 0)      AS jobs_l12m,
  COALESCE(js.revenue_l12m, 0)   AS revenue_l12m,
  COALESCE(js.open_jobs, 0)      AS open_jobs,
  js.last_job_date
FROM `pttr-taskdata.ds_aroflo.clients_deduped` c
LEFT JOIN job_stats js ON c.clientid = js.client_id;

-- View: ds_crm.vw_contact_timeline
CREATE OR REPLACE VIEW `pttr-taskdata.ds_crm.vw_contact_timeline` AS
WITH account_ids AS (
  SELECT DISTINCT td.client_clientid AS account_id
  FROM `pttr-taskdata.ds_aroflo.tasks_complete` tc
  JOIN `pttr-taskdata.ds_aroflo.tasks_deduped` td ON tc.jobnumber = td.jobnumber
  WHERE tc.customer_type = 'Account'
),

-- Jobs for individual contacts
individual_jobs AS (
  SELECT
    td.client_clientid AS contact_id,
    c.clientname       AS contact_name,
    CAST(NULL AS STRING) AS account_id,
    'job'              AS event_type,
    PARSE_DATE('%Y/%m/%d', tc.requested_date) AS event_date,
    CONCAT(tc.jobnumber, ' — ', tc.task) AS event_description,
    tc.status          AS event_status,
    SAFE_CAST(tc.task_invoices_total_ex AS NUMERIC) AS event_amount,
    COALESCE(c.mobile, c.phone) AS phone,
    c.email
  FROM `pttr-taskdata.ds_aroflo.tasks_complete` tc
  JOIN `pttr-taskdata.ds_aroflo.tasks_deduped` td ON tc.jobnumber = td.jobnumber
  JOIN `pttr-taskdata.ds_aroflo.clients_deduped` c ON td.client_clientid = c.clientid
  WHERE td.client_clientid NOT IN (SELECT account_id FROM account_ids)
),

-- Jobs for strata reps (keyed by fingerprint of account_id|contactname)
strata_jobs AS (
  SELECT
    CAST(FARM_FINGERPRINT(CONCAT(td.client_clientid, '|', td.contactname)) AS STRING) AS contact_id,
    td.contactname     AS contact_name,
    td.client_clientid AS account_id,
    'job'              AS event_type,
    PARSE_DATE('%Y/%m/%d', tc.requested_date) AS event_date,
    CONCAT(tc.jobnumber, ' — ', tc.task) AS event_description,
    tc.status          AS event_status,
    SAFE_CAST(tc.task_invoices_total_ex AS NUMERIC) AS event_amount,
    CAST(NULL AS STRING) AS phone,
    CAST(NULL AS STRING) AS email
  FROM `pttr-taskdata.ds_aroflo.tasks_complete` tc
  JOIN `pttr-taskdata.ds_aroflo.tasks_deduped` td ON tc.jobnumber = td.jobnumber
  WHERE td.client_clientid IN (SELECT account_id FROM account_ids)
    AND td.contactname IS NOT NULL AND td.contactname != ''
),

-- Normalised contact phones for call matching
contact_phones AS (
  SELECT
    c.clientid AS contact_id,
    c.clientname AS contact_name,
    c.email,
    CONCAT('+61', SUBSTR(REGEXP_REPLACE(COALESCE(c.mobile, ''), r'[^0-9]', ''), 2)) AS norm_phone
  FROM `pttr-taskdata.ds_aroflo.clients_deduped` c
  WHERE c.clientid NOT IN (SELECT account_id FROM account_ids)
    AND REGEXP_REPLACE(COALESCE(c.mobile, ''), r'[^0-9]', '') != ''
),

-- Calls matched to contacts via phone
calls AS (
  SELECT
    cp.contact_id,
    cp.contact_name,
    CAST(NULL AS STRING) AS account_id,
    'call'             AS event_type,
    DATE(rc.start_time) AS event_date,
    CONCAT(rc.direction, ' — ',
           COALESCE(rc.last_leg_disposition, ''),
           ' (', COALESCE(rc.talk_time, ''), ')') AS event_description,
    rc.last_leg_disposition AS event_status,
    CAST(NULL AS NUMERIC)   AS event_amount,
    cp.norm_phone      AS phone,
    cp.email
  FROM `pttr-taskdata.ds_crm.raw_calls` rc
  JOIN contact_phones cp
    ON rc.norm_caller_phone = cp.norm_phone
    OR rc.norm_callee_phone = cp.norm_phone
),

-- Normalised contact emails for email matching
contact_emails AS (
  SELECT
    c.clientid AS contact_id,
    c.clientname AS contact_name,
    COALESCE(c.mobile, c.phone) AS phone,
    LOWER(TRIM(c.email)) AS norm_email
  FROM `pttr-taskdata.ds_aroflo.clients_deduped` c
  WHERE c.clientid NOT IN (SELECT account_id FROM account_ids)
    AND COALESCE(TRIM(c.email), '') != ''
),

-- Emails received from contacts
emails_in AS (
  SELECT
    ce.contact_id,
    ce.contact_name,
    CAST(NULL AS STRING) AS account_id,
    'email'            AS event_type,
    DATE(e.received_at) AS event_date,
    CONCAT('Received — ', COALESCE(e.subject, '')) AS event_description,
    'received'         AS event_status,
    CAST(NULL AS NUMERIC) AS event_amount,
    ce.phone,
    ce.norm_email      AS email
  FROM `pttr-taskdata.ds_crm.raw_emails_received` e
  JOIN contact_emails ce ON LOWER(TRIM(e.from_email)) = ce.norm_email
),

-- Emails sent to contacts
emails_out AS (
  SELECT
    ce.contact_id,
    ce.contact_name,
    CAST(NULL AS STRING) AS account_id,
    'email'            AS event_type,
    DATE(e.received_at) AS event_date,
    CONCAT('Sent — ', COALESCE(e.subject, '')) AS event_description,
    'sent'             AS event_status,
    CAST(NULL AS NUMERIC) AS event_amount,
    ce.phone,
    ce.norm_email      AS email
  FROM `pttr-taskdata.ds_crm.raw_emails_sent` e
  JOIN contact_emails ce ON LOWER(TRIM(e.to_email)) = ce.norm_email
)

SELECT * FROM individual_jobs
UNION ALL
SELECT * FROM strata_jobs
UNION ALL
SELECT * FROM calls
UNION ALL
SELECT * FROM emails_in
UNION ALL
SELECT * FROM emails_out;

-- View: ds_crm.vw_contacts
CREATE OR REPLACE VIEW `pttr-taskdata.ds_crm.vw_contacts` AS

WITH account_ids AS (
  SELECT clientid AS account_id
  FROM `pttr-taskdata.ds_aroflo.clients_deduped`
  WHERE terms = '30 Days'
),

account_names AS (
  SELECT clientid AS account_id, clientname AS account_name
  FROM `pttr-taskdata.ds_aroflo.clients_deduped`
  WHERE terms = '30 Days'
),

staff_names AS (
  SELECT name FROM UNNEST([
    'Mario Cardona', 'Katrina Oudejans', 'Aaron Marsden',
    'Andrew Tingley', 'Frances Baker', 'Tim Cook',
    'Donna Carey', 'Alex Mitchell', 'William Cook',
    'Bob Brown', 'Lara Davis'
  ]) AS name
),

individual_stats AS (
  SELECT
    td.client_clientid AS contact_id,
    COUNT(DISTINCT IF(
      PARSE_DATE('%Y/%m/%d', tc.requested_date) >= DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH),
      tc.jobnumber, NULL)) AS jobs_l12m,
    ROUND(SUM(IF(
      PARSE_DATE('%Y/%m/%d', tc.requested_date) >= DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH),
      SAFE_CAST(tc.task_invoices_total_ex AS NUMERIC), 0)), 2) AS revenue_l12m,
    COUNT(DISTINCT IF(
      tc.status NOT IN ('Completed', 'Archived'),
      tc.jobnumber, NULL)) AS open_jobs,
    MAX(PARSE_DATE('%Y/%m/%d', tc.requested_date)) AS last_job_date
  FROM `pttr-taskdata.ds_aroflo.tasks_complete` tc
  JOIN `pttr-taskdata.ds_aroflo.tasks_deduped` td ON tc.jobnumber = td.jobnumber
  WHERE td.client_clientid NOT IN (SELECT account_id FROM account_ids)
  GROUP BY 1
),

individuals AS (
  SELECT
    c.clientid   AS contact_id,
    c.clientname AS contact_name,
    CASE
      WHEN c.terms = 'Do Not Trade' THEN 'do_not_trade'
      WHEN ist.jobs_l12m > 0        THEN 'residential'
      ELSE 'cod'
    END          AS contact_type,
    CAST(NULL AS STRING) AS account_id,
    CAST(NULL AS STRING) AS account_name,
    c.phone,
    c.mobile,
    c.email,
    COALESCE(c.address_suburb, '') AS suburb,
    COALESCE(ist.jobs_l12m, 0)    AS jobs_l12m,
    COALESCE(ist.revenue_l12m, 0) AS revenue_l12m,
    COALESCE(ist.open_jobs, 0)    AS open_jobs,
    ist.last_job_date
  FROM `pttr-taskdata.ds_aroflo.clients_deduped` c
  LEFT JOIN individual_stats ist ON c.clientid = ist.contact_id
  WHERE c.terms NOT IN ('30 Days')
    AND c.clientname NOT IN (SELECT account_name FROM account_names)
    -- Exclude PETTR staff by email domain
    AND (c.email IS NULL OR (
      LOWER(c.email) NOT LIKE '%@mrwasher.com.au'
      AND LOWER(c.email) NOT LIKE '%@pettr.com.au'
      AND LOWER(c.email) NOT LIKE '%@electriciantotherescue.com.au'
    ))
    -- Exclude known staff by name
    AND c.clientname NOT IN (SELECT name FROM staff_names)
),

strata_rep_stats AS (
  SELECT
    td.client_clientid AS account_id,
    td.contactname,
    COUNT(DISTINCT IF(
      PARSE_DATE('%Y/%m/%d', tc.requested_date) >= DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH),
      tc.jobnumber, NULL)) AS jobs_l12m,
    ROUND(SUM(IF(
      PARSE_DATE('%Y/%m/%d', tc.requested_date) >= DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH),
      SAFE_CAST(tc.task_invoices_total_ex AS NUMERIC), 0)), 2) AS revenue_l12m,
    COUNT(DISTINCT IF(
      tc.status NOT IN ('Completed', 'Archived'),
      tc.jobnumber, NULL)) AS open_jobs,
    MAX(PARSE_DATE('%Y/%m/%d', tc.requested_date)) AS last_job_date
  FROM `pttr-taskdata.ds_aroflo.tasks_complete` tc
  JOIN `pttr-taskdata.ds_aroflo.tasks_deduped` td ON tc.jobnumber = td.jobnumber
  WHERE td.client_clientid IN (SELECT account_id FROM account_ids)
    AND td.contactname IS NOT NULL AND td.contactname != ''
  GROUP BY 1, 2
),

strata_reps AS (
  SELECT
    CAST(FARM_FINGERPRINT(CONCAT(sr.account_id, '|', sr.contactname)) AS STRING) AS contact_id,
    sr.contactname   AS contact_name,
    'strata_rep'     AS contact_type,
    sr.account_id,
    an.account_name,
    CAST(NULL AS STRING) AS phone,
    CAST(NULL AS STRING) AS mobile,
    CAST(NULL AS STRING) AS email,
    ''               AS suburb,
    sr.jobs_l12m,
    sr.revenue_l12m,
    sr.open_jobs,
    sr.last_job_date
  FROM strata_rep_stats sr
  JOIN account_names an ON sr.account_id = an.account_id
  -- Exclude known staff from strata reps too
  WHERE sr.contactname NOT IN (SELECT name FROM staff_names)
)

SELECT * FROM individuals
UNION ALL
SELECT * FROM strata_reps
;

-- View: ds_crm.vw_lead_detail
CREATE OR REPLACE VIEW `pttr-taskdata.ds_crm.vw_lead_detail` AS

WITH lead_header AS (
  SELECT
    vl.lead_id,
    vl.lead_date,
    vl.lead_datetime,
    vl.channel,
    vl.profile,
    vl.contact_name,
    vl.phone_norm,
    vl.email,
    vl.suburb,
    vl.funnel_stage,
    vl.lead_class,
    vl.lead_status,
    vl.quotable,
    vl.is_booking,
    vl.is_converted_job,
    vl.business_hours_flag,
    vl.sales_value,
    vl.dnp_reason,
    vl.dnp_detail,
    vl.service_type,
    vl.notes,
    vl.call_transcription AS lead_call_transcription
  FROM `pttr-taskdata.ds_crm.vw_leads` vl
),

-- Job details via unified_leads.job_numbers
lead_jobs AS (
  SELECT
    ul.lead_id,
    tc.jobnumber AS job_number,
    tc.task_type AS job_type,
    tc.status AS job_status,
    SAFE_CAST(tc.task_invoices_total_ex AS NUMERIC) AS job_value,
    tc.completed_date AS job_completed_date
  FROM `pttr-taskdata.ds_crm.unified_leads` ul
  JOIN `pttr-taskdata.ds_aroflo.tasks_complete` tc
    ON ul.job_numbers = tc.jobnumber
  WHERE ul.job_numbers IS NOT NULL AND ul.job_numbers != ''
),

-- Operators from recordings (aggregated to avoid row multiplication)
recording_operators AS (
  SELECT
    call_id,
    STRING_AGG(DISTINCT operator_name, ', ' ORDER BY operator_name) AS operators
  FROM `pttr-taskdata.ds_crm.raw_recordings`
  WHERE operator_name IS NOT NULL AND operator_name != ''
  GROUP BY call_id
),

-- Interactions from lead_interactions enriched with raw_calls
interactions AS (
  SELECT
    li.lead_id,
    li.contact_datetime_sydney AS interaction_datetime,
    CASE
      WHEN li.contact_type = 'Phone' AND li.direction = 'Incoming' THEN 'Inbound Call'
      WHEN li.contact_type = 'Phone' THEN 'Outbound Call'
      WHEN li.contact_type = 'Email' AND li.direction = 'inbound' THEN 'Inbound Email'
      WHEN li.contact_type = 'Email' AND li.direction = 'outbound' THEN 'Outbound Email'
      ELSE CONCAT(COALESCE(li.contact_type, ''), ' ', COALESCE(li.direction, ''))
    END AS interaction_type,
    CASE
      WHEN li.contact_type = 'Phone' THEN
        LEFT(COALESCE(NULLIF(TRIM(li.contact_content), ''), ''), 300)
      ELSE
        COALESCE(NULLIF(TRIM(li.contact_subject), ''), LEFT(li.contact_content, 200))
    END AS interaction_summary,
    CASE
      WHEN li.contact_type = 'Phone' THEN
        COALESCE(
          NULLIF(TRIM(li.operator_name), ''),
          oe.operator_name,
          ro.operators,
          NULLIF(TRIM(ul.call_operators), '')
        )
      WHEN li.contact_type = 'Email' AND li.direction = 'inbound' THEN
        li.contact_to
      WHEN li.contact_type = 'Email' AND li.direction = 'outbound' THEN
        li.contact_from
      ELSE li.operator_name
    END AS interaction_operator,
    CASE
      WHEN li.contact_type = 'Phone' AND rc.talk_time IS NOT NULL
        AND REGEXP_CONTAINS(rc.talk_time, r'^\d{2}:\d{2}:\d{2}$') THEN
        CAST(SPLIT(rc.talk_time, ':')[OFFSET(0)] AS INT64) * 3600 +
        CAST(SPLIT(rc.talk_time, ':')[OFFSET(1)] AS INT64) * 60 +
        CAST(SPLIT(rc.talk_time, ':')[OFFSET(2)] AS INT64)
      ELSE NULL
    END AS interaction_duration_seconds
  FROM `pttr-taskdata.ds_crm.lead_interactions` li
  LEFT JOIN `pttr-taskdata.ds_crm.raw_calls` rc
    ON li.call_id = rc.call_id
    AND li.contact_type = 'Phone'
  LEFT JOIN `pttr-taskdata.ds_crm.unified_leads` ul
    ON li.lead_id = ul.lead_id
    AND li.contact_type = 'Phone'
  LEFT JOIN `pttr-taskdata.ds_crm.operator_extensions` oe
    ON rc.callee = oe.extension
    AND li.contact_type = 'Phone'
  LEFT JOIN recording_operators ro
    ON li.call_id = ro.call_id
    AND li.contact_type = 'Phone'
),

-- Speed to lead: minutes from lead creation to first outbound interaction AFTER lead was created
speed_to_lead AS (
  SELECT
    li.lead_id,
    MIN(li.contact_datetime) AS first_outbound_utc
  FROM `pttr-taskdata.ds_crm.lead_interactions` li
  WHERE ((li.contact_type = 'Email' AND li.direction = 'outbound')
     OR (li.contact_type = 'Phone' AND li.direction != 'Incoming'))
    AND li.contact_datetime >= TIMESTAMP(li.lead_created_syd, 'Australia/Sydney')
  GROUP BY 1
)

SELECT
  -- Lead header
  lh.lead_id,
  lh.lead_date,
  lh.lead_datetime,
  lh.channel,
  lh.profile,
  lh.contact_name,
  lh.phone_norm,
  lh.email,
  lh.suburb,
  lh.funnel_stage,
  lh.lead_class,
  lh.lead_status,
  lh.quotable,
  lh.is_booking,
  lh.is_converted_job,
  lh.business_hours_flag,
  lh.sales_value,
  lh.dnp_reason,
  lh.dnp_detail,
  lh.service_type,
  lh.notes,

  -- Speed to lead
  ROUND(TIMESTAMP_DIFF(stl.first_outbound_utc, TIMESTAMP(lh.lead_datetime, 'Australia/Sydney'), SECOND) / 60.0, 1) AS speed_to_lead_minutes,

  -- Job
  lj.job_number,
  lj.job_type,
  lj.job_status,
  lj.job_value,
  lj.job_completed_date,

  -- Interaction timeline
  i.interaction_datetime,
  DATE(i.interaction_datetime) AS interaction_date,
  FORMAT_DATETIME('%H:%M', i.interaction_datetime) AS interaction_time,
  i.interaction_type,
  CASE
    WHEN i.interaction_type IN ('Inbound Call', 'Outbound Call')
      AND COALESCE(i.interaction_summary, '') = ''
    THEN LEFT(lh.lead_call_transcription, 300)
    ELSE i.interaction_summary
  END AS interaction_summary,
  i.interaction_operator,
  i.interaction_duration_seconds

FROM lead_header lh
LEFT JOIN lead_jobs lj ON CAST(lh.lead_id AS INT64) = lj.lead_id
LEFT JOIN speed_to_lead stl ON CAST(lh.lead_id AS INT64) = stl.lead_id
LEFT JOIN interactions i ON CAST(lh.lead_id AS INT64) = i.lead_id
ORDER BY lh.lead_id, i.interaction_datetime ASC
;

-- View: ds_crm.vw_lead_email_timeline
CREATE OR REPLACE VIEW `pttr-taskdata.ds_crm.vw_lead_email_timeline` AS
WITH all_emails AS (
  SELECT received_at, from_email, to_email, subject, folder_name, 
         body_preview, body_text, message_id, conversation_id, 'inbound' as direction
  FROM `pttr-taskdata.ds_crm.raw_emails_received`
  UNION ALL
  SELECT received_at, from_email, to_email, subject, folder_name, 
         body_preview, body_text, message_id, conversation_id, 'outbound' as direction
  FROM `pttr-taskdata.ds_crm.raw_emails_sent`
  WHERE message_id NOT IN (SELECT message_id FROM `pttr-taskdata.ds_crm.raw_emails_received`)
),

-- All leads with an email address
leads AS (
  SELECT 
    lead_id,
    contact_name,
    date_created AS lead_created,
    lead_source,
    lead_medium,
    lead_type,
    lead_status,
    norm_email,
    norm_phone,
    id_combined_jobnumbers,
    has_jobs,
    has_sales,
    id_combined_sales
  FROM `pttr-taskdata.gd_WhatConverts.all_leads_enriched`
  WHERE norm_email IS NOT NULL
  AND norm_email != ''
  AND is_test_lead = FALSE
  AND duplicate = FALSE
  AND spam = FALSE
),

-- Step 1: direct email matches
direct_matches AS (
  SELECT 
    l.lead_id,
    e.conversation_id
  FROM leads l
  JOIN all_emails e
    ON LOWER(e.from_email) = l.norm_email
    OR LOWER(e.to_email) = l.norm_email
),

-- Step 2: all conversation IDs linked to each lead
lead_conversations AS (
  SELECT DISTINCT lead_id, conversation_id
  FROM direct_matches
),

-- Step 3: all emails in those conversations
conversation_emails AS (
  SELECT lc.lead_id, e.*
  FROM lead_conversations lc
  JOIN all_emails e ON e.conversation_id = lc.conversation_id
),

-- Step 4: combine direct matches and conversation thread matches, deduplicate
all_lead_emails AS (
  SELECT l.lead_id, e.*
  FROM leads l
  JOIN all_emails e
    ON LOWER(e.from_email) = l.norm_email
    OR LOWER(e.to_email) = l.norm_email
  UNION DISTINCT
  SELECT * FROM conversation_emails
)

SELECT
  l.lead_id,
  l.contact_name,
  l.lead_created,
  l.lead_source,
  l.lead_medium,
  l.lead_type,
  l.lead_status,
  l.norm_email,
  l.norm_phone,
  l.has_jobs,
  l.has_sales,
  l.id_combined_sales,
  l.id_combined_jobnumbers,
  e.received_at,
  e.direction,
  e.from_email,
  e.to_email,
  e.subject,
  e.folder_name,
  e.body_preview,
  e.body_text,
  e.message_id,
  e.conversation_id
FROM leads l
JOIN all_lead_emails e ON l.lead_id = e.lead_id
ORDER BY l.lead_id, e.received_at ASC;

-- View: ds_crm.vw_leads
CREATE OR REPLACE VIEW `pttr-taskdata.ds_crm.vw_leads` AS
WITH raw AS (
  SELECT
    al.*,
    REGEXP_REPLACE(COALESCE(al.caller_number, ''), r'[\s\-\(\)\.]', '') AS stripped_phone
  FROM `pttr-taskdata.gd_WhatConverts.all_leads_classified` al
  WHERE al.is_test_lead != 1
)

SELECT
  -- Identity
  r.lead_id,
  DATE(r.date_created_sydney) AS lead_date,
  r.date_created_sydney AS lead_datetime,

  -- Channel & Profile
  CASE
    WHEN r.lead_type = 'Phone Call' THEN 'Call'
    WHEN r.lead_type = 'Web Form' THEN 'Form'
    ELSE r.lead_type
  END AS channel,
  r.profile,

  -- Contact details
  INITCAP(
    CASE
      WHEN UPPER(TRIM(r.contact_name)) IN (
        'AUSTRALIA', 'INTERNATIONAL', 'NEW ZEALAND',
        'UNITED STATES', 'UNITED KINGDOM'
      ) THEN NULL
      WHEN TRIM(r.contact_name) = '' THEN NULL
      ELSE r.contact_name
    END
  ) AS contact_name,
  r.caller_number AS phone_raw,
  CASE
    WHEN r.stripped_phone LIKE '+61%' THEN r.stripped_phone
    WHEN REGEXP_CONTAINS(r.stripped_phone, r'^61[2-9]') THEN CONCAT('+', r.stripped_phone)
    WHEN REGEXP_CONTAINS(r.stripped_phone, r'^0[2-9]') THEN CONCAT('+61', SUBSTR(r.stripped_phone, 2))
    WHEN REGEXP_CONTAINS(r.stripped_phone, r'^[4][0-9]{8}$') THEN CONCAT('+61', r.stripped_phone)
    WHEN REGEXP_CONTAINS(r.stripped_phone, r'^[2378][0-9]{8}$') THEN CONCAT('+61', r.stripped_phone)
    WHEN REGEXP_CONTAINS(r.stripped_phone, r'^1[38]00') THEN r.stripped_phone
    ELSE NULLIF(r.stripped_phone, '')
  END AS phone_norm,
  COALESCE(
    NULLIF(TRIM(ul.norm_email), ''),
    NULLIF(TRIM(r.contact_email_address), ''),
    NULLIF(TRIM(r.email_address), ''),
    NULLIF(TRIM(r.form_my_email), ''),
    NULLIF(TRIM(JSON_VALUE(r.additional_fields_json, '$."My email is *"')), ''),
    NULLIF(TRIM(JSON_VALUE(r.additional_fields_json, '$."Email*"')), '')
  ) AS email,
  COALESCE(
    NULLIF(TRIM(r.city), ''),
    NULLIF(TRIM(r.form_my_address), '')
  ) AS suburb,

  -- Attribution
  r.lead_source,
  r.lead_medium,
  r.lead_campaign,
  r.lead_keyword,
  r.tracking_number,
  r.destination_number,

  -- Funnel classification
  r.lead_class,
  r.form_lead_status AS lead_status,
  r.form_reason_did_not_convert AS dnp_reason,
  r.form_reason_did_not_convert_detail AS dnp_detail,
  r.form_service_type AS service_type,

  -- Computed funnel stage
  CASE
    WHEN r.lead_class = 'Converted Job' THEN 'Paid Job'
    WHEN r.lead_class = 'Unconverted Booking' THEN 'Booked - Did Not Complete'
    WHEN r.lead_class = 'Pending Job' THEN 'Booked - Pending'
    WHEN r.lead_class = 'Pending' THEN 'Pending'
    WHEN r.lead_class = 'Did Not Proceed'
      AND r.form_reason_did_not_convert = 'Dropped Call' THEN 'Not Captured'
    WHEN r.lead_class = 'Did Not Proceed'
      AND r.form_reason_did_not_convert IN (
        'Service Not Offered', 'Out of Service Area',
        'Spam', 'Wrong Number', 'Customer Inquiry Only'
      ) THEN 'Not Quotable'
    WHEN r.lead_class = 'Did Not Proceed' THEN 'Not Booked'
    WHEN r.lead_class = 'Repeat' THEN 'Repeat'
    ELSE 'Unknown'
  END AS funnel_stage,

  -- Boolean flags
  LOWER(CAST(r.quotable AS STRING)) IN ('true', '1', 'yes') AS quotable,
  LOWER(CAST(r.is_booking AS STRING)) IN ('true', '1', 'yes') AS is_booking,
  LOWER(CAST(r.is_converted_job AS STRING)) IN ('true', '1', 'yes') AS is_converted_job,
  LOWER(CAST(r.is_pending_job AS STRING)) IN ('true', '1', 'yes') AS is_pending_job,
  LOWER(CAST(r.is_unbooked AS STRING)) IN ('true', '1', 'yes') AS is_unbooked,
  LOWER(CAST(r.is_repeat_lead AS STRING)) IN ('true', '1', 'yes') AS is_repeat_lead,
  LOWER(CAST(r.is_unique_lead AS STRING)) IN ('true', '1', 'yes') AS is_unique_lead,
  r.business_hours_flag,
  LOWER(CAST(r.duplicate AS STRING)) IN ('true', '1', 'yes') AS is_duplicate,
  LOWER(CAST(r.spam AS STRING)) IN ('true', '1', 'yes') AS is_spam,

  -- Call details
  r.call_duration_seconds,
  COALESCE(
    NULLIF(TRIM(r.call_transcription), ''),
    ul.full_transcript
  ) AS call_transcription,

  -- Financial
  SAFE_CAST(r.sales_value AS NUMERIC) AS sales_value,
  SAFE_CAST(r.quote_value AS NUMERIC) AS quote_value,

  -- Enrichment from unified_leads
  ul.call_count,
  ul.email_count,
  ul.has_jobs,
  ul.has_sales,
  ul.revenue AS total_revenue,

  -- Notes & metadata
  NULLIF(TRIM(r.notes), '') AS notes,
  r.last_updated

FROM raw r
LEFT JOIN `pttr-taskdata.ds_crm.unified_leads` ul
  ON CAST(r.lead_id AS INT64) = ul.lead_id
ORDER BY r.date_created_sydney DESC;

-- View: ds_crm.vw_leads_unified
CREATE OR REPLACE VIEW `pttr-taskdata.ds_crm.vw_leads_unified` AS
WITH
wc_calls AS (
  SELECT
    lead_id AS wc_lead_id,
    phone_norm AS wc_phone,
    TIMESTAMP(lead_datetime, 'Australia/Sydney') AS wc_timestamp,
    channel AS wc_channel,
    lead_source AS wc_source,
    lead_medium AS wc_medium,
    lead_campaign AS wc_campaign,
    lead_keyword AS wc_keyword,
    profile AS wc_profile,
    tracking_number AS wc_tracking_number
  FROM `pttr-taskdata.ds_crm.vw_leads`
  WHERE channel = 'Call'
),

inbound_calls AS (
  SELECT
    rc.call_id, rc.start_time, rc.norm_caller_phone, rc.caller,
    rc.callee, rc.callee_name, rc.talk_time, rc.answered, rc.missed,
    CASE
      WHEN rc.talk_time IS NOT NULL AND REGEXP_CONTAINS(rc.talk_time, r'^\d{2}:\d{2}:\d{2}$')
      THEN CAST(SPLIT(rc.talk_time, ':')[OFFSET(0)] AS INT64) * 3600
         + CAST(SPLIT(rc.talk_time, ':')[OFFSET(1)] AS INT64) * 60
         + CAST(SPLIT(rc.talk_time, ':')[OFFSET(2)] AS INT64)
      ELSE 0
    END AS duration_sec,
    CASE
      WHEN EXTRACT(DAYOFWEEK FROM DATETIME(rc.start_time, 'Australia/Sydney')) BETWEEN 2 AND 6
       AND EXTRACT(HOUR FROM DATETIME(rc.start_time, 'Australia/Sydney')) >= 7
       AND EXTRACT(HOUR FROM DATETIME(rc.start_time, 'Australia/Sydney')) < 17
      THEN TRUE ELSE FALSE
    END AS is_business_hours,
    CASE rc.callee
      WHEN '754' THEN 'Paid Search (untracked DID)'
      WHEN '753' THEN 'Paid Search (untracked DID)'
      WHEN '717' THEN 'Web DID'
      WHEN '712' THEN 'Web DID'
      WHEN '733' THEN 'Web DID'
      ELSE 'Direct'
    END AS direct_subtype
  FROM `pttr-taskdata.ds_crm.raw_calls` rc
  WHERE rc.direction = 'Incoming'
    AND rc.callee != '721'
    AND NOT REGEXP_CONTAINS(rc.callee, r'^3\d{2}$')
    AND rc.callee NOT LIKE 'ONA%'
    AND rc.norm_caller_phone IS NOT NULL
    AND rc.norm_caller_phone != ''
    -- Exclude test numbers
    AND rc.norm_caller_phone NOT IN (SELECT phone_e164 FROM `pttr-taskdata.ds_crm.test_numbers`)
),

call_with_wc AS (
  SELECT ic.*,
    wc.wc_lead_id, wc.wc_channel, wc.wc_source, wc.wc_medium,
    wc.wc_campaign, wc.wc_keyword, wc.wc_profile, wc.wc_tracking_number,
    ROW_NUMBER() OVER (
      PARTITION BY ic.call_id
      ORDER BY ABS(TIMESTAMP_DIFF(ic.start_time, wc.wc_timestamp, SECOND)) ASC
    ) AS wc_rank
  FROM inbound_calls ic
  LEFT JOIN wc_calls wc
    ON wc.wc_phone = ic.norm_caller_phone
    AND wc.wc_timestamp BETWEEN TIMESTAMP_SUB(ic.start_time, INTERVAL 5 SECOND)
                              AND TIMESTAMP_ADD(ic.start_time, INTERVAL 5 SECOND)
)

SELECT
  call_id AS lead_id, 'call' AS source_type, norm_caller_phone AS phone,
  start_time AS lead_timestamp,
  DATETIME(start_time, 'Australia/Sydney') AS lead_timestamp_sydney,
  duration_sec, callee AS queue_ext, callee_name AS queue_name, is_business_hours,
  CASE WHEN wc_lead_id IS NOT NULL THEN 'whatconverts' ELSE 'direct_did' END AS attribution_source,
  wc_lead_id,
  COALESCE(wc_channel, 'Direct / Untracked') AS channel,
  COALESCE(wc_source, 'direct') AS source,
  COALESCE(wc_medium, '(none)') AS medium,
  wc_campaign AS campaign, wc_keyword AS keyword, wc_profile AS profile,
  wc_tracking_number AS tracking_number,
  CASE WHEN wc_lead_id IS NULL THEN direct_subtype END AS direct_subtype,
  answered, missed, talk_time
FROM call_with_wc
WHERE wc_rank = 1 OR wc_lead_id IS NULL;

-- View: ds_crm.vw_opportunities
CREATE OR REPLACE VIEW `pttr-taskdata.ds_crm.vw_opportunities` AS
WITH
real_calls AS (
  SELECT * FROM `pttr-taskdata.ds_crm.vw_leads_unified` WHERE duration_sec >= 10
),

bucketed AS (
  SELECT rc.*,
    CAST(FLOOR(TIMESTAMP_DIFF(rc.lead_timestamp,
      FIRST_VALUE(rc.lead_timestamp) OVER (PARTITION BY rc.phone ORDER BY rc.lead_timestamp),
      DAY) / 30) AS INT64) AS opp_bucket
  FROM real_calls rc
),

tagged AS (
  SELECT
    phone, opp_bucket, lead_timestamp, duration_sec,
    FIRST_VALUE(lead_id) OVER w AS opportunity_id,
    FIRST_VALUE(is_business_hours) OVER w AS is_business_hours,
    FIRST_VALUE(attribution_source) OVER w AS attribution_source,
    FIRST_VALUE(channel) OVER w AS channel,
    FIRST_VALUE(source) OVER w AS source,
    FIRST_VALUE(medium) OVER w AS medium,
    FIRST_VALUE(campaign) OVER w AS campaign,
    FIRST_VALUE(keyword) OVER w AS keyword,
    FIRST_VALUE(profile) OVER w AS profile,
    FIRST_VALUE(wc_lead_id) OVER w AS wc_lead_id,
    FIRST_VALUE(direct_subtype) OVER w AS direct_subtype,
    FIRST_VALUE(queue_ext) OVER w AS queue_ext,
    FIRST_VALUE(queue_name) OVER w AS queue_name
  FROM bucketed
  WINDOW w AS (PARTITION BY phone, opp_bucket ORDER BY lead_timestamp)
),

agg AS (
  SELECT
    opportunity_id, phone,
    MIN(lead_timestamp) AS opportunity_timestamp,
    MIN(DATETIME(lead_timestamp, 'Australia/Sydney')) AS opportunity_timestamp_sydney,
    ANY_VALUE(is_business_hours) AS is_business_hours,
    ANY_VALUE(attribution_source) AS attribution_source,
    ANY_VALUE(channel) AS channel,
    ANY_VALUE(source) AS source,
    ANY_VALUE(medium) AS medium,
    ANY_VALUE(campaign) AS campaign,
    ANY_VALUE(keyword) AS keyword,
    ANY_VALUE(profile) AS profile,
    ANY_VALUE(wc_lead_id) AS wc_lead_id,
    ANY_VALUE(direct_subtype) AS direct_subtype,
    ANY_VALUE(queue_ext) AS queue_ext,
    ANY_VALUE(queue_name) AS queue_name,
    COUNT(*) AS call_count,
    MAX(duration_sec) AS max_duration_sec
  FROM tagged
  GROUP BY opportunity_id, phone
)

SELECT a.*,
  EXISTS(
    SELECT 1 FROM `pttr-taskdata.ds_aroflo.tasks_complete` tc
    WHERE (tc.norm_client_mobile = a.phone OR tc.id_phone = a.phone)
      AND tc.requested_date_parsed < DATE(a.opportunity_timestamp_sydney)
  ) AS is_existing_customer
FROM agg a;

-- View: ds_crm.vw_persons
CREATE OR REPLACE VIEW `pttr-taskdata.ds_crm.vw_persons` AS
WITH cleaned AS (
  SELECT
    contactid,
    TRIM(CONCAT(COALESCE(firstname, ''), ' ', COALESCE(lastname, ''))) AS full_name,
    LOWER(TRIM(email))  AS email,
    REGEXP_REPLACE(COALESCE(mobile, ''), r'[^0-9]', '') AS mobile_digits,
    mobile,
    clientid,
    clientname
  FROM `pttr-taskdata.ds_aroflo.contacts_deduped`
  WHERE contacttype = 'client'
    AND LOWER(COALESCE(email, '')) NOT LIKE '%@mrwasher.com.au'
    AND LOWER(COALESCE(email, '')) NOT LIKE '%@pettr%'
    AND LOWER(COALESCE(email, '')) NOT LIKE '%@ettr%'
),

-- Person key: prefer email, fall back to mobile digits, last resort contactid
keyed AS (
  SELECT
    *,
    CASE
      WHEN email IS NOT NULL AND email != '' THEN CONCAT('email:', email)
      WHEN mobile_digits != '' THEN CONCAT('mobile:', mobile_digits)
      ELSE CONCAT('id:', contactid)
    END AS person_key
  FROM cleaned
)

SELECT
  CAST(FARM_FINGERPRINT(person_key) AS STRING) AS person_id,
  ARRAY_AGG(full_name ORDER BY LENGTH(full_name) DESC LIMIT 1)[OFFSET(0)] AS full_name,
  MAX(IF(email != '', email, NULL))          AS email,
  MAX(IF(mobile_digits != '', mobile, NULL)) AS mobile,
  ARRAY_AGG(DISTINCT clientname IGNORE NULLS) AS linked_accounts,
  COUNT(DISTINCT contactid) AS contact_count
FROM keyed
GROUP BY person_key;

-- View: ds_crm.vw_search
CREATE OR REPLACE VIEW `pttr-taskdata.ds_crm.vw_search` AS
WITH account_ids AS (
  SELECT DISTINCT td.client_clientid AS account_id
  FROM `pttr-taskdata.ds_aroflo.tasks_complete` tc
  JOIN `pttr-taskdata.ds_aroflo.tasks_deduped` td ON tc.jobnumber = td.jobnumber
  WHERE tc.customer_type = 'Account'
)
SELECT
  'client' AS record_type,
  c.clientid AS record_id,
  c.clientname AS display_name,
  COALESCE(c.address_suburb, '') AS secondary_info,
  COALESCE(c.mobile, c.phone) AS phone,
  c.email,
  c.address_suburb AS suburb
FROM `pttr-taskdata.ds_aroflo.clients_deduped` c
WHERE c.clientid NOT IN (SELECT account_id FROM account_ids)

UNION ALL

SELECT
  'account' AS record_type,
  c.clientid AS record_id,
  c.clientname AS display_name,
  COALESCE(c.address_suburb, '') AS secondary_info,
  COALESCE(c.mobile, c.phone) AS phone,
  c.email,
  c.address_suburb AS suburb
FROM `pttr-taskdata.ds_aroflo.clients_deduped` c
WHERE c.clientid IN (SELECT account_id FROM account_ids)

UNION ALL

SELECT
  'location' AS record_type,
  l.locationid AS record_id,
  l.locationname AS display_name,
  CONCAT(COALESCE(l.suburb, ''), ' ', COALESCE(l.state, ''), ' ', COALESCE(l.postcode, '')) AS secondary_info,
  CAST(NULL AS STRING) AS phone,
  CAST(NULL AS STRING) AS email,
  l.suburb
FROM `pttr-taskdata.ds_aroflo.locations_deduped` l

UNION ALL

SELECT
  'job' AS record_type,
  td.jobnumber AS record_id,
  CONCAT(td.jobnumber, ' — ', COALESCE(td.client_clientname, '')) AS display_name,
  COALESCE(td.tasktype, '') AS secondary_info,
  CAST(NULL AS STRING) AS phone,
  CAST(NULL AS STRING) AS email,
  td.location_suburb AS suburb
FROM `pttr-taskdata.ds_aroflo.tasks_deduped` td

UNION ALL

SELECT
  'lead' AS record_type,
  CAST(ul.lead_id AS STRING) AS record_id,
  COALESCE(ul.contact_name, CONCAT('Lead #', CAST(ul.lead_id AS STRING))) AS display_name,
  COALESCE(ul.lead_source, '') AS secondary_info,
  ul.norm_phone AS phone,
  ul.norm_email AS email,
  CAST(NULL AS STRING) AS suburb
FROM `pttr-taskdata.ds_crm.unified_leads` ul;

-- View: ds_crm.vw_tasks
CREATE OR REPLACE VIEW `pttr-taskdata.ds_crm.vw_tasks` AS
WITH task_techs AS (
  SELECT task_jobnumber,
         STRING_AGG(DISTINCT user_username, ', ' ORDER BY user_username) AS techs
  FROM `pttr-taskdata.ds_aroflo.tasklabours_raw`
  WHERE deleted IS NULL OR deleted != 'true'
  GROUP BY task_jobnumber
),
task_schedule AS (
  SELECT task_jobnumber,
         FIRST_VALUE(user_username) OVER (PARTITION BY task_jobnumber ORDER BY workdate, starttime) AS sched_tech,
         FIRST_VALUE(workdate) OVER (PARTITION BY task_jobnumber ORDER BY workdate, starttime) AS sched_date
  FROM `pttr-taskdata.ds_aroflo.tasklabours_raw`
  WHERE (deleted IS NULL OR deleted != 'true')
    AND workdate >= FORMAT_DATE('%Y/%m/%d', CURRENT_DATE())
  QUALIFY ROW_NUMBER() OVER (PARTITION BY task_jobnumber ORDER BY workdate, starttime) = 1
)
SELECT
  tc.jobnumber                          AS job_id,
  tc.jobnumber                          AS job_no,
  td.refcode                            AS ref_no,
  COALESCE(
    NULLIF(tc.address, ''),
    NULLIF(tc.location, ''),
    NULLIF(td.location_address, ''),
    NULLIF(td.location_locationname, ''),
    td.tasklocation_locationname
  )                                     AS address,
  tc.client_name,
  COALESCE(tc.norm_client_phone, tc.id_phone) AS client_phone,
  COALESCE(tc.norm_client_email, tc.id_email) AS client_email,
  tc.task_type,
  CASE
    WHEN tc.status = 'Quote'                                              THEN 'quote'
    WHEN tc.status IN ('Not Started', 'Pending', 'In Progress')           THEN 'open'
    WHEN tc.status = 'Completed'                                          THEN 'completed'
    WHEN tc.status = 'Archived' AND tc.display_status = 'Archived'        THEN 'archived'
    WHEN tc.status = 'Archived'                                           THEN 'completed'
    ELSE 'open'
  END                                   AS status,
  tc.display_status                     AS status_label,
  CASE
    WHEN UPPER(td.substatus_substatus) IN ('A', 'B', 'C')
    THEN UPPER(td.substatus_substatus)
    ELSE NULL
  END                                   AS grade,
  tt.techs                              AS assigned,
  CASE
    WHEN td.quote_estimator_givennames IS NOT NULL AND td.quote_estimator_givennames != ''
    THEN CONCAT(td.quote_estimator_givennames, ' ', COALESCE(td.quote_estimator_surname, ''))
    ELSE NULL
  END                                   AS salesperson,
  SAFE.PARSE_DATE('%Y/%m/%d', tc.requested_date) AS logged_date,
  td.requestdatetime                    AS logged_datetime,
  COALESCE(
    SAFE.PARSE_DATE('%Y/%m/%d', td.duedate),
    SAFE.PARSE_DATE('%Y-%m-%d', td.duedate)
  )                                     AS due_date,
  CASE
    WHEN tc.status IN ('Completed', 'Archived') AND tc.display_status != 'Archived'
    THEN SAFE.PARSE_DATE('%Y/%m/%d', tc.completed_date)
    ELSE NULL
  END                                   AS completed_date,
  td.completeddatetime                  AS completed_datetime,
  COALESCE(
    SAFE.PARSE_TIMESTAMP('%Y/%m/%d %H:%M:%S', td.lastupdateddatetimeutc),
    SAFE.PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*SZ', td.lastupdateddatetimeutc)
  )                                     AS last_updated,
  SAFE_CAST(tc.task_invoices_total_ex AS NUMERIC) AS job_value,
  REGEXP_REPLACE(
    REGEXP_REPLACE(
      REGEXP_REPLACE(td.description, r'<br\s*/?>', '\n'),
      r'<[^>]+>', ''),
    r'&[a-z]+;|&#\d+;', '')            AS description,
  -- New fields
  cf.primary_work_type                  AS work_type,
  cf.campaign_most_popular              AS campaign,
  c.terms                               AS charge_rate,
  ts.sched_tech                         AS scheduled_tech,
  SAFE.PARSE_DATE('%Y/%m/%d', ts.sched_date) AS scheduled_date
FROM `pttr-taskdata.ds_aroflo.tasks_complete` tc
LEFT JOIN `pttr-taskdata.ds_aroflo.tasks_deduped` td
  ON tc.jobnumber = td.jobnumber
LEFT JOIN task_techs tt
  ON tc.jobnumber = tt.task_jobnumber
LEFT JOIN `pttr-taskdata.ds_aroflo.task_customfields_deduped` cf
  ON tc.jobnumber = cf.jobnumber
LEFT JOIN `pttr-taskdata.ds_aroflo.clients_deduped` c
  ON td.client_clientid = c.clientid
LEFT JOIN task_schedule ts
  ON tc.jobnumber = ts.task_jobnumber;

-- View: ds_crm.vw_unified_leads
CREATE OR REPLACE VIEW `pttr-taskdata.ds_crm.vw_unified_leads` AS
WITH calls_deduped AS (
  SELECT DISTINCT
    call_id,
    norm_caller_phone,
    start_time,
    answered,
    missed,
    direction,
    callee_name,
    caller_name,
    talk_time
  FROM `pttr-taskdata.ds_crm.raw_calls`
  WHERE direction = 'Incoming'
)

SELECT
  w.lead_id,
  w.contact_name,
  w.date_created AS lead_created,
  w.lead_source,
  w.lead_medium,
  w.lead_type,
  w.lead_status,
  w.norm_phone,
  w.norm_email,
  w.has_jobs,
  w.has_sales,
  w.id_combined_sales AS revenue,
  w.id_combined_jobnumbers AS job_numbers,
  COUNT(DISTINCT e.message_id) AS email_count,
  MIN(e.received_at) AS first_email,
  MAX(e.received_at) AS last_email,
  COUNT(DISTINCT c.call_id) AS call_count,
  MIN(c.start_time) AS first_call,
  MAX(c.start_time) AS last_call,
  COUNTIF(c.answered = 'Answered') AS answered_calls,
  COUNTIF(c.missed = 'Missed') AS missed_calls,
  STRING_AGG(DISTINCT c.callee_name, ', ') AS tracking_numbers_called,
  STRING_AGG(DISTINCT c.call_id, ', ') AS call_ids
FROM `pttr-taskdata.gd_WhatConverts.all_leads_enriched` w
LEFT JOIN `pttr-taskdata.ds_crm.leads_with_emails` e
  ON w.lead_id = e.lead_id
LEFT JOIN calls_deduped c
  ON w.norm_phone = c.norm_caller_phone
  AND c.start_time BETWEEN TIMESTAMP_SUB(TIMESTAMP(w.date_created), INTERVAL 1 DAY)
  AND TIMESTAMP_ADD(TIMESTAMP(w.date_created), INTERVAL 30 DAY)
WHERE w.is_test_lead = FALSE
AND w.duplicate = FALSE
AND w.spam = FALSE
GROUP BY
  w.lead_id, w.contact_name, w.date_created, w.lead_source,
  w.lead_medium, w.lead_type, w.lead_status, w.norm_phone,
  w.norm_email, w.has_jobs, w.has_sales, w.id_combined_sales,
  w.id_combined_jobnumbers;

