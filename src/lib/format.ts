import { format } from 'date-fns'

export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '—'
  const digits = phone.replace(/\D/g, '')
  // AU mobile: 04XX XXX XXX
  if (digits.startsWith('61') && digits.length === 11) {
    const local = '0' + digits.slice(2)
    if (local.startsWith('04')) {
      return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`
    }
    return `(${local.slice(0, 2)}) ${local.slice(2, 6)} ${local.slice(6)}`
  }
  if (digits.startsWith('04') && digits.length === 10) {
    return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`
  }
  if (digits.length === 10 && digits.startsWith('0')) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)} ${digits.slice(6)}`
  }
  return phone
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function safeDate(val: any): Date | null {
  if (!val) return null
  try {
    const raw = typeof val === 'object' && val.value != null ? val.value : val
    const str = String(raw)
    // Date-only strings like "2026-06-02" are parsed as UTC midnight by JS,
    // which shifts the day in non-UTC timezones. Append T12:00:00 to keep
    // the date stable regardless of the user's local timezone.
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
      const d = new Date(str + 'T12:00:00')
      return isNaN(d.getTime()) ? null : d
    }
    // "YYYY/MM/DD" format (from AroFlo) — same fix
    if (/^\d{4}\/\d{2}\/\d{2}$/.test(str)) {
      const d = new Date(str.replace(/\//g, '-') + 'T12:00:00')
      return isNaN(d.getTime()) ? null : d
    }
    const d = new Date(raw)
    return isNaN(d.getTime()) ? null : d
  } catch {
    return null
  }
}

export function formatDate(val: unknown, fmt = 'd MMM yyyy'): string {
  const d = safeDate(val)
  if (!d) return '—'
  return format(d, fmt)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function formatCurrency(value: any): string {
  if (value == null) return '—'
  // BigQuery returns numeric types as objects with a .value property
  const raw = typeof value === 'object' && value.value != null ? value.value : value
  const num = typeof raw === 'number' ? raw : Number(raw)
  if (isNaN(num)) return '—'
  if (Math.abs(num) >= 100) {
    return `$${Math.round(num).toLocaleString('en-AU')}`
  }
  return `$${num.toFixed(2)}`
}

export function formatOpportunityLabel(lead: { lead_id: string; wc_lead_id?: number | null; phone_norm?: string | null; email?: string | null; all_jobnumbers?: string | null }): string {
  if (lead.wc_lead_id) return `WC-${lead.wc_lead_id}`
  if (lead.lead_id?.startsWith('J-')) return `JOB-${lead.lead_id.slice(2)}`
  if (lead.phone_norm) {
    const last4 = lead.phone_norm.replace(/\D/g, '').slice(-4)
    return `PH-${last4}`
  }
  if (lead.email) {
    const local = lead.email.split('@')[0]
    return `EM-${local.slice(0, 8)}`
  }
  if (lead.all_jobnumbers) return `JOB-${lead.all_jobnumbers.split(',')[0].trim()}`
  return lead.lead_id?.slice(0, 10) || '—'
}

export function channelIcon(channel: string): string {
  switch (channel?.toLowerCase()) {
    case 'inbound call': return '📞↙️'
    case 'outbound call': return '📞↗️'
    case 'inbound email': return '📥'
    case 'outbound email': return '📤'
    default: return channel ?? ''
  }
}
