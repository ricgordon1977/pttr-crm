'use client'

import { useState, useEffect } from 'react'
import { Badge } from '@/components/ui/badge'
import { authFetch } from '@/lib/auth/auth-fetch'
import { ChevronDown } from 'lucide-react'
import type { Lead } from '@/types/database'

// ─── TAXONOMY ───────────────────────────────────────────────────────────────

const STAGES = {
  'Not Captured': {
    auto: true,
    subStatuses: ['Dropped Call', 'Unanswered Call'],
  },
  'Not Quotable': {
    auto: false,
    subStatuses: [
      'Outside Service Area', 'Service Not Provided', 'Strata Issue', 'Spam',
      'Customer Inquiry Only', 'Wrong Number / Contact Details', 'Technical Error',
    ],
  },
  'Not Booked': {
    auto: false,
    subStatuses: [
      'Lost / Unresponsive', 'Tenant / Strata Referral', 'Price / Minimum Call Out',
      'Capacity / Scheduling', 'Wanted Quote Over Phone', 'Customer Resolved',
      'CSR Failure', 'Other',
    ],
  },
  'Booked': {
    auto: true,
    subStatuses: [
      'Job Pending', 'Job Complete',
      'Booking Cancelled', 'Quote Only', 'Unable to Complete Job - Out of Scope',
    ],
  },
} as const

type StageName = keyof typeof STAGES

const LOSS_REASONS = [
  'Price Sensitivity', 'Competitor Speed', 'Speed to Lead', 'Wanted Same Day',
  'After Hours Pricing', 'Customer Unresponsive', 'Customer Resolved', 'Capacity',
  'Tenant / Strata', 'Talked Client Out of Booking', 'PETTR Service Issue',
  'Unknown', 'Not Applicable',
]

const LOSS_REASON_STAGES = new Set(['Not Booked', 'Booking Cancelled', 'Quote Only'])

// ─── HELPERS ────────────────────────────────────────────────────────────────

function getAutoStage(lead: Lead): { stage: string; sub_status: string } {
  // Single source of truth: BQ funnel_stage + objective fields
  if (lead.completed) return { stage: 'Booked', sub_status: 'Job Complete' }
  if (lead.booking_status === 'Booked') return { stage: 'Booked', sub_status: 'Job Pending' }
  if (lead.captured) return { stage: 'Captured', sub_status: '' } // awaiting classification
  if (lead.answered && !lead.captured) return { stage: 'Not Captured', sub_status: 'Dropped Call' }
  if (lead.lead_type === 'call' && !lead.answered) return { stage: 'Not Captured', sub_status: 'Unanswered Call' }
  // Forms/email or unknown
  if (lead.funnel_stage === 'Captured') return { stage: 'Captured', sub_status: '' }
  return { stage: 'Not Captured', sub_status: '' }
}

function stageColor(stage: string): string {
  switch (stage) {
    case 'Not Captured': return 'bg-red-100 text-red-800'
    case 'Captured': return 'bg-blue-100 text-blue-800'
    case 'Not Quotable': return 'bg-orange-100 text-orange-800'
    case 'Not Booked': return 'bg-amber-100 text-amber-800'
    case 'Booked': return 'bg-green-100 text-green-800'
    default: return 'bg-gray-100 text-gray-800'
  }
}

// ─── COMPONENT ──────────────────────────────────────────────────────────────

interface Override {
  stage: string
  sub_status: string
  loss_reason?: string | null
  note?: string | null
}

interface Props {
  lead: Lead
}

export function LeadClassification({ lead }: Props) {
  const auto = getAutoStage(lead)
  const [override, setOverride] = useState<Override | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const effective = override || { stage: auto.stage, sub_status: auto.sub_status, loss_reason: null, note: null }
  const isOverridden = override !== null
  // Captured leads awaiting human classification
  const needsClassification = !isOverridden && effective.stage === 'Captured'

  useEffect(() => {
    setLoaded(false)
    setOverride(null)
    authFetch(`/api/leads/${lead.lead_id}/classify`)
      .then(r => r.json())
      .then(data => {
        if (data && data.stage) setOverride({ stage: data.stage, sub_status: data.sub_status, loss_reason: data.loss_reason, note: data.note })
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [lead.lead_id])

  async function save(stage: string, subStatus: string, lossReason?: string | null, note?: string | null) {
    setSaving(true)
    try {
      await authFetch(`/api/leads/${lead.lead_id}/classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage, sub_status: subStatus, loss_reason: lossReason, note }),
      })
      setOverride({ stage, sub_status: subStatus, loss_reason: lossReason, note })
    } finally {
      setSaving(false)
    }
  }

  if (!loaded) return null

  const showLossReason = LOSS_REASON_STAGES.has(effective.sub_status) || effective.stage === 'Not Booked'

  return (
    <div className="px-5 py-3 border-b">
      {/* Stage bar */}
      <div className="flex items-center gap-2 mb-2">
        <button
          className="flex items-center gap-1 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider"
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? '' : '-rotate-90'}`} />
          Classification
        </button>
        <Badge className={`text-xs font-medium ${stageColor(effective.stage)}`}>
          {effective.stage}
        </Badge>
        {effective.sub_status && (
          <span className="text-[12px] text-muted-foreground">{effective.sub_status}</span>
        )}
        <span className="text-[11px] text-muted-foreground/60 ml-1">
          {isOverridden ? '(edited)' : needsClassification ? '(needs review)' : '(auto)'}
        </span>
        {saving && <span className="text-[11px] text-blue-500 ml-auto">Saving...</span>}
      </div>

      {expanded && (
        <div className="space-y-3 pl-4">
          {/* Stage pills */}
          <div className="flex flex-wrap gap-1.5">
            {['Not Captured', 'Captured', 'Not Quotable', 'Not Booked', 'Booked'].map(stage => (
              <button
                key={stage}
                className={`text-[12px] px-2.5 py-1 rounded-full border transition-colors ${
                  effective.stage === stage
                    ? stageColor(stage) + ' border-transparent font-medium'
                    : 'bg-white text-muted-foreground border-muted hover:border-foreground/30'
                }`}
                onClick={() => {
                  if (stage === auto.stage) {
                    // Clicking auto stage = clear override
                    if (isOverridden) {
                      save(auto.stage, auto.sub_status)
                      setOverride(null)
                    }
                  } else if (stage === 'Captured') {
                    // Can't manually set to Captured — it's an auto state
                    return
                  } else {
                    save(stage, '')
                  }
                }}
              >
                {stage}
                {stage === auto.stage && !isOverridden ? ' ●' : ''}
              </button>
            ))}
          </div>

          {/* Sub-status select */}
          <div>
            <div className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">Sub-status</div>
            {effective.stage === 'Captured' ? (
              <p className="text-[12px] text-muted-foreground italic">Awaiting classification — select Not Quotable or Not Booked above</p>
            ) : (
            <div className="flex flex-wrap gap-1">
              {(STAGES[effective.stage as StageName]?.subStatuses || []).map(ss => {
                const isAuto = (ss === 'Job Complete' && lead.completed) ||
                  (ss === 'Job Pending' && lead.booking_status === 'Booked' && !lead.completed) ||
                  (ss === 'Dropped Call' && lead.answered && !lead.captured) ||
                  (ss === 'Unanswered Call' && !lead.answered && lead.lead_type === 'call')
                return (
                  <button
                    key={ss}
                    className={`text-[11px] px-2 py-0.5 rounded border transition-colors ${
                      effective.sub_status === ss
                        ? 'bg-foreground text-background border-transparent font-medium'
                        : 'bg-white text-muted-foreground border-muted hover:border-foreground/30'
                    }`}
                    onClick={() => save(effective.stage, ss, effective.loss_reason, effective.note)}
                  >
                    {ss}{isAuto && effective.sub_status !== ss ? ' ●' : ''}
                  </button>
                )
              })}
            </div>
            )}
          </div>

          {/* Loss reason (only for lost/cancelled) */}
          {showLossReason && (
            <div>
              <div className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">Loss Reason</div>
              <div className="flex flex-wrap gap-1">
                {LOSS_REASONS.map(lr => (
                  <button
                    key={lr}
                    className={`text-[11px] px-2 py-0.5 rounded border transition-colors ${
                      effective.loss_reason === lr
                        ? 'bg-foreground text-background border-transparent font-medium'
                        : 'bg-white text-muted-foreground border-muted hover:border-foreground/30'
                    }`}
                    onClick={() => save(effective.stage, effective.sub_status, lr, effective.note)}
                  >
                    {lr}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Note for "Other" sub-status */}
          {effective.sub_status === 'Other' && (
            <div>
              <div className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">Note</div>
              <input
                type="text"
                className="w-full text-[12px] border rounded px-2 py-1"
                placeholder="Describe..."
                defaultValue={effective.note || ''}
                onBlur={e => {
                  if (e.target.value !== (effective.note || '')) {
                    save(effective.stage, effective.sub_status, effective.loss_reason, e.target.value)
                  }
                }}
              />
            </div>
          )}

          {/* Baseline vs override indicator */}
          {isOverridden && (
            <div className="text-[11px] text-muted-foreground border-t pt-2 mt-1">
              Auto baseline: <span className="font-medium">{auto.stage}</span>
              {auto.sub_status && <> / {auto.sub_status}</>}
              {' · '}
              <button
                className="text-blue-600 hover:underline"
                onClick={() => {
                  save(auto.stage, auto.sub_status)
                  setOverride(null)
                }}
              >
                Reset to auto
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
