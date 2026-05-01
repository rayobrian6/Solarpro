/**
 * ============================================================================
 * lib/system/optimizerMergeHint.ts — v47.409
 *
 * Pure helper that composes the optimizer-system merge-hint advisory message.
 * Extracted from app/api/engineering/calculate/route.ts so it can be unit-
 * tested without spinning up the full API handler.
 *
 * When the Compliance tab evaluates an INFEASIBLE optimizer layout
 * (MPPT_CURRENT_EXCEEDED), AND the Sizing Recommendation in the client has
 * FEWER (= longer) strings than the current config, this helper produces a
 * plain-English hint telling the user that merging strings would fit the
 * existing hardware. Reuses the sizing recommendation — no separate merge
 * solver.
 *
 * Per the v47.409 user directive:
 *   • NO auto-apply
 *   • NO auto-collapse
 *   • Keep it small
 *   • Reuse the sizing recommendation rather than building separate merge logic
 *
 * Returns null when the preconditions aren't met (non-optimizer topology,
 * no current-exceeded violation, or the recommendation isn't strictly fewer
 * strings). Callers should append the string to `stringConfig.warnings` when
 * non-null.
 * ============================================================================
 */

export interface MergeHintInput {
  /** Topology family — only 'optimizer' produces a hint. */
  topology: 'string' | 'optimizer' | 'hybrid' | string;

  /** True when the allocator reported MPPT_CURRENT_EXCEEDED on current layout. */
  hasCurrentExceeded: boolean;

  /** Current per-string panel counts as evaluated by the compliance run. */
  currentStringPanelCounts: number[];

  /**
   * Sizing Recommendation's per-string panel counts (forwarded from the
   * client). Pass an empty array or undefined when no recommendation.
   */
  recommendedStringPanelCounts: number[] | undefined;

  /** Per-string design current (A). For optimizer systems this is the cap. */
  perStringCurrentA: number;

  /** Total MPPT channels on the inverter set. */
  mpptChannels: number;

  /** Max input current per MPPT channel (A). */
  maxInputCurrentPerMpptA: number;
}

/**
 * Compose the merge-hint message, or return null when preconditions aren't
 * satisfied.
 *
 * Preconditions (all required):
 *   1. topology === 'optimizer'
 *   2. hasCurrentExceeded === true
 *   3. recommendedStringPanelCounts has ≥ 1 positive entry
 *   4. recommendedStringPanelCounts.length < currentStringPanelCounts.length
 *      (= the recommendation has strictly FEWER strings = would reduce
 *         per-MPPT current by consolidation)
 *   5. perStringCurrentA > 0
 */
export function composeOptimizerMergeHint(input: MergeHintInput): string | null {
  if (input.topology !== 'optimizer') return null;
  if (!input.hasCurrentExceeded) return null;
  if (input.perStringCurrentA <= 0) return null;

  const recCounts = (input.recommendedStringPanelCounts ?? []).filter(
    n => typeof n === 'number' && n > 0,
  );
  if (recCounts.length === 0) return null;
  if (recCounts.length >= input.currentStringPanelCounts.length) return null;

  const currentTotalA = input.currentStringPanelCounts.length * input.perStringCurrentA;
  const recTotalA     = recCounts.length * input.perStringCurrentA;
  const channelCapA   = input.mpptChannels * input.maxInputCurrentPerMpptA;

  const currentDesc = input.currentStringPanelCounts.join('/');
  const recDesc     = recCounts.join('/');

  return (
    `OPTIMIZER_LAYOUT_SUGGEST_MERGE: Current layout ${currentDesc} ` +
    `draws ${currentTotalA.toFixed(1)}A across ${input.currentStringPanelCounts.length} strings, ` +
    `but only ${channelCapA.toFixed(1)}A of MPPT capacity is available. ` +
    `The Sizing Recommendation panel above suggests ${recDesc} ` +
    `(${recCounts.length} longer strings × ${input.perStringCurrentA.toFixed(1)}A = ` +
    `${recTotalA.toFixed(1)}A) which fits the existing hardware. ` +
    `Click "Apply Recommended Configuration" above to sync — ` +
    `string length does not change per-string current on optimizer systems ` +
    `(each optimizer caps output at ${input.perStringCurrentA.toFixed(1)}A ` +
    `regardless of string length), so the only way to reduce total current ` +
    `is to reduce the string count.`
  );
}