// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE INTERCONNECTION, MIRRORED ONTO THE LEGACY SCALAR THE OLDER CONSUMERS STILL READ.
//
// System Config V3 replaces the old "Interconnection Method" button grid (which wrote
// `config.interconnectionMethod` and nothing else) with ONE control over the service graph:
// `behavior.interconnection`, answered by `answerInterconnection`, recorded on the points of
// interconnection. The graph is the authority. But the page's compliance request, the CT-location
// control, the computed system, the BOM and SLD requests and the engineering-run snapshot still read
// the scalar, so after a graph write the scalar is brought into step — never the other way round.
//
// THE MAPPING, AND WHY EACH LINE IS WHAT IT IS
//
//   load-side-busbar            → LOAD_SIDE         NEC 705.12(B), the 120% busbar rule.
//   supply-side                 → SUPPLY_SIDE_TAP   NEC 705.11.
//   aggregation-to-supply-side  → SUPPLY_SIDE_TAP   a supply-side tap, reached through a generation
//                                                   panel: still NEC 705.11.
//   load-side-feeder-tap        → LOAD_SIDE         the scalar has no feeder-tap token, and the server
//                                                   already projects it as LOAD_SIDE for the SLD, BOM
//                                                   and permit (`interconnectionMethodScalar`,
//                                                   lib/electrical/loadElectricalProject.ts). The page
//                                                   mirror agrees with that projection, or the page's
//                                                   compliance and the sheet would disagree.
//   manufacturer-integrated     → MANUFACTURER_INTEGRATED
//   meter-collar                → METER_COLLAR      the scalar's own tokens for "not an NEC article":
//                                                   `governingArticleFor` names none, the server
//                                                   projects nothing for them (so the posted scalar is
//                                                   what reaches the SLD and permit), and the
//                                                   consumers that read the scalar already state them
//                                                   as NOT EVALUATED / "INSIDE LISTED EQUIPMENT" /
//                                                   "METER COLLAR" (lib/electrical-calc.ts, the SLD
//                                                   renderer, the permit token, the Compliance tab).
//                                                   Mirroring LOAD_SIDE here would hand a 705.12(B)
//                                                   verdict to a connection the graph says has none.
//   unresolved / mixed          → UNRESOLVED        one scalar cannot describe two articles, and an
//                                                   undecided point of interconnection is not a
//                                                   load-side one. Unknown is NOT EVALUATED.
//   no point of interconnection → (nothing)         the graph has not been asked; the scalar is left.
//
// MAIN_BREAKER_DERATE and PANEL_UPGRADE are no longer connection TYPES — they are remedies for a
// load-side connection that fails the 120% rule, offered on the Existing Electrical Service card.
//
// 🚨 AND ON THE SCALAR THEY ARE A NOTE, NOT A RECORD. The token says "derate" and nothing else: not
// which panel, not to what size, not that anybody established the 120% failure it answers. The one
// record of a remedy is `PanelBoard.remedy`, written only by [Apply] (`answerBusbarRemedy`). So:
//   · the token is NEVER migrated onto the graph by itself — doing so would have to invent the very
//     rating the remedy is about. It is shown as "Earlier remedy note — not applied", and becomes a
//     record only when the installer applies a remedy on the Service card;
//   · every legacy consumer reads it as what it physically is — a load-side connection
//     (`consumerInterconnectionToken`) — so no compliance, BOM or schedule path honours a derate the
//     graph does not hold;
//   · a load-side answer leaves the note in place until a remedy IS applied on the graph; from then
//     on the graph is the record and the scalar follows it (LOAD_SIDE).
//
// Pure and isomorphic. Writes nothing.
// ═══════════════════════════════════════════════════════════════════════════

import type { PoiRelationship, ServiceTopology, PanelBoard, PanelRemedy } from '@/lib/electrical/serviceTopology';
import { effectivePanelRatings, panelRemedyWork } from '@/lib/electrical/serviceTopology';

/** The scalar's tokens this mirror can write (lib/electrical-calc.ts `InterconnectionMethod`). */
export type LegacyInterconnectionToken =
  | 'LOAD_SIDE' | 'SUPPLY_SIDE_TAP' | 'MANUFACTURER_INTEGRATED' | 'METER_COLLAR' | 'UNRESOLVED';

const TOKEN_OF: Readonly<Record<Exclude<PoiRelationship, 'unresolved'>, LegacyInterconnectionToken>> = {
  'load-side-busbar': 'LOAD_SIDE',
  'load-side-feeder-tap': 'LOAD_SIDE',
  'supply-side': 'SUPPLY_SIDE_TAP',
  'aggregation-to-supply-side': 'SUPPLY_SIDE_TAP',
  'manufacturer-integrated': 'MANUFACTURER_INTEGRATED',
  'meter-collar': 'METER_COLLAR',
};

/** The 120% remedies the old grid offered as connection types. Each refines a load-side connection. */
export const LOAD_SIDE_REMEDIES: Readonly<Record<string, string>> = {
  MAIN_BREAKER_DERATE: 'Main breaker derate',
  PANEL_UPGRADE: 'Panel upgrade',
};

/**
 * What the graph says the scalar is — or null when the graph has not been asked (no point of
 * interconnection and no meter collar selected).
 *
 * Only the CLASSIFIED points count, exactly as the server's projection counts them, so whenever
 * `interconnectionMethodScalar` names a value this names the same one.
 */
export function legacyInterconnectionToken(t: ServiceTopology | null | undefined): LegacyInterconnectionToken | null {
  if (!t) return null;
  const pois = t.pointsOfInterconnection ?? [];
  const decided = pois.filter(p => p.relationship !== 'unresolved');
  const tokens = new Set<LegacyInterconnectionToken>(
    decided.map(p => TOKEN_OF[p.relationship as Exclude<PoiRelationship, 'unresolved'>]),
  );
  // A collar recorded on the interconnection with no classified point yet is still a collar.
  if (tokens.size === 0 && t.interconnection?.meterCollarSelected) tokens.add('METER_COLLAR');
  if (tokens.size === 1) return [...tokens][0];
  if (tokens.size > 1) return 'UNRESOLVED';
  return pois.length > 0 ? 'UNRESOLVED' : null;
}

/**
 * The scalar to write after a graph write, or null when nothing should change: the graph has not
 * been asked, the scalar already says it, or the scalar holds an earlier 120% remedy NOTE on the
 * load-side connection the graph records and the graph has no remedy applied yet (the note stays
 * visible until one is). Once a remedy is applied on the graph, the graph is the record: LOAD_SIDE.
 */
export function legacyInterconnectionMirror(
  t: ServiceTopology | null | undefined,
  current: string | null | undefined,
): LegacyInterconnectionToken | null {
  const token = legacyInterconnectionToken(t);
  if (token === null) return null;
  const cur = String(current ?? '').trim().toUpperCase();
  if (token === 'LOAD_SIDE' && cur in LOAD_SIDE_REMEDIES && appliedPanelRemedies(t).length === 0) return null;
  return cur === token ? null : token;
}

// ── The remedy: the graph's record, and the scalar's note ───────────────────

/** Every panel with an applied remedy, in the graph's order. */
export function appliedPanelRemedies(
  t: ServiceTopology | null | undefined,
): Array<{ panel: PanelBoard; remedy: PanelRemedy; label: string; replaces: string }> {
  return (t?.panels ?? []).flatMap(panel => {
    const work = panelRemedyWork(panel);
    return work && panel.remedy ? [{ panel, remedy: panel.remedy, label: work.label, replaces: work.replaces }] : [];
  });
}

/**
 * What a legacy consumer (the compliance engine, the BOM engine, a schedule label) may read from the
 * scalar: a 120% remedy token is read as the load-side connection it refines — never as a remedy,
 * because the scalar records no remedy. Everything else passes through unchanged.
 */
export function consumerInterconnectionToken(scalar: string | null | undefined): string | null {
  if (scalar == null) return null;
  const cur = String(scalar).trim().toUpperCase();
  return cur in LOAD_SIDE_REMEDIES ? 'LOAD_SIDE' : scalar;
}

/**
 * The scalar's remedy token, stated as what it is. `applied` is whether the GRAPH holds a remedy —
 * the note itself is never the record. Null when the scalar holds no remedy token.
 */
export function legacyRemedyNote(
  scalar: string | null | undefined, t: ServiceTopology | null | undefined,
): { label: string; applied: boolean } | null {
  const cur = String(scalar ?? '').trim().toUpperCase();
  const label = LOAD_SIDE_REMEDIES[cur];
  return label ? { label, applied: appliedPanelRemedies(t).length > 0 } : null;
}

/**
 * The single-panel interconnection the page's compliance request carries.
 *
 * The legacy compliance engine (lib/electrical-calc.ts) checks ONE panel — the primary one, whose
 * readings `config.mainPanelAmps` / `config.panelBusRating` mirror. When that panel has an applied
 * remedy, the 120% rule re-runs on the panel AFTER the work, and `proposedWork` travels with it so the
 * engine says so (and, for a derate, names the load calculation the derate still needs). A remedy
 * token on the scalar is read as LOAD_SIDE: the scalar records no remedy.
 */
export function complianceInterconnection(
  posted: { method: string | null | undefined; busRating: number; mainBreaker: number },
  t: ServiceTopology | null | undefined,
): {
  method: string; busRating: number; mainBreaker: number;
  proposedWork?: { kind: PanelRemedy['kind']; panelLabel: string; label: string; replaces: string };
} {
  const method = consumerInterconnectionToken(posted.method) ?? 'UNRESOLVED';
  const p0 = t?.panels[0] ?? null;
  const work = p0 ? panelRemedyWork(p0) : null;
  if (!p0 || !work) return { method, busRating: posted.busRating, mainBreaker: posted.mainBreaker };
  const after = effectivePanelRatings(p0);
  return {
    method,
    busRating: after.busbarRatingA ?? posted.busRating,
    mainBreaker: after.mainBreakerA ?? posted.mainBreaker,
    proposedWork: { kind: work.kind, panelLabel: p0.label, label: work.label, replaces: work.replaces },
  };
}
