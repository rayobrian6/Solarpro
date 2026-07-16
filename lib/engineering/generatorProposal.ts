/**
 * Customer-facing proposal calculator.
 *
 * Per-category margin model (default margins, all overridable):
 *   - Materials     : 35% markup over MSRP
 *   - Labor         : $50/hr cost → $95/hr sell (≈47% margin baked into loaded rate)
 *   - Subcontracted : 15% markup over sub cost (gas line, electrical upgrade)
 *   - Permits       : pass-through (0% margin)
 *   - Overhead      : 12% of labor cost (insurance, vehicle, scheduling, admin)
 *   - Tax           : pass-through on sell side (configurable; defaults to 0%)
 *
 * Outputs an itemized line-item table plus subtotals per category,
 * an effective overall margin, and a totals block for the proposal.
 */

export type ProposalInputs = {
  customer: {
    name: string;
    address: string;
    email?: string;
    phone?: string;
  };
  site: {
    serviceSize: "100A" | "200A" | "400A";
  };
  generator: {
    brand: string;
    model: string;
    kw: number;
    msrp: number;
  };
  transferSwitch: {
    amps: 100 | 200 | 400;
    msrp: number;
    included: boolean;
  };
  installation: {
    laborHours: number;
  };
  subcategories: {
    gasLineNeeded: boolean;
    gasLineCost: number;
    electricalUpgradeNeeded: boolean;
    electricalUpgradeCost: number;
  };
  permits: {
    cost: number;
  };
  margins: {
    materialMarkupPct: number;
    laborBaseRate: number;
    laborSellRate: number;
    subMarkupPct: number;
    overheadPctOfLabor: number;
    taxRatePct: number;
  };
  notes?: string;
};

export type ProposalLineItem = {
  description: string;
  category: "Materials" | "Labor" | "Subcontracted" | "Permits" | "Overhead";
  cost: number;
  sell: number;
};

export type Proposal = {
  inputs: ProposalInputs;
  lineItems: ProposalLineItem[];
  categorySubtotals: Record<ProposalLineItem["category"], { cost: number; sell: number }>;
  subtotalSell: number;
  tax: number;
  total: number;
  totalCost: number;
  effectiveMarginPct: number;
  generatedAt: string;
};

export const DEFAULT_MARGINS: {
  materialMarkupPct: number;
  laborBaseRate: number;
  laborSellRate: number;
  subMarkupPct: number;
  overheadPctOfLabor: number;
  taxRatePct: number;
} = {
  materialMarkupPct: 35,
  laborBaseRate: 50,
  laborSellRate: 95,
  subMarkupPct: 15,
  overheadPctOfLabor: 12,
  taxRatePct: 0,
};

export const DEFAULT_INPUTS: Omit<ProposalInputs, "customer"> = {
  site: { serviceSize: "200A" },
  generator: {
    brand: "Generac",
    model: "7228",
    kw: 18,
    msrp: 5899,
  },
  transferSwitch: {
    amps: 200,
    msrp: 1200,
    included: true,
  },
  installation: {
    laborHours: 14,
  },
  subcategories: {
    gasLineNeeded: false,
    gasLineCost: 0,
    electricalUpgradeNeeded: false,
    electricalUpgradeCost: 0,
  },
  permits: {
    cost: 350,
  },
  margins: { ...DEFAULT_MARGINS },
};

/** Suggested labor hours by generator size (rule of thumb). */
export function defaultLaborHours(kw: number): number {
  if (kw <= 10) return 8;
  if (kw <= 14) return 10;
  if (kw <= 18) return 12;
  if (kw <= 22) return 14;
  return 16;
}

/** Suggested transfer switch MSRP by service size. */
export function defaultTransferSwitchMsrp(serviceSize: "100A" | "200A" | "400A"): number {
  switch (serviceSize) {
    case "100A": return 800;
    case "200A": return 1200;
    case "400A": return 2400;
  }
}

export function buildProposal(inputs: ProposalInputs): Proposal {
  const m = inputs.margins;
  const lineItems: ProposalLineItem[] = [];

  // 1. Materials: generator + transfer switch
  const genCost = inputs.generator.msrp;
  const genSell = round2(genCost * (1 + m.materialMarkupPct / 100));
  lineItems.push({
    description: `${inputs.generator.brand} ${inputs.generator.model} — ${inputs.generator.kw} kW standby generator`,
    category: "Materials",
    cost: genCost,
    sell: genSell,
  });

  if (inputs.transferSwitch.included) {
    const tsCost = inputs.transferSwitch.msrp;
    const tsSell = round2(tsCost * (1 + m.materialMarkupPct / 100));
    lineItems.push({
      description: `${inputs.transferSwitch.amps}A automatic transfer switch`,
      category: "Materials",
      sell: tsSell,
      cost: tsCost,
    });
  }

  // 2. Labor
  const laborHours = inputs.installation.laborHours;
  const laborCost = round2(laborHours * m.laborBaseRate);
  const laborSell = round2(laborHours * m.laborSellRate);
  lineItems.push({
    description: `Installation labor (${laborHours} hrs × $${m.laborSellRate}/hr)`,
    category: "Labor",
    cost: laborCost,
    sell: laborSell,
  });

  // 3. Subcontracted
  if (inputs.subcategories.gasLineNeeded && inputs.subcategories.gasLineCost > 0) {
    const cost = inputs.subcategories.gasLineCost;
    const sell = round2(cost * (1 + m.subMarkupPct / 100));
    lineItems.push({
      description: "Gas line connection (subcontracted)",
      category: "Subcontracted",
      cost,
      sell,
    });
  }
  if (inputs.subcategories.electricalUpgradeNeeded && inputs.subcategories.electricalUpgradeCost > 0) {
    const cost = inputs.subcategories.electricalUpgradeCost;
    const sell = round2(cost * (1 + m.subMarkupPct / 100));
    lineItems.push({
      description: "Electrical service upgrade (subcontracted)",
      category: "Subcontracted",
      cost,
      sell,
    });
  }

  // 4. Permits (pass-through)
  if (inputs.permits.cost > 0) {
    lineItems.push({
      description: "Permits & inspections",
      category: "Permits",
      cost: inputs.permits.cost,
      sell: inputs.permits.cost,
    });
  }

  // 5. Overhead (% of labor cost)
  const overheadCost = round2(laborCost * (m.overheadPctOfLabor / 100));
  const overheadSell = overheadCost; // overhead passes through at cost
  lineItems.push({
    description: `Overhead allocation (${m.overheadPctOfLabor}% of labor)`,
    category: "Overhead",
    cost: overheadCost,
    sell: overheadSell,
  });

  // Subtotals
  const cats: ProposalLineItem["category"][] = ["Materials", "Labor", "Subcontracted", "Permits", "Overhead"];
  const categorySubtotals = Object.fromEntries(
    cats.map((c) => {
      const items = lineItems.filter((li) => li.category === c);
      return [
        c,
        {
          cost: round2(items.reduce((s, li) => s + li.cost, 0)),
          sell: round2(items.reduce((s, li) => s + li.sell, 0)),
        },
      ];
    })
  ) as Proposal["categorySubtotals"];

  const subtotalSell = round2(lineItems.reduce((s, li) => s + li.sell, 0));
  const totalCost = round2(lineItems.reduce((s, li) => s + li.cost, 0));
  const tax = round2(subtotalSell * (m.taxRatePct / 100));
  const total = round2(subtotalSell + tax);
  const effectiveMarginPct = subtotalSell > 0
    ? round2(((subtotalSell - totalCost) / subtotalSell) * 100)
    : 0;

  return {
    inputs,
    lineItems,
    categorySubtotals,
    subtotalSell,
    tax,
    total,
    totalCost,
    effectiveMarginPct,
    generatedAt: new Date().toISOString(),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Currency formatter (USD). */
export function fmt(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

/** Currency formatter with cents. */
export function fmtCents(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}