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
import type {
  ExistingServiceEquipment, PanelBoard, ServiceTopology, TopologyCheck,
} from '@/lib/electrical/serviceTopology';
import { panelRemedyWork } from '@/lib/electrical/serviceTopology';
import type { AnswerResult } from '@/lib/electrical/systemConfigAnswers';
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
  /**
   * When the interview asks it (a service large enough to be split) — and ALSO when a split is
   * recorded that the rating no longer asks about (400 A → 200 A with two MSPs still on it), so the
   * card can collapse it instead of stranding it. See `strandedDistribution`.
   */
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
  interview: Pick<SystemConfigInterview, 'sections'> & Partial<Pick<SystemConfigInterview, 'evaluation'>>,
  t: ServiceTopology | null,
): ServiceCardLayout {
  const all = allInterviewItems(interview);
  const byId = (id: string) => all.find(i => i.id === id) ?? null;
  const panels = (t?.panels ?? []).map(panel => ({ panel, item: byId(`service.panel.${panel.id}`) }));
  const branchSum = branchSumCheck(interview.evaluation?.checks);
  const asked = byId('service.distribution');
  return {
    rating: byId('service.rating'),
    system: byId('service.system'),
    // 🚨 A recorded split that no longer fits the rating is not "answered": no option is pressed, so
    // re-choosing the one that is recorded by count (two panels on a 320 A service) is not a no-op.
    distribution: asked
      ? (branchSum?.conclusion === 'FAIL' ? { ...asked, state: 'fails', value: null, why: branchSum.detail } : asked)
      : strandedDistribution(t, branchSum),
    panels,
    multiPanel: panels.length > 1,
    faultCurrent: byId('service.fault-current'),
    existing: byId('service.existing'),
    existingNeeds: existingServiceNeeds(interview),
  };
}

/** The engine's verdict on whether the service's branches fit its rating — read, never recomputed. */
function branchSumCheck(checks: ReadonlyArray<TopologyCheck> | null | undefined): TopologyCheck | null {
  return checks?.find(c => c.id === 'service.branch-sum') ?? null;
}

/**
 * The distribution question for a split the rating no longer asks about.
 *
 * The interview asks how a service is distributed only above 225 A. Lower a 400 A service with two
 * 200 A MSPs to 200 A and the question disappears while both MSPs stay — the engine FAILS the branch
 * sum and the card had no control left to collapse them. So whenever the graph has more than one
 * branch, or its branches FAIL the rating, the card keeps offering "One N A main panel". No option
 * reads as pressed: the recorded split is stated as the answer, and the engine's verdict as the why.
 */
export function strandedDistribution(t: ServiceTopology | null, branchSum: TopologyCheck | null): InterviewItem | null {
  if (!t || t.service.ratedAmps === null) return null;
  const fails = branchSum?.conclusion === 'FAIL';
  if (t.branches.length < 2 && !fails) return null;
  const rated = t.service.ratedAmps;
  const n = t.branches.length;
  return {
    id: 'service.distribution',
    section: 'service',
    question: `How is the ${rated} A service distributed?`,
    state: fails ? 'fails' : 'answered',
    answer: n === 1 ? `One ${t.branches[0].ratedAmps} A main panel`
      : `${n} main panels (${t.branches.map(b => `${b.ratedAmps} A`).join(' + ')})`,
    source: 'Installer entered',
    options: [{ value: 'one-main-panel', label: `One ${rated} A main panel` }],
    value: null,
    ...(fails && branchSum ? { why: branchSum.detail } : {}),
    owner: 'Installer',
    blocks: ['busbar checks', 'backup', 'SLD'],
  };
}

// ── Never a preset where a reading belongs ──────────────────────────────────

/**
 * The service built from a rating or a distribution, WITHOUT the preset panel ratings.
 *
 * `buildServiceFromPreset` gives each new main panel main = bus = its branch rating. Those are facts
 * read off the panel's label, not consequences of the service rating: a 200 A service can have a
 * 225 A bus, and NEC 705.12(B) allows 70 A on that bus where it allows 40 A on a 200 A one. Written
 * as presets they read back as "Installer entered" and the 120% check ran on a busbar nobody had
 * entered. So the card leaves them blank and asks for them (the panel row is a needs-answer item
 * until both are read). A refusal passes through untouched.
 */
export function withoutPresetPanelRatings(r: AnswerResult): AnswerResult {
  if (r.ok === false || r.topology.panels.length === 0) return r;
  const panels = r.topology.panels.map(p => ({ ...p, mainBreakerA: null, busbarRatingA: null }));
  const head = r.did.split(';')[0].trim();
  return {
    ok: true,
    topology: { ...r.topology, panels },
    did: `${head}; ${panels.map(p => p.label).join(', ')} — main breaker and busbar to be read off the panel label`,
  };
}

/**
 * What the installer has recorded on the panels — what a rebuild of the distribution would discard.
 * One line per panel that has anything: "MSP #1: Main 200 A · Bus 225 A · Eaton".
 */
export function panelRecordedFacts(t: ServiceTopology | null): string[] {
  return (t?.panels ?? []).flatMap(p => {
    const facts = [
      p.mainBreakerA != null ? `Main ${p.mainBreakerA} A` : null,
      p.busbarRatingA != null ? `Bus ${p.busbarRatingA} A` : null,
      p.manufacturer ? p.manufacturer : null,
      p.sccrA != null ? `${p.sccrA / 1000} kA` : null,
      // An applied remedy is recorded work too — a rebuild discards it with the panel.
      panelRemedyWork(p) ? `proposed: ${panelRemedyWork(p)!.label}` : null,
    ].filter((f): f is string => f !== null);
    return facts.length > 0 ? [`${p.label}: ${facts.join(' · ')}`] : [];
  });
}

/**
 * What was read off an existing service assembly — what declaring it "new" would discard. Empty ⇒
 * nothing recorded, so there is nothing to lose.
 */
export function existingRecordedFacts(ex: ExistingServiceEquipment | null | undefined): string[] {
  if (!ex) return [];
  return [
    ex.manufacturer,
    ex.catalogNumber,
    ex.mainArrangement ? `main: ${ex.mainArrangement}` : null,
    ex.feederArrangement ? `feeders: ${ex.feederArrangement}` : null,
    ex.sccrA != null ? `${ex.sccrA / 1000} kA AIC` : null,
    ex.verified ? 'read on site' : null,
  ].filter((f): f is string => !!f);
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
 * PANEL_UPGRADE "interconnection methods". They are not ways to connect, and they are PROPOSED WORK,
 * not readings: a derate means buying and swapping a breaker (and a load calculation showing the
 * panel's load still fits it); a busbar upgrade means a different panelboard. Each option states the
 * allowance it would give by the one 705.12(B) formula, worked out from what is INSTALLED.
 *
 * 🚨 A SUGGESTION UNTIL THE INSTALLER CLICKS [Apply], AND NEVER WRITTEN AS THE PANEL'S RATING.
 * Nothing applies one by default, in Auto mode or as a fix. [Apply] writes `PanelBoard.remedy`
 * (`answerBusbarRemedy`) — proposed work beside the installed readings, never in place of them:
 * writing "175 A" into `mainBreakerA` would erase the fact that a 200 A main is installed and record
 * nothing that says a breaker must be bought. Offered only on a FAIL, and only when both of the
 * panel's ratings are recorded (a remedy for a figure nobody entered is a guess). A derate is a
 * smaller NEC 240.6(A) standard breaker — a size somebody can buy.
 */
export function busbarRemedies(panel: PanelBoard, check: TopologyCheck | null): BusbarRemedies | null {
  if (!check || check.conclusion !== 'FAIL') return null;
  const bus = panel.busbarRatingA, main = panel.mainBreakerA;
  if (bus == null || main == null) return null;
  return {
    derateMain: (NEC_STANDARD_OCPD as readonly number[]).filter(a => a < main && a >= main / 2)
      .sort((a, b) => b - a)
      .map(amps => ({ amps, allowsA: maxLoadSideBackfeedA(bus, amps) })),
    upgradeBus: BUSBAR_RATINGS.filter(a => a > bus)
      .map(amps => ({ amps, allowsA: maxLoadSideBackfeedA(amps, main) })),
  };
}

/**
 * The panels whose Service-card failure block offers an [Apply] right now — the same two readers
 * (`panelBusbarCheck` → `busbarRemedies`) the card renders from, so a pointer elsewhere ("Apply a
 * remedy on Existing Electrical Service →") is shown only when there is something there to apply.
 * Empty when the graph reached no per-panel 120% FAIL — e.g. a PV-only load-side job, whose 705.12(B)
 * verdict is the legacy single-panel one and has no remedy writer yet.
 */
export function panelsOfferingBusbarRemedy(
  t: ServiceTopology | null, checks: ReadonlyArray<TopologyCheck> | null | undefined,
): string[] {
  if (!t || !checks) return [];
  return t.panels.filter(p => {
    const r = busbarRemedies(p, panelBusbarCheck(t, checks, p.id));
    return !!r && (r.derateMain.length > 0 || r.upgradeBus.length > 0);
  }).map(p => p.id);
}
