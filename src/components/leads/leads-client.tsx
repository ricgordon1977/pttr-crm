'use client'

import { useState, useEffect, useCallback } from 'react'
import { LeadsTable } from './leads-table'
import { LeadDetailModal } from './lead-detail-modal'
import { authFetch } from '@/lib/auth/auth-fetch'
import type { Lead } from '@/types/database'

export function LeadsClient({ leads: initialLeads }: { leads: Lead[] }) {
  const [leads, setLeads] = useState<Lead[]>(initialLeads)
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)

  // Fetch fresh data (with overrides merged) on mount
  useEffect(() => {
    authFetch('/api/leads')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setLeads(data) })
      .catch(() => {})
  }, [])

  // Called when a classification is saved in the detail sheet
  const handleClassify = useCallback((opportunityId: string, stage: string, subStatus: string) => {
    setLeads(prev => prev.map(l =>
      l.lead_id === opportunityId
        ? { ...l, funnel_stage: stage, sub_status: subStatus, is_overridden: true }
        : l
    ))
    // Also update selectedLead so the sheet reflects it
    setSelectedLead(prev =>
      prev && prev.lead_id === opportunityId
        ? { ...prev, funnel_stage: stage, sub_status: subStatus, is_overridden: true }
        : prev
    )
  }, [])

  return (
    <>
      <LeadsTable leads={leads} onViewLead={setSelectedLead} />
      <LeadDetailModal
        lead={selectedLead}
        open={!!selectedLead}
        onOpenChange={(open) => { if (!open) setSelectedLead(null) }}
        onClassify={handleClassify}
      />
    </>
  )
}
