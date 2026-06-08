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
      { label: 'Not Job Related' },
      { label: 'Vodafone Orphan' },
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
      { label: 'Customer Unresponsive' },
      { label: 'Booked Elsewhere' },
      { label: 'Tenant / Strata Referral' },
      { label: 'Price / Minimum Call Out' },
      { label: 'Capacity / Scheduling' },
      { label: 'Wanted Quote Over Phone' },
      { label: 'Customer Resolved' },
      { label: 'PETTR Did Not Respond' },
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

// Legacy value mapping — translate on display
const LEGACY_SUB_STATUS: Record<string, string> = {
  'Lost / Unresponsive': 'Customer Unresponsive',
  'CSR Failure': 'Customer Unresponsive',
}

// ─── HELPERS ────────────────────────────────────────────────────────────────

function getAutoPlacement(lead: Lead): { stage: string; sub_status: string } {
  // Objective override: job linkage always wins
  if (lead.completed) return { stage: 'Booked', sub_status: 'Job Complete' }
  if (lead.booking_status === 'Booked') return { stage: 'Booked', sub_status: 'Job Pending' }
  // After-hours gap: no WC, no OHQ email, no job, no 8x8 recording (validated 0% conversion)
  // ≥20s = engaged via answering service, no contact captured → Lost/Unresponsive
  // <20s = dropped/brief/hangup → Not Captured / Dropped Call
  if (lead.is_after_hours_gap) {
    if (lead.captured) return { stage: 'Not Booked', sub_status: 'Customer Unresponsive' }
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
  if (stage === 'Not Booked' && ss === 'Customer Unresponsive') return !!(lead.is_after_hours_gap && lead.captured)
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
  const [csrCategory, setCsrCategory] = useState<string | null>(null)
  const [csrOtherText, setCsrOtherText] = useState('')
  const [csrOtherPending, setCsrOtherPending] = useState(false)
  const [otherPending, setOtherPending] = useState(false)
  const [otherText, setOtherText] = useState('')

  const raw = override || { stage: auto.stage, sub_status: auto.sub_status, loss_reason: null, note: null }
  // Translate legacy sub-status values
  const effective = {
    ...raw,
    sub_status: LEGACY_SUB_STATUS[raw.sub_status] || raw.sub_status,
  }
  const isOverridden = override !== null

  useEffect(() => {
    setLoaded(false)
    setOverride(null)
    setCsrCategory(null)
    setCsrOtherText('')
    setCsrOtherPending(false)
    authFetch(`/api/leads/${lead.lead_id}/classify`)
      .then(r => r.json())
      .then(data => {
        if (data && data.stage) setOverride({
          stage: data.stage,
          sub_status: LEGACY_SUB_STATUS[data.sub_status] || data.sub_status,
          loss_reason: data.loss_reason,
          note: data.note,
        })
        if (data && data.requires_csr_review && data.csr_review_category) {
          setCsrCategory(data.csr_review_category)
          if (data.csr_review_note) setCsrOtherText(data.csr_review_note)
        } else if (data && data.requires_csr_review) {
          setCsrCategory('Customer Service Issue')  // legacy boolean → default category
        }
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
                    onClick={() => {
                      if (label === 'Other') {
                        setOtherPending(true)
                        setOtherText(effective.note || '')
                      } else {
                        setOtherPending(false)
                        classify(stage, label)
                      }
                    }}
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

      {/* ═══ SECTION DIVIDER: Classification ↕ CSR Review ═══ */}
      <div className="pt-3 mt-3 border-t-2 border-muted/80">
        <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-[0.05em] mb-2">CSR Review</div>
        <div className="flex flex-wrap gap-[3px]">
          {['Failed to Book Job', 'Customer Service Issue', 'Complaint', 'Other'].map(cat => {
            const isActive = csrCategory === cat
            return (
              <button
                key={cat}
                disabled={saving}
                className={`text-[10px] px-1.5 py-[1px] rounded border transition-colors ${
                  isActive
                    ? 'bg-amber-600 text-white border-transparent font-medium'
                    : 'bg-white text-muted-foreground border-muted/60 hover:border-foreground/30 hover:bg-muted/30'
                }`}
                onClick={async () => {
                  if (isActive) {
                    // Deselect — clear review
                    setCsrCategory(null)
                    setCsrOtherPending(false)
                    setSaving(true)
                    try {
                      await authFetch(`/api/leads/${lead.lead_id}/classify`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ requires_csr_review: false }),
                      })
                    } finally { setSaving(false) }
                  } else if (cat === 'Other') {
                    setCsrOtherPending(true)
                    setCsrCategory(cat)
                  } else {
                    setCsrCategory(cat)
                    setCsrOtherPending(false)
                    setSaving(true)
                    try {
                      await authFetch(`/api/leads/${lead.lead_id}/classify`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ requires_csr_review: true, csr_review_category: cat }),
                      })
                    } finally { setSaving(false) }
                  }
                }}
              >
                {cat}
              </button>
            )
          })}
        </div>
        {/* CSR Other — required free text */}
        {csrOtherPending && (
          <div className="mt-1.5 space-y-1">
            <input
              type="text"
              className="w-full text-[11px] border rounded px-2 py-1"
              placeholder="Describe the issue..."
              value={csrOtherText}
              onChange={e => setCsrOtherText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && csrOtherText.trim()) {
                  setSaving(true)
                  authFetch(`/api/leads/${lead.lead_id}/classify`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ requires_csr_review: true, csr_review_category: 'Other', csr_review_note: csrOtherText.trim() }),
                  }).finally(() => { setSaving(false); setCsrOtherPending(false) })
                }
              }}
            />
            <div className="flex gap-1">
              <button
                disabled={saving || !csrOtherText.trim()}
                className="text-[10px] px-2 py-0.5 rounded bg-amber-600 text-white disabled:opacity-40"
                onClick={() => {
                  setSaving(true)
                  authFetch(`/api/leads/${lead.lead_id}/classify`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ requires_csr_review: true, csr_review_category: 'Other', csr_review_note: csrOtherText.trim() }),
                  }).finally(() => { setSaving(false); setCsrOtherPending(false) })
                }}
              >
                Save
              </button>
              <button
                className="text-[10px] px-2 py-0.5 rounded border border-muted text-muted-foreground"
                onClick={() => { setCsrOtherPending(false); setCsrCategory(null) }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {csrCategory === 'Other' && !csrOtherPending && csrOtherText && (
          <div className="mt-1 text-[10px] text-amber-700 bg-amber-50 rounded px-2 py-1">{csrOtherText}</div>
        )}
      </div>

      {/* ═══ SECTION DIVIDER: CSR Review ↕ Account ═══ */}
      <div className="pt-3 mt-3 border-t-2 border-muted/80">
        <AccountFlag lead={lead} onFlagged={() => onClassify?.(lead.lead_id, 'Account', 'Account')} />
      </div>

      {/* "Other" requires free text before saving */}
      {(otherPending || effective.sub_status === 'Other') && (
        <div className="space-y-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Reason (required)</div>
          <input
            type="text"
            className="w-full text-[11px] border rounded px-2 py-1"
            placeholder="Describe the reason..."
            value={otherPending ? otherText : (effective.note || '')}
            onChange={e => {
              if (otherPending) setOtherText(e.target.value)
            }}
            onBlur={e => {
              if (!otherPending && e.target.value !== (effective.note || '') && e.target.value.trim()) {
                classify(effective.stage, effective.sub_status, effective.loss_reason, e.target.value.trim())
              }
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && otherPending && otherText.trim()) {
                classify('Not Booked', 'Other', null, otherText.trim())
                setOtherPending(false)
              }
            }}
          />
          {otherPending && (
            <div className="flex gap-1">
              <button
                disabled={saving || !otherText.trim()}
                className="text-[10px] px-2 py-0.5 rounded bg-foreground text-background disabled:opacity-40"
                onClick={() => {
                  classify('Not Booked', 'Other', null, otherText.trim())
                  setOtherPending(false)
                }}
              >
                Save
              </button>
              <button
                className="text-[10px] px-2 py-0.5 rounded border border-muted text-muted-foreground"
                onClick={() => setOtherPending(false)}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── ACCOUNT FLAG ──────────────────────────────────────────────────────────

interface AcctResult { account_id: string; account_name: string; client_category: string; phone: string; address_suburb: string }
interface ContactResult { contact_id: string; contact_name: string; phone: string; mobile: string; email: string }

function AccountFlag({ lead, onFlagged }: { lead: Lead; onFlagged?: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [saving, setSaving] = useState(false)
  // Account search
  const [acctQuery, setAcctQuery] = useState('')
  const [acctResults, setAcctResults] = useState<AcctResult[]>([])
  const [acctSearching, setAcctSearching] = useState(false)
  const [selectedAcct, setSelectedAcct] = useState<AcctResult | null>(null)
  // Contact picker
  const [contacts, setContacts] = useState<ContactResult[]>([])
  const [contactsLoading, setContactsLoading] = useState(false)
  const [selectedContact, setSelectedContact] = useState<ContactResult | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const isAlreadyFlagged = !!lead.is_account

  async function searchAccounts(q: string) {
    setAcctQuery(q)
    if (q.length < 2) { setAcctResults([]); return }
    setAcctSearching(true)
    try {
      const r = await authFetch(`/api/accounts/search?q=${encodeURIComponent(q)}`)
      setAcctResults(await r.json())
    } finally { setAcctSearching(false) }
  }

  async function selectAccount(acct: AcctResult) {
    setSelectedAcct(acct)
    setAcctResults([])
    setAcctQuery(acct.account_name)
    setContactsLoading(true)
    try {
      const r = await authFetch(`/api/accounts/${acct.account_id}/contacts`)
      setContacts(await r.json())
    } finally { setContactsLoading(false) }
  }

  async function refreshContacts() {
    setRefreshing(true)
    try {
      await authFetch('/api/contacts/refresh', { method: 'POST' })
      if (selectedAcct) {
        const r = await authFetch(`/api/accounts/${selectedAcct.account_id}/contacts`)
        setContacts(await r.json())
      }
    } finally { setRefreshing(false) }
  }

  async function save() {
    setSaving(true)
    try {
      await authFetch(`/api/leads/${lead.lead_id}/account-flag`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: selectedAcct?.account_id || null,
          account_name: selectedAcct?.account_name || null,
          contact_id: selectedContact?.contact_id || null,
          contact_name: selectedContact?.contact_name || null,
        }),
      })
      onFlagged?.()
    } finally { setSaving(false) }
  }

  async function unflag() {
    setSaving(true)
    try {
      await authFetch(`/api/leads/${lead.lead_id}/account-flag`, { method: 'DELETE' })
      onFlagged?.()
    } finally { setSaving(false) }
  }

  if (isAlreadyFlagged) {
    return (
      <div className="space-y-1">
        <div className="text-[10px] font-semibold text-purple-700 bg-purple-50 rounded px-2 py-1.5">
          {lead.account_name ? `Account: ${lead.account_name}` : 'Flagged as Account'}
          {lead.account_contact_name && <span className="font-normal ml-1">({lead.account_contact_name})</span>}
        </div>
        <button className="text-[10px] text-red-600 hover:underline" onClick={unflag} disabled={saving}>
          {saving ? 'Removing...' : 'Remove account flag'}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <button
        className="text-[10px] w-full text-left px-2 py-1 rounded text-muted-foreground hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? '▾' : '▸'} Flag as Account
      </button>
      {expanded && (
        <div className="space-y-1.5 px-1">
          {/* Account search */}
          <input
            type="text"
            className="w-full text-[11px] border rounded px-2 py-1"
            placeholder="Search account name..."
            value={acctQuery}
            onChange={e => searchAccounts(e.target.value)}
          />
          {!selectedAcct && !acctSearching && (
            <button
              disabled={saving}
              className="text-[10px] w-full text-left px-2 py-1 rounded border border-dashed border-purple-300 text-purple-600 hover:bg-purple-50 transition-colors"
              onClick={save}
            >
              {saving ? 'Saving...' : 'Flag as Account (without linking)'}
            </button>
          )}
          {acctSearching && <p className="text-[10px] text-muted-foreground">Searching...</p>}
          {acctResults.length > 0 && !selectedAcct && (
            <div className="border rounded max-h-32 overflow-y-auto">
              {acctResults.map(a => (
                <button key={a.account_id}
                  className="w-full text-left text-[11px] px-2 py-1 hover:bg-muted/40 border-b last:border-b-0"
                  onClick={() => selectAccount(a)}
                >
                  <span className="font-medium">{a.account_name}</span>
                  {a.address_suburb && <span className="text-muted-foreground ml-1">{a.address_suburb}</span>}
                </button>
              ))}
            </div>
          )}

          {/* Contact picker */}
          {selectedAcct && (
            <div className="space-y-1">
              <div className="text-[10px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Contact</div>
              {contactsLoading ? (
                <p className="text-[10px] text-muted-foreground">Loading contacts...</p>
              ) : contacts.length > 0 ? (
                <select
                  className="w-full text-[11px] border rounded px-2 py-1"
                  value={selectedContact?.contact_id || ''}
                  onChange={e => {
                    const c = contacts.find(c => c.contact_id === e.target.value)
                    setSelectedContact(c || null)
                  }}
                >
                  <option value="">Select contact (optional)</option>
                  {contacts.map(c => (
                    <option key={c.contact_id} value={c.contact_id}>
                      {c.contact_name}{c.mobile ? ` — ${c.mobile}` : c.phone ? ` — ${c.phone}` : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-[10px] text-muted-foreground">No contacts found</p>
              )}
              <button
                className="text-[10px] text-blue-600 hover:underline"
                onClick={refreshContacts}
                disabled={refreshing}
              >
                {refreshing ? 'Refreshing...' : 'Contact not listed? Refresh from AroFlo'}
              </button>

              {/* Save */}
              <div className="flex gap-1 pt-1">
                <button
                  disabled={saving}
                  className="text-[10px] px-2 py-0.5 rounded bg-purple-600 text-white disabled:opacity-40"
                  onClick={save}
                >
                  {saving ? 'Saving...' : 'Flag as Account'}
                </button>
                <button
                  className="text-[10px] px-2 py-0.5 rounded border border-muted text-muted-foreground"
                  onClick={() => { setExpanded(false); setSelectedAcct(null); setAcctQuery(''); setContacts([]) }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
