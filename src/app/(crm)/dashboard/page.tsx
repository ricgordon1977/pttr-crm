import { getDashboardStats, getLeads } from '@/lib/bigquery/queries'
import { DashboardClient } from '@/components/dashboard/dashboard-client'
import type { DashboardStats, Lead } from '@/types/database'

export default async function DashboardPage() {
  const [rawStats, rawLeads] = await Promise.all([
    getDashboardStats(),
    getLeads(),
  ])

  const stats = JSON.parse(JSON.stringify(
    (rawStats as DashboardStats[])[0] ?? {
      total_leads: 0,
      bookings: 0,
      conversions: 0,
      booking_rate: 0,
      revenue: 0,
    }
  ))

  const leads: Lead[] = JSON.parse(JSON.stringify(rawLeads))

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
      <DashboardClient stats={stats} leads={leads} />
    </div>
  )
}
