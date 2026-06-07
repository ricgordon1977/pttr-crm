export interface Account {
  account_id: string
  account_name: string
  is_do_not_trade: boolean
  client_category: string
  contacts_count: number
  locations_count: number
  top_contact_name: string
  total_jobs: number
  total_revenue: number
  jobs_l12m: number
  revenue_l12m: number
  rank: number
  open_jobs: number
  last_activity: string
  abn: string
  phone: string
  fax: string
  email: string
  address_addressline1: string
  address_addressline2: string
  address_suburb: string
  address_state: string
  address_postcode: string
  notes: string
  primary_contact: string
  datecreated: string
  website: string
}

export interface Contact {
  contact_id: string
  contact_name: string
  contact_type: string
  account_id: string
  account_name: string
  phone: string
  mobile: string
  email: string
  suburb: string
  jobs_l12m: number
  revenue_l12m: number
  open_jobs: number
  last_job_date: string
}

export interface Lead {
  lead_id: string           // opportunity_id
  lead_date: string
  lead_datetime: string
  channel: string
  profile: string
  contact_name: string
  phone_norm: string
  email: string
  suburb: string
  lead_source: string
  lead_medium: string
  lead_campaign: string
  lead_keyword: string
  dnp_reason: string | null
  funnel_stage: string
  business_hours_flag: string
  call_count: number
  form_count: number
  operator: string | null
  is_existing_client: boolean
  job_value: number | null
  wc_lead_id: number | null
  booking_status: string
  completed: boolean | null
  answered: boolean | null
  captured: boolean | null
  service: string
  lead_type: string
  campaign_type: string | null
  all_jobnumbers: string | null
  job_count: number
  // After-hours gap detection (no content at any source)
  is_after_hours_gap?: boolean
  // Manual job link (Firestore override)
  manual_job_number?: string | null
  // Profile override (Firestore)
  profile_override?: string | null
  // Pending status timestamp
  pending_since?: string | null
  // Account attribution (Firestore override)
  is_account?: boolean
  account_id?: string | null
  account_name?: string | null
  account_contact_id?: string | null
  account_contact_name?: string | null
  // Override fields (merged from Firestore)
  is_overridden?: boolean
  sub_status?: string | null
  loss_reason?: string | null
  exclude_from_analysis?: boolean
  requires_csr_review?: boolean
}

export interface LeadInteraction {
  interaction_id: string
  lead_id: string | null
  interaction_date: string
  interaction_time: string
  interaction_datetime: string
  interaction_type: string
  interaction_operator: string
  interaction_summary: string
  interaction_duration_seconds: number
  call_id: string | null
  called_did_label: string | null
}

export interface JobHistory {
  jobnumber: string
  requested_date: string
  task_type: string
  primary_work_type: string | null
  display_status: string
  task_invoices_total_ex: number | null
  quote_totalex: number | null
  client_name: string
  job_source: 'completed' | 'active'
  job_address: string | null
  job_suburb: string | null
  description: string | null
  task_notes: string | null
}

export interface Location {
  account_id: string
  account_name: string
  location_id: string
  location_name: string
  full_address: string
  suburb: string
  state: string
  postcode: string
  location_rank: number
  jobs_l12m: number
  revenue_l12m: number
  jobs_total: number
  revenue_total: number
  open_jobs: number
  last_job_date: string
  site_contact: string
  site_phone: string
  site_email: string
}

export interface SearchResult {
  display_name: string
  phone: string
  email: string
  result_type: string
  result_id: string
}

export interface DashboardStats {
  total_leads: number
  bookings: number
  conversions: number
  booking_rate: number
  revenue: number
}
