'use client'

import { useState, useEffect } from 'react'
import { authFetch } from '@/lib/auth/auth-fetch'
import type { Lead } from '@/types/database'

// ─── TAXONOMY ───────────────────────────────────────────────────────────────

const TAXONOMY: { stage: string; subStatuses: { label: string; autoKey?: string }[] }[] = [
  {
    stage: 'Not Captured',
    subStatuses: [
      { label: 'Dropped Call', autoKey: 'dropped' },
      { label: 'Unanswered Call', autoKey: 'unanswered' },
      { label: 'Unable to Classify' },
    ],
  },
  {
    stage: 'Not Quotable',
    subStatuses: [
      { label: 'Outside Service Area' },
      { label: 'Service Not Provided' },
      { label: 'Strata Issue' },
      { label: 'Spam' },
      { label: 'Customer Inquiry Only' },
      { label: 'Wrong Number / Contact Details' },
      { label: 'Technical Error' },
    ],
  },
  {
    stage: 'Pending',
    subStatuses: [
      { label: 'Pending' },
    ],
  },
  {
    stage: 'Not Booked',
    subStatuses: [
      { label: 'Lost / Unresponsive' },
      { label: 'Tenant / Strata Referral' },
      { label: 'Price / Minimum Call Out' },
      { label: 'Capacity / Scheduling' },
      { label: 'Wanted Quote Over Phone' },
      { label: 'Customer Resolved' },
      { label: 'Other' },
    ],
  },
  {
    stage: 'Booked',
    subStatuses: [
      { label: 'Job Pending', autoKey: 'pending' },
      { label: 'Job Complete', autoKey: 'complete' },
      { label: 'Booking Cancelled' },
      { label: 'Quote Only' },
      { label: 'Unable to Complete Job - Out of Scope' },
    ],
  },
]

const LOSS_REASONS = [
  'Price Sensitivity', 'Competitor Speed', 'Speed to Lead', 'Wanted Same Day',
  'After Hours Pricing', 'Customer Unresponsive', 'Customer Resolved', 'Capacity',
  'Tenant / Strata', 'Talked Client Out of Booking', 'PETTR Service Issue',
  'Unknown', 'Not Applicable',
]

const LOSS_REASON_STAGES = new Set(['Not Booked', 'Booking Cancelled', 'Quote Only'])

// ─── HELPERS ────────────────────────────────────────────────────────────────

function getAutoPlacement(lead: Lead): { stage: string; sub_status: string } {
  // Objective override: job linkage always wins
  if (lead.completed) return { stage: 'Booked', sub_status: 'Job Complete' }
  if (lead.booking_status === 'Booked') return { stage: 'Booked', sub_status: 'Job Pending' }
  // After-hours gap: no WC, no OHQ email, no job, no 8x8 recording (validated 0% conversion)
  // ≥20s = engaged via answering service, no contact captured → Lost/Unresponsive
  // <20s = dropped/brief/hangup → Not Captured / Dropped Call
  if (lead.is_after_hours_gap) {
    if (lead.captured) return { stage: 'Not Booked', sub_status: 'Lost / Unresponsive' }
    return { stage: 'Not Captured', sub_status: 'Dropped Call' }
  }
  if (lead.captured) return { stage: 'Captured', sub_status: '' }
  if (lead.answered && !lead.captured) return { stage: 'Not Captured', sub_status: 'Dropped Call' }
  if (lead.lead_type === 'call' && !lead.answered) return { stage: 'Not Captured', sub_status: 'Unanswered Call' }
  if (lead.funnel_stage === 'Captured') return { stage: 'Captured', sub_status: '' }
  return { stage: 'Not Captured', sub_status: '' }
}

function isAutoItem(lead: Lead, stage: string, ss: string): boolean {
  if (stage === 'Not Captured' && ss === 'Dropped Call') return !!(lead.answered && !lead.captured)
  if (stage === 'Not Captured' && ss === 'Unanswered Call') return !!(lead.lead_type === 'call' && !lead.answered)
  if (stage === 'Not Booked' && ss === 'Lost / Unresponsive') return !!(lead.is_after_hours_gap && lead.captured)
  if (stage === 'Booked' && ss === 'Job Pending') return !!(lead.booking_status === 'Booked' && !lead.completed)
  if (stage === 'Booked' && ss === 'Job Complete') return !!lead.completed
  return false
}

const STAGE_COLORS: Record<string, { header: string; active: string }> = {
  'Not Captured': { header: 'text-gray-500', active: 'bg-gray-700 text-white' },
  'Not Quotable': { header: 'text-orange-600', active: 'bg-orange-600 text-white' },
  'Pending': { header: 'text-blue-600', active: 'bg-blue-600 text-white' },
  'Not Booked': { header: 'text-red-600', active: 'bg-red-600 text-white' },
  'Booked': { header: 'text-green-700', active: 'bg-green-700 text-white' },
}

// ─── COMPONENT ──────────────────────────────────────────────────────────────

interface Props {
  lead: Lead
  onClassify?: (opportunityId: string, stage: string, subStatus: string) => void
}

export function LeadClassification({ lead, onClassify }: Props) {
  const auto = getAutoPlacement(lead)
  const [override, setOverride] = useState<{ stage: string; sub_status: string; loss_reason?: string | null; note?: string | null } | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [csrReview, setCsrReview] = useState(!!lead.requires_csr_review)

  const effective = override || { stage: auto.stage, sub_status: auto.sub_status, loss_reason: null, note: null }
  const isOverridden = override !== null
  const showLossReason = LOSS_REASON_STAGES.has(effective.sub_status) || effective.stage === 'Not Booked'

  useEffect(() => {
    setLoaded(false)
    setOverride(null)
    setCsrReview(!!lead.requires_csr_review)
    authFetch(`/api/leads/${lead.lead_id}/classify`)
      .then(r => r.json())
      .then(data => {
        if (data && data.stage) setOverride({ stage: data.stage, sub_status: data.sub_status, loss_reason: data.loss_reason, note: data.note })
        if (data && data.requires_csr_review) setCsrReview(true)
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [lead.lead_id])

  async function classify(stage: string, subStatus: string, lossReason?: string | null, note?: string | null) {
    const excludeFromAnalysis = subStatus === 'Unable to Classify'
    setSaving(true)
    try {
      await authFetch(`/api/leads/${lead.lead_id}/classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stage, sub_status: subStatus,
          loss_reason: lossReason || effective.loss_reason,
          note: note ?? effective.note,
          exclude_from_analysis: excludeFromAnalysis,
        }),
      })
      setOverride({ stage, sub_status: subStatus, loss_reason: lossReason || effective.loss_reason, note: note ?? effective.note })
      onClassify?.(lead.lead_id, stage, subStatus)
    } finally {
      setSaving(false)
    }
  }

  if (!loaded) return <div className="px-4 py-2 text-[11px] text-muted-foreground">Loading...</div>

  return (
    <div className="px-3 pt-10 pb-3 space-y-2">
      {/* Header — pt-10 clears the sheet close X button */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-[0.05em]">Classification</span>
        {saving && <span className="text-[10px] text-blue-500">Saving...</span>}
        {isOverridden && (
          <button
            className="text-[10px] text-blue-600 hover:underline ml-auto"
            onClick={() => { classify(auto.stage, auto.sub_status); setOverride(null) }}
          >
            Reset to auto
          </button>
        )}
      </div>

      {/* New Lead banner (captured, awaiting classification) */}
      {effective.stage === 'Captured' && !isOverridden && (
        <div className="text-[11px] text-amber-700 bg-amber-50 rounded px-2 py-1 mb-1">
          New Lead — click a sub-status below to classify
        </div>
      )}

      {/* Vertical taxonomy */}
      {TAXONOMY.map(({ stage, subStatuses }) => {
        const colors = STAGE_COLORS[stage] || STAGE_COLORS['Not Captured']
        return (
          <div key={stage}>
            <div className={`text-[10px] font-semibold uppercase tracking-[0.05em] mb-1 ${colors.header}`}>
              {stage}
            </div>
            <div className="flex flex-wrap gap-[3px] mb-2">
              {subStatuses.map(({ label }) => {
                const isActive = effective.stage === stage && effective.sub_status === label
                const isAuto = isAutoItem(lead, stage, label)
                const isAutoNotCaptured = stage === 'Not Captured' && (label === 'Dropped Call' || label === 'Unanswered Call')
                return (
                  <button
                    key={label}
                    disabled={saving}
                    className={`text-[10px] px-1.5 py-[1px] rounded border transition-colors ${
                      isActive
                        ? colors.active + ' border-transparent font-medium'
                        : isAuto && !isActive
                          ? 'bg-muted/60 text-muted-foreground border-muted font-medium'
                          : 'bg-white text-muted-foreground border-muted/60 hover:border-foreground/30 hover:bg-muted/30'
                    } ${isAutoNotCaptured && !isActive ? 'opacity-60' : ''}`}
                    onClick={() => classify(stage, label)}
                    title={isAuto ? `Auto-detected: ${label}` : label}
                  >
                    {label}{isAuto && !isActive ? ' ●' : ''}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}

      {/* Loss reason */}
      {showLossReason && (
        <div className="pt-1 border-t border-muted/40">
          <div className="text-[10px] font-semibold uppercase tracking-[0.05em] text-muted-foreground mb-1">
            Loss Reason
          </div>
          <div className="flex flex-wrap gap-[3px]">
            {LOSS_REASONS.map(lr => (
              <button
                key={lr}
                disabled={saving}
                className={`text-[10px] px-1.5 py-[1px] rounded border transition-colors ${
                  effective.loss_reason === lr
                    ? 'bg-foreground text-background border-transparent font-medium'
                    : 'bg-white text-muted-foreground border-muted/60 hover:border-foreground/30 hover:bg-muted/30'
                }`}
                onClick={() => classify(effective.stage, effective.sub_status, lr)}
              >
                {lr}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* CSR Review flag — toggleable */}
      <div className="pt-1 border-t border-muted/40">
        <button
          disabled={saving}
          className={`text-[10px] w-full text-left px-2 py-1 rounded transition-colors ${
            csrReview
              ? 'font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100'
              : 'text-muted-foreground hover:bg-muted/30'
          }`}
          onClick={async () => {
            const next = !csrReview
            setCsrReview(next)
            setSaving(true)
            try {
              await authFetch(`/api/leads/${lead.lead_id}/classify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ requires_csr_review: next }),
              })
            } finally {
              setSaving(false)
            }
          }}
        >
          {csrReview ? '● Requires CSR Review' : '○ Flag for CSR Review'}
        </button>
      </div>

      {/* Note for "Other" */}
      {effective.sub_status === 'Other' && (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.05em] text-muted-foreground mb-1">Note</div>
          <input
            type="text"
            className="flex-1 text-[11px] border rounded px-2 py-0.5"
            placeholder="Describe..."
            defaultValue={effective.note || ''}
            onBlur={e => {
              if (e.target.value !== (effective.note || '')) {
                classify(effective.stage, effective.sub_status, effective.loss_reason, e.target.value)
              }
            }}
          />
        </div>
      )}
    </div>
  )
}
