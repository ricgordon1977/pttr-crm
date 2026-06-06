'use client'

import { type ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/shared/data-table'
import { FunnelStageBadge, AfterHoursBadge } from '@/components/shared/status-badge'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { useState, useMemo } from 'react'
import { formatPhone, formatCurrency, formatDate, formatOpportunityLabel } from '@/lib/format'
import {
  UserCheck, PhoneIncoming, FileText, Mail,
  Droplet, Zap, Search, MapPin, ArrowRight, ExternalLink, Globe,
  Link, CircleDot,
} from 'lucide-react'
import type { Lead } from '@/types/database'

function TypeIcon({ leadType }: { leadType: string }) {
  const t = leadType?.toLowerCase() ?? ''
  if (t === 'call') return <span className="inline-flex items-center gap-1 text-[13px]"><PhoneIncoming className="h-3.5 w-3.5 text-blue-500" /><span className="text-foreground">Call</span></span>
  if (t === 'form') return <span className="inline-flex items-center gap-1 text-[13px]"><FileText className="h-3.5 w-3.5 text-purple-500" /><span className="text-foreground">Form</span></span>
  if (t === 'email') return <span className="inline-flex items-center gap-1 text-[13px]"><Mail className="h-3.5 w-3.5 text-teal-500" /><span className="text-foreground">Email</span></span>
  if (t === 'direct_booking') return <span className="inline-flex items-center gap-1 text-[13px]"><ArrowRight className="h-3.5 w-3.5 text-green-500" /><span className="text-foreground">Direct</span></span>
  return <span className="text-[13px] text-muted-foreground">{leadType || '—'}</span>
}

function SourceLabel({ source }: { source: string }) {
  const s = (source || '').toLowerCase()
  if (s === 'direct' || s === '(direct)' || !s) return <span className="inline-flex items-center gap-1 text-[13px] text-gray-400"><ArrowRight className="h-3.5 w-3.5" />Direct</span>
  let icon = <Globe className="h-3.5 w-3.5" />
  let iconColor = 'text-gray-400'
  if (s === 'google') { icon = <Search className="h-3.5 w-3.5" />; iconColor = 'text-blue-600' }
  else if (s === 'gmb') { icon = <MapPin className="h-3.5 w-3.5" />; iconColor = 'text-green-600' }
  else if (s.includes('bing') || s.includes('yahoo') || s.includes('duckduckgo') || s.includes('ecosia') || s.includes('brave') || s.includes('perplexity')) { icon = <Search className="h-3.5 w-3.5" />; iconColor = 'text-blue-600' }
  else if (s.includes('facebook') || s.includes('houzz') || s.includes('yellowpages') || s.includes('localsearch')) { icon = <ExternalLink className="h-3.5 w-3.5" />; iconColor = 'text-purple-600' }
  else if (s.includes('plumbertotherescue') || s.includes('electriciantotherescue') || s.includes('lp.')) { icon = <Link className="h-3.5 w-3.5" />; iconColor = 'text-blue-600' }
  const label = s === 'gmb' ? 'GMB' : source || ''
  return <span className={`inline-flex items-center gap-1 text-[13px] ${iconColor}`}>{icon}<span>{label}</span></span>
}

function MediumLabel({ medium }: { medium: string }) {
  const m = (medium || '').toLowerCase()
  if (m === 'cpc') return <span className="text-[13px] text-red-600 font-medium">cpc</span>
  if (m === 'organic') return <span className="text-[13px] text-green-600">organic</span>
  if (m === 'referral') return <span className="text-[13px] text-purple-600">referral</span>
  if (m === '(none)' || !m) return <span className="text-[13px] text-muted-foreground/50">—</span>
  return <span className="text-[13px] text-muted-foreground">{medium}</span>
}

function ProfileIcon({ profile }: { profile: string }) {
  if (profile.toLowerCase().includes('plumber')) {
    return <span className="inline-flex items-center gap-1 text-[13px]"><Droplet className="h-3.5 w-3.5 text-sky-500" /><span className="text-foreground">PTTR</span></span>
  }
  if (profile.toLowerCase().includes('electr')) {
    return <span className="inline-flex items-center gap-1 text-[13px]"><Zap className="h-3.5 w-3.5 text-amber-500" /><span className="text-foreground">ETTR</span></span>
  }
  return <span className="text-[13px] text-muted-foreground">{profile}</span>
}

// SourceIcon and MediumIcon removed — merged into SourceMedium above

interface LeadsTableProps {
  leads: Lead[]
  onViewLead: (lead: Lead) => void
  needsReviewFilter: boolean
  onNeedsReviewFilterChange: (on: boolean) => void
  filteredLeads: Lead[]  // the filtered+sorted list for navigation
}

export function LeadsTable({ leads, onViewLead, needsReviewFilter, onNeedsReviewFilterChange, filteredLeads }: LeadsTableProps) {
  const [search, setSearch] = useState('')

  const columns: ColumnDef<Lead, unknown>[] = [
    {
      id: 'actions',
      header: '',
      enableColumnFilter: false,
      cell: ({ row }) => (
        <Badge
          variant="outline"
          className="cursor-pointer hover:bg-muted px-3 py-0.5"
          onClick={(e: React.MouseEvent) => { e.stopPropagation(); onViewLead(row.original) }}
        >
          View
        </Badge>
      ),
    },
    {
      id: 'indicators',
      header: '',
      enableColumnFilter: false,
      cell: ({ row }) => {
        const l = row.original
        return (
          <span className="inline-flex items-center gap-1">
            {!l.is_overridden && <span title="Needs review — not yet classified"><CircleDot className="h-3 w-3 text-amber-500" /></span>}
            {l.is_existing_client && <span title="Existing customer — has prior AroFlo jobs"><UserCheck className="h-3 w-3 text-green-600" /></span>}
          </span>
        )
      },
    },
    {
      accessorKey: 'lead_date',
      header: 'Date',
      enableColumnFilter: false,
      cell: ({ row }) => formatDate(row.original.lead_date),
    },
    {
      accessorKey: 'lead_id',
      header: 'ID',
      enableColumnFilter: false,
      cell: ({ row }) => <span className="text-[12px] font-[family-name:var(--font-mono)] text-muted-foreground">{formatOpportunityLabel(row.original)}</span>,
    },
    {
      accessorKey: 'funnel_stage',
      header: 'Status',
      cell: ({ row }) => {
        const l = row.original
        if (!l.funnel_stage) return '—'
        const sub = l.sub_status || l.dnp_reason
        return (
          <span className="inline-flex items-center gap-1">
            <FunnelStageBadge stage={l.funnel_stage} />
            {sub && sub !== '--' && <span className="text-[11px] text-muted-foreground/70">{sub}</span>}
            {l.is_overridden && <span className="text-[10px] text-muted-foreground/50">✎</span>}
          </span>
        )
      },
    },
    {
      accessorKey: 'lead_type',
      header: 'Type',
      cell: ({ row }) => <TypeIcon leadType={row.original.lead_type} />,
    },
    {
      accessorKey: 'profile',
      header: 'Profile',
      cell: ({ row }) => row.original.profile ? <ProfileIcon profile={row.original.profile} /> : '—',
    },
    { accessorKey: 'contact_name', header: 'Contact' },
    { accessorKey: 'phone_norm', header: 'Phone', cell: ({ row }) => <span className="font-[family-name:var(--font-mono)] text-[12px]">{formatPhone(row.original.phone_norm)}</span> },
    {
      accessorKey: 'business_hours_flag',
      header: 'AH',
      enableColumnFilter: false,
      cell: ({ row }) => row.original.business_hours_flag === 'After Hours' ? <AfterHoursBadge /> : '',
    },
    { accessorKey: 'suburb', header: 'Suburb', cell: ({ row }) => row.original.suburb ?? '—' },
    {
      accessorKey: 'operator',
      header: 'Operator',
      cell: ({ row }) => row.original.operator || '—',
    },
    {
      accessorKey: 'lead_source',
      header: 'Source',
      cell: ({ row }) => <SourceLabel source={row.original.lead_source} />,
    },
    {
      accessorKey: 'lead_medium',
      header: 'Medium',
      cell: ({ row }) => <MediumLabel medium={row.original.lead_medium} />,
    },
    {
      accessorKey: 'job_value',
      header: 'Value',
      enableColumnFilter: false,
      cell: ({ row }) => <span className="font-[family-name:var(--font-mono)] text-[12px]">{formatCurrency(row.original.job_value)}</span>,
    },
  ]

  const searchFiltered = useMemo(() => {
    let result = leads
    if (needsReviewFilter) {
      result = result.filter(l => !l.is_overridden)
    }
    if (search) {
      const term = search.toLowerCase()
      result = result.filter((l) =>
        l.contact_name?.toLowerCase().includes(term) ||
        l.phone_norm?.includes(term) ||
        l.suburb?.toLowerCase().includes(term) ||
        l.lead_source?.toLowerCase().includes(term)
      )
    }
    return result
  }, [leads, search, needsReviewFilter])

  const needsReviewCount = useMemo(() => leads.filter(l => !l.is_overridden).length, [leads])

  const filterControls = (
    <div className="flex items-center gap-4">
      <Input
        placeholder="Search leads..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />
      <button
        className={`inline-flex items-center gap-1.5 text-[13px] px-3 py-1.5 rounded-md border transition-colors ${
          needsReviewFilter
            ? 'bg-amber-100 text-amber-800 border-amber-300 font-medium'
            : 'bg-white text-muted-foreground border-muted hover:border-foreground/30'
        }`}
        onClick={() => onNeedsReviewFilterChange(!needsReviewFilter)}
      >
        <CircleDot className="h-3.5 w-3.5" />
        Needs Review
        <span className="text-[11px] bg-amber-200/60 text-amber-900 rounded-full px-1.5 py-0 font-medium">
          {needsReviewCount}
        </span>
      </button>
      <span className="text-[10px] text-muted-foreground/60 inline-flex items-center gap-3 ml-auto">
        <span className="inline-flex items-center gap-1"><CircleDot className="h-2.5 w-2.5 text-amber-500" />Needs review</span>
        <span className="inline-flex items-center gap-1"><UserCheck className="h-2.5 w-2.5 text-green-600" />Existing customer</span>
      </span>
    </div>
  )

  return (
    <DataTable
      columns={columns}
      data={searchFiltered}
      filterControls={filterControls}
      frozenColumns={5}
      enableColumnFilters
    />
  )
}
