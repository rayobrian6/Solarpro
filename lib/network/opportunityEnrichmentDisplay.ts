export interface EnrichedDisplayField<T = unknown> {
  value: T | null
  confidence?: number | null
  factors?: string[] | null
  notes?: string[] | null
  warnings?: string[] | null
  missing_data?: string[] | null
}

export interface EnrichmentCarrier {
  enrichment_payload?: unknown
  enrichment_completeness?: number | string | null
  enrichment_warnings?: unknown
  enriched_at?: string | null
  auto_decision?: string | null
  override_decision?: string | null
  confidence_score?: number | string | null
  screening_failure_reasons?: unknown
  step10_fail_reasons?: unknown
  low_quality_reason?: string | null
}

export type EnrichmentState = 'Needs Enrichment' | 'Needs More Data' | 'Ready for Review' | 'Ready for Marketplace' | 'Low Confidence' | 'High Risk'

export interface EnrichmentChip {
  label: string
  tone: 'emerald' | 'amber' | 'blue' | 'rose' | 'orange' | 'violet' | 'slate'
  audience?: 'admin' | 'contractor' | 'both'
}

export interface EnrichmentDetailItem {
  label: string
  value: string
  confidence?: number | null
  warnings: string[]
  factors: string[]
  missing: string[]
}

export interface EnrichmentDetailGroup {
  title: 'Financial' | 'Install' | 'Utility/AHJ' | 'Marketplace' | 'Risk'
  items: EnrichmentDetailItem[]
}

const GROUPS = ['core', 'homeowner_sales', 'roof_install', 'territory_utility', 'marketplace', 'risk'] as const

type PayloadRecord = Record<string, unknown>

function isRecord(value: unknown): value is PayloadRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function getEnrichmentPayload(row: EnrichmentCarrier): PayloadRecord | null {
  return isRecord(row.enrichment_payload) ? row.enrichment_payload : null
}

export function percentFromCompleteness(value: unknown): number {
  const raw = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : 0
  if (!Number.isFinite(raw)) return 0
  const normalized = raw <= 1 ? raw * 100 : raw
  return Math.max(0, Math.min(100, Math.round(normalized)))
}

export function enrichmentWarnings(row: EnrichmentCarrier): string[] {
  if (Array.isArray(row.enrichment_warnings)) return row.enrichment_warnings.map(String).filter(Boolean)
  if (typeof row.enrichment_warnings === 'string') {
    try {
      const parsed = JSON.parse(row.enrichment_warnings)
      return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [row.enrichment_warnings].filter(Boolean)
    } catch {
      return [row.enrichment_warnings].filter(Boolean)
    }
  }
  return []
}

export function getEnrichedField<T = unknown>(payload: unknown, group: string, key: string): EnrichedDisplayField<T> | null {
  if (!isRecord(payload)) return null
  const groupValue = payload[group]
  if (!isRecord(groupValue)) return null
  const field = groupValue[key]
  if (!isRecord(field) || !('value' in field)) return null
  return field as unknown as EnrichedDisplayField<T>
}

export function fieldValue<T = unknown>(payload: unknown, group: string, key: string): T | null {
  const field = getEnrichedField<T>(payload, group, key)
  return field ? field.value : null
}

export function formatDisplayValue(value: unknown): string {
  if (value == null || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') {
    if (value > 0 && value < 1) return `${Math.round(value * 100)}%`
    return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(1)
  }
  if (Array.isArray(value)) return value.length ? value.map(v => String(v).replace(/_/g, ' ')).join(', ') : '—'
  return String(value).replace(/_/g, ' ')
}

export function formatConfidence(confidence?: number | string | null): string {
  const raw = typeof confidence === 'string' ? Number(confidence) : typeof confidence === 'number' ? confidence : null
  if (raw == null || !Number.isFinite(raw)) return '—'
  return `${Math.round((raw <= 1 ? raw * 100 : raw))}%`
}

export function deriveEnrichmentState(row: EnrichmentCarrier): EnrichmentState {
  const payload = getEnrichmentPayload(row)
  const completeness = percentFromCompleteness(row.enrichment_completeness)
  const warnings = enrichmentWarnings(row)
  const risk = fieldValue<number>(payload, 'risk', 'fraud_risk') ?? 0
  const confidence = typeof row.confidence_score === 'string' ? Number(row.confidence_score) : Number(row.confidence_score ?? 0)
  const screeningFailures = normalizeStringArray(row.screening_failure_reasons).concat(normalizeStringArray(row.step10_fail_reasons))

  if (!payload || completeness === 0) return 'Needs Enrichment'
  if (risk >= 0.6 || screeningFailures.length > 0 || row.low_quality_reason) return 'High Risk'
  if (completeness < 45) return 'Needs More Data'
  if (warnings.length >= 3 || completeness < 70) return 'Ready for Review'
  if ((confidence > 0 && confidence < 55) || warnings.some(w => w.toLowerCase().includes('low confidence'))) return 'Low Confidence'
  return 'Ready for Marketplace'
}

export function stateTone(state: EnrichmentState): 'emerald' | 'amber' | 'blue' | 'rose' | 'orange' | 'slate' {
  switch (state) {
    case 'Ready for Marketplace': return 'emerald'
    case 'Ready for Review': return 'blue'
    case 'Needs More Data': return 'amber'
    case 'Low Confidence': return 'orange'
    case 'High Risk': return 'rose'
    default: return 'slate'
  }
}

export function buildEnrichmentChips(row: EnrichmentCarrier, audience: 'admin' | 'contractor' = 'admin'): EnrichmentChip[] {
  const payload = getEnrichmentPayload(row)
  const chips: EnrichmentChip[] = []
  const push = (chip: EnrichmentChip) => {
    if (!chips.some(existing => existing.label === chip.label)) chips.push(chip)
  }

  const batteryLikelihood = fieldValue<number>(payload, 'homeowner_sales', 'battery_likelihood')
  const batteryReadiness = fieldValue<string>(payload, 'roof_install', 'battery_readiness')
  const homeownerIntent = fieldValue<number>(payload, 'homeowner_sales', 'homeowner_intent_score')
  const priority = fieldValue<string>(payload, 'marketplace', 'marketplace_priority')
  const permitComplexity = fieldValue<string>(payload, 'territory_utility', 'permit_complexity')
  const ahjComplexity = fieldValue<string>(payload, 'territory_utility', 'ahj_complexity')
  const installDifficulty = fieldValue<string>(payload, 'roof_install', 'install_difficulty')
  const utilityScore = fieldValue<number>(payload, 'territory_utility', 'utility_score')
  const fraudRisk = fieldValue<number>(payload, 'risk', 'fraud_risk')
  const electricalUpgrade = fieldValue<number>(payload, 'roof_install', 'electrical_upgrade_likelihood')
  const shadingRisk = fieldValue<number>(payload, 'roof_install', 'shading_risk')
  const financingProbability = fieldValue<number>(payload, 'homeowner_sales', 'financing_probability')
  const projectValue = fieldValue<number>(payload, 'core', 'estimated_project_value')

  if (batteryReadiness === 'ready' || batteryReadiness === 'likely_candidate' || (batteryLikelihood ?? 0) >= 0.55) push({ label: audience === 'contractor' ? 'Battery Ready' : 'High Battery Potential', tone: 'amber', audience: 'both' })
  if ((homeownerIntent ?? 0) >= 70) push({ label: audience === 'contractor' ? 'High Homeowner Intent' : 'High Intent', tone: 'emerald', audience: 'both' })
  if (priority === 'high' || priority === 'urgent') push({ label: audience === 'contractor' ? 'Premium Opportunity' : 'High Value Opportunity', tone: 'violet', audience: 'both' })
  if (permitComplexity === 'high' || ahjComplexity === 'high') push({ label: audience === 'contractor' ? 'Complex Permit Area' : 'Complex AHJ', tone: 'orange', audience: 'both' })
  if ((utilityScore ?? 100) < 45) push({ label: audience === 'contractor' ? 'Utility Friction' : 'Utility Friction', tone: 'orange', audience: 'both' })
  if ((electricalUpgrade ?? 0) >= 0.55) push({ label: 'Electrical Upgrade Likely', tone: 'blue', audience: 'both' })
  if ((fraudRisk ?? 0) >= 0.45) push({ label: 'Fraud Risk', tone: 'rose', audience: 'admin' })
  if ((financingProbability ?? 0) >= 0.55) push({ label: 'Financing Ready', tone: 'emerald', audience: 'admin' })
  if ((shadingRisk ?? 0) >= 60) push({ label: audience === 'contractor' ? 'High Shade Risk' : 'Shading Uncertainty', tone: 'rose', audience: 'both' })
  if (installDifficulty === 'high') push({ label: audience === 'contractor' ? 'Install Complexity' : 'Steep Roof', tone: 'rose', audience: 'both' })
  if ((projectValue ?? 0) >= 35000 && audience === 'admin') push({ label: 'High Value Opportunity', tone: 'violet', audience: 'admin' })

  return chips.filter(chip => audience === 'admin' || chip.audience !== 'admin').slice(0, audience === 'contractor' ? 5 : 8)
}

function displayFactorLabel(factor: string): string {
  const withoutSourcePrefix = factor.includes('.') ? factor.split('.').pop() ?? factor : factor
  return withoutSourcePrefix.replace(/_/g, ' ')
}

export function topEnrichmentFactors(row: EnrichmentCarrier, limit = 4): string[] {
  const payload = getEnrichmentPayload(row)
  if (!payload) return []
  const factors: string[] = []
  for (const group of GROUPS) {
    const groupValue = payload[group]
    if (!isRecord(groupValue)) continue
    for (const field of Object.values(groupValue)) {
      if (!isRecord(field)) continue
      normalizeStringArray(field.factors).forEach(factor => {
        const label = displayFactorLabel(factor)
        if (label && !factors.includes(label)) factors.push(label)
      })
    }
  }
  return factors.slice(0, limit)
}

export function buildEnrichmentDetailGroups(row: EnrichmentCarrier): EnrichmentDetailGroup[] {
  const payload = getEnrichmentPayload(row)
  if (!payload) return []
  const spec: Array<[EnrichmentDetailGroup['title'], Array<[string, string, string]>]> = [
    ['Financial', [['System Size', 'core', 'estimated_system_size_kw'], ['Project Value', 'core', 'estimated_project_value'], ['Margin', 'core', 'estimated_margin'], ['Financing', 'homeowner_sales', 'financing_probability']]],
    ['Install', [['Install Difficulty', 'roof_install', 'install_difficulty'], ['Battery Readiness', 'roof_install', 'battery_readiness'], ['Electrical Upgrade', 'roof_install', 'electrical_upgrade_likelihood'], ['Shading Risk', 'roof_install', 'shading_risk']]],
    ['Utility/AHJ', [['Utility Score', 'territory_utility', 'utility_score'], ['Permit Complexity', 'territory_utility', 'permit_complexity'], ['AHJ Complexity', 'territory_utility', 'ahj_complexity']]],
    ['Marketplace', [['Priority', 'marketplace', 'marketplace_priority'], ['Assignment Priority', 'marketplace', 'assignment_priority'], ['Contractor Fit', 'marketplace', 'contractor_fit_score'], ['Lead Liquidity', 'marketplace', 'lead_liquidity_score']]],
    ['Risk', [['Fraud Risk', 'risk', 'fraud_risk'], ['Low Quality Reason', 'risk', 'low_quality_reason']]],
  ]

  return spec.map(([title, fields]) => ({
    title,
    items: fields.map(([label, group, key]) => {
      const field = getEnrichedField(payload, group, key)
      return {
        label,
        value: formatDisplayValue(field?.value),
        confidence: field?.confidence ?? null,
        warnings: normalizeStringArray(field?.warnings),
        factors: normalizeStringArray(field?.factors).map(displayFactorLabel).slice(0, 3),
        missing: normalizeStringArray(field?.missing_data).slice(0, 3),
      }
    }).filter(item => item.value !== '—' || item.missing.length > 0 || item.warnings.length > 0),
  })).filter(group => group.items.length > 0)
}

export function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean)
  if (typeof value === 'string' && value.trim()) return [value]
  return []
}
