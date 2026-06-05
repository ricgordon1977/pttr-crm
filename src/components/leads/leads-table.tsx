'use client'

import { type ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/shared/data-table'
import { FunnelStageBadge, AfterHoursBadge } from '@/components/shared/status-badge'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { useState, useMemo } from 'react'
import { formatPhone, formatCurrency, formatDate, formatOpportunityLabel } from '@/lib/format'
import {
  UserCheck, PhoneIncoming, FileText, Mail, MessageCircle,
  Droplet, Zap, Search, MapPin, ArrowRight, ExternalLink, Globe,
  Sprout, DollarSign, Users, Minus, Link,
} from 'lucide-react'
import type { Lead } from '@/types/database'

function ChannelIcon({ channel }: { channel: string }) {
  const ch = channel?.toLowerCase() ?? ''
  if (ch.includes('call') || ch.includes('phone')) {
    return <span className="inline-flex items-center gap-1 text-[13px] text-blue-600"><PhoneIncoming className="h-3.5 w-3.5" />Call</span>
  }
  if (ch.includes('form') || ch.includes('web')) {
    return <span className="inline-flex items-center gap-1 text-[13px] text-purple-600"><FileText className="h-3.5 w-3.5" />Form</span>
  }
  if (ch.includes('email')) {
    return <span className="inline-flex items-center gap-1 text-[13px] text-teal-600"><Mail className="h-3.5 w-3.5" />Email</span>
  }
  if (ch.includes('chat')) {
    return <span className="inline-flex items-center gap-1 text-[13px] text-gray-400"><MessageCircle className="h-3.5 w-3.5" />Chat</span>
  }
  return <span className="text-[13px] text-muted-foreground">{channel || '—'}</span>
}

function ProfileIcon({ profile }: { profile: string }) {
  if (profile.toLowerCase().includes('plumber')) {
    return <span className="inline-flex items-center gap-1 text-[13px] text-blue-600"><Droplet className="h-3.5 w-3.5" />PTTR</span>
  }
  if (profile.toLowerCase().includes('electr')) {
    return <span className="inline-flex items-center gap-1 text-[13px] text-amber-600"><Zap className="h-3.5 w-3.5" />ETTR</span>
  }
  return <span className="text-[13px] text-muted-foreground">{profile}</span>
}

function SourceIcon({ source }: { source: string }) {
  if (!source) return <span className="text-muted-foreground">—</span>
  const s = source.toLowerCase()

  if (s === 'google') return <span className="inline-flex items-center gap-1 text-[13px] text-orange-600"><Search className="h-3.5 w-3.5" />{source}</span>
  if (s === 'gmb') return <span className="inline-flex items-center gap-1 text-[13px] text-green-600"><MapPin className="h-3.5 w-3.5" />{source}</span>
  if (s === '(direct)') return <span className="inline-flex items-center gap-1 text-[13px] text-gray-400"><ArrowRight className="h-3.5 w-3.5" />Direct</span>

  // Search engines
  if (['bing', 'yahoo', 'duckduckgo.com', 'ecosia.org', 'search.brave.com', 'perplexity'].includes(s)) {
    return <span className="inline-flex items-center gap-1 text-[13px] text-blue-600"><Search className="h-3.5 w-3.5" />{source}</span>
  }
  // AI
  if (s.includes('chatgpt')) return <span className="inline-flex items-center gap-1 text-[13px] text-purple-600"><Globe className="h-3.5 w-3.5" />{source}</span>
  // Own websites
  if (s.includes('plumbertotherescue') || s.includes('electriciantotherescue') || s.includes('lp.')) {
    return <span className="inline-flex items-center gap-1 text-[13px] text-blue-600"><Link className="h-3.5 w-3.5" />{source}</span>
  }
  // Social / referral sites
  if (s.includes('facebook') || s.includes('houzz') || s.includes('yelp') || s.includes('yellowpages') || s.includes('localsearch') || s.includes('masterplumbers')) {
    return <span className="inline-flex items-center gap-1 text-[13px] text-purple-600"><ExternalLink className="h-3.5 w-3.5" />{source}</span>
  }
  // Fallback
  return <span className="inline-flex items-center gap-1 text-[13px] text-gray-400"><Globe className="h-3.5 w-3.5" />{source}</span>
}

function MediumIcon({ medium }: { medium: string }) {
  if (!medium) return <span className="text-muted-foreground">—</span>
  const m = medium.toLowerCase()

  if (m === 'organic') return <span className="inline-flex items-center gap-1 text-[13px] text-green-600"><Sprout className="h-3.5 w-3.5" />{medium}</span>
  if (m === 'cpc') return <span className="inline-flex items-center gap-1 text-[13px] text-orange-600"><DollarSign className="h-3.5 w-3.5" />{medium}</span>
  if (m === 'referral') return <span className="inline-flex items-center gap-1 text-[13px] text-purple-600"><Users className="h-3.5 w-3.5" />{medium}</span>
  if (m === '(none)') return <span className="inline-flex items-center gap-1 text-[13px] text-gray-400"><Minus className="h-3.5 w-3.5" />None</span>
  // Fallback
  return <span className="inline-flex items-center gap-1 text-[13px] text-gray-400"><Globe className="h-3.5 w-3.5" />{medium}</span>
}

interface LeadsTableProps {
  leads: Lead[]
  onViewLead: (lead: Lead) => void
}

export function LeadsTable({ leads, onViewLead }: LeadsTableProps) {
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
      accessorKey: 'lead_date',
      header: 'Date',
      enableColumnFilter: false,
      cell: ({ row }) => formatDate(row.original.lead_date),
    },
    {
      id: 'existing_client',
      header: '',
      enableColumnFilter: false,
      cell: ({ row }) => row.original.is_existing_client
        ? <span title="Existing client"><UserCheck className="h-3.5 w-3.5 text-green-600" /></span>
        : null,
    },
    {
      accessorKey: 'lead_id',
      header: 'Lead ID',
      enableColumnFilter: false,
      cell: ({ row }) => <span className="text-[12px] font-mono">{formatOpportunityLabel(row.original)}</span>,
    },
    {
      accessorKey: 'funnel_stage',
      header: 'Funnel Stage',
      cell: ({ row }) => row.original.funnel_stage ? <FunnelStageBadge stage={row.original.funnel_stage} /> : '—',
    },
    { accessorKey: 'dnp_reason', header: 'Sub-Status', cell: ({ row }) => row.original.dnp_reason ?? '—' },
    {
      accessorKey: 'channel',
      header: 'Channel',
      cell: ({ row }) => <ChannelIcon channel={row.original.channel} />,
    },
    {
      accessorKey: 'profile',
      header: 'Profile',
      cell: ({ row }) => row.original.profile ? <ProfileIcon profile={row.original.profile} /> : '—',
    },
    { accessorKey: 'contact_name', header: 'Contact' },
    { accessorKey: 'phone_norm', header: 'Phone', cell: ({ row }) => formatPhone(row.original.phone_norm) },
    { accessorKey: 'email', header: 'Email', cell: ({ row }) => row.original.email ? <span className="text-muted-foreground">{row.original.email}</span> : '—' },
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
      cell: ({ row }) => <SourceIcon source={row.original.lead_source} />,
    },
    {
      accessorKey: 'lead_medium',
      header: 'Medium',
      cell: ({ row }) => <MediumIcon medium={row.original.lead_medium} />,
    },
    {
      accessorKey: 'job_value',
      header: 'Value',
      enableColumnFilter: false,
      cell: ({ row }) => formatCurrency(row.original.job_value),
    },
  ]

  const filtered = useMemo(() => {
    if (!search) return leads
    const term = search.toLowerCase()
    return leads.filter((l) =>
      l.contact_name?.toLowerCase().includes(term) ||
      l.phone_norm?.includes(term) ||
      l.suburb?.toLowerCase().includes(term) ||
      l.lead_source?.toLowerCase().includes(term)
    )
  }, [leads, search])

  const filterControls = (
    <div className="flex items-center gap-4">
      <Input
        placeholder="Search leads..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />
    </div>
  )

  return (
    <DataTable
      columns={columns}
      data={filtered}
      filterControls={filterControls}
      frozenColumns={6}
      enableColumnFilters
    />
  )
}
