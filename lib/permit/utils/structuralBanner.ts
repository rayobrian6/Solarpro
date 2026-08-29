// ═══════════════════════════════════════════════════════════════════════════
// THE PER-SHEET RELEASE BANNER.
//
// ONE renderer, wired to snapshot.permitReadiness (via structuralBanner()). It
// renders on the sheets whose own content an unresolved requirement gates.
//
// 2026-08-28 — three things changed here, and the old header comment described
// none of them correctly (it claimed an SVG variant served PV-1 / PV-3; that
// function had zero call sites and has been deleted, and it claimed the HTML
// variant served SCHED / CERT / PE-1 / COVER, which it never did — CERT and PE-1
// have their own banner in certPages.ts, and the cover has releaseStatusBlock).
//
//   1. The headline is DERIVED. It printed two constants — 'PENDING STRUCTURAL
//      ENGINEERING REVIEW' / 'NOT FOR PERMIT SUBMISSION' — on every gated sheet
//      whatever the package's state, so a package awaiting only a signature was
//      indistinguishable from one missing ten facts, and a package whose only
//      open item was the project NAME was told it had a structural problem.
//      Both lines and the palette now come from the release phase.
//
//   2. A row prints its SHEET LINE, not its explanation. The registry
//      explanation is written for the review record and runs to paragraphs: on
//      the audited PV-3 the longest one was 134 words of 'GOVERNING-CANDIDATE
//      ENVELOPE: the weakest screened candidate carries 21600 in-lb against a
//      demand of 2433 in-lb (M = w·L²/8…)'. A drawing gets one actionable line.
//
//   3. An ADVISORY reads as an advisory. Severity was dropped on the way here,
//      so a procurement note rendered as an undifferentiated red bullet — one
//      line below the gate line that had just counted it separately.
// ═══════════════════════════════════════════════════════════════════════════
import type { PermitDesignSnapshot } from '../snapshot/types';
import type { PermitInput } from '../types';
import { structuralBanner, bannerRequirementsForSheet, type StructuralBanner } from '../snapshot/structuralProjection';
import { resolvePlansetProfile, isCompactProfile, sheetIsDirectlyGated } from '../plansetProfile';
// TAC WS-18 — one cross-sheet reference resolver over the ACTIVE sheet index.
import { sheetRef } from './sheetRef';
import { RELEASE_PHASE_STYLE } from '../snapshot/releasePhase';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** HTML banner block. Returns '' when the design is permit-ready (nothing to
 *  warn). Pass either a snapshot or a pre-computed banner. */
export function structuralBannerHtml(
  src: PermitDesignSnapshot | StructuralBanner | null | undefined,
  opts?: { compact?: boolean; input?: PermitInput | null; sheetId?: string | null },
): string {
  const b: StructuralBanner = isBanner(src) ? src : structuralBanner(src ?? null);
  if (!b.show) return '';
  // AAC WS-10 — in the PERMIT profile the package headline is stated ONCE, on
  // the cover. A sheet keeps its banner only while its OWN content is gated —
  // i.e. an unresolved requirement in the registry names this sheet in its
  // affectedSheets. Structural sheets therefore keep the banner while a
  // structural gate is open; a sheet with no gated content stops repeating the
  // package status. Nothing is hidden: the requirement is still in the
  // registry, still counted by the gates, and still named on the cover line.
  // (post-AAC: both compact profiles — permit AND design-review — share the
  // stated-once-on-the-cover discipline; the full profile keeps every banner.)
  if (opts?.input && isCompactProfile(resolvePlansetProfile(opts.input)) && !sheetIsDirectlyGated(opts.input, opts.sheetId)) return '';
  // W10 (RP-D): render every active blocker from the registry union — NEVER the
  // structural-else-everything ternary that hid the equipment-identity / code /
  // tap / fill / identity blockers.
  // TAC WS-17: ...but a sheet enumerates the requirements gating ITS OWN content,
  // not the package union. The union printed identically on PV-1 / PV-1B / PV-3 /
  // PV-4C, so a site plan lectured the reviewer about Q-Cable footage and an
  // attachment detail about unmeasured tap conductors. The remaining
  // package-wide requirements are stated as a count with a pointer, and the
  // cover's release-status block still carries the package totals.
  const _perSheet = bannerRequirementsForSheet(b, opts?.sheetId);
  const _all = _perSheet.own;
  const _cap = 8;
  const _shown = _all.slice(0, _cap);
  const _more = _all.length - _shown.length;
  // RGM §4/§6 — the REMAINDER is a PACKAGE-level statement, so it is stated in
  // GATE semantics: "N more unresolved requirements" (children of root gates),
  // never "N more active release blockers" (which read as N independent
  // failures). The requirement rows themselves are unchanged — every active
  // requirement the old banner enumerated is still enumerated here.
  // AAC WS-10 — RS-1 is not in the permit set, so a banner that survives there
  // points at the record that DOES hold every requirement (the in-app review
  // record). Same count, same requirements — only the reference is corrected;
  // a dangling "see sheet RS-1" would be a lie about the package.
  // TAC WS-18 — that decision is no longer re-derived from the profile here: it
  // is the ONE cross-sheet resolver, asked which sheet (if any) this package
  // holds the release requirements on.
  const _rs = sheetRef(opts?.input ?? null, 'review-status');
  const _permit = !_rs.present;
  const _registryRef = _rs.present ? `see sheet ${_rs.sheetId} (REVIEW STATUS)` : _rs.see;
  // TAC WS-17 — the remainder line distinguishes the two kinds of "more": rows
  // this sheet's own list was capped at, and requirements that gate OTHER sheets'
  // content. Both are counted; neither is silently dropped.
  // ONE COUNTING BASIS. This counted from `b.blockers`, which includes
  // advisories, so it re-labelled an advisory an 'unresolved release
  // requirement' one line under the gate line that had just distinguished it.
  const _otherSheets = _perSheet.otherCount;
  const _remainder = _more + _otherSheets;
  const _remainderNoun = 'unresolved item';
  const _italic = 'margin:0 0 1px 0;font-style:italic;';
  // A DRAWING CARRIES THE SHEET LINE. `message` is the review-record
  // explanation; it stays in the registry and RS-1 prints it in full. A code
  // with no declared line names itself and points at the record — it never
  // falls back to the paragraph this replaced.
  const _line = (x: { code: string; sheetLine: string | null }): string =>
    x.sheetLine ?? `${x.code} — see the project review record.`;
  const _blockingRows = _shown.filter(x => x.severity !== 'warning');
  const _advisoryRows = _shown.filter(x => x.severity === 'warning');
  const reasons = _shown.length
    ? _blockingRows.map(x => `<li style="margin:0 0 1px 0;" data-banner-requirement="${esc(x.code)}">${esc(_line(x))}</li>`).join('')
      // An advisory is LABELLED. It is not a release blocker and must not read
      // as one — the gate line one row above already counts it separately.
      + _advisoryRows.map(x => `<li style="margin:0 0 1px 0;opacity:0.85;" data-banner-requirement="${esc(x.code)}" data-banner-advisory="1"><strong>ADVISORY — </strong>${esc(_line(x))}</li>`).join('')
      + (_remainder > 0
        ? `<li style="${_italic}">+ ${_remainder} more ${_remainderNoun}${_remainder === 1 ? '' : 's'}`
          + `${_otherSheets > 0 ? ' elsewhere in this package' : ''} — ${_registryRef}</li>`
        : '')
    // A sheet whose OWN content carries no open requirement still shows the
    // package state (line1/line2 + the gate line) — it just says so plainly
    // rather than repeating another sheet's requirement list.
    : (_remainder > 0
      ? `<li style="${_italic}">Nothing on this sheet is gated; `
        + `${_remainder} ${_remainderNoun}${_remainder === 1 ? '' : 's'} elsewhere in this package — ${_registryRef}</li>`
      : '');
  const pad = opts?.compact ? '4px 8px' : '8px 12px';
  // RGM §4 — the package TOTAL line, single-sourced from the release-gate model
  // (releasePackageLine on the projection). Rendered above the requirement rows
  // so a reviewer reads "7 root gates" before the 19 child requirements.
  // TAC WS-18 — the package line is snapshot-baked prose; the render-time
  // reference pass (normalizeAbsentSheetReferences, applied over the assembled
  // sheets) degrades its RS-1 pointer when the package omits RS-1. Kept here for
  // standalone banner renders that never reach the assembly.
  const _packageLine = b.releasePackageLine && _permit
    ? b.releasePackageLine.replace('SEE RS-1 FOR ALL', `SEE ${_rs.short.toUpperCase()} FOR ALL`)
    : b.releasePackageLine;
  const gateLine = _packageLine
    ? `<div data-release-package-line="1" style="font-weight:900;font-size:8.5px;letter-spacing:0.4px;color:${RELEASE_PHASE_STYLE[b.kind].fg};text-align:center;margin-top:2px;">${esc(_packageLine)}</div>`
    : '';
  // The palette is the PHASE's, so no sheet decides for itself whether the
  // package looks alarming. A workflow state (awaiting a signature) is amber,
  // not the same red as a package missing ten facts.
  const st = RELEASE_PHASE_STYLE[b.kind];
  return `
  <div class="struct-review-banner" data-release-phase="${esc(b.phaseId)}" data-release-phase-kind="${esc(b.kind)}"
       style="margin:${opts?.compact ? '4px 0' : '6px 0'};border:2px solid ${st.border};background:${st.bg};padding:${pad};page-break-inside:avoid;">
    <div data-banner-phase-label="1" style="font-weight:900;font-size:11px;letter-spacing:0.6px;color:${st.fg};text-align:center;">${esc(b.line1)}</div>
    <div style="font-weight:900;font-size:10px;letter-spacing:0.6px;color:${st.fg};text-align:center;margin-top:1px;">${esc(b.line2)}</div>
    ${gateLine}
    ${reasons ? `<ul style="margin:4px 0 0 0;padding-left:16px;font-size:7.5px;color:${st.fg};line-height:1.35;">${reasons}</ul>` : ''}
  </div>`;
}

// structuralBannerSvg() was DELETED (2026-08-28). It had zero call sites
// repo-wide while this file's own header advertised it as the renderer for
// PV-1 / PV-3 — so anyone told to "also update the SVG variant" would have
// edited a function nothing renders, and believed the drawing sheets were done.
// The drawing sheets use the HTML banner above. If an SVG strip is ever needed,
// write it against the phase (b.kind / b.line1 / b.line2), not against constants.

function isBanner(x: unknown): x is StructuralBanner {
  return !!x && typeof x === 'object' && 'show' in (x as Record<string, unknown>)
    && 'line1' in (x as Record<string, unknown>);
}
