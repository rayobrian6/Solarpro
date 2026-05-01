/**
 * lib/incentives/incentiveEngine.ts
 * Incentive engine — applies all applicable incentives to a solar project financial model.
 */

import { calculateIncentives, getStateIncentives, FEDERAL_ITC } from './stateIncentives';

export interface IncentiveEngineInput {
  stateCode: string;
  systemCostBeforeIncentives: number;
  systemKw: number;
  annualKwhProduction: number;
  isResidential?: boolean;
  // Financial model inputs
  utilityRatePerKwh: number;
  annualConsumptionKwh: number;
  utilityEscalationRate?: number;  // default 3%
  systemDegradationRate?: number;  // default 0.5%/year
  financeType?: 'cash' | 'loan' | 'lease' | 'ppa';
  loanRate?: number;               // APR %
  loanTermYears?: number;
}

export interface YearlyProjection {
  year: number;
  production: number;
  utilityRate: number;
  annualSavings: number;
  cumulativeSavings: number;
  loanPayment: number;
  netCashFlow: number;
  cumulativeNetCashFlow: number;
}

export interface IncentiveEngineResult {
  // System cost
  grossSystemCost: number;
  federalItcValue: number;
  stateIncentivesValue: number;
  totalIncentivesValue: number;
  netSystemCost: number;
  // Incentive details
  incentiveBreakdown: {
    name: string;
    type: string;
    value: number;
    description: string;
  }[];
  // Financial metrics
  paybackYears: number;
  roi25Year: number;
  npv25Year: number;
  irr: number;
  // Annual figures
  year1Savings: number;
  year10Savings: number;
  year25Savings: number;
  lifetimeSavings: number;
  // Monthly
  avgMonthlySavings: number;
  // 25-year projection
  yearlyProjection: YearlyProjection[];
  // Loan (if applicable)
  monthlyLoanPayment?: number;
  totalLoanCost?: number;
  // Summary
  summary: string;
}

// ── Simple IRR calculation ────────────────────────────────────────────────────
function calculateIrr(cashFlows: number[]): number {
  let rate = 0.1;
  for (let iter = 0; iter < 100; iter++) {
    let npv = 0;
    let dnpv = 0;
    for (let t = 0; t < cashFlows.length; t++) {
      npv += cashFlows[t] / Math.pow(1 + rate, t);
      dnpv -= t * cashFlows[t] / Math.pow(1 + rate, t + 1);
    }
    if (Math.abs(npv) < 0.01) break;
    rate -= npv / dnpv;
    if (rate < -0.99) rate = -0.99;
    if (rate > 10) rate = 10;
  }
  return Math.round(rate * 1000) / 10; // return as %
}

// ── NPV calculation ───────────────────────────────────────────────────────────
function calculateNpv(cashFlows: number[], discountRate: number = 0.06): number {
  return cashFlows.reduce((npv, cf, t) => npv + cf / Math.pow(1 + discountRate, t), 0);
}

// ── Monthly loan payment ──────────────────────────────────────────────────────
function calculateMonthlyPayment(principal: number, annualRate: number, termYears: number): number {
  if (annualRate === 0) return principal / (termYears * 12);
  const r = annualRate / 100 / 12;
  const n = termYears * 12;
  return principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

// ── Main engine ───────────────────────────────────────────────────────────────
export function runIncentiveEngine(input: IncentiveEngineInput): IncentiveEngineResult {
  const {
    stateCode,
    systemCostBeforeIncentives,
    systemKw,
    annualKwhProduction,
    isResidential = true,
    utilityRatePerKwh,
    annualConsumptionKwh,
    utilityEscalationRate = 0.03,
    systemDegradationRate = 0.005,
    financeType = 'cash',
    loanRate = 6.99,
    loanTermYears = 25,
  } = input;

  // Calculate incentives
  const incentives = calculateIncentives(
    stateCode,
    systemCostBeforeIncentives,
    systemKw,
    annualKwhProduction,
    isResidential,
  );

  // Build incentive breakdown
  const incentiveBreakdown = [
    {
      name: incentives.federal.incentiveName,
      type: 'Federal Tax Credit',
      value: incentives.federal.calculatedValue,
      description: incentives.federal.description,
    },
    ...incentives.state.map(s => ({
      name: s.incentiveName,
      type: s.type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      value: s.calculatedValue,
      description: s.description,
    })),
  ];

  const netSystemCost = incentives.netSystemCost;

  // Loan payment
  let monthlyLoanPayment: number | undefined;
  let totalLoanCost: number | undefined;
  let annualLoanPayment = 0;

  if (financeType === 'loan') {
    monthlyLoanPayment = calculateMonthlyPayment(netSystemCost, loanRate, loanTermYears);
    totalLoanCost = monthlyLoanPayment * loanTermYears * 12;
    annualLoanPayment = monthlyLoanPayment * 12;
  }

  // 25-year projection
  const yearlyProjection: YearlyProjection[] = [];
  let cumulativeSavings = 0;
  let cumulativeNetCashFlow = financeType === 'cash' ? -netSystemCost : 0;
  let paybackYears = 0;
  let paybackFound = false;

  for (let year = 1; year <= 25; year++) {
    const degradationFactor = Math.pow(1 - systemDegradationRate, year - 1);
    const production = Math.round(annualKwhProduction * degradationFactor);
    const utilityRate = utilityRatePerKwh * Math.pow(1 + utilityEscalationRate, year - 1);
    const annualSavings = Math.round(Math.min(production, annualConsumptionKwh) * utilityRate);
    cumulativeSavings += annualSavings;

    const loanPayment = year <= loanTermYears ? annualLoanPayment : 0;
    const netCashFlow = annualSavings - loanPayment;
    cumulativeNetCashFlow += netCashFlow;

    if (!paybackFound && cumulativeNetCashFlow >= 0) {
      paybackYears = year;
      paybackFound = true;
    }

    yearlyProjection.push({
      year,
      production,
      utilityRate: Math.round(utilityRate * 1000) / 1000,
      annualSavings,
      cumulativeSavings,
      loanPayment: Math.round(loanPayment),
      netCashFlow: Math.round(netCashFlow),
      cumulativeNetCashFlow: Math.round(cumulativeNetCashFlow),
    });
  }

  if (!paybackFound) paybackYears = 25; // didn't pay back in 25 years

  // Financial metrics
  const year1Savings = yearlyProjection[0]?.annualSavings || 0;
  const year10Savings = yearlyProjection[9]?.annualSavings || 0;
  const year25Savings = yearlyProjection[24]?.annualSavings || 0;
  const lifetimeSavings = yearlyProjection[24]?.cumulativeSavings || 0;
  const avgMonthlySavings = Math.round(year1Savings / 12);

  // Cash flows for IRR/NPV (cash purchase)
  const cashFlows = [-netSystemCost, ...yearlyProjection.map(y => y.annualSavings)];
  const irr = calculateIrr(cashFlows);
  const npv25Year = Math.round(calculateNpv(cashFlows));
  const roi25Year = Math.round(((lifetimeSavings - netSystemCost) / netSystemCost) * 100);

  return {
    grossSystemCost: systemCostBeforeIncentives,
    federalItcValue: incentives.federal.calculatedValue,
    stateIncentivesValue: incentives.state.reduce((s, i) => s + i.calculatedValue, 0),
    totalIncentivesValue: incentives.total,
    netSystemCost,
    incentiveBreakdown,
    paybackYears,
    roi25Year,
    npv25Year,
    irr,
    year1Savings,
    year10Savings,
    year25Savings,
    lifetimeSavings,
    avgMonthlySavings,
    yearlyProjection,
    monthlyLoanPayment: monthlyLoanPayment ? Math.round(monthlyLoanPayment) : undefined,
    totalLoanCost: totalLoanCost ? Math.round(totalLoanCost) : undefined,
    summary: `Net cost after incentives: $${netSystemCost.toLocaleString()} | Payback: ${paybackYears} years | 25-yr savings: $${lifetimeSavings.toLocaleString()}`,
  };
}