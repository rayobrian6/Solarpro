/**
 * lib/proposal/financialNarrativeEngine.ts
 * v47.249 — Financial Narrative Engine
 *
 * Generates human-readable financial story text from canonical pipeline values.
 * All text is dynamically derived — no hardcoded dollar amounts.
 *
 * OUTPUT:
 *   "This system starts with a monthly gap of $X, but as utility rates increase at Y%/yr,
 *    that gap closes and reverses — resulting in $Z in net savings over 25 years."
 *
 * Must dynamically reflect:
 *   - monthly delta (solar payment vs current bill)
 *   - escalation rate + source label
 *   - payoff year (when cumulative utility avoided >= cumulative solar cost)
 *   - 25-yr net savings
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface FinancialNarrativeInput {
  /** Current monthly utility bill before solar */
  currentMonthlyBill: number;
  /** Monthly solar payment (finance mode) or 0 (cash) */
  solarPaymentMonthly: number;
  /** Remaining monthly utility bill after solar offset */
  utilityBillMonthly: number;
  /** Annual utility rate escalation (e.g. 0.03) */
  escalationRate: number;
  /** Human-readable source label for escalation (from utilityTruthEngine) */
  escalationRateSourceLabel: string;
  /** Year when cumulative utility cost avoided >= cumulative solar investment */
  payoffYear: number | null;
  /** 25-year net savings (canonical netDifference, cash basis) */
  netSavings25yr: number;
  /** Purchase mode */
  purchaseMode: 'finance' | 'cash';
  /** Annual production value (annualKwh × rate) */
  annualEnergyValue: number;
  /** Whether system is partial offset (< 100%) */
  isPartialOffset: boolean;
  /** Energy offset percentage */
  offsetPct: number;
}

export interface FinancialNarrative {
  /** Primary story sentence — the main 1-sentence financial arc */
  primaryStory: string;
  /** Monthly impact sentence — what changes on day 1 */
  monthlyImpact: string;
  /** Payoff milestone sentence */
  payoffStatement: string;
  /** 25-year outcome sentence */
  outcomeStatement: string;
  /** Full combined narrative (all 4 sentences joined) */
  fullNarrative: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Engine
// ─────────────────────────────────────────────────────────────────────────────

export function buildFinancialNarrative(input: FinancialNarrativeInput): FinancialNarrative {
  const {
    currentMonthlyBill,
    solarPaymentMonthly,
    utilityBillMonthly,
    escalationRate,
    escalationRateSourceLabel,
    payoffYear,
    netSavings25yr,
    purchaseMode,
    annualEnergyValue,
    isPartialOffset,
    offsetPct,
  } = input;

  const escalationPct = Math.round(escalationRate * 100);
  const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;

  // ── Monthly impact ──────────────────────────────────────────────────────────
  let monthlyImpact: string;

  if (purchaseMode === 'cash') {
    // Cash: immediate savings from day 1
    const annualSavingMonthly = Math.round(annualEnergyValue / 12);
    monthlyImpact = `With a cash purchase, your energy value starts at approximately ${fmt(annualSavingMonthly)}/month from day one — the system is fully owned immediately.`;
  } else {
    const totalMonthlyCost = solarPaymentMonthly + utilityBillMonthly;
    const delta = totalMonthlyCost - currentMonthlyBill;

    if (delta > 10) {
      // Payment higher than bill
      monthlyImpact = `Today, your combined solar payment (${fmt(solarPaymentMonthly)}/mo) and remaining utility bill (${fmt(utilityBillMonthly)}/mo) is ${fmt(delta)}/month more than your current bill — but your solar payment is fixed while utility rates rise at ${escalationPct}%/yr (${escalationRateSourceLabel}).`;
    } else if (delta > -10) {
      // Roughly break-even month 1
      monthlyImpact = `From day one, your combined solar payment and remaining utility bill is approximately equal to your current utility cost — with the added benefit of a fixed payment and ownership.`;
    } else {
      // Immediate savings
      monthlyImpact = `From day one, your combined solar payment (${fmt(solarPaymentMonthly)}/mo) and remaining utility bill (${fmt(utilityBillMonthly)}/mo) is ${fmt(Math.abs(delta))}/month less than your current bill of ${fmt(currentMonthlyBill)}/mo.`;
    }
  }

  // ── Primary story ───────────────────────────────────────────────────────────
  let primaryStory: string;

  if (purchaseMode === 'cash') {
    primaryStory = isPartialOffset
      ? `This system offsets ${offsetPct}% of your electricity usage, producing ${fmt(annualEnergyValue)} in energy value annually — while utility rates continue rising at ${escalationPct}%/yr (${escalationRateSourceLabel}).`
      : `This system offsets essentially all of your electricity usage, producing ${fmt(annualEnergyValue)} in energy value annually — while the utility rate you avoided continues rising at ${escalationPct}%/yr (${escalationRateSourceLabel}).`;
  } else {
    const delta = (solarPaymentMonthly + utilityBillMonthly) - currentMonthlyBill;
    if (delta > 10) {
      primaryStory = `This system starts with a monthly gap of ${fmt(delta)}, but as utility rates increase at ${escalationPct}%/yr (${escalationRateSourceLabel}), that gap closes and reverses — resulting in ${fmt(netSavings25yr)} in net savings over 25 years.`;
    } else {
      primaryStory = `This system replaces a rising utility bill with a fixed solar payment — and as utility rates increase at ${escalationPct}%/yr (${escalationRateSourceLabel}), the financial advantage compounds to ${fmt(netSavings25yr)} in net savings over 25 years.`;
    }
  }

  // ── Payoff statement ────────────────────────────────────────────────────────
  let payoffStatement: string;

  if (payoffYear !== null && payoffYear > 0 && payoffYear <= 25) {
    if (purchaseMode === 'cash') {
      payoffStatement = `The system pays for itself in approximately Year ${payoffYear} — after which every year of production is pure net return.`;
    } else {
      payoffStatement = `Solar surpasses the utility cost baseline in Year ${payoffYear} — the point where cumulative energy value exceeds the total cost of the system.`;
    }
  } else {
    payoffStatement = `The system is designed for long-term energy cost protection — building value every year through both production and avoided utility rate increases.`;
  }

  // ── Outcome statement ───────────────────────────────────────────────────────
  let outcomeStatement: string;

  if (netSavings25yr > 0) {
    outcomeStatement = isPartialOffset
      ? `Over 25 years, this system produces ${fmt(netSavings25yr)} more in value than it costs — while still reducing (not eliminating) your utility dependency by ${offsetPct}%.`
      : `Over 25 years, this system produces ${fmt(netSavings25yr)} more in value than it costs — while essentially eliminating your utility bill after payoff.`;
  } else {
    outcomeStatement = `Over 25 years, this system provides energy cost protection against rising utility rates — the long-term value depends on actual rate increases in your area.`;
  }

  // ── Full narrative ──────────────────────────────────────────────────────────
  const fullNarrative = [primaryStory, monthlyImpact, payoffStatement, outcomeStatement].join(' ');

  return {
    primaryStory,
    monthlyImpact,
    payoffStatement,
    outcomeStatement,
    fullNarrative,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Payoff Year Calculator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Computes the year when cumulative energy value produced >= system cost (cash basis).
 * This is the canonical payoff year — independent of loan term.
 *
 * @param annualEnergyValue   Year 1 energy value ($)
 * @param escalationRate      Annual rate increase (e.g. 0.03)
 * @param systemCost          Cash system cost ($)
 * @param panelDegradation    Annual production degradation (e.g. 0.005)
 */
export function computePayoffYear(
  annualEnergyValue: number,
  escalationRate: number,
  systemCost: number,
  panelDegradation = 0.005,
): number | null {
  if (annualEnergyValue <= 0 || systemCost <= 0) return null;

  let cumulative = 0;
  for (let i = 0; i < 25; i++) {
    const yearValue = annualEnergyValue
      * Math.pow(1 + escalationRate, i)
      * Math.pow(1 - panelDegradation, i);
    cumulative += yearValue;
    if (cumulative >= systemCost) return i + 1;
  }
  return null; // doesn't pay off within 25 years
}

/**
 * Payoff from the REAL year-by-year flow (single source of truth): cumulative
 * (energy value + SREC income as actually scheduled) vs system cost.
 *
 * This replaces the old hack of feeding `annualEnergyValue + yearlyFlow[0]
 * .srec_income` into computePayoffYear — under the 2026-27 Illinois Shines
 * schedule, yearlyFlow[0].srec_income is the 50% UPFRONT chunk, and treating
 * it as a recurring, escalating annual amount overstated SREC ~25× and made
 * payback absurdly short. Here each year contributes exactly what the
 * customer actually receives that year.
 *
 * Returns { year, fractional }: `year` = first whole year cumulative value
 * covers the cost (the "Payoff Year X" display); `fractional` = interpolated
 * decimal payback (e.g. 7.4) for the simple-payback display. Null = doesn't
 * pay off within the projection.
 */
export function computePayoffFromFlow(
  flow: ReadonlyArray<{ total_energy_value: number; srec_income?: number }>,
  systemCost: number,
): { year: number; fractional: number } | null {
  if (systemCost <= 0 || flow.length === 0) return null;
  let cumulative = 0;
  for (let i = 0; i < flow.length; i++) {
    const yearValue = (flow[i].total_energy_value || 0) + (flow[i].srec_income || 0);
    const prev = cumulative;
    cumulative += yearValue;
    if (cumulative >= systemCost) {
      const frac = yearValue > 0 ? (systemCost - prev) / yearValue : 0;
      return { year: i + 1, fractional: Math.round((i + frac) * 10) / 10 };
    }
  }
  return null;
}