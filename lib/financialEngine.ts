// ============================================================
// FINANCIAL MODELING ENGINE
// Combines PVWatts production + URDB utility rates + pricing
// to produce complete financial analysis for solar proposals
// ============================================================

export interface FinancialInputs {
  // System
  systemSizeKw: number;
  annualProductionKwh: number;
  monthlyProductionKwh?: number[];   // 12-month array

  // Utility
  utilityRatePerKwh: number;         // $/kWh current rate
  avgMonthlyBill: number;            // Current monthly bill ($)
  annualUsageKwh?: number;           // Annual consumption kWh
  utilityInflationRate?: number;     // Annual rate increase % (default 3%)
  fixedMonthlyCharge?: number;       // Fixed utility charge ($)

  // System cost
  grossSystemCost: number;           // Before incentives
  federalItcPercent?: number;        // ITC % (default 30%)
  stateIncentive?: number;           // State rebate/credit ($)
  utilityRebate?: number;            // Utility rebate ($)
  dealerFee?: number;                // Dealer/finance fee ($)
  financingRate?: number;            // APR if financed (%)
  loanTermYears?: number;            // Loan term (default 25)

  // System degradation
  annualDegradationRate?: number;    // % per year (default 0.5%)
  systemLifeYears?: number;          // Default 25
}

export interface MonthlyFinancials {
  month: string;
  productionKwh: number;
  solarOffset: number;           // kWh offset by solar
  utilityBillBefore: number;     // $ before solar
  utilityBillAfter: number;      // $ after solar (net metering)
  monthlySavings: number;        // $ saved
}

export interface YearlyProjection {
  year: number;
  productionKwh: number;
  utilityRatePerKwh: number;
  annualSavings: number;
  cumulativeSavings: number;
  systemValue: number;           // Remaining system value
}

export interface FinancialResult {
  // Incentives
  federalItcAmount: number;
  stateIncentiveAmount: number;
  utilityRebateAmount: number;
  totalIncentives: number;
  netSystemCost: number;         // After all incentives

  // Savings
  annualSavings: number;
  monthlyAvgSavings: number;
  lifetimeSavings: number;       // 25-year total

  // Payback
  paybackYears: number;
  paybackMonths: number;

  // ROI
  roiPercent: number;
  npv: number;                   // Net present value

  // Financing (if applicable)
  monthlyLoanPayment?: number;
  totalLoanCost?: number;
  loanSavingsVsUtility?: number; // Monthly savings vs current bill

  // Monthly breakdown
  monthlyFinancials: MonthlyFinancials[];

  // 25-year projection
  yearlyProjections: YearlyProjection[];

  // Summary stats
  offsetPercent: number;         // % of usage offset by solar
  pricePerWatt: number;
  costPerKwhLifetime: number;    // Effective $/kWh over system life
}

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Default monthly distribution if no PVWatts data
const DEFAULT_MONTHLY_DIST = [0.065, 0.070, 0.085, 0.090, 0.095, 0.100, 0.105, 0.100, 0.090, 0.080, 0.065, 0.055];

export function calculateFinancials(inputs: FinancialInputs): FinancialResult {
  const {
    systemSizeKw,
    annualProductionKwh,
    monthlyProductionKwh,
    utilityRatePerKwh,
    avgMonthlyBill,
    annualUsageKwh,
    utilityInflationRate = 0.03,
    fixedMonthlyCharge = 10,
    grossSystemCost,
    federalItcPercent = 0.30,
    stateIncentive = 0,
    utilityRebate = 0,
    dealerFee = 0,
    financingRate,
    loanTermYears = 25,
    annualDegradationRate = 0.005,
    systemLifeYears = 25,
  } = inputs;

  // ── Incentives ──────────────────────────────────────────────
  const federalItcAmount = Math.round(grossSystemCost * federalItcPercent);
  const stateIncentiveAmount = stateIncentive;
  const utilityRebateAmount = utilityRebate;
  const totalIncentives = federalItcAmount + stateIncentiveAmount + utilityRebateAmount;
  const netSystemCost = Math.max(0, grossSystemCost + dealerFee - totalIncentives);

  // ── Monthly production distribution ─────────────────────────
  const monthlyProd = monthlyProductionKwh && monthlyProductionKwh.length === 12
    ? monthlyProductionKwh
    : DEFAULT_MONTHLY_DIST.map(f => Math.round(annualProductionKwh * f));

  // ── Monthly financials ───────────────────────────────────────
  const annualUsage = annualUsageKwh || (avgMonthlyBill * 12 / utilityRatePerKwh);
  const monthlyUsage = annualUsage / 12;

  const monthlyFinancials: MonthlyFinancials[] = MONTHS_SHORT.map((month, i) => {
    const prod = monthlyProd[i] || 0;
    const usage = monthlyUsage;
    const solarOffset = Math.min(prod, usage);
    const remainingUsage = Math.max(0, usage - solarOffset);
    const billBefore = avgMonthlyBill;
    const billAfter = Math.max(fixedMonthlyCharge, remainingUsage * utilityRatePerKwh + fixedMonthlyCharge);
    const savings = billBefore - billAfter;
    return {
      month,
      productionKwh: Math.round(prod),
      solarOffset: Math.round(solarOffset),
      utilityBillBefore: Math.round(billBefore),
      utilityBillAfter: Math.round(billAfter),
      monthlySavings: Math.round(savings),
    };
  });

  const annualSavings = monthlyFinancials.reduce((s, m) => s + m.monthlySavings, 0);
  const monthlyAvgSavings = Math.round(annualSavings / 12);
  const offsetPercent = Math.min(100, Math.round((annualProductionKwh / annualUsage) * 100));

  // ── 25-year projection ───────────────────────────────────────
  const yearlyProjections: YearlyProjection[] = [];
  let cumulativeSavings = 0;
  let paybackYear = 0;

  for (let year = 1; year <= systemLifeYears; year++) {
    const degradationFactor = Math.pow(1 - annualDegradationRate, year - 1);
    const inflationFactor = Math.pow(1 + utilityInflationRate, year - 1);
    const yearRate = utilityRatePerKwh * inflationFactor;
    const yearProd = annualProductionKwh * degradationFactor;
    const yearSavings = Math.round(yearProd * yearRate);
    cumulativeSavings += yearSavings;

    if (paybackYear === 0 && cumulativeSavings >= netSystemCost) {
      paybackYear = year;
    }

    yearlyProjections.push({
      year,
      productionKwh: Math.round(yearProd),
      utilityRatePerKwh: Math.round(yearRate * 1000) / 1000,
      annualSavings: yearSavings,
      cumulativeSavings: Math.round(cumulativeSavings),
      systemValue: Math.round(netSystemCost * Math.pow(0.95, year - 1)), // 5% depreciation
    });
  }

  const lifetimeSavings = cumulativeSavings;

  // ── Payback ──────────────────────────────────────────────────
  // More precise payback using monthly interpolation
  let runningTotal = 0;
  let paybackMonths = 0;
  for (let m = 0; m < systemLifeYears * 12; m++) {
    const year = Math.floor(m / 12);
    const inflationFactor = Math.pow(1 + utilityInflationRate, year);
    const degradationFactor = Math.pow(1 - annualDegradationRate, year);
    const monthIdx = m % 12;
    const monthProd = (monthlyProd[monthIdx] || annualProductionKwh / 12) * degradationFactor;
    const monthSavings = monthProd * utilityRatePerKwh * inflationFactor;
    runningTotal += monthSavings;
    if (runningTotal >= netSystemCost && paybackMonths === 0) {
      paybackMonths = m + 1;
    }
  }

  const paybackYears = paybackMonths > 0 ? Math.round((paybackMonths / 12) * 10) / 10 : systemLifeYears;

  // ── ROI ──────────────────────────────────────────────────────
  const roiPercent = netSystemCost > 0
    ? Math.round(((lifetimeSavings - netSystemCost) / netSystemCost) * 100)
    : 0;

  // ── NPV (discount rate 5%) ───────────────────────────────────
  const discountRate = 0.05;
  const npv = Math.round(
    yearlyProjections.reduce((sum, y) => sum + y.annualSavings / Math.pow(1 + discountRate, y.year), 0) - netSystemCost
  );

  // ── Financing ────────────────────────────────────────────────
  let monthlyLoanPayment: number | undefined;
  let totalLoanCost: number | undefined;
  let loanSavingsVsUtility: number | undefined;

  if (financingRate && financingRate > 0) {
    const monthlyRate = financingRate / 100 / 12;
    const numPayments = loanTermYears * 12;
    monthlyLoanPayment = Math.round(
      netSystemCost * (monthlyRate * Math.pow(1 + monthlyRate, numPayments)) /
      (Math.pow(1 + monthlyRate, numPayments) - 1)
    );
    totalLoanCost = Math.round(monthlyLoanPayment * numPayments);
    loanSavingsVsUtility = Math.round(avgMonthlyBill - monthlyLoanPayment);
  }

  // ── Price per watt ───────────────────────────────────────────
  const pricePerWatt = systemSizeKw > 0
    ? Math.round((grossSystemCost / (systemSizeKw * 1000)) * 100) / 100
    : 0;

  const costPerKwhLifetime = lifetimeSavings > 0 && annualProductionKwh > 0
    ? Math.round((netSystemCost / (annualProductionKwh * systemLifeYears)) * 1000) / 1000
    : 0;

  return {
    federalItcAmount,
    stateIncentiveAmount,
    utilityRebateAmount,
    totalIncentives,
    netSystemCost,
    annualSavings,
    monthlyAvgSavings,
    lifetimeSavings,
    paybackYears,
    paybackMonths,
    roiPercent,
    npv,
    monthlyLoanPayment,
    totalLoanCost,
    loanSavingsVsUtility,
    monthlyFinancials,
    yearlyProjections,
    offsetPercent,
    pricePerWatt,
    costPerKwhLifetime,
  };
}

// ── Utility bill estimator ───────────────────────────────────
export function estimateMonthlyBill(annualKwh: number, ratePerKwh: number, fixedCharge = 10): number {
  return Math.round((annualKwh / 12) * ratePerKwh + fixedCharge);
}

// ── Quick savings estimate (for proposal cards) ──────────────
export function quickSavingsEstimate(
  systemKw: number,
  annualProductionKwh: number,
  utilityRate: number,
  grossCost: number,
  itcPercent = 0.30
): { annualSavings: number; paybackYears: number; lifetimeSavings: number; netCost: number } {
  const netCost = grossCost * (1 - itcPercent);
  const annualSavings = Math.round(annualProductionKwh * utilityRate);
  const paybackYears = annualSavings > 0 ? Math.round((netCost / annualSavings) * 10) / 10 : 25;
  const lifetimeSavings = Math.round(annualSavings * 25 * 1.03 ** 12); // rough inflation-adjusted
  return { annualSavings, paybackYears, lifetimeSavings, netCost: Math.round(netCost) };
}