/**
 * intakeValidator.ts
 *
 * SolarPro Intake & Acquisition Infrastructure — Input Validation & Normalization
 *
 * Validates and normalizes raw intake data from any source (web forms,
 * webhooks, manual entry). Returns a structured, clean payload ready
 * for duplicate detection and pipeline processing.
 *
 * Normalizations applied:
 *   - Phone: E.164 format (+1XXXXXXXXXX for US)
 *   - Email: lowercase + trim
 *   - State: 2-char uppercase
 *   - Zip: 5-digit string
 *   - source_channel: auto-inferred from click IDs (gclid→paid_search, fbclid→paid_social)
 *   - Disposable email detection (common domains)
 *   - Name splitting (full_name → first_name + last_name)
 */

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export interface RawIntakePayload {
  // Identity
  first_name?: string | null
  last_name?: string | null
  full_name?: string | null
  email?: string | null
  phone?: string | null

  // Address
  address_line1?: string | null
  address_line2?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  zip_code?: string | null
  postal_code?: string | null
  county?: string | null
  latitude?: number | null
  longitude?: number | null

  // Solar intent signals
  monthly_bill_amount?: number | string | null
  current_electricity_rate?: number | string | null
  property_type?: string | null
  home_ownership?: string | null
  roof_type?: string | null
  roof_shade?: string | null
  roof_age_years?: number | string | null
  square_feet?: number | string | null

  // Attribution
  source_system?: string | null
  source_channel?: string | null
  source_name?: string | null
  funnel_id?: string | null
  campaign_id?: string | null
  utm_source?: string | null
  utm_medium?: string | null
  utm_campaign?: string | null
  utm_content?: string | null
  utm_term?: string | null
  gclid?: string | null
  fbclid?: string | null
  ttclid?: string | null

  // Misc
  notes?: string | null
  consent_given?: boolean | null
  consent_text?: string | null
  consent_timestamp?: string | null
  ip_address?: string | null
  user_agent?: string | null
  referer?: string | null
  [key: string]: unknown
}

export interface ValidatedIntakePayload {
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state: string | null
  zip: string | null
  county: string | null
  latitude: number | null
  longitude: number | null
  monthly_bill_amount: number | null
  current_electricity_rate: number | null
  property_type: string | null
  home_ownership: string | null
  roof_type: string | null
  roof_shade: string | null
  roof_age_years: number | null
  square_feet: number | null
  source_system: string
  source_channel: string
  source_name: string | null
  funnel_id: string | null
  campaign_id: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_content: string | null
  utm_term: string | null
  gclid: string | null
  fbclid: string | null
  ttclid: string | null
  notes: string | null
  consent_given: boolean
  consent_text: string | null
  consent_timestamp: string | null
  ip_address: string | null
  user_agent: string | null
  referer: string | null
}

export interface IntakeValidationResult {
  valid: boolean
  payload: ValidatedIntakePayload | null
  errors: string[]
  warnings: string[]
}

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

const DISPOSABLE_EMAIL_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'throwam.com', 'tempmail.com',
  'yopmail.com', 'sharklasers.com', 'guerrillamailblock.com', 'grr.la',
  'guerrillamail.info', 'guerrillamail.biz', 'guerrillamail.de',
  'guerrillamail.net', 'guerrillamail.org', 'spam4.me', 'trashmail.com',
  'trashmail.at', 'trashmail.io', 'dispostable.com', 'fakeinbox.com',
  'spamgourmet.com', 'maildrop.cc', 'nada.email', 'discard.email',
  'crapmail.org', 'fakemailgenerator.com', 'mailnull.com', 'spamex.com',
  'getairmail.com', 'filzmail.com', 'throwam.com', 'bccto.me',
])

const US_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC','PR','GU','VI','AS','MP',
])

// ────────────────────────────────────────────────────────────────────────────
// Normalizers
// ────────────────────────────────────────────────────────────────────────────

function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  if (digits.length > 7) return `+${digits}` // international fallback
  return null
}

function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim().toLowerCase()
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(trimmed)) return null
  return trimmed
}

function normalizeState(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = raw.trim().toUpperCase()
  if (US_STATES.has(s)) return s
  return null
}

function normalizeZip(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = raw.trim().replace(/\D/g, '').slice(0, 5)
  if (digits.length === 5) return digits
  if (digits.length === 4) return `0${digits}` // leading-zero states
  return null
}

function toNumber(raw: number | string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === '') return null
  const n = parseFloat(String(raw).replace(/[,$]/g, ''))
  return isNaN(n) ? null : n
}

function splitName(full: string): { first: string | null; last: string | null } {
  const parts = full.trim().split(/\s+/)
  if (parts.length === 0) return { first: null, last: null }
  if (parts.length === 1) return { first: parts[0], last: null }
  return { first: parts[0], last: parts.slice(1).join(' ') }
}

function inferSourceChannel(payload: RawIntakePayload): string {
  if (payload.source_channel) return payload.source_channel
  if (payload.gclid) return 'paid_search'
  if (payload.fbclid) return 'paid_social'
  if (payload.ttclid) return 'paid_social'
  if (payload.utm_medium) {
    const m = payload.utm_medium.toLowerCase()
    if (m.includes('cpc') || m.includes('ppc') || m.includes('search')) return 'paid_search'
    if (m.includes('social') || m.includes('facebook') || m.includes('instagram')) return 'paid_social'
    if (m.includes('email')) return 'email'
    if (m.includes('organic')) return 'organic_search'
    if (m.includes('referral')) return 'referral'
    if (m.includes('display') || m.includes('banner')) return 'display'
    if (m.includes('sms') || m.includes('text')) return 'sms'
  }
  return 'web'
}

function isDisposableEmail(email: string): boolean {
  const domain = email.split('@')[1] || ''
  return DISPOSABLE_EMAIL_DOMAINS.has(domain.toLowerCase())
}

// ────────────────────────────────────────────────────────────────────────────
// Main validator
// ────────────────────────────────────────────────────────────────────────────

export function validateIntakePayload(
  raw: RawIntakePayload,
  options: { source_system?: string; require_email?: boolean; require_phone?: boolean; require_address?: boolean } = {}
): IntakeValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // ── Name
  let first_name: string | null = raw.first_name?.trim() || null
  let last_name: string | null = raw.last_name?.trim() || null
  if (!first_name && !last_name && raw.full_name) {
    const split = splitName(raw.full_name)
    first_name = split.first
    last_name = split.last
  }

  // ── Email
  const email = normalizeEmail(raw.email)
  if (!email && (options.require_email || raw.email)) {
    if (raw.email) errors.push(`Invalid email format: "${raw.email}"`)
    else if (options.require_email) errors.push('Email is required')
  }
  if (email && isDisposableEmail(email)) {
    warnings.push(`Disposable email domain detected: ${email.split('@')[1]}`)
  }

  // ── Phone
  const phone = normalizePhone(raw.phone)
  if (!phone && (options.require_phone || raw.phone)) {
    if (raw.phone) errors.push(`Invalid phone format: "${raw.phone}"`)
    else if (options.require_phone) errors.push('Phone is required')
  }

  // ── Must have at least email or phone
  if (!email && !phone) {
    errors.push('At least one of email or phone is required')
  }

  // ── State
  const zipRaw = raw.zip || raw.zip_code || raw.postal_code
  const zip = normalizeZip(zipRaw)
  const state = normalizeState(raw.state)
  if (raw.state && !state) {
    warnings.push(`Unrecognized state value: "${raw.state}"`)
  }

  // ── Monthly bill
  const monthly_bill_amount = toNumber(raw.monthly_bill_amount)
  if (monthly_bill_amount !== null && (monthly_bill_amount < 0 || monthly_bill_amount > 10000)) {
    warnings.push(`Unusual monthly_bill_amount: ${monthly_bill_amount}`)
  }

  if (errors.length > 0) {
    return { valid: false, payload: null, errors, warnings }
  }

  const payload: ValidatedIntakePayload = {
    first_name,
    last_name,
    email,
    phone,
    address_line1: raw.address_line1?.trim() || null,
    address_line2: raw.address_line2?.trim() || null,
    city: raw.city?.trim() || null,
    state,
    zip,
    county: raw.county?.trim() || null,
    latitude: typeof raw.latitude === 'number' ? raw.latitude : toNumber(raw.latitude),
    longitude: typeof raw.longitude === 'number' ? raw.longitude : toNumber(raw.longitude),
    monthly_bill_amount,
    current_electricity_rate: toNumber(raw.current_electricity_rate),
    property_type: raw.property_type?.trim() || null,
    home_ownership: raw.home_ownership?.trim() || null,
    roof_type: raw.roof_type?.trim() || null,
    roof_shade: raw.roof_shade?.trim() || null,
    roof_age_years: toNumber(raw.roof_age_years),
    square_feet: toNumber(raw.square_feet),
    source_system: options.source_system || raw.source_system?.trim() || 'unknown',
    source_channel: inferSourceChannel(raw),
    source_name: raw.source_name?.trim() || null,
    funnel_id: raw.funnel_id?.trim() || null,
    campaign_id: raw.campaign_id?.trim() || null,
    utm_source: raw.utm_source?.trim() || null,
    utm_medium: raw.utm_medium?.trim() || null,
    utm_campaign: raw.utm_campaign?.trim() || null,
    utm_content: raw.utm_content?.trim() || null,
    utm_term: raw.utm_term?.trim() || null,
    gclid: raw.gclid?.trim() || null,
    fbclid: raw.fbclid?.trim() || null,
    ttclid: raw.ttclid?.trim() || null,
    notes: raw.notes?.trim() || null,
    consent_given: raw.consent_given === true || raw.consent_given === 1 as unknown,
    consent_text: raw.consent_text?.trim() || null,
    consent_timestamp: raw.consent_timestamp?.trim() || null,
    ip_address: raw.ip_address?.trim() || null,
    user_agent: raw.user_agent?.trim() || null,
    referer: raw.referer?.trim() || null,
  }

  return { valid: true, payload, errors: [], warnings }
}
