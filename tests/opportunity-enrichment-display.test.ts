import { describe, expect, it } from 'vitest'
import {
  buildEnrichmentChips,
  buildEnrichmentDetailGroups,
  deriveEnrichmentState,
  enrichmentWarnings,
  percentFromCompleteness,
  topEnrichmentFactors,
} from '@/lib/network/opportunityEnrichmentDisplay'

const enrichedRow = {
  enrichment_completeness: 0.84,
  enrichment_warnings: ['missing utility bill'],
  confidence_score: 78,
  enrichment_payload: {
    schema_version: 'opportunity-enrichment.v1',
    derivation: { method: 'deterministic', inputs: ['network_opportunities'] },
    core: {
      estimated_system_size_kw: { value: 8.7, confidence: 0.82, factors: ['network_opportunities.estimated_system_size_kw'] },
      estimated_project_value: { value: 34800, confidence: 0.78, factors: ['network_opportunities.estimated_project_value'] },
    },
    homeowner_sales: {
      homeowner_intent_score: { value: 82, confidence: 0.74, factors: ['homeowner timeline', 'lead source'] },
      battery_likelihood: { value: 0.68, confidence: 0.7, factors: ['high utility rates'] },
    },
    roof_install: {
      battery_readiness: { value: 'ready', confidence: 0.73, factors: ['battery candidate flag'] },
      install_difficulty: { value: 'medium', confidence: 0.72, factors: ['roof complexity'] },
      electrical_upgrade_likelihood: { value: 0.62, confidence: 0.54, factors: ['system size'], missing_data: ['main_panel_amps'] },
      shading_risk: { value: 38, confidence: 0.58, factors: ['roof usable percentage'] },
    },
    territory_utility: {
      utility_score: { value: 52, confidence: 0.69, factors: ['utility complexity'] },
      permit_complexity: { value: 'high', confidence: 0.67, factors: ['AHJ complexity score'] },
      ahj_complexity: { value: 'high', confidence: 0.7, factors: ['AHJ name'] },
    },
    marketplace: {
      contractor_fit_score: { value: 88, confidence: 0.75, factors: ['top match score'] },
      lead_liquidity_score: { value: 72, confidence: 0.71, factors: ['eligible contractors'] },
      marketplace_priority: { value: 'high', confidence: 0.72, factors: ['opportunity score'] },
      assignment_priority: { value: 'high', confidence: 0.7, factors: ['marketplace priority'] },
    },
    risk: {
      fraud_risk: { value: 0.18, confidence: 0.69, factors: ['spam flag', 'duplicate flag'] },
    },
  },
}

describe('opportunity enrichment display adapter', () => {
  it('handles missing enrichment gracefully without raw payload assumptions', () => {
    const row = { enrichment_payload: null, enrichment_completeness: null, enrichment_warnings: null }
    expect(deriveEnrichmentState(row)).toBe('Needs Enrichment')
    expect(buildEnrichmentChips(row, 'contractor')).toEqual([])
    expect(buildEnrichmentDetailGroups(row)).toEqual([])
    expect(enrichmentWarnings(row)).toEqual([])
    expect(percentFromCompleteness(null)).toBe(0)
  })

  it('derives operational states from completeness, warnings, screening failures, and risk', () => {
    expect(deriveEnrichmentState(enrichedRow)).toBe('Ready for Marketplace')
    expect(deriveEnrichmentState({ ...enrichedRow, enrichment_completeness: 0.42 })).toBe('Needs More Data')
    expect(deriveEnrichmentState({ ...enrichedRow, screening_failure_reasons: ['invalid address risk'] })).toBe('High Risk')
    expect(deriveEnrichmentState({ ...enrichedRow, enrichment_payload: { ...enrichedRow.enrichment_payload, risk: { fraud_risk: { value: 0.72 } } } })).toBe('High Risk')
  })

  it('keeps contractor chips concise and operational', () => {
    const chips = buildEnrichmentChips(enrichedRow, 'contractor')
    expect(chips.length).toBeLessThanOrEqual(5)
    expect(chips.map(chip => chip.label)).toEqual(expect.arrayContaining(['Battery Ready', 'High Homeowner Intent', 'Premium Opportunity', 'Complex Permit Area']))
    expect(chips.map(chip => chip.label)).not.toContain('Fraud Risk')
  })

  it('builds grouped explainability without exposing derivation or giant JSON internals', () => {
    const groups = buildEnrichmentDetailGroups(enrichedRow)
    expect(groups.map(group => group.title)).toEqual(expect.arrayContaining(['Financial', 'Install', 'Utility/AHJ', 'Marketplace', 'Risk']))
    const renderedText = JSON.stringify(groups)
    expect(renderedText).toContain('Project Value')
    expect(renderedText).toContain('confidence')
    expect(renderedText).not.toContain('schema_version')
    expect(renderedText).not.toContain('derivation')
    expect(renderedText).not.toContain('network_opportunities')
    expect(topEnrichmentFactors(enrichedRow, 3).length).toBe(3)
  })
})
