// ═══════════════════════════════════════════════════════════════
// Field-label selector — the required sticker/decal set is standard
// PER JOB, so derive it from data instead of hand-maintaining a list.
//
// Source of truth: lib/data/placards/field-placards-research.json (real
// NEC/IFC field labels — exact wording, ANSI signal + colors, letter
// heights, per-cycle code refs). This picks the labels that apply to a
// given system (topology / interconnection / battery / rapid-shutdown),
// resolves each to the job's NEC edition, and fills live ratings into
// the fill-in labels from the shared conductor authority.
// ═══════════════════════════════════════════════════════════════

import fieldLabelData from '@/lib/data/placards/field-placards-research.json';
import type { PermitInput } from '../types';
import type { CADModel } from '@/lib/cad/types';
import { hasRealBattery, isSupplySideInterconnection } from './helpers';
import { getEquipmentContext, getInverterTopology, topologyToLegacy } from '@/lib/system';
import { buildConductorAuthority } from './conductorAuthority';
import { getDesignTemps } from './designTemps';
import { SOLAR_PANELS } from '@/lib/equipment-db';
import { projectCodeAuthorityFromInput } from '../snapshot/codeAuthorityProjection';   // §11 — editions single-sourced
import { peekSnapshot } from '../snapshot/read';   // TAC WS-13 — canonical grounding objects

interface RawLabel {
  id: string;
  title: string;
  text: string;
  signalWord: string | null;
  colors: { background?: string; text?: string; border?: string; titleBackground?: string; titleText?: string };
  minLetterHeightIn: number;
  material: string;
  location: string;
  codeRefs: Array<{ code: string; section: string }>;
  appliesWhen: string;
}

/** §16 — which interconnection SIDE a label belongs to. The design's canonical
 *  service topology selects the applicable set: a 705.12 load-side placard must
 *  never render on a 705.11 supply-side system, and vice-versa. 'general' labels
 *  (utility-interactive markings, DC/RSD/grounding placards) apply to both. */
export type InterconnectSide = 'supply-side-only' | 'load-side-only' | 'general';

export interface FieldLabel {
  id: string;            // display id, L-1..
  refId: string;         // source id from the dataset
  necRef: string;        // code ref resolved to the job's NEC edition + topology
  placement: string;     // where it's installed
  lines: string[];       // rendered lines (signal word first when present)
  bg: string;
  fg: string;
  letterHeightIn: number;
  material: string;
  required: boolean;     // does it apply to THIS system?
  interconnectSide: InterconnectSide;  // §16 — topology classification
}

interface Ctx {
  isMicro: boolean;
  isSupply: boolean;
  hasBattery: boolean;
  rapidShutdown: boolean;
  acDisconnect: boolean;
  /** TAC WS-13 — does THIS design add a grounding electrode conductor? Read from
   *  the canonical grounding object (build.ts `gnd-gec`), the same record PV-4B
   *  prints from. A grid-tied interconnection bonds to the EXISTING service
   *  grounding electrode system and adds no GEC, so a label asserting one exists
   *  ("GROUNDING ELECTRODE CONDUCTOR — DO NOT DISCONNECT") contradicted PV-4B on
   *  the same package. */
  gecRequired: boolean;
}

// §16 — INTERCONNECTION-SIDE classification. The design's canonical topology
// (705.11 supply-side vs 705.12 load-side) selects the applicable set. A
// load-side-only label (the back-fed-breaker "do not relocate" placard —
// meaningless without a back-fed breaker) must NOT render on a supply-side tap;
// the supply-side line-side-tap warning must NOT render on a load-side system.
// Everything else is a general utility-interactive / DC / RSD / grounding label
// that applies regardless of side. Any id not listed defaults to 'general'.
const LABEL_INTERCONNECT_SIDE: Record<string, InterconnectSide> = {
  'backfeed-breaker-do-not-relocate': 'load-side-only',   // NEC 705.12(B)(2)(3)(b)
  'line-side-tap-warning': 'supply-side-only',            // NEC 705.11
};

export function labelInterconnectSide(refId: string): InterconnectSide {
  return LABEL_INTERCONNECT_SIDE[refId] ?? 'general';
}

/** Is a label's topology side compatible with THIS design's interconnection? */
function sideApplies(side: InterconnectSide, isSupply: boolean): boolean {
  if (side === 'supply-side-only') return isSupply;
  if (side === 'load-side-only') return !isSupply;
  return true;
}

// Which system conditions require each label (NON-topology gating — battery,
// micro, rapid-shutdown, AC disconnect). The interconnection SIDE gate is
// applied separately via LABEL_INTERCONNECT_SIDE so it is single-sourced and
// testable. Engineering judgment lives here (the raw data carries the
// wording/codes/colors, not the boolean gating).
const REQUIRED_WHEN: Record<string, (c: Ctx) => boolean> = {
  'rapid-shutdown-building-placard': c => c.rapidShutdown,
  'rapid-shutdown-array-boundary-label': c => c.rapidShutdown,
  'rapid-shutdown-switch-initiator-label': c => c.rapidShutdown,
  'pv-system-dc-disconnect': c => !c.isMicro,
  'energized-in-open-position-warning': () => true,
  'do-not-touch-terminals-warning': c => !c.isMicro,
  'photovoltaic-power-source-conduit': c => !c.isMicro,
  'dc-photovoltaic-power-source-ratings': c => !c.isMicro,
  'ac-point-of-connection-disconnect': () => true,
  'ac-disconnect-marking': c => c.acDisconnect,
  'backfeed-breaker-do-not-relocate': () => true,   // side gated via LABEL_INTERCONNECT_SIDE
  'dual-power-source-inverter-output': () => true,
  'multiple-sources-of-power-directory': () => true,
  'line-side-tap-warning': () => true,              // side gated via LABEL_INTERCONNECT_SIDE
  'photovoltaic-system-connected': () => true,
  'ess-disconnect': c => c.hasBattery,
  'ess-master-placard': c => c.hasBattery,
  // TAC WS-13 — the 250.119 grounding/bonding IDENTIFICATION requirement always
  // applies (equipment grounding conductors and array bonding points exist on
  // every system), so this row stays required. What was unconditional and WRONG
  // is its TEXT and its citation: see LABEL_VARIANT below, which drops the GEC
  // assertion and the 690.47 grounding-electrode citation when the design adds
  // no grounding electrode conductor.
  'grounding-electrode-conductor-marking': () => true,
  'inverter-listing-label': () => true,
};

/** TAC WS-13 — a label whose WORDING or CITATION depends on a design fact.
 *  Returning null keeps the dataset row verbatim. */
interface LabelVariant { text?: string; necSections?: string }
const LABEL_VARIANT: Record<string, (c: Ctx) => LabelVariant | null> = {
  // The dataset row is the grounding/bonding conductor IDENTIFICATION label
  // (250.119 / 690.43 / 690.47), but its printed text names a grounding
  // ELECTRODE conductor and tells the field not to disconnect it. On a grid-tied
  // interconnection that bonds to the existing GES no such conductor is added —
  // PV-4B says so explicitly — so the text asserted a conductor that does not
  // exist and cited 690.47 (grounding electrode systems) as its authority. With
  // no GEC the requirement that DOES apply is identification of the equipment
  // grounding and bonding conductors: 250.119 (identification) + 690.43 (array
  // equipment grounding/bonding). 690.47 prints only when a GEC exists.
  'grounding-electrode-conductor-marking': c => (c.gecRequired ? null : {
    // Kept to the same printed length as the dataset row it replaces — the decal
    // card sits in a 3-column grid on the merged labels sheet with no slack for
    // an extra wrapped line (pagefit internal-clip gate).
    text: 'EQUIPMENT GROUNDING & BONDING — DO NOT DISCONNECT',
    necSections: '250.119 / 690.43',
  }),
};

// §16 — NEC 705 section clauses are SIDE-SPECIFIC. On a supply-side (705.11)
// design a load-side 705.12 clause is wrong authority and must not print; on a
// load-side (705.12) design the supply-side 705.11 clause must not print. 705.10
// (grouped power-source directory) and everything else is general (both sides).
//   • 705.11                            → supply-side
//   • 705.12 (ANY subdivision) / 705.13 → load-side
//
// ── ECD §9 (Ray's ruling, 2026-07-26) — the 705.12(A) SPECIAL CASE IS DELETED ──
// This function used to carry `if (/705\.12\(A\)/) return 'supply'` because in the
// NEC **2017** cycle 705.12(A) was the supply-side subdivision. The consequence was
// that filterSectionByTopology KEPT both halves of the placard dataset's
// "705.11 / 705.12(A)" on a supply-side design, and resolveRef printed
// `NEC 2020 705.11 / 705.12(A)` on PV-5 — a citation stamped with the 2020 edition,
// in which 705.12 is the LOAD-SIDE article. A 2020-stamped 705.12(A) is a
// wrong-edition AND wrong-side citation regardless of what the number meant in 2017.
//
// Ray's ruling is stronger than "scope the case to 2017": THE CITATION ITSELF MUST
// NOT RENDER ON A SUPPLY-SIDE LABEL. Note the distinction that preserves — even if a
// code cycle genuinely used a 705.12 subdivision to DEFINE the supply-side
// classification, the field LABEL still does not cite it. The label's job is to tell
// a first responder / inspector what the connection IS under the AHJ's CURRENTLY
// ADOPTED cycle, and that cycle's supply-side citation is 705.11; a superseded
// numbering is a code-history fact, not label content.
//
// So 705.12(A) now falls through to the general 705.12 rule (load-side) and is
// dropped on supply-side designs. This is HALF of a two-site fix — the dataset entry
// no longer carries it either (lib/data/placards/field-placards-research.json, the
// NEC-2020 `line-side-tap-warning` codeRef) — so it cannot be reintroduced through
// either path.
function necSectionSide(part: string): 'supply' | 'load' | 'general' {
  const s = part.trim();
  if (/705\.11\b/.test(s)) return 'supply';
  if (/705\.13\b/.test(s)) return 'load';
  // EVERY 705.12 subdivision — INCLUDING (A) — is load-side for labelling.
  if (/705\.12/.test(s)) return 'load';
  return 'general';
}

/** Drop side-contradicting NEC section clauses from a compound section string
 *  ("705.10 / 705.12(B)(2)" → "705.10" on a supply-side design). Never blank. */
function filterSectionByTopology(section: string, isSupply: boolean): string {
  const parts = section.split('/').map(p => p.trim()).filter(Boolean);
  if (parts.length <= 1) {
    // single clause: drop only if it directly contradicts the design side
    const side = necSectionSide(section);
    if (side === 'general') return section;
    return (isSupply ? side === 'supply' : side === 'load') ? section : '';
  }
  const kept = parts.filter(p => {
    const side = necSectionSide(p);
    if (side === 'general') return true;
    return isSupply ? side === 'supply' : side === 'load';
  });
  // PPC §6 — the second half of the sanitizer bypass: when NOTHING survives the
  // topology filter this returned EVERY part (`kept.length ? kept : parts`), so a
  // compound all-load-side citation ('705.12(B)(3) / 705.13') printed intact on a
  // supply-side design. An empty result is the honest answer — resolveRef then
  // omits the NEC clause rather than citing the wrong side.
  return kept.join(' / ');
}

/** §11 — resolve the label's code SECTION references. NEC follows the AHJ's
 *  adopted cycle (`necYear`, the jurisdiction's NEC — the same source
 *  codeAuthority derives NEC from, and what the placard cycle is selected by).
 *  The IFC edition is SINGLE-SOURCED from snapshot.codeAuthority (`ifcEd`): the
 *  placard JSON's baked-in "IFC 2021" literal may NEVER leak, because the IFC
 *  authority is unverified/pending on most jobs — an "IFC 2021" claim was a
 *  FALSE edition. A missing IFC edition prints PENDING (section still cited). */
function resolveRef(codeRefs: RawLabel['codeRefs'], necYear: string, ifcEd: string | null, isSupply: boolean): string {
  const nec = codeRefs.filter(c => /NEC/i.test(c.code));
  const ifc = codeRefs.filter(c => /IFC/i.test(c.code));
  const necPick = nec.find(c => c.code.includes(necYear)) ?? nec[nec.length - 1];
  // Never pick by the placard's own edition literal; use the authority edition
  // (or the latest listed section when pending — the section, not its edition).
  const ifcPick = (ifcEd ? ifc.find(c => c.code.includes(ifcEd)) : undefined) ?? ifc[ifc.length - 1];
  const parts: string[] = [];
  if (necPick) {
    // §16 — strip side-contradicting NEC 705 clauses (no 705.12 on supply-side).
    const necSection = filterSectionByTopology(necPick.section, isSupply);
    if (necSection) parts.push(`NEC ${necYear} ${necSection}`);
  }
  if (ifcPick) parts.push(`IFC ${ifcEd ?? 'PENDING'} ${ifcPick.section}`);
  // PPC §6 — SANITIZER BYPASS FIX. The old fallback returned `codeRefs[0]`
  // UNFILTERED whenever the topology filter stripped the only NEC clause and no
  // IFC ref existed — which printed the load-side-only clause
  // `NEC 2017 705.12(D)(2)(3)(b)` (dataset entry backfeed-breaker-do-not-relocate)
  // on a SUPPLY-SIDE design, i.e. the topology gate leaked through its own
  // fallback. The fallback now re-applies `filterSectionByTopology`, and when
  // nothing survives it returns an empty string (the label's own `required` flag is
  // already false on the wrong side, so the row simply carries no citation) —
  // never a citation the design's topology excludes.
  if (parts.length) return parts.join('  ·  ');
  for (const c of codeRefs) {
    const _sec = /NEC/i.test(c.code) ? filterSectionByTopology(c.section, isSupply) : c.section;
    if (_sec) return `${c.code} ${_sec}`;
  }
  return '';
}

/** Replace successive ____ blanks with values (real field labels are fill-in). */
function fillBlanks(text: string, values: Array<string | number>): string {
  let i = 0;
  return text.replace(/_{2,}/g, () => (i < values.length ? String(values[i++]) : '____'));
}

/**
 * Build the job-specific field-label set from the standard dataset.
 * Returns ALL labels with `required` set per this system; the sheet renders
 * the required ones as stickers and lists them all in the schedule.
 */
export function selectFieldLabels(input: PermitInput, cad: CADModel): FieldLabel[] {
  const { project, system, compliance } = input;
  // NEC label cycle follows the AHJ's adopted NEC (jurisdiction). §11 — the IFC
  // edition is single-sourced from the snapshot codeAuthority projection so the
  // placard's baked-in "IFC 2021" literal can never leak (null ⇒ PENDING).
  const year = String(compliance.jurisdiction?.necVersion || '2020').match(/20\d\d/)?.[0] || '2020';
  const _cp = projectCodeAuthorityFromInput(input);
  const isMicro = topologyToLegacy(getInverterTopology(input, cad)) === 'MICRO';
  const isSupply = isSupplySideInterconnection(input);
  // TAC WS-13 — the canonical GEC record (build.ts pushes an explicit
  // required:false / method:'none-required' object for a grid-tied
  // interconnection). Absent snapshot ⇒ false, which matches that design rule AND
  // selects the wording that is true either way (equipment grounding and bonding
  // conductors exist on every system; a GEC does not).
  const _gecObj = peekSnapshot(input)?.electrical?.groundingObjects
    ?.find(g => g.purpose === 'gec') ?? null;
  const ctx: Ctx = {
    isMicro,
    isSupply,
    hasBattery: hasRealBattery(project),
    rapidShutdown: !!project.rapidShutdown,
    acDisconnect: project.acDisconnect !== false,
    gecRequired: _gecObj ? _gecObj.required === true : false,
  };

  // Live values for the fill-in ratings labels (single-sourced).
  const eq = getEquipmentContext(input, cad);
  const auth = buildConductorAuthority(input, cad);
  const str0 = system.inverters?.[0]?.strings?.[0];
  const panelVoc = eq.panelVoc || project.panelVoc || str0?.panelVoc || 0;
  const panelIsc = eq.panelIsc || project.panelIsc || str0?.panelIsc || 0;
  const panelsPerString = str0?.panelCount || 0;
  // Values are NUMBERS ONLY — the label templates already carry the unit
  // after each blank ("____ V DC", "____ A"), so filling a unit here would
  // double it ("16.5 A A"). Unknowns stay as a fill-in blank.
  // P1-4 (data-authority register): ONE cold-Voc law — NEC 690.7(A) β-based
  // temperature correction, Voc × (1 + β/100 × (Tmin − 25)), the SAME law
  // compliancePages/PV-5/E-1 print. The old blanket ×1.25 here was a second
  // law and disagreed with the sheets (576V vs 527V class). Unresolved β
  // keeps ×1.25 as the conservative marked assumption, matching compliancePages.
  const _lblPanelModel = ((eq.panelModel && eq.panelModel !== '—' ? eq.panelModel : str0?.panelModel) ?? '').toLowerCase().trim();
  const _lblDb = _lblPanelModel
    ? (SOLAR_PANELS.find(p => p.model.toLowerCase() === _lblPanelModel)
      ?? SOLAR_PANELS.find(p => _lblPanelModel.includes(p.model.toLowerCase()) || p.model.toLowerCase().includes(_lblPanelModel)))
    : undefined;
  const _lblBeta = typeof _lblDb?.tempCoeffVoc === 'number' ? _lblDb.tempCoeffVoc : undefined;
  const _lblProj = project as unknown as { state?: string; address?: string; lat?: number; lng?: number };
  const _lblSt = (_lblProj.state && /^[A-Za-z]{2}$/.test(_lblProj.state.trim()))
    ? _lblProj.state.trim().toUpperCase()
    : ((_lblProj.address ?? '').match(/,\s*([A-Za-z]{2})[\s,]+\d{5}(?:-\d{4})?\b/)?.[1]?.toUpperCase());
  const _lblTMin = project.designTempMin ?? getDesignTemps(_lblProj.lat, _lblProj.lng, _lblSt).ashraeExtremeLowC;
  const _vocFactor = _lblBeta !== undefined ? 1 + (_lblBeta / 100) * (_lblTMin - 25) : 1.25;
  const maxSysVdc = !isMicro && panelVoc && panelsPerString
    ? `${Math.round(panelVoc * _vocFactor * panelsPerString)}`
    : (panelVoc ? `${Math.round(panelVoc * _vocFactor)}` : '____');
  const iscCont = panelIsc ? `${(panelIsc * 1.25).toFixed(1)}` : '____';
  const impV = (project as any).panelImp ? `${(project as any).panelImp}` : '____';
  const vmpV = (project as any).panelVmp ? `${(project as any).panelVmp}` : '____';
  const acOutA = (system.totalAcKw || 0) > 0 ? `${((system.totalAcKw as number) * 1000 / 240).toFixed(1)}` : '____';

  const FILLS: Record<string, Array<string | number>> = {
    'dc-photovoltaic-power-source-ratings': [maxSysVdc, iscCont, impV, vmpV],
    'ac-point-of-connection-disconnect': [acOutA, '240'],
    'inverter-listing-label': [acOutA, '240'],
    'ess-disconnect': [],
  };

  const raw = (fieldLabelData as { labels: RawLabel[] }).labels;
  let n = 0;
  return raw.map((l): FieldLabel => {
    // §16 — required = (system condition) AND (interconnection side applies).
    const side = labelInterconnectSide(l.id);
    const conditionRequired = (REQUIRED_WHEN[l.id] ?? (() => true))(ctx);
    const required = conditionRequired && sideApplies(side, isSupply);
    // TAC WS-13 — design-dependent wording / citation before the fill-in pass.
    const variant = (LABEL_VARIANT[l.id] ?? (() => null))(ctx);
    const _text = variant?.text ?? l.text;
    const _codeRefs = variant?.necSections
      ? l.codeRefs.map(c => (/NEC/i.test(c.code) ? { ...c, section: variant.necSections as string } : c))
      : l.codeRefs;
    const filledText = FILLS[l.id] ? fillBlanks(_text, FILLS[l.id]) : _text;
    const textLines = filledText.split('\n').map(s => s.trim()).filter(Boolean);
    // Ensure the ANSI signal word leads the lines so the renderer styles it.
    const sig = (l.signalWord || '').toUpperCase();
    const lines = sig && textLines[0]?.toUpperCase() !== sig ? [sig, ...textLines] : textLines;
    n += 1;
    return {
      id: `L-${n}`,
      refId: l.id,
      necRef: resolveRef(_codeRefs, year, _cp.ifc, isSupply),
      placement: l.location,
      lines,
      bg: l.colors.background || '#ffffff',
      fg: l.colors.text || '#000000',
      letterHeightIn: l.minLetterHeightIn,
      material: l.material,
      required,
      interconnectSide: side,
    };
  });
}
