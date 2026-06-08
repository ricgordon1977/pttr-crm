'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { LeadsTable } from './leads-table'
import { LeadDetailModal } from './lead-detail-modal'
import { authFetch } from '@/lib/auth/auth-fetch'
import type { Lead } from '@/types/database'

export function LeadsClient({ leads: initialLeads }: { leads: Lead[] }) {
  const [leads, setLeads] = useState<Lead[]>(initialLeads)
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [needsReviewFilter, setNeedsReviewFilter] = useState(false)

  // Fetch fresh data (with overrides merged) on mount
  useEffect(() => {
    authFetch('/api/leads')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setLeads(data) })
      .catch(() => {})
  }, [])

  // Filtered list (same logic as the table, for navigation)
  const filteredLeads = useMemo(() => {
    let result = leads
    if (needsReviewFilter) {
      result = result.filter(l => !l.is_overridden)
    }
    return result
  }, [leads, needsReviewFilter])

  // Called when a classification is saved in the detail sheet
  const handleClassify = useCallback((opportunityId: string, stage: string, subStatus: string) => {
    const excludeFromAnalysis = subStatus === 'Unable to Classify'
    setLeads(prev => prev.map(l =>
      l.lead_id === opportunityId
        ? { ...l, funnel_stage: stage, sub_status: subStatus, is_overridden: true, exclude_from_analysis: excludeFromAnalysis }
        : l
    ))
    setSelectedLead(prev =>
      prev && prev.lead_id === opportunityId
        ? { ...prev, funnel_stage: stage, sub_status: subStatus, is_overridden: true, exclude_from_analysis: excludeFromAnalysis }
        : prev
    )
  }, [])

  // Called when a manual job link is saved — re-fetch leads to get merged data
  const handleJobLinked = useCallback(() => {
    authFetch('/api/leads')
      .then(r => r.json())
      .then(data => {
        if (!Array.isArray(data)) return
        setLeads(data)
        // Update the selected lead with fresh data
        setSelectedLead(prev => {
          if (!prev) return null
          return data.find((l: Lead) => l.lead_id === prev.lead_id) || prev
        })
      })
      .catch(() => {})
  }, [])

  // Navigate to prev/next — use refs for stable callback identity
  const selectedLeadRef = useRef(selectedLead)
  selectedLeadRef.current = selectedLead
  const filteredLeadsRef = useRef(filteredLeads)
  filteredLeadsRef.current = filteredLeads

  const handleNavigate = useCallback((direction: 'prev' | 'next') => {
    const sel = selectedLeadRef.current
    const list = filteredLeadsRef.current
    if (!sel) return
    const idx = list.findIndex(l => l.lead_id === sel.lead_id)
    if (idx === -1) return
    const newIdx = direction === 'prev' ? idx - 1 : idx + 1
    if (newIdx >= 0 && newIdx < list.length) {
      setSelectedLead(list[newIdx])
    }
  }, [])

  // Current position for disabling arrows
  const currentIndex = selectedLead ? filteredLeads.findIndex(l => l.lead_id === selectedLead.lead_id) : -1

  // Adjacent lead IDs for prefetching (next 3 + prev 1)
  const adjacentLeadIds = useMemo(() => {
    if (currentIndex < 0) return undefined
    const nextIds: string[] = []
    for (let i = 1; i <= 3 && currentIndex + i < filteredLeads.length; i++) {
      nextIds.push(filteredLeads[currentIndex + i].lead_id)
    }
    return {
      prev: currentIndex > 0 ? filteredLeads[currentIndex - 1].lead_id : undefined,
      next: nextIds.length > 0 ? nextIds[0] : undefined,
      prefetch: nextIds,
    }
  }, [currentIndex, filteredLeads])

  return (
    <>
      <LeadsTable
        leads={leads}
        onViewLead={setSelectedLead}
        needsReviewFilter={needsReviewFilter}
        onNeedsReviewFilterChange={setNeedsReviewFilter}
        filteredLeads={filteredLeads}
      />
      <LeadDetailModal
        lead={selectedLead}
        open={!!selectedLead}
        onOpenChange={(open) => { if (!open) setSelectedLead(null) }}
        onClassify={handleClassify}
        onNavigate={handleNavigate}
        canPrev={currentIndex > 0}
        canNext={currentIndex >= 0 && currentIndex < filteredLeads.length - 1}
        position={currentIndex >= 0 ? `${currentIndex + 1} / ${filteredLeads.length}` : undefined}
        onJobLinked={handleJobLinked}
        onLeadUpdate={handleJobLinked}
        adjacentLeadIds={adjacentLeadIds}
      />
    </>
  )
}
