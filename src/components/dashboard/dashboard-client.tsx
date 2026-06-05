'use client'

import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCurrency, safeDate } from '@/lib/format'
import {
  BarChart, Bar, PieChart, Pie, Cell, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import type { DashboardStats, Lead } from '@/types/database'

const COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#6b7280', '#eab308', '#f97316']

interface DashboardClientProps {
  stats: DashboardStats
  leads: Lead[]
}

export function DashboardClient({ stats, leads }: DashboardClientProps) {
  const funnelData = useMemo(() => {
    const counts: Record<string, number> = {}
    leads.forEach((l) => {
      const stage = l.funnel_stage || 'Unknown'
      counts[stage] = (counts[stage] || 0) + 1
    })
    return Object.entries(counts).map(([name, value]) => ({ name, value }))
  }, [leads])

  const sourceData = useMemo(() => {
    const counts: Record<string, number> = {}
    leads.forEach((l) => {
      const source = l.lead_source || 'Unknown'
      counts[source] = (counts[source] || 0) + 1
    })
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
  }, [leads])

  const weeklyRevenue = useMemo(() => {
    const weeks: Record<string, number> = {}
    leads.forEach((l) => {
      if (!l.lead_date || !l.job_value) return
      const d = safeDate(l.lead_date)
      if (!d) return
      const weekStart = new Date(d)
      weekStart.setDate(d.getDate() - d.getDay())
      const key = weekStart.toISOString().slice(0, 10)
      weeks[key] = (weeks[key] || 0) + l.job_value
    })
    return Object.entries(weeks)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, revenue]) => ({ week, revenue: Math.round(revenue) }))
  }, [leads])

  return (
    <>
      {/* Stats cards */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Total Leads (30d)', value: stats.total_leads },
          { label: 'Bookings (30d)', value: stats.bookings },
          { label: 'Booking Rate', value: `${stats.booking_rate ?? 0}%` },
          { label: 'Revenue (30d)', value: formatCurrency(stats.revenue) },
        ].map((card) => (
          <Card key={card.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {card.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{card.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-2 gap-6">
        {/* Leads by funnel stage */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Leads by Funnel Stage</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={funnelData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-30} textAnchor="end" height={80} />
                <YAxis />
                <Tooltip />
                <Bar dataKey="value" fill="#3b82f6" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Leads by source */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Leads by Source</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie data={sourceData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label>
                  {sourceData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Revenue by week */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Revenue by Week</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={weeklyRevenue}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="week" tick={{ fontSize: 11 }} />
              <YAxis />
              <Tooltip formatter={(value: unknown) => formatCurrency(value as number)} />
              <Line type="monotone" dataKey="revenue" stroke="#22c55e" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </>
  )
}
