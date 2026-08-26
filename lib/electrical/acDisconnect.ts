// ═══════════════════════════════════════════════════════════════════════════
// AC DISCONNECT — the single resolver for frame, fuse, make and part number.
//
// WHY THIS EXISTS: a fused disconnect is TWO ratings, not one. The switch is
// sold in a FRAME size (30/60/100/200/400/600 A — a hardware-availability
// ladder); the fuses inside are sized to the OCPD. 25 A of fusing is a 30 A
// frame holding 25 A fuses. There is no 25 A fused safety switch to buy.
//
// The BOM already understood this and named the real hardware (Eaton DPF221RP +
// 2× Littelfuse LLNRK25SP). The SLD did not — it printed a bare "25A FUSED",
// which names a switch rating that does not exist and tells the reviewer
// something different from the equipment schedule for the same project. On top
// of that the BOM carried TWO in-file copies of these rules, so the same fact
// had three representations in the codebase.
//
// One resolver, consumed by the BOM and the drawing, so E-1 and the equipment
// schedule cannot disagree about which switch is on the wall.
// ═══════════════════════════════════════════════════════════════════════════

import { nextStandardOcpd, nextEnclosure } from './stdSizes';

/** Eaton fusible safety-switch part numbers by frame rating. Catalogued through
 *  200 A; above that the generic `DPF-<n>A` form deliberately flags a
 *  non-standard pick for human review rather than inventing a part number. */
const FUSED_PART_BY_FRAME: Record<number, string> = {
  30: 'DPF221RP', 60: 'DPF222RP', 100: 'DPF222RB', 200: 'DPF224RB',
};

export interface AcDisconnectSpec {
  /** Enclosure / switch FRAME rating (A) — what you order. */
  frameA: number;
  /** Fuse rating (A), or null on a non-fused switch — what goes inside. */
  fuseA: number | null;
  fused: boolean;
  manufacturer: string;
  partNumber: string;
  typeLabel: 'Fusible' | 'Non-Fusible';
  fuseManufacturer: string | null;
  fusePartNumber: string | null;
  /** BOM line name, e.g. "30A Fusible AC Disconnect". */
  itemName: string;
  /** Drawing label naming BOTH ratings, e.g.
   *  "30A FUSIBLE DISCONNECT — 25A RK5 FUSES". */
  drawingLabel: string;
}

export interface AcDisconnectInput {
  /** Continuous current × 1.25 (NEC 690.8 / 210.19). */
  requiredAmps: number;
  /** An explicit target rating when the caller already owns one — the POI tap
   *  OCPD / Σ per-source backfeed from conductorAuthority. Wins over
   *  requiredAmps, because a kW-derived basis goes stale on hybrids. */
  targetAmps?: number | null;
  /** Supply-side taps must be fused (NEC 705.11); load-side jobs are not. */
  fused: boolean;
}

export function resolveAcDisconnect(input: AcDisconnectInput): AcDisconnectSpec {
  const { requiredAmps, targetAmps, fused } = input;
  const basis = targetAmps ?? requiredAmps;

  const fuseA = fused ? nextStandardOcpd(basis) : null;
  // A fused enclosure must hold its fuse, so the frame is sized from the FUSE.
  // A non-fused switch is sized from the current it carries.
  const frameA = nextEnclosure(fused ? (fuseA ?? requiredAmps) : basis);

  const typeLabel: 'Fusible' | 'Non-Fusible' = fused ? 'Fusible' : 'Non-Fusible';
  const partNumber = fused
    ? (FUSED_PART_BY_FRAME[frameA] ?? `DPF-${frameA}A`)
    : `DU${frameA}RB`;

  return {
    frameA,
    fuseA,
    fused,
    manufacturer: fused ? 'Eaton' : 'Square D',
    partNumber,
    typeLabel,
    fuseManufacturer: fused ? 'Littelfuse' : null,
    fusePartNumber: fused && fuseA !== null ? `LLNRK${fuseA}SP` : null,
    itemName: `${frameA}A ${typeLabel} AC Disconnect`,
    drawingLabel: fused && fuseA !== null
      ? `${frameA}A FUSIBLE DISCONNECT — ${fuseA}A RK5 FUSES`
      : `${frameA}A NON-FUSIBLE DISCONNECT`,
  };
}
