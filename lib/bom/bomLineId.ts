// ═══════════════════════════════════════════════════════════════════════════
// ECD W1-A — THE STABLE BOM ROW IDENTITY.
//
// Before this module there was no stable BOM row identity at all. `PermitBOMItem
// .id` was an ORDINAL produced by a module-scoped counter (`bom-v4-0001`,
// `bom-v4-0002`, …): inserting one row early renumbered every downstream row, a
// post-merge filter left a permanent GAP (`bom-v4-0008` — the dropped registry
// combiner), and the two rows appended AFTER the V4 merge (the integrated
// combiner and the open-air branch EGC) had no id at all. Cross-object BOM
// references were therefore keyed on PART NUMBER
// (`GroundingSegment.bomLineId = 'GRN-OPENAIR-12'`), which is not unique in
// general. §1's mandated "row-ID multiset reconciliation gate (rendered ==
// evidence == export)" was not implementable.
//
// ── THE SCHEME ─────────────────────────────────────────────────────────────
//   bomLineId = `BOM-${CATEGORY_TOKEN}-${HASH8}`            (+ `-${n}` on collision)
//
//   CATEGORY_TOKEN  the row's category, upper-cased, non-alphanumerics → '-',
//                   truncated to 14 chars. Human-readable so a reader can tell
//                   a conduit line from a label line without a lookup table.
//   HASH8           8 upper-case hex chars = FNV-1a/32 over the row's CONTENT
//                   IDENTITY KEY (below). Pure, dependency-free, deterministic
//                   in node and in the browser (no `crypto`, no BigInt).
//
//   CONTENT IDENTITY KEY = the fields that make a row THAT row, joined by '|':
//       stageId | category | partNumber-or-normalized-description | unit | subSystem
//   Normalization: trim → collapse internal whitespace → upper-case. The
//   description is used ONLY when the row carries no part number (the '—' and
//   'TBD' placeholders count as NO part number: they are the SAME placeholder on
//   nine different pending racking rows, so hashing them would collide by
//   construction — the description is what actually distinguishes those rows).
//
//   QUANTITY IS DELIBERATELY NOT IN THE KEY. A row's id must survive a quantity
//   change (a re-routed conduit run is the SAME procurement line with a new
//   footage) or every downstream reference breaks on every recalculation.
//
// ── STABILITY PROPERTIES (what the gate relies on) ─────────────────────────
//   • Insertion/reordering-stable: the id is a function of the row's own
//     content, never of its position or of how many rows preceded it.
//   • Gap-free by construction: there is no counter to skip. A dropped row
//     simply does not contribute an id.
//   • Collision-checked, never collision-silent: `stampBomLineIds` assigns the
//     bare id to the first row bearing a key and `-2`, `-3`, … to subsequent
//     rows with the SAME key, in the collection's own order. Two rows with an
//     identical key are genuinely identical procurement lines, so the ordinal is
//     a duplicate-disambiguator and not a hash-collision workaround; a true
//     FNV-1a collision between two DIFFERENT keys is caught by
//     `auditBomLineIds` (different key, same hash ⇒ reported).
// ═══════════════════════════════════════════════════════════════════════════

/** The minimum a row must expose to be given a stable identity. */
export interface BomLineIdentityInput {
  stageId?: string;
  category: string;
  partNumber?: string | null;
  description?: string | null;
  model?: string | null;
  unit?: string | null;
  subSystem?: string | null;
}

/** Placeholders that are NOT a part number — they repeat across unrelated rows. */
const PART_NUMBER_PLACEHOLDERS = new Set(['', '-', '—', '--', 'TBD', 'N/A', 'NA', 'NONE']);

function norm(s: string | null | undefined): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
}

/** true ⇒ the value cannot serve as the row's identity token. */
export function isPartNumberPlaceholder(p: string | null | undefined): boolean {
  return PART_NUMBER_PLACEHOLDERS.has(norm(p));
}

/** The row's CONTENT IDENTITY KEY (exported so tests/evidence can prove the
 *  scheme is content-derived and not positional). */
export function bomLineIdentityKey(row: BomLineIdentityInput): string {
  const part = isPartNumberPlaceholder(row.partNumber)
    // No exact part: the DESCRIPTION distinguishes the row (nine pending racking
    // rows all carry partNumber 'TBD'). Model is the fallback when a producer
    // emitted neither — never an empty token, which would collide by category.
    ? `DESC:${norm(row.description) || norm(row.model) || 'UNSPECIFIED'}`
    : `PN:${norm(row.partNumber)}`;
  return [norm(row.stageId), norm(row.category), part, norm(row.unit), norm(row.subSystem)].join('|');
}

/** FNV-1a, 32-bit. Pure, no deps, identical in node + browser. */
function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    // h *= 16777619 in 32-bit arithmetic without overflowing the double mantissa
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

function categoryToken(category: string): string {
  const t = norm(category).replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return (t || 'UNCATEGORIZED').slice(0, 14);
}

/** The base (pre-collision-ordinal) id for a row. Deterministic + pure. */
export function bomLineIdFor(row: BomLineIdentityInput): string {
  const key = bomLineIdentityKey(row);
  return `BOM-${categoryToken(row.category)}-${fnv1a32(key).toString(16).toUpperCase().padStart(8, '0')}`;
}

export interface BomLineIdAudit {
  total: number;
  unique: number;
  /** ids assigned to MORE THAN ONE row — must always be empty. */
  duplicateIds: string[];
  /** distinct content keys that hashed to the same base id (a true FNV
   *  collision, disambiguated by ordinal but reported so it is never silent). */
  hashCollisions: Array<{ baseId: string; keys: string[] }>;
  /** rows that reached the audit without an id — must always be empty. */
  missingIds: number;
}

/**
 * THE single stamping pass. Assigns `bomLineId` to every row in `rows`,
 * in place, and returns the audit. Idempotent for a fixed collection: the same
 * rows in the same order always produce the same ids, and re-running it
 * re-derives the identical values.
 */
export function stampBomLineIds<T extends BomLineIdentityInput & { bomLineId?: string }>(
  rows: T[],
): BomLineIdAudit {
  const usedByBase = new Map<string, number>();          // baseId → rows seen
  const keysByBase = new Map<string, Set<string>>();     // baseId → distinct keys
  for (const row of rows) {
    const key = bomLineIdentityKey(row);
    const base = bomLineIdFor(row);
    const seen = usedByBase.get(base) ?? 0;
    usedByBase.set(base, seen + 1);
    let keys = keysByBase.get(base);
    if (!keys) { keys = new Set(); keysByBase.set(base, keys); }
    keys.add(key);
    row.bomLineId = seen === 0 ? base : `${base}-${seen + 1}`;
  }
  return auditBomLineIds(rows);
}

/** Verify the multiset invariant over an already-stamped collection. */
export function auditBomLineIds<T extends BomLineIdentityInput & { bomLineId?: string }>(
  rows: readonly T[],
): BomLineIdAudit {
  const seen = new Map<string, number>();
  const keysByBase = new Map<string, Set<string>>();
  let missingIds = 0;
  for (const row of rows) {
    const id = row.bomLineId;
    if (!id) { missingIds++; continue; }
    seen.set(id, (seen.get(id) ?? 0) + 1);
    const base = bomLineIdFor(row);
    let keys = keysByBase.get(base);
    if (!keys) { keys = new Set(); keysByBase.set(base, keys); }
    keys.add(bomLineIdentityKey(row));
  }
  return {
    total: rows.length,
    unique: seen.size,
    duplicateIds: [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id),
    hashCollisions: [...keysByBase.entries()]
      .filter(([, keys]) => keys.size > 1)
      .map(([baseId, keys]) => ({ baseId, keys: [...keys] })),
    missingIds,
  };
}
