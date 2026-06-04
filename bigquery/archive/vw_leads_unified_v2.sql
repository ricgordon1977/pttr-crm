-- vw_leads_unified v2: multi-source spine (call + form + email slot)
-- Changes: is_internal exclusion via lkp_did_trade, web form leads, contact_name/email columns
CREATE OR REPLACE VIEW `pttr-taskdata.ds_crm.vw_leads_unified` AS
WITH
-- Pre-compute phones with >=10 outbound AND 0 AroFlo jobs = internal
outbound_counts AS (
  SELECT rc_out.norm_callee_phone AS phone, COUNT(*) AS outbound_cnt
  FROM `pttr-taskdata.ds_crm.raw_calls` rc_out
  WHERE rc_out.direction = 'Outgoing' AND rc_out.norm_callee_phone IS NOT NULL AND rc_out.norm_callee_phone != ''
  GROUP BY rc_out.norm_callee_phone
  HAVING COUNT(*) >= 10
),

job_phones AS (
  SELECT DISTINCT phone FROM (
    SELECT norm_client_mobile AS phone FROM `pttr-taskdata.ds_aroflo.tasks_complete` WHERE norm_client_mobile IS NOT NULL AND norm_client_mobile != ''
    UNION DISTINCT
    SELECT id_phone FROM `pttr-taskdata.ds_aroflo.tasks_complete` WHERE id_phone IS NOT NULL AND id_phone != ''
  )
),

internal_phones AS (
  SELECT oc.phone FROM outbound_counts oc
  LEFT JOIN job_phones jp ON oc.phone = jp.phone
  WHERE jp.phone IS NULL
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
  WHERE rc.direction = 'Incoming'
    AND rc.callee != '721'
    AND rc.norm_caller_phone IS NOT NULL AND rc.norm_caller_phone != ''
    AND tn.phone_e164 IS NULL
    AND ip.phone IS NULL
    AND COALESCE(lkp.is_internal, FALSE) = FALSE
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

-- === CALLS ===
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

-- === WEB FORMS ===
form_rows AS (
  SELECT
    CAST(lead_id AS STRING) AS lead_id,
    'form' AS source_type,
    CASE
      WHEN phone_norm IS NOT NULL AND REGEXP_CONTAINS(phone_norm, r'^\+61[2-9]') THEN phone_norm
      ELSE CONCAT('form:', CAST(lead_id AS STRING))
    END AS phone,
    TIMESTAMP(lead_datetime, 'Australia/Sydney') AS lead_timestamp,
    lead_datetime AS lead_timestamp_sydney,
    0 AS duration_sec,
    CAST(NULL AS STRING) AS queue_ext,
    CAST(NULL AS STRING) AS queue_name,
    CASE WHEN EXTRACT(DAYOFWEEK FROM lead_datetime) BETWEEN 2 AND 6
      AND EXTRACT(HOUR FROM lead_datetime) >= 7
      AND EXTRACT(HOUR FROM lead_datetime) < 17
      THEN TRUE ELSE FALSE END AS is_business_hours,
    'whatconverts' AS attribution_source,
    lead_id AS wc_lead_id,
    'Form' AS channel,
    lead_source AS source,
    lead_medium AS medium,
    lead_campaign AS campaign,
    lead_keyword AS keyword,
    profile,
    tracking_number,
    CAST(NULL AS STRING) AS direct_subtype,
    'form_submit' AS call_outcome,
    CAST(NULL AS STRING) AS answered,
    CAST(NULL AS STRING) AS missed,
    CAST(NULL AS STRING) AS talk_time,
    contact_name,
    email
  FROM `pttr-taskdata.ds_crm.vw_leads`
  WHERE channel = 'Form'
)

-- === UNION: calls + forms (+ future email slot) ===
SELECT * FROM call_rows
UNION ALL
SELECT * FROM form_rows
-- UNION ALL
-- SELECT * FROM email_rows  -- future: parsed Quinn/YP email leads, source_type='email'
;
