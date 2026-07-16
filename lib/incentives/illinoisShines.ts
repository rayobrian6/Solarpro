// ═══════════════════════════════════════════════════════════════════════════
// Illinois Shines (Adjustable Block Program) — REC pricing engine
// ───────────────────────────────────────────────────────────────────────────
// Single source of truth for Illinois Shines Distributed Generation REC prices.
//
// 2026-27 Program Year — effective JUNE 1, 2026 (prices locked for the full
// program year under the annual-block structure; no mid-year step-downs).
// Source: IPA "Final 2026-27 REC Prices" (illinoisshines.com/program-documents).
//
// 1 REC = 1 MWh. Small DG (0-25 kW AC) rides a 15-year REC contract, typically
// paid to the Approved Vendor as an upfront lump sum passed to the customer.
//
// Groups are utility service territories:
//   Group A = Ameren Illinois, MidAmerican, Mt. Carmel, MISO-area co-ops/munis
//             (central/southern IL). e.g. Granite City.
//   Group B = ComEd + PJM-area munis/co-ops (northern IL). e.g. Yorkville.
// ═══════════════════════════════════════════════════════════════════════════

export type IlShinesGroup = 'A' | 'B';

export const IL_SHINES_PROGRAM_YEAR = '2026-27';
export const IL_SHINES_EFFECTIVE_DATE = '2026-06-01';
/** Small DG REC delivery term (years) — the incentive = 15yr production × price. */
export const IL_SHINES_DG_CONTRACT_YEARS = 15;
/** Small DG size ceiling (kW AC). Above this is Large DG. */
export const IL_SHINES_SMALL_DG_MAX_KW_AC = 25;

/**
 * $20/REC adder for CUSTOMER-OWNED Small DG (0-25 kW AC) that does NOT take the
 * federal ITC — added for the 2026-27 program year to offset the loss of the
 * residential federal ITC (§25D repealed by P.L. 119-21 for 2026+ installs).
 * Eligible only when: Small DG, customer-owned (not lease/PPA), and no ITC/25D.
 */
export const IL_SHINES_CUSTOMER_OWNED_ADDER = 20;

/**
 * +$5/REC adder when the project is registered under the Equity Eligible
 * Contractor (EEC) Distributed Generation subcategory (2026 REC contract only).
 */
export const IL_SHINES_EEC_DG_ADDER = 5;

// DG REC price ($/REC) by group + AC size tier (2026-27, effective 2026-06-01).
// tier = the FIRST row whose maxKwAc >= the system's AC size.
const IL_SHINES_2026_27_DG: ReadonlyArray<{ maxKwAc: number; a: number; b: number }> = [
  { maxKwAc: 10,    a: 70.37, b: 80.77 },
  { maxKwAc: 25,    a: 60.92, b: 79.21 },
  { maxKwAc: 100,   a: 59.53, b: 69.65 },
  { maxKwAc: 200,   a: 55.63, b: 65.09 },
  { maxKwAc: 500,   a: 45.64, b: 53.40 },
  { maxKwAc: 2000,  a: 42.37, b: 49.57 },
  { maxKwAc: 5000,  a: 31.96, b: 37.39 },
];

/**
 * Resolve the Illinois Shines pricing Group from a utility name.
 * IL-ONLY helper — the caller MUST gate on state === 'IL' first.
 * Group B = ComEd (PJM/northern IL). Everything else in IL is treated as
 * Group A — Ameren, MidAmerican, Mt. Carmel, and the downstate MISO co-ops/munis
 * that make up the large majority of non-ComEd Illinois. (A handful of northern
 * PJM munis are truly Group B; defaulting them to A is conservative — slightly
 * lower REC price — and avoids leaving co-op/muni customers on a stale estimate.)
 */
export function illinoisShinesGroupForUtility(utilityName: string | null | undefined): IlShinesGroup {
  const u = (utilityName ?? '').toLowerCase();
  if (u.includes('comed') || u.includes('commonwealth edison')) return 'B';
  return 'A';
}

export interface IlShinesRecPriceResult {
  /** Base REC price ($/REC) for the group + size tier. */
  basePrice: number;
  /** Sum of applied adders ($/REC). */
  adder: number;
  /** basePrice + adder — the effective $/REC (= $/MWh). */
  total: number;
  /** Which size-tier ceiling (kW AC) the price came from. */
  tierMaxKwAc: number;
  /** Whether the $20 customer-owned (ITC-replacement) adder was applied. */
  customerOwnedAdderApplied: boolean;
}

/**
 * Effective Illinois Shines DG REC price ($/REC = $/MWh) for a project.
 * `sizeKwAc` is the system's AC (inverter) nameplate — most residential lands
 * in the 0-10 kW tier. `customerOwned` = cash/loan ownership (NOT lease/PPA).
 * `takesFederalItc` = the project claims the federal ITC (residential §25D is
 * repealed for 2026+, so residential should pass false → adder eligible).
 */
export function illinoisShinesRecPrice(opts: {
  group: IlShinesGroup;
  sizeKwAc: number;
  customerOwned?: boolean;
  takesFederalItc?: boolean;
  eecDg?: boolean;
}): IlShinesRecPriceResult {
  const tier = IL_SHINES_2026_27_DG.find(t => opts.sizeKwAc <= t.maxKwAc)
    ?? IL_SHINES_2026_27_DG[IL_SHINES_2026_27_DG.length - 1];
  const basePrice = opts.group === 'A' ? tier.a : tier.b;

  const customerOwnedAdderApplied =
    !!opts.customerOwned && !opts.takesFederalItc && opts.sizeKwAc <= IL_SHINES_SMALL_DG_MAX_KW_AC;
  let adder = customerOwnedAdderApplied ? IL_SHINES_CUSTOMER_OWNED_ADDER : 0;
  if (opts.eecDg) adder += IL_SHINES_EEC_DG_ADDER;

  return {
    basePrice,
    adder,
    total: Math.round((basePrice + adder) * 100) / 100,
    tierMaxKwAc: tier.maxKwAc,
    customerOwnedAdderApplied,
  };
}
