-- vw_lead_enriched v3: lean read surface
-- answered = raw_calls.answered (call connected), captured = answered AND duration>=20s
-- classification fields all NULL (populated later by 836-import + AI + Firestore)
CREATE OR REPLACE VIEW `pttr-taskdata.ds_crm.vw_lead_enriched` AS
SELECT
  -- === Identity ===
  o.opportunity_id,
  o.opportunity_timestamp_sydney AS created_at_sydney,
  NOT COALESCE(o.is_business_hours, TRUE) AS is_after_hours,

  -- Profile resolution ladder
  CASE
    WHEN lkp_did.trade IN ('PTTR', 'ETTR') THEN lkp_did.trade
    WHEN o.profile = 'Plumber to the Rescue' THEN 'PTTR'
    WHEN o.profile = 'Electrician to the Rescue' THEN 'ETTR'
    WHEN o.job_task_type LIKE '%Plumb%' THEN 'PTTR'
    WHEN o.job_task_type LIKE '%Electri%' THEN 'ETTR'
    ELSE 'Unknown (confirm)'
  END AS service,
  CASE
    WHEN lkp_did.trade IN ('PTTR', 'ETTR') THEN 'did'
    WHEN o.profile IN ('Plumber to the Rescue', 'Electrician to the Rescue') THEN 'wc_profile'
    WHEN o.job_task_type LIKE '%Plumb%' OR o.job_task_type LIKE '%Electri%' THEN 'aroflo_job'
    ELSE 'unresolved'
  END AS profile_source,

  CASE
    WHEN o.opp_type = 'no_inbound' THEN 'direct_booking'
    WHEN o.channel IN ('Form', 'Website Form', 'Paid Search (Quinn LP)', 'Organic - Landing Page') THEN 'form'
    WHEN o.form_count > 0 AND o.call_count = 0 THEN 'form'
    ELSE 'call'
  END AS lead_type,

  COALESCE(
    NULLIF(CASE
      WHEN UPPER(TRIM(wc.contact_name)) IN ('AUSTRALIA','INTERNATIONAL','NEW ZEALAND','UNITED STATES','UNITED KINGDOM')
      THEN NULL ELSE INITCAP(TRIM(wc.contact_name)) END, ''),
    NULLIF(o.contact_name, ''),
    NULLIF(tc.client_name, ''),
    -- Existing-client fallback: resolve name from prior AroFlo jobs matched by phone
    NULLIF(prior_client.client_name, '')
  ) AS contact_name,
  o.phone,
  COALESCE(
    NULLIF(wc.norm_email, ''),
    NULLIF(tc.norm_client_email, ''),
    NULLIF(prior_client.norm_client_email, '')
  ) AS email,
  o.is_existing_customer,
  o.is_no_inbound_enquiry,

  -- Suburb (WC city → AroFlo suburb → form-parsed suburb → prior client suburb)
  COALESCE(NULLIF(TRIM(wc.city), ''), NULLIF(TRIM(tc.address_suburb), ''), ef.form_suburb, NULLIF(TRIM(prior_client.address_suburb), '')) AS suburb,

  -- Form-specific fields (email-parsed forms only)
  ef.form_address,
  ef.form_problem,

  -- === Attribution ===
  o.channel,
  o.source,
  o.medium,
  lkp_camp.campaign_type,
  lkp_camp.division,
  lkp_camp.campaign_name,
  o.keyword,
  o.wc_lead_id,
  o.matched_phones,
  o.matched_emails,

  -- === Interaction ===
  o.call_count,
  o.form_count,
  -- FIX 1: answered = call connected (from raw_calls.answered), NOT duration threshold
  CASE WHEN o.call_count > 0 THEN o.has_answered_call ELSE NULL END AS answered,
  -- captured = answered AND duration >= 20s (distinct from answered)
  CASE WHEN o.call_count > 0 THEN o.has_answered_call AND o.max_duration_sec >= 20 ELSE NULL END AS captured,
  CAST(NULL AS FLOAT64) AS first_response_minutes,

  -- Operator (first answering agent: call_legs → recordings → callee_name fallback)
  COALESCE(
    first_agent.callee_name,
    first_rec.operator_name,
    CASE WHEN REGEXP_CONTAINS(COALESCE(first_rc.callee_name, ''), r'^[A-Z][a-z]+ [A-Z][a-z]+$')
      AND first_rc.callee_name NOT IN ('Mr Washer Generic', 'Mr Washer Temp', 'Plumber Rescue',
        'Strata Account', 'Plumbing Rescue', 'Electrician Rescue', 'Plumber and Electrician to the Rescue')
      THEN first_rc.callee_name END
  ) AS operator,

  -- === Outcome (rules-based) ===
  o.jobnumber AS job_numbers,
  o.all_jobnumbers,
  o.job_count,
  CASE WHEN o.jobnumber IS NOT NULL THEN 'Booked' ELSE 'Not Booked' END AS booking_status,
  -- job_value: sum across ALL jobs in the cluster (multi-job), else primary job
  COALESCE(all_jobs.total_value, SAFE_CAST(tc.task_invoices_total_ex AS NUMERIC)) AS job_value,
  o.job_status,
  -- completed: TRUE if ANY job in the cluster is Archived+Completed+invoiced>0
  CASE
    WHEN o.job_count > 1 AND COALESCE(all_jobs.any_completed, FALSE) THEN TRUE
    WHEN o.job_count <= 1 AND tc.status = 'Archived' AND tc.job_status = 'Completed'
      AND SAFE_CAST(tc.task_invoices_total_ex AS FLOAT64) > 0 THEN TRUE
    WHEN o.jobnumber IS NOT NULL THEN FALSE
    ELSE NULL
  END AS completed,

  -- === Objective funnel stage ===
  CASE
    WHEN o.job_count > 1 AND COALESCE(all_jobs.any_completed, FALSE) THEN 'Paid Job'
    WHEN o.job_count <= 1 AND tc.status = 'Archived' AND tc.job_status = 'Completed'
      AND SAFE_CAST(tc.task_invoices_total_ex AS FLOAT64) > 0 THEN 'Paid Job'
    WHEN o.jobnumber IS NOT NULL THEN 'Booked'
    WHEN o.call_count > 0 AND o.has_answered_call AND o.max_duration_sec >= 20 THEN 'Captured'
    WHEN o.call_count > 0 OR o.form_count > 0 THEN 'Not Captured'
    WHEN o.opp_type = 'no_inbound' AND o.jobnumber IS NOT NULL THEN 'Booked'
    ELSE 'Not Captured'
  END AS funnel_stage,

  -- === After-hours gap detection ===
  -- Segment (d): after-hours call with NO content at any source.
  -- Validated: 0% conversion rate across all historical gap calls.
  -- Used for auto-classification: <20s → Not Captured, ≥20s → Lost/Unresponsive.
  CASE
    WHEN NOT COALESCE(o.is_business_hours, TRUE)          -- after hours
      AND o.call_count > 0                                 -- is a call-type opp
      AND o.wc_lead_id IS NULL                             -- no WC match
      AND o.jobnumber IS NULL                              -- no linked job
      AND o.contact_name IS NULL                           -- no contact from any source (form, WC, AroFlo)
      AND NOT EXISTS (                                     -- no 8x8 recording
        SELECT 1 FROM `pttr-taskdata.ds_crm.raw_recordings` rr2
        JOIN `pttr-taskdata.ds_crm.raw_calls` rc2 ON rr2.call_id = rc2.call_id
        WHERE rc2.norm_caller_phone = o.phone
          AND rc2.start_time BETWEEN
            TIMESTAMP_SUB(o.opportunity_timestamp, INTERVAL 1 DAY)
            AND TIMESTAMP_ADD(o.opportunity_timestamp, INTERVAL 30 DAY)
      )
      AND NOT EXISTS (                                     -- no OHQ email with contact
        SELECT 1 FROM `pttr-taskdata.ds_crm.raw_emails_received` e
        WHERE LOWER(e.from_email) LIKE '%myreceptionist%'
          AND (
            -- Match E.164 format (+61...) in Caller ID field
            e.body_preview LIKE CONCAT('%', o.phone, '%')
            -- Match 0-prefix format (spaces stripped) in Phone field
            OR REPLACE(e.body_preview, ' ', '') LIKE CONCAT('%', REPLACE(o.phone, '+61', '0'), '%')
          )
          AND TIMESTAMP(e.received_at) BETWEEN
            TIMESTAMP_SUB(o.opportunity_timestamp, INTERVAL 1 MINUTE)
            AND TIMESTAMP_ADD(o.opportunity_timestamp, INTERVAL 10 MINUTE)
      )
    THEN TRUE
    ELSE FALSE
  END AS is_after_hours_gap,

  -- === Classification (all NULL) ===
  CAST(NULL AS STRING) AS disposition,
  CAST(NULL AS STRING) AS loss_reason,
  CAST(NULL AS STRING) AS csr_quality,
  CAST(NULL AS BOOL) AS quotable,
  CAST(NULL AS STRING) AS lead_class,
  CAST(NULL AS FLOAT64) AS confidence,
  CAST(NULL AS STRING) AS reasoning,
  CAST(NULL AS BOOL) AS needs_review

FROM `pttr-taskdata.ds_crm.opportunities` o
LEFT JOIN `pttr-taskdata.ds_crm.lkp_did_trade` lkp_did
  ON o.queue_ext = lkp_did.did
LEFT JOIN `pttr-taskdata.gd_WhatConverts.all_leads_enriched` wc
  ON o.wc_lead_id = wc.lead_id
LEFT JOIN `pttr-taskdata.ds_crm.lkp_campaign` lkp_camp
  ON COALESCE(wc.lp_gad_campaignid, o.campaign) = lkp_camp.campaign_id
LEFT JOIN `pttr-taskdata.ds_aroflo.tasks_complete` tc
  ON o.jobnumber = tc.jobnumber
-- Aggregate across ALL jobs in multi-job clusters
LEFT JOIN (
  SELECT o2.opportunity_id,
    ROUND(SUM(SAFE_CAST(tc2.task_invoices_total_ex AS NUMERIC)), 2) AS total_value,
    LOGICAL_OR(tc2.status = 'Archived' AND tc2.job_status = 'Completed'
      AND SAFE_CAST(tc2.task_invoices_total_ex AS FLOAT64) > 0) AS any_completed
  FROM `pttr-taskdata.ds_crm.opportunities` o2,
    UNNEST(SPLIT(o2.all_jobnumbers, ',')) AS jn
  JOIN `pttr-taskdata.ds_aroflo.tasks_complete` tc2 ON TRIM(jn) = tc2.jobnumber
  WHERE o2.job_count > 1
  GROUP BY o2.opportunity_id
) all_jobs ON o.opportunity_id = all_jobs.opportunity_id
-- Operator: first answering agent on the opportunity's earliest call
-- Join raw_calls by phone + timestamp (opportunity_timestamp = first call's start_time for call-first opps)
LEFT JOIN `pttr-taskdata.ds_crm.raw_calls` first_rc
  ON first_rc.norm_caller_phone = o.phone
  AND ABS(TIMESTAMP_DIFF(first_rc.start_time, o.opportunity_timestamp, SECOND)) < 2
  AND first_rc.direction = 'Incoming'
LEFT JOIN (
  SELECT parent_call_id,
    ARRAY_AGG(callee_name ORDER BY TIMESTAMP_DIFF(disconnected_time, start_time, SECOND) DESC LIMIT 1)[OFFSET(0)] AS callee_name
  FROM `pttr-taskdata.ds_crm.raw_call_legs`
  WHERE answered = 'Answered' AND direction = 'Internal'
    AND parent_call_id IS NOT NULL
    AND callee NOT LIKE 'CallForking%' AND callee NOT LIKE 'RingGroup%' AND callee NOT LIKE 'AutoAttendant%'
    AND REGEXP_CONTAINS(callee_name, r'^[A-Z][a-z]+ [A-Z][a-z]+$')
    AND callee_name NOT IN ('Mr Washer Generic', 'Mr Washer Temp', 'Plumber Rescue')
  GROUP BY parent_call_id
) first_agent ON first_rc.call_id = first_agent.parent_call_id
LEFT JOIN (
  SELECT call_id,
    ARRAY_AGG(operator_name ORDER BY operator_name LIMIT 1)[OFFSET(0)] AS operator_name
  FROM `pttr-taskdata.ds_crm.raw_recordings`
  WHERE operator_name IS NOT NULL AND operator_name != ''
  GROUP BY call_id
) first_rec ON first_rc.call_id = first_rec.call_id
-- Email-form fields (form_suburb, form_address, form_problem)
-- Email-form fields (form_suburb, form_address, form_problem) — one per opp
LEFT JOIN (
  SELECT phone, lead_timestamp, form_suburb, form_address, form_problem,
    ROW_NUMBER() OVER (PARTITION BY phone ORDER BY lead_timestamp) AS rn
  FROM `pttr-taskdata.ds_crm.vw_leads_unified`
  WHERE source_type = 'email'
    AND (form_suburb IS NOT NULL OR form_address IS NOT NULL OR form_problem IS NOT NULL)
) ef ON ef.phone = o.phone
  AND ABS(TIMESTAMP_DIFF(ef.lead_timestamp, o.opportunity_timestamp, SECOND)) < 2592000
  AND ef.rn = 1
-- Existing-client resolution: when is_existing_customer but no job linked to this opp,
-- resolve the client name/email/suburb from their most recent prior job.
-- Uses the SAME phone match as is_existing_customer (id_phone + norm_client_mobile).
LEFT JOIN (
  SELECT phone, client_name, norm_client_email, address_suburb,
    ROW_NUMBER() OVER (PARTITION BY phone ORDER BY requested_date_parsed DESC) AS rn
  FROM (
    SELECT id_phone AS phone, client_name, norm_client_email, address_suburb, requested_date_parsed
    FROM `pttr-taskdata.ds_aroflo.tasks_complete`
    WHERE id_phone IS NOT NULL AND id_phone != '' AND customer_type = 'COD'
    UNION ALL
    SELECT norm_client_mobile, client_name, norm_client_email, address_suburb, requested_date_parsed
    FROM `pttr-taskdata.ds_aroflo.tasks_complete`
    WHERE norm_client_mobile IS NOT NULL AND norm_client_mobile != '' AND customer_type = 'COD'
  )
  WHERE client_name IS NOT NULL AND LOWER(client_name) NOT LIKE '%test%'
    AND LOWER(client_name) NOT IN ('misc cod', 'misc plumbing', 'misc electrical')
) prior_client ON prior_client.phone = o.phone AND prior_client.rn = 1;
