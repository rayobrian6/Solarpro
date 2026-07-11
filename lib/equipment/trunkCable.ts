// ═══════════════════════════════════════════════════════════════
// Trunk Cable — brand-agnostic microinverter AC trunk/bus cable
// catalog + resolver (Enphase Q-Cable, APsystems AC Bus, …).
//
// Same single-source pattern as integratedBos.ts: the BOM (and any
// other consumer) resolves the trunk hardware for the selected micro
// ECOSYSTEM instead of hardcoding Enphase part numbers.
//
// REAL INSTALL LOGIC (sourced — see lib/data/equipment/trunk-cable-*.json):
// • The trunk is CONTINUOUS PER BRANCH CIRCUIT — branches are separate
//   runs, so hardware is planned per branch, never across the array.
// • Row-to-row transitions within a branch are bridged by routing the
//   continuous cable with a SERVICE LOOP and capping the unused molded
//   connector (sealing cap). NO field splice per row — Enphase: "link
//   connectors eliminate cable waste"; splices are for rejoining an
//   intentional cut, joining two reels, or a raw-cable jumper across a
//   sub-array / roof-plane gap (~0–1 per branch).
// • CHEAPEST-OPTION rule (Ray): a service loop consumes only slack
//   (≈ $0) vs ≈ $28 for a male+female field-wireable pair, so the loop
//   is the default; splices are emitted only where they are FORCED
//   (sub-array/plane bridges) or explicitly requested by the installer
//   (crews that prefer cutting at rows / short cut-lengths).
// • Cable is SOLD PER CONNECTOR-DROP (one drop per micro), not per
//   foot — Enphase ≈ $22.29/drop, APsystems ≈ $49/drop (2026-07-10).
// ═══════════════════════════════════════════════════════════════

export type TrunkOrientation = 'portrait' | 'landscape';

export interface TrunkCableSpec {
  sku: string;
  orientation: TrunkOrientation | 'fixed'; // 'fixed' = one spacing for all layouts (APsystems)
  connectorSpacingFt: number;   // molded drop pitch along the trunk
  gaugeAwg: number;
  conductors: number;
  /** Purchasable unit in the real channel. Drops = connector sections. */
  soldBy: 'drop' | 'ft';
}

export interface TrunkAccessorySku {
  sku: string;
  description: string;
}

export interface TrunkCableSystem {
  brand: string;                 // matched against the micro manufacturer
  ecosystem: string;             // display name, e.g. 'IQ Q-Cable', 'AC Bus'
  cables: TrunkCableSpec[];
  connectors: {
    male: TrunkAccessorySku;     // field-wireable splice, male side
    female: TrunkAccessorySku;   // field-wireable splice, female side
    terminator: TrunkAccessorySku; // end-of-branch cap (single-use)
    sealingCap?: TrunkAccessorySku; // covers unused molded connectors
  };
  /** Max micros per 20 A branch (flagship model; per-model overrides below). */
  maxDevicesPerBranch: number;
  /** Per-model branch limits when they differ from the flagship. */
  deviceBranchLimits?: Record<string, number>;
  branchOcpdA: number;
  notes?: string[];
}

// ── Catalog (sourced 2026-07-10; see lib/data/equipment/trunk-cable-*.json) ──

export const TRUNK_CABLE_SYSTEMS: TrunkCableSystem[] = [
  {
    brand: 'Enphase',
    ecosystem: 'IQ Q-Cable',
    cables: [
      { sku: 'Q-12-10-240', orientation: 'portrait',  connectorSpacingFt: 4.25, gaugeAwg: 12, conductors: 2, soldBy: 'drop' },
      { sku: 'Q-12-17-240', orientation: 'landscape', connectorSpacingFt: 6.56, gaugeAwg: 12, conductors: 2, soldBy: 'drop' },
    ],
    connectors: {
      male:       { sku: 'Q-CONN-10M', description: 'IQ Field-Wireable Connector (Male)' },
      female:     { sku: 'Q-CONN-10F', description: 'IQ Field-Wireable Connector (Female)' },
      terminator: { sku: 'Q-TERM-10',  description: 'Q Cable Terminator (branch end, single-use)' },
      sealingCap: { sku: 'Q-SEAL-10',  description: 'Q Cable Sealing Cap (unused connector)' },
    },
    // IQ8/IQ8+ = 13 @ 20 A / 240 V (datasheet-sourced; was wrongly 16 in the BOM).
    maxDevicesPerBranch: 13,
    deviceBranchLimits: { IQ8M: 12, IQ8A: 10, IQ8H: 10, 'IQ8AC': 10 },
    branchOcpdA: 20,
    notes: [
      'Raw cable Q-12-RAW-300 (no connectors) is used with Q-CONN M+F to build jumpers across sub-array gaps.',
      'Connector spacing variants exist (Q-12-12-240 1.5 m portrait, Q-12-18-240 2.1 m landscape, Q-12-2x-200 series); resolver picks the two US-standard SKUs.',
    ],
  },
  {
    brand: 'APsystems',
    ecosystem: 'AC Bus',
    cables: [
      // One molded drop per micro at a fixed ~2.4 m pitch — no orientation variants.
      { sku: 'DS3-AC-BUS', orientation: 'fixed', connectorSpacingFt: 7.9, gaugeAwg: 10, conductors: 3, soldBy: 'drop' },
    ],
    connectors: {
      male:       { sku: '2300931202', description: 'AC Bus Field-Wireable Connector (Male, IP67)' },
      female:     { sku: '2300932202', description: 'AC Bus Field-Wireable Connector (Female)' },
      terminator: { sku: '2060700017', description: 'AC Bus End Cap' },
      sealingCap: { sku: '2060700007', description: 'AC Bus Y-CONN Cap (unused port)' },
    },
    // DS3 = 4 @ 20 A (DS3-S = 5, DS3-L = 6). Note DS3 micros serve 2 modules each.
    maxDevicesPerBranch: 4,
    deviceBranchLimits: { 'DS3-S': 5, 'DS3-L': 6 },
    branchOcpdA: 20,
    notes: [
      '⚠ End-cap vs Y-CONN-cap SKUs (2060700017 / 2060700007) appear swapped across distributors — FIELD-VERIFY.',
      'Plug-in molded AC extension cables (AC-EXT-1/2/4) bridge large gaps — not field-wired.',
    ],
  },
  {
    brand: 'Hoymiles',
    ecosystem: 'AC Trunk (HMS)',
    cables: [
      // Bulk reel, pre-molded connectors, field-cut. 2 m pitch = the common variant
      // (1 m 12AWG and 4.2 m 10AWG reels also exist). 2P+PE, 600 V, IP68, UL 6703.
      { sku: 'AC-TRUNK-20T-10AWG-2M', orientation: 'fixed', connectorSpacingFt: 6.56, gaugeAwg: 10, conductors: 3, soldBy: 'drop' },
    ],
    connectors: {
      // One modular screw-press trunk connector serves both splice sides + home run.
      male:       { sku: 'AC-TRUNK-CONN', description: 'AC Trunk Connector (modular, field-installed)' },
      female:     { sku: 'AC-TRUNK-CONN', description: 'AC Trunk Connector (modular, field-installed)' },
      terminator: { sku: 'AC-TRUNK-END-CAP',  description: 'AC Trunk End Cap' },
      sealingCap: { sku: 'AC-TRUNK-PORT-CAP', description: 'AC Trunk Port Cap (unused drop)' },
    },
    // HMS-800-2T = 5 per 20 A branch. 4-in-1 HMS-1600/1800/2000-4T = 2-4 @ 30 A.
    maxDevicesPerBranch: 5,
    deviceBranchLimits: { 'HMS-1600': 4, 'HMS-1800': 3, 'HMS-2000': 2 },
    branchOcpdA: 20,
    notes: ['⚠ Reel/connector SKUs are distributor labels (mfr PNs unpublished) — FIELD-VERIFY. 2 m 10AWG reel ≈ $706.72 incl. 20 connectors (NAZ 2026-07-10).'],
  },
  {
    brand: 'NEP',
    ecosystem: 'BDM Trunk',
    cables: [
      // BDM-800 "Trunk Version": molded-T continuous trunk, portrait/landscape
      // variants. Confirmed SKU = landscape 12 AWG (4.4 m between Ts, 12 T/roll);
      // portrait SKU not sourced — landscape used for both pending verify.
      { sku: 'NB020229', orientation: 'landscape', connectorSpacingFt: 14.4, gaugeAwg: 12, conductors: 2, soldBy: 'drop' },
      { sku: 'NB020229', orientation: 'portrait',  connectorSpacingFt: 14.4, gaugeAwg: 12, conductors: 2, soldBy: 'drop' },
    ],
    connectors: {
      male:       { sku: '1531022', description: 'BDM Male Splice Adaptor' },
      female:     { sku: '1531022', description: 'BDM Splice Adaptor (mating side — verify SKU)' },
      terminator: { sku: '1531038', description: 'BDM Trunk End Cap' },
      sealingCap: { sku: '1531039', description: 'BDM Trunk Seal Cap (unused T)' },
    },
    maxDevicesPerBranch: 5, // 5 per 20 A branch (4 when sharing a circuit)
    branchOcpdA: 20,
    notes: [
      '⚠ Portrait trunk SKU not sourced — landscape NB020229 used for both, FIELD-VERIFY.',
      'Betteri "new-style" vs Wieland "old-style" connector families are INCOMPATIBLE — match the micro generation.',
      'Home Run cable (16 ft leader to the J-box) is a separate line — 1 per branch.',
    ],
  },
];

// ── Resolver ──────────────────────────────────────────────────────

export interface TrunkPlanInput {
  /** Micro manufacturer (matched case-insensitively against brand). */
  brand: string;
  /** Micro model, for per-model branch limits (optional). */
  model?: string;
  deviceCount: number;
  orientation?: TrunkOrientation;      // default portrait
  /** Distinct sub-arrays / roof planes the branches must bridge (default 1). */
  subArrayCount?: number;
  /**
   * Installer override: force a field-splice pair at every row transition
   * (crews that cut at rows / short cut-lengths). Default false = the
   * cheapest option (continuous cable + service loop).
   */
  spliceAtRows?: boolean;
  rowCount?: number;                   // used only when spliceAtRows
}

export interface TrunkPlan {
  system: TrunkCableSystem;
  cable: TrunkCableSpec;
  branchCount: number;
  /** Purchasable trunk quantity: one connector-drop per micro. */
  dropCount: number;
  /** Informational footage = drops × spacing × 1.15 slack (service loops). */
  approxFeet: number;
  /** Field-wireable M+F pairs — forced bridges + any installer row-splices. */
  splicePairs: number;
  spliceBasis: string;
  terminators: number;                 // 1 per branch end
  sealingCaps: number;                 // 1 per branch (service-loop unused drops)
}

export function resolveTrunkCablePlan(input: TrunkPlanInput): TrunkPlan | null {
  const brandKey = (input.brand || '').trim().toLowerCase();
  const system = TRUNK_CABLE_SYSTEMS.find(s => brandKey.includes(s.brand.toLowerCase())
    || s.brand.toLowerCase().includes(brandKey));
  if (!system || input.deviceCount <= 0) return null;

  const orientation: TrunkOrientation = input.orientation === 'landscape' ? 'landscape' : 'portrait';
  const cable = system.cables.find(c => c.orientation === orientation)
    ?? system.cables.find(c => c.orientation === 'fixed')
    ?? system.cables[0];

  // Per-model branch limit when the catalog knows the model.
  const modelKey = Object.keys(system.deviceBranchLimits ?? {})
    .find(k => (input.model ?? '').toUpperCase().includes(k.toUpperCase()));
  const perBranch = modelKey ? system.deviceBranchLimits![modelKey] : system.maxDevicesPerBranch;
  const branchCount = Math.max(1, Math.ceil(input.deviceCount / perBranch));

  const dropCount = input.deviceCount;
  const approxFeet = Math.ceil(dropCount * cable.connectorSpacingFt * 1.15);

  // Splices — cheapest-option default: continuous cable + service loop = 0.
  // Forced: a raw-cable jumper (M+F pair) bridges each extra sub-array/plane.
  // Installer override: a pair per within-branch row transition. Branch
  // boundaries absorb row transitions (installers break branches at rows),
  // so only the remaining transitions inside branches need cuts.
  const bridges = Math.max(0, (input.subArrayCount ?? 1) - 1);
  let rowSplices = 0;
  if (input.spliceAtRows && (input.rowCount ?? 0) > 1) {
    rowSplices = Math.max(0, (input.rowCount! - 1) - (branchCount - 1));
  }
  const splicePairs = bridges + rowSplices;
  const spliceBasis = input.spliceAtRows
    ? `installer row-splice override: (${input.rowCount}-1 rows) - (${branchCount}-1 branch breaks) + ${bridges} bridge(s)`
    : bridges > 0
      ? `${bridges} sub-array/plane bridge(s); rows use continuous cable + service loop (cheapest)`
      : 'continuous per branch + service loop at rows (cheapest option) — no splices';

  return {
    system, cable, branchCount, dropCount, approxFeet,
    splicePairs, spliceBasis,
    terminators: branchCount,
    sealingCaps: branchCount,
  };
}
