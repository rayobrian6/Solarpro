// ============================================================
// SolarPro Drafting Engine — Render Context
// lib/drafting/renderContext.ts  (v47.307)
//
// RenderContext is the single authoritative object passed
// through the entire rendering pipeline. It unifies:
//   - CADModel          (geometry source of truth)
//   - systemType        (hard routing key)
//   - billInsights      (optional — from Bill Intelligence Layer)
//   - engineeringData   (optional — rate, utility, usage)
//
// RULE: Templates NEVER read directly from PermitInput for
// rendering decisions. They read from RenderContext only.
//
// RULE: RenderContext is ADDITIVE — all fields optional except
// systemType + cad. Missing billInsights = render without it.
// ============================================================

import type { CADModel }    from '../cad/types';
import type { BillInsights } from '../billInsights';
import type { DocumentProvenanceBundle } from '@/lib/documentProvenance';

// ─── Engineering data (rate / utility intelligence) ──────────────────────────

export interface EngineeringData {
  /** $/kWh — from bill parse, utility DB, or manual entry */
  electricityRate: number | null;

  /**
   * Where the rate came from:
   *   "bill-derived"      — clean bill: totalAmount / monthlyKwh
   *   "electric-subtotal" — combined bill: isolated electric charges
   *   "utility-db"        — EIA / utility rate database
   *   "manual"            — user-entered override
   *   "unknown"           — no source identified
   */
  rateSource: 'bill-derived' | 'electric-subtotal' | 'utility-db' | 'manual' | 'unknown';

  /** Utility company name */
  utilityName: string | null;

  /** Monthly kWh from bill parse */
  monthlyKwh: number | null;

  /** Annual kWh (estimated or actual) */
  annualKwh: number | null;
}

// ─── Render Context ───────────────────────────────────────────────────────────

export interface RenderContext {
  /** System type — hard routing key, from cad.systemType */
  systemType: 'roof' | 'ground_mount' | 'solar_fence';

  /** Solved CADModel — single source of truth for all geometry */
  cad: CADModel;

  /**
   * Bill Intelligence Layer output — optional.
   * When present, templates render a UTILITY ANALYSIS section in the data zone.
   * When absent, templates render normally without utility section.
   */
  billInsights: BillInsights | null;

  /**
   * Engineering-level rate and utility data.
   * Derived from billInsights + utility DB + manual overrides.
   */
  engineering: EngineeringData | null;

  /** Document provenance carried through rendering; additive metadata only. */
  documentProvenance: DocumentProvenanceBundle | null;
}

// ─── Builder ──────────────────────────────────────────────────────────────────

/**
 * buildRenderContext — assembles RenderContext from available inputs.
 *
 * Called ONCE at planset entry (in renderPlanSet / generatePermitHTML).
 * Safe — never throws. Missing fields gracefully become null.
 */
export function buildRenderContext(
  cad: CADModel,
  opts?: {
    billInsights?:     BillInsights | null;
    electricityRate?:  number | null;
    rateSource?:       EngineeringData['rateSource'];
    utilityName?:      string | null;
    monthlyKwh?:       number | null;
    annualKwh?:        number | null;
    documentProvenance?: DocumentProvenanceBundle | null;
  },
): RenderContext {
  const systemType = cad.systemType as RenderContext['systemType'];

  // Resolve engineering data
  let engineering: EngineeringData | null = null;

  // Derive rateSource from billInsights if not explicitly provided
  const resolvedRateSource: EngineeringData['rateSource'] =
    opts?.rateSource ??
    (opts?.billInsights?.rateSource === 'bill-derived'      ? 'bill-derived'      :
     opts?.billInsights?.rateSource === 'electric-subtotal' ? 'electric-subtotal' :
     opts?.electricityRate != null                          ? 'unknown'           :
     'unknown');

  // Only build engineeringData when we have at least a rate or utility name
  const hasRate    = opts?.electricityRate != null && (opts?.electricityRate ?? 0) > 0;
  const hasUtility = opts?.utilityName != null && (opts?.utilityName ?? '').length > 0;
  const hasUsage   = opts?.monthlyKwh != null && (opts?.monthlyKwh ?? 0) > 0;

  if (hasRate || hasUtility || hasUsage) {
    engineering = {
      electricityRate: opts?.electricityRate ?? null,
      rateSource:      resolvedRateSource,
      utilityName:     opts?.utilityName ?? null,
      monthlyKwh:      opts?.monthlyKwh  ?? null,
      annualKwh:       opts?.annualKwh   ?? null,
    };
  }

  const ctx: RenderContext = {
    systemType,
    cad,
    billInsights: opts?.billInsights ?? null,
    engineering,
    documentProvenance: opts?.documentProvenance ?? null,
  };

  console.log(
    `[RenderContext] built systemType=${systemType}` +
    ` hasBillInsights=${ctx.billInsights !== null}` +
    ` hasEngineering=${ctx.engineering !== null}` +
    ` rate=${engineering?.electricityRate ?? 'null'}` +
    ` rateSource=${engineering?.rateSource ?? 'none'}` +
    ` combinedUtility=${ctx.billInsights?.combinedUtilityDetected ?? false}` +
    ` hasDocumentProvenance=${ctx.documentProvenance !== null}`
  );

  return ctx;
}

// ─── SVG utility analysis block renderer ─────────────────────────────────────

/**
 * drawUtilityAnalysis — renders the UTILITY ANALYSIS data zone block as SVG.
 *
 * Called from fence.ts, ground.ts, roof.ts data zone renderers.
 * Completely self-contained — returns SVG string fragment.
 * Returns empty string when renderContext has no relevant data.
 *
 * @param ctx   RenderContext (may have null billInsights/engineering)
 * @param x     Left edge of the data zone section
 * @param y     Top edge (where this block should start)
 * @param w     Available width in the data zone
 * @returns     SVG string fragment (may be empty)
 */
export function drawUtilityAnalysis(
  ctx: RenderContext,
  x: number,
  y: number,
  w: number,
): string {
  const bi = ctx.billInsights;
  const eng = ctx.engineering;

  // Only render when we have something meaningful to show
  const hasRate    = eng?.electricityRate != null && eng.electricityRate > 0;
  const hasUtility = eng?.utilityName != null;
  const hasBi      = bi != null;

  if (!hasRate && !hasUtility && !hasBi) return '';

  const lines: string[] = [];
  let curY = y;

  // ── Header ──────────────────────────────────────────────────────────────────
  const headerH = 14;
  lines.push(
    `<rect x="${x}" y="${curY}" width="${w}" height="${headerH}" fill="#1a2744" rx="1"/>`,
    `<text x="${x + w / 2}" y="${curY + 9.5}" text-anchor="middle" ` +
      `font-family="Arial,sans-serif" font-size="7" font-weight="bold" fill="#a0b4d0" ` +
      `letter-spacing="0.8">UTILITY ANALYSIS</text>`,
  );
  curY += headerH + 3;

  // ── Utility name ────────────────────────────────────────────────────────────
  if (hasUtility) {
    lines.push(
      `<text x="${x}" y="${curY + 7}" font-family="Arial,sans-serif" font-size="6.5" fill="#94a3b8">Utility</text>`,
      `<text x="${x + w}" y="${curY + 7}" text-anchor="end" font-family="Arial,sans-serif" font-size="6.5" font-weight="bold" fill="#e2e8f0">${eng!.utilityName}</text>`,
    );
    curY += 12;
  }

  // ── Electric rate ────────────────────────────────────────────────────────────
  if (hasRate) {
    const rateStr = `$${eng!.electricityRate!.toFixed(3)}/kWh`;
    const sourceLabel =
      eng!.rateSource === 'bill-derived'      ? '(bill-derived)'    :
      eng!.rateSource === 'electric-subtotal' ? '(electric only)'   :
      eng!.rateSource === 'utility-db'        ? '(utility avg)'     :
      eng!.rateSource === 'manual'            ? '(manual entry)'    : '';
    lines.push(
      `<text x="${x}" y="${curY + 7}" font-family="Arial,sans-serif" font-size="6.5" fill="#94a3b8">Electric Rate</text>`,
      `<text x="${x + w}" y="${curY + 7}" text-anchor="end" font-family="Arial,sans-serif" font-size="7" font-weight="bold" fill="#34d399">${rateStr}</text>`,
    );
    curY += 11;
    if (sourceLabel) {
      lines.push(
        `<text x="${x + w}" y="${curY + 6}" text-anchor="end" font-family="Arial,sans-serif" font-size="5.5" fill="#64748b" font-style="italic">${sourceLabel}</text>`,
      );
      curY += 9;
    }
  }

  // ── Monthly usage ────────────────────────────────────────────────────────────
  if (eng?.monthlyKwh != null && eng.monthlyKwh > 0) {
    lines.push(
      `<text x="${x}" y="${curY + 7}" font-family="Arial,sans-serif" font-size="6.5" fill="#94a3b8">Monthly Usage</text>`,
      `<text x="${x + w}" y="${curY + 7}" text-anchor="end" font-family="Arial,sans-serif" font-size="6.5" font-weight="bold" fill="#e2e8f0">${eng.monthlyKwh.toLocaleString()} kWh</text>`,
    );
    curY += 11;
  }

  // ── Bill Intelligence section ─────────────────────────────────────────────
  if (hasBi) {
    curY += 3;

    // Combined utility indicator
    const combinedColor = bi!.combinedUtilityDetected ? '#fbbf24' : '#34d399';
    const combinedLabel = bi!.combinedUtilityDetected ? 'YES' : 'NO';
    lines.push(
      `<text x="${x}" y="${curY + 7}" font-family="Arial,sans-serif" font-size="6.5" fill="#94a3b8">Combined Utility</text>`,
      `<text x="${x + w}" y="${curY + 7}" text-anchor="end" font-family="Arial,sans-serif" font-size="7" font-weight="bold" fill="${combinedColor}">${combinedLabel}</text>`,
    );
    curY += 11;

    // Detected services
    if (bi!.detectedServices.length > 0) {
      const serviceStr = bi!.detectedServices.slice(0, 3).join(', ');
      lines.push(
        `<text x="${x}" y="${curY + 7}" font-family="Arial,sans-serif" font-size="6.5" fill="#94a3b8">Services</text>`,
        `<text x="${x + w}" y="${curY + 7}" text-anchor="end" font-family="Arial,sans-serif" font-size="6" fill="#fbbf24" font-style="italic">${serviceStr}</text>`,
      );
      curY += 11;
    }

    // Confidence
    const confColor = bi!.confidence === 'high' ? '#34d399' : bi!.confidence === 'medium' ? '#fbbf24' : '#94a3b8';
    lines.push(
      `<text x="${x}" y="${curY + 7}" font-family="Arial,sans-serif" font-size="6.5" fill="#94a3b8">Rate Confidence</text>`,
      `<text x="${x + w}" y="${curY + 7}" text-anchor="end" font-family="Arial,sans-serif" font-size="6.5" font-weight="bold" fill="${confColor}">${bi!.confidence.toUpperCase()}</text>`,
    );
    curY += 11;

    // Warning box — combined utility with no electric subtotal
    if (bi!.combinedUtilityDetected && bi!.suggestedRate === null) {
      curY += 3;
      const warnH = 20;
      lines.push(
        `<rect x="${x}" y="${curY}" width="${w}" height="${warnH}" fill="#78350f22" stroke="#d97706" stroke-width="0.5" rx="1"/>`,
        `<text x="${x + 3}" y="${curY + 7}" font-family="Arial,sans-serif" font-size="5.5" fill="#fbbf24">! COMBINED BILL DETECTED</text>`,
        `<text x="${x + 3}" y="${curY + 14}" font-family="Arial,sans-serif" font-size="5" fill="#fde68a">Electric rate may include non-electric</text>`,
        `<text x="${x + 3}" y="${curY + 19}" font-family="Arial,sans-serif" font-size="5" fill="#fde68a">charges. Verify rate independently.</text>`,
      );
      curY += warnH + 3;
    }

    // Override recommended flag
    if (bi!.overrideRecommended && bi!.suggestedRate !== null) {
      curY += 2;
      lines.push(
        `<text x="${x + w / 2}" y="${curY + 6}" text-anchor="middle" font-family="Arial,sans-serif" font-size="5.5" fill="#7dd3fc">` +
          `Review: $${bi!.suggestedRate.toFixed(3)}/kWh suggested` +
        `</text>`,
      );
      curY += 9;
    }
  }

  // ── Bottom border ─────────────────────────────────────────────────────────
  lines.push(`<line x1="${x}" y1="${curY + 2}" x2="${x + w}" y2="${curY + 2}" stroke="#1e3a5f" stroke-width="0.5"/>`);

  return lines.join('\n');
}