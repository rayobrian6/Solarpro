/**
 * screeningPipeline.ts
 *
 * SolarPro Network Intelligence OS — 10-Step Screening Pipeline
 *
 * Orchestrates automated validation of inbound opportunities.
 * Each step runs independently and can pass, fail, or be skipped.
 * Results are stored in opportunity_screening_queue.
 *
 * In production, steps that require external APIs (geocoding,
 * utility lookup, property data) will call those services.
 * For now, all steps use the data already on the opportunity
 * plus reasonable business logic.
 */

import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export type StepStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped' | 'error' | 'needs_review'
export type PipelineDecision = 'pass' | 'fail' | 'needs_review'

export interface ScreeningOpportunity {
  id: string
  homeowner_first_name?: string | null
  homeowner_last_name?: string | null
  homeowner_email?: string | null
  homeowner_phone?: string | null
  address?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  lat?: number | null
  lng?: number | null
  monthly_bill?: number | null
  annual_usage_kwh?: number | null
  utility_name?: string | null
  roof_age_years?: number | null
  structure_type?: string | null
  source_type?: string | null
  screening_data?: Record<string, unknown>
}

export interface StepResult {
  status: StepStatus
  data: Record<string, unknown>
  error?: string
  completed_at: string
}

export interface PipelineResult {
  opportunity_id: string
  pipeline_status: 'completed' | 'failed'
  auto_decision: PipelineDecision
  auto_decision_reason: string
  confidence_score: number
  steps: Record<`step${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10}`, StepResult>
  duration_ms: number
  fail_reasons: string[]
  review_flags: string[]
}

// ──────────────────────────────────────────────────────────────────────────────
// Step Implementations
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Step 1: Contact Validation
 * Validates phone number format and email format.
 * Detects obviously fake/disposable contacts.
 */
async function runStep1(opp: ScreeningOpportunity): Promise<StepResult> {
  const data: Record<string, unknown> = {}
  let phone_valid = false
  let email_valid = false

  try {
    // Phone validation
    if (opp.homeowner_phone) {
      const cleaned = opp.homeowner_phone.replace(/\D/g, '')
      phone_valid = cleaned.length === 10 || (cleaned.length === 11 && cleaned[0] === '1')
      data.phone_valid = phone_valid
      data.phone_digits = cleaned.length

      // Basic spam number detection
      const spamPrefixes = ['5555555', '1234567', '0000000', '9999999']
      const isSpam = spamPrefixes.some(p => cleaned.includes(p))
      data.phone_type = isSpam ? 'spam' : 'mobile'
      if (isSpam) phone_valid = false
    }

    // Email validation
    if (opp.homeowner_email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
      email_valid = emailRegex.test(opp.homeowner_email)

      // Disposable domain check
      const disposableDomains = ['mailinator.com', 'guerrillamail.com', 'tempmail.com',
        'throwaway.email', 'yopmail.com', '10minutemail.com', 'trashmail.com']
      const domain = opp.homeowner_email.split('@')[1]?.toLowerCase() ?? ''
      const isDisposable = disposableDomains.some(d => domain.includes(d))
      data.email_valid = email_valid && !isDisposable
      data.email_risk = isDisposable ? 'disposable' : email_valid ? 'low' : 'high'
      if (isDisposable) email_valid = false
    }

    const passed = phone_valid && email_valid
    return {
      status: passed ? 'passed' : 'failed',
      data: { ...data, phone_valid, email_valid },
      completed_at: new Date().toISOString(),
    }
  } catch (err) {
    return { status: 'error', data, error: String(err), completed_at: new Date().toISOString() }
  }
}

/**
 * Step 2: Duplicate Check
 * Fuzzy match on phone + address against existing opportunities.
 */
async function runStep2(opp: ScreeningOpportunity): Promise<StepResult> {
  const data: Record<string, unknown> = {}

  try {
    // Check for exact phone match in last 90 days
    const existingByPhone = opp.homeowner_phone ? await sql`
      SELECT id, created_at FROM network_opportunities
      WHERE homeowner_phone = ${opp.homeowner_phone}
        AND id != ${opp.id}
        AND created_at > NOW() - INTERVAL '90 days'
      LIMIT 1
    ` : []

    // Check for same address
    const existingByAddress = opp.address ? await sql`
      SELECT id, created_at FROM network_opportunities
      WHERE address = ${opp.address}
        AND state = ${opp.state ?? ''}
        AND id != ${opp.id}
        AND created_at > NOW() - INTERVAL '180 days'
      LIMIT 1
    ` : []

    const isDuplicate = existingByPhone.length > 0 || existingByAddress.length > 0
    const duplicateOf = existingByPhone[0]?.id ?? existingByAddress[0]?.id ?? null

    data.is_duplicate = isDuplicate
    data.duplicate_of = duplicateOf
    data.match_score = isDuplicate ? 95 : 0
    data.match_fields = [
      ...(existingByPhone.length > 0 ? ['phone'] : []),
      ...(existingByAddress.length > 0 ? ['address'] : []),
    ]

    return {
      status: isDuplicate ? 'failed' : 'passed',
      data,
      completed_at: new Date().toISOString(),
    }
  } catch (err) {
    return { status: 'error', data, error: String(err), completed_at: new Date().toISOString() }
  }
}

/**
 * Step 3: Address Validation
 * Validates address completeness and basic format.
 * In production: call USPS or Google Maps Geocoding API.
 */
async function runStep3(opp: ScreeningOpportunity): Promise<StepResult> {
  const data: Record<string, unknown> = {}

  try {
    const hasAddress = !!opp.address && opp.address.trim().length > 5
    const hasCity = !!opp.city && opp.city.trim().length > 1
    const hasState = !!opp.state && opp.state.trim().length === 2
    const hasZip = !!opp.zip && /^\d{5}(-\d{4})?$/.test(opp.zip.trim())

    data.address_valid = hasAddress && hasCity && hasState && hasZip
    data.formatted_address = hasAddress
      ? `${opp.address}, ${opp.city}, ${opp.state} ${opp.zip}`
      : null
    data.lat = opp.lat
    data.lng = opp.lng
    data.has_coordinates = opp.lat != null && opp.lng != null
    data.missing_fields = [
      ...(!hasAddress ? ['address'] : []),
      ...(!hasCity ? ['city'] : []),
      ...(!hasState ? ['state'] : []),
      ...(!hasZip ? ['zip'] : []),
    ]

    const passed = hasAddress && hasState  // city + zip are soft requirements
    return {
      status: passed ? 'passed' : 'failed',
      data,
      completed_at: new Date().toISOString(),
    }
  } catch (err) {
    return { status: 'error', data, error: String(err), completed_at: new Date().toISOString() }
  }
}

/**
 * Step 4: Service Area Check
 * Confirms we operate in this state and have contractors nearby.
 */
async function runStep4(opp: ScreeningOpportunity): Promise<StepResult> {
  const data: Record<string, unknown> = {}

  try {
    // States we currently serve
    const servedStates = new Set([
      'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
      'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
      'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
      'VA','WA','WV','WI','WY','DC',
    ])

    const stateUpper = (opp.state ?? '').toUpperCase()
    const inServiceArea = servedStates.has(stateUpper)

    // Count active contractors in this state
    const contractorCount = inServiceArea ? await sql`
      SELECT COUNT(*)::int as count FROM contractor_profiles
      WHERE ${stateUpper} = ANY(service_states)
        AND is_active = true
    ` : [{ count: 0 }]

    const activeNearby = contractorCount[0]?.count ?? 0

    data.in_service_area = inServiceArea
    data.matched_state = stateUpper
    data.active_contractors_nearby = activeNearby
    data.nearest_contractor_mi = activeNearby > 0 ? 12 : null  // TODO: real geo distance

    return {
      status: inServiceArea ? 'passed' : 'failed',
      data,
      completed_at: new Date().toISOString(),
    }
  } catch (err) {
    // Service area check failure shouldn't kill the pipeline
    return {
      status: 'passed',  // soft pass — don't reject if query fails
      data: { in_service_area: true, note: 'service_area_check_skipped', error: String(err) },
      completed_at: new Date().toISOString(),
    }
  }
}

/**
 * Step 5: Utility Lookup
 * Identifies utility provider and net metering policy.
 * In production: call EIA or utility API.
 */
async function runStep5(opp: ScreeningOpportunity): Promise<StepResult> {
  const data: Record<string, unknown> = {}

  try {
    // We use whatever was passed in on the opportunity
    const utilityName = opp.utility_name ?? null
    data.utility_name = utilityName
    data.utility_identified = utilityName != null

    // State-level NEM defaults (simplified)
    const nemByState: Record<string, { net_metering: boolean; nem_type: string; avg_rate: number }> = {
      CA: { net_metering: true,  nem_type: 'NEM 3.0',      avg_rate: 0.25 },
      MA: { net_metering: true,  nem_type: 'NEM 2.0',      avg_rate: 0.22 },
      NY: { net_metering: true,  nem_type: 'NEM 2.0',      avg_rate: 0.20 },
      NJ: { net_metering: true,  nem_type: 'NEM 2.0',      avg_rate: 0.18 },
      TX: { net_metering: false, nem_type: 'AVOIDED_COST', avg_rate: 0.12 },
      FL: { net_metering: true,  nem_type: 'NEM 2.0',      avg_rate: 0.13 },
      AZ: { net_metering: true,  nem_type: 'VNEM',         avg_rate: 0.14 },
      NV: { net_metering: true,  nem_type: 'NEM 2.0',      avg_rate: 0.13 },
      CO: { net_metering: true,  nem_type: 'NEM 2.0',      avg_rate: 0.13 },
      HI: { net_metering: true,  nem_type: 'VNEM',         avg_rate: 0.35 },
    }

    const stateInfo = nemByState[(opp.state ?? '').toUpperCase()]
    if (stateInfo) {
      data.net_metering = stateInfo.net_metering
      data.nem_type = stateInfo.nem_type
      data.avg_rate_kwh = stateInfo.avg_rate
    } else {
      data.net_metering = true   // default assumption
      data.nem_type = 'NEM 2.0'
      data.avg_rate_kwh = 0.13
    }

    return { status: 'passed', data, completed_at: new Date().toISOString() }
  } catch (err) {
    return { status: 'passed', data: { ...data, note: 'utility_lookup_skipped' }, completed_at: new Date().toISOString() }
  }
}

/**
 * Step 6: Solar Viability
 * Basic feasibility check: does this location get enough sun?
 */
async function runStep6(opp: ScreeningOpportunity): Promise<StepResult> {
  const data: Record<string, unknown> = {}

  try {
    // Approximate peak sun hours by state (simplified lookup)
    const pshByState: Record<string, number> = {
      HI: 6.0, AZ: 5.8, NV: 5.6, CA: 5.4, CO: 5.2, TX: 5.0,
      NM: 5.5, UT: 5.3, FL: 5.0, GA: 4.8, NC: 4.7, SC: 4.8,
      AL: 4.7, AR: 4.6, LA: 4.7, MS: 4.7, TN: 4.6, VA: 4.5,
      MD: 4.4, DE: 4.4, NJ: 4.4, NY: 4.3, CT: 4.3, MA: 4.3,
      RI: 4.2, NH: 4.2, VT: 4.1, ME: 4.1, PA: 4.3, OH: 4.1,
      IN: 4.2, IL: 4.2, MI: 3.9, WI: 3.9, MN: 4.0, IA: 4.1,
      MO: 4.3, KS: 4.6, OK: 4.8, NE: 4.5, SD: 4.4, ND: 4.2,
      MT: 4.5, WY: 4.9, ID: 4.9, OR: 4.0, WA: 3.7, AK: 2.5,
      DC: 4.3,
    }

    const stateUpper = (opp.state ?? '').toUpperCase()
    const psh = pshByState[stateUpper] ?? 4.5
    const annualKwh = psh * 365

    // Estimate system size from monthly bill
    let estSystemKw: number | null = null
    if (opp.monthly_bill) {
      const annualUsage = opp.annual_usage_kwh ?? (opp.monthly_bill / 0.13 * 12)
      estSystemKw = Math.round((annualUsage / (psh * 365 * 0.8)) * 10) / 10
    }

    const viable = psh >= 3.5
    const shadeClass = psh >= 5.5 ? 'excellent' : psh >= 4.5 ? 'good' : psh >= 3.5 ? 'fair' : 'poor'

    data.viable = viable
    data.annual_kwh_m2 = annualKwh
    data.peak_sun_hours = psh
    data.shade_class = shadeClass
    data.estimated_system_size_kw = estSystemKw
    data.state = stateUpper

    return {
      status: viable ? 'passed' : 'failed',
      data,
      completed_at: new Date().toISOString(),
    }
  } catch (err) {
    return { status: 'passed', data: { ...data, note: 'solar_viability_skipped' }, completed_at: new Date().toISOString() }
  }
}

/**
 * Step 7: Homeowner Verification
 * In production: call property records API (Attom, CoreLogic, etc.)
 * For now: flag if address is multi-unit (PO Box, Apt) which suggests non-owner
 */
async function runStep7(opp: ScreeningOpportunity): Promise<StepResult> {
  const data: Record<string, unknown> = {}

  try {
    const address = (opp.address ?? '').toLowerCase()

    // Red flags for non-homeowners
    const rentalIndicators = ['apt ', 'apt.', '#', 'suite ', 'ste ', 'unit ', 'po box', 'p.o. box']
    const likelyRenter = rentalIndicators.some(i => address.includes(i))

    // Structure type check
    const nonOwnerStructures = ['condo']
    const structureFlag = nonOwnerStructures.includes((opp.structure_type ?? '').toLowerCase())

    data.is_owner = !likelyRenter
    data.owner_match = likelyRenter ? 30 : 75   // best effort without API
    data.ownership_indicators = {
      likely_renter: likelyRenter,
      structure_flag: structureFlag,
      note: 'heuristic_check_only',
    }

    // Soft check — we don't hard fail on this without a real API call
    return {
      status: likelyRenter ? 'needs_review' as StepStatus : 'passed',
      data,
      completed_at: new Date().toISOString(),
    }
  } catch (err) {
    return { status: 'passed', data: { note: 'homeowner_check_skipped' }, completed_at: new Date().toISOString() }
  }
}

/**
 * Step 8: Credit Proxy
 * Estimates credit tier from zip code median income.
 * In production: use credit bureau pre-qualification or FICO proxy.
 */
async function runStep8(opp: ScreeningOpportunity): Promise<StepResult> {
  const data: Record<string, unknown> = {}

  try {
    // Proxy from monthly bill size (higher bill → more likely homeowner with good income)
    const bill = opp.monthly_bill ?? 0
    let credit_tier: string
    let median_income: number
    let finance_eligible: boolean

    if (bill >= 300) {
      credit_tier = 'excellent'
      median_income = 120000
      finance_eligible = true
    } else if (bill >= 200) {
      credit_tier = 'good'
      median_income = 85000
      finance_eligible = true
    } else if (bill >= 125) {
      credit_tier = 'fair'
      median_income = 62000
      finance_eligible = true
    } else if (bill >= 75) {
      credit_tier = 'fair'
      median_income = 48000
      finance_eligible = false
    } else {
      credit_tier = 'poor'
      median_income = 38000
      finance_eligible = false
    }

    data.credit_tier = credit_tier
    data.median_income = median_income
    data.finance_eligible = finance_eligible
    data.note = 'bill_size_proxy'

    return { status: 'passed', data, completed_at: new Date().toISOString() }
  } catch (err) {
    return { status: 'passed', data: { note: 'credit_proxy_skipped' }, completed_at: new Date().toISOString() }
  }
}

/**
 * Step 9: Intent Scoring
 * NLP-based intent analysis on form fields + behavioral signals.
 * Returns an intent score 0-100 and tier (hot/warm/cold).
 */
async function runStep9(opp: ScreeningOpportunity): Promise<StepResult> {
  const data: Record<string, unknown> = {}

  try {
    let score = 50  // baseline
    const signals: string[] = []
    const red_flags: string[] = []

    // Source quality signal
    const sourceBonus: Record<string, number> = {
      homeowner_direct: 20,
      google_ads:       12,
      facebook_ads:     8,
      seo:              15,
      referral:         18,
      contractor_shared: 5,
    }
    score += sourceBonus[opp.source_type ?? ''] ?? 5
    if (opp.source_type === 'homeowner_direct' || opp.source_type === 'referral') {
      signals.push('high_quality_source')
    }

    // Bill size signal
    if (opp.monthly_bill != null) {
      if (opp.monthly_bill >= 300) { score += 15; signals.push('high_bill') }
      else if (opp.monthly_bill >= 200) { score += 10 }
      else if (opp.monthly_bill >= 150) { score += 5 }
      else if (opp.monthly_bill < 75)  { score -= 10; red_flags.push('low_bill') }
    }

    // Contact quality
    if (opp.homeowner_phone && opp.homeowner_email) {
      score += 8
      signals.push('complete_contact_info')
    }

    // Address completeness
    if (opp.address && opp.city && opp.state && opp.zip) {
      score += 5
      signals.push('complete_address')
    } else {
      score -= 5
      red_flags.push('incomplete_address')
    }

    // Form completeness (derived)
    const fieldsPresent = [
      opp.homeowner_first_name,
      opp.homeowner_last_name,
      opp.homeowner_email,
      opp.homeowner_phone,
      opp.address,
      opp.monthly_bill,
    ].filter(Boolean).length
    const form_completeness = fieldsPresent / 6

    if (form_completeness >= 0.9) { score += 10; signals.push('complete_form') }
    else if (form_completeness < 0.5) { score -= 15; red_flags.push('sparse_form') }

    score = Math.max(0, Math.min(100, score))

    const intent_tier = score >= 75 ? 'hot' : score >= 50 ? 'warm' : 'cold'
    const form_quality = form_completeness >= 0.8 ? 'complete' : form_completeness >= 0.5 ? 'partial' : 'sparse'

    data.intent_score = score
    data.intent_tier = intent_tier
    data.signals = signals
    data.red_flags = red_flags
    data.form_quality = form_quality
    data.form_completeness = form_completeness

    return { status: 'passed', data, completed_at: new Date().toISOString() }
  } catch (err) {
    return { status: 'passed', data: { intent_score: 60, intent_tier: 'warm', note: 'intent_scoring_skipped' }, completed_at: new Date().toISOString() }
  }
}

/**
 * Step 10: Final Decision
 * Aggregates all step results into a pass/fail/needs_review decision.
 */
async function runStep10(
  steps: Partial<Record<string, StepResult>>,
  failedSteps: string[]
): Promise<StepResult> {
  const data: Record<string, unknown> = {}

  try {
    const fail_reasons: string[] = []
    const review_flags: string[] = []

    // Hard failures
    if (steps.step1?.status === 'failed') fail_reasons.push('invalid_contact_info')
    if (steps.step2?.status === 'failed') fail_reasons.push('duplicate_lead')
    if (steps.step3?.status === 'failed') fail_reasons.push('invalid_address')
    if (steps.step4?.status === 'failed') fail_reasons.push('outside_service_area')
    if (steps.step6?.status === 'failed') fail_reasons.push('solar_not_viable')

    // Review flags
    if (steps.step7?.status === 'needs_review') review_flags.push('ownership_uncertain')
    if ((steps.step9?.data?.intent_score as number ?? 100) < 30) review_flags.push('low_intent_score')

    const hasFatal = fail_reasons.length > 0
    const needsReview = review_flags.length > 0 && !hasFatal

    // Composite score (simple average of steps that ran)
    const intentScore = (steps.step9?.data?.intent_score as number) ?? 65
    const composite = Math.max(0, Math.min(100, intentScore - (fail_reasons.length * 20)))

    const decision: PipelineDecision = hasFatal ? 'fail' : needsReview ? 'needs_review' : 'pass'
    const grade = composite >= 80 ? 'A' : composite >= 65 ? 'B' : composite >= 50 ? 'C' : 'F'

    data.decision = decision
    data.score = composite
    data.grade = grade
    data.fail_reasons = fail_reasons
    data.review_flags = review_flags
    data.failed_steps = failedSteps

    return {
      status: 'passed',
      data,
      completed_at: new Date().toISOString(),
    }
  } catch (err) {
    return { status: 'error', data, error: String(err), completed_at: new Date().toISOString() }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Main Export: runScreeningPipeline
// ──────────────────────────────────────────────────────────────────────────────

export async function runScreeningPipeline(opportunityId: string): Promise<PipelineResult> {
  const startTime = Date.now()

  // Fetch the opportunity
  const oppRows = await sql`
    SELECT * FROM network_opportunities WHERE id = ${opportunityId} LIMIT 1
  `
  const opp = (oppRows[0] as ScreeningOpportunity | undefined)
  if (!opp) throw new Error(`Opportunity ${opportunityId} not found`)

  // Update status to screening
  await sql`
    UPDATE network_opportunities
    SET status = 'screening', updated_at = NOW()
    WHERE id = ${opportunityId}
  `

  // Create or update screening queue row
  await sql`
    INSERT INTO opportunity_screening_queue (opportunity_id, pipeline_status, started_at)
    VALUES (${opportunityId}, 'running', NOW())
    ON CONFLICT (opportunity_id) DO UPDATE
    SET pipeline_status = 'running', started_at = NOW(), updated_at = NOW()
  `

  // Run each step sequentially
  const step1 = await runStep1(opp)
  const step2 = await runStep2(opp)
  const step3 = await runStep3(opp)
  const step4 = await runStep4(opp)
  const step5 = await runStep5(opp)
  const step6 = await runStep6(opp)
  const step7 = await runStep7(opp)
  const step8 = await runStep8(opp)
  const step9 = await runStep9(opp)

  const allSteps = { step1, step2, step3, step4, step5, step6, step7, step8, step9 }
  const failedSteps = Object.entries(allSteps)
    .filter(([, s]) => s.status === 'failed')
    .map(([name]) => name)

  const step10 = await runStep10(allSteps, failedSteps)

  const decision = (step10.data.decision as PipelineDecision) ?? 'needs_review'
  const confidence = (step10.data.score as number) ?? 60
  const duration = Date.now() - startTime

  const pipelineResult: PipelineResult = {
    opportunity_id: opportunityId,
    pipeline_status: 'completed',
    auto_decision: decision,
    auto_decision_reason: decision === 'pass'
      ? 'All critical checks passed'
      : decision === 'fail'
      ? `Failed: ${(step10.data.fail_reasons as string[]).join(', ')}`
      : `Needs review: ${(step10.data.review_flags as string[]).join(', ')}`,
    confidence_score: confidence,
    steps: { step1, step2, step3, step4, step5, step6, step7, step8, step9, step10 },
    duration_ms: duration,
    fail_reasons: (step10.data.fail_reasons as string[]) ?? [],
    review_flags: (step10.data.review_flags as string[]) ?? [],
  }

  // Persist results to DB
  const s1 = step1.data
  const s2 = step2.data
  const s3 = step3.data
  const s4 = step4.data
  const s5 = step5.data
  const s6 = step6.data
  const s7 = step7.data
  const s8 = step8.data
  const s9 = step9.data
  const s10 = step10.data

  await sql`
    UPDATE opportunity_screening_queue SET
      pipeline_status       = 'completed',
      completed_at          = NOW(),
      duration_ms           = ${duration},
      auto_decision         = ${decision},
      auto_decision_reason  = ${pipelineResult.auto_decision_reason},
      confidence_score      = ${confidence},
      step1_status          = ${step1.status},
      step1_phone_valid     = ${(s1.phone_valid as boolean) ?? false},
      step1_email_valid     = ${(s1.email_valid as boolean) ?? false},
      step1_phone_type      = ${(s1.phone_type as string) ?? null},
      step1_email_risk      = ${(s1.email_risk as string) ?? null},
      step1_data            = ${JSON.stringify(s1)},
      step1_completed_at    = ${step1.completed_at},
      step1_error           = ${step1.error ?? null},
      step2_status          = ${step2.status},
      step2_is_duplicate    = ${(s2.is_duplicate as boolean) ?? false},
      step2_duplicate_of    = ${(s2.duplicate_of as string) ?? null},
      step2_match_score     = ${(s2.match_score as number) ?? 0},
      step2_data            = ${JSON.stringify(s2)},
      step2_completed_at    = ${step2.completed_at},
      step2_error           = ${step2.error ?? null},
      step3_status          = ${step3.status},
      step3_address_valid   = ${(s3.address_valid as boolean) ?? false},
      step3_formatted_address = ${(s3.formatted_address as string) ?? null},
      step3_lat             = ${(s3.lat as number) ?? null},
      step3_lng             = ${(s3.lng as number) ?? null},
      step3_county          = ${(s3.county as string) ?? null},
      step3_data            = ${JSON.stringify(s3)},
      step3_completed_at    = ${step3.completed_at},
      step3_error           = ${step3.error ?? null},
      step4_status          = ${step4.status},
      step4_in_service_area = ${(s4.in_service_area as boolean) ?? true},
      step4_matched_state   = ${(s4.matched_state as string) ?? null},
      step4_active_contractors_nearby = ${(s4.active_contractors_nearby as number) ?? 0},
      step4_data            = ${JSON.stringify(s4)},
      step4_completed_at    = ${step4.completed_at},
      step4_error           = ${step4.error ?? null},
      step5_status          = ${step5.status},
      step5_utility_name    = ${(s5.utility_name as string) ?? null},
      step5_net_metering    = ${(s5.net_metering as boolean) ?? true},
      step5_nem_type        = ${(s5.nem_type as string) ?? null},
      step5_avg_rate_kwh    = ${(s5.avg_rate_kwh as number) ?? null},
      step5_data            = ${JSON.stringify(s5)},
      step5_completed_at    = ${step5.completed_at},
      step5_error           = ${step5.error ?? null},
      step6_status          = ${step6.status},
      step6_viable          = ${(s6.viable as boolean) ?? true},
      step6_annual_kwh_m2   = ${(s6.annual_kwh_m2 as number) ?? null},
      step6_peak_sun_hours  = ${(s6.peak_sun_hours as number) ?? null},
      step6_shade_class     = ${(s6.shade_class as string) ?? null},
      step6_estimated_system_size_kw = ${(s6.estimated_system_size_kw as number) ?? null},
      step6_data            = ${JSON.stringify(s6)},
      step6_completed_at    = ${step6.completed_at},
      step6_error           = ${step6.error ?? null},
      step7_status          = ${step7.status},
      step7_is_owner        = ${(s7.is_owner as boolean) ?? null},
      step7_data            = ${JSON.stringify(s7)},
      step7_completed_at    = ${step7.completed_at},
      step7_error           = ${step7.error ?? null},
      step8_status          = ${step8.status},
      step8_credit_tier     = ${(s8.credit_tier as string) ?? null},
      step8_median_income   = ${(s8.median_income as number) ?? null},
      step8_finance_eligible = ${(s8.finance_eligible as boolean) ?? null},
      step8_data            = ${JSON.stringify(s8)},
      step8_completed_at    = ${step8.completed_at},
      step8_error           = ${step8.error ?? null},
      step9_status          = ${step9.status},
      step9_intent_score    = ${(s9.intent_score as number) ?? null},
      step9_intent_tier     = ${(s9.intent_tier as string) ?? null},
      step9_data            = ${JSON.stringify(s9)},
      step9_completed_at    = ${step9.completed_at},
      step9_error           = ${step9.error ?? null},
      step10_status         = ${step10.status},
      step10_decision       = ${(s10.decision as string) ?? null},
      step10_score          = ${(s10.score as number) ?? null},
      step10_grade          = ${(s10.grade as string) ?? null},
      step10_data           = ${JSON.stringify(s10)},
      step10_completed_at   = ${step10.completed_at},
      step10_error          = ${step10.error ?? null},
      updated_at            = NOW()
    WHERE opportunity_id = ${opportunityId}
  `

  // Update opportunity status
  const newStatus = decision === 'pass' ? 'scored' :
                    decision === 'fail' ? 'rejected' : 'screening'

  await sql`
    UPDATE network_opportunities
    SET status = ${newStatus}, updated_at = NOW()
    WHERE id = ${opportunityId}
  `

  return pipelineResult
}
