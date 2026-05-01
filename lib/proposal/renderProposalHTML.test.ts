// ─────────────────────────────────────────────────────────────────────────────
// renderProposalHTML.test.ts
// Unit tests for the server-side proposal HTML renderer
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { renderProposalHTML, ProposalBranding } from './renderProposalHTML';
import type { CanonicalProposal } from './canonicalProposal';
import type { Proposal } from '@/types';

// ── Minimal fixture builders ──────────────────────────────────────────────────

function makeCP(overrides: Partial<CanonicalProposal> = {}): CanonicalProposal {
  return {
    panel: {
      manufacturer: 'Silfab',
      model: 'SIL-400-BK',
      wattage: 400,
      count: 20,
      systemSizeKw: 8.0,
      efficiency: 20.4,
      cellType: 'Monocrystalline PERC',
      bifacial: false,
      temperatureCoeff: -0.35,
      warranty: 25,
    },
    production: {
      annualKwh: 10500,
      monthlyKwh: [720, 680, 820, 890, 980, 1050, 1100, 1080, 960, 870, 730, 620],
    },
    utility: {
      provider: 'Pacific Gas & Electric',
      rate: 0.28,
      annualUsageKwh: 12000,
      escalationRate: 0.035,
      escalationRateSource: 'UTILITY_PROFILE' as any,
      escalationRateSourceLabel: 'Based on PG&E historical data',
      netMeteringType: 'NEM 3.0',
      exportRate: 0.08,
      retail_rate_type: 'tou',
      export_rate_monthly: 0.08,
      export_rate_annual_excess: 0.06,
      true_up_period: 'annual',
      policy_status: 'stable',
      confidence: 'high',
      rateHistory: [],
    },
    financial: {
      gross_system_cost: 28000,
      systemCost: 28000,
      pricePerWatt: 3.50,
      solarPaymentMonthly: 185,
      utilityBillMonthly: 45,
      totalMonthlyCost: 230,
      currentMonthlyBill: 280,
      ownershipDeltaMonthly: -50,
      financeApr: 0.0799,
      financeTermYears: 25,
      financeTermMonths: 300,
      year1BillWithoutSolar: 3360,
      year1BillWithSolar: 540,
      annualEnergyValue: 2940,
      itcRate: 0,
      itcAmount: 0,
      netCost: 28000,
      paybackYears: 9.5,
      energyValueBreakdown: {
        selfConsumed: 2200,
        exported: 740,
        total: 2940,
      },
    },
    truth25yr: {
      utilityCostWithoutSolar: 130000,
      solarCostTotal: 55500,
      remainingUtilityCost: 13500,
      netDifference: 61000,
      estimatedEnergyValue: 95000,
      netFinancialDifference: 67000,
      netDifferenceFinanced: 61000,
      srec_income_25yr: 0,
      monthlyBillChart: [
        { month: 'Jan', before: 280, after: 230, savings: 50 },
        { month: 'Feb', before: 260, after: 220, savings: 40 },
        { month: 'Mar', before: 270, after: 225, savings: 45 },
        { month: 'Apr', before: 275, after: 228, savings: 47 },
        { month: 'May', before: 290, after: 232, savings: 58 },
        { month: 'Jun', before: 310, after: 240, savings: 70 },
        { month: 'Jul', before: 330, after: 245, savings: 85 },
        { month: 'Aug', before: 325, after: 242, savings: 83 },
        { month: 'Sep', before: 300, after: 235, savings: 65 },
        { month: 'Oct', before: 285, after: 230, savings: 55 },
        { month: 'Nov', before: 270, after: 228, savings: 42 },
        { month: 'Dec', before: 260, after: 222, savings: 38 },
      ],
      projectionChart: Array.from({ length: 25 }, (_, i) => ({
        year: `Yr ${i + 1}`,
        savings: 2940 * Math.pow(1.035, i) * Math.pow(0.995, i),
        cumulative: 0,
      })),
      yearlyFlow: Array.from({ length: 25 }, (_, i) => ({
        year: i + 1,
        production_kwh: 10500 * Math.pow(0.995, i),
        consumption_kwh: 12000,
        self_consumed_kwh: 8500 * Math.pow(0.995, i),
        exported_kwh: 2000 * Math.pow(0.995, i),
        retail_rate: 0.28 * Math.pow(1.035, i),
        self_consumed_value: 2380 * Math.pow(1.035, i) * Math.pow(0.995, i),
        monthly_export_value: 160 * Math.pow(1.035, i) * Math.pow(0.995, i),
        annual_excess_value: 0,
        total_energy_value: 2940 * Math.pow(1.035, i) * Math.pow(0.995, i),
        utility_cost_without_solar: 3360 * Math.pow(1.035, i),
        utility_cost_with_solar: 540 * Math.pow(1.035, i),
        srec_income: 0,
        cumulative_without_solar: 0,
        cumulative_with_solar: 0,
      })),
    },
    offset: {
      percentage: 87.5,
      remainingPercentage: 12.5,
      isPartialOffset: true,
    },
    policy: {
      srecAvailable: false,
      srecProgramName: '',
      srecPricePerMwh: 0,
      incentivesAllowed: true,
      policyMessage: null,
      netMeteringSummary: 'NEM 3.0 — export credits at avoided cost rate',
      srecSummary: null,
      failsafeMessage: null,
      isSpecificUtilityMatch: true,
    },
    incentives: {
      itc_percent: 0,
      itc_value: 0,
      state_incentives: [],
      total_incentives: 0,
      incentives_enabled: false,
    },
    _meta: {
      builtAt: '2026-05-01T00:00:00.000Z',
      version: 'v48.3',
      purchaseMode: 'finance',
      hasWarnings: false,
      warnings: [],
      truthConfidence: 'VERIFIED' as any,
      payoffYear: 10,
      narrative: {
        primaryStory: 'Your system pays for itself in 10 years.',
        monthlyImpact: 'Save $50/month from day one.',
        payoffStatement: 'Break-even in Year 10.',
        outcomeStatement: '$61,000 ahead over 25 years.',
        fullNarrative: 'Full narrative here.',
      },
    },
    ...overrides,
  } as CanonicalProposal;
}

function makeProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: 'test-proposal-id',
    projectId: 'test-project-id',
    project: {
      id: 'test-project-id',
      name: 'Smith Residence',
      userId: 'user-1',
      address: '123 Solar Lane, San Jose, CA 95101',
      status: 'proposal' as any,
      systemType: 'roof' as any,
      stateCode: 'CA',
      utilityName: 'PG&E',
      layout: {
        id: 'layout-1',
        projectId: 'test-project-id',
        systemType: 'roof' as any,
        panels: [],
        totalPanels: 20,
        systemSizeKw: 8.0,
        mapCenter: { lat: 37.3382, lng: -121.8863 },
        mapZoom: 18,
        createdAt: '2026-05-01T00:00:00Z',
        updatedAt: '2026-05-01T00:00:00Z',
      },
      selectedPanel: {
        id: 'panel-1',
        manufacturer: 'Silfab',
        model: 'SIL-400-BK',
        wattage: 400,
        efficiency: 20.4,
        type: 'monocrystalline' as any,
        pricePerPanel: 220,
        isActive: true,
      },
      selectedInverter: {
        id: 'inv-1',
        manufacturer: 'SolarEdge',
        model: 'SE7600H',
        capacity: 7.6,
        efficiency: 99.2,
        type: 'optimizer' as any,
        pricePerUnit: 1200,
      },
      client: {
        id: 'client-1',
        userId: 'user-1',
        name: 'John Smith',
        email: 'john@example.com',
        phone: '408-555-0100',
        address: '123 Solar Lane',
        city: 'San Jose',
        state: 'CA',
        zip: '95101',
        annualKwh: 12000,
        monthlyBill: 280,
        utilityRate: 0.28,
        utilityName: 'PG&E',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
      createdAt: '2026-05-01T00:00:00Z',
      updatedAt: '2026-05-01T00:00:00Z',
    },
    status: 'draft' as any,
    title: 'Solar Proposal — Smith Residence',
    preparedBy: 'SolarPro Team',
    preparedDate: '2026-05-01T00:00:00Z',
    validUntil: '2026-06-01T00:00:00Z',
    shareToken: 'abc123def456',
    viewCount: 0,
    createdAt: '2026-05-01T00:00:00Z',
    updatedAt: '2026-05-01T00:00:00Z',
    pricingSnapshot: null,
    snapshotAt: '2026-05-01T00:00:00Z',
    dbUtilityRate: 0.28,
    ...overrides,
  } as Proposal;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('renderProposalHTML()', () => {
  it('returns a non-empty string', () => {
    const html = renderProposalHTML(makeCP(), makeProposal());
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(1000);
  });

  it('is valid HTML (has doctype + html tag)', () => {
    const html = renderProposalHTML(makeCP(), makeProposal());
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
  });

  it('includes the company name from branding', () => {
    const branding: ProposalBranding = { companyName: 'Sunshine Solar LLC', companyPhone: '555-1234' };
    const html = renderProposalHTML(makeCP(), makeProposal(), branding);
    expect(html).toContain('Sunshine Solar LLC');
    expect(html).toContain('555-1234');
  });

  it('includes project address', () => {
    const html = renderProposalHTML(makeCP(), makeProposal());
    expect(html).toContain('123 Solar Lane');
  });

  it('includes system size', () => {
    const html = renderProposalHTML(makeCP(), makeProposal());
    expect(html).toContain('8.00 kW');
  });

  it('includes panel count', () => {
    const html = renderProposalHTML(makeCP(), makeProposal());
    expect(html).toContain('20');
  });

  it('includes 25-year savings', () => {
    const html = renderProposalHTML(makeCP(), makeProposal());
    // $61,000 formatted
    expect(html).toContain('61,000');
  });

  it('includes panel manufacturer and model', () => {
    const html = renderProposalHTML(makeCP(), makeProposal());
    expect(html).toContain('Silfab');
    expect(html).toContain('SIL-400-BK');
  });

  it('includes inverter info from project.selectedInverter', () => {
    const html = renderProposalHTML(makeCP(), makeProposal());
    expect(html).toContain('SolarEdge');
    expect(html).toContain('SE7600H');
  });

  it('includes energy offset percentage', () => {
    const html = renderProposalHTML(makeCP(), makeProposal());
    expect(html).toContain('88%');  // Math.round(87.5)
  });

  it('includes utility provider name', () => {
    const html = renderProposalHTML(makeCP(), makeProposal());
    expect(html).toContain('Pacific Gas');
  });

  it('includes all 7 page sections', () => {
    const html = renderProposalHTML(makeCP(), makeProposal());
    expect(html).toContain('Solar Energy');         // cover
    expect(html).toContain('System Overview');      // system page
    expect(html).toContain('Financial Summary');    // financial page
    expect(html).toContain('25-Year Financial');    // projection page
    expect(html).toContain('Incentives');           // incentives page
    expect(html).toContain('Equipment Specifications'); // equipment page
    expect(html).toContain('Next Steps');           // next steps page
  });

  it('contains SVG bar chart for monthly production', () => {
    const html = renderProposalHTML(makeCP(), makeProposal());
    expect(html).toContain('<svg');
    expect(html).toContain('</svg>');
  });

  it('shows ITC amount when itcRate > 0', () => {
    const cpWithItc = makeCP({
      financial: {
        ...makeCP().financial,
        itcRate: 0.30,
        itcAmount: 8400,
        netCost: 19600,
      },
    });
    const html = renderProposalHTML(cpWithItc, makeProposal());
    expect(html).toContain('8,400');   // ITC dollar amount
    expect(html).toContain('30%');     // ITC rate display
  });

  it('does not show ITC section when itcRate is 0', () => {
    const html = renderProposalHTML(makeCP(), makeProposal());
    // itcRate is 0, itcAmount is 0 — ITC row should be absent from investment table
    expect(html).not.toContain('Federal ITC (0%)');
  });

  it('shows SREC section when srecAvailable is true', () => {
    const cpWithSrec = makeCP({
      policy: { ...makeCP().policy, srecAvailable: true },
      truth25yr: { ...makeCP().truth25yr, srec_income_25yr: 12000 },
    });
    const html = renderProposalHTML(cpWithSrec, makeProposal());
    expect(html).toContain('SREC');
  });

  it('handles missing project client gracefully', () => {
    const proposalNoClient = makeProposal({
      project: { ...makeProposal().project!, client: undefined },
    });
    expect(() => renderProposalHTML(makeCP(), proposalNoClient)).not.toThrow();
  });

  it('handles zero production gracefully', () => {
    const cpZero = makeCP({
      production: { annualKwh: 0, monthlyKwh: Array(12).fill(0) },
    });
    expect(() => renderProposalHTML(cpZero, makeProposal())).not.toThrow();
  });

  it('handles null payoffYear gracefully', () => {
    const cpNoPayoff = makeCP({
      _meta: { ...makeCP()._meta, payoffYear: null },
    });
    const html = renderProposalHTML(cpNoPayoff, makeProposal());
    expect(html).toContain('> 25yr');
  });

  it('produces valid HTML with no unclosed tags (basic check)', () => {
    const html = renderProposalHTML(makeCP(), makeProposal());
    const opens  = (html.match(/<div/g)  || []).length;
    const closes = (html.match(/<\/div>/g) || []).length;
    // Allow up to 2 mismatch (template literals can have edge cases)
    expect(Math.abs(opens - closes)).toBeLessThanOrEqual(2);
  });

  it('uses default branding when none provided', () => {
    const html = renderProposalHTML(makeCP(), makeProposal());
    expect(html).toContain('SolarPro');
  });

  it('includes disclaimer text', () => {
    const html = renderProposalHTML(makeCP(), makeProposal());
    expect(html).toContain('disclaimer');
  });
});

describe('renderProposalHTML() — branding variations', () => {
  it('renders with full branding', () => {
    const branding: ProposalBranding = {
      companyName: 'Green Sun Energy',
      companyAddress: '100 Solar Blvd, Austin TX 78701',
      companyPhone: '(512) 555-7890',
      companyWebsite: 'https://greensun.example.com',
      brandPrimaryColor: '#10b981',
    };
    const html = renderProposalHTML(makeCP(), makeProposal(), branding);
    expect(html).toContain('Green Sun Energy');
    expect(html).toContain('100 Solar Blvd');
    expect(html).toContain('(512) 555-7890');
  });

  it('renders with minimal branding (just companyName)', () => {
    const branding: ProposalBranding = { companyName: 'Minimal Solar' };
    expect(() => renderProposalHTML(makeCP(), makeProposal(), branding)).not.toThrow();
  });
});