'use client'

import { type ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/shared/data-table'
import { FunnelStageBadge, AfterHoursBadge } from '@/components/shared/status-badge'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { useState, useMemo } from 'react'
import { formatPhone, formatCurrency, formatDate } from '@/lib/format'
import type { Lead } from '@/types/database'

function ChannelBadge({ channel }: { channel: string }) {
  const ch = channel?.toLowerCase() ?? ''
  if (ch.includes('call') || ch.includes('phone')) {
    return <Badge variant="secondary" className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300 font-medium">Call</Badge>
  }
  if (ch.includes('form') || ch.includes('web')) {
    return <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300 font-medium">Form</Badge>
  }
  if (ch.includes('email')) {
    return <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300 font-medium">Email</Badge>
  }
  return <Badge variant="secondary">{channel || '—'}</Badge>
}

function LeadProfileBadge({ profile }: { profile: string }) {
  if (profile.toLowerCase().includes('plumber')) {
    return <Badge variant="secondary" className="bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-300 font-medium">PTTR</Badge>
  }
  if (profile.toLowerCase().includes('electr')) {
    return <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300 font-medium">ETTR</Badge>
  }
  return <Badge variant="secondary">{profile}</Badge>
}

// Source badge — group by category: search engines, paid, direct, social, directories, other
function SourceBadge({ source }: { source: string }) {
  if (!source) return <span className="text-muted-foreground">—</span>
  const s = source.toLowerCase()

  // Paid / Magnet
  if (s.includes('magnet')) {
    return <Badge variant="secondary" className="bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-300 font-medium">{source}</Badge>
  }
  // Google (organic search + GMB)
  if (s === 'google' || s === 'gmb') {
    return <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300 font-medium">{source}</Badge>
  }
  // Other search engines
  if (['bing', 'yahoo', 'duckduckgo.com', 'ecosia.org', 'search.brave.com', 'perplexity'].includes(s) || s.includes('searchengine')) {
    return <Badge variant="secondary" className="bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-300 font-medium">{source}</Badge>
  }
  // AI / chat
  if (s.includes('chatgpt')) {
    return <Badge variant="secondary" className="bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-300 font-medium">{source}</Badge>
  }
  // Own websites
  if (s.includes('plumbertotherescue') || s.includes('electriciantotherescue') || s.includes('lp.')) {
    return <Badge variant="secondary" className="bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-300 font-medium">{source}</Badge>
  }
  // Social
  if (s.includes('facebook')) {
    return <Badge variant="secondary" className="bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-300 font-medium">{source}</Badge>
  }
  // Directories
  if (s.includes('yellowpages') || s.includes('yelp') || s.includes('houzz') || s.includes('localsearch') || s.includes('masterplumbers')) {
    return <Badge variant="secondary" className="bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300 font-medium">{source}</Badge>
  }
  // Direct
  if (s === '(direct)') {
    return <Badge variant="secondary" className="bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 font-medium">{source}</Badge>
  }
  // Fallback
  return <Badge variant="secondary" className="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 font-medium">{source}</Badge>
}

// Medium badge — consistent color per type
const mediumStyles: Record<string, string> = {
  cpc: 'bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-300',
  organic: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300',
  referral: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300',
  magnet: 'bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-300',
  '(none)': 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
}

function MediumBadge({ medium }: { medium: string }) {
  if (!medium) return <span className="text-muted-foreground">—</span>
  const style = mediumStyles[medium.toLowerCase()] ?? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
  return <Badge variant="secondary" className={`${style} font-medium`}>{medium}</Badge>
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
      accessorKey: 'lead_id',
      header: 'Lead ID',
      enableColumnFilter: false,
      cell: ({ row }) => (
        <span className="flex items-center gap-1">
          {row.original.lead_id}
          {row.original.is_existing_client && (
            <span className="inline-block w-2 h-2 rounded-full bg-amber-500" title="Existing client" />
          )}
        </span>
      ),
    },
    {
      accessorKey: 'channel',
      header: 'Channel',
      cell: ({ row }) => <ChannelBadge channel={row.original.channel} />,
    },
    {
      accessorKey: 'profile',
      header: 'Profile',
      cell: ({ row }) => row.original.profile ? <LeadProfileBadge profile={row.original.profile} /> : '—',
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
      cell: ({ row }) => <SourceBadge source={row.original.lead_source} />,
    },
    {
      accessorKey: 'lead_medium',
      header: 'Medium',
      cell: ({ row }) => <MediumBadge medium={row.original.lead_medium} />,
    },
    {
      accessorKey: 'funnel_stage',
      header: 'Funnel Stage',
      cell: ({ row }) => row.original.funnel_stage ? <FunnelStageBadge stage={row.original.funnel_stage} /> : '—',
    },
    { accessorKey: 'dnp_reason', header: 'Sub-Status', cell: ({ row }) => row.original.dnp_reason ?? '—' },
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
      frozenColumns={3}
      enableColumnFilters
    />
  )
}
