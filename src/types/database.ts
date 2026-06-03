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
  lead_id: string
  lead_date: string
  lead_datetime: string
  channel: string
  profile: string
  contact_name: string
  phone_raw: string
  phone_norm: string
  email: string
  suburb: string
  lead_source: string
  lead_medium: string
  lead_campaign: string
  lead_class: string
  lead_status: string
  dnp_reason: string
  dnp_detail: string
  service_type: string
  funnel_stage: string
  quotable: boolean
  is_booking: boolean
  is_converted_job: boolean
  business_hours_flag: string
  call_duration_seconds: number
  call_transcription: string
  sales_value: number
  call_count: number
  email_count: number
  has_jobs: boolean
  notes: string
  operator: string | null
  is_existing_client: boolean
  job_value: number | null
}

export interface LeadInteraction {
  lead_id: string
  lead_datetime: string
  interaction_date: string
  interaction_time: string
  interaction_datetime: string
  interaction_type: string
  interaction_operator: string
  interaction_summary: string
  interaction_duration_seconds: number
  speed_to_lead_minutes: number | null
  job_number: string | null
  job_type: string | null
  job_status: string | null
  job_value: number | null
  job_completed_date: string | null
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
