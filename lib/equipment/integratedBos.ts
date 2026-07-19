// ═══════════════════════════════════════════════════════════════════════════
// INTEGRATED BALANCE-OF-SYSTEM (BOS) DEVICES — "the brains"
//
// Modern solar systems are increasingly built around a single brand-specific
// integrated device that combines several roles the plans used to draw as
// separate boxes: AC branch aggregation (combiner), the PV-system disconnecting
// means, the monitoring/metering gateway, and the rapid-shutdown initiator.
// The Enphase IQ Combiner 6C is the canonical example — one wall box that IS
// the combiner + IQ Gateway + load-break disconnect. Tesla's Backup Switch /
// meter-socket integration is the same idea in a different brand.
//
// Before this module the pipeline had NO first-class concept of these devices:
// they existed only as throwaway BOM strings and anonymous wiring runs, so
// every planset sheet was blind to them. This is the single source of truth for
// the device CLASS. The resolver auto-configures the best / easiest-install
// option (fewest boxes on the wall) and supports an explicit user override.
//
// ⚠ Part numbers / electrical specs below are best-known values — FIELD-VERIFY
// against the manufacturer datasheet before relying on them for procurement.
// ═══════════════════════════════════════════════════════════════════════════

export type BosKind =
  | 'integrated_combiner'   // combiner + gateway (+/- disconnect) in one enclosure
  | 'gateway'               // standalone monitoring/metering gateway (Envoy)
  | 'ac_combiner'           // discrete AC combiner (no gateway)
  | 'meter_socket'          // integrated meter-socket device (Tesla) — future
  | 'backup_switch';        // integrated backup/microgrid interconnect — future

/** The roles a single device performs — what lets us collapse boxes on the wall. */
export interface IntegratedFunctions {
  aggregation?: boolean;     // combines the AC branch circuits (busbar + breakers)
  disconnect?: boolean;      // serves as the PV-system AC disconnecting means (load-break)
  monitoring?: boolean;      // production/consumption monitoring + comms (the gateway)
  metering?: boolean;        // revenue-grade / production metering (CTs)
  rapidShutdown?: boolean;   // hosts/initiates the PV rapid-shutdown function
  backup?: boolean;          // microgrid interconnect / backup control
}

export interface BosDevice {
  id: string;
  brand: string;             // 'Enphase' | 'Tesla' | 'SolarEdge' | ...
  model: string;
  partNumber?: string;       // real ordering SKU (sourced)
  kind: BosKind;
  generation?: 'gen1' | 'gen2' | 'gen3' | 'gen4';  // Enphase ecosystem generation (6C=gen4, 5C=gen3, 4C=gen2, 3C=gen1)
  /** The roles this one device performs. */
  integrated: IntegratedFunctions;
  /** True when this device is the system controller / "brains". */
  isBrains?: boolean;
  /** AC branch (2-pole PV) breaker positions. IQ Combiner 3C/4C/5C/6C all take 4 (6C: 5 with a quadplex). */
  branchSlots?: number;
  maxContinuousA?: number;   // total PV continuous output current
  mainBreakerA?: number;     // aggregate/main breaker (only the 6C has one — it IS the PV disconnect)
  maxDevices?: number;       // microinverters supported
  mounting?: 'wall' | 'indoor' | 'outdoor' | 'meter_socket';
  outputWireGaugeMin?: string;
  necRefs?: string[];
  /** Which inverter ecosystem this belongs to, e.g. 'enphase-iq'. */
  ecosystem?: string;
  /** Lower = easier install / fewer separate boxes on the wall (used to pick the default). */
  installComplexity?: number;
  /** Devices REPLACED by this one when integrated (for topology flags on the SLD). */
  replacesSeparate?: Array<'gateway' | 'ac_disconnect'>;
  active?: boolean;
}

// ── Catalog (specs SOURCED — lib/data/equipment/bos-devices-research.json) ───
// Correction of earlier assumptions: "6C" is a GENERATION name, not a 6-branch
// cap — every IQ Combiner (3C/4C/5C/6C) takes 4 two-pole PV branches (6C: 5 with
// a quadplex). And ONLY the 6C's aggregate PV breaker (UL 489) legally serves as
// the PV AC disconnecting means (outdoors) — the 4C/5C are main-lug only and need
// a separate external AC disconnect. The 6C is the current, easiest-install pick
// (one box = combiner + IQ Gateway + integral disconnect + RSD initiator).
export const BOS_DEVICES: BosDevice[] = [
  {
    id: 'enphase-iq-combiner-6c',
    brand: 'Enphase',
    model: 'IQ Combiner 6C',
    partNumber: 'X-IQ-AM1-240-6C',
    kind: 'integrated_combiner',
    generation: 'gen4',
    integrated: { aggregation: true, disconnect: true, monitoring: true, metering: true, rapidShutdown: true },
    isBrains: true,
    branchSlots: 4,          // 4 two-pole 20A PV branches (5 with a quadplex breaker); + 200A DER busbar
    maxContinuousA: 80,      // total PV continuous
    mainBreakerA: 100,       // aggregate PV breaker (ships 60A, up to 100A) — the PV disconnect
    mounting: 'outdoor',     // NEMA 3R
    outputWireGaugeMin: '#4 AWG',
    necRefs: ['NEC 690.4', 'NEC 705.10', 'NEC 690.13', 'NEC 690.12'],
    ecosystem: 'enphase-iq',
    installComplexity: 1,    // one box replaces gateway + AC disconnect
    replacesSeparate: ['gateway', 'ac_disconnect'],
    active: true,
  },
  {
    id: 'enphase-iq-combiner-5c',
    brand: 'Enphase',
    model: 'IQ Combiner 5C',
    partNumber: 'X-IQ-AM1-240-5C',
    kind: 'integrated_combiner',
    generation: 'gen3',
    integrated: { aggregation: true, monitoring: true, metering: true },  // main-lug only → NO integral PV disconnect
    isBrains: true,
    branchSlots: 4,
    maxContinuousA: 64,      // 80A PV total on a 125A busbar
    mounting: 'outdoor',
    necRefs: ['NEC 690.4', 'NEC 705.10'],
    ecosystem: 'enphase-iq',
    installComplexity: 2,    // integrates the gateway but still needs an external AC disconnect
    replacesSeparate: ['gateway'],
    active: true,
  },
  {
    id: 'enphase-iq-combiner-4c',
    brand: 'Enphase',
    model: 'IQ Combiner 4C',
    partNumber: 'X-IQ-AM1-240-4C',  // registry's ENV-IQ-C4C-240 was fabricated
    kind: 'integrated_combiner',
    generation: 'gen2',
    integrated: { aggregation: true, monitoring: true, metering: true },
    isBrains: true,
    branchSlots: 4,
    maxContinuousA: 64,
    mounting: 'outdoor',
    necRefs: ['NEC 690.4', 'NEC 705.10'],
    ecosystem: 'enphase-iq',
    installComplexity: 2,
    replacesSeparate: ['gateway'],
    active: true,
  },
  {
    id: 'enphase-iq-gateway',
    brand: 'Enphase',
    model: 'IQ Gateway',
    partNumber: 'ENV-IQ-AM1-240',   // ENV2-IQ-AM1-240 = current (IEEE 2030.5). Formerly IQ Envoy / Envoy-S Metered
    kind: 'gateway',
    generation: undefined,
    integrated: { monitoring: true, metering: true, rapidShutdown: true },
    isBrains: true,
    mounting: 'indoor',      // DIN-rail, IP30
    necRefs: ['NEC 690.4'],
    ecosystem: 'enphase-iq',
    // Standalone gateway needs a SEPARATE combiner + AC disconnect — most boxes.
    installComplexity: 3,
    active: true,
  },
  {
    id: 'enphase-iq-meter-collar',
    brand: 'Enphase',
    model: 'IQ Meter Collar',
    partNumber: 'MC-200-011-V01',
    kind: 'meter_socket',
    generation: 'gen4',
    integrated: { metering: true, disconnect: true },  // meter-socket adapter with integrated MID (grid isolation)
    branchSlots: 0,
    maxContinuousA: 200,
    mounting: 'meter_socket',
    necRefs: ['NEC 705.20'],
    ecosystem: 'enphase-iq',
    installComplexity: 1,
    active: true,
  },
  {
    id: 'tesla-backup-switch',
    brand: 'Tesla',
    model: 'Backup Switch',
    partNumber: '1624171',
    kind: 'meter_socket',
    integrated: { metering: true, disconnect: true, backup: true },  // ANSI Type 2S meter socket + grid-isolation contactor + ±0.5% metering
    branchSlots: 0,
    maxContinuousA: 200,
    mounting: 'meter_socket',
    necRefs: ['NEC 705.20', 'NEC 710'],
    ecosystem: 'tesla',
    installComplexity: 1,
    active: true,
  },
  // ── Shared AC COMBINER PANELS (PV subpanels) ───────────────────────────────
  // Where multiple inverter / brand-combiner AC outputs land on a common busbar,
  // each on its own backfed OCPD, feeding ONE system AC disconnect (a multi-brand
  // hybrid collects here instead of running a separate disconnect per source).
  // Sized to the aggregate PV backfeed per NEC 705.12(B) / 408. ⚠ FIELD-VERIFY SKU.
  {
    id: 'pv-ac-combiner-125', brand: 'Generic', model: '125A PV AC Combiner Panel',
    kind: 'ac_combiner', integrated: { aggregation: true },
    branchSlots: 6, maxContinuousA: 125, mainBreakerA: 125,
    mounting: 'outdoor', outputWireGaugeMin: '#2 AWG',
    necRefs: ['NEC 705.12(B)', 'NEC 408.36', 'NEC 690.4'],
    installComplexity: 2, active: true,
  },
  {
    id: 'pv-ac-combiner-200', brand: 'Generic', model: '200A PV AC Combiner Panel',
    kind: 'ac_combiner', integrated: { aggregation: true },
    branchSlots: 8, maxContinuousA: 200, mainBreakerA: 200,
    mounting: 'outdoor', outputWireGaugeMin: '#2/0 AWG',
    necRefs: ['NEC 705.12(B)', 'NEC 408.36', 'NEC 690.4'],
    installComplexity: 2, active: true,
  },
  {
    id: 'pv-ac-combiner-225', brand: 'Generic', model: '225A PV AC Combiner Panel',
    kind: 'ac_combiner', integrated: { aggregation: true },
    branchSlots: 12, maxContinuousA: 225, mainBreakerA: 225,
    mounting: 'outdoor', outputWireGaugeMin: '#4/0 AWG',
    necRefs: ['NEC 705.12(B)', 'NEC 408.36', 'NEC 690.4'],
    installComplexity: 2, active: true,
  },
];

export function getBosDevice(id: string | undefined): BosDevice | undefined {
  if (!id) return undefined;
  return BOS_DEVICES.find(d => d.id === id && d.active !== false);
}

// ── Resolver ────────────────────────────────────────────────────────────────

export interface SystemBosContext {
  inverterManufacturer: string;
  inverterModel: string;
  isMicro: boolean;
  /** Microinverter count (device count). */
  totalDevices: number;
  /** Planned AC branch circuits. */
  branchCount: number;
  hasBattery: boolean;
  /** Explicit user selection (overrides auto-config) — future design-studio hook. */
  overrideDeviceIds?: string[];
}

export interface ResolvedBosDevice extends BosDevice {
  /** Human role summary for the directory / schedule, e.g. "Combiner · Gateway · Disconnect". */
  roleSummary: string;
  quantity: number;
}

export interface IntegratedEquipmentPlan {
  brand: string | null;
  /** All BOS devices this system uses, in reading order. */
  devices: ResolvedBosDevice[];
  /** The primary integrated device / brains, if any. */
  brains?: ResolvedBosDevice;
  /** True when a single device provides the monitoring gateway (no separate Envoy on the wall). */
  hasIntegratedGateway: boolean;
  /** True when the combiner IS the PV-system AC disconnecting means (no separate AC disconnect). */
  providesAcDisconnect: boolean;
  branchSlots?: number;
  /** Set when the branch count exceeds the device's slot capacity. */
  branchSlotWarning?: string;
  source: 'override' | 'auto' | 'none';
}

const GEN4_MICRO = /iq8/i;
const GEN3_MICRO = /iq[67]/i;

/** Detect the Enphase generation from the microinverter model string. */
export function enphaseGeneration(model: string): 'gen3' | 'gen4' | null {
  if (GEN4_MICRO.test(model)) return 'gen4';
  if (GEN3_MICRO.test(model)) return 'gen3';
  return null;
}

function roleSummary(d: BosDevice): string {
  const parts: string[] = [];
  if (d.integrated.aggregation) parts.push('Combiner');
  if (d.integrated.monitoring) parts.push('Gateway');
  if (d.integrated.metering) parts.push('Metering');
  if (d.integrated.disconnect) parts.push('Disconnect');
  if (d.integrated.rapidShutdown) parts.push('Rapid Shutdown');
  if (d.integrated.backup) parts.push('Backup');
  return parts.join(' · ') || d.kind;
}

const resolved = (d: BosDevice, quantity = 1): ResolvedBosDevice => ({ ...d, roleSummary: roleSummary(d), quantity });

const emptyPlan = (brand: string | null): IntegratedEquipmentPlan => ({
  brand, devices: [], hasIntegratedGateway: false, providesAcDisconnect: false, source: 'none',
});

/**
 * Auto-configure (or honor an override for) the integrated BOS devices for a
 * system. Default policy: pick the best/easiest-install option — the integrated
 * Gen-4 combiner that collapses gateway + AC disconnect into one wall box —
 * sized to the branch count. Currently models the Enphase ecosystem; other
 * brands fall through to an empty plan until their devices are added.
 */
export function resolveIntegratedEquipment(ctx: SystemBosContext): IntegratedEquipmentPlan {
  // Explicit user override wins.
  if (ctx.overrideDeviceIds?.length) {
    const devices = ctx.overrideDeviceIds.map(getBosDevice).filter(Boolean) as BosDevice[];
    if (devices.length) {
      const combiner = devices.find(d => d.kind === 'integrated_combiner' || d.kind === 'ac_combiner');
      const gw = devices.find(d => d.integrated.monitoring);
      const brainsDev = devices.find(d => d.isBrains);
      return {
        brand: devices[0].brand,
        devices: devices.map(d => resolved(d)),
        brains: brainsDev ? resolved(brainsDev) : undefined,
        hasIntegratedGateway: !!(combiner?.integrated.monitoring) || !!gw,
        providesAcDisconnect: !!combiner?.integrated.disconnect,
        branchSlots: combiner?.branchSlots,
        branchSlotWarning: combiner?.branchSlots && ctx.branchCount > combiner.branchSlots
          ? `${ctx.branchCount} AC branches exceed the ${combiner.model} ${combiner.branchSlots}-position limit — a second combiner or subpanel is required.`
          : undefined,
        source: 'override',
      };
    }
  }

  const isEnphase = /enphase/i.test(ctx.inverterManufacturer);
  if (!isEnphase || !ctx.isMicro) return emptyPlan(isEnphase ? 'Enphase' : null);

  // Auto-config the BEST / easiest-install device: the current-gen IQ Combiner
  // 6C — one box that IS the combiner + IQ Gateway + integral PV disconnect + RSD
  // initiator (fewest boxes on the wall). The 4C/5C and standalone Gateway remain
  // available as user overrides. (Enphase generation is an ecosystem line, not a
  // property of the micro model, so we don't branch on the micro here.)
  const combiner = getBosDevice('enphase-iq-combiner-6c')!;
  // The 6C PV busbar takes 4 two-pole branches (5 with a quadplex); beyond that
  // the branches spill onto the 200A DER busbar or a subpanel.
  const pvBranchMax = 5;
  return {
    brand: 'Enphase',
    devices: [resolved(combiner)],
    brains: resolved(combiner),
    hasIntegratedGateway: true,
    providesAcDisconnect: !!combiner.integrated.disconnect,
    branchSlots: combiner.branchSlots,
    branchSlotWarning: ctx.branchCount > pvBranchMax
      ? `${ctx.branchCount} AC branches exceed the ${combiner.model} PV busbar (4 breakers, 5 with a quadplex) — route the balance onto the DER busbar or a subpanel.`
      : undefined,
    source: 'auto',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// HYBRID AC COLLECTION — multi-brand / multi-source combining architecture.
// Each source combines with its BRAND-APPROPRIATE device (Enphase micros → an
// IQ Combiner; string/hybrid inverters → a backfed OCPD), then ALL sources land
// on a shared AC combiner panel (busbar), which feeds ONE system AC disconnect
// → point of interconnection. Replaces "one AC disconnect per lane".
// ═══════════════════════════════════════════════════════════════════════════

// Standard OCPD / busbar ratings (A), NEC 240.6(A).
const STD_RATINGS = [15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200, 225, 250, 300, 350, 400];
// Exported: conductorAuthority's POI block sizes the supply-side tap OCPD with
// THIS table so E-1's system disconnect and the authority can never diverge.
export const nextStdRating = (a: number): number => STD_RATINGS.find(r => r >= a) ?? Math.ceil(a / 50) * 50;

export interface AcCombinerPanelPlan extends ResolvedBosDevice {
  /** Busbar continuous rating (A). */
  busbarA: number;
  /** Main / feeder OCPD ahead of the shared disconnect (A). */
  mainOcpdA: number;
  /** Backfed-breaker positions the sources land on. */
  positions: number;
}

/** Pick the smallest AC combiner panel whose busbar covers the aggregate PV
 *  backfeed (NEC 705.12(B) — a dedicated PV panel's busbar ≥ Σ source OCPD). */
export function resolveAcCombinerPanel(aggregateBackfeedA: number, sourceCount = 0): AcCombinerPanelPlan | null {
  if (aggregateBackfeedA <= 0) return null;
  const panels = BOS_DEVICES
    .filter(d => d.id.startsWith('pv-ac-combiner-') && d.active !== false)
    .sort((a, b) => (a.maxContinuousA ?? 0) - (b.maxContinuousA ?? 0));
  const pick = panels.find(p => (p.maxContinuousA ?? 0) >= aggregateBackfeedA
    && (p.branchSlots ?? 0) >= sourceCount) ?? panels[panels.length - 1];
  if (!pick) return null;
  return {
    ...resolved(pick),
    busbarA: pick.maxContinuousA ?? aggregateBackfeedA,
    mainOcpdA: nextStdRating(aggregateBackfeedA),
    positions: pick.branchSlots ?? sourceCount,
  };
}

export interface HybridSourceInput {
  key: string;                      // 'roof' | 'ground' | 'fence'
  inverterManufacturer: string;
  inverterModel: string;
  isMicro: boolean;
  branchCount: number;              // AC branches (micro) or string count
  deviceCount: number;              // micro device count
  backfeedA: number;                // this source's OCPD / backfeed amps
}
export interface HybridSourceCombining {
  key: string;
  isMicro: boolean;
  /** Micro subs: the brand combiner (IQ Combiner). String/hybrid: null → the
   *  source's OCPD is a backfed breaker in the shared panel. */
  combiner: ResolvedBosDevice | null;
  /** True when the combiner already IS a disconnecting means (6C) for that lane. */
  combinerHasDisconnect: boolean;
  ocpdA: number;
  branchSlotWarning?: string;
}
export interface HybridAcCollectionPlan {
  perSource: HybridSourceCombining[];
  /** Shared AC combiner panel every source lands on (null when only one source). */
  sharedPanel: AcCombinerPanelPlan | null;
  /** The single system AC disconnect after the shared panel (A). */
  disconnectA: number;
  /** Σ of all source backfeeds (A). */
  aggregateBackfeedA: number;
}

/** Resolve the full multi-source AC collection: per-source brand combiner/OCPD →
 *  shared AC combiner panel → one disconnect. */
export function resolveHybridAcCollection(sources: HybridSourceInput[]): HybridAcCollectionPlan {
  const perSource: HybridSourceCombining[] = sources.map(s => {
    if (s.isMicro) {
      const plan = resolveIntegratedEquipment({
        inverterManufacturer: s.inverterManufacturer, inverterModel: s.inverterModel,
        isMicro: true, totalDevices: s.deviceCount, branchCount: s.branchCount, hasBattery: false,
      });
      const combiner = plan.brains ?? plan.devices[0] ?? null;
      return {
        key: s.key, isMicro: true, combiner,
        combinerHasDisconnect: !!combiner?.integrated.disconnect,
        ocpdA: s.backfeedA, branchSlotWarning: plan.branchSlotWarning,
      };
    }
    // String / hybrid inverter: no dedicated combiner — its OCPD is a backfed
    // breaker landing directly on the shared AC combiner panel.
    return { key: s.key, isMicro: false, combiner: null, combinerHasDisconnect: false, ocpdA: s.backfeedA };
  });
  const aggregateBackfeedA = sources.reduce((a, s) => a + (s.backfeedA || 0), 0);
  const sharedPanel = sources.length > 1
    ? resolveAcCombinerPanel(aggregateBackfeedA, sources.length)
    : null;
  const disconnectA = nextStdRating(aggregateBackfeedA);
  return { perSource, sharedPanel, disconnectA, aggregateBackfeedA };
}
