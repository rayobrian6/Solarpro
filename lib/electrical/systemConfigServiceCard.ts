// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE EXISTING ELECTRICAL SERVICE CARD — WHAT IT SHOWS, READ FROM THE INTERVIEW AND THE ENGINE.
//
// Ray (System Config UX correction V3): the service questions are asked in the restored left-column
// card, "Existing Electrical Service", where the old Main Service Panel card was — compact controls,
// MSP rows only when the distribution has more than one panel, and a plain 200 A / one-MSP house
// shows NO multi-panel controls.
//
// This module decides only what that card lays out. Relevance stays with `buildSystemConfigInterview`
// (an item the interview does not ask is not shown), the verdicts stay with `evaluateServiceTopology`
// (the 120% rule is the engine's own per-panel check, read — never recomputed here), and every write
// stays with `systemConfigAnswers.ts`. Pure and isomorphic.
// ═══════════════════════════════════════════════════════════════════════════

import type { InterviewItem, SystemConfigInterview } from '@/lib/electrical/systemConfigInterview';
import type { PanelBoard, ServiceTopology, TopologyCheck } from '@/lib/electrical/serviceTopology';
import { NEC_STANDARD_OCPD } from '@/lib/electrical/stdSizes';
import { maxLoadSideBackfeedA } from '@/lib/nec/rule705_12';
import { allInterviewItems } from '@/lib/electrical/systemConfigPlacement';

/** The engine's field-verification needs for an existing service assembly — owned by this card. */
export const EXISTING_SERVICE_NEED_PREFIX = 'engineering.needs.service.existingEquipment.';

/** The fields the [Verify] dialog records, in the order the needs are read off the equipment. */
export const EXISTING_SERVICE_FIELDS = ['catalogNumber', 'mainArrangement', 'feederArrangement', 'sccrA', 'verified'] as const;
export type ExistingServiceField = (typeof EXISTING_SERVICE_FIELDS)[number];

/** Service ratings the card offers (the same ladder the question dialog offers). */
export const SERVICE_RATINGS: readonly number[] = [100, 125, 150, 200, 225, 320, 400, 600, 800];

/** Panelboard busbar ratings a panel row offers (the same ladder the question dialog offers). */
export const BUSBAR_RATINGS: readonly number[] = [100, 125, 150, 200, 225, 320, 400];

/**
 * Main breaker ratings a panel row offers: the busbar ladder plus every NEC 240.6(A) standard size
 * in between (175 A is the common derate of a 200 A bus). Never a size the code does not publish.
 */
export const MAIN_BREAKER_RATINGS: readonly number[] = [...new Set([
  ...BUSBAR_RATINGS, ...NEC_STANDARD_OCPD.filter(a => a >= 60 && a <= 400),
])].sort((a, b) => a - b);

/** A select's options always include the value the graph records, so a select never misreads it. */
export function withRecorded(ladder: readonly number[], recorded: number | null | undefined): number[] {
  return recorded != null && Number.isFinite(recorded) && !ladder.includes(recorded)
    ? [...ladder, recorded].sort((a, b) => a - b)
    : [...ladder];
}

// ── What the card lays out ──────────────────────────────────────────────────

export interface ServiceCardLayout {
  rating: InterviewItem | null;
  system: InterviewItem | null;
  /** Only when the interview asks it (a service large enough to be split). */
  distribution: InterviewItem | null;
  /** One per panelboard on the graph, in the graph's order. */
  panels: Array<{ panel: PanelBoard; item: InterviewItem | null }>;
  /** More than one panel ⇒ the MSP rows read as a list; one panel ⇒ one compact row. */
  multiPanel: boolean;
  faultCurrent: InterviewItem | null;
  existing: InterviewItem | null;
  /** The engine's still-owed field-verification items for the existing assembly. */
  existingNeeds: InterviewItem[];
}

/** What the Existing Electrical Service card shows, read from the LIVE interview and the graph. */
export function serviceCardLayout(
  interview: Pick<SystemConfigInterview, 'sections'>, t: ServiceTopology | null,
): ServiceCardLayout {
  const all = allInterviewItems(interview);
  const byId = (id: string) => all.find(i => i.id === id) ?? null;
  const panels = (t?.panels ?? []).map(panel => ({ panel, item: byId(`service.panel.${panel.id}`) }));
  return {
    rating: byId('service.rating'),
    system: byId('service.system'),
    distribution: byId('service.distribution'),
    panels,
    multiPanel: panels.length > 1,
    faultCurrent: byId('service.fault-current'),
    existing: byId('service.existing'),
    existingNeeds: existingServiceNeeds(interview),
  };
}

/** The `engineering.needs.service.existingEquipment.*` items, in the interview's order. */
export function existingServiceNeeds(interview: Pick<SystemConfigInterview, 'sections'>): InterviewItem[] {
  return allInterviewItems(interview).filter(i => i.id.startsWith(EXISTING_SERVICE_NEED_PREFIX));
}

/** The field a need names: 'engineering.needs.service.existingEquipment.sccrA' → 'sccrA'. */
export function existingNeedField(itemId: string): ExistingServiceField | null {
  if (!itemId.startsWith(EXISTING_SERVICE_NEED_PREFIX)) return null;
  const f = itemId.slice(EXISTING_SERVICE_NEED_PREFIX.length);
  return (EXISTING_SERVICE_FIELDS as readonly string[]).includes(f) ? f as ExistingServiceField : null;
}

// ── The 120% rule on THIS panel, as the engine concluded it ─────────────────

/** The engine's check id for NEC 705.12(B) on a backed-up panel's busbar. */
export const PANEL_BUSBAR_CHECK = 'domain.busbar-705-12';

/**
 * The engine's NEC 705.12(B) verdict for one panelboard — read from `evaluateServiceTopology`, never
 * recomputed. The engine scopes it to the backup system that holds the panel (`domain:<id>`) and
 * titles it by the panel ("MSP #1 120% busbar allowance"), one per backed-up panel. Null ⇒ the engine
 * reached no 120% verdict for this panel (no system backs it up).
 */
export function panelBusbarCheck(
  t: ServiceTopology | null, checks: ReadonlyArray<TopologyCheck> | null | undefined, panelId: string,
): TopologyCheck | null {
  if (!t || !checks) return null;
  const p = t.panels.find(x => x.id === panelId);
  if (!p) return null;
  const scopes = new Set(t.domains.filter(d => d.backedUpPanelIds.includes(panelId)).map(d => `domain:${d.id}`));
  return checks.find(c => c.id === PANEL_BUSBAR_CHECK && scopes.has(c.scope)
    && c.title.startsWith(`${p.label} 120%`)) ?? null;
}

export interface BusbarRemedy {
  amps: number;
  /** (bus × 1.2) − main with this change — the one 705.12(B) formula (`maxLoadSideBackfeedA`). */
  allowsA: number;
}

export interface BusbarRemedies {
  /** Derate the main breaker: standard sizes below the recorded main. */
  derateMain: BusbarRemedy[];
  /** Upgrade the busbar: ratings above the recorded bus. */
  upgradeBus: BusbarRemedy[];
}

/**
 * The 120% REMEDIES for a panel whose busbar check FAILS — what used to be the MAIN_BREAKER_DERATE /
 * PANEL_UPGRADE "interconnection methods". They are not ways to connect; they change THIS panel's
 * main breaker or busbar, written through `answerPanel`, after which the engine re-evaluates. Each
 * option states the allowance it would give by the one 705.12(B) formula; whether that is enough is
 * the engine's verdict on the next evaluation, not this list's. Offered only on a FAIL, and only when
 * both of the panel's ratings are recorded (a remedy for a figure nobody entered is a guess).
 */
export function busbarRemedies(panel: PanelBoard, check: TopologyCheck | null): BusbarRemedies | null {
  if (!check || check.conclusion !== 'FAIL') return null;
  const bus = panel.busbarRatingA, main = panel.mainBreakerA;
  if (bus == null || main == null) return null;
  return {
    derateMain: MAIN_BREAKER_RATINGS.filter(a => a < main && a >= main / 2)
      .sort((a, b) => b - a)
      .map(amps => ({ amps, allowsA: maxLoadSideBackfeedA(bus, amps) })),
    upgradeBus: BUSBAR_RATINGS.filter(a => a > bus)
      .map(amps => ({ amps, allowsA: maxLoadSideBackfeedA(amps, main) })),
  };
}
