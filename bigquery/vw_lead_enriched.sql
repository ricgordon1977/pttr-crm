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
    WHEN o.channel = 'Form' THEN 'form'
    ELSE 'call'
  END AS lead_type,

  COALESCE(
    NULLIF(CASE
      WHEN UPPER(TRIM(wc.contact_name)) IN ('AUSTRALIA','INTERNATIONAL','NEW ZEALAND','UNITED STATES','UNITED KINGDOM')
      THEN NULL ELSE INITCAP(TRIM(wc.contact_name)) END, ''),
    NULLIF(o.contact_name, ''),
    NULLIF(tc.client_name, '')
  ) AS contact_name,
  o.phone,
  COALESCE(
    NULLIF(wc.norm_email, ''),
    NULLIF(tc.norm_client_email, '')
  ) AS email,
  o.is_existing_customer,
  o.is_no_inbound_enquiry,

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
) all_jobs ON o.opportunity_id = all_jobs.opportunity_id;
