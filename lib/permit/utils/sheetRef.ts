// ═══════════════════════════════════════════════════════════════════════════
// TAC WS-18 — CROSS-SHEET REFERENCES resolved against the ACTIVE package.
//
// The DESIGN_REVIEW package contained 16 sheets and referred the reader to
// RS-1 twenty-five times and to PV-6 three times. Neither sheet was in it.
// Those references were authored as literals on ~20 independent surfaces
// (snapshot builders, banner renderers, page bodies, BOM row reasons), and each
// surface that DID know about the compact profiles rewrote the wording its own
// way — structuralBanner string-replaced the package line, releaseStatusBlock
// had a compact variant, everything else printed the dangling sheet id.
//
// Two mechanisms replace all of that, both driven by ONE fact — the sheet index
// the package actually generated (snapshot.projectAuthority.sheetIndex, which
// computePlansetManifest produces and the page assembly mirrors):
//
//   1. sheetRef(input, target)  — for a reference whose TARGET must be resolved:
//      "where does THIS package hold the disconnect directory?" (PV-6 when the
//      sheet exists, the merged labels sheet when it was composed onto PV-5).
//
//   2. normalizeAbsentSheetReferences(html, ids) — the render-time honesty pass
//      over assembled sheets. A reference to a sheet the package does NOT
//      contain degrades to the record that does hold the content. Prose only:
//      the pass never touches tags, attributes or comments, so the merge
//      provenance stamp data-merged-sheet="PV-6" and every tb-sheet-id survive.
//
// findDanglingSheetReferences is the fail-closed check the generator runs after
// the pass: if a NEW surface invents a reference to an absent sheet, the render
// throws rather than shipping a package that points at a sheet it omits.
// ═══════════════════════════════════════════════════════════════════════════

import type { PermitInput } from '../types';
import { peekSnapshot } from '../snapshot/read';
import { buildSheetManifest } from '../sheetManifest';
import { resolvePlansetProfile, certificationIsCompleted } from '../plansetProfile';

/** A semantic destination, NOT a sheet id — the id is what this resolves to. */
export type SheetRefTarget =
  /** every open release requirement, in full */
  | 'review-status'
  /** the NEC 705.10 / 690.56(B) plaque + disconnect directory */
  | 'disconnect-directory'
  /** the per-section physical conductor schedule (ampacity chain per section) */
  | 'physical-section-schedule';

export interface SheetReference {
  /** the sheet in the ACTIVE package that holds this content; null if none does */
  sheetId: string | null;
  /** true when a sheet in this package holds it */
  present: boolean;
  /** 'sheet PV-5' | 'the project review record' — for use mid-sentence */
  name: string;
  /** 'see sheet PV-5' | 'see the project review record in the application' */
  see: string;
  /** 'PV-5' | 'the project review record' — for parentheticals and lists */
  short: string;
}

interface TargetSpec {
  /** ordered candidates: the dedicated sheet first, then the sheet it merges onto */
  candidates: readonly string[];
  /** wording when NO candidate is in the package */
  absent: { short: string; see: string };
}

const TARGETS: Record<SheetRefTarget, TargetSpec> = {
  'review-status': {
    // RS-1(.n) is a full-profile sheet: the compact packages carry the release
    // status as the cover block + per-sheet banners, and the complete registry
    // lives in the project's review record in the application.
    candidates: ['RS-1'],
    absent: {
      short: 'the project review record',
      see: 'see the project review record in the application',
    },
  },
  'disconnect-directory': {
    // PV-6 composes onto the merged labels sheet in the compact profiles.
    candidates: ['PV-6', 'PV-5'],
    absent: { short: 'the disconnect directory', see: 'see the disconnect directory' },
  },
  'physical-section-schedule': {
    // Post-AAC: the physical section schedule is PV-4B.1 (it was never on E-1).
    candidates: ['PV-4B.1', 'PV-4B'],
    absent: { short: 'the conductor schedule', see: 'see the conductor schedule' },
  },
};

/** Prose an ABSENT sheet's references degrade to. Keyed by sheet id; only ids
 *  listed here are rewritten (and enforced) by the normalization pass. */
const ABSENT_SHEET_PROSE: Record<string, { short: string; see: string }> = {
  'RS-1': TARGETS['review-status'].absent,
};

/**
 * The ordered sheet ids the package ACTUALLY generated.
 *
 * Primary source: snapshot.projectAuthority.sheetIndex — computePlansetManifest's
 * output, which the cover prints and the page assembly mirrors. When no snapshot
 * is attached (unit-level render of a single page), fall back to the profile's
 * own manifest branch so the answer is still derived from buildSheetManifest and
 * never from a second hand-maintained list.
 */
export function activeSheetIds(input: PermitInput | null | undefined): readonly string[] {
  // peekSnapshot dereferences its argument, so a standalone render (no input at
  // all — the banner unit tests, the SLD route) must not reach it.
  const idx = input ? peekSnapshot(input)?.projectAuthority?.sheetIndex : null;
  if (Array.isArray(idx) && idx.length) {
    return idx.map(s => String((s as { id?: unknown }).id ?? '')).filter(Boolean);
  }
  return buildSheetManifest({
    pv1Title: '', pv3Title: '',
    profile: resolvePlansetProfile(input),
    certificationCompleted: input ? certificationIsCompleted(input) : false,
  }).map(s => s.id);
}

/** Resolve a semantic destination to the sheet this package holds it on. */
export function sheetRef(input: PermitInput | null | undefined, target: SheetRefTarget): SheetReference {
  const spec = TARGETS[target];
  const active = activeSheetIds(input);
  const hit = spec.candidates.find(id => active.includes(id)) ?? null;
  if (!hit) {
    return { sheetId: null, present: false, name: spec.absent.short, see: spec.absent.see, short: spec.absent.short };
  }
  return { sheetId: hit, present: true, name: `sheet ${hit}`, see: `see sheet ${hit}`, short: hit };
}

// ── the normalization pass ────────────────────────────────────────────────────

/** Split into segments, marking which are TEXT (rewritable) vs markup (never).
 *  Handles tags, comments and the `<style>` / `<script>` bodies uniformly: any
 *  `<…>` run and any `<!--…-->` run is markup. */
function segments(html: string): { text: boolean; s: string }[] {
  const out: { text: boolean; s: string }[] = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) { out.push({ text: true, s: html.slice(i) }); break; }
    if (lt > i) out.push({ text: true, s: html.slice(i, lt) });
    let end: number;
    if (html.startsWith('<!--', lt)) {
      const c = html.indexOf('-->', lt + 4);
      end = c < 0 ? html.length : c + 3;
    } else {
      const gt = html.indexOf('>', lt);
      end = gt < 0 ? html.length : gt + 1;
    }
    out.push({ text: false, s: html.slice(lt, end) });
    i = end;
  }
  return out;
}

/** Was the reference introduced by an ALL-CAPS "SEE"? Then the replacement is
 *  upper-cased so "SEE RS-1 FOR ALL 15 REQUIREMENTS" stays a caps headline. */
function precededByCapsSee(text: string, at: number): boolean {
  const before = text.slice(Math.max(0, at - 24), at)
    .replace(/&[a-zA-Z]+;/g, ' ')          // entities are lower-case markup, not prose
    .replace(/[^A-Za-z\s]/g, ' ');
  return /(^|\s)SEE\s+$/.test(before);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Rewrite every PROSE reference to a sheet this package does not contain.
 * `activeIds` is the package's real sheet list (see activeSheetIds).
 */
export function normalizeAbsentSheetReferences(html: string, activeIds: readonly string[]): string {
  const absent = Object.keys(ABSENT_SHEET_PROSE).filter(id => !activeIds.includes(id));
  if (!absent.length) return html;
  return segments(html).map(seg => {
    if (!seg.text) return seg.s;
    let s = seg.s;
    for (const id of absent) {
      const prose = ABSENT_SHEET_PROSE[id];
      const idRe = escapeRe(id);
      // 1. the fully-formed pointer: "see sheet RS-1 (REVIEW STATUS)". Case is
      //    carried by the matched "see"/"SEE" so caps headlines stay caps.
      s = s.replace(new RegExp(`(see)\\s+sheet\\s+${idRe}(?:\\.\\d+)?\\s*(?:\\([^)]*\\))?`, 'gi'),
        (_m, see: string) => (see === see.toUpperCase() ? prose.see.toUpperCase() : prose.see));
      // 2. "sheet RS-1" / "sheet RS-1 (REVIEW STATUS)" without the verb
      s = s.replace(new RegExp(`sheet\\s+${idRe}(?:\\.\\d+)?\\s*(?:\\([^)]*\\))?`, 'gi'), prose.short);
      // 3. the bare id, continuation sheets included. An introducing ALL-CAPS
      //    "SEE" means the sentence is a caps headline.
      const bare = new RegExp(`\\b${idRe}(?:\\.\\d+)?\\b`, 'g');
      const src = s;
      s = s.replace(bare, (_m, off: number) =>
        (precededByCapsSee(src, off) ? prose.short.toUpperCase() : prose.short));
    }
    return s;
  }).join('');
}

/**
 * FAIL-CLOSED CHECK — prose references to sheets the package omits.
 * Run after the normalization pass: anything left is a NEW surface inventing a
 * dangling reference, and the package must not ship pointing at a sheet it does
 * not contain. Returns the offending ids (deduped), with a short context each.
 */
export function findDanglingSheetReferences(
  html: string, activeIds: readonly string[],
): { sheetId: string; context: string }[] {
  const known = Object.keys(ABSENT_SHEET_PROSE);
  const absent = known.filter(id => !activeIds.includes(id));
  if (!absent.length) return [];
  const out: { sheetId: string; context: string }[] = [];
  const seen = new Set<string>();
  for (const seg of segments(html)) {
    if (!seg.text) continue;
    for (const id of absent) {
      const re = new RegExp(`\\b${escapeRe(id)}(?:\\.\\d+)?\\b`, 'g');
      let m: RegExpExecArray | null;
      while ((m = re.exec(seg.s)) !== null) {
        if (seen.has(id)) break;
        seen.add(id);
        out.push({ sheetId: id, context: seg.s.slice(Math.max(0, m.index - 60), m.index + 30).trim() });
      }
    }
  }
  return out;
}
