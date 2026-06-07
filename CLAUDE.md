@AGENTS.md

# CRM Data Pipeline — Reference

## §1 Business Context

**PETTR** (Plumber To The Rescue / Electrician To The Rescue) — owner-operator:
Ric Gordon. Trade services (plumbing + electrical) in Sydney, Australia.

Two business lines with separate marketing but shared operations:
- **PTTR** — Plumber to the Rescue (brand: Mr Washer)
- **ETTR** — Electrician to the Rescue

Two customer types:
- **COD** (Cash on Delivery) — residential leads from advertising. This is
  the marketing funnel the CRM tracks.
- **Account** (Property Management / Strata) — contractual work with no
  marketing spend. EXCLUDED from the COD lead funnel.

## §2 GCP Infrastructure

- **Project**: `pttr-taskdata`
- **Region**: `australia-southeast1` (project default)
- **BigQuery datasets** (all **US multi-region**, not australia-southeast1):
  - `ds_crm` — CRM views, lookup tables, materialized opportunity table
  - `ds_aroflo` — AroFlo job management data
  - `ds_GoogleAds` — Google Ads data transfer (Supermetrics)
  - `gd_WhatConverts` — call/lead tracking (WhatConverts API)
- **Secrets**: GCP Secret Manager (never read local secrets files)
- **BigQuery commands** must use `--location=US`
- **Firestore**: lives in project **`pettr-data`** (Firebase), NOT `pttr-taskdata`.
  The GCP Cloud Firestore API is **disabled** on pttr-taskdata — you MUST use
  `firebase-admin` (Firebase path), not `google-cloud-firestore`, to reach
  Firestore from pttr-taskdata services.
  - Secret `firebase-admin-sa` (in pttr-taskdata Secret Manager) contains the
    pettr-data Firebase admin service-account JSON
    (`firebase-adminsdk-fbsvc@pettr-data.iam.gserviceaccount.com`).
  - The orchestrator's `_get_firestore_db()` reads this secret and initialises
    `firebase-admin`. If the secret is missing, the after-hours auto-classify
    step fails.
  - The CRM app (Next.js) uses its own Firebase Admin credentials via env vars
    (`FIREBASE_ADMIN_PRIVATE_KEY`, `FIREBASE_ADMIN_CLIENT_EMAIL`).

## §3 Data Sources + Call Routing — BUILT

### 8x8 PBX (raw_calls / raw_recordings / call_transcripts)
- All inbound/outbound calls route through 8x8 PBX `reliancecommunica977`
- One CDR per call, no leg dedup needed (confirmed)
- **After-hours calls DO forward through 8x8** — BUILT, confirmed: 98.4% of
  answering-service emails (435/442, Dec–May) have a matching 8x8 call within
  ±5 seconds. The call spine is complete after-hours. The 7 with no matching
  call are the rare exception (routed through non-8x8 channel → mint as leads).
- Recordings ingestion began ~2 Apr 2026; no 8x8 transcripts before that date
- `raw_calls`: 72K rows, Apr 2024–present. `answered` = "Answered" / "-"
- `call_transcripts`: 3.1K rows, Apr 2026–present

### WhatConverts (gd_WhatConverts.all_leads_enriched / all_leads_classified)
- Tracks calls + web forms via tracking numbers and form integrations
- `all_leads_enriched`: 1,245 rows. Carries `lp_gad_campaignid`, `gclid`,
  `norm_phone`, `norm_email`, `profile` (PTTR/ETTR)
- `all_leads_classified`: adds `lead_class`, `is_booking`, `is_converted_job`
  etc. from WC classification rules

### AroFlo (ds_aroflo)
- `tasks_complete`: 73K jobs. Curated view with `customer_type`, `status`,
  `job_status`, `task_invoices_total_ex`, `norm_client_*` contact fields
- `tasks_deduped`: raw task record with 72 cols. Key: `contact_userid` →
  `contacts_deduped.userid` for task-level customer mobile/email
- `contacts_deduped`: customer contacts (mobile, email) linked via `userid`
- `locations_deduped`: site contacts (`SitePhone`, `SiteEmail`, `SiteContact`)

### Google Ads (ds_GoogleAds)
- Supermetrics data transfer. Account `8436890791`
- `ads_Campaign_8436890791`: campaign metadata (name, type, status)
- `ads_CampaignStats_8436890791`: daily spend/clicks/conversions

### Outlook / MS Graph (ds_crm.raw_emails_received / raw_emails_sent)
- Inbound emails: 74K rows from Jan 2018
- Used for: form-lead parsing (§6), answering-service enrichment (§8)

## §4 Lookup Tables — BUILT

### ds_crm.lkp_did_trade
Editable. Maps 8x8 DID extensions to trade + internal flag.
- `did` STRING, `trade` STRING (PTTR/ETTR/Unknown/Staff), `label` STRING,
  `is_internal` BOOL
- 113 rows. 0 unknowns among external DIDs. DID 797 "Tradesmen" = internal.
- "Mixed" label retired — the only genuinely mixed external DID (796) is
  trade='Unknown' for manual confirmation.

### ds_crm.lkp_campaign
Editable. Maps Google Ads campaign_id to type + division.
- `campaign_id` STRING, `campaign_name` STRING,
  `campaign_type` STRING (Quinn-Suburb / Quinn-Smart / Supercharge-Suburb /
  Brand / Pmax / Retargeting / Organic / Unknown),
  `division` STRING (Plumbing / Electrical / Other)
- 455 rows. 0 Unknown campaigns (22128205877 confirmed as Pmax/Plumbing).

## §5 The Spine: vw_leads_unified — BUILT

Multi-source event spine. `source_type ∈ {call, form, email}`.

**Source file**: `bigquery/vw_leads_unified_v3.sql`

### Calls (source_type = 'call')
- From `raw_calls`, direction = Incoming
- Excludes: test numbers, internal phones (≥10 outbound + 0 AroFlo jobs),
  `is_internal = TRUE` DIDs (via lkp_did_trade), account-only phones
  (PM/strata), DID 721 (Strata Account)
- WC matching: ±5s timestamp + phone → enriches with channel/source/medium/
  campaign/keyword/profile
- `call_outcome`: missed (0s) / dropped (<20s) / connected (≥20s)

### WC Forms (source_type = 'form')
- From `vw_leads` WHERE channel = 'Form'
- Phone normalized to E.164; NULL if no valid AU phone (no synthetic hack)

### Email Forms (source_type = 'email') — BUILT
- Parsed from `raw_emails_received`. Sender-agnostic detection by template
  shape (field patterns in body text), NOT sender address.
- **Three tiers**:
  - **Tier 1 Quinn PAID** — `gad_campaignid` + `gclid` in body → campaign from
    `lkp_campaign` (Quinn-Suburb / Quinn-Smart), source=google, medium=cpc.
    Keeps gclid, keyword, suburb.
  - **Tier 2 Quinn ORGANIC** — `LP Suburb:` / `LP Service:` / `Page URL:`
    without gclid → channel='Organic - Landing Page', source=direct.
  - **Tier 3 WPForms** — `My name is` / `My phone number is` patterns →
    channel='Website Form', source='Direct / Website Form'. Profile from
    sender (brand = attribution ceiling; do NOT infer paid/organic).
- Excludes: RE:/FW: CSR threads, test campaigns (`...(Temp) Test`), test
  submissions.
- Phone extraction handles: `Phone*:`, `Phone:`, `My phone number is...`,
  bare digits. HTML entities (`&nbsp;`) stripped before matching.
- Quinn LP forms arrived via `jobs@electriciantotherescue.com.au` (pre-late-
  Apr) then `leads@resend.quinnmarketing.com.au` (post switchover). Both
  detected by template shape, not sender.
- All tiers dedup against calls/WC/jobs through the 30-day connected-component
  graph. No double-ingestion.

## §6 Email Sender Classification — BUILT

Previously "jobs@ = internal, exclude." Replaced with tiered logic:

| Sender | Content | Action |
|---|---|---|
| `jobs@plumbertotherescue.com.au` | Form submissions (PTTR) + CSR threads | **Parse forms** (§5 Tier 3); exclude RE:/FW: |
| `jobs@electriciantotherescue.com.au` | Form submissions (ETTR) + CSR threads | **Parse forms** (§5 Tier 3 + Tier 1/2 Quinn); exclude RE:/FW: |
| `leads@resend.quinnmarketing.com.au` | Quinn LP forms (both brands) | **Parse forms** (§5 Tier 1/2) |
| `noreply@myreceptionist.com.au` | OfficeHQ answering-service messages | **Enrichment** on matched 8x8 call (98.4% match rate). NOT a standalone lead. |
| `vodafone@myreceptionist.com.au` | Same (Vodafone pager, ended Jan 2026) | **Enrichment** on matched call |
| `noreply@message-media.com` | SMS reply notifications | **Exclude** (noise) |
| `maintenance@bright-duggan.com.au` | Strata/PM work orders | **Exclude** (Account work) |
| `noreply@smata.com` | Strata/PM | **Exclude** |
| Other strata/PM domains | urbanise, morethanstrata, precise.property, nswstrata, stratachoice | **Exclude** |

## §7 Opportunity Clustering — BUILT

**Table**: `ds_crm.opportunities` (materialized by `bigquery/build_opportunities.sql`)
**View**: `ds_crm.vw_opportunities` = `SELECT * FROM ds_crm.opportunities`

### Connected-Component Graph
Identity is phone OR email. Two events are the same opportunity if, within a
30-day window, they share a normalized phone or email. Matching is transitive
(A shares phone with B, B shares email with C → A+B+C = one opportunity).

### Graph Nodes
- **Spine events**: calls (connected + dropped + missed) + WC forms + email forms
- **AroFlo COD jobs**: client-level, task-contact-level, site-level, AND
  description-extracted contacts all feed the graph.

### Contact Hierarchy for Jobs (priority order)
1. Task contact mobile/email (`contacts_deduped.mobile/email` via
   `tasks_deduped.contact_userid → contacts_deduped.userid`)
2. Location site (`tasks_deduped.location_SitePhone/SiteEmail`)
3. Client level (`tasks_complete.id_phone/norm_client_phone/norm_client_email`)
4. Description free-text extraction (regex on task description; only when
   all structured levels are null). Handles `Phone:`, `Caller ID:`,
   `Contact: {name} (M) {num}`, `m) {num}`.

Note: `contactname` / `contactphone` on tasks_deduped = CSR/staff, NOT
customer. Exclude the 8583-xxxx extension range.

### Exclusions
- Account/PM jobs (`customer_type = 'Account'`)
- Account-only phones (phones appearing ONLY on Account-type jobs)
- Test clients (`client_name LIKE '%test%'`)

### opportunity_id (deterministic, idempotent)
- `J-{min_jobnumber}` when cluster contains an AroFlo job
- `G-{MD5(component_id | phones | emails)}` otherwise
- Tiebreaker on job rank: `ORDER BY date_distance, jobnumber`

### Implementation
5-round label propagation in a BigQuery scripted job (~50s). Too complex for a
view; materialized as a table. Re-run is idempotent (CREATE OR REPLACE).

### Key Fields
`opportunity_id`, `phone`, `jobnumber`, `all_jobnumbers`, `job_count`,
`call_count`, `form_count`, `max_duration_sec`, `opp_type` (job_matched /
gap_based / no_inbound), `channel`, `source`, `medium`, `campaign`, `keyword`,
`profile`, `wc_lead_id`, `matched_phones`, `matched_emails`,
`is_no_inbound_enquiry`, `has_answered_call`, `is_existing_customer`

## §8 Answering-Service Emails — PLANNED

OfficeHQ emails carry structured customer data (name, phone, address, problem,
Caller ID) for after-hours calls. Currently excluded from the spine but
confirmed as enrichment on existing 8x8 calls (98.4% match rate).

**Planned (Ric's stated intent, NOT yet built)**:
- Ingest as enrichment LINKED to the call opportunity (keyed by opportunity_id),
  NOT as a standalone lead, NOT as columns in vw_lead_enriched
- Content store joined on the detail page + available to the AI classifier
- **HIGH VALUE PRE-APRIL**: no 8x8 transcripts exist before ~Apr 30, so the
  answering-service email is the only content for Dec–March after-hours calls —
  it is the pre-transcript classification substitute

## §9 Lean Read Surface: vw_lead_enriched — BUILT

One row per opportunity. Joins opportunities + lookups + AroFlo outcome +
attribution.

**Source file**: `bigquery/vw_lead_enriched_v3.sql`

### Profile Resolution Ladder (auditable via `profile_source`)
1. Unambiguous DID → trade (from lkp_did_trade)
2. WC profile ("Plumber to the Rescue" / "Electrician to the Rescue")
3. AroFlo job task_type (contains "Plumb" or "Electri")
4. 'Unknown (confirm)' — unresolved

### answered vs captured (distinct)
- `answered` = `raw_calls.answered = 'Answered'` (PBX says call connected)
- `captured` = `answered AND max_duration_sec >= 20` (meaningful conversation)
- Forms: both NULL

### completed (rules-based)
- `TRUE` if ANY job in the cluster is `status='Archived' AND job_status=
  'Completed' AND task_invoices_total_ex > 0`
- Multi-job clusters: `job_value` sums across all jobs; `completed` checks
  ANY job
- Single-job: checks the primary job directly

### Campaign Attribution (with Quinn LP fallback)
- Primary: `wc.lp_gad_campaignid → lkp_campaign`
- Fallback: `opportunity.campaign → lkp_campaign` (for Quinn paid forms
  where WC has no record but the email carries the gad_campaignid)

### Funnel Stage Taxonomy — Two Workstreams

**DATA-DRIVEN (this build, objective, no human judgment):**
- Not Captured (dropped/missed/unanswered — `raw_calls.answered`)
- Captured (answered AND ≥20s)
- Booked (tied to ≥1 AroFlo job; clustering-aware: one opp = one booking,
  not one per jobnumber)
- Completed (Archived+Completed+invoiced>0) + revenue (cluster-summed)
- Revenue vs spend / ROAS per paid segment (`vw_economics`)

**QUALITATIVE (separate workstream — physical review now, AI review later;
NOT this build):**
- `quotable`, `loss_reason` (DNP), `csr_quality`, `disposition`, `lead_class`
- All NULL in `vw_lead_enriched` — populated by 836-import + AI + Firestore
  overrides at read time
- No rate that divides by a qualitative field (e.g. booking-rate-vs-quotable)
  can be computed until that workstream lands
- Report objective stages as COUNTS, not rates-against-qualified
- The discussion paper's booking/conversion rates use a qualitative 'quotable'
  denominator and CANNOT be reconciled by this build — that comparison waits
  for the classification workstream

## §10 Known Attribution Gaps (Website-Side)

Standing facts the CRM compensates for. Parallel website fixes noted.

### Quinn Landing Pages — No WC Snippet
- Live since 27 Feb 2026. Carry NO WhatConverts tracking snippet.
- 0/21 paid Quinn LP forms appeared in WC during Dec–May.
- **CRM compensation**: email form parser (§5 Tier 1) ingests the form email
  which carries full `gad_campaignid`/`gclid`/`utm_*` attribution.
- **Website fix needed**: add WC tracking to Quinn LPs.

### ETTR WPForms — Persistent WC Gap
- ~5 ETTR WordPress forms/month never reach WC (PTTR forms are fine post-Jan).
- **CRM compensation**: email form parser (§5 Tier 3) ingests them.
- **Website fix needed**: instrument all ETTR form types (Generic/Booking/
  Question) with WC snippet.

### WPForms Main-Site Plugin — No UTM Passthrough
- The WPForms plugin on plumbertotherescue.com.au and electriciantotherescue.
  com.au strips UTM/referrer/gclid at form submit.
- Main-site forms are brand-only attribution permanently until the plugin is
  reconfigured to pass through URL parameters.
- **CRM impact**: Tier 3 forms can only be attributed to "PTTR website" or
  "ETTR website", not to a specific campaign. This is a ceiling, not a bug.

## §11 Baseline + Reconciliation — BUILT

### Opportunity Baseline (Dec 2025 – May 2026)
- **2,270 opportunities** (supersedes all earlier figures; 1,732 retired)
- WC attribution: ~37%
- No-inbound (AroFlo job, no matching call/form): 153
- **329 completed COD jobs reconcile exactly** to AroFlo truth
  (311 distinct completed opportunities covering 326 in-window + 3 pre-window)

### Email Form Ingestion Impact — SETTLED
- 20 genuinely-new opportunities from email forms (no prior call/WC/job)
- +19 net baseline delta (20 new − 1 merge from email bridging)
- 25 former no-inbound job-opps reclassified to form-first (not new opps)
- Tier-1 detection: clean, no false positives (tawk/mrwasher excluded by
  sender allowlist + RE: filter)

### Quinn ROAS — SETTLED
- Quinn-Suburb/Quinn-Smart total attributed: 155 opportunities (Feb–May)
- Quinn ROAS adjustment from email form parsing: **+4 opps** (May 2026,
  all Plumbing/Smart — campaigns where WC call tracking wasn't yet capturing
  form-only visitors). For Feb–Apr, 28/28 paid Quinn forms merged into opps
  that WC had already attributed to the same Quinn campaign via the phone
  call. The form email is a forward-looking safety net, not a historical
  correction.
- "0/21 in WC" = no WC form record (customer often in WC via their call).
  28 of 33 Quinn-form-containing opps already had Quinn attribution from WC.

### Answer Rate vs Capture Rate (Dec–May, call-type opps)
- Answered (PBX connected): 94.0%
- Captured (answered + ≥20s): 83.2%
- Gap (10.8pp / 192 opps): calls that connected but lasted <20s

## §12 Build Status

### BUILT
- [x] Multi-source spine (call + WC form + email form), sender-agnostic
- [x] Tiered email form ingestion (Quinn Paid / Quinn Organic / WPForms)
- [x] Quinn paid recovery + April sender-transition fix
- [x] Connected-component opportunity clustering (phone OR email, 30 days)
- [x] AroFlo job contact hierarchy (task contact → site → client → description)
- [x] PM/Account exclusion from COD funnel
- [x] DID → trade lookup + campaign → type/division lookup
- [x] Profile resolution ladder (DID → WC → AroFlo → Unknown)
- [x] answered vs captured (distinct fields, correct semantics)
- [x] completed reconciliation (329/329 to AroFlo)
- [x] After-hours 8x8 confirmation (98.4% match to answering-service emails)
- [x] Deterministic idempotent opportunity IDs
- [x] Drift alarm queries (DID + campaign lookup coverage)
- [x] Transcript coverage map (0% pre-April, 83% May)

### PLANNED
- [ ] Answering-service email content as enrichment store (§8) — keyed by
      opportunity_id, linked on detail page + classifier input. High-value
      pre-April substitute for missing 8x8 transcripts.
- [ ] Classification phase: disposition, loss_reason, csr_quality from
      836-import + AI + Firestore overrides

### SETTLED (economics phase prerequisites)
- [x] Net-new counts tied out: 20 genuinely new, +19 baseline, ±1 from merge
- [x] Tier-1 false positive check: clean (tawk excluded by sender list)
- [x] Quinn ROAS wording: +4 real uplift, 28/28 Feb–Apr already WC-attributed

## §13 Key Files

| File | Purpose |
|---|---|
| `bigquery/vw_leads_unified.sql` | **Canonical** — deployed spine (call + form + email) |
| `bigquery/vw_lead_enriched.sql` | **Canonical** — deployed lean read surface |
| `bigquery/build_opportunities.sql` | **Canonical** — materialized opportunity clustering script |
| `bigquery/view-definitions.sql` | Reference/audit copy of ALL BQ view DDL (not deployment source) |
| `bigquery/archive/` | Superseded versions (v1, v2, v3_view) — do not edit |
| `HANDOVER.md` | CRM app (Next.js) technical handover |
