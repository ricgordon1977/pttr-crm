'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import TaskTable from '@/components/TaskTable'

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
function formatDate(d: string | null): string {
  if (!d) return '—'
  try {
    const dt = new Date(d)
    if (isNaN(dt.getTime())) return d
    const dd = String(dt.getDate()).padStart(2, '0')
    const mmm = MON[dt.getMonth()]
    const yy = String(dt.getFullYear()).slice(-2)
    return `${dd}-${mmm}-${yy}`
  } catch { return d }
}

function formatPhone(p: string | null): string {
  if (!p) return '—'
  const d = p.replace(/\D/g, '')
  if (d.startsWith('04') && d.length === 10) return `${d.slice(0,4)} ${d.slice(4,7)} ${d.slice(7)}`
  if (d.startsWith('61') && d.length === 11) {
    const local = '0' + d.slice(2)
    if (local.startsWith('04')) return `${local.slice(0,4)} ${local.slice(4,7)} ${local.slice(7)}`
    return `(${local.slice(0,2)}) ${local.slice(2,6)} ${local.slice(6)}`
  }
  if (d.length === 10 && d.startsWith('0')) return `(${d.slice(0,2)}) ${d.slice(2,6)} ${d.slice(6)}`
  return p
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(r: any) {
  return {
    id: r.job_id,
    jobNo: r.job_no,
    address: r.address || '—',
    client: r.client_name || '—',
    phone: formatPhone(r.client_phone),
    email: r.client_email || '—',
    type: (r.task_type || '—').replace(/Acc'/g, 'Account'),
    grade: r.grade,
    status: r.status || 'open',
    tech: r.assigned || r.salesperson || '—',
    logged: formatDate(r.logged_date),
    due: formatDate(r.due_date),
    completed: formatDate(r.completed_date),
  }
}

export default function JobsPage() {
  const router = useRouter()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [rows, setRows] = useState<any[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/jobs?limit=500')
      .then(r => r.json())
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then((data: any[]) => { setRows(data.map(mapRow)); setLoading(false) })
      .catch(() => { setRows([]); setLoading(false) })
  }, [])

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#938D81', fontFamily: 'Hanken Grotesk, sans-serif' }}>
        Loading tasks…
      </div>
    )
  }

  return (
    <TaskTable
      rows={rows ?? []}
      onOpenTask={(id: string) => router.push(`/jobs/${id}`)}
    />
  )
}
