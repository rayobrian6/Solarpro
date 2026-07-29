// ═══════════════════════════════════════════════════════════════════════════
// planset-pagefit.mjs — TRUE geometry-based page-fit gate (CLOSEOUT §15).
//
// `.page { overflow:hidden }` hides content without adding a page, so a
// page-count gate cannot see a clipped page conclusion / footer. This harness
// renders a permit HTML at the fixed 17x11 envelope (96dpi) and, per logical
// sheet, measures the lowest NON-SVG descendant against the printable box
// (11in minus the page's bottom padding). Any element extending meaningfully
// past the box — even clipped under overflow:hidden — is a hard failure.
// SVG-internal geometry (intentional aerial/detail bleed on map sheets) is
// excluded. Exits NON-ZERO when any sheet clips.
//
//   Usage: node scripts/planset-pagefit.mjs <permit.html> [--png <outDir>]
//
// Skips (exit 0 with a notice) when playwright/chromium is unavailable so it is
// safe to wire into environments without a browser binary.
//
// POST-AAC REGRESSION REPAIR — sheet-specific gates + print pass. The blanket
// "SVG bleed excluded" rule exists for the MAP sheets (PV-1 aerial artwork is
// deliberately bled to the page edge); it is exactly the blind spot that let a
// severely clipped E-1 single-line diagram pass every prior run. The SLD svg is
// DRAWING CONTENT, so it gets its own gate set:
//   E-1  — `.sld-wrap` (the deterministic drawing box) has no hidden overflow;
//          the rendered svg bounding box sits entirely INSIDE the wrapper;
//          the svg carries a valid viewBox + preserveAspectRatio and FILLS the
//          wrapper on at least one axis (contain-fit, never a letterboxed
//          strip); the svg's internal content bbox stays inside its viewBox
//          (nothing cropped away by the canvas); expected SLD landmarks
//          (LEGEND / UTILITY / GROUNDING) are present.
//   PV-4C — the 'CONTINUED ON PV-4C.1' continuation strip is fully visible
//          inside its clip container and the container has no meaningful
//          hidden overflow.
// Both gate sets run under SCREEN media and again under PRINT media emulation.
// ═══════════════════════════════════════════════════════════════════════════
import path from 'path';
import fs from 'fs';

const htmlPath = process.argv[2];
if (!htmlPath) {
  console.error('usage: node scripts/planset-pagefit.mjs <permit.html> [--png <outDir>]');
  process.exit(2);
}
const pngIdx = process.argv.indexOf('--png');
const pngDir = pngIdx > -1 ? process.argv[pngIdx + 1] : null;
const jsonIdx = process.argv.indexOf('--json');
const jsonOut = jsonIdx > -1 ? process.argv[jsonIdx + 1] : null;

const CLIP_TOL_IN = 0.5; // clean full-bleed sheets sit ≤ ~0.38in below the box

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.warn('[pagefit] playwright not installed — skipping geometry page-fit (exit 0).');
  process.exit(0);
}
let browser;
try {
  browser = await chromium.launch();
} catch {
  console.warn('[pagefit] chromium binary unavailable — skipping geometry page-fit (exit 0).');
  process.exit(0);
}

if (pngDir) fs.mkdirSync(pngDir, { recursive: true });

const page = await browser.newPage({ viewport: { width: 1632, height: 1056, deviceScaleFactor: 1 } });
const url = 'file:///' + path.resolve(htmlPath).split(path.sep).join('/');
await page.goto(url, { waitUntil: 'networkidle' }).catch(() => {});
await page.waitForTimeout(400);

// §19 (closeout 2026-07-23) — a clip is not only a PAGE-box overrun. A block
// TALLER than its OWN hidden-overflow container (a nested `overflow:hidden` /
// `clip` box) is silently truncated even though the page itself fits, and the
// sheet-level scan (lowest descendant vs page box) cannot see it. This second
// pass measures every vertical clip container by its LAYOUT metrics
// scrollHeight − clientHeight — the exact number of CSS px clipped off the
// bottom. Layout metrics are viewport/scale-invariant (unlike getBoundingClientRect,
// which the planset's fit-to-width scale transform distorts). Reports container
// id/class, its box, the deepest overflowing descendant, and the clip amount.
// PPC gate 17 — page-fit must detect HORIZONTAL clipping as well as vertical.
// `overflow:hidden` clips on BOTH axes, so a table/row wider than its container
// (a schedule column set, a wide note bar) is severed on the right edge exactly
// as silently as an over-tall block is severed on the bottom — and the
// bottom-only scan above could never see it. This adds the mirror-image pass:
// per sheet, the RIGHTMOST non-SVG descendant vs the printable box width, plus a
// sub-sheet internal scan of every horizontal clip container measured by its own
// scrollWidth − clientWidth. Same rules as the Y pass: layout metrics (scale-
// invariant), SVG bleed excluded, only real content counts.
const INTERNAL_CLIP_TOL_PX = 2;   // < this = sub-pixel/rounding, not a real clip
const report = await page.evaluate((internalTolPx) => {
  const clipsY = (root) => {
    const cs = getComputedStyle(root);
    return cs.overflowY === 'hidden' || cs.overflowY === 'clip'
        || cs.overflow === 'hidden' || cs.overflow === 'clip';
  };
  const clipsX = (root) => {
    const cs = getComputedStyle(root);
    return cs.overflowX === 'hidden' || cs.overflowX === 'clip'
        || cs.overflow === 'hidden' || cs.overflow === 'clip';
  };
  /** X twin of nonSvgClip: the deepest real (non-SVG) overflow past the container's
   *  content RIGHT edge, in layout px. */
  const nonSvgClipX = (c, scale) => {
    const cr = c.getBoundingClientRect();
    const ccs = getComputedStyle(c);
    const cPadR = parseFloat(ccs.paddingRight) || 0;
    const contentRightLayout = c.clientLeft + (c.clientWidth - cPadR);
    let over = 0, wEl = '';
    for (const el of c.querySelectorAll('*')) {
      if (el.tagName.toLowerCase() === 'svg' || el.closest('svg')) continue;
      const ecs = getComputedStyle(el);
      if (ecs.position === 'absolute' || ecs.position === 'fixed') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if ((el.textContent || '').trim() === '' && r.width < 4) continue;
      const layoutRightFromCLeft = (r.right - cr.left) / scale;
      const ov = layoutRightFromCLeft - contentRightLayout;
      if (ov > over) { over = ov; wEl = (el.className || el.tagName) + ' :: ' + (el.textContent || '').trim().slice(0, 40); }
    }
    return { over, wEl };
  };
  // For a clip container, measure how much of the clipped overflow is real
  // NON-SVG CONTENT (vs an intentionally-oversized <svg> drawing cropped to a
  // viewport — the same "SVG bleed excluded" rule the page-box scan uses).
  // Scale-corrected: the planset scales to fit width, so rendered rects are
  // divided by the per-page scale to recover layout px. Returns the deepest
  // non-SVG overflow (px) and the element the clip severs.
  const nonSvgClip = (c, scale) => {
    const cr = c.getBoundingClientRect();
    const ccs = getComputedStyle(c);
    const cPadB = parseFloat(ccs.paddingBottom) || 0;
    const contentBottomLayout = c.clientTop + (c.clientHeight - cPadB);
    let over = 0, wEl = '';
    for (const el of c.querySelectorAll('*')) {
      if (el.tagName.toLowerCase() === 'svg' || el.closest('svg')) continue;
      const ecs = getComputedStyle(el);
      if (ecs.position === 'absolute' || ecs.position === 'fixed') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if ((el.textContent || '').trim() === '' && r.height < 4) continue;
      const layoutBottomFromCTop = (r.bottom - cr.top) / scale;
      const ov = layoutBottomFromCTop - contentBottomLayout;
      if (ov > over) { over = ov; wEl = (el.className || el.tagName) + ' :: ' + (el.textContent || '').trim().slice(0, 40); }
    }
    return { over, wEl };
  };
  const pages = [...document.querySelectorAll('.page')];
  return pages.map((pg, i) => {
    const cs = getComputedStyle(pg);
    const padB = parseFloat(cs.paddingBottom) || 0;
    const padR = parseFloat(cs.paddingRight) || 0;
    const pr = pg.getBoundingClientRect();
    const contentBottom = pg.clientHeight - padB;
    const pgScaleX = pr.width / pg.offsetWidth;
    const contentRight = pg.clientWidth - padR;
    let maxBottom = 0, worst = '';
    let maxRight = 0, worstX = '';
    pg.querySelectorAll('*').forEach(el => {
      if (el.closest('svg') || el.tagName.toLowerCase() === 'svg') return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      const rel = r.bottom - pr.top;
      if (rel > maxBottom) { maxBottom = rel; worst = (el.className || el.tagName) + ' :: ' + (el.textContent || '').trim().slice(0, 44); }
      // X pass — layout px (divide out the fit-to-width scale) vs the printable box.
      // The page's RIGHT padding reserves the vertical title-block strip, which is
      // absolutely positioned INSIDE that reserved band by design; an absolutely
      // positioned box is placed, not laid out, so it can never be "pushed off" the
      // printable area — exactly the exclusion the internal scan already applies.
      const ecs = getComputedStyle(el);
      if (ecs.position === 'absolute' || ecs.position === 'fixed') return;
      if (el.closest('.title-block')) return;
      const relX = (r.right - pr.left) / pgScaleX;
      if (relX > maxRight) { maxRight = relX; worstX = (el.className || el.tagName) + ' :: ' + (el.textContent || '').trim().slice(0, 44); }
    });

    // ── sub-sheet internal clip scan (scale-invariant layout metrics) ──────
    const pgScale = pr.height / pg.offsetHeight;   // rendered/layout (uniform per page)
    const internal = [];
    const containers = [pg, ...pg.querySelectorAll('*')];
    for (const c of containers) {
      if (c.tagName.toLowerCase() === 'svg' || c.closest('svg')) continue;
      if (!clipsY(c)) continue;
      const clipPx = c.scrollHeight - c.clientHeight;   // total px clipped off the bottom
      if (clipPx <= internalTolPx) continue;
      // MEANINGFUL only when real (non-SVG) content is what's severed — an
      // oversized <svg> cropped to its viewport is intentional bleed, not a clip.
      const ns = nonSvgClip(c, pgScale);
      const meaningful = ns.over > internalTolPx;
      internal.push({
        container: (c.className || c.tagName).toString().slice(0, 48),
        containerBox: { scrollHeight: c.scrollHeight, clientHeight: c.clientHeight },
        element: ns.wEl,
        overflowPx: +clipPx.toFixed(1),
        contentOverflowPx: +ns.over.toFixed(1),
        axis: 'y',
        meaningful,
      });
    }
    // ── the HORIZONTAL twin of the internal scan (PPC gate 17) ─────────────
    for (const c of containers) {
      if (c.tagName.toLowerCase() === 'svg' || c.closest('svg')) continue;
      if (!clipsX(c)) continue;
      const clipPxX = c.scrollWidth - c.clientWidth;
      if (clipPxX <= internalTolPx) continue;
      const ns = nonSvgClipX(c, pgScale);
      internal.push({
        container: (c.className || c.tagName).toString().slice(0, 48),
        containerBox: { scrollWidth: c.scrollWidth, clientWidth: c.clientWidth },
        element: ns.wEl,
        overflowPx: +clipPxX.toFixed(1),
        contentOverflowPx: +ns.over.toFixed(1),
        axis: 'x',
        meaningful: ns.over > internalTolPx,
      });
    }
    // meaningful (real content) clips first; SVG-bleed clips are informational
    internal.sort((a, b) => (b.meaningful - a.meaningful) || (b.contentOverflowPx - a.contentOverflowPx));
    const internalTop = internal.slice(0, 8);
    // the GATE fails only on MEANINGFUL (real-content) internal clips.
    const meaningfulWorst = Math.max(0, ...internal.filter(x => x.meaningful && x.axis === 'y').map(x => x.contentOverflowPx));
    const meaningfulWorstX = Math.max(0, ...internal.filter(x => x.meaningful && x.axis === 'x').map(x => x.contentOverflowPx));

    const m = (pg.textContent || '').match(/\b(PV-0|RS-1\.\d|RS-1|PV-1B|PV-1|PV-3|PV-4C\.1|PV-4C|E-1|PV-4A|PV-4B|PV-5|PV-6|SCHED-\d|SCHED|APP-A|DS-\d|CERT|PE-1)\b/);
    return { i, sid: m ? m[1] : ('sheet' + i), belowByIn: +((maxBottom - contentBottom) / 96).toFixed(2), worst, hasTb: !!pg.querySelector('.title-block'),
             rightByIn: +((maxRight - contentRight) / 96).toFixed(2), worstX,
             internalClips: internalTop, internalWorstPx: +meaningfulWorst.toFixed(1),
             internalWorstPxX: +meaningfulWorstX.toFixed(1) };
  });
}, INTERNAL_CLIP_TOL_PX);

// ── POST-AAC sheet-specific gates (screen + print) ──────────────────────────
const sheetSpecific = async (mode) => page.evaluate((m) => {
  const out = { mode: m, e1: null, pv4c: null };
  // ── E-1: the SLD is CONTENT, not bleed ──────────────────────────────────
  const wrap = document.querySelector('.sld-page .sld-wrap');
  if (wrap) {
    const svg = wrap.querySelector('svg');
    const wr = wrap.getBoundingClientRect();
    const sr = svg ? svg.getBoundingClientRect() : null;
    const vb = svg ? (svg.getAttribute('viewBox') ?? '') : '';
    const vbParts = vb.trim().split(/\s+/).map(Number);
    const viewBoxOk = vbParts.length === 4 && vbParts.every(n => Number.isFinite(n)) && vbParts[2] > 0 && vbParts[3] > 0;
    const par = svg ? (svg.getAttribute('preserveAspectRatio') ?? '') : '';
    // contents bbox vs viewBox — detects drawing content cropped by the canvas.
    let contentInViewBox = false, bboxNote = '';
    try {
      const bb = svg.getBBox();
      const tol = 4; // px in user units — stroke overshoot
      contentInViewBox = viewBoxOk
        && bb.x >= vbParts[0] - tol && bb.y >= vbParts[1] - tol
        && bb.x + bb.width <= vbParts[0] + vbParts[2] + tol
        && bb.y + bb.height <= vbParts[1] + vbParts[3] + tol;
      bboxNote = `bbox ${bb.x.toFixed(0)},${bb.y.toFixed(0)} ${bb.width.toFixed(0)}×${bb.height.toFixed(0)} vs viewBox ${vb}`;
    } catch { bboxNote = 'getBBox unavailable'; }
    const svgText = svg ? (svg.textContent ?? '') : '';
    const labels = ['LEGEND', 'UTILITY', 'GROUNDING'].map(l => ({ label: l, ok: svgText.toUpperCase().includes(l) }));
    const T = 1.5;
    out.e1 = {
      svgPresent: !!svg,
      wrapClipY: +(wrap.scrollHeight - wrap.clientHeight).toFixed(1),
      wrapClipX: +(wrap.scrollWidth - wrap.clientWidth).toFixed(1),
      svgInsideWrapper: !!(sr && sr.top >= wr.top - T && sr.bottom <= wr.bottom + T
        && sr.left >= wr.left - T && sr.right <= wr.right + T),
      // contain-fit fills at least one axis — a ~267px letterboxed strip fails.
      fillsWrapper: !!(sr && (Math.abs(sr.width - wr.width) <= 3 || Math.abs(sr.height - wr.height) <= 3)),
      wrapperBox: { w: +wr.width.toFixed(0), h: +wr.height.toFixed(0) },
      svgBox: sr ? { w: +sr.width.toFixed(0), h: +sr.height.toFixed(0) } : null,
      viewBox: vb, viewBoxOk, preserveAspectRatio: par,
      parOk: par === '' || /^xM(id|in|ax)YM(id|in|ax)( meet)?$/.test(par),
      contentInViewBox, bboxNote, labels,
      labelsOk: labels.every(x => x.ok),
    };
  }
  // ── PV-4C: the continuation strip is fully visible ──────────────────────
  // The strip is the div whose leading <strong> says 'CONTINUED ON PV-4C.1:' —
  // measure the WHOLE div (its last wrapped line is what the 26.4px clip severed).
  const strip = [...document.querySelectorAll('.page div')]
    .find(d => (d.querySelector(':scope > strong')?.textContent || '').startsWith('CONTINUED ON PV-4C.1')) ?? null;
  if (strip) {
    const content = strip.closest('.page-content') ?? strip.closest('.page');
    const cr = content.getBoundingClientRect();
    const sr2 = strip.getBoundingClientRect();
    out.pv4c = {
      stripBottomPx: +sr2.bottom.toFixed(1),
      containerBottomPx: +cr.bottom.toFixed(1),
      stripFullyVisible: sr2.height > 4 && sr2.bottom <= cr.bottom + 0.5,
      contentClipY: +(content.scrollHeight - content.clientHeight).toFixed(1),
    };
  }
  return out;
}, mode);

const specificFailures = (s) => {
  const f = [];
  if (s.e1) {
    if (!s.e1.svgPresent) f.push(`[${s.mode}] E-1: no SLD svg in .sld-wrap`);
    if (s.e1.wrapClipY > 2) f.push(`[${s.mode}] E-1: .sld-wrap hidden vertical overflow ${s.e1.wrapClipY}px`);
    if (s.e1.wrapClipX > 2) f.push(`[${s.mode}] E-1: .sld-wrap hidden horizontal overflow ${s.e1.wrapClipX}px`);
    if (!s.e1.svgInsideWrapper) f.push(`[${s.mode}] E-1: rendered svg box ${JSON.stringify(s.e1.svgBox)} escapes wrapper ${JSON.stringify(s.e1.wrapperBox)}`);
    if (!s.e1.fillsWrapper) f.push(`[${s.mode}] E-1: svg ${JSON.stringify(s.e1.svgBox)} letterboxed inside wrapper ${JSON.stringify(s.e1.wrapperBox)} (fills neither axis)`);
    if (!s.e1.viewBoxOk) f.push(`[${s.mode}] E-1: invalid viewBox '${s.e1.viewBox}'`);
    if (!s.e1.parOk) f.push(`[${s.mode}] E-1: non-meet preserveAspectRatio '${s.e1.preserveAspectRatio}' (distortion risk)`);
    if (!s.e1.contentInViewBox) f.push(`[${s.mode}] E-1: drawing content cropped by the canvas — ${s.e1.bboxNote}`);
    if (!s.e1.labelsOk) f.push(`[${s.mode}] E-1: missing SLD landmark(s): ${s.e1.labels.filter(x => !x.ok).map(x => x.label).join(', ')}`);
  }
  if (s.pv4c && (!s.pv4c.stripFullyVisible || s.pv4c.contentClipY > 2)) {
    f.push(`[${s.mode}] PV-4C: continuation strip clipped (bottom ${s.pv4c.stripBottomPx} vs container ${s.pv4c.containerBottomPx}; contentClipY=${s.pv4c.contentClipY}px)`);
  }
  return f;
};

const specScreen = await sheetSpecific('screen');
await page.emulateMedia({ media: 'print' });
await page.waitForTimeout(200);
const specPrint = await sheetSpecific('print');
await page.emulateMedia({ media: 'screen' });
await page.waitForTimeout(200);
const specFails = [...specificFailures(specScreen), ...specificFailures(specPrint)];

// Horizontal tolerance is its own number: the sheets deliberately bleed the aerial
// / detail artwork to the page edge, and the page-level X scan (unlike the internal
// one) cannot exclude a non-SVG wrapper that merely CONTAINS bled artwork.
const CLIP_TOL_X_IN = 0.5;
let clipped = 0, noTb = 0, internalClipped = 0, clippedX = 0, internalClippedX = 0;
for (const r of report) {
  if (pngDir) {
    const el = (await page.$$('.page'))[r.i];
    await el.screenshot({ path: path.join(pngDir, String(r.i).padStart(2, '0') + '_' + r.sid.replace(/[^A-Za-z0-9.]/g, '') + '.png') });
  }
  const clip = r.belowByIn > CLIP_TOL_IN;
  const iClip = r.internalWorstPx > 0;
  const clipX = r.rightByIn > CLIP_TOL_X_IN;
  const iClipX = r.internalWorstPxX > 0;
  if (clip) clipped++;
  if (iClip) internalClipped++;
  if (clipX) clippedX++;
  if (iClipX) internalClippedX++;
  if (!r.hasTb) noTb++;
  console.log(
    String(r.i).padStart(2), r.sid.padEnd(9),
    'belowBy=' + String(r.belowByIn).padStart(6) + 'in',
    'rightBy=' + String(r.rightByIn).padStart(6) + 'in',
    clip ? 'CLIP-V' : '      ', clipX ? 'CLIP-H' : '      ', r.hasTb ? '' : 'NO-TITLE-BLOCK',
    iClip ? 'INTERNAL-CLIP-V ' + r.internalWorstPx + 'px' : '',
    iClipX ? 'INTERNAL-CLIP-H ' + r.internalWorstPxX + 'px' : '',
    clip ? '| ' + r.worst : '', clipX ? '| X: ' + r.worstX : '');
  if (iClip || iClipX) {
    for (const ic of r.internalClips) {
      console.log('        └─', ic.meaningful ? 'CONTENT' : 'svg-bleed', ic.axis.toUpperCase(),
        'clip=' + ic.overflowPx + 'px content=' + ic.contentOverflowPx + 'px',
        'container[' + ic.container + ']',
        ic.axis === 'x'
          ? 'scrollW=' + ic.containerBox.scrollWidth + '/clientW=' + ic.containerBox.clientWidth
          : 'scrollH=' + ic.containerBox.scrollHeight + '/clientH=' + ic.containerBox.clientHeight,
        'el[' + ic.element + ']');
    }
  }
}
for (const f of specFails) console.log('[pagefit] SHEET-SPECIFIC FAIL:', f);
if (specScreen.e1) console.log(`[pagefit] E-1 gate (screen): svg ${JSON.stringify(specScreen.e1.svgBox)} in wrap ${JSON.stringify(specScreen.e1.wrapperBox)} viewBox='${specScreen.e1.viewBox}'`);
if (specScreen.pv4c) console.log(`[pagefit] PV-4C gate (screen): strip bottom ${specScreen.pv4c.stripBottomPx} <= container ${specScreen.pv4c.containerBottomPx} clipY=${specScreen.pv4c.contentClipY}px`);
console.log(`\n[pagefit] sheets=${report.length} clipped=${clipped} internal-clipped=${internalClipped} `
  + `clipped-h=${clippedX} internal-clipped-h=${internalClippedX} missing-title-block=${noTb} sheet-specific-fails=${specFails.length}`);
if (jsonOut) {
  fs.writeFileSync(jsonOut, JSON.stringify({
    generatedAt: new Date().toISOString(),
    artifact: 'braidon-page-fit-report',
    method: 'Playwright 17×11 (96dpi); per logical sheet, lowest NON-SVG descendant vs printable box (page height − bottom padding); SVG bleed excluded. §19: plus sub-sheet internal-clip scan — every hidden-overflow container vs its own descendants. PPC gate 17: plus the HORIZONTAL twin of both passes — rightmost non-SVG descendant vs the printable width, and every horizontal clip container by scrollWidth − clientWidth.',
    axes: ['vertical', 'horizontal'],
    tolInches: CLIP_TOL_IN,
    tolInchesHorizontal: CLIP_TOL_X_IN,
    internalClipTolPx: INTERNAL_CLIP_TOL_PX,
    sheets: report.length, clipped, internalClipped, clippedHorizontal: clippedX,
    internalClippedHorizontal: internalClippedX, missingTitleBlock: noTb,
    sheetSpecific: { screen: specScreen, print: specPrint, failures: specFails },
    perSheet: report.map(r => ({ index: r.i, sheetId: r.sid, belowByIn: r.belowByIn, clipped: r.belowByIn > CLIP_TOL_IN, hasTitleBlock: r.hasTb, worstElement: r.worst || null,
      rightByIn: r.rightByIn, clippedHorizontal: r.rightByIn > CLIP_TOL_X_IN, worstElementHorizontal: r.worstX || null,
      internalWorstPx: r.internalWorstPx, internalWorstPxHorizontal: r.internalWorstPxX, internalClips: r.internalClips })),
  }, null, 2));
  console.log('[pagefit] wrote', jsonOut);
}
await browser.close();
process.exit(clipped > 0 || noTb > 0 || internalClipped > 0
  || clippedX > 0 || internalClippedX > 0 || specFails.length > 0 ? 1 : 0);
