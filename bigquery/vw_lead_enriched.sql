-- vw_lead_enriched: lean read surface
-- One row per opportunity with lookups, attribution, outcome, and empty classification slots
CREATE OR REPLACE VIEW `pttr-taskdata.ds_crm.vw_lead_enriched` AS
SELECT
  -- === Identity ===
  o.opportunity_id,
  o.opportunity_timestamp_sydney AS created_at_sydney,
  NOT o.is_business_hours AS is_after_hours,

  -- Profile resolution ladder (Step 2):
  --   1) unambiguous DID→trade  2) WC profile  3) AroFlo job task_type  4) Unknown
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

  CASE WHEN o.channel = 'Form' THEN 'form' ELSE 'call' END AS lead_type,
  COALESCE(
    NULLIF(CASE
      WHEN UPPER(TRIM(wc.contact_name)) IN ('AUSTRALIA','INTERNATIONAL','NEW ZEALAND','UNITED STATES','UNITED KINGDOM')
      THEN NULL ELSE INITCAP(TRIM(wc.contact_name)) END, ''),
    NULLIF(tc.client_name, '')
  ) AS contact_name,
  CASE WHEN o.phone LIKE 'form:%' THEN NULL ELSE o.phone END AS phone,
  COALESCE(
    NULLIF(wc.norm_email, ''),
    NULLIF(tc.norm_client_email, '')
  ) AS email,
  o.is_existing_customer,

  -- === Attribution ===
  o.channel,
  o.source,
  o.medium,
  lkp_camp.campaign_type,
  lkp_camp.division,
  lkp_camp.campaign_name,
  o.keyword,
  o.wc_lead_id,

  -- === Interaction ===
  o.call_count,
  o.max_duration_sec >= 20 AS answered,
  CAST(NULL AS FLOAT64) AS first_response_minutes,  -- deferred

  -- === Outcome (rules-based) ===
  o.jobnumber AS job_numbers,
  CASE WHEN o.jobnumber IS NOT NULL THEN 'Booked' ELSE 'Not Booked' END AS booking_status,
  SAFE_CAST(tc.task_invoices_total_ex AS NUMERIC) AS job_value,
  o.job_status,
  CASE
    WHEN tc.status = 'Archived' AND tc.job_status = 'Completed'
      AND SAFE_CAST(tc.task_invoices_total_ex AS FLOAT64) > 0 THEN TRUE
    WHEN o.jobnumber IS NOT NULL THEN FALSE
    ELSE NULL
  END AS completed,

  -- === Classification (all NULL — populated by 836-import + AI + Firestore) ===
  CAST(NULL AS STRING) AS disposition,
  CAST(NULL AS STRING) AS loss_reason,
  CAST(NULL AS STRING) AS csr_quality,
  CAST(NULL AS BOOL) AS quotable,
  CAST(NULL AS BOOL) AS captured,
  CAST(NULL AS STRING) AS lead_class,
  CAST(NULL AS FLOAT64) AS confidence,
  CAST(NULL AS STRING) AS reasoning,
  CAST(NULL AS BOOL) AS needs_review

FROM `pttr-taskdata.ds_crm.vw_opportunities` o
LEFT JOIN `pttr-taskdata.ds_crm.lkp_did_trade` lkp_did
  ON o.queue_ext = lkp_did.did
LEFT JOIN `pttr-taskdata.gd_WhatConverts.all_leads_enriched` wc
  ON o.wc_lead_id = wc.lead_id
LEFT JOIN `pttr-taskdata.ds_crm.lkp_campaign` lkp_camp
  ON wc.lp_gad_campaignid = lkp_camp.campaign_id
LEFT JOIN `pttr-taskdata.ds_aroflo.tasks_complete` tc
  ON o.jobnumber = tc.jobnumber;
