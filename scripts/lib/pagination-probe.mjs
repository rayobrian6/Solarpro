// ═══════════════════════════════════════════════════════════════════════════
// pagination-probe.mjs — THE deterministic page-fit measurement.
//
// One module, imported by BOTH tests/planset/pagination-w9.test.ts and
// scripts/planset-pagination-compare.mjs, so the in-suite gate and any
// artifact-vs-artifact comparison are the SAME measurement by construction. A
// discrepancy between them can then only be the ARTIFACT or the ENVIRONMENT —
// never two different rulers.
//
// WHY THIS EXISTS (post-sync, 2026-07-31): a pagination failure was reported as
// three bare numbers (PV-0 +10.0px, PV-4B +15.7px, SCHED +31.9px) with no
// artifact, no element, no media mode and no font state attached. Three numbers
// cannot be reproduced, refuted or repaired. Every failure this module emits
// therefore carries its full provenance: which file (by SHA-256), which
// snapshot, which profile, which element (by unique CSS path), measured under
// which media type with which font status in which browser build.
//
// DETERMINISM CONTRACT — the measurement is only meaningful under print media:
//   • the on-screen viewer applies a fit-to-width `transform` to #sp-sheets and
//     shows a fixed #sp-toolbar; both are `!important`-reverted under print.
//     Measuring the screen viewer measures the ZOOM, not the sheet.
//   • D4: the planset EMBEDS its faces as WOFF2 (lib/permit/fonts/fontPack.ts).
//     It no longer depends on host-installed fonts, and a bare host is now the
//     SUPPORTED case. `document.fonts.status` is still recorded on every run,
//     and the embedded faces are metric-checked before anything is measured —
//     see lib/permit/fonts/fontMetricGate.mjs, which owns that rule for this
//     module AND for the live PDF export path.
//     (The line that used to sit here said "the planset embeds NO web fonts".
//     That predated D4 and was false for two months.)
// ═══════════════════════════════════════════════════════════════════════════

import {
  FONT_METRIC_PROBE,
  FONT_METRIC_PROBE_PX,
  GATED_FAMILIES,
  REQUIRED_FONT_FACES as GATE_REQUIRED_FACES,
  FONT_METRIC_TOLERANCE_PCT as GATE_TOLERANCE_PCT,
  CANONICAL_ADVANCE_SUM,
  measureAdvanceSumsInPage,
} from '../../lib/permit/fonts/fontMetricGate.mjs';

/** 17in x 11in at 96dpi — the physical sheet, exactly. */
export const SHEET_W_PX = 1632;
export const SHEET_H_PX = 1056;

/** Deterministic viewport + DSF. Fixed so geometry cannot drift with window size. */
export const PROBE_VIEWPORT = { width: SHEET_W_PX, height: SHEET_H_PX };
export const DEVICE_SCALE_FACTOR = 1;

/** Sub-sheet internal-clip gate: real non-SVG content severed by a nested
 *  hidden-overflow box. PRE-EXISTING §19 value — preserved, never raised. 2px
 *  covers layout rounding on fractional-px table borders only. */
export const INTERNAL_TOL_PX = 2;

/** Page-box gate, inches. PRE-EXISTING §15 value — preserved, never raised.
 *  Clean full-bleed sheets sit ≤ ~0.38in below the content box (the outline /
 *  title-block deliberately touching the page edge); a genuine clip is >1in. */
export const CLIP_TOL_IN = 0.5;

/**
 * Put the page into the ONLY state in which page-fit geometry means anything:
 * print media, no animation, fonts settled, layout quiesced over two frames.
 * Returns the environment record that every measurement must be reported with.
 */
export async function preparePrintPage(page) {
  // 1. Print media FIRST — it changes layout (#sp-toolbar hidden, #sp-sheets
  //    transform/width/margin reverted), so everything after must see it.
  await page.emulateMedia({ media: 'print' });

  // 2. Kill animation/transition so two frames are genuinely stable.
  await page.addStyleTag({
    content: `*, *::before, *::after {
      animation: none !important; transition: none !important;
      animation-duration: 0s !important; transition-duration: 0s !important;
      caret-color: transparent !important;
    }`,
  });

  // 3. Fonts. No web fonts are embedded, so this resolves immediately — but the
  //    STATUS is the evidence that text metrics were final when measured.
  await page.evaluate(async () => { await document.fonts.ready; });

  // 4. Two stable animation frames.
  await page.evaluate(() => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res))));

  return page.evaluate(() => ({
    fontsStatus: document.fonts.status,
    fontsSize: document.fonts.size,
    mediaPrint: matchMedia('print').matches,
    mediaScreen: matchMedia('screen').matches,
    viewport: { width: innerWidth, height: innerHeight },
    dpr: devicePixelRatio,
    userAgent: navigator.userAgent,
  }));
}

/** D4 — the fingerprint validates the EMBEDDED canonical faces, not host fonts.
 *  Before the font pack, asking for Arial and checking its metrics was the only
 *  way to detect substitution. After embedding it is the wrong test in both
 *  directions: a host with no Arial is now the SUPPORTED case, and a host that
 *  HAS Arial would mask a broken embed by measuring the system face.
 *
 *  🚨 THE NUMBERS AND THE RULE NOW LIVE IN ONE PLACE —
 *  lib/permit/fonts/fontMetricGate.mjs — shared with the LIVE PDF export gate
 *  in lib/pdf/generatePdf.ts, which carried a second hand-written copy of the
 *  same constants.
 *
 *  What used to be here was: "the METRIC FINGERPRINT ... measured at 16px on a
 *  reference host carrying genuine Arial and Courier New", expecting
 *  571.73 / 672.11. Those are correct LINEAR metrics, and measuring them on a
 *  host with those fonts is exactly how the subpixel assumption got baked in:
 *  a renderer that quantizes glyph advances to whole pixels — bare-font Linux,
 *  which is both CI and the production Lambda — reads fixed-pitch Mono as
 *  70 x 10px = 700 instead of 70 x 9.6015625 = 672.109375, and fails by 4.15%
 *  with a perfectly good font pack. The gate now probes at the em size, where
 *  advances are integers by construction. See that module. */
export const FONT_METRIC_REFERENCE = GATED_FAMILIES.map(family => ({
  label: `${family} 400 (embedded)`,
  stack: `"${family}"`,
  family,
}));

/** The faces the artifact must actually have LOADED. Weak on its own —
 *  document.fonts.check() answers "can this be rendered with available fonts",
 *  fallback INCLUDED, so it returns true for a family that does not exist. The
 *  metric comparison is the load-bearing half. */
export const REQUIRED_FONT_FACES = GATE_REQUIRED_FACES;

/** Allowed deviation from the fingerprint. */
export const FONT_METRIC_TOLERANCE_PCT = GATE_TOLERANCE_PCT;

/**
 * Did the EMBEDDED canonical faces actually render, and render as themselves?
 *
 * A host missing a requested face silently substitutes a different one, text
 * rewraps, dense blocks grow, and the page-fit scan then reports a LAYOUT clip
 * that exists only on that host. That is exactly how "PV-0 +10.0px /
 * PV-4B +15.7px / SCHED +31.9px" was once reported against an artifact that
 * measures clean elsewhere. Checking mere PRESENCE is not enough — fontconfig
 * happily resolves a missing family to DejaVu Sans, present, non-generic and
 * ~12% wider — so this compares advance widths against the shipped bytes.
 *
 * The rule (probe, size, expectations, tolerance, verdict) comes from
 * lib/permit/fonts/fontMetricGate.mjs and is shared with the live PDF export
 * gate. Measurement is at the em size, so a renderer that quantizes glyph
 * advances reads the same number as one that does not.
 */
export async function detectFontAvailability(page, reference = FONT_METRIC_REFERENCE, tolerancePct = FONT_METRIC_TOLERANCE_PCT) {
  const measured = await page.evaluate(
    measureAdvanceSumsInPage,
    [FONT_METRIC_PROBE, FONT_METRIC_PROBE_PX, GATED_FAMILIES],
  );
  const faceChecks = await page.evaluate(
    (faces) => Object.fromEntries(faces.map(f => [f, document.fonts.check(f)])),
    [...REQUIRED_FONT_FACES],
  );
  /** @type {Record<string, any>} */
  const out = {};
  // D4 — the embedded faces must be LOADED, checked per face. Kept because it
  // still catches an @font-face that never registered, even though check()
  // alone is not sufficient (it answers with fallback included).
  out.__faces = {
    status: measured.status,
    size: measured.size,
    loaded: measured.loaded,
    checks: faceChecks,
  };
  for (const { label, stack, family } of reference) {
    const widthPx = measured.families[family];
    const expectedPx = CANONICAL_ADVANCE_SUM[family];
    const deltaPct = ((widthPx - expectedPx) / expectedPx) * 100;
    out[label] = {
      stack,
      widthPx: +widthPx.toFixed(2),
      expectedPx,
      deltaPct: +deltaPct.toFixed(2),
      metricCompatible: Math.abs(deltaPct) <= tolerancePct,
      probePx: FONT_METRIC_PROBE_PX,
      // kept for the failure message: what the bare generics measure here
      genericSerifPx: +measured.genericSerifPx.toFixed(2),
      genericMonospacePx: +measured.genericMonospacePx.toFixed(2),
    };
  }
  return out;
}

/** Rendered width of a fixed probe string in an arbitrary font stack, in px.
 *  Used by the negative control to PROVE a substitution actually changed text
 *  metrics before asserting anything about the layout it produced. */
export async function probeTextWidth(page, stack) {
  return page.evaluate((s) => {
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = `16px ${s}`;
    return +ctx.measureText('MMMMMMWWWWiiiill1234567890 The quick brown fox jumps over the lazy dog').width.toFixed(2);
  }, stack);
}

/**
 * Verify the print envelope itself before trusting any measurement inside it:
 * @page is 17in x 11in, every .page resolves to 17in x 11in, the toolbar is
 * hidden and #sp-sheets carries no screen transform. If the envelope is wrong,
 * every overflow number computed inside it is meaningless.
 */
export async function readEnvelope(page) {
  return page.evaluate(() => {
    // @page is not exposed to CSSOM layout, so read the rule text.
    let atPage = null;
    for (const sheet of Array.from(document.styleSheets)) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      for (const r of Array.from(rules || [])) {
        if (r.constructor?.name === 'CSSPageRule' || r.type === 6) {
          const t = r.cssText || '';
          if (/size\s*:/i.test(t)) atPage = t.replace(/\s+/g, ' ').trim();
        }
      }
    }
    const sheetsEl = document.querySelector('#sp-sheets');
    const toolbar = document.querySelector('#sp-toolbar');
    const tcs = toolbar ? getComputedStyle(toolbar) : null;
    const scs = sheetsEl ? getComputedStyle(sheetsEl) : null;
    const pages = Array.from(document.querySelectorAll('.page'));
    const geom = pages.map(pg => {
      const cs = getComputedStyle(pg);
      return { w: cs.width, h: cs.height };
    });
    const uniq = [...new Set(geom.map(g => `${g.w} x ${g.h}`))];
    return {
      atPageRule: atPage,
      atPageIs17x11: !!atPage && /17in\s+11in/.test(atPage),
      toolbarPresent: !!toolbar,
      toolbarDisplay: tcs ? tcs.display : null,
      toolbarHidden: !toolbar || tcs.display === 'none',
      sheetsTransform: scs ? scs.transform : null,
      sheetsTransformNone: !sheetsEl || scs.transform === 'none',
      pageCount: pages.length,
      pageGeometries: uniq,
      // 17in = 1632px, 11in = 1056px at 96dpi
      allPages17x11: uniq.length === 1 && /^1632px x 1056px$/.test(uniq[0]),
    };
  });
}

/**
 * Full per-page, per-element diagnostics. Returns one record per physical
 * `.page`, each naming the exact worst element by unique CSS path with its box,
 * its own scroll/client metrics and its clip parent's overflow styles.
 */
export async function measurePages(page, internalTolPx = INTERNAL_TOL_PX) {
  return page.evaluate((TOL) => {
    // ── unique, re-selectable path for an element ───────────────────────────
    const cssPath = (el) => {
      const parts = [];
      for (let n = el; n && n.nodeType === 1 && parts.length < 8; n = n.parentElement) {
        let seg = n.tagName.toLowerCase();
        if (n.id) { parts.unshift(`${seg}#${CSS.escape(n.id)}`); break; }
        const cls = (typeof n.className === 'string' ? n.className : '').trim().split(/\s+/).filter(Boolean);
        if (cls.length) seg += '.' + cls.slice(0, 3).map(c => CSS.escape(c)).join('.');
        const sibs = n.parentElement ? Array.from(n.parentElement.children).filter(s => s.tagName === n.tagName) : [];
        if (sibs.length > 1) seg += `:nth-of-type(${sibs.indexOf(n) + 1})`;
        parts.unshift(seg);
      }
      return parts.join(' > ');
    };
    const clipsY = (el) => {
      const cs = getComputedStyle(el);
      return cs.overflowY === 'hidden' || cs.overflowY === 'clip'
          || cs.overflow === 'hidden' || cs.overflow === 'clip';
    };
    const describe = (el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        selector: cssPath(el),
        tag: el.tagName.toLowerCase(),
        classes: (typeof el.className === 'string' ? el.className : '') || null,
        text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120),
        top: +r.top.toFixed(2), bottom: +r.bottom.toFixed(2),
        width: +r.width.toFixed(2), height: +r.height.toFixed(2),
        scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
        overflow: cs.overflow, overflowY: cs.overflowY, overflowX: cs.overflowX,
        position: cs.position, fontSize: cs.fontSize, lineHeight: cs.lineHeight,
      };
    };
    const parentOverflow = (el) => {
      const p = el.parentElement;
      if (!p) return null;
      const cs = getComputedStyle(p);
      return {
        selector: cssPath(p), overflow: cs.overflow, overflowY: cs.overflowY,
        overflowX: cs.overflowX, scrollHeight: p.scrollHeight, clientHeight: p.clientHeight,
      };
    };

    const SHEET_RE = /\b(PV-0|RS-1\.\d|RS-1|PV-1B|PV-1|PV-3|PV-4C\.1|PV-4C|E-1|PV-4A|PV-4B\.1|PV-4B|PV-5|PV-6|SCHED-\d|SCHED|APP-A|DS-\d|CERT|PE-1)\b/;

    return Array.from(document.querySelectorAll('.page')).map((pg, i) => {
      const cs = getComputedStyle(pg);
      const padB = parseFloat(cs.paddingBottom) || 0;
      const pr = pg.getBoundingClientRect();
      // Under print media the fit-to-width transform is reverted, so this is 1.
      // It is still computed (and reported) so a non-1 value is VISIBLE rather
      // than silently distorting every number below it.
      const scale = pg.offsetHeight ? pr.height / pg.offsetHeight : 1;
      const printableBottom = pg.clientTop + (pg.clientHeight - padB); // layout px from border-box top

      // ── page-box pass: lowest non-SVG descendant vs the printable box ─────
      let maxBottom = 0, worstEl = null;
      pg.querySelectorAll('*').forEach(el => {
        if (el.closest('svg') || el.tagName.toLowerCase() === 'svg') return;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return;
        const relBottom = (r.bottom - pr.top) / scale;
        if (relBottom > maxBottom) { maxBottom = relBottom; worstEl = el; }
      });

      // ── §19 internal pass: real content severed by a nested clip box ──────
      let internalWorstPx = 0, internalEl = null, internalContainer = null;
      for (const c of [pg, ...Array.from(pg.querySelectorAll('*'))]) {
        if (c.tagName.toLowerCase() === 'svg' || c.closest('svg')) continue;
        if (!clipsY(c)) continue;
        if (c.scrollHeight - c.clientHeight <= TOL) continue;
        const cr = c.getBoundingClientRect();
        const cPadB = parseFloat(getComputedStyle(c).paddingBottom) || 0;
        const contentBottomLayout = c.clientTop + (c.clientHeight - cPadB);
        for (const el of Array.from(c.querySelectorAll('*'))) {
          if (el.tagName.toLowerCase() === 'svg' || el.closest('svg')) continue;
          const ecs = getComputedStyle(el);
          if (ecs.position === 'absolute' || ecs.position === 'fixed') continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          if ((el.textContent || '').trim() === '' && r.height < 4) continue;
          const ov = (r.bottom - cr.top) / scale - contentBottomLayout;
          if (ov > internalWorstPx) { internalWorstPx = ov; internalEl = el; internalContainer = c; }
        }
      }

      const txt = (pg.textContent || '').match(SHEET_RE);
      return {
        pageIndex: i,
        sheetId: txt ? txt[1] : `sheet${i}`,
        hasTitleBlock: !!pg.querySelector('.title-block'),
        pageTop: +pr.top.toFixed(2),
        pageBottom: +pr.bottom.toFixed(2),
        pageWidthCss: cs.width, pageHeightCss: cs.height,
        pagePaddingBottom: padB,
        printableBottom: +printableBottom.toFixed(2),
        renderScale: +scale.toFixed(4),
        // page-box overflow
        lowestBottom: +maxBottom.toFixed(2),
        belowByPx: +(maxBottom - printableBottom).toFixed(2),
        belowByIn: +((maxBottom - printableBottom) / 96).toFixed(3),
        worstElement: worstEl ? describe(worstEl) : null,
        worstElementParent: worstEl ? parentOverflow(worstEl) : null,
        // internal (hidden) overflow
        internalWorstPx: +internalWorstPx.toFixed(2),
        internalElement: internalEl ? describe(internalEl) : null,
        internalContainer: internalContainer ? describe(internalContainer) : null,
        internalElementParent: internalEl ? parentOverflow(internalEl) : null,
      };
    });
  }, internalTolPx);
}

/** Render a failure record as a single, fully-provenanced diagnostic block. */
export function formatFailure(ctx, rec) {
  const el = rec.internalWorstPx > INTERNAL_TOL_PX ? rec.internalElement : rec.worstElement;
  const par = rec.internalWorstPx > INTERNAL_TOL_PX ? rec.internalElementParent : rec.worstElementParent;
  const L = [];
  L.push(`─── ${rec.sheetId} (page index ${rec.pageIndex}) ───`);
  L.push(`  artifact          : ${ctx.artifactPath}`);
  L.push(`  artifact sha256   : ${ctx.artifactSha256}`);
  L.push(`  snapshot          : ${ctx.snapshotId}`);
  L.push(`  output profile    : ${ctx.profile}`);
  L.push(`  sheet count       : ${ctx.sheetCount}`);
  L.push(`  page box          : top=${rec.pageTop} bottom=${rec.pageBottom} css=${rec.pageWidthCss} x ${rec.pageHeightCss}`);
  L.push(`  page padding-bot  : ${rec.pagePaddingBottom}px`);
  L.push(`  printable bottom  : ${rec.printableBottom}px (layout, from page border-box top)`);
  L.push(`  render scale      : ${rec.renderScale} (1 = no transform)`);
  L.push(`  page-box overflow : ${rec.belowByPx}px (${rec.belowByIn}in)`);
  L.push(`  internal overflow : ${rec.internalWorstPx}px`);
  if (el) {
    L.push(`  element selector  : ${el.selector}`);
    L.push(`  element classes   : ${el.classes ?? '(none)'}`);
    L.push(`  element top/bot   : ${el.top} / ${el.bottom}   (h=${el.height})`);
    L.push(`  element scroll/cli: ${el.scrollHeight} / ${el.clientHeight}`);
    L.push(`  element font      : ${el.fontSize} / ${el.lineHeight}`);
    L.push(`  element text      : ${JSON.stringify(el.text)}`);
  }
  if (rec.internalContainer) {
    L.push(`  clip container    : ${rec.internalContainer.selector}`);
    L.push(`  clip container box: scrollHeight=${rec.internalContainer.scrollHeight} clientHeight=${rec.internalContainer.clientHeight} overflow=${rec.internalContainer.overflow}/${rec.internalContainer.overflowY}`);
  }
  if (par) L.push(`  parent overflow   : ${par.selector} overflow=${par.overflow} overflowY=${par.overflowY} scroll/client=${par.scrollHeight}/${par.clientHeight}`);
  L.push(`  fonts.status      : ${ctx.env.fontsStatus} (${ctx.env.fontsSize} faces)`);
  L.push(`  media mode        : print=${ctx.env.mediaPrint} screen=${ctx.env.mediaScreen}`);
  L.push(`  viewport          : ${ctx.env.viewport.width}x${ctx.env.viewport.height} dsf=${ctx.deviceScaleFactor} dpr=${ctx.env.dpr}`);
  L.push(`  browser           : ${ctx.browserVersion}`);
  L.push(`  envelope          : @page=${ctx.envelope.atPageRule} 17x11=${ctx.envelope.atPageIs17x11} toolbarHidden=${ctx.envelope.toolbarHidden} transform=${ctx.envelope.sheetsTransform}`);
  L.push(`  saved artifact    : ${ctx.savedHtmlPath ?? '(n/a)'}`);
  L.push(`  saved screenshot  : ${rec.screenshotPath ?? '(n/a)'}`);
  return L.join('\n');
}
