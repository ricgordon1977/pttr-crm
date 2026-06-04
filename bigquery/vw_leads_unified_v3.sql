-- vw_leads_unified v3: multi-source spine with PM exclusion
-- Changes from v2: PM/Account phone exclusion, remove synthetic phone, keep answered as raw string
CREATE OR REPLACE VIEW `pttr-taskdata.ds_crm.vw_leads_unified` AS
WITH
-- Internal phone detection (>=10 outbound, 0 AroFlo jobs)
outbound_counts AS (
  SELECT rc_out.norm_callee_phone AS phone, COUNT(*) AS outbound_cnt
  FROM `pttr-taskdata.ds_crm.raw_calls` rc_out
  WHERE rc_out.direction = 'Outgoing' AND rc_out.norm_callee_phone IS NOT NULL AND rc_out.norm_callee_phone != ''
  GROUP BY 1 HAVING COUNT(*) >= 10
),
job_phones AS (
  SELECT DISTINCT phone FROM (
    SELECT norm_client_mobile AS phone FROM `pttr-taskdata.ds_aroflo.tasks_complete` WHERE norm_client_mobile IS NOT NULL AND norm_client_mobile != ''
    UNION DISTINCT
    SELECT id_phone FROM `pttr-taskdata.ds_aroflo.tasks_complete` WHERE id_phone IS NOT NULL AND id_phone != ''
  )
),
internal_phones AS (
  SELECT oc.phone FROM outbound_counts oc LEFT JOIN job_phones jp ON oc.phone = jp.phone WHERE jp.phone IS NULL
),

-- PM/Account-only phones: phones that ONLY appear on Account-type jobs
account_only_phones AS (
  SELECT DISTINCT phone FROM (
    SELECT norm_client_mobile AS phone FROM `pttr-taskdata.ds_aroflo.tasks_complete` WHERE customer_type = 'Account' AND norm_client_mobile IS NOT NULL AND norm_client_mobile != ''
    UNION DISTINCT
    SELECT id_phone FROM `pttr-taskdata.ds_aroflo.tasks_complete` WHERE customer_type = 'Account' AND id_phone IS NOT NULL AND id_phone != ''
  )
  EXCEPT DISTINCT
  SELECT phone FROM (
    SELECT norm_client_mobile AS phone FROM `pttr-taskdata.ds_aroflo.tasks_complete` WHERE customer_type != 'Account' AND norm_client_mobile IS NOT NULL AND norm_client_mobile != ''
    UNION DISTINCT
    SELECT id_phone FROM `pttr-taskdata.ds_aroflo.tasks_complete` WHERE customer_type != 'Account' AND id_phone IS NOT NULL AND id_phone != ''
  )
),

wc_calls AS (
  SELECT lead_id AS wc_lead_id, phone_norm AS wc_phone,
    TIMESTAMP(lead_datetime, 'Australia/Sydney') AS wc_timestamp,
    channel AS wc_channel, lead_source AS wc_source, lead_medium AS wc_medium,
    lead_campaign AS wc_campaign, lead_keyword AS wc_keyword, profile AS wc_profile,
    tracking_number AS wc_tracking_number,
    contact_name AS wc_contact_name, email AS wc_email
  FROM `pttr-taskdata.ds_crm.vw_leads` WHERE channel = 'Call'
),

inbound_calls AS (
  SELECT rc.call_id, rc.start_time, rc.norm_caller_phone, rc.caller,
    rc.callee, rc.callee_name, rc.talk_time, rc.answered, rc.missed,
    CASE WHEN rc.talk_time IS NOT NULL AND REGEXP_CONTAINS(rc.talk_time, r'^\d{2}:\d{2}:\d{2}$')
      THEN CAST(SPLIT(rc.talk_time, ':')[OFFSET(0)] AS INT64)*3600 + CAST(SPLIT(rc.talk_time, ':')[OFFSET(1)] AS INT64)*60 + CAST(SPLIT(rc.talk_time, ':')[OFFSET(2)] AS INT64)
      ELSE 0 END AS duration_sec,
    CASE WHEN EXTRACT(DAYOFWEEK FROM DATETIME(rc.start_time, 'Australia/Sydney')) BETWEEN 2 AND 6
      AND EXTRACT(HOUR FROM DATETIME(rc.start_time, 'Australia/Sydney')) >= 7
      AND EXTRACT(HOUR FROM DATETIME(rc.start_time, 'Australia/Sydney')) < 17
      THEN TRUE ELSE FALSE END AS is_business_hours,
    CASE rc.callee
      WHEN '754' THEN 'Paid Search (untracked DID)' WHEN '753' THEN 'Paid Search (untracked DID)'
      WHEN '717' THEN 'Web DID' WHEN '712' THEN 'Web DID' WHEN '733' THEN 'Web DID'
      ELSE 'Direct' END AS direct_subtype
  FROM `pttr-taskdata.ds_crm.raw_calls` rc
  LEFT JOIN `pttr-taskdata.ds_crm.test_numbers` tn ON rc.norm_caller_phone = tn.phone_e164
  LEFT JOIN internal_phones ip ON rc.norm_caller_phone = ip.phone
  LEFT JOIN `pttr-taskdata.ds_crm.lkp_did_trade` lkp ON rc.callee = lkp.did
  LEFT JOIN account_only_phones aop ON rc.norm_caller_phone = aop.phone
  WHERE rc.direction = 'Incoming'
    AND rc.callee != '721'
    AND rc.norm_caller_phone IS NOT NULL AND rc.norm_caller_phone != ''
    AND tn.phone_e164 IS NULL
    AND ip.phone IS NULL
    AND COALESCE(lkp.is_internal, FALSE) = FALSE
    AND aop.phone IS NULL  -- exclude PM/Account-only phones
),

call_with_wc AS (
  SELECT ic.*, wc.wc_lead_id, wc.wc_channel, wc.wc_source, wc.wc_medium,
    wc.wc_campaign, wc.wc_keyword, wc.wc_profile, wc.wc_tracking_number,
    wc.wc_contact_name, wc.wc_email,
    ROW_NUMBER() OVER (PARTITION BY ic.call_id ORDER BY ABS(TIMESTAMP_DIFF(ic.start_time, wc.wc_timestamp, SECOND))) AS wc_rank
  FROM inbound_calls ic
  LEFT JOIN wc_calls wc ON wc.wc_phone = ic.norm_caller_phone
    AND wc.wc_timestamp BETWEEN TIMESTAMP_SUB(ic.start_time, INTERVAL 5 SECOND) AND TIMESTAMP_ADD(ic.start_time, INTERVAL 5 SECOND)
),

call_rows AS (
  SELECT call_id AS lead_id, 'call' AS source_type, norm_caller_phone AS phone,
    start_time AS lead_timestamp, DATETIME(start_time, 'Australia/Sydney') AS lead_timestamp_sydney,
    duration_sec, callee AS queue_ext, callee_name AS queue_name, is_business_hours,
    CASE WHEN wc_lead_id IS NOT NULL THEN 'whatconverts' ELSE 'direct_did' END AS attribution_source,
    wc_lead_id, COALESCE(wc_channel, 'Direct / Untracked') AS channel,
    COALESCE(wc_source, 'direct') AS source, COALESCE(wc_medium, '(none)') AS medium,
    wc_campaign AS campaign, wc_keyword AS keyword, wc_profile AS profile,
    wc_tracking_number AS tracking_number,
    CASE WHEN wc_lead_id IS NULL THEN direct_subtype END AS direct_subtype,
    CASE WHEN duration_sec = 0 THEN 'missed' WHEN duration_sec < 20 THEN 'dropped' ELSE 'connected' END AS call_outcome,
    answered, missed, talk_time,
    wc_contact_name AS contact_name,
    wc_email AS email
  FROM call_with_wc WHERE wc_rank = 1 OR wc_lead_id IS NULL
),

form_rows AS (
  SELECT
    CAST(lead_id AS STRING) AS lead_id,
    'form' AS source_type,
    CASE WHEN phone_norm IS NOT NULL AND REGEXP_CONTAINS(phone_norm, r'^\+61[2-9]') THEN phone_norm ELSE NULL END AS phone,
    TIMESTAMP(lead_datetime, 'Australia/Sydney') AS lead_timestamp,
    lead_datetime AS lead_timestamp_sydney,
    0 AS duration_sec,
    CAST(NULL AS STRING) AS queue_ext, CAST(NULL AS STRING) AS queue_name,
    CASE WHEN EXTRACT(DAYOFWEEK FROM lead_datetime) BETWEEN 2 AND 6
      AND EXTRACT(HOUR FROM lead_datetime) >= 7 AND EXTRACT(HOUR FROM lead_datetime) < 17
      THEN TRUE ELSE FALSE END AS is_business_hours,
    'whatconverts' AS attribution_source,
    lead_id AS wc_lead_id, 'Form' AS channel,
    lead_source AS source, lead_medium AS medium,
    lead_campaign AS campaign, lead_keyword AS keyword,
    profile, tracking_number,
    CAST(NULL AS STRING) AS direct_subtype,
    'form_submit' AS call_outcome,
    CAST(NULL AS STRING) AS answered, CAST(NULL AS STRING) AS missed, CAST(NULL AS STRING) AS talk_time,
    contact_name, email
  FROM `pttr-taskdata.ds_crm.vw_leads` WHERE channel = 'Form'
),

-- === EMAIL-BASED FORMS (Quinn LP + WPForms, parsed from raw_emails_received) ===
email_form_raw AS (
  SELECT
    message_id,
    received_at,
    DATETIME(received_at, 'Australia/Sydney') AS received_syd,
    from_email,
    subject,
    -- Strip HTML for parsing
    REGEXP_REPLACE(REGEXP_REPLACE(body_text, r'<[^>]+>', ' '), r'&[a-zA-Z]+;|&#\d+;', ' ') AS clean_body,
    body_text
  FROM `pttr-taskdata.ds_crm.raw_emails_received`
  WHERE received_at >= '2025-11-01'  -- go-forward from WC era
    AND from_email IN ('jobs@plumbertotherescue.com.au', 'jobs@electriciantotherescue.com.au',
      'jobs@mrwasher.com.au', 'leads@resend.quinnmarketing.com.au')
    AND subject NOT LIKE 'RE:%' AND subject NOT LIKE 'Re:%'
    AND subject NOT LIKE 'FW:%' AND subject NOT LIKE 'Fw:%'
    AND subject NOT LIKE '%Daily Message%'
    AND body_text NOT LIKE '%alex m%'
    AND subject NOT LIKE '%Test Suburb%' AND subject NOT LIKE '%Test Service%'
    -- Must be a form submission (Quinn LP OR WPForms), not internal CSR traffic
    AND (
      -- Quinn LP signals (template shape, sender-agnostic)
      body_text LIKE '%gad_campaignid=%'
      OR body_text LIKE '%LP Suburb:%'
      OR body_text LIKE '%LP Service:%'
      OR (body_text LIKE '%utm_source:%' AND body_text LIKE '%Page URL:%')
      OR (body_text LIKE '%hq:%' AND body_text LIKE '%service:%' AND from_email LIKE '%quinn%')
      -- WPForms signals
      OR subject LIKE '%PTTR website form submission%'
      OR subject LIKE '%ETTR Website Job Booking%'
      OR subject LIKE '%ETTR Website Question%'
      OR subject LIKE '%New ETTR Website Form%'
    )
),

email_form_parsed AS (
  SELECT
    message_id,
    received_at,
    received_syd,
    from_email,
    subject,

    -- Tier detection (by template shape)
    CASE
      WHEN body_text LIKE '%gad_campaignid=%' AND body_text LIKE '%gclid=%' THEN 'quinn_paid'
      WHEN body_text LIKE '%LP Suburb:%' OR body_text LIKE '%LP Service:%' THEN 'quinn_organic'
      WHEN body_text LIKE '%utm_source:%' AND body_text LIKE '%Page URL:%' AND body_text NOT LIKE '%gclid=%' THEN 'quinn_organic'
      WHEN body_text LIKE '%hq:%' AND body_text LIKE '%service:%' AND from_email LIKE '%quinn%' THEN 'quinn_organic'
      ELSE 'wpforms'
    END AS email_tier,

    -- Phone extraction (multiple patterns across tiers)
    COALESCE(
      REGEXP_EXTRACT(clean_body, r'Phone\*?:?\s*(\+?[\d\s\-\(\)]{8,15})'),
      REGEXP_EXTRACT(clean_body, r'phone number is\.{0,3}\s*(\+?[\d\s\-\(\)]{8,15})')
    ) AS raw_phone,

    -- Email extraction
    COALESCE(
      REGEXP_EXTRACT(LOWER(clean_body), r'Email\*?:?\s*([a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,})'),
      REGEXP_EXTRACT(LOWER(clean_body), r'email is\.{0,3}\s*([a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,})')
    ) AS extracted_email,

    -- Contact name
    COALESCE(
      REGEXP_EXTRACT(clean_body, r'Name\*?:?\s*([^\n\r]{2,40})'),
      REGEXP_EXTRACT(clean_body, r'My name is\.{0,3}\s*([^\n\r]{2,40})')
    ) AS raw_name,

    -- Quinn attribution fields
    REGEXP_EXTRACT(body_text, r'gad_campaignid=(\d+)') AS gad_campaignid,
    REGEXP_EXTRACT(body_text, r'gclid=([^\s&"#]+)') AS gclid,
    COALESCE(
      REGEXP_EXTRACT(clean_body, r'utm_source:\s*(\S+)'),
      REGEXP_EXTRACT(body_text, r'utm_source=([^&\s"]+)')
    ) AS utm_source,
    COALESCE(
      REGEXP_EXTRACT(clean_body, r'utm_medium:\s*(\S+)'),
      REGEXP_EXTRACT(body_text, r'utm_medium=([^&\s"]+)')
    ) AS utm_medium,
    COALESCE(
      REGEXP_EXTRACT(clean_body, r'utm_term:\s*([^\n\r-]+)'),
      REGEXP_EXTRACT(body_text, r'utm_term=([^&\s"]+)')
    ) AS utm_term,

    -- Suburb / service (Quinn LP fields)
    COALESCE(
      REGEXP_EXTRACT(clean_body, r'LP Suburb:\s*([^\n\r]+)'),
      REGEXP_REPLACE(REGEXP_EXTRACT(body_text, r'hq=([^&\s"]+)'), r'%20', ' '),
      REGEXP_EXTRACT(clean_body, r'suburb:\s*([^\n\r]+)'),
      REGEXP_EXTRACT(clean_body, r'Hq:\s*([^\n\r]+)')
    ) AS lp_suburb,
    COALESCE(
      REGEXP_EXTRACT(clean_body, r'LP Service:\s*([^\n\r]+)'),
      REGEXP_REPLACE(REGEXP_EXTRACT(body_text, r'keyword=([^&\s"]+)'), r'%20', ' '),
      REGEXP_EXTRACT(clean_body, r'service:\s*([^\n\r]+)')
    ) AS lp_service,

    -- Profile from sender or service field
    CASE
      WHEN from_email LIKE '%plumber%' OR from_email LIKE '%mrwasher%' THEN 'Plumber to the Rescue'
      WHEN from_email LIKE '%electrician%' THEN 'Electrician to the Rescue'
      WHEN LOWER(COALESCE(
        REGEXP_EXTRACT(clean_body, r'LP Service:\s*([^\n\r]+)'),
        REGEXP_REPLACE(REGEXP_EXTRACT(body_text, r'keyword=([^&\s"]+)'), r'%20', ' '),
        REGEXP_EXTRACT(clean_body, r'service:\s*([^\n\r]+)')
      )) LIKE '%electri%' THEN 'Electrician to the Rescue'
      WHEN LOWER(COALESCE(
        REGEXP_EXTRACT(clean_body, r'LP Service:\s*([^\n\r]+)'),
        REGEXP_REPLACE(REGEXP_EXTRACT(body_text, r'keyword=([^&\s"]+)'), r'%20', ' '),
        REGEXP_EXTRACT(clean_body, r'service:\s*([^\n\r]+)')
      )) LIKE '%plumb%' THEN 'Plumber to the Rescue'
      WHEN from_email LIKE '%quinn%' AND subject LIKE '%New lead:%' THEN 'Electrician to the Rescue'
      WHEN from_email LIKE '%quinn%' AND subject LIKE '%New Lead:%' THEN 'Plumber to the Rescue'
      ELSE NULL
    END AS email_profile

  FROM email_form_raw
  WHERE -- Exclude test submissions
    clean_body NOT LIKE '%test%'
    AND subject NOT LIKE '%Matt Tyson%'
),

email_rows AS (
  SELECT
    CONCAT('email-', message_id) AS lead_id,
    'email' AS source_type,
    -- Normalize phone
    CASE
      WHEN REGEXP_CONTAINS(REGEXP_REPLACE(COALESCE(raw_phone, ''), r'[^0-9]', ''), r'^61[2-9]')
        THEN CONCAT('+', REGEXP_REPLACE(raw_phone, r'[^0-9]', ''))
      WHEN REGEXP_CONTAINS(REGEXP_REPLACE(COALESCE(raw_phone, ''), r'[^0-9]', ''), r'^0[2-9]')
        THEN CONCAT('+61', SUBSTR(REGEXP_REPLACE(raw_phone, r'[^0-9]', ''), 2))
      WHEN REGEXP_CONTAINS(REGEXP_REPLACE(COALESCE(raw_phone, ''), r'[^0-9]', ''), r'^[4][0-9]{8}$')
        THEN CONCAT('+61', REGEXP_REPLACE(raw_phone, r'[^0-9]', ''))
      ELSE NULL
    END AS phone,
    received_at AS lead_timestamp,
    received_syd AS lead_timestamp_sydney,
    0 AS duration_sec,
    CAST(NULL AS STRING) AS queue_ext,
    CAST(NULL AS STRING) AS queue_name,
    CASE WHEN EXTRACT(DAYOFWEEK FROM received_syd) BETWEEN 2 AND 6
      AND EXTRACT(HOUR FROM received_syd) >= 7 AND EXTRACT(HOUR FROM received_syd) < 17
      THEN TRUE ELSE FALSE END AS is_business_hours,
    CASE WHEN email_tier = 'quinn_paid' THEN 'quinn_lp' ELSE 'email_form' END AS attribution_source,
    CAST(NULL AS INT64) AS wc_lead_id,
    CASE
      WHEN email_tier = 'quinn_paid' THEN 'Paid Search (Quinn LP)'
      WHEN email_tier = 'quinn_organic' THEN 'Organic - Landing Page'
      ELSE 'Website Form'
    END AS channel,
    CASE WHEN email_tier = 'quinn_paid' THEN COALESCE(utm_source, 'google') ELSE 'direct' END AS source,
    CASE WHEN email_tier = 'quinn_paid' THEN COALESCE(utm_medium, 'cpc') ELSE '(none)' END AS medium,
    gad_campaignid AS campaign,
    COALESCE(TRIM(utm_term), TRIM(lp_service)) AS keyword,
    email_profile AS profile,
    CAST(NULL AS STRING) AS tracking_number,
    CAST(NULL AS STRING) AS direct_subtype,
    'form_submit' AS call_outcome,
    CAST(NULL AS STRING) AS answered,
    CAST(NULL AS STRING) AS missed,
    CAST(NULL AS STRING) AS talk_time,
    INITCAP(TRIM(raw_name)) AS contact_name,
    extracted_email AS email
  FROM email_form_parsed
)

SELECT * FROM call_rows
UNION ALL
SELECT * FROM form_rows
UNION ALL
SELECT * FROM email_rows;
