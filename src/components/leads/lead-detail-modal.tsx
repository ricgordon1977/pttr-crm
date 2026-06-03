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
import { addLeadNote } from '@/lib/firebase/firestore'
import { formatPhone, formatCurrency, formatDate } from '@/lib/format'
import { authFetch } from '@/lib/auth/auth-fetch'
import { ArrowLeft, ChevronDown, ChevronRight, PhoneIncoming, PhoneOutgoing, Mail, Send, FileText } from 'lucide-react'
import type { Lead, LeadInteraction, JobHistory } from '@/types/database'

interface InteractionDetail {
  operator?: string
  operator_name?: string
  caller_phone?: string
  duration_seconds?: number
  full_transcript?: string
  recording_url?: string
  wc_recording_url?: string
  call_datetime?: string
  from_address?: string
  to_address?: string
  subject?: string
  email_body?: string
  submitted_at?: string
}

interface LeadDetailModalProps {
  lead: Lead | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function interactionTypeKey(type: string): 'call' | 'email' | null {
  const t = type?.toLowerCase() ?? ''
  if (t.includes('call') || t.includes('phone')) return 'call'
  if (t.includes('email')) return 'email'
  return null
}

function ChannelBadge({ channel }: { channel: string }) {
  const ch = channel?.toLowerCase() ?? ''
  if (ch.includes('call') || ch.includes('phone')) {
    return <Badge variant="secondary" className="bg-red-100 text-red-800 font-medium text-xs">Call</Badge>
  }
  if (ch.includes('form') || ch.includes('web')) {
    return <Badge variant="secondary" className="bg-blue-100 text-blue-800 font-medium text-xs">Form</Badge>
  }
  return <Badge variant="secondary" className="text-xs">{channel}</Badge>
}

function ProfileLabel({ profile }: { profile: string }) {
  if (profile.toLowerCase().includes('plumber')) {
    return <span className="text-[13px] text-sky-700">Plumber to the Rescue</span>
  }
  if (profile.toLowerCase().includes('electr')) {
    return <span className="text-[13px] text-amber-700">Electrician to the Rescue</span>
  }
  return <span className="text-[13px] text-muted-foreground">{profile}</span>
}

function InteractionIcon({ type }: { type: string }) {
  const t = type?.toLowerCase() ?? ''
  if (t.includes('inbound') && t.includes('call')) return <PhoneIncoming className="h-4 w-4 text-green-600" />
  if (t.includes('outbound') && t.includes('call')) return <PhoneOutgoing className="h-4 w-4 text-blue-600" />
  if (t.includes('inbound') && t.includes('email')) return <Mail className="h-4 w-4 text-green-600" />
  if (t.includes('outbound') && t.includes('email')) return <Send className="h-4 w-4 text-blue-600" />
  if (t.includes('form')) return <FileText className="h-4 w-4 text-purple-600" />
  if (t.includes('call') || t.includes('phone')) return <PhoneIncoming className="h-4 w-4 text-green-600" />
  if (t.includes('email')) return <Mail className="h-4 w-4 text-green-600" />
  return <FileText className="h-4 w-4 text-muted-foreground" />
}

function stripHtml(html: string | null | undefined): string {
  if (!html) return ''
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function hasDnp(reason: string | null | undefined): boolean {
  if (!reason) return false
  const r = reason.trim().toLowerCase()
  return r !== '' && r !== '--' && r !== '-' && r !== 'select one'
}

/** Filter interactions to within 30 days of the lead creation.
 *  Uses a 5-minute buffer before the lead time because the call that
 *  created the lead starts slightly before the lead record is created.
 *  Both lead_datetime and interaction_datetime are Sydney local (DATETIME),
 *  so we compare them as plain strings to avoid timezone conversion issues. */
function filterRecentInteractions(interactions: LeadInteraction[]): LeadInteraction[] {
  if (!Array.isArray(interactions) || interactions.length === 0) return []
  const leadDt = interactions[0]?.lead_datetime
  if (!leadDt) return interactions
  const leadDate = new Date(leadDt)
  if (isNaN(leadDate.getTime())) return interactions
  // 5 minutes before lead creation to catch the triggering call
  const windowStart = new Date(leadDate.getTime() - 5 * 60 * 1000)
  // 30 days after
  const windowEnd = new Date(leadDate.getTime() + 30 * 24 * 60 * 60 * 1000)
  return interactions.filter((ix) => {
    const ixDate = new Date(ix.interaction_datetime)
    return !isNaN(ixDate.getTime()) && ixDate >= windowStart && ixDate <= windowEnd
  })
}

export function LeadDetailModal({ lead, open, onOpenChange }: LeadDetailModalProps) {
  const [interactions, setInteractions] = useState<LeadInteraction[]>([])
  const [loading, setLoading] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [saving, setSaving] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)

  const [jobHistory, setJobHistory] = useState<JobHistory[]>([])
  const [jobHistoryLoading, setJobHistoryLoading] = useState(false)
  const [speedToLead, setSpeedToLead] = useState<number | null>(null)

  const [selectedInteraction, setSelectedInteraction] = useState<LeadInteraction | null>(null)
  const [interactionDetail, setInteractionDetail] = useState<InteractionDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null)
  const [recordingLoading, setRecordingLoading] = useState(false)
  const [recordingError, setRecordingError] = useState(false)

  useEffect(() => {
    if (!lead || !open) {
      setInteractions([])
      setSelectedInteraction(null)
      setInteractionDetail(null)
      setRecordingUrl(null)
      setRecordingLoading(false)
      setRecordingError(false)
      setNoteOpen(false)
      setJobHistory([])
      setSpeedToLead(null)
      return
    }

    async function fetchDetail() {
      setLoading(true)
      const res = await authFetch(`/api/leads/${lead!.lead_id}/detail`)
      const raw = await res.json()
      const data: LeadInteraction[] = Array.isArray(raw) ? raw : []

      if (data.length > 0) {
        setSpeedToLead(data[0].speed_to_lead_minutes)
      }

      setInteractions(filterRecentInteractions(data))
      setLoading(false)
    }

    async function fetchJobHistory() {
      if (!lead!.phone_norm && !lead!.email) return
      setJobHistoryLoading(true)
      const params = new URLSearchParams()
      if (lead!.phone_norm) params.set('phone', lead!.phone_norm)
      if (lead!.email) params.set('email', lead!.email)
      const res = await authFetch(`/api/leads/${lead!.lead_id}/job-history?${params}`)
      const raw = await res.json()
      setJobHistory(Array.isArray(raw) ? raw : [])
      setJobHistoryLoading(false)
    }

    fetchDetail()
    fetchJobHistory()
  }, [lead, open])

  // Fetch recording: WC proxy first (100% coverage), GCS signed URL fallback
  useEffect(() => {
    const gcsUri = interactionDetail?.recording_url
    const wcUrl = interactionDetail?.wc_recording_url
    if (!gcsUri && !wcUrl) return
    let cancelled = false
    setRecordingLoading(true)
    setRecordingError(false)
    async function fetchRecording() {
      // Try WC recording first (100% coverage, returns token-authenticated URL)
      if (wcUrl) {
        try {
          const res = await authFetch(`/api/recordings/wc?url=${encodeURIComponent(wcUrl)}`)
          if (res.ok) {
            const data = await res.json()
            if (!cancelled) setRecordingUrl(data.url)
            return
          }
        } catch { /* fall through to GCS */ }
      }
      // Fallback: GCS signed URL (8x8 recordings)
      if (gcsUri) {
        try {
          const res = await authFetch(`/api/recordings?uri=${encodeURIComponent(gcsUri)}`)
          if (res.ok) {
            const data = await res.json()
            if (!cancelled) setRecordingUrl(data.url)
            return
          }
        } catch { /* fall through */ }
      }
      if (!cancelled) setRecordingError(true)
    }

    fetchRecording().finally(() => {
        if (!cancelled) setRecordingLoading(false)
      })

    return () => { cancelled = true }
  }, [interactionDetail?.recording_url])

  const handleInteractionClick = useCallback(async (ix: LeadInteraction) => {
    if (!lead) return
    const type = interactionTypeKey(ix.interaction_type)
    if (!type) return

    setSelectedInteraction(ix)
    setDetailLoading(true)
    setInteractionDetail(null)
    setRecordingUrl(null)
    setRecordingLoading(false)
    setRecordingError(false)

    try {
      const res = await authFetch(
        `/api/leads/${lead.lead_id}/interaction?type=${type}&datetime=${encodeURIComponent(ix.interaction_datetime)}`
      )
      if (res.ok) {
        const data = await res.json()
        setInteractionDetail(data)
      }
    } catch (err) {
      console.error('Failed to fetch interaction detail:', err)
    } finally {
      setDetailLoading(false)
    }
  }, [lead])

  const handleBack = useCallback(() => {
    setSelectedInteraction(null)
    setInteractionDetail(null)
  }, [])

  // Derive converted job from job history — find closest job within 30 days of lead date
  const convertedJob = useMemo(() => {
    if (!lead || !Array.isArray(jobHistory) || jobHistory.length === 0) return null
    const leadDate = new Date(lead.lead_date || lead.lead_datetime)
    if (isNaN(leadDate.getTime())) return null
    const cutoff = new Date(leadDate.getTime() + 30 * 24 * 60 * 60 * 1000)

    let closest: JobHistory | null = null
    let closestDiff = Infinity
    for (const job of jobHistory) {
      const jobDate = new Date(job.requested_date)
      if (isNaN(jobDate.getTime())) continue
      if (jobDate >= leadDate && jobDate <= cutoff) {
        const diff = Math.abs(jobDate.getTime() - leadDate.getTime())
        if (diff < closestDiff) {
          closestDiff = diff
          closest = job
        }
      }
    }
    return closest
  }, [lead, jobHistory])

  if (!lead) return null

  const isCall = selectedInteraction ? interactionTypeKey(selectedInteraction.interaction_type) === 'call' : false

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[55vw] min-w-[800px] sm:max-w-none overflow-hidden p-0">
        {selectedInteraction ? (
          /* ── INTERACTION DETAIL VIEW — full sheet takeover ── */
          <div className="flex flex-col h-full">
            <div className="flex items-center gap-2 px-5 py-3 border-b shrink-0">
              <Button variant="ghost" size="icon-sm" onClick={handleBack}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <SheetHeader className="p-0 flex-1">
                <SheetTitle className="text-[15px] font-semibold">
                  Lead {lead.lead_id} — {selectedInteraction.interaction_type} — {formatDate(selectedInteraction.interaction_date, 'd MMM yyyy')} {selectedInteraction.interaction_time}
                </SheetTitle>
              </SheetHeader>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {detailLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-4 w-1/4" />
                  <Skeleton className="h-40 w-full" />
                </div>
              ) : isCall ? (
                <>
                  <div className="flex gap-6 text-[13px]">
                    <div><span className="font-semibold text-muted-foreground">Operator</span> <span className="ml-1">{interactionDetail?.operator || interactionDetail?.operator_name || selectedInteraction.interaction_operator || '—'}</span></div>
                    {selectedInteraction.interaction_duration_seconds ? (
                      <div><span className="font-semibold text-muted-foreground">Duration</span> <span className="ml-1">{selectedInteraction.interaction_duration_seconds}s</span></div>
                    ) : null}
                  </div>
                  {/* Audio player */}
                  {recordingLoading && (
                    <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                      <Skeleton className="h-8 w-full rounded" />
                    </div>
                  )}
                  {recordingError && (
                    <p className="text-[13px] text-muted-foreground">Recording unavailable.</p>
                  )}
                  {recordingUrl && (
                    <audio controls className="w-full h-8" src={recordingUrl} preload="none" />
                  )}
                  <Separator />
                  <div className="text-[13px] whitespace-pre-wrap font-mono bg-muted/40 rounded p-4 overflow-y-auto leading-relaxed" style={{ maxHeight: 'calc(100vh - 220px)' }}>
                    {interactionDetail?.full_transcript || 'No transcript available.'}
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-1 text-[13px]">
                    <div><span className="font-semibold text-muted-foreground">From</span> <span className="ml-2">{interactionDetail?.from_address || '—'}</span></div>
                    <div><span className="font-semibold text-muted-foreground">To</span> <span className="ml-2">{interactionDetail?.to_address || '—'}</span></div>
                    <div><span className="font-semibold text-muted-foreground">Subject</span> <span className="ml-2">{interactionDetail?.subject || '—'}</span></div>
                  </div>
                  <Separator />
                  <div className="text-[13px] whitespace-pre-wrap bg-muted/40 rounded p-4 overflow-y-auto leading-relaxed" style={{ maxHeight: 'calc(100vh - 180px)' }}>
                    {interactionDetail?.email_body || 'No content available.'}
                  </div>
                </>
              )}
            </div>
          </div>
        ) : (
          /* ── LEAD DETAIL + TIMELINE VIEW ── */
          <div className="flex flex-col h-full">
            {/* Header */}
            <div className="px-5 py-4 border-b shrink-0">
              <SheetHeader className="p-0">
                <SheetTitle className="text-[20px] font-semibold leading-tight">
                  {lead.contact_name || 'Unknown'}
                  <span className="text-[13px] text-muted-foreground font-normal ml-2">
                    #{lead.lead_id} &middot; {formatDate(lead.lead_date)}
                  </span>
                </SheetTitle>
              </SheetHeader>
              {lead.profile && (
                <div className="mt-0.5">
                  <ProfileLabel profile={lead.profile} />
                </div>
              )}

              {/* Compact stats row */}
              <div className="flex items-center gap-3 mt-3 flex-wrap">
                {lead.funnel_stage && <FunnelStageBadge stage={lead.funnel_stage} />}
                {lead.channel && <ChannelBadge channel={lead.channel} />}
                {lead.sales_value != null && lead.sales_value > 0 && (
                  <span className="text-[13px] font-medium">{formatCurrency(lead.sales_value)}</span>
                )}
                {speedToLead != null && (
                  <span className="text-[13px] text-muted-foreground">
                    Speed to lead: {Math.round(speedToLead)}m
                  </span>
                )}
                {lead.business_hours_flag === 'After Hours' && (
                  <Badge variant="secondary" className="bg-orange-100 text-orange-800 font-medium text-xs">After Hours</Badge>
                )}
              </div>

            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto">
              {/* Contact info */}
              <div className="px-5 py-3 flex gap-6 text-[13px] border-b">
                {lead.phone_norm && <div><span className="text-muted-foreground">Phone</span> <span className="ml-1">{formatPhone(lead.phone_norm)}</span></div>}
                {lead.email && <div><span className="text-muted-foreground">Email</span> <span className="ml-1">{lead.email}</span></div>}
                {lead.suburb && <div><span className="text-muted-foreground">Suburb</span> <span className="ml-1">{lead.suburb}</span></div>}
              </div>

              {/* Converted job bar — derived from job history, closest job within 30 days of lead */}
              {convertedJob && (() => {
                const isActive = convertedJob.job_source === 'active'
                const bg = isActive ? 'bg-blue-50' : 'bg-green-50'
                const text = isActive ? 'text-blue-800' : 'text-green-800'
                const textLight = isActive ? 'text-blue-700' : 'text-green-700'
                const dot = isActive ? 'text-blue-400' : 'text-green-400'
                const badgeCls = isActive ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'
                const desc = stripHtml(convertedJob.description)
                const hasDetail = !!(desc || convertedJob.task_notes)
                const valueDisplay = convertedJob.task_invoices_total_ex && convertedJob.task_invoices_total_ex > 0
                  ? formatCurrency(convertedJob.task_invoices_total_ex)
                  : convertedJob.quote_totalex && convertedJob.quote_totalex > 0
                    ? `Quote: ${formatCurrency(convertedJob.quote_totalex)}`
                    : null

                return (
                  <div className={`border-b ${bg}`}>
                    <div className="px-5 py-2.5 flex items-center gap-2 text-[13px]">
                      <span className={`font-semibold ${text}`}>Job #{convertedJob.jobnumber}</span>
                      <span className={dot}>&middot;</span>
                      {(convertedJob.primary_work_type || convertedJob.task_type) && (
                        <><span className={textLight}>{convertedJob.primary_work_type || convertedJob.task_type}</span><span className={dot}>&middot;</span></>
                      )}
                      <Badge variant="secondary" className={`font-medium text-xs ${badgeCls}`}>{convertedJob.display_status}</Badge>
                      {(convertedJob.job_address || convertedJob.job_suburb) && (
                        <>
                          <span className={dot}>&middot;</span>
                          <span className={textLight}>
                            {convertedJob.job_address && convertedJob.job_suburb && convertedJob.job_address.includes(convertedJob.job_suburb)
                              ? convertedJob.job_address
                              : [convertedJob.job_address, convertedJob.job_suburb].filter(Boolean).join(', ')}
                          </span>
                        </>
                      )}
                      {valueDisplay && (
                        <><span className={dot}>&middot;</span><span className={`font-semibold ${text}`}>{valueDisplay}</span></>
                      )}
                    </div>
                    {hasDetail && (
                      <div className="px-5 pb-3 space-y-2">
                        {desc && (
                          <p className="text-[12px] text-muted-foreground whitespace-pre-wrap leading-relaxed">{desc}</p>
                        )}
                        {convertedJob.task_notes && (
                          <div className="text-[12px] space-y-1">
                            <span className="font-semibold text-muted-foreground">Notes:</span>
                            <div className="whitespace-pre-wrap text-muted-foreground leading-relaxed pl-2 border-l-2 border-muted">
                              {convertedJob.task_notes}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })()}

              {/* DNP / Sub-Status */}
              {hasDnp(lead.dnp_reason) && (
                <div className="px-5 py-2 border-b text-[13px]">
                  <span className="font-medium text-red-600">Sub-Status:</span> {lead.dnp_reason}
                  {lead.dnp_detail && lead.dnp_detail !== '--' && (
                    <span className="text-muted-foreground"> — {lead.dnp_detail}</span>
                  )}
                </div>
              )}

              {/* Notes */}
              {lead.notes && (
                <div className="px-5 py-2 border-b text-[13px]">
                  <span className="font-medium">Notes:</span>
                  <span className="ml-1 text-muted-foreground">{lead.notes}</span>
                </div>
              )}

              {/* Interaction Timeline */}
              <div className="px-5 py-3">
                <h3 className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Interactions
                </h3>
                {loading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-3/4" />
                  </div>
                ) : !interactions?.length ? (
                  <p className="text-[13px] text-muted-foreground py-2">No interactions recorded.</p>
                ) : (
                  <table className="w-full text-[13px]" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
                    <thead>
                      <tr>
                        <th className="text-left font-medium text-muted-foreground text-[11px] uppercase tracking-wider pb-1.5 pr-3 w-8"></th>
                        <th className="text-left font-medium text-muted-foreground text-[11px] uppercase tracking-wider pb-1.5 pr-3">Date</th>
                        <th className="text-left font-medium text-muted-foreground text-[11px] uppercase tracking-wider pb-1.5 pr-3">Time</th>
                        <th className="text-left font-medium text-muted-foreground text-[11px] uppercase tracking-wider pb-1.5 pr-3">Operator</th>
                        <th className="text-right font-medium text-muted-foreground text-[11px] uppercase tracking-wider pb-1.5 pr-1">Dur</th>
                        <th className="pb-1.5 w-5"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {interactions.map((ix, i) => (
                        <tr
                          key={i}
                          className="cursor-pointer hover:bg-muted/40 transition-colors group"
                          onClick={() => handleInteractionClick(ix)}
                        >
                          <td className="py-1.5 pr-3 border-t border-muted/60">
                            <InteractionIcon type={ix.interaction_type} />
                          </td>
                          <td className="py-1.5 pr-3 whitespace-nowrap border-t border-muted/60">
                            {formatDate(ix.interaction_date, 'd MMM')}
                          </td>
                          <td className="py-1.5 pr-3 whitespace-nowrap border-t border-muted/60">
                            {ix.interaction_time || '—'}
                          </td>
                          <td className="py-1.5 pr-3 border-t border-muted/60">
                            {ix.interaction_operator || '—'}
                          </td>
                          <td className="py-1.5 pr-1 text-right whitespace-nowrap border-t border-muted/60 text-muted-foreground">
                            {ix.interaction_duration_seconds
                              ? `${Math.floor(ix.interaction_duration_seconds / 60)}m${ix.interaction_duration_seconds % 60 ? ` ${ix.interaction_duration_seconds % 60}s` : ''}`
                              : ''}
                          </td>
                          <td className="py-1.5 pl-1 border-t border-muted/60">
                            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 group-hover:text-foreground transition-colors" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <Separator />

              {/* Job History */}
              <div className="px-5 py-3">
                <h3 className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Job History
                </h3>
                {jobHistoryLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                  </div>
                ) : !jobHistory?.length ? (
                  <p className="text-[13px] text-muted-foreground py-2">No job history found.</p>
                ) : (
                  <table className="w-full text-[13px]" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
                    <thead>
                      <tr>
                        <th className="text-left font-medium text-muted-foreground text-[11px] uppercase tracking-wider pb-1.5 pr-3">Date</th>
                        <th className="text-left font-medium text-muted-foreground text-[11px] uppercase tracking-wider pb-1.5 pr-3">Job #</th>
                        <th className="text-left font-medium text-muted-foreground text-[11px] uppercase tracking-wider pb-1.5 pr-3">Type</th>
                        <th className="text-left font-medium text-muted-foreground text-[11px] uppercase tracking-wider pb-1.5 pr-3">Status</th>
                        <th className="text-right font-medium text-muted-foreground text-[11px] uppercase tracking-wider pb-1.5">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {jobHistory.map((job, i) => (
                        <tr key={i} className={`hover:bg-muted/40 transition-colors ${job.job_source === 'active' ? 'bg-blue-50/50' : ''}`}>
                          <td className="py-1.5 pr-3 whitespace-nowrap border-t border-muted/60">
                            {formatDate(job.requested_date, 'd MMM yyyy')}
                          </td>
                          <td className="py-1.5 pr-3 border-t border-muted/60 font-medium">
                            {job.jobnumber}
                          </td>
                          <td className="py-1.5 pr-3 border-t border-muted/60">
                            {job.primary_work_type || job.task_type || '—'}
                          </td>
                          <td className="py-1.5 pr-3 border-t border-muted/60">
                            {job.job_source === 'active'
                              ? <Badge variant="secondary" className="bg-blue-100 text-blue-800 font-medium text-xs">{job.display_status || 'Active'}</Badge>
                              : (job.display_status || '—')}
                          </td>
                          <td className="py-1.5 text-right border-t border-muted/60">
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

              {/* Add note — collapsible at bottom */}
              <div className="px-5 py-3">
                <button
                  className="flex items-center gap-1 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider"
                  onClick={() => setNoteOpen(!noteOpen)}
                >
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${noteOpen ? '' : '-rotate-90'}`} />
                  Add Note
                </button>
                {noteOpen && (
                  <div className="flex gap-2 mt-2">
                    <Textarea
                      placeholder="Write a note..."
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      className="flex-1 text-[13px]"
                      rows={2}
                    />
                    <Button
                      size="sm"
                      disabled={!noteText.trim() || saving}
                      onClick={async () => {
                        setSaving(true)
                        await addLeadNote(lead.lead_id, noteText.trim(), 'admin')
                        setNoteText('')
                        setSaving(false)
                      }}
                    >
                      {saving ? 'Saving...' : 'Save'}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
