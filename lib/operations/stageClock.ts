/**
 * lib/operations/stageClock.ts
 *
 * HOW LONG HAS THIS DEAL BEEN SITTING? AND WHAT DOES THE NUMBER ACTUALLY MEAN?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DEFECT
 * ─────────────────────────────────────────────────────────────────────────────
 * Every days-in-stage number in the product was `now - projects.updated_at`.
 * `updated_at` is bumped by 20+ unrelated writers — saving a layout, editing a
 * note, uploading a bill, the operations backfill, the system writing to itself.
 * So:
 *
 *   • A project genuinely parked in `permit_submitted` for six weeks reported
 *     **0 days** and never turned red, as long as anything touched the row.
 *   • `lib/commands/generateActions.ts` rule 4 (`permit_submitted` +
 *     `daysStale >= 5`) therefore never fired for an actively-edited project,
 *     so the AHJ chase-up command was never created for the projects most
 *     likely to be worked on.
 *   • And the text asserted a specific event: "Proposal sent 7d ago with no
 *     response" was really "nothing has touched this row for 7d". A wrong LABEL
 *     on a real number is the user-facing half of the defect, and it survives
 *     any fix to the number.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CORRECT FIX, AND WHY IT IS NOT (YET) THE ONE HERE
 * ─────────────────────────────────────────────────────────────────────────────
 * `projects.stage_changed_at`, stamped by `lib/operations/stageChange.ts` — one
 * writer, one column, no derivation. That needs a migration, and registering one
 * in this repo takes five separate registrations plus an admissible shape while
 * the runner's own reliability is a separate open campaign. The DDL is stated in
 * `STAGE_CHANGED_AT_DDL` below so it is not re-derived when that lands.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE DOES INSTEAD
 * ─────────────────────────────────────────────────────────────────────────────
 * Stage changes ARE already recorded with timestamps, in two places:
 *
 *   `project_activity`                  — the row `applyStageChange` writes
 *   `project_homeowner_stage_history`   — the customer-facing half
 *
 * So the clock is derived from the most recent such record, and falls back to
 * `updated_at` ONLY when no record exists — which is the normal case for every
 * project whose last stage change predates the audit-row repair.
 *
 * 🚨 AND THE BASIS TRAVELS WITH THE NUMBER. `StageAge.basis` says which source
 * answered, and `describeStageAge` is the only place a human-readable phrase is
 * built from it. A fallback number may never be phrased as an event: it is
 * "no activity for 7d", never "proposal sent 7d ago". That distinction is the
 * point of this file, not a nicety.
 */

/** Which source the age was computed from. */
export type StageAgeBasis =
  /** A recorded stage change: `project_activity` / stage history. Trustworthy. */
  | 'stage_change'
  /** `projects.updated_at` — last touch by ANY writer. Not a stage clock. */
  | 'last_activity'
  /** Nothing to measure from at all. */
  | 'unknown';

export interface StageAge {
  /** Whole days since `at`. 0 when basis is 'unknown'. */
  days: number;
  /** The timestamp the number came from, ISO, or null when unknown. */
  at: string | null;
  basis: StageAgeBasis;
  /**
   * True only when the number really is time-in-stage. Every stall/urgency
   * decision that claims to be about a stage should read this.
   */
  measuresStage: boolean;
}

/** A row shaped like whatever the API happened to return. All fields optional. */
export interface StageClockSource {
  /** The future column (see STAGE_CHANGED_AT_DDL). Preferred when present. */
  stage_changed_at?: string | Date | null;
  /** Derived server-side from the most recent stage-change record. */
  last_stage_change_at?: string | Date | null;
  /** camelCase variants, because the two API shapes in this app disagree. */
  stageChangedAt?: string | Date | null;
  lastStageChangeAt?: string | Date | null;
  /** The last-touch column. Fallback ONLY. */
  updated_at?: string | Date | null;
  updatedAt?: string | Date | null;
  created_at?: string | Date | null;
  createdAt?: string | Date | null;
}

const MS_PER_DAY = 86_400_000;

/** Whole days between `then` and now, floored at 0. Null/unparsable → null. */
export function daysSinceTimestamp(
  value: string | Date | null | undefined,
  now: number = Date.now(),
): number | null {
  if (!value) return null;
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now - t) / MS_PER_DAY));
}

function iso(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  const t = d.getTime();
  if (!Number.isFinite(t)) return null;
  return d.toISOString();
}

/**
 * Resolve how long a project has been in its stage, and say what the number is.
 *
 * Preference order, most trustworthy first:
 *   1. `stage_changed_at`        — the column, once it exists
 *   2. `last_stage_change_at`    — derived from a recorded stage change
 *   3. `updated_at`              — last touch by anything. basis 'last_activity'
 *   4. `created_at`              — a project that has never been updated
 *
 * 🚨 It does NOT fall back from (1)/(2) to (3) and then claim to measure the
 * stage. Falling back is allowed; relabelling is not.
 */
export function resolveStageAge(
  src: StageClockSource | null | undefined,
  now: number = Date.now(),
): StageAge {
  const stageChange =
    src?.stage_changed_at ?? src?.stageChangedAt
    ?? src?.last_stage_change_at ?? src?.lastStageChangeAt ?? null;

  const stageDays = daysSinceTimestamp(stageChange, now);
  if (stageDays !== null) {
    return { days: stageDays, at: iso(stageChange), basis: 'stage_change', measuresStage: true };
  }

  const touched = src?.updated_at ?? src?.updatedAt ?? src?.created_at ?? src?.createdAt ?? null;
  const touchedDays = daysSinceTimestamp(touched, now);
  if (touchedDays !== null) {
    return { days: touchedDays, at: iso(touched), basis: 'last_activity', measuresStage: false };
  }

  return { days: 0, at: null, basis: 'unknown', measuresStage: false };
}

/**
 * The ONE place a days-number becomes a phrase.
 *
 * `event` is what the stage entry actually was, in the past tense, e.g.
 * "Proposal sent", "Permit submitted". It is used ONLY when the number really
 * measures the stage. Otherwise the phrase names what was measured: the last
 * touch on the record.
 */
export function describeStageAge(age: StageAge, event?: string): string {
  if (age.basis === 'unknown') return 'no recorded activity';
  if (age.measuresStage) {
    return event ? `${event} ${age.days}d ago` : `${age.days}d in this stage`;
  }
  return `no activity on this project for ${age.days}d`;
}

/**
 * A short badge phrase for the same number — "12d in stage" / "12d no activity".
 * Separate from `describeStageAge` so a UI cannot accidentally get the long form
 * into a badge and lose the qualifier to truncation.
 */
export function stageAgeBadge(age: StageAge): string {
  if (age.basis === 'unknown') return '—';
  return age.measuresStage ? `${age.days}d in stage` : `${age.days}d no activity`;
}

/**
 * 🚨 STALL IS A CLAIM ABOUT A STAGE, SO IT NEEDS A STAGE CLOCK.
 *
 * With a real stage clock this is the threshold test. With only `updated_at` it
 * returns `false` — not because the project is moving, but because we cannot
 * tell, and the red "STALLED" banner is an accusation.
 *
 * `quiet` is the honest weaker claim the fallback CAN support: nothing has
 * touched this record in a while. A UI may show that; it may not call it a
 * stall.
 */
export function classifyStageAge(
  age: StageAge,
  thresholdDays: number,
): { stalled: boolean; quiet: boolean } {
  const over = age.days >= thresholdDays;
  return { stalled: over && age.measuresStage, quiet: over && !age.measuresStage };
}

// ─────────────────────────────────────────────────────────────────────────────
// The migration this file exists to work around.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The column that makes all of the above a single read.
 *
 * NOT APPLIED. Registering a migration here needs five separate registrations
 * plus an admissible shape, and no `.sql` file was added as part of this repair.
 * Stated as a constant so the DDL is reviewed once and not retyped.
 *
 * Backfill note: `updated_at` is the ONLY value available for existing rows and
 * it is the wrong one — which is the whole defect. So the column is left NULL on
 * backfill and `resolveStageAge` reports `basis: 'last_activity'` for those rows
 * until their next stage change stamps it. A backfill from `updated_at` would
 * convert an honest "unknown" into a confident wrong answer, permanently.
 */
export const STAGE_CHANGED_AT_DDL = [
  'ALTER TABLE projects ADD COLUMN IF NOT EXISTS stage_changed_at TIMESTAMPTZ;',
  'CREATE INDEX IF NOT EXISTS idx_projects_stage_changed_at',
  '  ON projects (stage_changed_at DESC NULLS LAST);',
].join('\n');

/**
 * The read that derives the fallback server-side, for a set of projects.
 *
 * 🚨 MATCHES ON EITHER THE TYPE OR THE METADATA. `applyStageChange` writes
 * `type = 'stage_change'`, but the deal-decision machine classifies some of its
 * transitions as 'follow_up' / 'schedule' / 'note' while still recording
 * `metadata.to_stage`. Matching only on the type would silently miss those and
 * report the project as having never changed stage.
 */
export const LAST_STAGE_CHANGE_SQL = `
  SELECT a.project_id, MAX(a.created_at) AS last_stage_change_at
  FROM project_activity a
  WHERE a.project_id = ANY($1::uuid[])
    AND (a.type = 'stage_change' OR a.metadata->>'to_stage' IS NOT NULL)
  GROUP BY a.project_id
`;
