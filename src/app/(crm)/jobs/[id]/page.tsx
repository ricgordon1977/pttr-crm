'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import TaskDetail from '@/components/TaskDetail'

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [task, setTask] = useState<any>(undefined)

  useEffect(() => {
    if (!id) return
    fetch(`/api/jobs/${id}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setTask(d))
      .catch(() => setTask(null))
  }, [id])

  if (task === undefined) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#938D81' }}>Loading…</div>
  }
  if (task === null) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#B23636' }}>Job not found.</div>
  }

  return <TaskDetail task={task} onBack={() => router.back()} />
}
