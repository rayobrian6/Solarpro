// ═══════════════════════════════════════════════════════════════
// Computed Runs — run the EXISTING wire-sizing engine (computeSystem)
// in the permit path with REAL geometry-derived run lengths, and hand
// its sized RunSegment[] to the BOM.
//
// The gap it closes: computeSystem (which sizes every conductor,
// conduit and voltage drop per segment) only ran on paths with NO CAD
// geometry — the plan-set route fed it flat constants (20/15/10 ft)
// and the engineering page per-panel estimates — while the permit
// path, which HAS the CAD and deriveRunLengths(cad), never ran the
// engine at all. So the BOM priced wire from one flat length
// (PV-4B printed "60 ft" for every circuit). Here the two finally
// meet: deriveRunLengths(cad) → computeSystem → runs[] with real
// onewayLengthFt + per-segment gauge/EGC/conduit/conductorCount.
//
// Pure + guarded: same inputs → same runs; any failure returns null
// and the BOM falls back to its previous flat path (never blocks a
// permit).
// ═══════════════════════════════════════════════════════════════

import type { PermitInput } from '../types';
import type { CADModel } from '@/lib/cad/types';
import { computeSystem, type ComputedSystemInput, type RunSegment } from '@/lib/computed-system';
import { deriveRunLengths } from '@/lib/bom/deriveRunLengths';
import { getEquipmentContext, getInverterTopology, topologyToLegacy } from '@/lib/system';
import { toSubSystemKey, type SubSystemKey } from '@/lib/system/subSystemEquipment';
import { microMaxPerBranch } from './branching';
import { getDesignTemps } from './designTemps';
// THE battery electrical authority — the same function the engineering page,
// the standalone SLD and runElectricalCalc ask. Never a second arithmetic.
import { resolveBatteryBranch } from '@/lib/equipment-db';
import { hasRealBattery } from './helpers';
// WS-5 — the ONE substitution of a field measurement for an estimated run
// length, shared with the canonical run model in generatePermit.
import { applyFieldMeasurementsToRuns } from '../snapshot/applyFieldMeasurements';
import type { FieldRouteMeasurementAuthority } from '@/lib/fieldMeasurement/resolver';
import { normalizeConduitType as necNormalizeConduitType } from '@/lib/nec/chapter9';

/**
 * Wave 2a (contract §3, 2a Compute): per-subsystem scoping for the permit-path
 * wire-sizing pass. Legacy callers (no opts) are byte-identical to pre-Wave-2a
 * — including the historical rooftop 33 °C adder — so N=1 goldens hold (I-1).
 */
export interface ComputedRunsOpts {
  /** Explicit subsystem scope for geometry derivation — beats cad.systemType
   *  (a hybrid CAD carries roof+ground+fence geometry simultaneously). */
  systemType?: string | null;
  /** Stamped onto every emitted RunSegment.subSystem (contract §1.3). */
  subSystemKey?: SubSystemKey;
  /** Panel SUBSET count for this subsystem (never the whole-project count). */
  totalPanels?: number;
  /** The subsystem's own string count (never the whole-project sum). */
  stringCount?: number;
  /**
   * SubSystemEquipment.env.rooftopTempAdderC — roof runs get the rooftop
   * adder, ground/fence runs get 0. When absent it is derived from the
   * effective systemType (roof → legacy 33 °C, ground/fence → 0); when no
   * scope is given at all, the legacy whole-project 33 °C is preserved.
   */
  rooftopTempAdderC?: number;
  /** FALSE on computeMultiSystem per-sub calls — the shared service tail
   *  (disco→MSP→utility) is emitted once by the aggregate. Default TRUE. */
  emitSharedServiceRuns?: boolean;
}

export function buildComputedRunsForPermit(
  input: PermitInput,
  cad: CADModel,
  opts?: ComputedRunsOpts,
): RunSegment[] | null {
  try {
    const eq = getEquipmentContext(input, cad);
    const _projTh = input.project as { lat?: number; lng?: number; state?: string };
    const _temps = getDesignTemps(_projTh.lat, _projTh.lng,
      (typeof _projTh.state === 'string' && /^[A-Za-z]{2}$/.test(_projTh.state.trim()))
        ? _projTh.state.trim().toUpperCase() : undefined);
    const topo = String(topologyToLegacy(getInverterTopology(input))).toLowerCase() as 'micro' | 'optimizer' | 'string';
    // Panel subset: an explicit per-subsystem count beats the project total.
    const hasSubset = typeof opts?.totalPanels === 'number' && opts.totalPanels > 0;
    const totalPanels = hasSubset
      ? opts!.totalPanels!
      : (input.system?.totalPanels || cad.totalPanels || 0);
    if (!totalPanels) return null;

    const firstInv = input.system?.inverters?.[0];
    const firstStr = firstInv?.strings?.[0];
    const stringCount = opts?.stringCount && opts.stringCount > 0
      ? opts.stringCount
      : topo === 'micro'
        ? 1
        : Math.max(1, input.system?.inverters?.reduce((s, inv) => s + (inv.strings?.length || 0), 0) || 1);

    // Real geometry-derived segment lengths. Only segments the CAD could
    // actually derive are present; computeSystem's defaults cover the rest.
    // Explicit systemType scopes derivation to ONE subsystem's geometry.
    const { runLengths } = deriveRunLengths(cad, { systemType: opts?.systemType });

    // Rooftop temp adder is a per-subsystem env fact, not a project-wide
    // constant: roof conductors bake at roof-surface temps; ground/fence runs
    // never do. Legacy (unscoped) callers keep the historical 33 °C.
    const rooftopTempAdderC =
      typeof opts?.rooftopTempAdderC === 'number'
        ? opts.rooftopTempAdderC
        : (opts?.systemType != null && opts.systemType !== ''
            ? (toSubSystemKey(opts.systemType) === 'roof' ? 33 : 0)
            : 33);

    // System AC kW — prefer the system total (SKIPPED when a panel subset is
    // given: input.system.totalAcKw is the whole-project figure and would
    // leak cross-subsystem kW into this sub's sizing). For micro, only
    // multiply the per-DEVICE rating by panel count when it plausibly IS a
    // micro rating (≤ 2 kW); a string-inverter kW leaking in here × 52 panels
    // produced a 91 kW phantom (and a 4/0 AWG feeder) on a 15 kW job.
    const _dcKw = (hasSubset ? undefined : input.system?.totalDcKw) ?? (totalPanels * (eq.panelWatts || 400)) / 1000;
    const acKw = (hasSubset ? undefined : input.system?.totalAcKw)
      || (topo === 'micro'
        ? (eq.inverterAcOutputKw > 0 && eq.inverterAcOutputKw <= 2
            ? eq.inverterAcOutputKw * totalPanels
            : _dcKw * 0.77)
        : (eq.inverterAcOutputKw || _dcKw * 0.8));

    // ══ 2026-09-22 — THE PERMIT'S BUSBAR VERDICT HAD THE BATTERY SET TO ZERO ══
    //
    // 🚨 WHAT WAS HERE: `batteryBackfeedA: 0, batteryCount: 0` — two literals,
    // unconditional, on the input to the engine whose projection IS
    // `compliance.electrical.busbar` (W2.1). The engineering page
    // (app/engineering/page.tsx: `batteryIds: [config.batteryId]`) and the
    // standalone SLD route both hand computeSystem the real battery; the PERMIT
    // path — the only one whose output an AHJ stamps — handed it nothing.
    //
    // WHAT A USER SAW: 200 A bus, 175 A main (65 A of headroom), load-side, one
    // 3.8 kW string inverter (20 A) plus one Tesla Powerwall 3. The Powerwall's
    // documented 50 A backfeed breaker is real load on that bus: 20 + 50 = 70 A
    // > 65 A. The page said FAIL. The permit said PASS on 20 A, because the
    // battery was not in the sum at all. The package that goes to the AHJ was
    // the wrong one, in the permissive direction, on the calculation that
    // clears a design for interconnection.
    //
    // The identity is resolved ONCE, here, through `resolveBatteryBranch` —
    // which owns the id-else-EXACT-manufacturer+model recovery, so a legacy
    // design carrying only brand/model still resolves. Its resolved catalogue id
    // is then handed to the engine, which asks the SAME authority for the
    // busbar contribution (computed-system.ts: `_batteryCountsById`). One
    // function, one number, no second copy of the step function here.
    //
    // `batteryBackfeedA` is deliberately NOT set: it is the engine's fallback
    // for callers with no id, and it ALSO gates the BATTERY_TO_BUI / BUI_TO_MSP
    // run segments. Those runs are a separate piece of work — this change fixes
    // the 705.12(B) term and nothing else about the BOM.
    const _batteryUnits = Math.max(1, Math.trunc(input.project.batteryCount ?? 0) || 1);
    const _hasBattery = hasRealBattery(input.project);
    const _batAuth = _hasBattery
      ? resolveBatteryBranch(
          { id: input.project.batteryId, brand: input.project.batteryBrand, model: input.project.batteryModel },
          _batteryUnits,
        )
      : null;
    // The id the engine will re-resolve. Resolved ⇒ the catalogue id (which may
    // have been recovered from manufacturer+model). Unresolved ⇒ whatever the
    // design declared, so the engine's own "this battery is UNRESOLVED and the
    // busbar total is therefore incomplete" warning fires instead of silence.
    const _batteryEngineId = (_batAuth?.resolved ? _batAuth.batteryId : input.project.batteryId) || '';
    if (_hasBattery && !_batteryEngineId) {
      console.warn('[computedRuns] battery present on this design but NO catalogue identity could be',
        'resolved (declared:', [input.project.batteryBrand, input.project.batteryModel].filter(Boolean).join(' ') || '—',
        ') — its NEC 705.12(B) contribution is MISSING from the permit busbar total.',
        _batAuth?.refusal?.message ?? '');
    }

    // ══ 2026-09-22 — ONE FORMULA FOR THE 705.12(B) TOTAL PV BACKFEED ═════════
    //
    // This function hands computeSystem ONE SYNTHETIC inverter carrying the
    // whole project's AC kW (`inverterAcKw: acKw` below), because that is what
    // sizes the feeder correctly. The engine therefore cannot see how many
    // physical inverters actually land on the busbar, and it rounded the
    // aggregate current once: three Fronius Primo 6.0-1 = 75 A × 1.25 = 93.75 →
    // ONE 100 A breaker → PASS against a 100 A allowance, while the engineering
    // page counted the three real 35 A breakers → 105 A → FAIL.
    //
    // The real circuit list is right here on the design, so it is passed
    // explicitly. `interconnectingCircuitAmps` is a list of BREAKERS, not
    // conductors — the feeder stays sized on the aggregate.
    //   · micro: the whole fleet sits behind one AC combiner breaker, which is
    //     exactly what the engine already derives — left alone.
    //   · a per-subsystem scoped call (opts.totalPanels) gets its own aggregate
    //     and must never see the whole-project fleet — left alone.
    //   · ONE circuit is left alone too. At N=1 the engine's own derivation is
    //     already Σ-of-one, and `acKw` (the project total, which is what the
    //     feeder is sized from) stays the single basis for the whole sheet.
    //     Handing it inverters[0].acOutputKw instead would move every
    //     single-inverter package whose two carriages disagree — a digest move
    //     with no defect behind it (I-1: N=1 byte identity).
    const _fleetCircuitAmps: number[] = (topo !== 'micro' && !hasSubset)
      ? (input.system?.inverters ?? [])
          .filter(inv => String(inv?.type ?? '').toLowerCase() !== 'micro')
          .map(inv => ((inv?.acOutputKw || 0) * 1000) / 240)
          .filter(a => a > 0)
      : [];
    // A fleet whose nameplates do not add up to the AC kW the rest of this
    // sheet is derived from is a mis-shaped payload, not a calculation result.
    // Surfaced rather than silently deciding a 120% verdict from it.
    if (_fleetCircuitAmps.length > 1) {
      const _fleetKw = (_fleetCircuitAmps.reduce((s, a) => s + a, 0) * 240) / 1000;
      if (acKw > 0 && Math.abs(_fleetKw - acKw) / acKw > 0.02) {
        console.warn('[computedRuns] inverter fleet nameplates sum to', _fleetKw.toFixed(2),
          'kW but the system AC total is', acKw.toFixed(2),
          'kW — the NEC 705.12(B) backfeed is Σ of the per-inverter breakers and',
          'the feeder is sized on the system total; these two should agree.');
      }
    }

    const csInput: ComputedSystemInput = {
      topology: (topo === 'micro' ? 'micro' : topo === 'optimizer' ? 'optimizer' : 'string'),
      totalPanels,
      panelWatts: eq.panelWatts || 400,
      panelVoc: eq.panelVoc || 41.6,
      panelVmp: (eq.panelVoc || 41.6) * 0.83,
      panelIsc: eq.panelIsc || 9.0,
      panelImp: (eq.panelIsc || 9.0) * 0.94,
      panelTempCoeffVoc: -0.29,
      panelTempCoeffIsc: 0.05,
      panelMaxSeriesFuse: 20,
      panelModel: eq.panelModel || 'Solar Panel',
      panelManufacturer: eq.panelManufacturer || 'See Cut Sheet',
      inverterManufacturer: eq.inverterManufacturer || 'Inverter Mfr',
      inverterModel: eq.inverterModel || 'Inverter',
      // Engine contract: PER-DEVICE kW for micro (perMicroCurrentA = inverterAcKw
      // × 1000/240, then × device count); whole-inverter kW for string.
      inverterAcKw: topo === 'micro' ? acKw / Math.max(1, totalPanels) : acKw,
      inverterMaxDcV: topo === 'micro' ? 60 : 600,
      inverterMpptVmin: 100,
      inverterMpptVmax: topo === 'micro' ? 60 : 600,
      inverterMaxInputCurrentPerMppt: 15,
      inverterMpptChannels: stringCount,
      // PER-DEVICE max AC amps — the engine multiplies this by device count for
      // micro (passing system amps here made 12 devices × 20.8 A = 250 A → a
      // phantom 4/0 feeder). IQ8+ ≈ 1.21 A/device; string = whole-inverter amps.
      inverterAcCurrentMax: topo === 'micro'
        ? (acKw * 1000) / 240 / Math.max(1, totalPanels)
        : (acKw * 1000) / 240,
      inverterModulesPerDevice: 1,
      // W2: per-MODEL manufacturer branch limit (D-1 authority) — never a
      // flat 13; and the SAME ASHRAE thermal basis the snapshot records.
      inverterBranchLimit: microMaxPerBranch(eq.inverterModel, eq.inverterManufacturer),
      ambientTempC: _temps.ashrae2pctHighC ?? 40,
      designTempMin: (input.project as { designTempMin?: number }).designTempMin ?? _temps.ashraeExtremeLowC,
      rooftopTempAdderC, // per-subsystem env (roof adder / 0 for ground+fence); legacy unscoped = 33
      // REAL lengths where geometry allowed; engine defaults elsewhere.
      runLengths: {
        ...runLengths,
        ...(firstStr?.wireLength ? { DC_STRING_RUN: firstStr.wireLength } : {}),
      },
      panelBusRating: input.project.panelBusRating || input.project.mainPanelAmps || 200,
      mainPanelAmps: input.project.mainPanelAmps || 200,
      mainPanelBrand: input.project.mainPanelBrand || 'Square D',
      // ══ 2026-08-29 — THE RACEWAY MATERIAL, NOT A DISPLAY LABEL ══════════════
      // This packed the SIZE and the TYPE into one string — `3/4" EMT` — and
      // handed it to a field whose contract is a canonical type key
      // ('EMT' | 'PVC Sch 40' | 'PVC Sch 80'). Downstream, TWO different
      // exact-equality lookups then missed it and fell back in OPPOSITE
      // directions:
      //
      //   · segment-schedule's raceway ternary is
      //     `t === 'EMT' ? 'EMT' : t === 'PVC Sch 40' ? … : 'PVC_SCH80'`, so an
      //     unrecognised string became PVC Sch 80 — which is what PRINTED;
      //   · the conduit-area lookup ended `TABLE[t] ?? TABLE['EMT']`, so the same
      //     string was SIZED against steel.
      //
      // One malformed value, two silent fallbacks, and a package that stated a
      // PVC raceway whose 26.2% fill was 0.1399 in² over 0.533 — the EMT
      // interior. The project had selected EMT the whole time.
      //
      // The type is now passed through as the type. Trade size travels in
      // `conduitSizeInch`, where a size belongs.
      conduitType: necNormalizeConduitType(input.project.conduitType) ?? 'EMT',
      conduitSizeInch: input.project.conduitSize || undefined,
      maxACVoltageDropPct: 2,
      maxDCVoltageDropPct: 3,
      interconnectionMethod: (input.project.interconnectionMethod === 'SUPPLY_SIDE_TAP' ? 'SUPPLY_SIDE_TAP' : 'LOAD_SIDE'),
      // The battery's 705.12(B) contribution, from the authority (see above).
      // No battery on the job ⇒ the historical zeros, unchanged.
      batteryIds: _hasBattery && _batteryEngineId ? [_batteryEngineId] : undefined,
      batteryCount: _hasBattery ? _batteryUnits : 0,
      // The REAL interconnecting breakers, when this design has MORE THAN ONE.
      // One (or none) ⇒ the engine's own derivation, unchanged.
      ...(_fleetCircuitAmps.length > 1 ? { interconnectingCircuitAmps: _fleetCircuitAmps } : {}),
      // Wave 2a pass-through (both undefined on the legacy path — I-1):
      ...(opts?.subSystemKey ? { subSystemKey: opts.subSystemKey } : {}),
      ...(opts?.emitSharedServiceRuns === false ? { emitSharedServiceRuns: false } : {}),
    };

    const cs = computeSystem(csInput);
    // ── WS-5 §13 — THE SAME SUBSTITUTION THE CANONICAL RUN MODEL GETS ────────
    // This function calls computeSystem a SECOND time from the CAD (it predates
    // `input._computeSystem` being canonical), and the BOM's conduit footage is
    // derived from THESE runs. Without this, a verified 89-ft run printed 89 ft
    // on the conductor schedule and ordered 23 ft of conduit — the package
    // contradicting itself about one run. One authority, one substitution
    // function, both run models. No-op when no measurement exists.
    applyFieldMeasurementsToRuns(
      cs as unknown as { runs?: Array<Record<string, unknown>> },
      (input as unknown as { _fieldRouteMeasurements?: FieldRouteMeasurementAuthority | null })
        ._fieldRouteMeasurements ?? null,
    );
    _lastFullResult = cs;
    return cs.runs && cs.runs.length > 0 ? cs.runs : null;
  } catch (err) {
    console.warn('[computedRuns] computeSystem failed (BOM falls back to flat lengths):', (err as Error)?.message ?? err);
    return null;
  }
}

// ── D-2 parity shadow (W2) ───────────────────────────────────────────────────
// The snapshot builder needs the FULL computeSystem result (backfeed, branch
// plan, per-segment runs) to build the engine-parity matrix — not just the
// stamped RunSegment[] the BOM consumes. Same csInput assembly, full return.
let _lastFullResult: ReturnType<typeof computeSystem> | null = null;
export function buildComputeSystemShadow(
  input: PermitInput,
  cad: CADModel | null | undefined,
): ReturnType<typeof computeSystem> | null {
  _lastFullResult = null;
  buildComputedRunsForPermit(input, cad ?? undefined);
  return _lastFullResult;
}
