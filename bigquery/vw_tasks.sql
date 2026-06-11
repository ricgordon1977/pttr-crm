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
  tc.customer_type,
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
  -- Use corrected invoice sum from vw_job_invoiced; fall back to task_invoices_total_ex
  -- for jobs not yet in the invoice table
  COALESCE(ji.invoiced_total_ex, SAFE_CAST(tc.task_invoices_total_ex AS NUMERIC)) AS job_value,
  REGEXP_REPLACE(
    REGEXP_REPLACE(
      REGEXP_REPLACE(td.description, r'<br\s*/?>', '\n'),
      r'<[^>]+>', ''),
    r'&[a-z]+;|&#\d+;', '')            AS description,
  cf.primary_work_type                  AS work_type,
  cf.campaign_most_popular              AS campaign,
  c.terms                               AS charge_rate,
  ts.sched_tech                         AS scheduled_tech,
  SAFE.PARSE_DATE('%Y/%m/%d', ts.sched_date) AS scheduled_date
FROM `pttr-taskdata.ds_aroflo.tasks_complete` tc
LEFT JOIN `pttr-taskdata.ds_aroflo.tasks_deduped` td
  ON tc.jobnumber = td.jobnumber
LEFT JOIN `pttr-taskdata.ds_aroflo.vw_job_invoiced` ji
  ON tc.jobnumber = ji.jobnumber
LEFT JOIN task_techs tt
  ON tc.jobnumber = tt.task_jobnumber
LEFT JOIN `pttr-taskdata.ds_aroflo.task_customfields_deduped` cf
  ON tc.jobnumber = cf.jobnumber
LEFT JOIN `pttr-taskdata.ds_aroflo.clients_deduped` c
  ON td.client_clientid = c.clientid
LEFT JOIN task_schedule ts
  ON tc.jobnumber = ts.task_jobnumber;
