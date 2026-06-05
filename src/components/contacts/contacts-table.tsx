'use client'

import { type ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/shared/data-table'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useState, useMemo } from 'react'
import { formatPhone, formatCurrency, formatDate } from '@/lib/format'
import type { Contact } from '@/types/database'

const contactTypeBadgeStyle: Record<string, string> = {
  Residential: 'bg-teal-100 text-teal-800',
  'Strata Rep': 'bg-blue-100 text-blue-800',
  COD: 'bg-amber-100 text-amber-800',
}

const columns: ColumnDef<Contact, unknown>[] = [
  { accessorKey: 'contact_name', header: 'Contact name' },
  {
    accessorKey: 'contact_type',
    header: 'Type',
    cell: ({ row }) => (
      <Badge variant="secondary" className={contactTypeBadgeStyle[row.original.contact_type] ?? ''}>
        {row.original.contact_type}
      </Badge>
    ),
  },
  { accessorKey: 'suburb', header: 'Suburb', cell: ({ row }) => row.original.suburb ?? '—' },
  { accessorKey: 'phone', header: 'Phone', cell: ({ row }) => formatPhone(row.original.phone) },
  { accessorKey: 'email', header: 'Email', cell: ({ row }) => row.original.email ?? '—' },
  { accessorKey: 'account_name', header: 'Account' },
  { accessorKey: 'jobs_l12m', header: 'Jobs L12M' },
  { accessorKey: 'revenue_l12m', header: 'Revenue L12M', cell: ({ row }) => formatCurrency(row.original.revenue_l12m) },
  { accessorKey: 'open_jobs', header: 'Open Jobs' },
  {
    accessorKey: 'last_job_date',
    header: 'Last Job',
    cell: ({ row }) => formatDate(row.original.last_job_date),
  },
]

interface ContactsTableProps {
  contacts: Contact[]
  onSelectContact: (contact: Contact) => void
}

export function ContactsTable({ contacts, onSelectContact }: ContactsTableProps) {
  const [typeFilter, setTypeFilter] = useState('all')
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    return contacts.filter((c) => {
      if (typeFilter !== 'all' && c.contact_type !== typeFilter) return false
      if (search) {
        const term = search.toLowerCase()
        if (
          !c.contact_name?.toLowerCase().includes(term) &&
          !c.suburb?.toLowerCase().includes(term) &&
          !c.phone?.includes(term)
        ) return false
      }
      return true
    })
  }, [contacts, typeFilter, search])

  const filterControls = (
    <div className="flex items-center gap-4">
      <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v ?? '')}>
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="Contact type" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All types</SelectItem>
          <SelectItem value="Residential">Residential</SelectItem>
          <SelectItem value="Strata Rep">Strata Rep</SelectItem>
          <SelectItem value="COD">COD</SelectItem>
        </SelectContent>
      </Select>
      <Input
        placeholder="Search contacts..."
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
      onRowClick={onSelectContact}
      filterControls={filterControls}
    />
  )
}
