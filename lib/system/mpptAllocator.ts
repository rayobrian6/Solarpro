// ============================================================================
// lib/system/mpptAllocator.ts — Phase 13.4
//
// MPPT-Aware String Allocation
//
// PROBLEM THIS MODULE SOLVES
// --------------------------
// A solar system can pass DC sizing, panel-count sizing, and string-voltage
// validation while STILL being electrically unbuildable — because the final
// string-to-MPPT-channel assignment can exceed the physical current limits
// of an MPPT input.
//
// Example from production (v47.374 screenshot, 36 panels SolarEdge):
//   • 3 strings of 12 panels each (Isc × 1.25 ≈ 15.3 A design current)
//   • 2 MPPT channels with max input current ≈ 18 A each
//   • Naive allocation: CH1 gets 2 strings (30.6 A total), CH2 gets 1 string
//   • 30.6 A > 18 A  → CH1 burns
//
// NON-NEGOTIABLES
// ---------------
//  • Pure function — no I/O, no mutation of inputs.
//  • Returns structured result (valid + allocation + violations).
//  • Never "force-passes" an invalid allocation silently.
//  • Understands: strings-per-MPPT cap, per-channel current cap,
//    balanced distribution preference.
// ============================================================================

export interface AllocatorString {
  /** Stable identifier. Caller-supplied. */
  id: string;
  /** Number of panels in this string (for diagnostics + power math). */
  panelCount: number;
  /** Open-circuit voltage of the string (V). Informational for downstream. */
  voc: number;
  /** Short-circuit current of the string (A). Informational. */
  isc: number;
  /** Design current (A). Typically Isc × 1.25 (NEC 690.8(A)). */
  designCurrent: number;
}

export interface AllocateStringsParams {
  /** Pre-validated strings (voltage rules already checked upstream). */
  strings: AllocatorString[];
  /** Number of MPPT channels on the inverter. */
  mpptCount: number;
  /**
   * Per-MPPT max DC input current (A).
   * If undefined, allocator emits a META_UNKNOWN warning and assumes no
   * current limit for the primary placement (the caller must treat this
   * as a non-verified allocation).
   */
  mpptMaxInputCurrent?: number;
  /**
   * Max parallel strings per MPPT channel (optional).
   * If undefined, defaults to a SAFE 1 — i.e., no parallel combining
   * unless the brand profile explicitly opts in.
   */
  maxParallelStringsPerMppt?: number;
}

export interface MpptBin {
  mpptIndex: number;
  stringIds: string[];
  /** Sum of designCurrent of all strings on this channel (A). */
  totalDesignCurrent: number;
}

export interface MpptAllocationViolation {
  code:
    | 'MPPT_CURRENT_EXCEEDED'
    | 'MPPT_PARALLEL_CAP_EXCEEDED'
    | 'MPPT_ALLOCATION_INVALID'
    | 'MPPT_CURRENT_UNKNOWN';
  message: string;
  mpptIndex?: number;
  stringIds?: string[];
}

export interface MpptAllocationResult {
  /** True iff every string landed on a channel without violating any rule. */
  valid: boolean;
  /** Final allocation. Always populated, even on failure (for diagnostics). */
  allocation: MpptBin[];
  /** Structured failure reasons. Empty when valid === true. */
  violations: MpptAllocationViolation[];
  /** Echo of inputs used, for diagnostics. */
  meta: {
    mpptCount: number;
    mpptMaxInputCurrent: number | null;
    maxParallelStringsPerMppt: number;
    currentLimitAssumed: boolean;
  };
}

/** Default parallel cap when inverter model doesn't declare. Intentionally
 * conservative — most residential installs wire 1 string per MPPT; combining
 * requires explicit brand-profile opt-in. */
export const DEFAULT_MAX_PARALLEL_PER_MPPT = 1;

// ---------------------------------------------------------------------------
// Core allocator — pure function.
// ---------------------------------------------------------------------------
export function distributeStringsAcrossMpptsSafely(
  params: AllocateStringsParams
): MpptAllocationResult {
  const {
    strings,
    mpptCount,
    mpptMaxInputCurrent,
    maxParallelStringsPerMppt = DEFAULT_MAX_PARALLEL_PER_MPPT,
  } = params;

  const parallelCap = Math.max(1, Math.floor(maxParallelStringsPerMppt));
  const channelCount = Math.max(1, Math.floor(mpptCount));

  // Seed empty bins.
  const bins: MpptBin[] = Array.from({ length: channelCount }, (_, i) => ({
    mpptIndex: i,
    stringIds: [],
    totalDesignCurrent: 0,
  }));
  const binStringCounts: number[] = new Array(channelCount).fill(0);

  const violations: MpptAllocationViolation[] = [];
  const currentLimitAssumed = mpptMaxInputCurrent === undefined;

  if (currentLimitAssumed) {
    violations.push({
      code: 'MPPT_CURRENT_UNKNOWN',
      message:
        'Inverter model does not declare mpptMaxInputCurrent. Allocator ' +
        'cannot verify channel current compliance. Treat result as ' +
        'unverified pending inverter-data completion.',
    });
  }

  // Short-circuit: no strings is trivially valid (empty bins).
  if (strings.length === 0) {
    return {
      valid: true,
      allocation: bins,
      violations,
      meta: {
        mpptCount: channelCount,
        mpptMaxInputCurrent: mpptMaxInputCurrent ?? null,
        maxParallelStringsPerMppt: parallelCap,
        currentLimitAssumed,
      },
    };
  }

  // Sort strings by descending designCurrent (largest first).
  // Tie-break by descending panelCount. Tie-break further by stable id
  // for deterministic output.
  const sorted = [...strings].sort((a, b) => {
    if (b.designCurrent !== a.designCurrent) return b.designCurrent - a.designCurrent;
    if (b.panelCount !== a.panelCount) return b.panelCount - a.panelCount;
    return a.id.localeCompare(b.id);
  });

  // Track which strings could not be placed without violating a rule.
  const unplacedIds: string[] = [];

  for (const s of sorted) {
    // Find all bins where placing this string keeps us within BOTH:
    //   (a) parallelCap  (stringsPerMppt <= cap)
    //   (b) currentCap   (sum(designCurrent) <= mpptMaxInputCurrent)
    // Note: when mpptMaxInputCurrent is undefined, rule (b) is skipped.
    const candidates: number[] = [];
    for (let i = 0; i < channelCount; i++) {
      const newCount = binStringCounts[i] + 1;
      if (newCount > parallelCap) continue;
      if (mpptMaxInputCurrent !== undefined) {
        const newCurrent = bins[i].totalDesignCurrent + s.designCurrent;
        if (newCurrent > mpptMaxInputCurrent) continue;
      }
      candidates.push(i);
    }

    if (candidates.length === 0) {
      unplacedIds.push(s.id);
      continue;
    }

    // Best-fit strategy: choose the VALID channel with the LEAST
    // total current (least-loaded). Tie-break by fewest strings, then
    // by lowest index for determinism.
    let bestIdx = candidates[0];
    for (const c of candidates) {
      const cur = bins[c];
      const best = bins[bestIdx];
      if (cur.totalDesignCurrent < best.totalDesignCurrent) {
        bestIdx = c;
      } else if (cur.totalDesignCurrent === best.totalDesignCurrent) {
        if (binStringCounts[c] < binStringCounts[bestIdx]) {
          bestIdx = c;
        }
      }
    }

    bins[bestIdx].stringIds.push(s.id);
    bins[bestIdx].totalDesignCurrent = roundA(
      bins[bestIdx].totalDesignCurrent + s.designCurrent
    );
    binStringCounts[bestIdx] += 1;
  }

  // ─── v47.422 — Forced-Spread Second Pass ─────────────────────────────────
  //
  // Why this exists:
  //   The strict first pass above rejects EVERY channel when a single
  //   string's designCurrent > mpptMaxInputCurrent (because 0 + bigCurrent
  //   still exceeds the cap). That left all strings in `unplacedIds`, and
  //   downstream in string-generator.ts the `?? 0` fallback collapsed them
  //   onto channel 0 — making the UI show "CH1 has everything, CH2-N empty".
  //   That UI lied about the real allocation the installer intended.
  //
  // What we do:
  //   When strings remain unplaced, run a second pass that distributes
  //   them round-robin across channels respecting ONLY the parallel-strings
  //   cap. Per-channel current overages are then surfaced honestly by the
  //   per-bin MPPT_CURRENT_EXCEEDED check later in this function.
  //
  // Invariants:
  //   • `valid` still becomes false because the per-bin overage emits
  //     MPPT_CURRENT_EXCEEDED, which is in the invalidating codes list.
  //   • Parallel cap is STILL enforced — if spreading would exceed it,
  //     the remaining strings stay in `unplacedIds` and the existing
  //     MPPT_PARALLEL_CAP_EXCEEDED diagnostic reports them.
  //   • Brand-agnostic: this logic applies to every inverter. No per-brand
  //     special-case needed.
  //
  // v47.422 — Track which strings were force-placed despite exceeding the
  // current cap. Used below to emit the summary-level MPPT_ALLOCATION_INVALID
  // even when all strings ended up in a bin (so installers still see the
  // capacity clause + remedies banner, not just per-channel overage chips).
  const currentSpreadStringIds: string[] = [];
  let hadCurrentSpread = false;

  if (unplacedIds.length > 0) {
    const remaining = unplacedIds.slice();
    const stillUnplaced: string[] = [];

    // Round-robin starting from the least-loaded bin (by string count,
    // tie-break by index) for stable, balanced spread.
    let cursor = 0;
    const leastLoadedIndex = (): number => {
      let best = 0;
      for (let i = 1; i < channelCount; i++) {
        if (binStringCounts[i] < binStringCounts[best]) best = i;
      }
      return best;
    };
    cursor = leastLoadedIndex();

    for (const id of remaining) {
      const src = sorted.find(x => x.id === id)!;
      // Try up to channelCount bins starting from cursor; skip any bin
      // already at parallel cap. Parallel cap is the ONLY hard rule here.
      let placed = false;
      for (let attempt = 0; attempt < channelCount; attempt++) {
        const binIdx = (cursor + attempt) % channelCount;
        if (binStringCounts[binIdx] + 1 > parallelCap) continue;
        bins[binIdx].stringIds.push(src.id);
        bins[binIdx].totalDesignCurrent = roundA(
          bins[binIdx].totalDesignCurrent + src.designCurrent
        );
        binStringCounts[binIdx] += 1;
        cursor = (binIdx + 1) % channelCount;
        placed = true;
        currentSpreadStringIds.push(src.id);
        hadCurrentSpread = true;
        break;
      }
      if (!placed) {
        // All bins are at parallel cap — genuinely unplaceable.
        // Leaves the existing MPPT_PARALLEL_CAP_EXCEEDED diagnostic
        // to explain this to the user.
        stillUnplaced.push(id);
      }
    }

    // Replace unplacedIds with only those that truly could not be placed
    // (parallel cap exhausted). Current-cap-only unplaceables are now
    // placed AND their overage is reported per-channel below.
    unplacedIds.length = 0;
    for (const id of stillUnplaced) unplacedIds.push(id);
  }

  // Post-placement: identify which rule actually blocked each unplaced
  // string (parallel cap vs current cap). We re-run the per-bin check
  // to determine the dominant blocker for the FIRST unplaced string.
  //
  // v47.422 — Also emit the summary-level MPPT_ALLOCATION_INVALID when
  // strings were force-spread to cause current overage on one or more
  // channels. Even though every string is now placed, the installer still
  // needs the capacity clause + remedies banner.
  if (unplacedIds.length > 0 || hadCurrentSpread) {
    const unplacedFirst = sorted.find(s => unplacedIds.includes(s.id));
    if (unplacedFirst) {
      // Determine which rule blocked each bin for this string.
      let blockedByParallel = 0;
      let blockedByCurrent = 0;
      for (let i = 0; i < channelCount; i++) {
        const wouldExceedParallel = binStringCounts[i] + 1 > parallelCap;
        const wouldExceedCurrent =
          mpptMaxInputCurrent !== undefined &&
          bins[i].totalDesignCurrent + unplacedFirst.designCurrent > mpptMaxInputCurrent;
        if (wouldExceedParallel) blockedByParallel++;
        if (wouldExceedCurrent) blockedByCurrent++;
      }
      // Report the dominant blocker. If ALL bins were blocked by parallel,
      // emit PARALLEL_CAP_EXCEEDED. If at least one was current-blocked
      // but not parallel-blocked, emit CURRENT_EXCEEDED.
      const allBlockedByParallel = blockedByParallel === channelCount;
      if (allBlockedByParallel && blockedByCurrent === 0) {
        violations.push({
          code: 'MPPT_PARALLEL_CAP_EXCEEDED',
          message:
            `${unplacedIds.length} string${unplacedIds.length > 1 ? 's' : ''} ` +
            `cannot be placed within the parallel-strings-per-MPPT cap ` +
            `(${parallelCap}) across ${channelCount} channel${channelCount > 1 ? 's' : ''}.`,
          stringIds: [...unplacedIds],
        });
      } else if (mpptMaxInputCurrent !== undefined && blockedByCurrent > 0) {
        violations.push({
          code: 'MPPT_CURRENT_EXCEEDED',
          message:
            `${unplacedIds.length} string${unplacedIds.length > 1 ? 's' : ''} ` +
            `cannot be placed on any MPPT without exceeding per-channel ` +
            `current limit of ${mpptMaxInputCurrent.toFixed(1)}A ` +
            `(each unplaced string draws ${unplacedFirst.designCurrent.toFixed(1)}A design current).`,
          stringIds: [...unplacedIds],
        });
      } else {
        violations.push({
          code: 'MPPT_PARALLEL_CAP_EXCEEDED',
          message:
            `${unplacedIds.length} string${unplacedIds.length > 1 ? 's' : ''} ` +
            `cannot be placed within the parallel-strings-per-MPPT cap ` +
            `(${parallelCap}) across ${channelCount} channel${channelCount > 1 ? 's' : ''}.`,
          stringIds: [...unplacedIds],
        });
      }
    }

    // v47.407: Actionable, mathematically-honest remediation message.
    // Previous message included "(c) shorter strings" which is incorrect —
    // per-string design current = panel Isc x 1.25 is a PANEL property,
    // independent of string length. Shorter strings do not reduce current.
    //
    // New message: compute the exact capacity gap (total design current
    // vs. total channel capacity) so the user can see why the current
    // inverter cannot fit the array, and points them at the authoritative
    // remedy: accept the model shown in the Sizing Recommendation panel.
    const totalDesignCurrent = strings.reduce(
      (sum, s) => sum + (s.designCurrent ?? 0),
      0,
    );
    const totalChannelCapacity =
      mpptMaxInputCurrent !== undefined
        ? channelCount * mpptMaxInputCurrent
        : undefined;
    const perStringCurrent = strings[0]?.designCurrent ?? 0;
    // Minimum channels required assuming the limiting per-channel rating
    // must still dominate (one string per channel if 2x doesn't fit).
    const minChannelsAtCurrentRating =
      mpptMaxInputCurrent !== undefined && perStringCurrent > 0
        ? Math.ceil(strings.length /
            Math.max(1, Math.floor(mpptMaxInputCurrent / perStringCurrent)))
        : strings.length;

    const capacityClause =
      totalChannelCapacity !== undefined
        ? ` Required ${totalDesignCurrent.toFixed(1)}A total design current ` +
          `vs. ${totalChannelCapacity.toFixed(1)}A total channel capacity ` +
          `(${channelCount} ch x ${mpptMaxInputCurrent!.toFixed(1)}A).`
        : '';

    const remedyClause =
      ` Remedies: (a) accept the inverter shown in the Sizing Recommendation ` +
      `panel above — it has enough MPPT channels and per-channel current ` +
      `to fit all ${strings.length} strings at ${perStringCurrent.toFixed(1)}A each; ` +
      `(b) add a second inverter unit of the same model (multi-unit setups ` +
      `sum MPPT channels — need at least ${minChannelsAtCurrentRating} channels total); ` +
      `(c) switch to a panel with lower Isc (reduces per-string current).`;

    // v47.422 — Lead sentence adapts to the placement outcome:
    //   • Strings truly unplaced (parallel cap exhausted) → "N left unplaced"
    //   • Strings force-spread causing per-channel overage → spread-spelled-out
    //   • Both → compose
    let leadSentence =
      `Unable to allocate all ${strings.length} strings across ${channelCount} ` +
      `MPPT channel${channelCount > 1 ? 's' : ''} without violations.`;

    if (unplacedIds.length > 0) {
      leadSentence +=
        ` ${unplacedIds.length} string${unplacedIds.length > 1 ? 's' : ''} left ` +
        `unplaced: ${unplacedIds.join(', ')}.`;
    }
    if (hadCurrentSpread) {
      leadSentence +=
        ` ${currentSpreadStringIds.length} string` +
        `${currentSpreadStringIds.length > 1 ? 's were' : ' was'} ` +
        `force-spread across channels; see per-channel current overage below ` +
        `(${currentSpreadStringIds.join(', ')}).`;
    }

    // The stringIds array carries everything the installer needs to see
    // as "problem strings": truly unplaced + current-spread force-placed.
    const problemStringIds = [...unplacedIds, ...currentSpreadStringIds];

    violations.push({
      code: 'MPPT_ALLOCATION_INVALID',
      message: leadSentence + capacityClause + remedyClause,
      stringIds: problemStringIds,
    });
  }

  // Additional structural violations to surface (even if allocation placed
  // everything): per-bin checks for defensive reporting.
  for (const bin of bins) {
    if (bin.stringIds.length > parallelCap) {
      violations.push({
        code: 'MPPT_PARALLEL_CAP_EXCEEDED',
        message:
          `MPPT ${bin.mpptIndex + 1} has ${bin.stringIds.length} strings ` +
          `but max allowed is ${parallelCap}.`,
        mpptIndex: bin.mpptIndex,
        stringIds: [...bin.stringIds],
      });
    }
    if (
      mpptMaxInputCurrent !== undefined &&
      bin.totalDesignCurrent > mpptMaxInputCurrent + 0.001
    ) {
      violations.push({
        code: 'MPPT_CURRENT_EXCEEDED',
        message:
          `MPPT ${bin.mpptIndex + 1} carries ${bin.totalDesignCurrent.toFixed(1)}A ` +
          `design current, exceeding per-channel limit of ` +
          `${mpptMaxInputCurrent.toFixed(1)}A.`,
        mpptIndex: bin.mpptIndex,
        stringIds: [...bin.stringIds],
      });
    }
  }

  // Deduplicate violations that are structurally the same.
  const dedupedViolations = dedupeViolations(violations);

  const valid =
    unplacedIds.length === 0 &&
    !dedupedViolations.some(
      v =>
        v.code === 'MPPT_CURRENT_EXCEEDED' ||
        v.code === 'MPPT_PARALLEL_CAP_EXCEEDED' ||
        v.code === 'MPPT_ALLOCATION_INVALID'
    );

  return {
    valid,
    allocation: bins,
    violations: dedupedViolations,
    meta: {
      mpptCount: channelCount,
      mpptMaxInputCurrent: mpptMaxInputCurrent ?? null,
      maxParallelStringsPerMppt: parallelCap,
      currentLimitAssumed,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function roundA(n: number): number {
  // Stabilize floating-point accumulation to 3 decimals.
  return Math.round(n * 1000) / 1000;
}

function dedupeViolations(
  arr: MpptAllocationViolation[]
): MpptAllocationViolation[] {
  const seen = new Set<string>();
  const out: MpptAllocationViolation[] = [];
  for (const v of arr) {
    const key = [v.code, v.mpptIndex ?? '', (v.stringIds ?? []).join('|'), v.message].join('::');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}