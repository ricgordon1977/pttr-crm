'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
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
    setLeads(prev => prev.map(l =>
      l.lead_id === opportunityId
        ? { ...l, funnel_stage: stage, sub_status: subStatus, is_overridden: true }
        : l
    ))
    setSelectedLead(prev =>
      prev && prev.lead_id === opportunityId
        ? { ...prev, funnel_stage: stage, sub_status: subStatus, is_overridden: true }
        : prev
    )
  }, [])

  // Navigate to prev/next in the filtered list
  const handleNavigate = useCallback((direction: 'prev' | 'next') => {
    if (!selectedLead) return
    const idx = filteredLeads.findIndex(l => l.lead_id === selectedLead.lead_id)
    if (idx === -1) return
    const newIdx = direction === 'prev' ? idx - 1 : idx + 1
    if (newIdx >= 0 && newIdx < filteredLeads.length) {
      setSelectedLead(filteredLeads[newIdx])
    }
  }, [selectedLead, filteredLeads])

  // Current position for disabling arrows
  const currentIndex = selectedLead ? filteredLeads.findIndex(l => l.lead_id === selectedLead.lead_id) : -1

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
      />
    </>
  )
}
