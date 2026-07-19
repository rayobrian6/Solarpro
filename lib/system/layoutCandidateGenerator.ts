// ============================================================================
// lib/system/layoutCandidateGenerator.ts — CORE ENGINEERING BRAIN — Phase 3
//
// LAYOUT CANDIDATE GENERATOR
//
// Produces ALL electrically-valid LayoutCandidate objects for a given system
// load, using CapabilityProfiles from brandCapabilities/.
//
// PIPELINE (one pass per profile × qty combination):
//   1. Determine candidate inverter quantities (1 to MAX_INVERTER_UNITS).
//   2. For each (profile, qty) pair:
//      a. Compute DC/AC ratio — reject if outside profile.dcAcRatioRange.
//      b. Topology dispatch:
//         - 'optimizer' → runOptimizerRules()
//         - 'micro'     → runMicroRules()
//         - 'string'    → runStringRules()
//         - 'hybrid'    → runStringRules() (hybrid uses same string logic)
//      c. If rules return a valid layout → build LayoutCandidate.
//      d. If rules return failures → record in rejected list.
//   3. Score all feasible candidates via scoreLayoutCandidate().
//   4. Sort by score descending.
//   5. Return LayoutGeneratorOutput.
//
// DESIGN RULES:
//   ✅ Pure function — no React, no I/O, no side effects.
//   ✅ Never recommends infeasible candidates.
//   ✅ Never hardcodes brand preferences (driven by CapabilityProfiles).
//   ✅ Reuses layoutScoring.ts for all scoring decisions.
//   ✅ Topology rule functions are co-located in this file (Phases 4–6).
// ============================================================================

import type {
  CapabilityProfile,
  LayoutCandidate,
  LayoutGeneratorInput,
  LayoutGeneratorOutput,
  StringLayoutPlan,
  BranchLayoutPlan,
  BosHint,
  ScoreBreakdown,
} from './inverterCapabilities';
import { scoreLayoutCandidate } from './layoutScoring';
import { nextStandardOcpd } from '@/lib/electrical/stdSizes';

// ─── Generator Version ───────────────────────────────────────────────────────
const GENERATOR_VERSION = '3.0.0';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Maximum inverter units per configuration.
 *  Keeps candidate explosion manageable; 3 covers virtually all residential. */
const MAX_INVERTER_UNITS = 3;

// ─── Main Entry Point ────────────────────────────────────────────────────────

/**
 * Generate all feasible LayoutCandidates for the given system input
 * from the provided set of CapabilityProfiles.
 *
 * @param profiles - Profiles to evaluate (typically from brandCapabilities/).
 * @param input    - System sizing parameters.
 * @returns        - LayoutGeneratorOutput with scored+sorted candidates.
 */
export function generateLayoutCandidates(
  profiles: CapabilityProfile[],
  input: LayoutGeneratorInput,
): LayoutGeneratorOutput {
  const candidates: LayoutCandidate[] = [];
  const rejected: LayoutGeneratorOutput['rejected'] = [];
  let profilesEvaluated = 0;
  let candidatesGenerated = 0;
  let candidatesRejected = 0;

  for (const profile of profiles) {
    // If a specific inverter is requested, skip all others.
    if (input.selectedInverterId && profile.equipmentDbId !== input.selectedInverterId) {
      continue;
    }
    // If a topology filter is set, skip mismatches.
    if (input.topologyFilter && profile.topology !== input.topologyFilter) {
      continue;
    }

    profilesEvaluated++;

    // Determine the range of unit counts to try.
    // For micro topology: qty is fixed by panel count / modulesPerDevice.
    // We compute the exact required qty and only try that one value.
    // For string/optimizer: try 1 to MAX_INVERTER_UNITS.
    let qtysToTry: number[];
    if (profile.topology === 'micro' && profile.branchCircuit) {
      const mpd = profile.branchCircuit.modulesPerDevice;
      const requiredQty = Math.ceil(input.panelCount / mpd);
      qtysToTry = [requiredQty];
    } else {
      qtysToTry = Array.from({ length: MAX_INVERTER_UNITS }, (_, i) => i + 1);
    }

    for (const qty of qtysToTry) {
      const totalAcKw = profile.acKw * qty;
      const dcAcRatio = input.totalDcKw / totalAcKw;

      // ── DC/AC ratio hard gate ────────────────────────────────────────────
      if (dcAcRatio < profile.dcAcRatioRange.min || dcAcRatio > profile.dcAcRatioRange.max) {
        const belowFloor = dcAcRatio < profile.dcAcRatioRange.min;
        rejected.push({
          profile,
          inverterQty: qty,
          failureReasons: [
            belowFloor
              ? `DC/AC ratio ${dcAcRatio.toFixed(3)} below minimum ${profile.dcAcRatioRange.min} ` +
                `(totalDcKw=${input.totalDcKw.toFixed(2)}, totalAcKw=${totalAcKw.toFixed(2)})`
              : `DC/AC ratio ${dcAcRatio.toFixed(3)} above maximum ${profile.dcAcRatioRange.max} ` +
                `(totalDcKw=${input.totalDcKw.toFixed(2)}, totalAcKw=${totalAcKw.toFixed(2)})`,
          ],
        });
        candidatesRejected++;
        continue;
      }

      // ── Topology dispatch ────────────────────────────────────────────────
      let result: TopologyResult;

      switch (profile.topology) {
        case 'optimizer':
          result = runOptimizerRules(profile, input, qty);
          break;
        case 'micro':
          result = runMicroRules(profile, input, qty);
          break;
        case 'string':
        case 'hybrid':
          result = runStringRules(profile, input, qty);
          break;
        default: {
          const _exhaustive: never = profile.topology;
          result = {
            feasible: false,
            failures: [`Unknown topology: ${String(_exhaustive)}`],
            stringLayout: null,
            branchLayout: null,
            validationNotes: [],
          };
        }
      }

      if (!result.feasible) {
        rejected.push({
          profile,
          inverterQty: qty,
          failureReasons: result.failures,
        });
        candidatesRejected++;
        continue;
      }

      // ── Build LayoutCandidate ────────────────────────────────────────────
      const bos = buildBosHints(profile, result);
      const candidate: LayoutCandidate = {
        key: `${profile.equipmentDbId}×${qty}@${dcAcRatio.toFixed(2)}`,
        profile,
        inverterQty: qty,
        totalAcKw,
        totalDcKw: input.totalDcKw,
        panelCount: input.panelCount,
        panelWattage: input.panelWattage,
        dcAcRatio,
        stringLayout: result.stringLayout,
        branchLayout: result.branchLayout,
        feasible: true,
        validationNotes: result.validationNotes,
        score: 0,
        scoreBreakdown: null,
        bos,
        selectionRationale: '',
        generatorVersion: GENERATOR_VERSION,
      };

      // ── Score the candidate ──────────────────────────────────────────────
      const scored = scoreLayoutCandidate(candidate);
      candidate.score = scored.total;
      candidate.scoreBreakdown = scored;
      candidate.selectionRationale = buildRationale(candidate, scored);

      candidates.push(candidate);
      candidatesGenerated++;
    }
  }

  // Sort by score descending, tie-break by equipmentDbId for determinism.
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.profile.equipmentDbId.localeCompare(b.profile.equipmentDbId);
  });

  return {
    candidates,
    recommended: candidates[0] ?? null,
    rejected,
    meta: {
      profilesEvaluated,
      candidatesGenerated,
      candidatesRejected,
      generatorVersion: GENERATOR_VERSION,
    },
  };
}

// ─── Topology Result Shape ────────────────────────────────────────────────────

interface TopologyResult {
  feasible: boolean;
  failures: string[];
  stringLayout: StringLayoutPlan | null;
  branchLayout: BranchLayoutPlan | null;
  validationNotes: string[];
}

// ============================================================================
// PHASE 4 — OPTIMIZER TOPOLOGY RULES (SolarEdge)
// ============================================================================

/**
 * Validates and lays out an optimizer-topology configuration.
 *
 * KEY DIFFERENCES FROM STRING TOPOLOGY:
 *   - Per-string design current = optimizerMaxOutputCurrent (15A regulated)
 *     NOT panelIsc × 1.25. This is NEC 690.8(A)(2).
 *   - String Voc at inverter = optimizer bus voltage, not raw panel Voc.
 *   - SolarEdge HD-Wave: 1 MPPT channel, 1 string per MPPT.
 *     All panels land on a single string (up to maxPanelsPerString=25).
 *
 * ALGORITHM:
 *   1. Determine panels per inverter unit = ceil(totalPanels / qty).
 *   2. Validate panelsPerUnit ∈ [minPPS, maxPPS].
 *   3. Build StringLayoutPlan — one MPPT, one string.
 *   4. If panelVoc + tempCoeff available: compute string Voc and validate
 *      against MPPT maxDcVoltage (NEC 690.7 check).
 */
function runOptimizerRules(
  profile: CapabilityProfile,
  input: LayoutGeneratorInput,
  qty: number,
): TopologyResult {
  const failures: string[] = [];
  const notes: string[] = [];

  if (profile.mpptChannels.length === 0) {
    return { feasible: false, failures: ['Optimizer profile has no MPPT channels defined.'], stringLayout: null, branchLayout: null, validationNotes: [] };
  }

  const mppt = profile.mpptChannels[0]; // SolarEdge HD-Wave: single MPPT per inverter unit
  const panelsPerUnit = Math.ceil(input.panelCount / qty);

  // ── Find a valid string layout for this MPPT ─────────────────────────────
  // For optimizer topology, the MPPT input accepts:
  //   - 1 string of up to maxPanelsPerString panels (single string)
  //   - 2+ parallel strings of shorter length (parallel optimizer strings)
  // Try the minimum number of parallel strings that fits within maxPanelsPerString.
  // Use findStringLayout() which handles the current check too.
  const layoutAttempt = findStringLayout(
    mppt,
    panelsPerUnit,
    input,
    'optimizer',
    0,
  );

  if (!layoutAttempt.feasible) {
    failures.push(...layoutAttempt.failures);
    return { feasible: false, failures, stringLayout: null, branchLayout: null, validationNotes: notes };
  }

  const parallelStrings = layoutAttempt.parallelStrings!;
  const panelsPerString = layoutAttempt.panelsPerString!;

  // ── Compute string voltage if panel specs available ──────────────────────
  let stringVoc: number | undefined;
  let stringVmpMin: number | undefined;

  if (input.panelVoc != null && input.panelTempCoeffVoc != null) {
    const designTemp = input.designTempMin ?? -10;
    // For optimizer topology: inverter sees optimizer-regulated bus voltage.
    // Use raw panel Voc for NEC safety check (worst-case, even with optimizer).
    const tempDelta = designTemp - 25;
    const vocAtDesignTemp = input.panelVoc * (1 + (input.panelTempCoeffVoc / 100) * tempDelta);
    stringVoc = vocAtDesignTemp * panelsPerString;

    if (stringVoc > mppt.maxDcVoltage) {
      failures.push(
        `String Voc (${stringVoc.toFixed(1)}V) exceeds inverter max DC voltage (${mppt.maxDcVoltage}V) ` +
        `for ${panelsPerString} panels/string × ${vocAtDesignTemp.toFixed(2)}V/panel at ${designTemp}°C. NEC 690.7.`,
      );
    }

    if (input.panelVmp != null) {
      const tempDeltaMax = 75 - 25; // worst-case hot: 75 C operating cell temp
      const vmpCoeff = input.panelTempCoeffVmp ?? input.panelTempCoeffVoc;
      const vmpAtHot = input.panelVmp * (1 + (vmpCoeff / 100) * tempDeltaMax);
      stringVmpMin = vmpAtHot * panelsPerString;

      if (stringVmpMin < mppt.mpptVoltageMin) {
        notes.push(
          `String Vmp at high temp (${stringVmpMin.toFixed(1)}V) is below MPPT min (${mppt.mpptVoltageMin}V). ` +
          `Production may be reduced in hot weather.`,
        );
      }
    }
  }

  if (failures.length > 0) {
    return { feasible: false, failures, stringLayout: null, branchLayout: null, validationNotes: notes };
  }

  // ── Build StringLayoutPlan ───────────────────────────────────────────────
  const totalPanelsOnMppt = parallelStrings * panelsPerString;
  const stringsAreBalanced = totalPanelsOnMppt === panelsPerUnit;

  const stringLayout: StringLayoutPlan = {
    mpptAllocations: [{
      mpptIndex: 0,
      parallelStrings,
      panelsPerString,
      totalPanels: totalPanelsOnMppt,
      stringVoc,
      stringVmpMin,
    }],
    totalPanels: panelsPerUnit,
    stringsAreBalanced,
  };

  const totalPanelsCheck = panelsPerUnit * qty;
  if (totalPanelsCheck !== input.panelCount) {
    notes.push(
      `Panel distribution: ${qty} × ${panelsPerUnit} = ${totalPanelsCheck} ` +
      `(input: ${input.panelCount}). Rounding applied.`,
    );
  }

  notes.push(
    `Optimizer layout: ${qty}x${profile.equipmentDbId}, ` +
    `${panelsPerString} panels/string × ${parallelStrings} string(s) per MPPT.`,
  );

  return {
    feasible: true,
    failures: [],
    stringLayout,
    branchLayout: null,
    validationNotes: notes,
  };
}

// ============================================================================
// PHASE 5 — MICRO TOPOLOGY RULES (Enphase)
// ============================================================================

/**
 * Validates and lays out a micro-inverter topology configuration.
 *
 * KEY RULE: One micro unit per panel (or per modulesPerDevice panels).
 * There are no DC strings — validation focuses on AC branch circuit loading.
 *
 * ALGORITHM:
 *   1. totalUnits = ceil(panelCount / modulesPerDevice).
 *   2. qty == totalUnits (forced — micro qty IS determined by panel count).
 *      If qty != totalUnits, this combination is infeasible (skip to avoid
 *      generating redundant candidates).
 *   3. Distribute units across branches: ceil(totalUnits / maxMicrosPerBranch).
 *   4. Build BranchLayoutPlan.
 */
function runMicroRules(
  profile: CapabilityProfile,
  input: LayoutGeneratorInput,
  qty: number,
): TopologyResult {
  const failures: string[] = [];
  const notes: string[] = [];

  if (!profile.branchCircuit) {
    return {
      feasible: false,
      failures: ['Micro profile has no branchCircuit spec defined.'],
      stringLayout: null, branchLayout: null, validationNotes: [],
    };
  }

  const bc = profile.branchCircuit;
  const mpd = bc.modulesPerDevice;
  const totalUnits = Math.ceil(input.panelCount / mpd);

  // Only accept qty == totalUnits (micro qty is fixed by panel count).
  if (qty !== totalUnits) {
    return {
      feasible: false,
      failures: [
        `Micro qty must equal totalUnits (${totalUnits}) for ${input.panelCount} panels ` +
        `with modulesPerDevice=${mpd}. Got qty=${qty}.`,
      ],
      stringLayout: null, branchLayout: null, validationNotes: [],
    };
  }

  // ── Branch distribution ──────────────────────────────────────────────────
  const branchCount = Math.ceil(totalUnits / bc.maxMicrosPerBranch);
  const baseUnitsPerBranch = Math.floor(totalUnits / branchCount);
  const remainder = totalUnits % branchCount;

  // Distribute evenly: first `remainder` branches get one extra unit.
  const unitsPerBranch: number[] = Array.from({ length: branchCount }, (_, i) =>
    i < remainder ? baseUnitsPerBranch + 1 : baseUnitsPerBranch,
  );
  const panelsPerBranch = unitsPerBranch.map(u => u * mpd);

  // ── Branch OCPD sizing ───────────────────────────────────────────────────
  const maxUnitsOnAnyBranch = Math.max(...unitsPerBranch);
  const branchLoadAmps = maxUnitsOnAnyBranch * bc.acOutputCurrentPerUnit;
  // NEC 80% rule: OCPD ≥ branchLoad / 0.8.
  const rawOcpd = branchLoadAmps / 0.8;
  // Round up to nearest standard breaker size.
  const branchOcpdAmps = standardBreakerSize(rawOcpd);

  const branchesAreBalanced = new Set(unitsPerBranch).size === 1;

  if (!branchesAreBalanced) {
    notes.push(
      `Branch distribution: ${branchCount} branches, ` +
      `${unitsPerBranch.join('/')} units per branch. ` +
      `${input.panelCount} panels not evenly divisible by ${bc.maxMicrosPerBranch}.`,
    );
  } else {
    notes.push(
      `Branch layout: ${branchCount} branches × ${baseUnitsPerBranch} units each. ` +
      `${branchOcpdAmps}A OCPD per branch.`,
    );
  }

  const branchLayout: BranchLayoutPlan = {
    branchCount,
    unitsPerBranch,
    totalUnits,
    panelsPerBranch,
    branchOcpdAmps,
    branchesAreBalanced,
  };

  return {
    feasible: true,
    failures: [],
    stringLayout: null,
    branchLayout,
    validationNotes: notes,
  };
}

// ============================================================================
// PHASE 6 — STRING TOPOLOGY RULES (SMA, Fronius, generic-string, hybrid)
// ============================================================================

/**
 * Validates and lays out a string-inverter topology configuration.
 *
 * KEY RULES (NEC 690.8(A)(1)):
 *   - Design current = panelIsc × 1.25 (panel method, not optimizer-regulated).
 *   - Parallel strings per MPPT limited by maxInputCurrentPerMppt.
 *   - String Voc must not exceed maxDcVoltage at design min temp.
 *   - String Vmp must not fall below mpptVoltageMin at design max temp.
 *
 * ALGORITHM (per inverter unit):
 *   1. Panels per unit = ceil(panelCount / qty).
 *   2. Distribute panels across MPPT channels.
 *   3. For each MPPT:
 *      a. Target 1 string per MPPT initially (simplest wiring).
 *      b. If panelsPerString > maxPPS: check if parallel strings help.
 *         - Try 2 parallel shorter strings: 2 × ceil(panels/2).
 *         - Validate design current for parallel strings.
 *      c. Validate string Voc (if specs available).
 *   4. Build StringLayoutPlan.
 */
function runStringRules(
  profile: CapabilityProfile,
  input: LayoutGeneratorInput,
  qty: number,
): TopologyResult {
  const failures: string[] = [];
  const notes: string[] = [];

  if (profile.mpptChannels.length === 0) {
    return {
      feasible: false,
      failures: ['String profile has no MPPT channels defined.'],
      stringLayout: null, branchLayout: null, validationNotes: [],
    };
  }

  const panelsPerUnit = Math.ceil(input.panelCount / qty);
  const mpptCount = profile.mpptChannels.length;

  // ── Distribute panels across MPPT channels ───────────────────────────────
  // Equal distribution: each MPPT gets floor(panelsPerUnit / mpptCount) panels,
  // with remainder distributed to first MPPTs.
  const basePanelsPerMppt = Math.floor(panelsPerUnit / mpptCount);
  const mpptRemainder = panelsPerUnit % mpptCount;

  const mpptAllocations: StringLayoutPlan['mpptAllocations'] = [];
  let allBalanced = true;
  const panelsPerMpptArray: number[] = [];

  for (let i = 0; i < mpptCount; i++) {
    const mppt = profile.mpptChannels[i];
    const panelsOnThisMppt = basePanelsPerMppt + (i < mpptRemainder ? 1 : 0);
    panelsPerMpptArray.push(panelsOnThisMppt);

    if (panelsOnThisMppt === 0) {
      // Unused MPPT channel — skip.
      continue;
    }

    // ── Try string configurations for this MPPT ──────────────────────────
    // Strategy: find the best (parallelStrings, panelsPerString) that:
    //   1. Fits panelsOnThisMppt = parallelStrings × panelsPerString
    //   2. panelsPerString ∈ [minPPS, maxPPS]
    //   3. Design current ≤ maxInputCurrentPerMppt
    //   4. Minimizes imbalance (prefer equal parallel strings)

    const layoutResult = findStringLayout(
      mppt,
      panelsOnThisMppt,
      input,
      profile.topology,
      i,
    );

    if (!layoutResult.feasible) {
      failures.push(...layoutResult.failures);
      continue;
    }

    if (layoutResult.parallelStrings! > 1) {
      allBalanced = false;
    }

    // ── Compute string voltages if specs available ───────────────────────
    let stringVoc: number | undefined;
    let stringVmpMin: number | undefined;

    if (input.panelVoc != null && input.panelTempCoeffVoc != null) {
      const designTemp = input.designTempMin ?? -10;
      const tempDelta = designTemp - 25;
      const vocAtDesignTemp = input.panelVoc * (1 + (input.panelTempCoeffVoc / 100) * tempDelta);
      stringVoc = vocAtDesignTemp * layoutResult.panelsPerString!;

      if (stringVoc > mppt.maxDcVoltage) {
        failures.push(
          `MPPT${i}: String Voc (${stringVoc.toFixed(1)}V) exceeds max DC voltage ` +
          `(${mppt.maxDcVoltage}V) at ${designTemp}°C. ` +
          `Reduce string length or use shorter strings. NEC 690.7.`,
        );
      }

      if (input.panelVmp != null) {
        const tempDeltaMax = 75 - 25;
        const vmpCoeff = input.panelTempCoeffVmp ?? input.panelTempCoeffVoc;
        const vmpAtHot = input.panelVmp * (1 + (vmpCoeff / 100) * tempDeltaMax);
        stringVmpMin = vmpAtHot * layoutResult.panelsPerString!;

        if (stringVmpMin < mppt.mpptVoltageMin) {
          notes.push(
            `MPPT${i}: String Vmp at max temp (${stringVmpMin.toFixed(1)}V) below ` +
            `MPPT minimum (${mppt.mpptVoltageMin}V). Production loss in hot weather.`,
          );
        }
      }
    }

    mpptAllocations.push({
      mpptIndex: i,
      parallelStrings: layoutResult.parallelStrings!,
      panelsPerString: layoutResult.panelsPerString!,
      totalPanels: panelsOnThisMppt,
      stringVoc,
      stringVmpMin,
    });
  }

  if (failures.length > 0) {
    return { feasible: false, failures, stringLayout: null, branchLayout: null, validationNotes: notes };
  }

  // ── Verify all panels accounted for ─────────────────────────────────────
  const totalAccountedPanels = mpptAllocations.reduce((s, a) => s + a.totalPanels, 0);
  if (totalAccountedPanels !== panelsPerUnit) {
    notes.push(
      `Panel distribution: ${qty} units × ${panelsPerUnit} panels/unit = ${totalAccountedPanels} ` +
      `(expected ${panelsPerUnit}). Rounding applied.`,
    );
  }

  // ── Balance check ────────────────────────────────────────────────────────
  const panelCounts = mpptAllocations.map(a => a.totalPanels);
  const stringsBalanced = panelCounts.length > 0 &&
    panelCounts.every(c => c === panelCounts[0]);

  const stringLayout: StringLayoutPlan = {
    mpptAllocations,
    totalPanels: panelsPerUnit,
    stringsAreBalanced: stringsBalanced && allBalanced,
  };

  notes.push(
    `String layout: ${qty}×${profile.equipmentDbId}, ${mpptCount} MPPT, ` +
    `${mpptAllocations.map(a => `${a.parallelStrings}×${a.panelsPerString}`).join(' / ')} panels/MPPT.`,
  );

  return {
    feasible: true,
    failures: [],
    stringLayout,
    branchLayout: null,
    validationNotes: notes,
  };
}

// ─── String Layout Helper ────────────────────────────────────────────────────

interface StringLayoutAttempt {
  feasible: boolean;
  failures: string[];
  parallelStrings?: number;
  panelsPerString?: number;
}

/**
 * Find the best (parallelStrings, panelsPerString) configuration for a given
 * MPPT channel and panel count.
 *
 * Priority: fewer parallel strings > more parallel strings.
 * Always validate design current against maxInputCurrentPerMppt.
 */
function findStringLayout(
  mppt: CapabilityProfile['mpptChannels'][0],
  panelsOnMppt: number,
  input: LayoutGeneratorInput,
  topology: CapabilityProfile['topology'],
  mpptIndex: number,
): StringLayoutAttempt {
  const failures: string[] = [];

  // Try parallel string counts from 1 up to maxParallelStringsPerMppt.
  for (let parallel = 1; parallel <= mppt.maxParallelStringsPerMppt; parallel++) {
    // panels per string = ceil(panelsOnMppt / parallel)
    const pps = Math.ceil(panelsOnMppt / parallel);

    // Validate string length bounds.
    if (pps < mppt.minPanelsPerString) continue; // too short — try fewer parallel
    if (pps > mppt.maxPanelsPerString) continue; // too long — try more parallel

    // Validate design current.
    if (input.panelIsc != null) {
      let designCurrentPerString: number;
      if (topology === 'optimizer' && input.optimizerMaxOutputCurrent != null) {
        designCurrentPerString = input.optimizerMaxOutputCurrent;
      } else {
        // NEC 690.8(A)(1): design current = Isc × 1.25.
        designCurrentPerString = input.panelIsc * 1.25;
      }
      const totalDesignCurrent = designCurrentPerString * parallel;
      if (totalDesignCurrent > mppt.maxInputCurrentPerMppt) {
        failures.push(
          `MPPT${mpptIndex}: Design current ${totalDesignCurrent.toFixed(1)}A ` +
          `(${parallel} strings × ${designCurrentPerString.toFixed(1)}A) exceeds ` +
          `maxInputCurrentPerMppt ${mppt.maxInputCurrentPerMppt}A.`,
        );
        continue;
      }
    }

    // Found a valid configuration.
    return { feasible: true, failures: [], parallelStrings: parallel, panelsPerString: pps };
  }

  // No valid configuration found.
  if (failures.length === 0) {
    failures.push(
      `MPPT${mpptIndex}: Cannot fit ${panelsOnMppt} panels in strings of ` +
      `${mppt.minPanelsPerString}–${mppt.maxPanelsPerString} panels with ` +
      `up to ${mppt.maxParallelStringsPerMppt} parallel strings.`,
    );
  }

  return { feasible: false, failures };
}

// ─── BOS Hint Builder ────────────────────────────────────────────────────────

/**
 * Build BOS hints from the profile's requiredBOSFamilies equivalent.
 * Uses topology to determine which items are needed.
 */
function buildBosHints(
  profile: CapabilityProfile,
  result: TopologyResult,
): BosHint[] {
  const hints: BosHint[] = [];

  switch (profile.topology) {
    case 'optimizer':
      hints.push(
        { category: 'optimizer',      qtyPolicy: 'per_module',   required: true,  note: 'Per-module power optimizer.' },
        { category: 'dc_disconnect',  qtyPolicy: 'per_inverter', required: true,  note: 'DC disconnect.' },
        { category: 'ac_disconnect',  qtyPolicy: 'per_inverter', required: true,  note: 'AC disconnect.' },
      );
      break;

    case 'micro':
      hints.push(
        { category: 'microinverter',      qtyPolicy: 'per_module',   required: true,  note: 'One micro per panel.' },
        { category: 'trunk_cable',        qtyPolicy: 'derived',       required: true,  note: 'Q Cable trunk per AC branch.' },
        { category: 'terminator',         qtyPolicy: 'per_branch',   required: true,  note: 'End terminator per AC branch.' },
        { category: 'combiner',           qtyPolicy: 'fixed_count',  required: true,  fixedQty: 1, note: 'IQ Combiner.' },
        { category: 'monitoring_gateway', qtyPolicy: 'fixed_count',  required: true,  fixedQty: 1, note: 'IQ Gateway / Envoy.' },
      );
      break;

    case 'string':
    case 'hybrid':
      hints.push(
        { category: 'dc_disconnect',  qtyPolicy: 'per_inverter', required: true,  note: 'DC disconnect ahead of inverter.' },
        { category: 'ac_disconnect',  qtyPolicy: 'per_inverter', required: true,  note: 'AC disconnect.' },
        { category: 'rapid_shutdown', qtyPolicy: 'per_module',   required: true,  note: 'Per-module RSD (NEC 690.12).' },
      );
      // Add DC combiner only if any MPPT has parallel strings > 1.
      const needsCombiner = result.stringLayout?.mpptAllocations.some(a => a.parallelStrings > 1) ?? false;
      if (needsCombiner) {
        hints.push({
          category: 'dc_combiner',
          qtyPolicy: 'derived',
          required: false,
          note: 'DC combiner for parallel strings.',
        });
      }
      break;
  }

  return hints;
}

// ─── Selection Rationale Builder ─────────────────────────────────────────────

/**
 * Generate a human-readable explanation of why this candidate was selected.
 * Used by the "Why this inverter?" panel in the UI.
 */
function buildRationale(candidate: LayoutCandidate, score: ScoreBreakdown): string {
  const { profile, inverterQty, dcAcRatio, stringLayout, branchLayout } = candidate;
  const parts: string[] = [];

  parts.push(
    `${inverterQty}×${profile.modelName} (${profile.brandDisplayName}).`,
  );
  parts.push(
    `DC/AC ratio: ${dcAcRatio.toFixed(2)} ` +
    `(target ${profile.dcAcRatioTarget}, range ${profile.dcAcRatioRange.min}–${profile.dcAcRatioRange.max}).`,
  );
  parts.push(`Score: ${score.total.toFixed(0)} pts.`);

  if (stringLayout) {
    const layouts = stringLayout.mpptAllocations
      .map(a => `${a.parallelStrings}×${a.panelsPerString}`)
      .join(', ');
    parts.push(`String layout: ${layouts} panels/MPPT.`);
    if (stringLayout.stringsAreBalanced) {
      parts.push('Strings balanced ✓');
    }
  }

  if (branchLayout) {
    parts.push(
      `Branch layout: ${branchLayout.branchCount} branches, ` +
      `${branchLayout.branchOcpdAmps}A OCPD per branch.`,
    );
  }

  return parts.join(' ');
}

// ─── Standard Breaker Sizes ───────────────────────────────────────────────────

/**
 * Round up to the nearest standard breaker size.
 * P0-5c: delegates to lib/electrical/stdSizes.ts — the old local copy stopped
 * at 150 A (not a physical cap) and invented next-10A sizes above it.
 */
function standardBreakerSize(rawAmps: number): number {
  return nextStandardOcpd(rawAmps);
}