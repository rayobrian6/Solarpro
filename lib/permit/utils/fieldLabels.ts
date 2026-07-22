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

export interface FieldLabel {
  id: string;            // display id, L-1..
  refId: string;         // source id from the dataset
  necRef: string;        // code ref resolved to the job's NEC edition
  placement: string;     // where it's installed
  lines: string[];       // rendered lines (signal word first when present)
  bg: string;
  fg: string;
  letterHeightIn: number;
  material: string;
  required: boolean;     // does it apply to THIS system?
}

interface Ctx {
  isMicro: boolean;
  isSupply: boolean;
  hasBattery: boolean;
  rapidShutdown: boolean;
  acDisconnect: boolean;
}

// Which system conditions require each label. Engineering judgment lives here
// (the raw data carries the wording/codes/colors, not the boolean gating).
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
  'backfeed-breaker-do-not-relocate': c => !c.isSupply,
  'dual-power-source-inverter-output': () => true,
  'multiple-sources-of-power-directory': () => true,
  'line-side-tap-warning': c => c.isSupply,
  'photovoltaic-system-connected': () => true,
  'ess-disconnect': c => c.hasBattery,
  'ess-master-placard': c => c.hasBattery,
  'grounding-electrode-conductor-marking': () => true,
  'inverter-listing-label': () => true,
};

/** §11 — resolve the label's code SECTION references. NEC follows the AHJ's
 *  adopted cycle (`necYear`, the jurisdiction's NEC — the same source
 *  codeAuthority derives NEC from, and what the placard cycle is selected by).
 *  The IFC edition is SINGLE-SOURCED from snapshot.codeAuthority (`ifcEd`): the
 *  placard JSON's baked-in "IFC 2021" literal may NEVER leak, because the IFC
 *  authority is unverified/pending on most jobs — an "IFC 2021" claim was a
 *  FALSE edition. A missing IFC edition prints PENDING (section still cited). */
function resolveRef(codeRefs: RawLabel['codeRefs'], necYear: string, ifcEd: string | null): string {
  const nec = codeRefs.filter(c => /NEC/i.test(c.code));
  const ifc = codeRefs.filter(c => /IFC/i.test(c.code));
  const necPick = nec.find(c => c.code.includes(necYear)) ?? nec[nec.length - 1];
  // Never pick by the placard's own edition literal; use the authority edition
  // (or the latest listed section when pending — the section, not its edition).
  const ifcPick = (ifcEd ? ifc.find(c => c.code.includes(ifcEd)) : undefined) ?? ifc[ifc.length - 1];
  const parts: string[] = [];
  if (necPick) parts.push(`NEC ${necYear} ${necPick.section}`);
  if (ifcPick) parts.push(`IFC ${ifcEd ?? 'PENDING'} ${ifcPick.section}`);
  return parts.join('  ·  ') || (codeRefs[0] ? `${codeRefs[0].code} ${codeRefs[0].section}` : '');
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
    const required = (REQUIRED_WHEN[l.id] ?? (() => true))(ctx);
    const filledText = FILLS[l.id] ? fillBlanks(l.text, FILLS[l.id]) : l.text;
    const textLines = filledText.split('\n').map(s => s.trim()).filter(Boolean);
    // Ensure the ANSI signal word leads the lines so the renderer styles it.
    const sig = (l.signalWord || '').toUpperCase();
    const lines = sig && textLines[0]?.toUpperCase() !== sig ? [sig, ...textLines] : textLines;
    n += 1;
    return {
      id: `L-${n}`,
      refId: l.id,
      necRef: resolveRef(l.codeRefs, year, _cp.ifc),
      placement: l.location,
      lines,
      bg: l.colors.background || '#ffffff',
      fg: l.colors.text || '#000000',
      letterHeightIn: l.minLetterHeightIn,
      material: l.material,
      required,
    };
  });
}
