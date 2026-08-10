// ═══════════════════════════════════════════════════════════════
// Per-sub PANEL SPEC AUTHORITY (data-authority register P0-2/P0-3/P0-4/P1-1)
//
// ONE resolver for a sub-system's module specs — electrical (W/Voc/Isc) AND
// physical (dims/weight) AND thermal (β for the NEC 690.7 cold-Voc law).
// Kills the panel0 disease: client intake writes inverters[0].strings[0]'s
// panel (the FENCE module on Stowell) onto project.panelLengthIn / panelVoc /
// panelWeightLbs, and every sheet that read those scalars printed fence specs
// for the roof (fire-setback coverage, structural dead load, APP-A datasheet).
//
// Resolution order (doctrine: equipment-db record resolved via the map, PER SUB):
//   1. project.subSystems[key].panelId → equipment-db record (full authority).
//   2. The sub's own fleet via resolveEquipmentBySubSystem (wrapped, never
//      forked) — W/Voc/Isc from the tagged strings, dims/β from the
//      equipment-db record matched by the fleet's model.
//   3. project.panel* scalars LAST — the panel0 path, always audited with a
//      console.warn so the contradiction is never silent.
// ═══════════════════════════════════════════════════════════════

import { resolveModuleIdentity } from '@/lib/equipment/moduleIdentity';
import type { PermitInput } from '../types';
import { SOLAR_PANELS, getPanelById, type SolarPanel } from '@/lib/equipment-db';
import { resolveEquipmentBySubSystem, type HybridEquipmentCarrier } from './helpers';

export interface ResolvedPanelSpecs {
  manufacturer: string;
  model: string;
  watts: number;
  voc: number;
  isc: number;
  lengthIn: number;
  widthIn: number;
  weightLbs: number;
  /** β — Voc temperature coefficient (%/°C, negative). Undefined when no
   *  equipment-db record resolved; callers then fall to the blanket ×1.25. */
  tempCoeffVocPctPerC?: number;
  /** The full equipment-db record when one resolved (Vmp/Imp/NOCT/efficiency/
   *  cell type/UL — everything the datasheet card prints). */
  db?: SolarPanel;
  source: 'subsystem-map' | 'sub-fleet' | 'project-scalars';
}

/** CMEI — model text is resolved by THE canonical accessor, which admits an
 *  exact unique match and fails closed on anything ambiguous or partial. This
 *  was a two-way substring match, so 'REC 400' silently became 'REC 400AA Pure-R'. */
function panelDbByModel(model?: string): SolarPanel | undefined {
  const m = (model ?? '').trim();
  if (!m || m === '—') return undefined;
  return resolveModuleIdentity({ model: m }).spec ?? undefined;
}

export function resolvePanelSpecs(
  input: PermitInput,
  cad: HybridEquipmentCarrier | null | undefined,
  subKey: 'roof' | 'ground' | 'fence',
): ResolvedPanelSpecs {
  const project = (input.project ?? {}) as PermitInput['project'];

  // 1. §1.1 equipment-authority map → equipment-db record (the ONE owner).
  const mapEntry = (project as { subSystems?: Record<string, { panelId?: string }> })
    ?.subSystems?.[subKey];
  const byId = mapEntry?.panelId ? getPanelById(mapEntry.panelId) : undefined;
  if (byId) {
    return {
      manufacturer: byId.manufacturer,
      model: byId.model,
      watts: byId.watts,
      voc: byId.voc,
      isc: byId.isc,
      lengthIn: byId.length,
      widthIn: byId.width,
      weightLbs: byId.weight,
      tempCoeffVocPctPerC: byId.tempCoeffVoc,
      db: byId,
      source: 'subsystem-map',
    };
  }

  // 2. The sub's own fleet (resolveEquipmentBySubSystem — wrapped, not forked):
  //    electrical from the tagged strings; physical/thermal from the
  //    equipment-db record its model resolves to.
  const eq = resolveEquipmentBySubSystem(input, subKey, cad ?? undefined);
  const db = panelDbByModel(eq.panelModel);
  if ((eq.panelModel && eq.panelModel !== '—') || db) {
    return {
      manufacturer: (eq.panelManufacturer && eq.panelManufacturer !== '—')
        ? eq.panelManufacturer : (db?.manufacturer ?? '—'),
      model: (eq.panelModel && eq.panelModel !== '—') ? eq.panelModel : (db?.model ?? '—'),
      watts: eq.panelWatts || db?.watts || 0,
      voc: eq.panelVoc || db?.voc || 0,
      isc: eq.panelIsc || db?.isc || 0,
      lengthIn: db?.length ?? (project.panelLengthIn || 0),
      widthIn: db?.width ?? (project.panelWidthIn || 0),
      weightLbs: db?.weight ?? (project.panelWeightLbs || 0),
      tempCoeffVocPctPerC: db?.tempCoeffVoc,
      db,
      source: 'sub-fleet',
    };
  }

  // 3. LAST RESORT — project.panel* scalars (panel0). Audit line so a sheet
  //    silently riding panel0 is visible in the generation log.
  const p = project as {
    panelManufacturer?: string; panelBrand?: string; panelModel?: string; panelWatts?: number;
  } & PermitInput['project'];
  console.warn(
    `[panelSpecs] panel0 fallback: sub '${subKey}' has no resolvable per-sub panel `
    + `(no subSystems[${subKey}].panelId, no tagged fleet) — using project.panel* scalars `
    + `(model=${p.panelModel ?? '—'}, voc=${project.panelVoc ?? 0}, `
    + `dims=${project.panelLengthIn ?? 0}x${project.panelWidthIn ?? 0}in, `
    + `weight=${project.panelWeightLbs ?? 0}lbs)`,
  );
  const scalarDb = panelDbByModel(p.panelModel);
  return {
    manufacturer: p.panelManufacturer || p.panelBrand || '—',
    model: p.panelModel || '—',
    watts: p.panelWatts || scalarDb?.watts || 0,
    voc: project.panelVoc || scalarDb?.voc || 0,
    isc: project.panelIsc || scalarDb?.isc || 0,
    lengthIn: project.panelLengthIn || scalarDb?.length || 0,
    widthIn: project.panelWidthIn || scalarDb?.width || 0,
    weightLbs: project.panelWeightLbs || scalarDb?.weight || 0,
    tempCoeffVocPctPerC: scalarDb?.tempCoeffVoc,
    db: scalarDb,
    source: 'project-scalars',
  };
}

/**
 * THE cold-Voc law (NEC 690.7(A)) — β-based correction when the module's Voc
 * temperature coefficient is known, else the conservative blanket ×1.25
 * (NEC 690.7 Table criterion). Register P1-4: this is the ONE law; no sheet
 * may hand-roll `voc * 1.25` when β is resolvable.
 */
export function coldVocFactor(
  tempCoeffVocPctPerC: number | undefined,
  designTempMinC: number,
): number {
  return (typeof tempCoeffVocPctPerC === 'number' && isFinite(tempCoeffVocPctPerC))
    ? 1 + (tempCoeffVocPctPerC / 100) * (designTempMinC - 25)
    : 1.25;
}
