// ============================================================
// Auto String Generator — NEC 690.7 Compliant
// Generates electrically valid PV string configurations from
// module + inverter specifications.
//
// NEC 690.7: Voc correction for minimum design temperature
// NEC 690.8: OCPD sizing (Isc × 1.25 × 1.25)
// NEC 690.9: String fusing requirements
// ============================================================

import {
  distributeStringsAcrossMpptsSafely,
  type AllocatorString,
} from './system/mpptAllocator';
import {
  findCompatiblePanels,
  formatCompatiblePanelClause,
} from './panel-compatibility';

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface ModuleSpecs {
  voc:           number;   // Open-circuit voltage (V) at STC
  vmp:           number;   // Max power voltage (V) at STC
  isc:           number;   // Short-circuit current (A) at STC
  imp:           number;   // Max power current (A) at STC
  watts:         number;   // STC power (W)
  tempCoeffVoc:  number;   // Temperature coefficient of Voc (%/°C, negative, e.g. -0.27)
  tempCoeffVmp?: number;   // Temperature coefficient of Vmp (%/°C, negative)
  maxSeriesFuse: number;   // Max series fuse rating (A)
}

export interface InverterSpecs {
  maxDcVoltage:       number;   // Maximum DC input voltage (V)
  mpptVoltageMin:     number;   // MPPT minimum voltage (V)
  mpptVoltageMax:     number;   // MPPT maximum voltage (V)
  mpptChannels:       number;   // Number of MPPT inputs
  /**
   * v47.415 — Nominal DC input voltage (V) the inverter actively holds on its
   * DC bus during operation. Used ONLY by optimizer topology to compute
   * per-string OPERATING current as `stringPowerW / nominalDcVoltage` for
   * MPPT allocator feasibility. Falls back to midpoint of MPPT window when
   * omitted. Ignored for non-optimizer topologies.
   */
  nominalDcVoltage?: number; // V — fixed DC bus (optimizer/hybrid inverters)
  maxInputCurrentPerMppt?: number; // Max DC input current per MPPT (A)
  /**
   * Phase 13.4 — Max parallel strings allowed per MPPT channel.
   * Defaults to 1 (safe: no parallel combining) when undefined.
   * Brand profiles may override via BrandInverterModelRef.maxParallelStringsPerMppt.
   */
  maxParallelStringsPerMppt?: number;
  dcInputKwMax?:      number;   // Max DC input power (kW)
  acOutputKw:         number;   // AC output power (kW)
  /**
   * v47.420 — Max panels per string as defined in the brand profile.
   * Used by optimizer topology to set recommended string length.
   * Defaults to 25 (SolarEdge HD-Wave maximum) when undefined.
   */
  maxPanelsPerString?: number;  // brand profile ceiling for optimizer topology
}

export interface StringGeneratorInput {
  totalModules:      number;
  moduleSpecs:       ModuleSpecs;
  inverterSpecs:     InverterSpecs;
  designTempMin?:    number;   // °C — minimum design temperature (default: -10°C)
  necVersion?:       string;   // '2020' | '2023' (default: '2020')
  // v47.408 — Topology-aware string current calc.
  // When topology is 'optimizer', each string's current is capped by the
  // per-module optimizer's max output current (NEC 690.8(A)(2) — max sustained
  // circuit operating current), NOT by panel Isc × 1.25. Optimizers are
  // DC-DC converters that regulate string voltage (~380V for SolarEdge
  // HD-Wave) and cap output current at their rated max (typically 15.0 A
  // for SolarEdge P-series and Tigo TS4-A-O). Using Isc × 1.25 here would
  // over-report the string current and produce false MPPT_CURRENT_EXCEEDED
  // errors on optimizer systems.
  //
  // 'string' / 'hybrid' topologies keep the legacy Isc × 1.25 calc
  // (NEC 690.8(A)(1) panel method). Unknown / undefined defaults to 'string'
  // for backwards compatibility.
  topology?:                  'string' | 'optimizer' | 'hybrid';
  optimizerMaxOutputCurrent?: number;  // A — used only when topology==='optimizer'
  // v61.7 — Authoritative per-string panel counts from config.inverters[].strings.
  // When provided, the string distribution loop uses these ACTUAL counts instead of
  // re-deriving from totalModules. This prevents false NEC_690_7_VOLTAGE errors
  // caused by uneven string lengths (e.g. [8,8,7] vs an averaged 7.67).
  // Length determines string count; totalModules is still used for totals/power.
  configStringPanelCounts?: number[];
}

// A single generated string
export interface GeneratedString {
  stringIndex:    number;   // 0-based
  panelsInString: number;
  mpptChannel:    number;   // 0-based MPPT channel assignment
  vocCorrected:   number;   // Voc at design temp (V)
  vmpAtTemp:      number;   // Vmp at design temp (V)
  iscCorrected:   number;   // Isc at design temp (A)
  stringVoc:      number;   // Total string Voc (V)
  stringVmp:      number;   // Total string Vmp (V)
  stringIsc:      number;   // String Isc (A) = module Isc (strings in parallel share current)
  stringPower:    number;   // String power (W)
}

// MPPT channel summary
export interface MpptChannel {
  channelIndex:   number;
  strings:        GeneratedString[];
  totalVoc:       number;   // Max string Voc on this channel
  totalIsc:       number;   // Sum of string Isc on this channel
  totalPower:     number;   // Sum of string power on this channel
}

// Combiner/junction box type
export type CombinerType = 'DIRECT' | 'JUNCTION_BOX' | 'COMBINER_BOX';

export interface StringGeneratorResult {
  // Input echo
  totalModules:       number;
  designTempMin:      number;

  // NEC 690.7 correction
  tempCorrectionFactor: number;   // multiplier applied to Voc
  vocCorrected:         number;   // module Voc at design temp (V)
  vmpCorrected:         number;   // module Vmp at design temp (V)

  // String sizing limits
  maxPanelsPerString:   number;   // floor(inverter_max_V / vocCorrected)
  minPanelsPerString:   number;   // ceil(mppt_min_V / vmpCorrected)
  recommendedPanelsPerString: number; // optimal for MPPT center

  // Generated strings
  strings:              GeneratedString[];
  totalStrings:         number;

  // MPPT allocation
  mpptChannels:         MpptChannel[];

  // Combiner logic
  combinerType:         CombinerType;
  combinerLabel:        string;

  // System totals
  totalDcPower:         number;   // W
  totalDcVoltageMax:    number;   // Max string Voc (V)
  totalDcCurrentMax:    number;   // A — sum of topology-aware per-string design currents (v47.410)

  // NEC sizing — all values topology-aware as of v47.410
  //   String/hybrid:  derived from panel Isc × 1.25 per NEC 690.8(A)(1)
  //   Optimizer:      derived from optimizer rated output per NEC 690.8(A)(2)
  ocpdPerString:        number;   // A — NEC 690.9(B): design-current × 1.25, rounded up to standard
  dcWireAmpacity:       number;   // A — NEC 690.8(B): minimum conductor ampacity (design-current × 1.25)

  // Validation
  warnings:             string[];
  errors:               string[];
  isValid:              boolean;

  // Phase 13.4 — structured MPPT allocation result
  mpptAllocation?: {
    valid: boolean;
    violations: Array<{
      code: string;
      message: string;
      mpptIndex?: number;
      stringIds?: string[];
    }>;
    currentLimitAssumed: boolean;
  };
}

// ─── NEC standard OCPD sizes ─────────────────────────────────────────────────
const STANDARD_OCPD = [15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200];

function nextStandardOCPD(amps: number): number {
  return STANDARD_OCPD.find(s => s >= amps) ?? Math.ceil(amps / 5) * 5;
}

// ─── Main generator ──────────────────────────────────────────────────────────

export function generateStringConfig(input: StringGeneratorInput): StringGeneratorResult {
  const {
    totalModules,
    moduleSpecs,
    inverterSpecs,
    designTempMin = -10,
    necVersion = '2020',
  } = input;

  const warnings: string[] = [];
  const errors:   string[] = [];

  // ─── NEC 690.7 Temperature Correction ────────────────────────────────────
  // Voc_corrected = Voc × [1 + (tempCoeffVoc/100) × (Tmin - 25)]
  // tempCoeffVoc is in %/°C (negative value, e.g. -0.27)
  const deltaT = designTempMin - 25; // always negative for cold temps
  const tempCorrectionFactor = 1 + (moduleSpecs.tempCoeffVoc / 100) * deltaT;
  const vocCorrected = moduleSpecs.voc * tempCorrectionFactor;

  // Vmp correction (use same coefficient if tempCoeffVmp not provided)
  const tempCoeffVmp = moduleSpecs.tempCoeffVmp ?? moduleSpecs.tempCoeffVoc;
  const vmpCorrected = moduleSpecs.vmp * (1 + (tempCoeffVmp / 100) * deltaT);

  // Isc correction (slight increase at cold temps — conservative, use STC value)
  const iscCorrected = moduleSpecs.isc; // conservative: use STC Isc

  // ─── String Sizing Limits ─────────────────────────────────────────────────
  // v47.412 — Topology-aware string-length limits.
  //
  // For string / hybrid inverters, the panel-Voc × N / panel-Vmp × N math
  // below is physically correct: the entire string's open-circuit voltage
  // reaches the inverter input, so NEC 690.7 cold-temperature correction
  // gates the maximum string length.
  //
  // For OPTIMIZER systems (SolarEdge HD-Wave, Tigo TS4-A-O), each module
  // has its own DC-DC converter that regulates the string's contribution
  // independently. At SafeDC open-circuit the entire string is ~1 V/optimizer
  // (~N volts, tiny); at operation the inverter actively holds the bus at
  // a fixed voltage (typically 380–400 V for SolarEdge HD-Wave, inside its
  // 380–480 V MPPT window) regardless of panel count. Panel Voc × N is
  // therefore INAPPLICABLE — the real ceiling is the inverter's
  // brand-spec `maxPanelsPerString` (25 for SolarEdge).
  //
  // Prior to v47.412 this function was hard-wiring `maxPanelsPerString =
  // floor(480 / 45) = 10` for SolarEdge + typical module, which for 36
  // panels forced a 10/10/10/6 four-string layout. The resulting layout
  // blew the per-MPPT current budget (4 × 15.0 A on a 1 × 20.0 A channel),
  // producing a spurious MPPT_CURRENT_EXCEEDED on every optimizer system
  // with more than ~10 panels. The correct 2 × 18 layout — well within
  // SolarEdge's 25-panel/string ceiling — now flows through.
  const isOptimizer = input.topology === 'optimizer';

  // Max panels: inverter max DC voltage / corrected Voc (NEC 690.7)
  //   — bypassed for optimizer topology (Voc×N inapplicable)
  const maxPanelsPerString = isOptimizer
    ? 200  // high numeric ceiling; brand profile enforces real cap downstream
    : Math.floor(inverterSpecs.maxDcVoltage / vocCorrected);

  // Min panels: MPPT minimum voltage / corrected Vmp
  //   — bypassed for optimizer topology (bus is actively regulated)
  const minPanelsPerString = isOptimizer
    ? 1
    : Math.ceil(inverterSpecs.mpptVoltageMin / vmpCorrected);

  // Recommended: target MPPT center voltage
  const mpptCenter = (inverterSpecs.mpptVoltageMin + inverterSpecs.mpptVoltageMax) / 2;
  const recommendedPanelsPerString = Math.round(mpptCenter / moduleSpecs.vmp);

  // v47.420 — For optimizer topology the MPPT center voltage is irrelevant:
  // the optimizer regulates each module independently; string Voc/Vmp at the
  // inverter is fixed regardless of panel count. Using mpptCenter/Vmp gives a
  // tiny recommended length (e.g. round(340/65.8)=5 for a 75.6V-Voc panel on
  // a 200-480V MPPT inverter), which triggers slot-overflow and forces short
  // strings that blow the per-MPPT current cap.
  //
  // Fix: for optimizer topology, set recommended = brand maxPanelsPerString.
  // This mirrors the feasibility evaluator's "start at effectiveMax and descend"
  // strategy, producing long-string layouts that minimize string count and stay
  // within the MPPT current cap. Falls back to 25 (SolarEdge datasheet max).
  const OPTIMIZER_DEFAULT_MAX_PPS = 25;
  const optimizerRecommended = isOptimizer
    ? Math.min(
        inverterSpecs.maxPanelsPerString ?? OPTIMIZER_DEFAULT_MAX_PPS,
        OPTIMIZER_DEFAULT_MAX_PPS
      )
    : recommendedPanelsPerString;

  // Clamp recommended to valid range
  const clampedRecommended = Math.max(
    minPanelsPerString,
    Math.min(maxPanelsPerString, isOptimizer ? optimizerRecommended : recommendedPanelsPerString)
  );

  // Validate
  if (maxPanelsPerString < minPanelsPerString) {
    errors.push(
      `Inverter MPPT range incompatible with module Voc. ` +
      `Max panels/string=${maxPanelsPerString} < Min panels/string=${minPanelsPerString}. ` +
      `Check inverter MPPT voltage range vs module Voc.`
    );
  }

  if (maxPanelsPerString <= 0) {
    errors.push(`Invalid max panels per string (${maxPanelsPerString}). Check inverter max DC voltage.`);
  }

  // ─── String Distribution ──────────────────────────────────────────────────
  // Use max panels per string to minimize string count (fewer conductors)
  // Fill strings with maxPanelsPerString, last string gets remainder
  //
  // v47.419 - MPPT-current-aware string-length selection.
  //
  // The old behavior picked panelsPerFullString = min(max, recommended) where
  // recommended = round(mpptCenter / Vmp). This worked for most systems but
  // failed when the recommended length produced too many strings for the
  // inverter's aggregate MPPT current capacity. Example (user-reported 2025):
  //   Sol-Ark 8K-2P x 2 units, 36 panels, Vmp=34.5 ->
  //     recommended = round((150+425)/2 / 34.5) = round(8.33) = 8
  //   -> 36 panels / 8 = 4 full + 1 remainder of 4 = 5 strings
  //   -> 5 strings x 15.3 A design current = 76.5 A
  //   -> exceeds 4 MPPT channels x 18 A = 72 A
  //   -> MPPT_CURRENT_EXCEEDED / MPPT_ALLOCATION_INVALID
  //
  // Meanwhile the feasibility evaluator correctly picks panelsPerFullString=10
  // (gives 4 strings of [10,10,10,6] = 4 x 15.3 A = 61.3 A, fits in 72 A
  // budget) by iterating string lengths from max DESC and picking the first
  // length whose aggregate current fits.
  //
  // We replicate that search here so the sizing engine's recommendation and
  // the compliance-path string generator produce the same layout. Search
  // order: longer strings -> fewer strings -> lower total current. First pps
  // that fits both voltage AND current constraints wins. Legacy fallback
  // (use clampedRecommended) applies only when current-aware search fails
  // (e.g. missing current limits, microinverters, optimizer topology).
  const totalMpptChannelsForSearch = Math.max(1, inverterSpecs.mpptChannels);
  const maxParallelPerMpptForSearch = Math.max(1, inverterSpecs.maxParallelStringsPerMppt ?? 1);
  const totalSlotsForSearch = Math.max(1, totalMpptChannelsForSearch * maxParallelPerMpptForSearch);
  const perChannelCurrentCapForSearch = inverterSpecs.maxInputCurrentPerMppt;
  const totalCurrentBudgetForSearch =
    perChannelCurrentCapForSearch !== undefined && perChannelCurrentCapForSearch > 0
      ? perChannelCurrentCapForSearch * totalMpptChannelsForSearch
      : Number.POSITIVE_INFINITY;
  // Per-string design current - topology-aware.
  // For hybrid / string: panel Isc x 1.25 (NEC 690.8(A)(1)).
  // Optimizer topology is excluded (maxPanelsPerString=200 bypass; the
  // feasibility evaluator's optimizer path handles it separately).
  const perStringDesignCurrentForSearch = iscCorrected * 1.25;

  let panelsPerFullString = Math.min(maxPanelsPerString, clampedRecommended);
  if (
    !isOptimizer &&
    totalModules > 0 &&
    perChannelCurrentCapForSearch !== undefined &&
    perChannelCurrentCapForSearch > 0 &&
    maxPanelsPerString >= minPanelsPerString
  ) {
    for (let pps = maxPanelsPerString; pps >= minPanelsPerString; pps--) {
      const numStr = Math.ceil(totalModules / pps);
      if (numStr > totalSlotsForSearch) continue;
      const totalCurr = numStr * perStringDesignCurrentForSearch;
      if (totalCurr > totalCurrentBudgetForSearch + 1e-6) continue;
      panelsPerFullString = pps;
      break;
    }
  }
  const panelsPerFullStringFinal = panelsPerFullString > 0 ? panelsPerFullString : 1;

  // ─── v47.418 — SLOT-AWARE STRING COUNT ────────────────────────────────────
  // Root cause of "5 strings unplaced" errors: the old algorithm picked a
  // panelsPerString value based purely on voltage (NEC 690.7 cold-temp cap),
  // then computed `numFullStrings = floor(total / panelsPerString)` without
  // consulting the inverter's physical slot capacity. For a Sol-Ark 8K-2P
  // (2 MPPT × 2 parallel = 4 slots) with 45 panels at 11 max/string, it
  // produced 5 strings — one more than the inverter can accept. The MPPT
  // allocator correctly rejected the 5th string, but the user saw an error
  // instead of a valid layout.
  //
  // The fix: compute totalSlots = mpptChannels × maxParallelStringsPerMppt,
  // and if the naive voltage-bounded layout would exceed totalSlots, fall
  // back to spreading panels EVENLY across all available slots. The
  // resulting per-string panel count is then re-checked against
  // voltage-safe max; if even slot-packing can't fit the panels within
  // the voltage limit, THAT is the genuine error (inverter truly
  // undersized for this panel count).
  //
  // For the Sol-Ark 8K-2P + 45 panels example, 45 / 4 slots = 11.25, which
  // clamped to the 11-panel voltage ceiling gives a valid 4-string layout
  // of 11/11/11/12… wait — 12 exceeds voltage-safe. So the correct layout
  // is 11/11/11/12 with an ERROR if 12 violates Voc, or (better) the
  // engineer should consider a larger inverter. We surface this honestly
  // via a SLOT_CAPACITY_EXCEEDED error instead of a mysterious
  // MPPT_ALLOCATION_INVALID from the allocator downstream.
  //
  // This runs for ALL non-optimizer topologies (string + hybrid). Optimizer
  // topology already has maxPanelsPerString=200 (voltage bypass) so it's
  // not affected by voltage clamping, but it IS affected by slot counting
  // here — this is intentional: optimizer inverters also have finite
  // MPPT channels and the v47.415 operating-current branch handles the
  // current side.
  const numMpptLocal = Math.max(1, inverterSpecs.mpptChannels);
  const maxParallelPerMppt = Math.max(1, inverterSpecs.maxParallelStringsPerMppt ?? 1);
  const totalSlots = Math.max(1, numMpptLocal * maxParallelPerMppt);

  // Naive voltage-bounded layout (legacy behavior, used when it fits in slots)
  const naiveNumFullStrings = Math.floor(totalModules / panelsPerFullStringFinal);
  const naiveRemainder = totalModules % panelsPerFullStringFinal;
  const naiveTotalStrings = naiveNumFullStrings + (naiveRemainder > 0 ? 1 : 0);

  const stringPanelCounts: number[] = [];

  if (naiveTotalStrings <= totalSlots) {
    // Fits comfortably — use the legacy length-first algorithm that minimizes
    // string count and keeps conductor counts low. Preserves all existing
    // test behavior for systems where the inverter is properly sized.
    for (let i = 0; i < naiveNumFullStrings; i++) {
      stringPanelCounts.push(panelsPerFullStringFinal);
    }
    if (naiveRemainder > 0) {
      if (naiveRemainder >= minPanelsPerString) {
        stringPanelCounts.push(naiveRemainder);
      } else if (stringPanelCounts.length > 0) {
        const lastFull = stringPanelCounts[stringPanelCounts.length - 1];
        if (lastFull - 1 >= minPanelsPerString && naiveRemainder + 1 >= minPanelsPerString) {
          stringPanelCounts[stringPanelCounts.length - 1] = lastFull - 1;
          stringPanelCounts.push(naiveRemainder + 1);
        } else {
          stringPanelCounts.push(naiveRemainder);
          warnings.push(
            `Last string has ${naiveRemainder} panels which is below minimum ${minPanelsPerString}. ` +
            `Consider adjusting total module count.`
          );
        }
      } else {
        stringPanelCounts.push(naiveRemainder);
      }
    }
  } else {
    // Naive layout would exceed the inverter's physical slot count.
    // Spread panels evenly across all available slots. This is the only
    // layout the hardware can actually accept.
    const basePerSlot = Math.floor(totalModules / totalSlots);
    const extraPanels = totalModules % totalSlots;
    // Front slots get +1 panel when not divisible (e.g. 45 / 4 → 12,11,11,11).
    for (let i = 0; i < totalSlots; i++) {
      const panelsForSlot = basePerSlot + (i < extraPanels ? 1 : 0);
      if (panelsForSlot > 0) {
        stringPanelCounts.push(panelsForSlot);
      }
    }
    // Voltage-safety check: if even slot-packing exceeds the voltage-bounded
    // max (e.g. 12 panels on an inverter that only allows 11 at cold temp),
    // emit an honest error instead of letting a bad layout through.
    const maxAfterSlotPacking = Math.max(...stringPanelCounts);
    if (!isOptimizer && maxAfterSlotPacking > maxPanelsPerString) {
      errors.push(
        `SLOT_CAPACITY_EXCEEDED: ${totalModules} panels cannot fit within ` +
        `inverter's ${totalSlots} MPPT slot(s) without exceeding the ` +
        `voltage-safe max of ${maxPanelsPerString} panels/string ` +
        `(layout would require ${maxAfterSlotPacking} panels on at least one string). ` +
        `Remedies: (a) add another inverter unit to gain more MPPT slots, ` +
        `(b) select a larger inverter model with more channels, ` +
        `(c) reduce total panel count.`
      );
    }
    warnings.push(
      `String layout adjusted for MPPT slot capacity: ${totalModules} panels ` +
      `spread across ${totalSlots} slot(s) (${numMpptLocal} MPPT × ${maxParallelPerMppt} ` +
      `parallel). Layout: ${stringPanelCounts.join('/')} panels/string. ` +
      `The voltage-optimal layout (${naiveTotalStrings} strings of ` +
      `${panelsPerFullStringFinal}) was rejected because the inverter has only ` +
      `${totalSlots} physical string inputs.`
    );
  }

  // v61.7: Override stringPanelCounts with the authoritative layout from
  // config.inverters[].strings when provided. This ensures NEC 690.7 Voc
  // checks use the real per-string panel counts instead of re-derived equal
  // splits. Overrides only when the caller explicitly provides the counts.
  if (
    Array.isArray(input.configStringPanelCounts) &&
    input.configStringPanelCounts.length > 0
  ) {
    stringPanelCounts.length = 0;
    for (const c of input.configStringPanelCounts) {
      if (c > 0) stringPanelCounts.push(c);
    }
  }

  const totalStrings = stringPanelCounts.length;

  // ─── MPPT Channel Assignment ──────────────────────────────────────────────
  // Phase 13.4 — use structured allocator (pure function) instead of the
  // naive floor(idx / stringsPerMppt) grouping that silently emitted a
  // warning when channel current limits were exceeded. The allocator
  // returns a pass/fail + per-bin assignment + structured violations so
  // the compliance layer can act on real electrical failures.
  const numMppt = Math.max(1, inverterSpecs.mpptChannels);

  // v47.408 — Topology-aware per-string design current.
  //   - 'string' / 'hybrid' (and undefined): NEC 690.8(A)(1) panel method,
  //       Isc × 1.25. Correct for plain string inverters where the string
  //       conductor carries the panel's short-circuit current directly.
  //   - 'optimizer': NEC 690.8(A)(2) max-sustained-operating-current method,
  //       capped at the optimizer's rated max output current (typically
  //       15.0 A for SolarEdge P-series, 15.0 A for Tigo TS4-A-O, 30.0 A
  //       for Tigo TS4-A-2O). Optimizers regulate string voltage (~380V)
  //       and cap current at their rated max — panel Isc is irrelevant
  //       upstream of the optimizer output.
  // Default optimizer cap = 15.0 A when not specified (covers all current
  // SolarEdge + Tigo single-module optimizer SKUs).
  const topologyFamily = input.topology ?? 'string';
  const OPTIMIZER_DEFAULT_MAX_CURRENT = 15.0;
  const optimizerCap =
    input.optimizerMaxOutputCurrent && input.optimizerMaxOutputCurrent > 0
      ? input.optimizerMaxOutputCurrent
      : OPTIMIZER_DEFAULT_MAX_CURRENT;

  const designCurrentPerString =
    topologyFamily === 'optimizer'
      ? optimizerCap                      // NEC 690.8(A)(2) — regulated output
      : iscCorrected * 1.25;              // NEC 690.8(A)(1) — panel Isc method

  // v47.415 — Per-string OPERATING current for MPPT allocator feasibility.
  //
  // Research source: SolarEdge "String Sizing for SolarEdge Inverters" AppNote:
  //   "Maximum string power = Inverter Nominal DC Input Voltage
  //     × Optimizer Maximum Output Current"
  //   For SE7600H-US: 400V × 15A = 6,000W per string max.
  //
  // The optimizer's nameplate 15A is reached ONLY when the string operates
  // at its maximum power. A shorter string operates at lower current:
  //   operating current = stringPowerW / nominalDcVoltage
  // e.g. 9 panels × 400W on SE7600H (400V bus) → 3,600W / 400V = 9.0A
  //
  // Using 15A per string in the allocator (as pre-v47.415) incorrectly rejected
  // valid 2-string-per-inverter layouts because 2 × 15 = 30A > 20A cap, but the
  // actual operating current is 2 × 9 = 18A ≤ 20A.
  //
  // NOTE: This is DIFFERENT from the NEC 690.8(A)(2) conductor-sizing current
  // above (`designCurrentPerString`). That stays at 15A because the conductor
  // must handle the optimizer's rated max output regardless of steady-state
  // operating current. The allocator feasibility check uses THIS
  // `operatingCurrentPerString` instead, which matches how the inverter's
  // input-current regulation actually behaves.
  const nominalDcV =
    topologyFamily === 'optimizer' && inverterSpecs.nominalDcVoltage && inverterSpecs.nominalDcVoltage > 0
      ? inverterSpecs.nominalDcVoltage
      : (inverterSpecs.mpptVoltageMin + inverterSpecs.mpptVoltageMax) / 2;

  const operatingCurrentPerStringFor = (stringPanelCount: number): number => {
    if (topologyFamily !== 'optimizer') return designCurrentPerString;
    const stringPowerW = stringPanelCount * moduleSpecs.watts;
    const operating = stringPowerW / Math.max(nominalDcV, 1e-6);
    return Math.min(optimizerCap, operating);
  };

  const allocatorStrings: AllocatorString[] = stringPanelCounts.map((pc, idx) => ({
    id: String(idx),
    panelCount: pc,
    voc: vocCorrected * pc,
    isc: iscCorrected,
    // v47.415 — allocator uses operating current, not NEC conductor cap.
    designCurrent: operatingCurrentPerStringFor(pc),
  }));

  const allocation = distributeStringsAcrossMpptsSafely({
    strings: allocatorStrings,
    mpptCount: numMppt,
    mpptMaxInputCurrent: inverterSpecs.maxInputCurrentPerMppt,
    maxParallelStringsPerMppt: inverterSpecs.maxParallelStringsPerMppt ?? 1,
  });

  const assignedMppt = new Map<string, number>();
  for (const bin of allocation.allocation) {
    for (const sid of bin.stringIds) {
      assignedMppt.set(sid, bin.mpptIndex);
    }
  }

  // Surface allocator violations as structured errors/warnings.
  // MPPT_CURRENT_EXCEEDED and MPPT_ALLOCATION_INVALID are hard electrical
  // failures (→ errors[] → isValid=false). MPPT_CURRENT_UNKNOWN and
  // MPPT_PARALLEL_CAP_EXCEEDED land in warnings[] (advisory).
  //
  // v47.421 — When the failure is MPPT_CURRENT_EXCEEDED (the panel draws
  // more current per string than the inverter's MPPT channels can handle),
  // enrich the error message with an actionable list of compatible panels
  // from the equipment registry. This turns an unactionable error code
  // ("switch to a panel with lower Isc") into a concrete remediation path
  // ("switch to Panasonic EVERVOLT 410W or SunPower Maxeon 6 400W").
  // The list is computed ONCE per generator call and reused across any
  // duplicate MPPT_CURRENT_EXCEEDED violations.
  let cachedPanelClause: string | null = null;
  const resolvePanelClause = (): string => {
    if (cachedPanelClause !== null) return cachedPanelClause;
    const cap = inverterSpecs.maxInputCurrentPerMppt;
    if (!cap) { cachedPanelClause = ''; return ''; }
    const suggestions = findCompatiblePanels(cap);
    cachedPanelClause = formatCompatiblePanelClause(suggestions, 3);
    return cachedPanelClause;
  };

  for (const v of allocation.violations) {
    let line = `[MPPT] ${v.code}: ${v.message}`;
    if (v.code === 'MPPT_CURRENT_EXCEEDED') {
      // Append compatible-panel clause, but only if the current panel is
      // actually the root cause (it usually is). Safe to always append —
      // if findCompatiblePanels returns nothing, the clause is empty.
      line += resolvePanelClause();
      errors.push(line);
    } else if (v.code === 'MPPT_ALLOCATION_INVALID') {
      errors.push(line);
    } else {
      warnings.push(line);
    }
  }

  // ─── Build Generated Strings ──────────────────────────────────────────────
  const generatedStrings: GeneratedString[] = stringPanelCounts.map((panelCount, idx) => {
    // Use allocator's channel assignment when placed. Unplaced strings
    // default to channel 0 for display; the errors[] list already
    // contains the structured MPPT failure so isValid=false downstream.
    const mpptChannel = assignedMppt.get(String(idx)) ?? 0;
    const stringVoc = vocCorrected * panelCount;
    const stringVmp = vmpCorrected * panelCount;
    const stringPower = moduleSpecs.watts * panelCount;

    // v47.412 — Topology-aware per-string voltage validation.
    // Panel-Voc × N and panel-Vmp × N are inapplicable to optimizer
    // systems: the optimizers regulate each module's contribution and the
    // inverter actively holds the DC bus inside its MPPT window
    // (~380–400 V for SolarEdge HD-Wave) regardless of panel count.
    // For string / hybrid inverters these checks remain the real
    // NEC 690.7 / MPPT-range gates.
    if (!isOptimizer) {
      if (stringVoc > inverterSpecs.maxDcVoltage) {
        errors.push(
          `String ${idx + 1}: Voc=${stringVoc.toFixed(1)}V exceeds inverter max ${inverterSpecs.maxDcVoltage}V. ` +
          `Reduce panels per string.`
        );
      }
      if (stringVmp < inverterSpecs.mpptVoltageMin) {
        warnings.push(
          `String ${idx + 1}: Vmp=${stringVmp.toFixed(1)}V is below MPPT minimum ${inverterSpecs.mpptVoltageMin}V.`
        );
      }
      if (stringVmp > inverterSpecs.mpptVoltageMax) {
        warnings.push(
          `String ${idx + 1}: Vmp=${stringVmp.toFixed(1)}V exceeds MPPT maximum ${inverterSpecs.mpptVoltageMax}V.`
        );
      }
    }

    return {
      stringIndex:    idx,
      panelsInString: panelCount,
      mpptChannel:    Math.min(mpptChannel, numMppt - 1),
      vocCorrected,
      vmpAtTemp:      vmpCorrected,
      iscCorrected,
      stringVoc,
      stringVmp,
      // v47.410 — Topology-aware string current (single source of truth).
      //   Prior to v47.410, stringIsc was always panel Isc. After v47.410,
      //   stringIsc reflects the actual per-string conductor design current:
      //     - 'string' / 'hybrid' (panel method):  Isc × 1.25 per NEC 690.8(A)(1)
      //     - 'optimizer':                         optimizer rated output cap
      //                                            per NEC 690.8(A)(2)
      //   This value is now the basis for ocpdPerString, dcWireAmpacity, and
      //   totalDcCurrentMax below — every downstream consumer (SLD, permit PDF,
      //   wire autosizer, compliance UI) gets topology-correct numbers without
      //   needing its own branch.
      stringIsc:      designCurrentPerString,
      stringPower,
    };
  });

  // ─── MPPT Channel Summary ─────────────────────────────────────────────────
  const mpptChannelMap = new Map<number, GeneratedString[]>();
  for (let i = 0; i < numMppt; i++) mpptChannelMap.set(i, []);
  for (const s of generatedStrings) {
    mpptChannelMap.get(s.mpptChannel)!.push(s);
  }

  const mpptChannels: MpptChannel[] = Array.from(mpptChannelMap.entries()).map(([idx, strings]) => ({
    channelIndex: idx,
    strings,
    totalVoc:   strings.length > 0 ? strings[0].stringVoc : 0,
    totalIsc:   strings.reduce((sum, s) => sum + s.stringIsc, 0),
    totalPower: strings.reduce((sum, s) => sum + s.stringPower, 0),
  }));

  // ─── Combiner Box Logic ───────────────────────────────────────────────────
  let combinerType: CombinerType;
  let combinerLabel: string;

  if (totalStrings <= 2) {
    combinerType = 'DIRECT';
    combinerLabel = 'Direct inverter connection';
  } else if (totalStrings <= 6) {
    combinerType = 'JUNCTION_BOX';
    combinerLabel = `Roof junction box (${totalStrings} strings)`;
  } else {
    combinerType = 'COMBINER_BOX';
    combinerLabel = `Combiner box (${totalStrings} strings)`;
  }

  // ─── System Totals ────────────────────────────────────────────────────────
  const totalDcPower = generatedStrings.reduce((sum, s) => sum + s.stringPower, 0);
  const totalDcVoltageMax = generatedStrings.length > 0
    ? Math.max(...generatedStrings.map(s => s.stringVoc))
    : 0;
  const totalDcCurrentMax = generatedStrings.reduce((sum, s) => sum + s.stringIsc, 0);

  // ─── NEC 690.8/690.9 OCPD + Conductor Sizing ──────────────────────────────
  // v47.410 — Both values now derive from `designCurrentPerString`, which is
  // itself topology-aware (panel Isc × 1.25 for string/hybrid, optimizer cap
  // for optimizer systems). This replaces the prior panel-only computation so
  // that SolarEdge/Tigo optimizer systems size OCPD and DC conductors against
  // the regulated 15.0 A output (NEC 690.8(A)(2)) rather than the upstream
  // panel Isc, which is irrelevant upstream of the optimizer.
  //
  //   OCPD per NEC 690.9(B):
  //     max-circuit-current × 1.25, rounded up to next standard size
  //     For string/hybrid: designCurrentPerString already includes the 1.25
  //     continuous-duty factor (Isc × 1.25), so the second × 1.25 here is
  //     the 690.9(B) 125 % sizing factor. For optimizer: designCurrentPerString
  //     is the regulated max output, so × 1.25 applies the 690.9(B) factor
  //     directly — correct either way.
  //
  //   DC conductor ampacity per NEC 690.8(B):
  //     max-circuit-current × 1.25 (continuous-duty adjustment)
  //     Same logic: the 1.25 factor here is 690.8(B) continuous-duty, applied
  //     consistently to the topology-correct design current.
  const ocpdRaw = designCurrentPerString * 1.25;
  const ocpdPerString = nextStandardOCPD(ocpdRaw);

  const dcWireAmpacity = designCurrentPerString * 1.25;

  // ─── Additional Warnings ──────────────────────────────────────────────────
  if (totalStrings > numMppt * 3) {
    warnings.push(
      `${totalStrings} strings across ${numMppt} MPPT channels (${Math.ceil(totalStrings/numMppt)} per channel). ` +
      `Consider a larger inverter or multiple inverters.`
    );
  }

  // v47.407: Suppress DC/AC advisory when MPPT allocation has already failed.
  // The MPPT-current / allocation-invalid errors mean the array cannot fit on
  // this inverter at all — telling the user "system may be undersized, add
  // panels" directly contradicts "too many strings, inverter rejected them".
  // Show DC/AC only when allocation is valid (or only soft violations remain).
  const mpptAllocationFailed = allocation.violations.some(
    (v) =>
      v.code === 'MPPT_CURRENT_EXCEEDED' ||
      v.code === 'MPPT_ALLOCATION_INVALID',
  );

  const dcPowerRatio = totalDcPower / (inverterSpecs.acOutputKw * 1000);
  if (!mpptAllocationFailed) {
    if (dcPowerRatio > 1.5) {
      warnings.push(
        `DC/AC ratio is ${dcPowerRatio.toFixed(2)}. Recommended max is 1.5. ` +
        `Consider reducing module count or using a larger inverter.`
      );
    } else if (dcPowerRatio < 1.0) {
      warnings.push(
        `DC/AC ratio is ${dcPowerRatio.toFixed(2)}. Recommended minimum is 1.0. ` +
        `System may be undersized for the inverter.`
      );
    }
  }

  return {
    totalModules,
    designTempMin,
    tempCorrectionFactor,
    vocCorrected,
    vmpCorrected,
    maxPanelsPerString,
    minPanelsPerString,
    recommendedPanelsPerString: clampedRecommended,
    strings: generatedStrings,
    totalStrings,
    mpptChannels,
    combinerType,
    combinerLabel,
    totalDcPower,
    totalDcVoltageMax,
    totalDcCurrentMax,
    ocpdPerString,
    dcWireAmpacity,
    warnings,
    errors,
    isValid: errors.length === 0,
    mpptAllocation: {
      valid: allocation.valid,
      violations: allocation.violations.map(v => ({
        code: v.code,
        message: v.message,
        mpptIndex: v.mpptIndex,
        stringIds: v.stringIds,
      })),
      currentLimitAssumed: allocation.meta.currentLimitAssumed,
    },
  };
}

// ─── Helper: build ModuleSpecs from registry ElectricalSpecs ─────────────────
export function moduleSpecsFromRegistry(specs: {
  voc?: number; vmp?: number; isc?: number; imp?: number;
  watts?: number; tempCoeffVoc?: number; tempCoeffVmp?: number;
  maxSeriesFuseRating?: number;
}): ModuleSpecs {
  return {
    voc:           specs.voc           ?? 49.6,
    vmp:           specs.vmp           ?? 41.8,
    isc:           specs.isc           ?? 10.18,
    imp:           specs.imp           ?? 9.57,
    watts:         specs.watts         ?? 400,
    tempCoeffVoc:  specs.tempCoeffVoc  ?? -0.27,
    tempCoeffVmp:  specs.tempCoeffVmp,
    maxSeriesFuse: specs.maxSeriesFuseRating ?? 20,
  };
}

// ─── Helper: build InverterSpecs from registry ElectricalSpecs ───────────────
export function inverterSpecsFromRegistry(specs: {
  maxDcVoltage?: number; mpptVoltageMin?: number; mpptVoltageMax?: number;
  mpptChannels?: number; maxInputCurrent?: number; dcInputKwMax?: number;
  acOutputKw?: number;
  maxParallelStringsPerMppt?: number;
  /** v47.415 — fixed DC bus voltage for optimizer topology (e.g. SE HD-Wave 400V). */
  nominalDcVoltage?: number;
  /** v47.420 — brand profile ceiling for optimizer topology string length. */
  maxPanelsPerString?: number;
}): InverterSpecs {
  return {
    maxDcVoltage:               specs.maxDcVoltage       ?? 600,
    mpptVoltageMin:             specs.mpptVoltageMin      ?? 100,
    mpptVoltageMax:             specs.mpptVoltageMax      ?? 600,
    mpptChannels:               specs.mpptChannels        ?? 2,
    maxInputCurrentPerMppt:     specs.maxInputCurrent,
    maxParallelStringsPerMppt:  specs.maxParallelStringsPerMppt,
    nominalDcVoltage:           specs.nominalDcVoltage,
    dcInputKwMax:               specs.dcInputKwMax,
    acOutputKw:                 specs.acOutputKw          ?? 8.2,
    maxPanelsPerString:         specs.maxPanelsPerString,
  };
}

// ─── Helper: format string config for display ─────────────────────────────────
export function formatStringConfigSummary(result: StringGeneratorResult): string {
  const lines: string[] = [
    `${result.totalStrings} strings × ${result.strings[0]?.panelsInString ?? '?'} panels`,
  ];
  if (result.strings.some(s => s.panelsInString !== result.strings[0]?.panelsInString)) {
    const counts = result.strings.map(s => s.panelsInString);
    lines[0] = counts.join(' + ') + ' panels';
  }
  lines.push(`Voc (corrected): ${result.vocCorrected.toFixed(1)}V/module`);
  lines.push(`String Voc: ${result.strings[0]?.stringVoc.toFixed(1) ?? '?'}V`);
  lines.push(`MPPT: ${result.mpptChannels.length} channels`);
  lines.push(`Combiner: ${result.combinerLabel}`);
  return lines.join(' | ');
}