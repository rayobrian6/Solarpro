// ═══════════════════════════════════════════════════════════════════════════
// W3 §12 — PENDING STRUCTURAL ENGINEERING REVIEW banner.
// ONE renderer, wired to snapshot.permitReadiness (via structuralBanner()).
// Every planset structural sheet prints this when the snapshot has structural
// blockers or is not permit-ready — replacing the ad-hoc per-sheet conclusion
// strings. HTML variant for the HTML sheets (PV-4C / SCHED / CERT / PE-1 /
// COVER); SVG variant for the drawing sheets (PV-1 / PV-3).
// ═══════════════════════════════════════════════════════════════════════════
import type { PermitDesignSnapshot } from '../snapshot/types';
import type { PermitInput } from '../types';
import { structuralBanner, type StructuralBanner } from '../snapshot/structuralProjection';
import { resolvePlansetProfile, isCompactProfile, sheetIsDirectlyGated } from '../plansetProfile';

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
  // W10 (RP-D): render the UNION of every active blocker (b.blockers already IS
  // the union from the registry) — NEVER the structural-else-everything ternary
  // that hid the equipment-identity / code / tap / fill / identity blockers.
  // Cap the compact banner and point at RS-1 for the full registry.
  const _all = b.blockers;
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
  const _permit = !!opts?.input && isCompactProfile(resolvePlansetProfile(opts.input));
  const _registryRef = _permit ? 'see the project review record in the application' : 'see sheet RS-1 (REVIEW STATUS)';
  const reasons = _shown.map(x => `<li style="margin:0 0 1px 0;">${esc(x.message)}</li>`).join('')
    + (_more > 0 ? `<li style="margin:0 0 1px 0;font-style:italic;">+ ${_more} more unresolved release requirement${_more === 1 ? '' : 's'} — ${_registryRef}</li>` : '');
  const pad = opts?.compact ? '4px 8px' : '8px 12px';
  // RGM §4 — the package TOTAL line, single-sourced from the release-gate model
  // (releasePackageLine on the projection). Rendered above the requirement rows
  // so a reviewer reads "7 root gates" before the 19 child requirements.
  const _packageLine = b.releasePackageLine && _permit
    ? b.releasePackageLine.replace('SEE RS-1 FOR ALL', 'SEE THE PROJECT REVIEW RECORD FOR ALL')
    : b.releasePackageLine;
  const gateLine = _packageLine
    ? `<div data-release-package-line="1" style="font-weight:900;font-size:8.5px;letter-spacing:0.4px;color:#7f1d1d;text-align:center;margin-top:2px;">${esc(_packageLine)}</div>`
    : '';
  return `
  <div class="struct-review-banner" style="margin:${opts?.compact ? '4px 0' : '6px 0'};border:2px solid #b91c1c;background:#fef2f2;padding:${pad};page-break-inside:avoid;">
    <div style="font-weight:900;font-size:11px;letter-spacing:0.6px;color:#b91c1c;text-align:center;">${esc(b.line1)}</div>
    <div style="font-weight:900;font-size:10px;letter-spacing:0.6px;color:#b91c1c;text-align:center;margin-top:1px;">${esc(b.line2)}</div>
    ${gateLine}
    ${reasons ? `<ul style="margin:4px 0 0 0;padding-left:16px;font-size:7.5px;color:#7f1d1d;line-height:1.35;">${reasons}</ul>` : ''}
  </div>`;
}

/** SVG banner strip for drawing sheets. Draws a red bar at (x,y,w). Returns ''
 *  when permit-ready. Height is fixed (~26 px). */
export function structuralBannerSvg(
  src: PermitDesignSnapshot | StructuralBanner | null | undefined,
  x: number, y: number, w: number,
): string {
  const b: StructuralBanner = isBanner(src) ? src : structuralBanner(src ?? null);
  if (!b.show) return '';
  const h = 26;
  return `
    <g class="struct-review-banner">
      <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fef2f2" stroke="#b91c1c" stroke-width="1.5"/>
      <text x="${x + w / 2}" y="${y + 11}" text-anchor="middle" font-family="Arial,sans-serif" font-size="9" font-weight="bold" fill="#b91c1c" letter-spacing="0.6">${esc(b.line1)}</text>
      <text x="${x + w / 2}" y="${y + 21}" text-anchor="middle" font-family="Arial,sans-serif" font-size="8" font-weight="bold" fill="#b91c1c" letter-spacing="0.6">${esc(b.line2)}</text>
    </g>`;
}

function isBanner(x: unknown): x is StructuralBanner {
  return !!x && typeof x === 'object' && 'show' in (x as Record<string, unknown>)
    && 'line1' in (x as Record<string, unknown>);
}
