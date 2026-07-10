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
  partNumber?: string;       // ⚠ FIELD-VERIFY
  kind: BosKind;
  generation?: 'gen3' | 'gen4';
  /** The roles this one device performs. */
  integrated: IntegratedFunctions;
  /** True when this device is the system controller / "brains". */
  isBrains?: boolean;
  branchSlots?: number;      // AC branch breaker positions (IQ Combiner 4C=4, 6C=6)
  maxContinuousA?: number;   // combiner continuous output current
  maxDevices?: number;       // microinverters supported
  mounting?: 'wall' | 'exterior' | 'meter_socket';
  outputWireGaugeMin?: string;
  necRefs?: string[];
  /** Which inverter ecosystem this belongs to, e.g. 'enphase-iq8'. */
  ecosystem?: string;
  /** Lower = easier install / fewer separate boxes on the wall (used to pick the default). */
  installComplexity?: number;
  /** Devices REPLACED by this one when integrated (for topology flags on the SLD). */
  replacesSeparate?: Array<'gateway' | 'ac_disconnect'>;
  active?: boolean;
}

// ── Enphase Gen 4 (IQ8) integrated devices ──────────────────────────────────
// The IQ Combiner line integrates the IQ Gateway; the 6C adds slots and is the
// current easiest-install choice (one box replaces gateway + AC disconnect).
export const BOS_DEVICES: BosDevice[] = [
  {
    id: 'enphase-iq-combiner-6c',
    brand: 'Enphase',
    model: 'IQ Combiner 6C',
    partNumber: 'X-IQ-AM1-240-6C', // ⚠ FIELD-VERIFY
    kind: 'integrated_combiner',
    generation: 'gen4',
    integrated: { aggregation: true, disconnect: true, monitoring: true, metering: true, rapidShutdown: true },
    isBrains: true,
    branchSlots: 6,
    maxContinuousA: 80,
    maxDevices: 80,
    mounting: 'wall',
    outputWireGaugeMin: '#4 AWG',
    necRefs: ['NEC 690.4', 'NEC 705.10', 'NEC 690.13'],
    ecosystem: 'enphase-iq8',
    installComplexity: 1,
    replacesSeparate: ['gateway', 'ac_disconnect'],
    active: true,
  },
  {
    id: 'enphase-iq-combiner-4c',
    brand: 'Enphase',
    model: 'IQ Combiner 4C',
    partNumber: 'X-IQ-AM1-240-4C', // ⚠ FIELD-VERIFY (registry legacy: ENV-IQ-C4C-240)
    kind: 'integrated_combiner',
    generation: 'gen4',
    integrated: { aggregation: true, disconnect: true, monitoring: true, metering: true, rapidShutdown: true },
    isBrains: true,
    branchSlots: 4,
    maxContinuousA: 64,
    maxDevices: 64,
    mounting: 'wall',
    outputWireGaugeMin: '#6 AWG',
    necRefs: ['NEC 690.4', 'NEC 705.10', 'NEC 690.13'],
    ecosystem: 'enphase-iq8',
    installComplexity: 1,
    replacesSeparate: ['gateway', 'ac_disconnect'],
    active: true,
  },
  {
    id: 'enphase-iq-gateway',
    brand: 'Enphase',
    model: 'IQ Gateway (Envoy)',
    partNumber: 'ENV-IQ-AM1-240',
    kind: 'gateway',
    generation: 'gen3',
    integrated: { monitoring: true, metering: true, rapidShutdown: true },
    isBrains: true,
    mounting: 'wall',
    necRefs: ['NEC 690.4'],
    ecosystem: 'enphase-iq8',
    // Standalone gateway needs a SEPARATE combiner + AC disconnect on the wall —
    // more boxes, so a higher complexity than the integrated combiner.
    installComplexity: 3,
    active: true,
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

  const gen = enphaseGeneration(ctx.inverterModel) ?? 'gen4'; // default to modern

  if (gen === 'gen4') {
    // Integrated combiner (one box = combiner + gateway + disconnect). Best-fit
    // by branch slots: 4C for ≤4 branches, else the 6C (also the default when
    // the branch plan is unknown). This is the "least on the wall" choice.
    const use6c = ctx.branchCount > 4 || ctx.branchCount === 0;
    const combiner = getBosDevice(use6c ? 'enphase-iq-combiner-6c' : 'enphase-iq-combiner-4c')!;
    return {
      brand: 'Enphase',
      devices: [resolved(combiner)],
      brains: resolved(combiner),
      hasIntegratedGateway: true,
      providesAcDisconnect: !!combiner.integrated.disconnect,
      branchSlots: combiner.branchSlots,
      branchSlotWarning: combiner.branchSlots && ctx.branchCount > combiner.branchSlots
        ? `${ctx.branchCount} AC branches exceed the ${combiner.model} ${combiner.branchSlots}-position limit — a second combiner or subpanel is required.`
        : undefined,
      source: 'auto',
    };
  }

  // Gen 3: standalone Envoy/IQ Gateway on the wall + a separate combiner + AC
  // disconnect (more boxes). We model the gateway as the brains; the discrete
  // combiner/disconnect are represented by the generic sheet logic.
  const gateway = getBosDevice('enphase-iq-gateway')!;
  return {
    brand: 'Enphase',
    devices: [resolved(gateway)],
    brains: resolved(gateway),
    hasIntegratedGateway: false,   // separate Envoy box
    providesAcDisconnect: false,   // separate AC disconnect required
    source: 'auto',
  };
}
