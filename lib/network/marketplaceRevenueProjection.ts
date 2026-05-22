import {
  boundedRange,
  displayText,
  formatRange,
  normalizedText,
  pushUnique,
  type IntelligenceEvidenceNote,
  type IntelligenceLevel,
  type IntelligenceRange,
} from "@/lib/network/intelligenceUtils";

export interface StateSolarPricingAssumption {
  lowPricePerWatt: number;
  marketPricePerWatt: number;
  premiumPricePerWatt: number;
  sourceLabel: string;
}

export interface MarketplaceRevenueProjectionInput {
  stateCode?: string | null;
  estimatedSystemSizeKw?: number | null;
  batteryInterest?: string | boolean | null;
  batteryCandidate?: boolean | null;
  purchaseIntent?: string | null;
  financingPreference?: string | null;
  utilityProvider?: string | null;
  utilityRatePerKwh?: number | null;
  monthlyBillAmount?: number | null;
  annualUsageKwh?: number | null;
  estimatedOffsetPct?: number | null;
  estimatedAnnualSavings?: number | null;
  verifiedProjectValue?: number | null;
  installComplexityLevel?: IntelligenceLevel | null;
  installProfitabilitySignal?:
    | "favorable"
    | "standard"
    | "margin_watch"
    | "unknown"
    | null;
}

export interface MarketplaceRevenueProjectionResult {
  pricing_assumption: {
    state_code: string;
    low_price_per_watt: number;
    market_price_per_watt: number;
    premium_price_per_watt: number;
    source_label: string;
  };
  project_value_range: IntelligenceRange | null;
  low_install_estimate: number | null;
  market_average_estimate: number | null;
  premium_install_estimate: number | null;
  financed_payment_range: IntelligenceRange | null;
  ppa_lease_payment_range: IntelligenceRange | null;
  battery_attachment_value: IntelligenceRange | null;
  battery_inclusive_value_range: IntelligenceRange | null;
  install_complexity_modifier: {
    factor: number;
    label: string;
    applied: boolean;
  };
  project_value_display_label: string;
  battery_inclusive_display_label: string;
  financed_payment_label: string;
  ppa_lease_payment_label: string;
  payment_replacement_label: string;
  utility_arbitrage_label: string;
  estimated_monthly_utility_reduction: number | null;
  gross_opportunity_tier:
    | "premium"
    | "high"
    | "standard"
    | "developing"
    | "unknown";
  gross_opportunity_label: string;
  opportunity_score_contribution: number;
  payment_profile_label: string;
  basis: string;
  evidence: IntelligenceEvidenceNote[];
  missing: string[];
  disclaimers: string[];
}

const DEFAULT_PRICING: StateSolarPricingAssumption = {
  lowPricePerWatt: 2.75,
  marketPricePerWatt: 3.05,
  premiumPricePerWatt: 3.35,
  sourceLabel: "SolarPro national marketplace assumption",
};

export const STATE_SOLAR_PRICING_ASSUMPTIONS: Record<
  string,
  StateSolarPricingAssumption
> = {
  AZ: {
    lowPricePerWatt: 2.55,
    marketPricePerWatt: 2.9,
    premiumPricePerWatt: 3.25,
    sourceLabel: "SolarPro Arizona marketplace assumption",
  },
  CA: {
    lowPricePerWatt: 3.05,
    marketPricePerWatt: 3.45,
    premiumPricePerWatt: 3.9,
    sourceLabel: "SolarPro California marketplace assumption",
  },
  CO: {
    lowPricePerWatt: 2.85,
    marketPricePerWatt: 3.2,
    premiumPricePerWatt: 3.55,
    sourceLabel: "SolarPro Colorado marketplace assumption",
  },
  FL: {
    lowPricePerWatt: 2.55,
    marketPricePerWatt: 2.9,
    premiumPricePerWatt: 3.25,
    sourceLabel: "SolarPro Florida marketplace assumption",
  },
  IL: {
    lowPricePerWatt: 2.8,
    marketPricePerWatt: 3.0,
    premiumPricePerWatt: 3.2,
    sourceLabel: "SolarPro Illinois marketplace assumption",
  },
  MA: {
    lowPricePerWatt: 3.0,
    marketPricePerWatt: 3.35,
    premiumPricePerWatt: 3.75,
    sourceLabel: "SolarPro Massachusetts marketplace assumption",
  },
  NJ: {
    lowPricePerWatt: 2.85,
    marketPricePerWatt: 3.15,
    premiumPricePerWatt: 3.5,
    sourceLabel: "SolarPro New Jersey marketplace assumption",
  },
  NY: {
    lowPricePerWatt: 3.0,
    marketPricePerWatt: 3.35,
    premiumPricePerWatt: 3.75,
    sourceLabel: "SolarPro New York marketplace assumption",
  },
  NV: {
    lowPricePerWatt: 2.6,
    marketPricePerWatt: 2.95,
    premiumPricePerWatt: 3.3,
    sourceLabel: "SolarPro Nevada marketplace assumption",
  },
  PA: {
    lowPricePerWatt: 2.75,
    marketPricePerWatt: 3.05,
    premiumPricePerWatt: 3.4,
    sourceLabel: "SolarPro Pennsylvania marketplace assumption",
  },
  TX: {
    lowPricePerWatt: 2.55,
    marketPricePerWatt: 2.85,
    premiumPricePerWatt: 3.2,
    sourceLabel: "SolarPro Texas marketplace assumption",
  },
};

const FINANCE_TERM_MONTHS = 240;
const FINANCE_APR_LOW = 0.0599;
const FINANCE_APR_HIGH = 0.0899;
const PPA_DISCOUNT_LOW = 0.72;
const PPA_DISCOUNT_HIGH = 0.92;
const DEFAULT_TARGET_OFFSET = 100;
const BATTERY_ATTACHMENT_LOW = 12000;
const BATTERY_ATTACHMENT_HIGH = 18000;

function normalizeState(value: string | null | undefined): string {
  const normalized = value?.trim().toUpperCase();
  return normalized && /^[A-Z]{2}$/.test(normalized) ? normalized : "US";
}

function pricingForState(stateCode: string): StateSolarPricingAssumption {
  return STATE_SOLAR_PRICING_ASSUMPTIONS[stateCode] ?? DEFAULT_PRICING;
}

function positive(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function estimateSystemSizeFromUsage(
  annualUsageKwh: number | null,
  offsetPct: number | null,
): number | null {
  if (!annualUsageKwh) return null;
  const targetOffset = Math.max(
    60,
    Math.min(120, offsetPct ?? DEFAULT_TARGET_OFFSET),
  );
  const annualProductionPerKw = 1300;
  return (
    Math.round(
      ((annualUsageKwh * (targetOffset / 100)) / annualProductionPerKw) * 10,
    ) / 10
  );
}

function payment(principal: number, apr: number, months: number): number {
  const monthlyRate = apr / 12;
  const factor = Math.pow(1 + monthlyRate, months);
  return principal * ((monthlyRate * factor) / (factor - 1));
}

function roundToNearest(value: number, nearest: number): number {
  return Math.round(value / nearest) * nearest;
}

function batteryInterestSelected(
  value: string | boolean | null | undefined,
): boolean {
  if (value === true) return true;
  const normalized = normalizedText(value);
  return (
    !!normalized &&
    [
      "yes",
      "true",
      "interested",
      "battery",
      "backup",
      "resilience",
      "storage",
    ].some((token) => normalized.includes(token))
  );
}

function deriveTier(
  projectRange: IntelligenceRange | null,
  batteryRange: IntelligenceRange | null,
  utilityRate: number | null,
): MarketplaceRevenueProjectionResult["gross_opportunity_tier"] {
  const midpoint =
    (projectRange?.midpoint ?? 0) + (batteryRange?.midpoint ?? 0);
  if (!midpoint) return "unknown";
  if (midpoint >= 65000 || (midpoint >= 52000 && (utilityRate ?? 0) >= 0.18))
    return "premium";
  if (midpoint >= 45000) return "high";
  if (midpoint >= 28000) return "standard";
  return "developing";
}

function tierLabel(
  tier: MarketplaceRevenueProjectionResult["gross_opportunity_tier"],
): string {
  switch (tier) {
    case "premium":
      return "Premium opportunity";
    case "high":
      return "High-value opportunity";
    case "standard":
      return "Standard marketplace opportunity";
    case "developing":
      return "Developing opportunity";
    default:
      return "Opportunity value awaiting sizing";
  }
}

function installComplexityModifier(
  level: IntelligenceLevel | null | undefined,
  profitability: MarketplaceRevenueProjectionInput["installProfitabilitySignal"],
): MarketplaceRevenueProjectionResult["install_complexity_modifier"] {
  if (level === "low" || profitability === "favorable") {
    return {
      factor: 0.98,
      label: "Low-friction install modifier",
      applied: true,
    };
  }
  if (level === "high" || profitability === "margin_watch") {
    return {
      factor: 1.08,
      label: "Install complexity margin-watch modifier",
      applied: true,
    };
  }
  if (level === "medium") {
    return {
      factor: 1.03,
      label: "Moderate install complexity modifier",
      applied: true,
    };
  }
  return {
    factor: 1,
    label: "Install complexity awaiting site validation",
    applied: false,
  };
}

function applyModifier(value: number | null, factor: number): number | null {
  return value ? roundToNearest(value * factor, 100) : null;
}

function combineRanges(
  base: IntelligenceRange | null,
  attachment: IntelligenceRange | null,
  label: string,
): IntelligenceRange | null {
  if (!base || !attachment) return null;
  return {
    min: base.min + attachment.min,
    max: base.max + attachment.max,
    midpoint: base.midpoint + attachment.midpoint,
    unit: "usd",
    label,
  };
}

function compactMoney(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    return null;
  return `$${Math.round(value / 1000)}k`;
}

function compactRange(
  range: IntelligenceRange | null,
  fallback: string,
): string {
  if (!range) return fallback;
  const min = compactMoney(range.min);
  const max = compactMoney(range.max);
  return min && max ? `${min}–${max}` : fallback;
}

function monthlyMoney(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    return null;
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function monthlyRange(
  range: IntelligenceRange | null,
  fallback: string,
): string {
  if (!range) return fallback;
  const min = monthlyMoney(range.min);
  const max = monthlyMoney(range.max);
  return min && max ? `${min}–${max}/mo` : fallback;
}

function scoreContribution(
  tier: MarketplaceRevenueProjectionResult["gross_opportunity_tier"],
  hasPayment: boolean,
  hasBattery: boolean,
): number {
  const base =
    tier === "premium"
      ? 18
      : tier === "high"
        ? 14
        : tier === "standard"
          ? 10
          : tier === "developing"
            ? 5
            : 0;
  return Math.min(22, base + (hasPayment ? 2 : 0) + (hasBattery ? 2 : 0));
}

export function deriveMarketplaceRevenueProjection(
  input: MarketplaceRevenueProjectionInput,
): MarketplaceRevenueProjectionResult {
  const evidence: IntelligenceEvidenceNote[] = [];
  const missing: string[] = [];
  const disclaimers = [
    "Estimated marketplace intelligence only; not a contractor quote, proposal, approval, or lender offer.",
    "Payment ranges use broad SolarPro marketplace assumptions and must be validated by contractor pricing and financing partners.",
  ];

  const stateCode = normalizeState(input.stateCode);
  const pricing = pricingForState(stateCode);
  const utilityRate = positive(input.utilityRatePerKwh);
  const monthlyBill = positive(input.monthlyBillAmount);
  const annualUsage = positive(input.annualUsageKwh);
  const offsetPct = positive(input.estimatedOffsetPct);
  const directSystemSize = positive(input.estimatedSystemSizeKw);
  const inferredSystemSize = estimateSystemSizeFromUsage(
    annualUsage,
    offsetPct,
  );
  const systemSizeKw = directSystemSize ?? inferredSystemSize;
  const batterySelected =
    batteryInterestSelected(input.batteryInterest) ||
    input.batteryCandidate === true;
  const purchasePreference = normalizedText(
    input.purchaseIntent ?? input.financingPreference,
  );

  evidence.push({
    label: "State pricing assumption",
    value: `${stateCode} ${pricing.lowPricePerWatt.toFixed(2)}–${pricing.premiumPricePerWatt.toFixed(2)}/W`,
    source: "derived",
  });

  if (directSystemSize) {
    evidence.push({
      label: "System size basis",
      value: `${directSystemSize.toLocaleString("en-US")} kW estimated system size`,
      source: "estimated",
    });
  } else if (inferredSystemSize) {
    evidence.push({
      label: "System size basis",
      value: `${inferredSystemSize.toLocaleString("en-US")} kW inferred from usage and offset`,
      source: "derived",
    });
  } else {
    pushUnique(missing, "Estimated system size or annual usage required");
  }

  if (utilityRate) {
    evidence.push({
      label: "Utility rate pressure",
      value: `$${utilityRate.toFixed(2)}/kWh`,
      source: "bill",
    });
  } else pushUnique(missing, "Utility rate unavailable");

  if (input.utilityProvider) {
    evidence.push({
      label: "Utility territory",
      value: input.utilityProvider,
      source: "homeowner",
    });
  }

  if (purchasePreference) {
    evidence.push({
      label: "Payment preference",
      value:
        displayText(input.purchaseIntent ?? input.financingPreference) ??
        purchasePreference,
      source: "qualification",
    });
  } else pushUnique(missing, "Purchase or payment preference pending");

  const modifier = installComplexityModifier(
    input.installComplexityLevel,
    input.installProfitabilitySignal,
  );
  const baseLowInstallEstimate = systemSizeKw
    ? roundToNearest(systemSizeKw * 1000 * pricing.lowPricePerWatt, 100)
    : null;
  const baseMarketAverageEstimate = systemSizeKw
    ? roundToNearest(systemSizeKw * 1000 * pricing.marketPricePerWatt, 100)
    : null;
  const basePremiumInstallEstimate = systemSizeKw
    ? roundToNearest(systemSizeKw * 1000 * pricing.premiumPricePerWatt, 100)
    : null;
  const lowInstallEstimate = applyModifier(
    baseLowInstallEstimate,
    modifier.factor,
  );
  const marketAverageEstimate = applyModifier(
    baseMarketAverageEstimate,
    modifier.factor,
  );
  const premiumInstallEstimate = applyModifier(
    basePremiumInstallEstimate,
    modifier.factor,
  );

  if (modifier.applied) {
    evidence.push({
      label: "Install complexity modifier",
      value: `${modifier.label} (${modifier.factor.toFixed(2)}x)`,
      source: "derived",
    });
  }
  const verifiedProjectValue = positive(input.verifiedProjectValue);

  const projectValueRange =
    lowInstallEstimate && marketAverageEstimate && premiumInstallEstimate
      ? {
          min: lowInstallEstimate,
          max: premiumInstallEstimate,
          midpoint: marketAverageEstimate,
          unit: "usd" as const,
          label: "Estimated installed project value",
        }
      : verifiedProjectValue
        ? boundedRange(
            verifiedProjectValue,
            0.12,
            "usd",
            "Estimated project value from stored marketplace value",
          )
        : null;

  const financedPaymentRange = projectValueRange
    ? {
        min: roundToNearest(
          payment(projectValueRange.min, FINANCE_APR_LOW, FINANCE_TERM_MONTHS),
          5,
        ),
        max: roundToNearest(
          payment(projectValueRange.max, FINANCE_APR_HIGH, FINANCE_TERM_MONTHS),
          5,
        ),
        midpoint: roundToNearest(
          payment(
            projectValueRange.midpoint,
            (FINANCE_APR_LOW + FINANCE_APR_HIGH) / 2,
            FINANCE_TERM_MONTHS,
          ),
          5,
        ),
        unit: "usd" as const,
        label: "Estimated financed monthly payment range",
      }
    : null;

  const annualUtilitySpend = monthlyBill
    ? monthlyBill * 12
    : input.estimatedAnnualSavings;
  const effectiveOffset = Math.max(
    60,
    Math.min(110, offsetPct ?? DEFAULT_TARGET_OFFSET),
  );
  const ppaLeasePaymentRange = annualUtilitySpend
    ? {
        min: roundToNearest(
          (annualUtilitySpend * (effectiveOffset / 100) * PPA_DISCOUNT_LOW) /
            12,
          5,
        ),
        max: roundToNearest(
          (annualUtilitySpend * (effectiveOffset / 100) * PPA_DISCOUNT_HIGH) /
            12,
          5,
        ),
        midpoint: roundToNearest(
          (annualUtilitySpend *
            (effectiveOffset / 100) *
            ((PPA_DISCOUNT_LOW + PPA_DISCOUNT_HIGH) / 2)) /
            12,
          5,
        ),
        unit: "usd" as const,
        label: "Estimated PPA/lease utility replacement payment range",
      }
    : null;

  if (!financedPaymentRange)
    pushUnique(missing, "Project value required for financed payment range");
  if (!ppaLeasePaymentRange)
    pushUnique(
      missing,
      "Monthly bill or annual savings required for PPA/lease payment range",
    );

  const batteryAttachmentValue = batterySelected
    ? {
        min: BATTERY_ATTACHMENT_LOW,
        max: BATTERY_ATTACHMENT_HIGH,
        midpoint: (BATTERY_ATTACHMENT_LOW + BATTERY_ATTACHMENT_HIGH) / 2,
        unit: "usd" as const,
        label: "Estimated battery attachment value",
      }
    : null;

  if (batterySelected) {
    evidence.push({
      label: "Battery signal",
      value: "Battery or resilience interest present",
      source: "homeowner",
    });
  }

  const batteryInclusiveValueRange = combineRanges(
    projectValueRange,
    batteryAttachmentValue,
    "Estimated installed value including battery attachment",
  );
  const estimatedMonthlyUtilityReduction = input.estimatedAnnualSavings
    ? roundToNearest(input.estimatedAnnualSavings / 12, 5)
    : monthlyBill && ppaLeasePaymentRange
      ? roundToNearest(
          Math.max(0, monthlyBill - ppaLeasePaymentRange.midpoint),
          5,
        )
      : null;

  const tier = deriveTier(
    projectValueRange,
    batteryAttachmentValue,
    utilityRate,
  );
  const paymentProfileLabel =
    purchasePreference === "ppa_or_lease" ||
    purchasePreference === "ppa" ||
    purchasePreference === "lease"
      ? `${formatRange(ppaLeasePaymentRange, "PPA/lease payment awaiting bill data")} estimated PPA/lease payment`
      : purchasePreference === "cash"
        ? "Cash-oriented project value intelligence"
        : `${formatRange(financedPaymentRange, "Financed payment awaiting project value")} estimated financed payment`;

  const projectValueDisplayLabel = projectValueRange
    ? `${compactRange(projectValueRange, "Value pending")} estimated install opportunity`
    : "Project value awaiting system size";
  const batteryInclusiveDisplayLabel = batteryInclusiveValueRange
    ? `${compactRange(batteryInclusiveValueRange, "Value pending")} with battery`
    : batteryAttachmentValue
      ? "Battery value awaiting base system sizing"
      : "Battery attachment not signaled";
  const financedPaymentLabel = financedPaymentRange
    ? `${monthlyRange(financedPaymentRange, "Financing pending")} broad financed estimate`
    : "Financed payment awaiting project value";
  const ppaLeasePaymentLabel = ppaLeasePaymentRange
    ? `${monthlyRange(ppaLeasePaymentRange, "PPA/lease pending")} estimated utility replacement path`
    : "PPA/lease path awaiting bill or savings data";
  const paymentReplacementLabel =
    monthlyBill && financedPaymentRange
      ? financedPaymentRange.midpoint <= monthlyBill
        ? "Likely cash-flow neutral financing path"
        : "Payment replacement may require contractor pricing validation"
      : ppaLeasePaymentRange
        ? "Utility replacement estimate available"
        : "Payment replacement awaiting bill and project value";
  const utilityArbitrageLabel =
    utilityRate && utilityRate >= 0.18
      ? "Strong utility arbitrage opportunity"
      : utilityRate
        ? "Utility arbitrage opportunity present"
        : "Utility arbitrage awaiting rate evidence";

  const basis = projectValueRange
    ? `${pricing.sourceLabel}; ${systemSizeKw?.toLocaleString("en-US")} kW × ${pricing.lowPricePerWatt.toFixed(2)}–${pricing.premiumPricePerWatt.toFixed(2)}/W; ${modifier.label}`
    : "Revenue projection awaiting system size or usage evidence";

  return {
    pricing_assumption: {
      state_code: stateCode,
      low_price_per_watt: pricing.lowPricePerWatt,
      market_price_per_watt: pricing.marketPricePerWatt,
      premium_price_per_watt: pricing.premiumPricePerWatt,
      source_label: pricing.sourceLabel,
    },
    project_value_range: projectValueRange,
    low_install_estimate: lowInstallEstimate,
    market_average_estimate: marketAverageEstimate,
    premium_install_estimate: premiumInstallEstimate,
    financed_payment_range: financedPaymentRange,
    ppa_lease_payment_range: ppaLeasePaymentRange,
    battery_attachment_value: batteryAttachmentValue,
    battery_inclusive_value_range: batteryInclusiveValueRange,
    install_complexity_modifier: modifier,
    project_value_display_label: projectValueDisplayLabel,
    battery_inclusive_display_label: batteryInclusiveDisplayLabel,
    financed_payment_label: financedPaymentLabel,
    ppa_lease_payment_label: ppaLeasePaymentLabel,
    payment_replacement_label: paymentReplacementLabel,
    utility_arbitrage_label: utilityArbitrageLabel,
    estimated_monthly_utility_reduction: estimatedMonthlyUtilityReduction,
    gross_opportunity_tier: tier,
    gross_opportunity_label: tierLabel(tier),
    opportunity_score_contribution: scoreContribution(
      tier,
      !!(financedPaymentRange || ppaLeasePaymentRange),
      !!batteryAttachmentValue,
    ),
    payment_profile_label: paymentProfileLabel,
    basis,
    evidence,
    missing,
    disclaimers,
  };
}
