# PETTR CRM — Lead-to-Job Matching Cascade

**Companion to:** Third-Stream Amendment, Form-Twin Join (vw_leads_unified).
**Status:** SPEC (build-ready). Produced from the June 2026 reconciliation and AI content
crawl. Not yet built.
**Date:** 2026-06-10.

---

## 1. What this solves, in one sentence

A tiered matching cascade that links inbound leads to their AroFlo jobs — deterministically
where possible, by proposal where not — replacing ad-hoc manual linking with an auditable,
confidence-scored pipeline.

## 2. The gap this closes (evidence from the reconciliation)

The June 2026 reconciliation identified 26 COD leads ($29,523) with confirmed AroFlo jobs
that the CRM's phone/email clustering didn't link. Root causes:

| Cause | Leads | Revenue | Pattern |
|---|---|---|---|
| **WPForms strips phone+email** | 19 | $21,857 | Web form has no identity; jobs@ email twin has it |
| **Phone mismatch** (called from different number) | 3 | $3,839 | WC phone ≠ AroFlo phone |
| **AroFlo job has no phone** | 3 | $2,560 | Job contact record is blank |
| **1-digit phone typo** | 1 | $310 | 84867 vs 54867 |
| **30-day timing gap** | 1 | $977 | Same phone, different cluster window |

The form-twin join (shipped, commit aa7348b) resolved **17 of 26** leads for **$21,251**
deterministically. The residual is **9 leads / ~$8,272**, classified as: 3 phone-mismatch
calls, 2 no-twin forms, 3 null-phone AroFlo jobs, 1 timing gap. This spec addresses the
full cascade including that residual and future leads matching the same patterns.

### AI content crawl findings (Pass A, Pass C)

- **Pass A** (45 NO_JOB leads): 34 had real AroFlo jobs found via content analysis.
  25 COD completed ($29,523). The dominant discovery mechanism was **name matching** (25/34),
  followed by **phone in job description text** (5/34), then **alternate phone from transcript**
  (4/34).
- **Pass C** (50 AGREE_LINKED leads, top by value): 50/50 confirmed correct. 20 of 50 had the
  phone only in the AroFlo job description free text, not in the structured phone field — the
  structured match alone would have missed them.
- **Zero mislinks found** across 50 verified links.

## 3. The cascade

Stop at first hit. Stamp every link with the tier that produced it.

### AUTO-LINK tiers (deterministic — write the link directly)

#### T1. Exact phone OR exact email

The existing clustering mechanism. Normalized E.164 phone or lowercased email, within the
30-day consecutive-silence cluster window. This is what `build_opportunities.sql` already does.

**Coverage:** catches ~85% of all lead-to-job links today.

#### T2. Form-twin hydration

**ALREADY BUILT** (vw_leads_unified, commit aa7348b). Matches phoneless WC form-leads to their
parsed jobs@ email twin (normalized first-name + ≤5 min timestamp + collision guard: single
candidate only). Recovers phone and email from the twin, then T1 links deterministically.

**Coverage:** resolved 17 of 19 WPForms gap leads (89%). Two missed because no jobs@ email
twin existed for their submission.

**Guard:** twin_candidates = 1 (no ambiguous matches). Zero collisions found across the full
dataset.

#### T3. Free-text phone/email extraction

Regex-extract AU phone numbers and email addresses from free text on BOTH sides:

- **Lead side:** call transcript (`call_transcription`), WC `lead_analysis_json`, form body
  (`form_my_problem`), OfficeHQ answering-service email body.
- **Job side:** `tasks_deduped.description`, `task_notes_deduped.note_clean`,
  `tasklabours_raw.note`.

Normalize extracted phones to E.164. Add as candidate match keys. Then run T1 (exact match)
on the expanded key set.

**Single-candidate only:** if a lead's extracted phone matches >1 job (or vice versa), do
NOT auto-link — drop to T5/T6/T7 as a proposal.

**Evidence from Pass C:** 20 of 50 verified links had the customer phone embedded in the
AroFlo job description text (e.g., `"Craig 0419 784 599"` in the task description) but NOT
in the structured phone field. T3 would catch these.

**Existing infrastructure:** `build_opportunities.sql` already has `extract_au_phone()` and
`extract_email()` temp functions for description-level extraction on the job side. The lead
side needs the same extraction applied to WC transcripts/form bodies.

**Non-customer exclusion guard:** extracted phones are filtered against the existing
non-customer exclusion lists (staff/test phones via the outbound-staff filter in
`vw_leads_unified`, known test numbers, supplier/CSR extensions) BEFORE being added as match
keys. An extracted number that belongs to staff/supplier/CSR is discarded, not matched — this
prevents auto-linking a job to a lead because the plumber's or office's number appeared in
both. The exclusion reuses the same `internal_phones` and `account_only_phones` CTEs already
in `vw_leads_unified` / `build_opportunities.sql`.

**Implementation note:** extraction runs at spine/build time (not read time). Extracted keys
are added to the `contact_points` table alongside structured keys, so the existing clustering
algorithm handles them. No new matching logic needed — just more keys fed into the same graph.

##### Bare-mobile extraction — deferred to propose tiers (validated)

T3 as shipped (commit bfd52fa) uses **labeled phone patterns only** — patterns with an
explicit prefix like `"m) 0412..."`, `"Phone: 0412..."`, `"Caller ID: 0412..."`. Result:
**0 false-positive merges, 33 legitimate same-customer merges** from un-gated extraction
on job descriptions that also have structured phones.

**Bare-mobile patterns** (unlabeled, e.g., `"Joseph Pawney - 0412 213 986"`) were tested
and **rolled back** in the same commit cycle. Results:

- 146 total merges, +1 gap lead resolved (Joseph Pawney / job 141142).
- **27 false-positive mixed-client merges** — different customers' opps merged because a
  shared/secondary phone (tenant, landlord, building manager) appeared in both descriptions.
- 89.4% structural-phone match rate; the 10.6% noise is secondary-contact numbers that
  cross-contaminate when used as auto-link keys.

**Decision:** bare-mobile extraction is **too noisy for auto-link**. The false-positive rate
(27 bad merges on 146 total = 18.5%) is unacceptable for a deterministic tier. Deferred to
**propose tiers (T5/T6/T7)** where a human confirms before any link is written. A bare-mobile-
extracted phone is a valid SIGNAL for a proposal, never a valid key for an auto-link.

#### T4. Fuzzy phone (edit-distance-1)

Matches phones that differ by exactly one digit, same length, same prefix structure.
Catches transposition and single-digit typos.

**Single-candidate only:** the fuzzy match must resolve to exactly one job. If >1 job is
within edit-distance-1, do NOT auto-link.

**Value corroboration:** if the lead has a WC `sale_value` and the candidate job has an
`invoiced_total_ex`, they must match within ±$5 (same tight tolerance as T6). A single-digit
phone typo auto-link must be strongly value-corroborated, not loosely.

**Evidence:** lead 210256081 (Valeria Kelly) had WC phone +61288584867 vs AroFlo
+61288554867 — a single-digit difference in position 7 (8→5). T4 would catch this.

**Expected volume:** ~1 lead per quarter. Low volume, high value as a safety net.

---

### THE AUTO/PROPOSE LINE

Everything above T4 auto-links. Everything below T5 proposes and waits for human confirmation.

**The principle:** a wrong auto-link cross-contaminates two customer records (expensive to
unwind, poisons attribution and revenue). A queued proposal just waits (cheap). When in doubt,
a tier goes BELOW the line, not above.

---

### PROPOSE tiers (inference — write a PROPOSAL, not a link)

**Bare-mobile-extracted phones are a valid signal here.** Phones extracted from free text
without a label prefix (e.g., `"Name - 0412..."`) are too noisy for T3 auto-link (see §3 T3
bare-mobile subsection) but ARE useful as propose-tier evidence — a human reviews the match
before it's written, which catches the secondary-contact false positives that make bare
extraction unsafe for auto-linking.

#### T5. Phone-mismatch / different-number calls

The lead and job share a customer (same name, same address/suburb, same problem) but the
phones differ (customer called from a mobile, AroFlo has their landline, or vice versa).

**Matching:** name match (fuzzy, Levenshtein ≤2 on surname) + location match (suburb or
street name) + temporal proximity (lead within ±30 days of job requested_date).

**Corroboration required:** at least ONE of:
- Exact `sale_value` ↔ `invoiced_total_ex` match (±$5)
- Full surname match (not just first name)
- Exact street address match

**Evidence:** lead 209341962 (Brittany, +61431994484) → job 140746 under Ken Binks
(+61412411500). Different phones, but content analysis confirmed same customer (caller said
"Brittany... Marrickville... oven started smoking", job description matches). Name +
suburb + problem aligned.

#### T6. Fuzzy name + suburb (corroboration-gated)

For leads with a name and suburb but no matching phone or email on either side (the residual
after T1–T5). Typically WPForms with no jobs@ twin (T2 missed) or phone calls where AroFlo
has no phone on record.

**Matching:** first-name match (case-insensitive) + suburb match (WC `city` or form suburb
↔ AroFlo `tasklocation_locationname` suburb component).

**CORROBORATION GATE — proposes ONLY if name+suburb AND ≥1 of:**
- Exact value match (`sale_value` ↔ `invoiced_total_ex`, ±$5)
- Full surname match (both first AND last name present and matching)
- Exact street address match (street number + street name)

**Bare first-name + suburb NEVER proposes.** This is the "two Steves in Eastwood" trap —
common first names in populous suburbs produce false positives. The corroboration gate
prevents this.

**Common-first-name flag:** computed at build time as first names appearing ≥20 times in
`tasks_complete.client_name` (e.g., John, David, Michael, Peter, Mark, Chris, Andrew, Paul,
Steve, Matt — illustrative, not the operative list). Common-name leads require FULL surname
match as the corroborator — value and address alone are insufficient. The threshold (≥20) is
tunable; the list is derived from the data, not hardcoded.

**Evidence:** leads 214123961 (Janet Howse) and 215756822 (Chris Kelsey) — both are WPForms
with no twin and no phone. Name + suburb + exact value match confirmed the correct AroFlo
job in the reconciliation. T6 with value corroboration would catch these.

#### T7. AI assessment (residual only)

For leads that fell through T1–T6. The AI reads ALL available content on both sides:

**Lead content:** call transcript, WC lead analysis, form fields (name, problem, address,
email), OfficeHQ answering-service email body.

**Job content:** `tasks_deduped.description`, `task_notes_deduped.note_clean` (all notes,
aggregated), `tasklabours_raw.note` (all labour entries), plus full structured identity
(location address, client address, location phone, location name, client name, contact name,
contact email, contact mobile).

**The AI must:**
1. Extract identity signals from free text on EITHER side (alternate phones, name variants,
   addresses, business names, "calling on behalf of X").
2. Reason over the union of extracted + structured signals.
3. **CITE the specific text** (transcript line, note excerpt, form field value) that drove
   the match. No uncited assertions.
4. State what matched AND what didn't match (any red flags).

**Value/address corroboration required.** The AI can propose a match but cannot override
the corroboration requirement — if the value is wildly different or the address doesn't
align, the proposal must say so and flag it for human review.

**Never auto-links.** T7 produces proposals only.

**Expected volume:** after T1–T6, the residual is single-digit leads per month. T7 is a
sweep, not a pipeline — it runs on whatever's left.

## 4. Match metadata (every link carries this)

### match_tier

`T1` through `T7`. The audit trail. Tells you how confident the system is and what logic
produced the link.

### confidence

**A priority/sort score, NOT a gate.** Derived from tier + corroborators. NOT an LLM
self-score. Reproducible and tunable. Capped at 100 for display.

**Auto-link vs propose is decided SOLELY by tier** (T1–T4 auto, T5–T7 propose). Confidence
never gates auto-link — a corroborator penalty can never demote an auto-tier (T1–T4) into a
proposal. Tier is authoritative for the auto/propose decision. Confidence is used ONLY for:
- Ranking proposals in the review queue (higher = review first).
- Display in the UI alongside match_tier.

**Scoring model:**

| Tier | Base Score | Meaning |
|---|---|---|
| T1 | 100 | Exact deterministic match |
| T2 | 95 | Deterministic via twin recovery |
| T3 | 90 | Deterministic via free-text extraction |
| T4 | 80 | Near-deterministic (edit-distance-1 + value corroboration) |
| T5 | 60 | Inferred (phone mismatch, identity corroborated) |
| T6 | 50 | Fuzzy (name+suburb, corroboration-gated) |
| T7 | 40 | AI-assessed (content reasoning, evidence-cited) |

**Corroborator adjustments (additive, clamped to [0, 100]):**

| Corroborator | Adjustment |
|---|---|
| Exact value match (±$5) | +5 |
| Full surname match | +5 |
| Exact street address match | +5 |
| Email match (either side) | +5 |
| Common first name (≥20 in AroFlo) | −10 |
| Multiple candidate jobs | −20 (and blocks auto-link at T1–T4) |

### match_reason

Structured JSON:

```json
{
  "tier": "T3",
  "matched_fields": ["phone_from_job_description"],
  "lead_phone": "+61419784599",
  "job_phone_source": "task_description: 'Craig 0419 784 599'",
  "corroborators": ["exact_value: $4255"],
  "confidence": 95,
  "evidence_text": "Job description contains 'Craig 0419 784 599' matching WC caller phone"
}
```

For T7, `evidence_text` carries the AI's cited reasoning (transcript quote, note excerpt).

Enough for a human to confirm/reject without opening AroFlo.

## 5. Human override layer

### Data model

Same pattern as `crm_lead_overrides` (Firestore). Collection: `crm_match_overrides`.

**Keyed by:** `{lead_id}_{job_number}` (stable IDs — NOT `opportunity_id`, which changes on
rebuild).

**Fields:**

| Field | Type | Purpose |
|---|---|---|
| `action` | string | `confirm` / `reject` / `manual_link` |
| `lead_id` | int | WC lead_id (stable) |
| `job_number` | string | AroFlo job number (stable) |
| `match_tier` | string | Which tier produced the link (NULL for manual_link) |
| `updated_by` | string | User ID or `auto_rule:{tier}` |
| `updated_at` | timestamp | When |
| `note` | string | Optional human note (why rejected, etc.) |

### Override precedence

1. **Human override wins** — if a human rejects an auto-link, the link is suppressed.
   If a human confirms a proposal, the link is written. If a human manually links a
   lead to a job the cascade missed, it's written with `match_tier = 'manual'`.
2. **The derived match is preserved** — the cascade's match_tier / confidence / reason
   are never overwritten by the override. Both are visible: "the system matched T3 at
   confidence 90; the human confirmed."
3. **Persists across spine rebuilds** — keyed on lead_id + job_number, not opportunity_id.
   The rebuild re-derives the cascade match, then the API merges overrides on top
   (same pattern as classification overrides).

### Guard rails

- A `reject` on an auto-link (T1–T4) is a red flag — it means the deterministic matcher
  made a mistake. Log it for cascade tuning.
- A `manual_link` that contradicts a cascade match (linking to a DIFFERENT job than the
  cascade selected) should warn the user but allow it — the human might know something
  the data doesn't.

## 6. Guardrails (cascade-level)

1. **Stop at first hit.** Once a tier matches, lower tiers don't run for that lead.
2. **Auto-tiers: single-candidate only.** If >1 candidate job matches at T1–T4, the
   lead drops to T5+ as a proposal. No auto-link on ambiguity.
3. **Propose-tiers never auto-link.** T5–T7 produce proposals that wait for human
   confirmation.
4. **When in doubt, go BELOW the line.** A wrong auto-link cross-contaminates two
   customer records — merges their call history, revenue, classification. Unwinding
   is expensive. A queued proposal just waits.
5. **Collision guard on T2/T3/T4.** If the expanded key set (twin-recovered,
   free-text-extracted, or fuzzy) matches >1 entity, the match is ambiguous and drops
   to proposal. Single-candidate is the hard requirement for auto-linking.
6. **No self-reinforcing loops.** The cascade runs once per spine rebuild. A proposal
   that gets confirmed becomes a Firestore override, not a cascade input — the cascade
   doesn't see its own proposals as evidence.

## 7. Open decision: proposal surface

**Not resolved in this spec.** The data model (proposals + confidence + match_reason +
override) is identical whether the surface is:

- **(A) Batch CSV export** — generate a proposals CSV, human reviews in a spreadsheet,
  bulk-confirm/reject via API.
- **(B) Review UI** — proposals surface in the CRM lead detail with a "confirm/reject"
  button.

Given the current residual is ~$8K across ~9 leads (single-digit monthly volume after
T1–T4), **batch-light (A) is the likely starting point.** The review UI can follow when
the proposal queue is large enough to justify it.

The spec deliberately separates the matching engine from the review surface so either
can be built independently.

## 8. Implementation sequence

1. **T1 + T2: DONE.** Phone/email clustering + form-twin hydration are shipped.
2. **T3 (free-text extraction): NEXT.** Highest expected yield — Pass C proved 20/50
   links rely on phone-in-description. The extraction functions already exist in
   `build_opportunities.sql`. Extend to cover lead-side transcripts/forms and add
   extracted keys to the contact_points table.
3. **T4 (fuzzy phone): SMALL.** Low volume (~1/quarter). Can ship as a simple
   edit-distance check in the build SQL.
4. **T5–T6 (propose tiers): AFTER T3/T4.** Only the residual after T3/T4 reaches
   these tiers. Build the Firestore proposals collection + the batch export.
5. **T7 (AI assessment): LAST.** Requires the proposal infrastructure from T5/T6.
   Volume is single-digit. Can be a manual one-off until the pipeline is built.

## 9. Validation plan (per tier, before promoting to auto)

1. **T3:** extract phones from job descriptions for ALL jobs with structured phone;
   confirm extraction matches structured phone ≥95% of the time (no systematic
   regex failures). Run on the 26 gap leads: confirm the 5 phone-in-description
   cases resolve. Check for false positives (extracted number is a supplier/CSR,
   not the customer).
2. **T4:** run edit-distance-1 across all opp↔job phone pairs; confirm zero false
   positives on single-candidate matches with value corroboration. Spot-check the
   Valeria Kelly case (the proven typo).
3. **T5/T6:** run on the post-T3/T4 residual; review every proposal manually before
   confirming. The corroboration gate should produce zero false positives on the
   test set.
4. **T7:** run on the post-T6 residual; every AI proposal is human-reviewed by
   definition.

## 10. Metrics (post-deployment)

- **Auto-link rate by tier** — what % of leads each tier catches.
- **Proposal conversion rate** — what % of T5–T7 proposals get confirmed vs rejected.
- **False-positive rate** — rejected auto-links (T1–T4). Target: 0%.
- **Residual gap** — leads with no match at any tier. Target: <5% of booked leads.
- **Revenue attributed** — $ moved from "gap-based / no job" to "job-matched" by
  the cascade. The headline business metric.
