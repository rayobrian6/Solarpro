// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE PRIMARY PANEL AS PERMITTED — AFTER ITS APPLIED 120% REMEDY.
//
// The package's single-panel NEC 705.12(B) evaluation (computeSystem's verdict, the compliance
// projection, the snapshot's POI arithmetic that PV-4B / the cover / the readiness blocker print, the
// legacy shadow engine and the permit BOM's backfeed sizing) reads `project.mainPanelAmps` /
// `project.panelBusRating` — the installed readings the page mirrors. When the service graph's
// primary panel carries an applied remedy (`PanelBoard.remedy`, [Apply] on the Service card), every
// one of those reads THIS instead: the package is the design as it will be built, and the graph's own
// check (`domain.busbar-705-12`) already runs on these ratings. Without it the schedule and E-1 said
// "(E) 200 A → (N) 150 A main, PASS" while the title block and PV-4B said "EXCEEDS 120%" against the
// main being replaced.
//
// The INSTALLED readings stay where they are printed as installed — the site plan's (E) panel, the
// cover's (E) service panel, the E-1 data block — and the (E) → (N) record is the graph's schedule.
// Null ⇒ no remedy: every consumer reads exactly what it read before.
// ═══════════════════════════════════════════════════════════════════════════
import type { PermitInput } from '../types';
import {
  primaryPanelPostWork, derateLoadCalculation, type DerateLoadCalculation,
} from '@/lib/electrical/systemConfigLegacyInterconnection';

export interface PermitPanelPostWork {
  kind: 'replace-main-breaker' | 'replace-panelboard';
  panelLabel: string;
  /** The ratings the 705.12(B) arithmetic runs on — the panel after the work. */
  busRatingA: number;
  mainBreakerA: number;
  /** As recorded: what is on the wall today (null when unrecorded). */
  installedBusRatingA: number | null;
  installedMainBreakerA: number | null;
  /** "Replacement main breaker 150 A" — the card's, SLD's and schedule's wording. */
  label: string;
  /** "replaces the installed 200 A main". */
  replaces: string;
  /** A derate's load calculation as the service graph concluded it; null for a panelboard replacement. */
  loadCalculation: DerateLoadCalculation | null;
}

export function permitPanelPostWork(project: PermitInput['project'] | null | undefined): PermitPanelPostWork | null {
  const t = project?.serviceTopology ?? null;
  const pw = primaryPanelPostWork(t);
  if (!t || !pw || pw.busbarRatingA == null || pw.mainBreakerA == null) return null;
  return {
    loadCalculation: derateLoadCalculation(t, pw.panel),
    kind: pw.kind,
    panelLabel: pw.panel.label,
    busRatingA: pw.busbarRatingA,
    mainBreakerA: pw.mainBreakerA,
    installedBusRatingA: pw.panel.busbarRatingA,
    installedMainBreakerA: pw.panel.mainBreakerA,
    label: pw.label,
    replaces: pw.replaces,
  };
}

/**
 * The project as the snapshot's POI evaluation must see it: the panel scalars replaced by the
 * post-work ratings. A shallow view — nothing on `input` is mutated — handed ONLY to the snapshot
 * build, so its `electrical.poi` arithmetic, its 705.12(B) blocker and its service-disconnect rating
 * describe the permitted panel. Returns `input` itself when no remedy is applied (digest unchanged).
 */
export function withPermittedPanelRatings(input: PermitInput): PermitInput {
  const pw = permitPanelPostWork(input.project);
  if (!pw) return input;
  return {
    ...input,
    project: { ...input.project, mainPanelAmps: pw.mainBreakerA, panelBusRating: pw.busRatingA },
  };
}
