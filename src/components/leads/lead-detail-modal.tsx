'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { FunnelStageBadge } from '@/components/shared/status-badge'
import { LeadClassification } from '@/components/leads/lead-classification'
import { formatPhone, formatCurrency, formatDate, formatOpportunityLabel } from '@/lib/format'
import { authFetch } from '@/lib/auth/auth-fetch'
import { ChevronDown, ChevronLeft, ChevronRight, PhoneIncoming, PhoneOutgoing, Mail, Send, FileText } from 'lucide-react'
import type { Lead, LeadInteraction, JobHistory } from '@/types/database'

// ─── TYPES + HELPERS ────────────────────────────────────────────────────────

interface InteractionDetail {
  operator?: string; operator_name?: string; caller_phone?: string
  duration_seconds?: number; full_transcript?: string
  recording_url?: string; wc_recording_url?: string; call_datetime?: string
  from_address?: string; to_address?: string; subject?: string
  email_body?: string; submitted_at?: string
}

interface JobValidation {
  jobnumber: string; client_name: string; task_type: string; status: string
  job_status: string; display_status: string; job_value: number | null
  suburb: string | null; address: string | null; customer_type: string
}

interface LeadDetailModalProps {
  lead: Lead | null; open: boolean
  onOpenChange: (open: boolean) => void
  onClassify?: (opportunityId: string, stage: string, subStatus: string) => void
  onNavigate?: (direction: 'prev' | 'next') => void
  canPrev?: boolean; canNext?: boolean; position?: string
  onJobLinked?: (opportunityId: string) => void
}

function interactionTypeKey(type: string): 'call' | 'email' | 'form' | null {
  const t = type?.toLowerCase() ?? ''
  if (t.includes('call') || t.includes('phone')) return 'call'
  if (t.includes('form') && t.includes('submission')) return 'form'
  if (t.includes('answering service')) return 'email'
  if (t.includes('email')) return 'email'
  return null
}

function InteractionIcon({ type }: { type: string }) {
  const t = type?.toLowerCase() ?? ''
  if (t.includes('answering service')) return <PhoneIncoming className="h-3.5 w-3.5 text-orange-500" />
  if (t.includes('inbound') && t.includes('call')) return <PhoneIncoming className="h-3.5 w-3.5 text-green-600" />
  if (t.includes('outbound') && t.includes('call')) return <PhoneOutgoing className="h-3.5 w-3.5 text-blue-500" />
  if (t.includes('inbound') && t.includes('email')) return <Mail className="h-3.5 w-3.5 text-green-600" />
  if (t.includes('outbound') && t.includes('email')) return <Send className="h-3.5 w-3.5 text-blue-500" />
  if (t.includes('form')) return <FileText className="h-3.5 w-3.5 text-purple-500" />
  if (t.includes('call')) return <PhoneIncoming className="h-3.5 w-3.5 text-green-600" />
  if (t.includes('email')) return <Mail className="h-3.5 w-3.5 text-green-600" />
  return <FileText className="h-3.5 w-3.5 text-muted-foreground" />
}

function stripHtml(html: string | null | undefined): string {
  if (!html) return ''
  return html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\n{3,}/g, '\n\n').trim()
}

// ─── INLINE INTERACTION DETAIL ──────────────────────────────────────────────

function InlineInteractionDetail({ ix, lead }: { ix: LeadInteraction; lead: Lead }) {
  const [detail, setDetail] = useState<InteractionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null)
  const [recordingLoading, setRecordingLoading] = useState(false)
  const type = interactionTypeKey(ix.interaction_type)
  const isCall = type === 'call'

  useEffect(() => {
    setLoading(true)
    setDetail(null)
    setRecordingUrl(null)
    const callId = ix.call_id || ix.interaction_id
    authFetch(`/api/leads/${lead.lead_id}/interaction?type=${type}&call_id=${encodeURIComponent(callId)}&datetime=${encodeURIComponent(ix.interaction_datetime)}`)
      .then(r => r.json())
      .then(data => setDetail(data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [ix.interaction_id, ix.call_id, lead.lead_id, ix.interaction_datetime, type])

  // Fetch recording
  useEffect(() => {
    if (!detail?.recording_url && !detail?.wc_recording_url) return
    let cancelled = false
    setRecordingLoading(true)
    async function fetchRec() {
      if (detail?.wc_recording_url) {
        try {
          const r = await authFetch(`/api/recordings/wc?url=${encodeURIComponent(detail.wc_recording_url)}`)
          if (r.ok) { const d = await r.json(); if (!cancelled) setRecordingUrl(d.url); return }
        } catch {}
      }
      if (detail?.recording_url) {
        try {
          const r = await authFetch(`/api/recordings?uri=${encodeURIComponent(detail.recording_url)}`)
          if (r.ok) { const d = await r.json(); if (!cancelled) setRecordingUrl(d.url); return }
        } catch {}
      }
    }
    fetchRec().finally(() => { if (!cancelled) setRecordingLoading(false) })
    return () => { cancelled = true }
  }, [detail?.recording_url, detail?.wc_recording_url])

  if (loading) return <div className="px-4 py-2"><Skeleton className="h-20 w-full" /></div>

  if (isCall) {
    const shortCall = !detail?.full_transcript && !recordingUrl && !recordingLoading &&
      ix.interaction_duration_seconds != null && ix.interaction_duration_seconds < 10
    return (
      <div className="px-4 py-2 bg-muted/20 border-t border-muted/40 space-y-2">
        {recordingLoading && <Skeleton className="h-8 w-full rounded" />}
        {recordingUrl && <audio controls className="w-full h-8" src={recordingUrl} preload="none" />}
        {shortCall ? (
          <p className="text-[12px] text-muted-foreground">
            No recording — {ix.interaction_duration_seconds}s call does not meet recording threshold
          </p>
        ) : (
          <div className="text-[13px] whitespace-pre-wrap bg-muted/40 rounded p-3 max-h-[300px] overflow-y-auto leading-relaxed">
            {detail?.full_transcript || 'No transcript available.'}
          </div>
        )}
      </div>
    )
  }

  // Email / form
  return (
    <div className="px-4 py-2 bg-muted/20 border-t border-muted/40 space-y-2">
      <div className="text-[11px] text-muted-foreground space-y-0.5">
        {detail?.from_address && <div>From: {detail.from_address}</div>}
        {detail?.to_address && <div>To: {detail.to_address}</div>}
        {detail?.subject && <div className="font-medium">{detail.subject}</div>}
      </div>
      <div className="text-[13px] whitespace-pre-wrap bg-muted/40 rounded p-3 max-h-[300px] overflow-y-auto leading-relaxed">
        {detail?.email_body || 'No content available.'}
      </div>
    </div>
  )
}

// ─── LINK JOB ──────────────────────────────────────────────────────────────

function LinkJobField({ lead, onLinked }: { lead: Lead; onLinked?: () => void }) {
  const [input, setInput] = useState('')
  const [validating, setValidating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [candidate, setCandidate] = useState<JobValidation | null>(null)
  const [error, setError] = useState<string | null>(null)
  const hasManualJob = !!lead.manual_job_number
  const hasAutoJob = !!lead.all_jobnumbers && !lead.manual_job_number

  async function validate() {
    const jn = input.replace(/^[#jJnN\s]+/, '').trim()
    if (!jn || !/^\d{4,7}$/.test(jn)) {
      setError('Enter a valid job number (4-7 digits)')
      return
    }
    setError(null)
    setValidating(true)
    setCandidate(null)
    try {
      const r = await authFetch(`/api/leads/${lead.lead_id}/link-job?jobnumber=${encodeURIComponent(jn)}`)
      if (!r.ok) {
        const data = await r.json()
        setError(data.error || 'Job not found')
        return
      }
      setCandidate(await r.json())
    } catch {
      setError('Failed to validate job')
    } finally {
      setValidating(false)
    }
  }

  async function confirm() {
    if (!candidate) return
    setSaving(true)
    try {
      const r = await authFetch(`/api/leads/${lead.lead_id}/link-job`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobnumber: candidate.jobnumber }),
      })
      if (r.ok) {
        setCandidate(null)
        setInput('')
        onLinked?.()
      }
    } finally {
      setSaving(false)
    }
  }

  async function unlink() {
    setSaving(true)
    try {
      await authFetch(`/api/leads/${lead.lead_id}/link-job`, { method: 'DELETE' })
      onLinked?.()
    } finally {
      setSaving(false)
    }
  }

  if (hasAutoJob && !hasManualJob) return null // auto-linked, no manual override needed

  return (
    <div className="px-5 py-2 border-b">
      {hasManualJob ? (
        <div className="flex items-center gap-2 text-[13px]">
          <Badge variant="secondary" className="bg-blue-100 text-blue-800 text-[10px]">Manually Linked</Badge>
          <span className="font-medium tabular-nums">Job #{lead.manual_job_number}</span>
          <button className="text-[11px] text-red-600 hover:underline ml-auto" onClick={unlink} disabled={saving}>
            {saving ? 'Removing...' : 'Remove link'}
          </button>
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={input}
              onChange={e => { setInput(e.target.value); setError(null); setCandidate(null) }}
              onKeyDown={e => { if (e.key === 'Enter') validate() }}
              placeholder="Link job — enter AroFlo job number (e.g. 142819)"
              className="flex-1 text-[13px] border rounded px-2 py-1 placeholder:text-muted-foreground/60"
            />
            <Button size="sm" variant="outline" onClick={validate} disabled={validating || !input.trim()}>
              {validating ? 'Checking...' : 'Look up'}
            </Button>
          </div>
          {error && <p className="text-[12px] text-red-600">{error}</p>}
          {candidate && (
            <div className="bg-blue-50 rounded p-2 text-[13px] space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-blue-900">Job #{candidate.jobnumber}</span>
                <span className="text-blue-700">{candidate.client_name}</span>
                <Badge variant="secondary" className="text-[10px]">{candidate.display_status}</Badge>
              </div>
              <div className="text-[12px] text-blue-800">
                {candidate.task_type}
                {candidate.address && <span> — {candidate.address}</span>}
                {candidate.job_value != null && candidate.job_value > 0 && <span className="font-medium"> — {formatCurrency(candidate.job_value)}</span>}
              </div>
              <div className="flex gap-2 pt-1">
                <Button size="sm" onClick={confirm} disabled={saving}>
                  {saving ? 'Linking...' : 'Link this job'}
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setCandidate(null); setInput('') }}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── MAIN COMPONENT ─────────────────────────────────────────────────────────

export function LeadDetailModal({ lead, open, onOpenChange, onClassify, onNavigate, canPrev, canNext, position, onJobLinked }: LeadDetailModalProps) {
  const [interactions, setInteractions] = useState<LeadInteraction[]>([])
  const [loading, setLoading] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [saving, setSaving] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const [jobHistory, setJobHistory] = useState<JobHistory[]>([])
  const [jobHistoryLoading, setJobHistoryLoading] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [notes, setNotes] = useState<any[]>([])
  const [notesLoading, setNotesLoading] = useState(false)
  const [expandedIx, setExpandedIx] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!lead || !open) {
      setInteractions([]); setJobHistory([]); setNoteOpen(false); setExpandedIx(new Set())
      return
    }
    async function fetchInteractions() {
      setLoading(true)
      const res = await authFetch(`/api/leads/${lead!.lead_id}/interactions`)
      const data: LeadInteraction[] = await res.json().then(r => Array.isArray(r) ? r : [])
      setInteractions(data)
      // Auto-expand the most recent interaction
      if (data.length > 0) setExpandedIx(new Set([data[0].interaction_id || data[0].call_id || '0']))
      setLoading(false)
    }
    async function fetchJobHistory() {
      setJobHistoryLoading(true)
      const r = await authFetch(`/api/leads/${lead!.lead_id}/job-history`)
      setJobHistory(await r.json().then((d: unknown) => Array.isArray(d) ? d : []))
      setJobHistoryLoading(false)
    }
    async function fetchNotes() {
      setNotesLoading(true)
      const r = await authFetch(`/api/leads/${lead!.lead_id}/notes`)
      setNotes(await r.json().then((d: unknown) => Array.isArray(d) ? d : []))
      setNotesLoading(false)
    }
    fetchInteractions(); fetchJobHistory(); fetchNotes()
  }, [lead, open])

  const toggleIx = useCallback((id: string) => {
    setExpandedIx(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  const convertedJob = useMemo(() => {
    if (!lead || !jobHistory?.length) return null
    const ld = new Date(lead.lead_date || lead.lead_datetime)
    if (isNaN(ld.getTime())) return null
    const cut = new Date(ld.getTime() + 30 * 86400000)
    let best: JobHistory | null = null, bestD = Infinity
    for (const j of jobHistory) {
      const jd = new Date(j.requested_date)
      if (!isNaN(jd.getTime()) && jd >= ld && jd <= cut) {
        const d = Math.abs(jd.getTime() - ld.getTime())
        if (d < bestD) { bestD = d; best = j }
      }
    }
    return best
  }, [lead, jobHistory])

  if (!lead) return null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[70vw] min-w-[960px] sm:max-w-none overflow-hidden p-0">
        <div className="flex h-full">
          {/* ── LEFT: scrollable lead context ── */}
          <div className="flex-1 flex flex-col min-w-0 border-r">
            {/* Header */}
            <div className="px-5 py-3 border-b shrink-0">
              {onNavigate && (
                <div className="flex items-center gap-2 mb-1.5">
                  <button className="p-1 rounded hover:bg-muted disabled:opacity-30" disabled={!canPrev} onClick={() => onNavigate('prev')}><ChevronLeft className="h-4 w-4" /></button>
                  {position && <span className="text-[11px] text-muted-foreground tabular-nums">{position}</span>}
                  <button className="p-1 rounded hover:bg-muted disabled:opacity-30" disabled={!canNext} onClick={() => onNavigate('next')}><ChevronRight className="h-4 w-4" /></button>
                  {!lead.is_overridden && <Badge variant="secondary" className="bg-amber-100 text-amber-800 text-[10px] ml-auto">Needs Review</Badge>}
                </div>
              )}
              <SheetHeader className="p-0">
                <SheetTitle className="text-[18px] font-semibold leading-tight font-[family-name:var(--font-display)]">
                  {lead.contact_name || 'Unknown'}
                  {lead.is_existing_client && (
                    <Badge variant="secondary" className="bg-green-100 text-green-800 text-[10px] ml-2 align-middle font-normal">Existing Client</Badge>
                  )}
                  <span className="text-[12px] text-muted-foreground font-normal ml-2 tabular-nums">
                    {formatOpportunityLabel(lead)} · {formatDate(lead.lead_date)}
                  </span>
                </SheetTitle>
              </SheetHeader>
              <div className="flex items-center gap-3 mt-2 flex-wrap text-[13px]">
                {lead.funnel_stage && <FunnelStageBadge stage={lead.funnel_stage} />}
                {lead.job_value != null && lead.job_value > 0 && <span className="font-medium tabular-nums">{formatCurrency(lead.job_value)}</span>}
                {lead.business_hours_flag === 'After Hours' && <Badge variant="secondary" className="bg-orange-100 text-orange-800 text-xs">After Hours</Badge>}
              </div>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto">
              {/* Contact info */}
              <div className="px-5 py-2 flex gap-5 text-[13px] border-b">
                {lead.phone_norm && <div><span className="text-muted-foreground">Phone</span> <span className="ml-1 tabular-nums">{formatPhone(lead.phone_norm)}</span></div>}
                {lead.email && <div><span className="text-muted-foreground">Email</span> <span className="ml-1">{lead.email}</span></div>}
                {lead.suburb && <div><span className="text-muted-foreground">Suburb</span> <span className="ml-1">{lead.suburb}</span></div>}
              </div>

              {/* Converted job bar */}
              {convertedJob && (() => {
                const active = convertedJob.job_source === 'active'
                const bg = active ? 'bg-blue-50' : 'bg-green-50'
                const txt = active ? 'text-blue-800' : 'text-green-800'
                const val = convertedJob.task_invoices_total_ex && convertedJob.task_invoices_total_ex > 0
                  ? formatCurrency(convertedJob.task_invoices_total_ex) : null
                return (
                  <div className={`px-5 py-2 border-b ${bg} text-[13px] flex items-center gap-2`}>
                    <span className={`font-semibold ${txt}`}>Job #{convertedJob.jobnumber}</span>
                    {(convertedJob.primary_work_type || convertedJob.task_type) && <span className={active ? 'text-blue-700' : 'text-green-700'}>{convertedJob.primary_work_type || convertedJob.task_type}</span>}
                    <Badge variant="secondary" className={`text-xs ${active ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'}`}>{convertedJob.display_status}</Badge>
                    {val && <span className={`font-semibold ${txt} tabular-nums`}>{val}</span>}
                  </div>
                )
              })()}

              {/* Interactions — inline expand */}
              <div className="px-5 py-3">
                <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-[0.05em] mb-2">Interactions</h3>
                {loading ? (
                  <div className="space-y-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
                ) : !interactions?.length ? (
                  <p className="text-[13px] text-muted-foreground py-2">
                    {lead.captured ? 'Captured — interaction detail not yet linked' : 'No interactions recorded.'}
                  </p>
                ) : interactions.map((ix, i) => {
                  const ixId = ix.interaction_id || ix.call_id || String(i)
                  const isExpanded = expandedIx.has(ixId)
                  return (
                    <div key={ixId} className="border-t border-muted/50">
                      <div
                        className="flex items-center gap-2 py-1.5 px-1 cursor-pointer hover:bg-muted/30 transition-colors text-[13px]"
                        onClick={() => toggleIx(ixId)}
                      >
                        <InteractionIcon type={ix.interaction_type} />
                        <span className="tabular-nums text-muted-foreground">{formatDate(ix.interaction_date, 'd MMM')}</span>
                        <span className="tabular-nums text-muted-foreground">{ix.interaction_time || ''}</span>
                        <span className="text-foreground">{ix.interaction_operator || ''}</span>
                        {ix.interaction_duration_seconds ? (
                          <span className="text-muted-foreground tabular-nums ml-auto">
                            {Math.floor(ix.interaction_duration_seconds / 60)}m{ix.interaction_duration_seconds % 60 ? ` ${ix.interaction_duration_seconds % 60}s` : ''}
                          </span>
                        ) : <span className="ml-auto" />}
                        <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground/50 transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
                      </div>
                      {isExpanded && <InlineInteractionDetail ix={ix} lead={lead} />}
                    </div>
                  )
                })}
              </div>

              <Separator />

              {/* Link Job */}
              <LinkJobField lead={lead} onLinked={() => {
                // Re-fetch job history and notify parent to re-fetch lead data
                authFetch(`/api/leads/${lead.lead_id}/job-history`)
                  .then(r => r.json()).then((d: unknown) => setJobHistory(Array.isArray(d) ? d : []))
                onJobLinked?.(lead.lead_id)
              }} />

              {/* Job History */}
              <div className="px-5 py-3">
                <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-[0.05em] mb-2">Job History</h3>
                {jobHistoryLoading ? (
                  <div className="space-y-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
                ) : !jobHistory?.length ? (
                  <p className="text-[13px] text-muted-foreground py-2">No job history found.</p>
                ) : (
                  <table className="w-full text-[13px]" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
                    <thead>
                      <tr>
                        <th className="text-left text-[11px] uppercase tracking-[0.05em] font-medium text-muted-foreground pb-1 pr-3">Date</th>
                        <th className="text-left text-[11px] uppercase tracking-[0.05em] font-medium text-muted-foreground pb-1 pr-3">Job #</th>
                        <th className="text-left text-[11px] uppercase tracking-[0.05em] font-medium text-muted-foreground pb-1 pr-3">Type</th>
                        <th className="text-left text-[11px] uppercase tracking-[0.05em] font-medium text-muted-foreground pb-1 pr-3">Status</th>
                        <th className="text-right text-[11px] uppercase tracking-[0.05em] font-medium text-muted-foreground pb-1">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {jobHistory.map((job, i) => (
                        <tr key={i} className={`hover:bg-muted/30 ${job.job_source === 'active' ? 'bg-blue-50/50' : ''}`}>
                          <td className="py-1 pr-3 border-t border-muted/50 tabular-nums">{formatDate(job.requested_date, 'd MMM yyyy')}</td>
                          <td className="py-1 pr-3 border-t border-muted/50 font-medium tabular-nums">{job.jobnumber}</td>
                          <td className="py-1 pr-3 border-t border-muted/50">{job.primary_work_type || job.task_type || '—'}</td>
                          <td className="py-1 pr-3 border-t border-muted/50">
                            {job.job_source === 'active'
                              ? <Badge variant="secondary" className="bg-blue-100 text-blue-800 text-xs">{job.display_status || 'Active'}</Badge>
                              : (job.display_status || '—')}
                          </td>
                          <td className="py-1 text-right border-t border-muted/50 tabular-nums">
                            {job.task_invoices_total_ex && job.task_invoices_total_ex > 0
                              ? formatCurrency(job.task_invoices_total_ex)
                              : job.quote_totalex && job.quote_totalex > 0
                                ? <span className="text-muted-foreground">Q: {formatCurrency(job.quote_totalex)}</span>
                                : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <Separator />

              {/* Notes */}
              <div className="px-5 py-3">
                <button className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground uppercase tracking-[0.05em]" onClick={() => setNoteOpen(!noteOpen)}>
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${noteOpen ? '' : '-rotate-90'}`} />
                  Notes {notes.length > 0 && `(${notes.length})`}
                </button>
                {noteOpen && (
                  <div className="mt-2 space-y-2">
                    {notesLoading ? <p className="text-[12px] text-muted-foreground">Loading...</p>
                    : notes.length > 0 ? (
                      <div className="space-y-1.5 mb-2">
                        {notes.map((n) => (
                          <div key={n.id} className="text-[12px] bg-muted/40 rounded p-2">
                            <span className="text-muted-foreground">
                              {n.created_at?._seconds ? new Date(n.created_at._seconds * 1000).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}{' · '}{n.created_by || 'admin'}
                            </span>
                            <div className="mt-0.5">{n.note_text}</div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <div className="flex gap-2">
                      <Textarea placeholder="Write a note..." value={noteText} onChange={(e) => setNoteText(e.target.value)} className="flex-1 text-[13px]" rows={2} />
                      <Button size="sm" disabled={!noteText.trim() || saving} onClick={async () => {
                        setSaving(true)
                        await authFetch(`/api/leads/${lead.lead_id}/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note_text: noteText.trim() }) })
                        setNoteText('')
                        const r = await authFetch(`/api/leads/${lead.lead_id}/notes`); setNotes(await r.json())
                        setSaving(false)
                      }}>{saving ? 'Saving...' : 'Save'}</Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── RIGHT: fixed classification panel ── */}
          <div className="w-[280px] shrink-0 overflow-y-auto bg-muted/10">
            <LeadClassification lead={lead} onClassify={onClassify} />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
