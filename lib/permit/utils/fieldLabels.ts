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

/** Resolve the code reference for the job's NEC edition (+ any IFC ref). */
function resolveRef(codeRefs: RawLabel['codeRefs'], year: string): string {
  const nec = codeRefs.filter(c => /NEC/i.test(c.code));
  const ifc = codeRefs.filter(c => /IFC/i.test(c.code));
  const necPick = nec.find(c => c.code.includes(year)) ?? nec[nec.length - 1];
  const ifcPick = ifc.find(c => c.code.includes(year)) ?? ifc[ifc.length - 1];
  const parts: string[] = [];
  if (necPick) parts.push(`NEC ${year} ${necPick.section}`);
  if (ifcPick) parts.push(`${ifcPick.code} ${ifcPick.section}`);
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
  const year = String(compliance.jurisdiction?.necVersion || '2020').match(/20\d\d/)?.[0] || '2020';
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
  const maxSysVdc = !isMicro && panelVoc && panelsPerString
    ? `${Math.round(panelVoc * 1.25 * panelsPerString)}`
    : (panelVoc ? `${Math.round(panelVoc * 1.25)}` : '____');
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
      necRef: resolveRef(l.codeRefs, year),
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
