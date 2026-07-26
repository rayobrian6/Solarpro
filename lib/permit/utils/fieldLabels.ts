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
  'grounding-electrode-conductor-marking': () => true,
  'inverter-listing-label': () => true,
};

// §16 — NEC 705 section clauses are SIDE-SPECIFIC. On a supply-side (705.11)
// design a load-side 705.12 clause is wrong authority and must not print; on a
// load-side (705.12) design the supply-side 705.11 clause must not print. 705.10
// (grouped power-source directory) and everything else is general (both sides).
//   • 705.11 / 705.12(A)  → supply-side (705.12(A) was the 2017 supply-side ref)
//   • 705.12(B..)/705.12/705.13 → load-side
function necSectionSide(part: string): 'supply' | 'load' | 'general' {
  const s = part.trim();
  if (/705\.11\b/.test(s)) return 'supply';
  if (/705\.12\(A\)/.test(s)) return 'supply';
  if (/705\.13\b/.test(s)) return 'load';
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
  const ctx: Ctx = {
    isMicro,
    isSupply,
    hasBattery: hasRealBattery(project),
    rapidShutdown: !!project.rapidShutdown,
    acDisconnect: project.acDisconnect !== false,
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
    const filledText = FILLS[l.id] ? fillBlanks(l.text, FILLS[l.id]) : l.text;
    const textLines = filledText.split('\n').map(s => s.trim()).filter(Boolean);
    // Ensure the ANSI signal word leads the lines so the renderer styles it.
    const sig = (l.signalWord || '').toUpperCase();
    const lines = sig && textLines[0]?.toUpperCase() !== sig ? [sig, ...textLines] : textLines;
    n += 1;
    return {
      id: `L-${n}`,
      refId: l.id,
      necRef: resolveRef(l.codeRefs, year, _cp.ifc, isSupply),
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
