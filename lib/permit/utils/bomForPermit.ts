// ============================================================
// BOM Generation Helper for Permit Pipeline
// lib/permit/utils/bomForPermit.ts
//
// generateBOMForPermit(input, cad): PermitBOMItem[]
//
// ARCHITECTURE:
//   PermitInput + CADModel
//     → resolve equipment IDs from registry (fuzzy model name lookup)
//     → generateBOMV4() for electrical BOM (if inverterId resolves)
//     → extractStructuralInputFromCAD() + deriveStructuralBOM() for structural
//     → sizingResultToBomItems() for brand-level BOS (if sizing available)
//     → merge + dedup → PermitBOMItem[]
//
// FALLBACK STRATEGY:
//   If inverterId cannot be resolved from registry, we emit a
//   minimal hand-built BOM from PermitInput system data so the
//   Equipment Schedule page always has something to render.
//
// ZERO REGRESSION: This file is additive. Nothing in the existing
// permit pipeline is modified by importing this file.
// ============================================================

import type { PermitInput } from '../types';
import type { CADModel } from '@/lib/cad/types';
import {
  generateBOMV4,
  type BOMGenerationInputV4,
  type BOMLineItemV4,
} from '@/lib/bom-engine-v4';
import {
  deriveStructuralBOM,
  extractStructuralInputFromCAD,
  type BOMSystemType,
  type StructuralBOMItem,
} from '@/lib/bom-system-profiles';
import {
  EQUIPMENT_REGISTRY_V4,
  type EquipmentRegistryEntry,
} from '@/lib/equipment-registry-v4';
import { necNextStandardOcpd } from './helpers';
import { buildConductorAuthority, type ConductorAuthority } from './conductorAuthority';
import { buildIntegratedEquipment } from './integratedEquipment';
import { buildHybridAcCollection } from './sldAdapter';
import { MICROINVERTERS, STRING_INVERTERS, SOLAR_PANELS } from '@/lib/equipment-db';
import {
  SOLFENCE_MOUNTING_ID,
  type SubSystemEquipment,
  type SubSystemKey,
} from '@/lib/system/subSystemEquipment';
import { buildCanonical } from './canonical';
import { buildStructuralInputForPermit, buildSubSystemStructuralInputs } from './structuralInput';
import { resolveArrayStructuralLayout } from './arrayLayout';
import { runStructuralCalcV4 } from '@/lib/structural-engine-v4';
import { deriveRunLengths } from '@/lib/bom/deriveRunLengths';
import { buildComputedRunsForPermit } from './computedRuns';
import { peekSnapshot } from '../snapshot/read';
import { projectCanonicalFeeder, projectOpenAirBranchGrounding } from '../snapshot/electricalProjection';
import { GROUNDING_NON_ORDERABLE_LABEL, GROUNDING_AUTHORITY_BLOCKER_CODE } from '../snapshot/groundingAuthority';
import { projectFastenerAssembly, FASTENER_NON_ORDERABLE_LABEL } from '../snapshot/structuralProjection';

// ── PermitBOMItem ────────────────────────────────────────────
// Superset type: always safe to render in pageEquipmentSchedule.
// All V4 fields are optional for backward compat with legacy bom[].

export interface PermitBOMItem {
  // Core identity (always present)
  category: string;
  manufacturer: string;
  model: string;
  partNumber: string;
  quantity: number;
  unit: string;
  description?: string;
  // V4 enrichment fields
  id?: string;
  stageId?: string;
  stageLabel?: string;
  necReference?: string;
  derivedFrom?: string;
  formula?: string;
  notes?: string;
  required?: boolean;
  /** §6 (BAR) — the row is a DESIGN QUANTITY only: it may NOT be ordered and is
   *  excluded from the authoritative procurement totals until its authority
   *  verifies (today: FASTENER-ASSEMBLY-UNVERIFIED). The quantity is retained so
   *  the exact orderable row auto-regenerates on verification. */
  nonOrderable?: boolean;
  /** PPC §5/§9 — WHY the row is non-orderable (governing blocker code + reason).
   *  Rendered on the schedule so the row states its own status. */
  nonOrderableReason?: string;
  /** PPC §8 — is the QUANTITY established? 'pending' ⇒ the cell may never print a
   *  bare number and the row is excluded from procurement approval. */
  quantityState?: 'established' | 'pending';
  /** PPC §8 — the label the quantity cell prints while pending, e.g.
   *  '0 MODELED / FIELD QUANTITY PENDING'. */
  quantityStateLabel?: string;
  unitCost?: number;
  totalCost?: number;
  /** Wave 5B passthrough of the Wave-2c per-sub stamp ('roof'|'ground'|'fence')
   *  — SCHED groups stage rows by sub WHERE STAMPED (hybrid only). */
  subSystem?: string;
  // Legacy compat
  ulListing?: string;
}

// ── Stage label display names ────────────────────────────────
const STAGE_LABELS: Record<string, string> = {
  array:      'Stage 1 — Array',
  dc:         'Stage 2 — DC Wiring',
  inverter:   'Stage 3 — Inverter & AC',
  ac:         'Stage 4 — AC Wiring',
  structural: 'Stage 5 — Structural',
  monitoring: 'Stage 6 — Monitoring',
  labels:     'Stage 7 — Labels & Signage',
};

// ── Registry fuzzy lookup ────────────────────────────────────
// Tries exact ID match first, then model name contains match.
// Returns undefined if no entry found.

function resolveRegistryEntry(
  model: string | undefined,
  manufacturer: string | undefined,
): EquipmentRegistryEntry | undefined {
  if (!model) return undefined;
  const m = model.toLowerCase().trim();
  const mfr = (manufacturer || '').toLowerCase().trim();

  // 1. Exact ID match (e.g. 'enphase-iq8m')
  const byId = EQUIPMENT_REGISTRY_V4.find(e => e.id === m);
  if (byId) return byId;

  // 2. Model field exact (case-insensitive)
  const byModelExact = EQUIPMENT_REGISTRY_V4.find(
    e => e.model.toLowerCase() === m,
  );
  if (byModelExact) return byModelExact;

  // 3. Model contains match + manufacturer match (most reliable fuzzy)
  if (mfr) {
    const byBoth = EQUIPMENT_REGISTRY_V4.find(
      e =>
        e.manufacturer.toLowerCase().includes(mfr) &&
        (e.model.toLowerCase().includes(m) || m.includes(e.model.toLowerCase())),
    );
    if (byBoth) return byBoth;
  }

  // 4. Model contains match (no manufacturer constraint)
  const byModelContains = EQUIPMENT_REGISTRY_V4.find(
    e => e.model.toLowerCase().includes(m) || m.includes(e.model.toLowerCase()),
  );
  return byModelContains;
}

// ── Map CAD systemType to BOMSystemType ─────────────────────
function cadTypeToBOMType(cadSystemType: string | undefined): BOMSystemType {
  if (cadSystemType === 'solar_fence') return 'fence';
  if (cadSystemType === 'ground_mount') return 'ground';
  return 'roof';
}

// ── Convert BOMLineItemV4 → PermitBOMItem ────────────────────
function v4ToPermit(item: BOMLineItemV4): PermitBOMItem {
  return {
    id:           item.id,
    stageId:      item.stageId,
    stageLabel:   STAGE_LABELS[item.stageId] ?? item.stageLabel,
    category:     item.category,
    manufacturer: item.manufacturer,
    model:        item.model,
    partNumber:   item.partNumber || '—',
    quantity:     item.quantity,
    unit:         item.unit,
    description:  item.description,
    necReference: item.necReference,
    derivedFrom:  item.derivedFrom,
    formula:      item.formula,
    notes:        item.notes,
    required:     item.required,
    unitCost:     item.unitCost,
    totalCost:    item.totalCost,
    // Per-sub stamp survives into the permit BOM (set by generateBOMV4 only
    // when the generation input carries subSystems — Wave 2c).
    subSystem:    item.subSystem,
    // PPC §5/§8 — the orderability / quantity state crosses the LAST type
    // boundary (BOMLineItemV4 → PermitBOMItem). Dropping it here is what left the
    // renderer casting `(item as { nonOrderable?: boolean })`.
    nonOrderable:       item.nonOrderable,
    nonOrderableReason: item.nonOrderableReason,
    quantityState:      item.quantityState,
    quantityStateLabel: item.quantityStateLabel,
  };
}

// ── Convert StructuralBOMItem → PermitBOMItem ─────────────────
function structuralToPermit(item: StructuralBOMItem, idx: number): PermitBOMItem {
  return {
    id:           `bom-struct-${idx.toString().padStart(4, '0')}`,
    stageId:      item.stageId,
    stageLabel:   STAGE_LABELS[item.stageId] ?? 'Stage 5 — Structural',
    category:     item.category,
    manufacturer: item.manufacturer,
    model:        item.model,
    partNumber:   item.partNumber || '—',
    quantity:     item.quantity,
    unit:         item.unit === 'bag' || item.unit === 'kit' ? 'ea' : item.unit,
    description:  item.description,
    necReference: 'IBC 2021',
    derivedFrom:  `geometry: ${item.derivedFrom}`,
    required:     item.required,
  };
}

// ── Build minimal fallback BOM from PermitInput ───────────────
// Used when V4 cannot run (no inverterId resolved). Produces items
// for modules, inverters, and basic AC hardware so the page is
// never blank.

function buildFallbackBOM(input: PermitInput, cad: CADModel): PermitBOMItem[] {
  const items: PermitBOMItem[] = [];
  const { system, project, compliance } = input;
  const totalPanels = cad.totalPanels || system.totalPanels || 0;
  const totalDcKw   = cad.totalDcKw   || system.totalDcKw   || 0;
  const acKw        = system.totalAcKw || 0;

  // Panels
  const firstStr = system.inverters?.[0]?.strings?.[0];
  if (totalPanels > 0) {
    items.push({
      stageId:      'array',
      stageLabel:   STAGE_LABELS['array'],
      category:     'solar_panel',
      manufacturer: firstStr?.panelManufacturer || '—',
      model:        firstStr?.panelModel || '—',
      partNumber:   '—',
      quantity:     totalPanels,
      unit:         'ea',
      description:  `${firstStr?.panelWatts || Math.round(totalDcKw * 1000 / Math.max(totalPanels, 1))}W PV Module`,
      necReference: 'NEC 690',
      derivedFrom:  'cad.totalPanels',
      required:     true,
    });
  }

  // Inverters
  const invs = system.inverters || [];
  const isMicro = (system.topology || '').toLowerCase() === 'micro' ||
                  invs[0]?.type === 'micro';
  const invCount = isMicro ? totalPanels : invs.length;
  if (invs.length > 0 && invCount > 0) {
    items.push({
      stageId:      'inverter',
      stageLabel:   STAGE_LABELS['inverter'],
      category:     isMicro ? 'microinverter' : 'string_inverter',
      manufacturer: invs[0]?.manufacturer || '—',
      model:        invs[0]?.model || '—',
      partNumber:   '—',
      quantity:     invCount,
      unit:         'ea',
      description:  isMicro
        ? `${invs[0]?.manufacturer || ''} ${invs[0]?.model || ''} Microinverter`.trim()
        : `${invs[0]?.manufacturer || ''} ${invs[0]?.model || ''} String Inverter`.trim(),
      necReference: 'NEC 690.8',
      derivedFrom:  isMicro ? 'cad.totalPanels (1:1 micro)' : 'system.inverters.length',
      required:     true,
    });
  }

  // AC Disconnect
  const hasDisc = project.acDisconnect !== false;
  if (hasDisc) {
    const mainA  = project.mainPanelAmps || 200;
    const ocpd   = acKw > 0 ? necNextStandardOcpd(acKw * 1000 / 240 * 1.25) : 40;
    items.push({
      stageId:      'ac',
      stageLabel:   STAGE_LABELS['ac'],
      category:     'disconnect',
      manufacturer: '—',
      model:        `${ocpd}A Non-Fused AC Disconnect`,
      partNumber:   '—',
      quantity:     1,
      unit:         'ea',
      description:  `${ocpd}A non-fused AC disconnect — NEC 690.15`,
      necReference: 'NEC 690.15',
      derivedFrom:  'acKw → OCPD calc',
      required:     true,
    });
  }

  // Backfeed breaker
  if (acKw > 0) {
    const bfA = necNextStandardOcpd(acKw * 1000 / 240 * 1.25);
    items.push({
      stageId:      'ac',
      stageLabel:   STAGE_LABELS['ac'],
      category:     'breaker',
      manufacturer: '—',
      model:        `${bfA}A 2-Pole Backfeed Breaker`,
      partNumber:   '—',
      quantity:     1,
      unit:         'ea',
      description:  `${bfA}A 2-pole backfeed breaker at MSP — NEC 705.12(B)`,
      necReference: 'NEC 705.12(B)',
      derivedFrom:  'acKw → backfeedAmps calc',
      required:     true,
    });
  }

  // Rapid Shutdown
  items.push({
    stageId:      'ac',
    stageLabel:   STAGE_LABELS['ac'],
    category:     'rapid_shutdown',
    manufacturer: '—',
    model:        isMicro ? 'Integrated RSD (Microinverter)' : 'Rapid Shutdown Device',
    partNumber:   '—',
    quantity:     1,
    unit:         'ea',
    description:  'Rapid shutdown per NEC 690.12',
    necReference: 'NEC 690.12',
    derivedFrom:  'topology',
    required:     true,
  });

  // Warning labels
  items.push({
    stageId:      'labels',
    stageLabel:   STAGE_LABELS['labels'],
    category:     'label',
    manufacturer: '—',
    model:        'NEC 690 Warning Label Set',
    partNumber:   '—',
    quantity:     1,
    unit:         'set',
    description:  'Warning labels per NEC 690.54, 690.56, 690.31',
    necReference: 'NEC 690.54 / 690.56',
    derivedFrom:  'compliance',
    required:     true,
  });

  // Battery (if present)
  const battCount = project.batteryCount || 0;
  if (battCount > 0) {
    items.push({
      stageId:      'inverter',
      stageLabel:   STAGE_LABELS['inverter'],
      category:     'battery',
      manufacturer: project.batteryBrand || '—',
      model:        project.batteryModel || '—',
      partNumber:   '—',
      quantity:     battCount,
      unit:         'ea',
      description:  `${project.batteryBrand || ''} ${project.batteryModel || ''} Battery Storage`.trim(),
      necReference: 'NEC 706',
      derivedFrom:  'project.batteryCount',
      required:     true,
    });
  }

  return items;
}

// ── Hybrid per-sub equipment map (SYSTEMIC ROOT #1) ───────────
// generateBOMV4 already owns a correct per-sub path (generateBOMV4PerSubSystem)
// that runs Stages 1–3 PER SUB — but it only fires when the caller hands it a
// `subSystemEquipment` map with N>1 entries. Until now bomForPermit never built
// one, so every hybrid fell through to the legacy single-fleet path: one
// inverter line (the roof brand) × the PROJECT panel total → "91 Enphase
// micros", one 91-device trunk, one whole-system combiner. This builder derives
// the map from the per-sub conductor authority so the engine emits each sub's
// OWN inverter (roof→micros×roof, ground→1 string, fence→optimizers×fence +
// inverter) at its OWN count, and scopes the micro cabling/caps to the roof sub.

const _norm = (s?: string | null) => (s ?? '').toLowerCase().trim();

/** Resolve an equipment-db / V4-registry id from a make+model, so the per-sub
 *  engine prints the REAL device instead of a TBD line. Prefers the sub's own
 *  project.subSystems id when the payload carries one. Undefined ⇒ engine falls
 *  back to the sub's ecosystemBrand + topology (still correct count/topology). */
function resolveInverterIdFromNames(mfr: string, model: string, isMicro: boolean): string | undefined {
  if (_norm(model) === '' || _norm(model) === '—') return undefined;
  const v4 = resolveRegistryEntry(model, mfr);
  if (v4) return v4.id;
  const nm = _norm(model), nf = _norm(mfr);
  const pool = (isMicro ? MICROINVERTERS : STRING_INVERTERS) as Array<{ id: string; manufacturer?: string; model?: string }>;
  const hit = pool.find(e => (!nf || _norm(e.manufacturer).includes(nf) || nf.includes(_norm(e.manufacturer)))
    && (_norm(e.model).includes(nm) || nm.includes(_norm(e.model))));
  return hit?.id;
}

function resolvePanelIdFromNames(mfr: string, model: string): string | undefined {
  if (_norm(model) === '' || _norm(model) === '—') return undefined;
  const v4 = resolveRegistryEntry(model, mfr);
  if (v4) return v4.id;
  const nm = _norm(model), nf = _norm(mfr);
  const hit = (SOLAR_PANELS as Array<{ id: string; manufacturer?: string; model?: string }>).find(e =>
    (!nf || _norm(e.manufacturer).includes(nf) || nf.includes(_norm(e.manufacturer)))
    && (_norm(e.model).includes(nm) || nm.includes(_norm(e.model))));
  return hit?.id;
}

/** One SubSystemEquipment map from the per-sub conductor authority — the input
 *  generateBOMV4's hybrid path consumes. Only built when the authority is
 *  hybrid (N>1 subs); single-system jobs keep the byte-identical legacy path. */
function buildSubSystemEquipmentMap(
  input: PermitInput,
  auth: ConductorAuthority,
): Partial<Record<SubSystemKey, SubSystemEquipment>> {
  const project = input.project as PermitInput['project'] & {
    subSystems?: Record<string, { inverterId?: string; panelId?: string; optimizerId?: string;
      mountingId?: string; ecosystemBrand?: string; topology?: string }>;
    mountingSystemId?: string; rackingId?: string; optimizerPeripheralId?: string;
    roofType?: string; trenchRunLengthFt?: number; conduitType?: string;
  };
  const nowIso = '2026-07-13T00:00:00.000Z'; // deterministic; the map is transient input, never persisted
  const map: Partial<Record<SubSystemKey, SubSystemEquipment>> = {};

  for (const sub of auth.subSystems) {
    const key = sub.key;
    const pm = project.subSystems?.[key];
    const topo: SubSystemEquipment['topology'] =
      sub.topology === 'MICRO' ? 'micro' : sub.topology === 'OPTIMIZER' ? 'optimizer' : 'string';
    const e = sub.equipment;

    map[key] = {
      key,
      topology: topo,
      inverterId: pm?.inverterId ?? resolveInverterIdFromNames(e.inverterManufacturer, e.inverterModel, sub.isMicro),
      panelId: pm?.panelId ?? resolvePanelIdFromNames(e.panelManufacturer, e.panelModel),
      optimizerId: pm?.optimizerId ?? (topo === 'optimizer' ? project.optimizerPeripheralId : undefined),
      ecosystemBrand: pm?.ecosystemBrand
        ?? (e.inverterManufacturer !== '—' ? e.inverterManufacturer.toLowerCase() : undefined),
      // Fence ALWAYS mounts on SolFence (contract §1.1); roof/ground take the
      // project-wide racking. Never clone the roof racking onto the fence.
      mountingId: key === 'fence'
        ? SOLFENCE_MOUNTING_ID
        : (pm?.mountingId ?? project.rackingId ?? project.mountingSystemId ?? undefined),
      roofType: key === 'roof' ? (project.roofType || undefined) : undefined,
      trenchRunLengthFt: key !== 'roof' ? (project.trenchRunLengthFt || undefined) : undefined,
      env: {
        rooftopTempAdderC: key === 'roof' ? 30 : 0,
        ...(project.conduitType ? { conduitType: project.conduitType } : {}),
      },
      source: 'engineering',
      updatedAt: nowIso,
    };
  }
  return map;
}

// ── Main entry point ──────────────────────────────────────────
/**
 * Generate a full BOM for the permit pipeline.
 *
 * Strategy:
 *   1. Try to resolve inverterId + panelId from registry (fuzzy lookup on model name).
 *   2. If V4 can run → call generateBOMV4() for electrical items.
 *   3. Always call extractStructuralInputFromCAD() + deriveStructuralBOM() for structural.
 *   4. If V4 failed → emit minimal fallback BOM from PermitInput data.
 *   5. Deduplicate: structural items whose category is V4-owned are stripped.
 *   6. Sort by stageId then category.
 *
 * @returns PermitBOMItem[] — safe to pass into PermitInput.bom
 */
export function generateBOMForPermit(
  input: PermitInput,
  cad: CADModel,
): PermitBOMItem[] {
  const { system, project, compliance } = input;
  const log: string[] = [];

  // ── 1. Resolve equipment IDs ─────────────────────────────
  const firstInv = system.inverters?.[0];
  const firstStr = firstInv?.strings?.[0];

  const inverterEntry = resolveRegistryEntry(firstInv?.model, firstInv?.manufacturer);
  const panelEntry    = resolveRegistryEntry(firstStr?.panelModel, firstStr?.panelManufacturer);

  log.push(`[bomForPermit] inverter: ${firstInv?.model} → ${inverterEntry?.id ?? 'not found'}`);
  log.push(`[bomForPermit] panel:    ${firstStr?.panelModel} → ${panelEntry?.id ?? 'not found'}`);

  const inverterId = inverterEntry?.id;
  const panelId    = panelEntry?.id;

  // ── 2. Compute sizing params ─────────────────────────────
  const totalPanels  = cad.totalPanels  || system.totalPanels  || 0;
  const totalDcKw    = cad.totalDcKw    || system.totalDcKw    || 0;
  const totalAcKw    = system.totalAcKw  || 0;
  const mainPanelA   = project.mainPanelAmps || 200;
  const acKw         = totalAcKw;
  const acOutputAmps = acKw * 1000 / 240;
  // Shared conductor authority — the BOM's AC feeder gauge + OCPD must match
  // what PV-4A/PV-4B/E-1 print (the "4th independent compute" this collapses).
  const _auth        = buildConductorAuthority(input, cad);
  const backfeedAmps = _auth.acFeeder.ocpdAmps ?? necNextStandardOcpd(acOutputAmps * 1.25);
  const isMicro      = (system.topology || '').toLowerCase() === 'micro' ||
                       firstInv?.type === 'micro';
  // SYSTEMIC ROOT #1 — hybrid BOM routes through generateBOMV4's per-sub path so
  // each sub bills its OWN inverter at its OWN count (kills "91 Enphase micros").
  // Only built for genuine hybrids (N>1 subs) AND when the CAD carries the
  // section split the engine apportions modules by; single-system jobs keep the
  // byte-identical legacy path (Wave-0 goldens pin it).
  const _perSubEquipment = (_auth.isHybrid && _auth.subSystems.length > 1 && cad.hybrid)
    ? buildSubSystemEquipmentMap(input, _auth)
    : undefined;
  const _isPerSubHybrid = !!_perSubEquipment;

  // The V4 engine's per-sub hybrid path resolves EACH sub's inverter itself and
  // does not need a registry-resolvable PRIMARY. But V4 needs *some* inverterId
  // for its legacy-mirror field. When the project's inverters[0] misses the V4
  // registry (common on hybrids whose first inverter is a string model), fall
  // back to the first per-sub resolved inverterId so V4 still runs the correct
  // per-sub BOM instead of dropping to the minimal fallback (which billed one
  // string-inverter fleet + a kW-guess disconnect and no per-sub micros).
  const _perSubPrimaryInvId = _perSubEquipment
    ? (['roof', 'ground', 'fence'] as SubSystemKey[])
        .map(k => _perSubEquipment[k]?.inverterId).find(Boolean)
    : undefined;
  const _v4InverterId = inverterId ?? _perSubPrimaryInvId;

  // Stage D — the hybrid AC collection (per-source combiners → ONE shared AC
  // combiner panel → ONE system disconnect) from the SAME resolver E-1 draws.
  // Null for single-system. Feeds both the V4 disconnect rating (below) and the
  // shared-panel BOM line (step 5c) so BOM/SCHED/E-1 print identical hardware.
  const _acCollection = buildHybridAcCollection(input, cad);

  const stringCount   = system.inverters?.reduce((sum, inv) => sum + (inv.strings?.length || 0), 0) || 1;
  const inverterCount = isMicro ? totalPanels : (system.inverters?.length || 1);
  const deviceCount   = isMicro ? totalPanels : undefined;

  const elec = compliance.electrical;
  const dcWireGauge   = firstStr?.wireGauge || elec?.dcConductorCallout || '#10 AWG';
  // Plain gauge from the authority (e.g. '#8 AWG'), not the raw callout string
  // ('3#8 THWN-2 …') which V4 mis-parsed into an oversized conductor.
  const acWireGauge   = _auth.acFeeder.wireGauge;

  // Wire lengths per stage — derive the FULL real run path from CAD geometry via
  // the existing deriveRunLengths engine, instead of a single segment / flat
  // default. Each `?? 0` only contributes a segment the engine could actually
  // derive from geometry (undefined segments add nothing — no default padding).
  const _rl = (() => {
    try { return deriveRunLengths(cad).runLengths; } catch { return {} as Record<string, number>; }
  })();
  // DC path: string home run + roof run + array-to-inverter conduit (micro roof
  // open-air is priced separately in the DC stage).
  const _dcPathFt = (_rl.DC_STRING_RUN ?? 0) + (_rl.ROOF_RUN ?? 0) + (_rl.ARRAY_CONDUIT_RUN ?? 0);
  // AC feeder path: inverter/combiner → disconnect → meter → main service panel.
  const _acPathFt = (_rl.COMBINER_TO_DISCO_RUN ?? _rl.INV_TO_DISCO_RUN ?? 0)
    + (_rl.DISCO_TO_METER_RUN ?? 0) + (_rl.METER_TO_MSP_RUN ?? 0);
  const dcWireLength  = firstStr?.wireLength || (_dcPathFt > 0 ? _dcPathFt : 0) || project.wireLength || 50;
  const acWireLength  = (_acPathFt > 0 ? _acPathFt : 0) || project.wireLength || 60;
  // §3 (07-22) — conduit fittings must match the CANONICAL feeder segment raceway
  // + size (EMT fittings for EMT, PVC for PVC, sized to the segment), not a stray
  // project.conduitType. Single-source from the snapshot feeder segment; the
  // project scalars are only the standalone fallback.
  const _bomFeed = projectCanonicalFeeder(peekSnapshot(input));
  const _rawConduitType = (_bomFeed.raceway ?? project.conduitType ?? 'EMT');
  const conduitType   = _rawConduitType.toUpperCase().replace(/\s+SCH.*$/i, '').trim() as 'EMT' | 'PVC' | 'RMC' | 'LFMC';
  const conduitSize   = (_bomFeed.tradeSizeIn ?? project.conduitSize ?? '3/4').replace(/"/g, '');

  // ── 3. Structural ─────────────────────────────────────────
  const bomSystemType = cadTypeToBOMType(cad.systemType);
  let structItems: PermitBOMItem[];
  if (cad.hybrid) {
    // HYBRID (P2): fence posts AND ground piles — each sub-system's structural
    // BOM derives from ITS OWN panel subset + CAD section (the legacy single
    // switch billed one type for every panel: Stowell got fence posts for all
    // 80 modules and zero piles/rails). Roof racking comes from the V4
    // rackingBOM path below, as for single-roof jobs.
    structItems = [];
    let _idx = 0;
    for (const sec of cad.hybrid.sections) {
      if (sec.key === 'roof') continue; // V4 rackingBOM path handles roof
      const bomType = sec.key === 'fence' ? 'fence' : 'ground';
      const secInput = extractStructuralInputFromCAD(bomType as BOMSystemType, sec.totalPanels, cad);
      const secResult = deriveStructuralBOM(secInput);
      // Wave 5B: stamp each hybrid structural line with its owning sub so the
      // SCHED table can group fence posts under FENCE and piles under GROUND.
      for (const item of secResult.items) structItems.push({ ...structuralToPermit(item, _idx++), subSystem: sec.key });
      log.push(`[bomForPermit] hybrid ${sec.key} structural: ${secResult.items.length} items (${sec.totalPanels} panels)`);
    }
  } else {
    const structInput  = extractStructuralInputFromCAD(bomSystemType, totalPanels, cad);
    const structResult = deriveStructuralBOM(structInput);
    structItems = structResult.items.map((item, idx) => structuralToPermit(item, idx));
    log.push(`[bomForPermit] structural: ${structItems.length} items (${bomSystemType})`);
  }

  // Roof racking SINGLE SOURCE: re-derive the structural engine's real
  // rackingBOM (rail count from real length, splices, clamps, lag + rail bolts)
  // via the SAME builder generatePermit uses — so the BOM matches the structural
  // sheets instead of guessing attachmentCount/railSections. Deterministic:
  // buildCanonical + buildStructuralInputForPermit are pure functions of `input`.
  // Real design layout (pure selector — same values the structural path reads):
  // orientation → trunk SKU, subArrayCount → trunk bridge splices.
  const _arrayLayout = resolveArrayStructuralLayout(input, cad);
  let roofRackingBOM: import('@/lib/structural-engine-v4').RackingBOM | undefined;
  let roofMountCount = 0;
  let roofRowCount   = 0;
  // HYBRID (P2): per-sub-system structural results — fence posts + ground piles
  // come from THEIR analyzers, roof racking from ITS scoped run (unscoped, the
  // roof run sized rails for fence+ground panels too).
  let fenceStructural: import('@/lib/structural-engine-v4').StructuralResultV4 | undefined;
  let groundStructural: import('@/lib/structural-engine-v4').StructuralResultV4 | undefined;
  if (bomSystemType === 'roof' || cad.hybrid) {
    try {
      const _canonical = buildCanonical(input);
      const _runs = buildSubSystemStructuralInputs(input, cad, _canonical);
      for (const r of _runs) {
        try {
          const _sr = runStructuralCalcV4(r.input);
          if (r.key === 'roof') {
            roofRackingBOM = _sr.rackingBOM;
            roofMountCount = _sr.mountLayout?.mountCount ?? 0;
            roofRowCount   = _sr.arrayGeometry?.rowCount ?? 0;
            log.push(`[bomForPermit] roof racking: ${roofMountCount} mounts, ${roofRackingBOM?.rails.qty ?? 0} rails, ${roofRackingBOM?.mountingBolts.qty ?? 0} rail bolts`);
          } else if (r.key === 'fence') {
            fenceStructural = _sr;
            log.push(`[bomForPermit] fence structural: ${_sr.fenceMountAnalysis ? 'analyzed' : 'no analysis'} (${r.input.panelCount} panels)`);
          } else if (r.key === 'ground') {
            groundStructural = _sr;
            log.push(`[bomForPermit] ground structural: ${_sr.groundMountAnalysis ? 'analyzed' : 'no analysis'} (${r.input.panelCount} panels)`);
          }
        } catch (e) {
          log.push(`[bomForPermit] '${r.key}' structural run failed: ${(e as Error).message}`);
        }
      }
    } catch (e) {
      log.push(`[bomForPermit] structural runs failed (using registry fallback): ${(e as Error).message}`);
    }
  }

  // ── 4. V4 BOM (electrical) ───────────────────────────────
  let v4Items: PermitBOMItem[] = [];

  if (_v4InverterId) {
    try {
      const v4Input: BOMGenerationInputV4 = {
        inverterId: _v4InverterId,
        panelId,
        // Same id the STRUCTURAL path resolves (mountingSystemId) when the BOM-
        // specific rackingId is unset — otherwise Stage 5 lost its registry entry
        // and the planset BOM shipped with no racking hardware at all.
        rackingId:           project.rackingId || project.mountingSystemId,
        batteryId:           project.batteryId,
        moduleCount:         totalPanels,
        deviceCount,
        // §13 — canonical AC-branch count from the plane-aware branch plan the
        // snapshot carries (electrical.branches), so micro terminator/cap qty
        // tracks the REAL branch count (3 → 3), never the resolver's branches+1
        // heuristic. Falls back to the shared conductor authority's branch plan.
        branchCount:         isMicro
          ? ((peekSnapshot(input)?.electrical.branches.length) || _auth.microBranches.length || undefined)
          : undefined,
        stringCount,
        inverterCount,
        // W4a — the DESIGN topology is authority. Passing it prevents the V4
        // resolver from silently falling to STRING_INVERTER on an inverter-id
        // round-trip miss and emitting phantom USE-2 DC roof-wiring rows on a
        // pure-micro job (no DC string segment physically exists).
        topologyType:        isMicro ? 'MICROINVERTER' : undefined,
        systemKw:            totalDcKw,
        acOutputKw:          totalAcKw > 0 ? totalAcKw : undefined,
        dcWireGauge,
        acWireGauge,
        dcWireLength,
        acWireLength,
        conduitType,
        conduitSizeInch:     conduitSize,
        roofType:            project.roofType || 'shingle',
        // W3 §10 — quantities derive from the CANONICAL structural objects
        // (mount count = attachment objects; rail sections = rail-object stock
        // segmentation), the SAME V4 run the snapshot's rail/attachment objects
        // project. The old `Math.ceil(totalPanels*1.2)` / `/2` renderer guesses
        // are RETIRED: absent a structural run we fall back to the operator's
        // own value or an honest 0 (rackingBOM drives the real rows regardless)
        // — never a fabricated quantity.
        attachmentCount:     roofMountCount || project.attachmentCount || 0,
        railSections:        roofRackingBOM?.rails.qty || project.railSections || 0,
        rowCount:            roofRowCount || undefined,
        rackingBOM:          roofRackingBOM,
        // Real design layout (arrayLayout selector): orientation drives the
        // trunk-cable SKU (portrait vs landscape spacing — was silently portrait
        // always), sub-array count forces trunk bridge splices, spliceAtRows is
        // the installer's cut-at-rows preference.
        layoutOrientation:   _arrayLayout.orientation,
        subArrayCount:       _arrayLayout.subArrayCount,
        // Hybrid (P2): per-sub-system module counts — NEC 690.12 RSD follows
        // the ROOF subset regardless of the project's winning systemType.
        subSystemCounts:     cad.hybrid ? {
          roof:   cad.hybrid.sections.find(sec => sec.key === 'roof')?.totalPanels ?? 0,
          ground: cad.hybrid.sections.find(sec => sec.key === 'ground')?.totalPanels ?? 0,
          fence:  cad.hybrid.sections.find(sec => sec.key === 'fence')?.totalPanels ?? 0,
        } : undefined,
        // Wave 2c per-sub map — flips generateBOMV4 to its hybrid path (Stages
        // 1–3 per sub, one Stage-4 service set). Absent for single-system jobs.
        subSystemEquipment:  _perSubEquipment,
        spliceAtRows:        project.spliceAtRows,
        // Permit SCHED lists INSTALLED materials only — truck-stock extras are
        // an engineering/crew view, not a permit submittal line.
        includeTruckStock:   false,
        includeSuggestedTools: false,
        // Sized per-segment runs from the wire-sizing engine (computeSystem)
        // fed with REAL deriveRunLengths(cad) geometry — switches generateBOMV4
        // to its per-segment wire/conduit path (qty = Σ length × conductors ×
        // 1.15 per gauge) instead of one flat length × generic conductor count.
        // null → previous flat path (never blocks a permit).
        runs:                buildComputedRunsForPermit(input, cad) ?? undefined,
        mainPanelAmps:       mainPanelA,
        backfeedAmps,
        acOCPD:              backfeedAmps,
        // Stage D — system AC disconnect / supply-side tap OCPD single-sourced
        // to the conductor authority's POI block (Σ per-sub backfeed OCPDs →
        // next std rating — the same table E-1's resolveHybridAcCollection
        // uses, so BOM fuse/enclosure ≡ E-1's system disconnect). The engine
        // also sizes the supply-side FUSE from this (110A-fuse-in-200A-disco
        // regression, 2026-07-18). _acCollection kept as fallback.
        // Hybrid-only (Stage D contract): single-system jobs keep the legacy
        // kW basis — their totalAcKw is consistent, and pushing the POI value
        // through nextStdRating would bump a 110A single-system fuse to 125A.
        systemAcDisconnectA: (_auth.isHybrid && _auth.poi.tapOcpdA > 0 ? _auth.poi.tapOcpdA : undefined)
          ?? _acCollection?.disconnectA,
        // P1-3 (data-authority register): DC OCPD from the shared authority's
        // per-sub dcStrings (governing = max standard fuse across ALL subs) —
        // never firstStr alone (on a hybrid firstStr is the FENCE panel, and
        // its Isc mis-sized the ground sub's DC fuse). Fallback keeps the
        // canonical Isc×1.56 ladder derivation for payloads with no
        // authority strings (micro topologies never consume dcOCPD).
        dcOCPD:              (() => {
          const _dcOcpds = _auth.dcStrings.map(s => s.ocpdAmps ?? 0).filter(n => n > 0);
          return _dcOcpds.length
            ? Math.max(..._dcOcpds)
            : necNextStandardOcpd((firstStr?.panelIsc || 10) * 1.56);
        })(),
        jurisdiction:        compliance.jurisdiction?.ahj,
        requiresACDisconnect:    project.acDisconnect !== false,
        requiresDCDisconnect:    true,
        requiresRapidShutdown:   true,
        requiresWarningLabels:   true,
        requiresProductionMeter: false,
        interconnectionMethod:   project.interconnectionMethod || 'LOAD_SIDE',
        panelBusRating:          project.panelBusRating || mainPanelA,
        systemType:              bomSystemType,
        generatorKw:             project.generatorKw,
        batteryCount:            project.batteryCount,
      };

      const v4Result = generateBOMV4(v4Input);
      v4Items = v4Result.items.map(v4ToPermit);
      log.push(`[bomForPermit] V4: ${v4Items.length} items from ${v4Result.stages.length} stages`);
    } catch (err: unknown) {
      log.push(`[bomForPermit] V4 failed: ${(err as Error).message} — using fallback BOM`);
      v4Items = buildFallbackBOM(input, cad);
    }
  } else {
    log.push('[bomForPermit] No inverterId resolved — using fallback BOM');
    v4Items = buildFallbackBOM(input, cad);
  }

  // ── 5. Merge: V4 electrical + structural ─────────────────
  // V4-owned categories: structural items in these categories are
  // already present in V4 result — skip structural duplicates.
  const V4_OWNED_CATEGORIES = new Set([
    'solar_panel', 'microinverter', 'optimizer', 'string_inverter',
    'hybrid_inverter', 'inverter', 'battery',
    'generator', 'ats', 'backup_interface',
    'wire', 'trunk_cable', 'terminator', 'conduit',
    'disconnect', 'breaker', 'rapid_shutdown', 'combiner', 'junction_box',
    'meter', 'gateway', 'monitoring', 'label', 'racking',
  ]);

  const mergedStructural = structItems.filter(
    item => !V4_OWNED_CATEGORIES.has(item.category),
  );
  log.push(`[bomForPermit] structural after dedup: ${mergedStructural.length} items`);

  let merged = [...v4Items, ...mergedStructural];

  // ── 5b. Reconcile the integrated combiner/gateway ("the brains") ──
  // The resolver is the single source of truth for this device (same one PV-6 /
  // SCHED / E-1 print). Drop any registry-derived combiner/gateway line (which
  // could be a stale 4C, or MISSING entirely for IQ8H/IQ8A/IQ8AC) and emit the
  // resolved device, so the BOM can never disagree with the sheets.
  // The per-sub hybrid path (generateBOMV4PerSubSystem) already emits the
  // integrated combiner/gateway PER BRAND GROUP with each group's REAL branch
  // count — running the whole-system reconciler on top would double-emit a
  // 91-device combiner. Skip it when the per-sub path handled the BOM.
  const bosPlan = buildIntegratedEquipment(input, cad);
  if (!_isPerSubHybrid && bosPlan.devices.length) {
    merged = merged.filter(it => it.category !== 'combiner' && it.category !== 'gateway');
    for (const d of bosPlan.devices) {
      const isGw = d.kind === 'gateway';
      merged.push({
        stageId: isGw ? 'monitoring' : 'inverter',
        stageLabel: STAGE_LABELS[isGw ? 'monitoring' : 'inverter'],
        category: isGw ? 'gateway' : 'combiner',
        manufacturer: d.brand,
        model: d.model,
        partNumber: d.partNumber || '—',
        quantity: d.quantity,
        unit: 'ea',
        description: `Integrated ${d.roleSummary}${d.branchSlots ? ` — ${d.branchSlots} branch positions` : ''}`,
        necReference: (d.necRefs && d.necRefs[0]) || 'NEC 690.4',
        derivedFrom: 'integrated-bos resolver',
        required: true,
      });
    }
  }

  // ── 5c. Shared AC combiner panel (hybrid) — Stage D ──────
  // E-1 (renderSLDMultiLane) draws every PV source landing on ONE shared AC
  // combiner panel busbar → ONE system disconnect. The BOM/SCHED were blind to
  // that panel (they listed only the per-brand IQ Combiners + the aggregate
  // disconnect). Emit it from the SAME resolver the diagram uses so the sheets
  // list exactly what the SLD shows. Reuses _acCollection (hoisted above).
  const _sharedPanel = _acCollection?.sharedPanel;
  if (_sharedPanel) {
    merged.push({
      stageId: 'ac',
      stageLabel: STAGE_LABELS['ac'],
      category: 'combiner',
      manufacturer: _sharedPanel.brand,
      model: _sharedPanel.model,
      partNumber: _sharedPanel.partNumber || '—',
      quantity: 1,
      unit: 'ea',
      description:
        `Shared AC combiner panel — ${_sharedPanel.busbarA}A busbar / ${_sharedPanel.mainOcpdA}A main OCPD. ` +
        `All ${_acCollection!.perSource.length} PV sources land here on backfed OCPDs → one ` +
        `${_acCollection!.disconnectA}A system AC disconnect (NEC 705.12(B)).`,
      necReference: _sharedPanel.necRefs?.[0] ?? 'NEC 705.12(B)',
      derivedFrom: 'hybrid AC collection (E-1 single source)',
      required: true,
    });
    log.push(`[bomForPermit] shared AC combiner panel: ${_sharedPanel.model} (${_sharedPanel.busbarA}A busbar, ${_acCollection!.perSource.length} sources)`);
  }

  // ── 5d. Open-air branch EGC — OUTCOME-DRIVEN (corrected 2026-07-25) ───────
  // The row is decided by the DOCUMENT-BASED grounding authority, never by the
  // cable's conductor count:
  //   A NO_SEPARATE_EGC_REQUIRED       ⇒ NO ROW at all (nothing is ordered for this
  //                                      section; module/racking bonding hardware is
  //                                      emitted elsewhere and is untouched)
  //   B SEPARATE_EGC_REQUIRED          ⇒ ORDERABLE row, NEC 250.122 size, length from
  //                                      the branch cable-path geometry, with the
  //                                      manufacturer document cited
  //   C PENDING_MANUFACTURER_AUTHORITY ⇒ the calculated quantity is RETAINED as a
  //                                      PROPOSED / DESIGN QUANTITY, marked
  //                                      NON-ORDERABLE and EXCLUDED from the
  //                                      authoritative procurement totals (the same
  //                                      pattern as the unverified fastener row)
  const _oaGnd = projectOpenAirBranchGrounding(peekSnapshot(input));
  if (_oaGnd.present && _oaGnd.bomRowState !== 'no-row' && _oaGnd.bomFootageFt != null) {
    const _gnGauge = (_oaGnd.conductorSize ?? '#12 AWG');
    const _gn = _gnGauge.replace('#', '').replace(' AWG', '').trim();
    const _pending = _oaGnd.bomRowState === 'design-quantity-non-orderable';
    const _ga = _oaGnd.authority;
    merged.push({
      stageId: 'ac',
      stageLabel: STAGE_LABELS['ac'],
      category: 'wire',
      manufacturer: _pending ? '—' : 'Southwire',
      model: _pending
        ? `${_gnGauge} ${_oaGnd.conductorMaterial ?? 'Cu'} Green EGC — open-air branch — ${GROUNDING_NON_ORDERABLE_LABEL}`
        : `${_gnGauge} ${_oaGnd.conductorMaterial ?? 'Cu'} Green EGC — open-air branch (listed cable assembly section)`,
      partNumber: `GRN-OPENAIR-${_gn}`,
      quantity: _oaGnd.bomFootageFt,
      unit: 'ft',
      nonOrderable: _pending ? true : undefined,
      description: _pending
        ? `PROPOSED / DESIGN QUANTITY ONLY — NOT ORDERABLE, EXCLUDED from procurement totals. The grounding method for `
          + `the open-air branch section of the selected ${_ga?.selectedMicroinverterSku ?? 'micro'} + `
          + `${_ga?.selectedCableAssemblySku ?? 'cable'} is NOT ESTABLISHED (${GROUNDING_AUTHORITY_BLOCKER_CODE}, RS-1); the `
          + `${_ga?.cableConductorCount ?? '—'}-conductor construction is NOT determinative. Qty retained: designed-installed `
          + `${_oaGnd.designedInstalledFt ?? '—'} ft (Σ BranchCablePath, ${_oaGnd.branchIds.join(', ') || 'branches'}) × ${_oaGnd.wasteFactor} waste. `
          + `Module/racking bonding is a distinct, unaffected requirement.`
        : `Open-air branch equipment grounding conductor (${_oaGnd.branchIds.join(', ') || 'branches'}) — required by ${_oaGnd.sourceAuthority}. `
          + `procurement ${_oaGnd.bomFootageFt} ft = designed-installed ${_oaGnd.designedInstalledFt ?? '—'} ft (Σ BranchCablePath geometry) × ${_oaGnd.wasteFactor} waste; `
          + `runs open-air with the branch trunk (${_oaGnd.equipmentCompatibility}).`,
      necReference: _pending ? 'NEC 110.3(B) — PENDING' : 'NEC 250.122 / 690.43(C)',
      derivedFrom: `open-air grounding authority (outcome=${_oaGnd.outcome})`,
      formula: _pending
        ? `Σ designed-installed ${_oaGnd.designedInstalledFt ?? '—'} ft × ${_oaGnd.wasteFactor} (PROPOSED / DESIGN QUANTITY)`
        : `Σ designed-installed ${_oaGnd.designedInstalledFt ?? '—'} ft × ${_oaGnd.wasteFactor}`,
      required: true,
    });
    log.push(`[bomForPermit] open-air branch EGC row: ${_gnGauge} ${_oaGnd.bomFootageFt} ft — outcome=${_oaGnd.outcome} state=${_oaGnd.bomRowState}`);
  } else if (_oaGnd.present && _oaGnd.bomRowState === 'no-row') {
    log.push(`[bomForPermit] open-air branch EGC row OMITTED — outcome=${_oaGnd.outcome} (listed method requires no additional conductor in this section; module/racking bonding hardware retained)`);
  }

  // ── 5e. §6 (BAR) — unverified fasteners are NON-ORDERABLE ────────────────
  // While FastenerAssembly is not verified, the roof-attachment fastener row is a
  // DESIGN QUANTITY only: the calculated quantity is RETAINED (so the exact
  // orderable row auto-regenerates the moment the assembly verifies) but the
  // manufacturer / SKU / diameter / length / coating / capacity are WITHHELD and
  // the row is excluded from the authoritative procurement totals. Single source =
  // the same FastenerAssembly projection SCHED-3 / PV-3 / APP-A / CERT read.
  const _faBom = projectFastenerAssembly(input);
  if (_faBom.nonOrderable) {
    for (const it of merged) {
      if (it.category !== 'lag_bolt') continue;
      const _qtyPerMount = _faBom.qtyPerMount;
      const _mounts = _qtyPerMount ? Math.round(it.quantity / _qtyPerMount) : null;
      it.nonOrderable = true;
      it.manufacturer = '—';
      it.model = `Roof attachment fastener — ${FASTENER_NON_ORDERABLE_LABEL}`;
      it.partNumber = 'PENDING-FASTENER-VERIFICATION';
      it.description =
        `DESIGN QUANTITY ONLY — NOT ORDERABLE and EXCLUDED from procurement totals until the fastener `
        + `assembly is verified (FASTENER-ASSEMBLY-UNVERIFIED — see RS-1). Manufacturer, SKU, diameter, `
        + `length, coating and capacity are WITHHELD until an archived, project-applicable fastener/capacity `
        + `document is verified; the calculated quantity is retained so the exact orderable row regenerates on verification.`;
      it.derivedFrom = `fastener assembly authority (verification=${_faBom.verification}) — design quantity, non-orderable`;
      it.formula = _qtyPerMount != null && _mounts != null
        ? `${_qtyPerMount} per mount × ${_mounts} mounts = ${it.quantity} (DESIGN QUANTITY)`
        : `${it.quantity} (DESIGN QUANTITY)`;
      log.push(`[bomForPermit] §6 fastener row NON-ORDERABLE: design qty ${it.quantity} ${it.unit} withheld from procurement (verification=${_faBom.verification})`);
    }
  }

  // ── 5f. PPC §9 — the Q-CABLE TRUNK ROW ITSELF carries its procurement state ──
  // The PV-4B / SCHED continuation prose was already correct, but the BOM row read
  // `Enphase | IQ Q-Cable (portrait) | Q-12-10-240 | 31 | ea` with NO row-level
  // state: an operator reading the schedule alone could order the insufficient
  // quantity. bom-engine-v4 cannot fix this — it is a PRE-snapshot engine with no
  // access to procurementSufficiency — so the seam is this post-pass, exactly
  // mirroring 5e. Ray's requirement: keep the SELECTED CABLE IDENTITY visible
  // (never withhold the SKU — the cable is correctly selected; the QUANTITY is
  // insufficient) while the row states STATUS / REASON / DESIGNED-INSTALLED /
  // CURRENT BASE / DEFICIT / EXTENSION SOLUTION NOT SELECTED.
  const _psBom = peekSnapshot(input)?.electrical?.procurementSufficiency ?? null;
  if (_psBom?.insufficient) {
    const _selKind = (_psBom.resolutionOptions ?? []).find(o => o.selected)?.kind ?? null;
    const _extTxt = _selKind
      ? `EXTENSION SOLUTION: ${_selKind}`
      : 'EXTENSION SOLUTION NOT SELECTED';
    for (const it of merged) {
      if (it.category !== 'trunk_cable') continue;
      it.nonOrderable = true;
      // ONE wording for both the machine reason and the rendered cell. The ALLOWANCE
      // term is stated explicitly: the deficit is measured against the THRESHOLD
      // (designed-installed + any documented service-loop allowance), so a row that
      // printed only designed-vs-base read as arithmetically WRONG the moment an
      // allowance existed — "140.5 FT vs 152 FT ⇒ DEFICIT 14.5 FT". Every term shows.
      const _allowTxt = `ALLOWANCE ${_psBom.requiredServiceLoopAllowanceFt ?? 0} FT`
        + ` (${_psBom.allowanceProvenance ?? 'no-allowance-authority-recorded'})`;
      const _stateTxt =
        `STATUS: NON-ORDERABLE · REASON: QCABLE-PROCUREMENT-INSUFFICIENT · `
        + `DESIGNED-INSTALLED ${_psBom.totalDesignedInstalledFt ?? '—'} FT · ${_allowTxt} · `
        + `THRESHOLD ${_psBom.thresholdFt ?? '—'} FT · `
        + `CURRENT BASE ${_psBom.procurementLengthFt ?? '—'} FT · `
        + `DEFICIT ${_psBom.deficitFt} FT · ${_extTxt}`;
      it.nonOrderableReason = _stateTxt;
      // The CELL states the row's own procurement state and its bases, then points
      // at RS-1. It deliberately does NOT restate the resolution requirement, the
      // "jumpers required does not clear this" caveat or the affected-branch list —
      // those are on RS-1's DEFICIT PAYLOAD and PV-4B verbatim, and repeating them
      // here made the row wrap far enough to clip the continuation sheet (gate 17).
      it.description =
        `${_stateTxt}. DESIGNED-INSTALLED = Σ BranchCablePath geometry; CURRENT BASE = `
        + `Σ drops × ${_psBom.connectorSpacingFt ?? '—'} ft pitch × waste. `
        + `Base quantity is NOT an orderable total; EXCLUDED from the authoritative `
        + `procurement total. Selected cable identity unchanged — resolution + affected `
        + `branches on RS-1. ${it.description ?? ''}`;
      it.derivedFrom = `procurement sufficiency authority (verification=${_psBom.verificationStatus}) — base cable quantity, non-orderable`;
      log.push(`[bomForPermit] §9 trunk_cable row NON-ORDERABLE: base ${_psBom.procurementLengthFt} ft short of ${_psBom.totalDesignedInstalledFt} ft by ${_psBom.deficitFt} ft (${_extTxt})`);
    }
  }

  // ── 6. Sort by stageId ordinal ───────────────────────────
  const STAGE_ORDER: Record<string, number> = {
    array: 1, dc: 2, inverter: 3, ac: 4, structural: 5, monitoring: 6, labels: 7,
  };
  merged.sort((a, b) => {
    const sa = STAGE_ORDER[a.stageId ?? ''] ?? 99;
    const sb = STAGE_ORDER[b.stageId ?? ''] ?? 99;
    if (sa !== sb) return sa - sb;
    return (a.category || '').localeCompare(b.category || '');
  });

  if (process.env.NODE_ENV !== 'production') {
    console.log('[bomForPermit] log:', log.join('\n'));
    console.log(`[bomForPermit] total items: ${merged.length}`);
  }

  return merged;
}

// ── BOM summary stats ─────────────────────────────────────────
export interface BOMSummary {
  totalLineItems:    number;
  byStage:           Record<string, number>;
  requiredCount:     number;
  hasStructural:     boolean;
  hasElectrical:     boolean;
}

export function summarizeBOM(items: PermitBOMItem[]): BOMSummary {
  const byStage: Record<string, number> = {};
  let requiredCount = 0;
  let hasStructural = false;
  let hasElectrical = false;

  for (const item of items) {
    const stage = item.stageId ?? 'unknown';
    byStage[stage] = (byStage[stage] ?? 0) + 1;
    if (item.required) requiredCount++;
    if (stage === 'structural') hasStructural = true;
    if (['array', 'dc', 'inverter', 'ac'].includes(stage)) hasElectrical = true;
  }

  return {
    totalLineItems: items.length,
    byStage,
    requiredCount,
    hasStructural,
    hasElectrical,
  };
}
// ═══════════════════════════════════════════════════════════════════════════
// PPC §5/§9 — THE AUTHORITATIVE PROCUREMENT TOTAL / ORDERABLE EXPORT SUBSET
//
// This object did not exist. The package asserted "EXCLUDED from the authoritative
// procurement totals" in PROSE only: SCHED emitted `TOTAL LINE ITEMS = flat.length`
// (which COUNTS the pending rows) plus a sentence that enumerated only the two rows
// tagged by the hand-written post-passes — thereby actively telling the reader that
// the seven pending racking rows WERE included. There was no orderable subset and
// no procurement-export path filtering on orderability anywhere in lib/.
//
// So §5's "authoritative procurement total excludes every pending row" and §9's
// "procurement-export gate" required BUILDING this, not correcting a total.
//
//   EXCLUSION RULE (fail-closed, both axes):
//     • nonOrderable === true              ⇒ excluded (design/candidate quantity)
//     • quantityState === 'pending'        ⇒ excluded (quantity not established)
//   A row is orderable ONLY when neither holds. Anything unknown stays orderable
//   only because it carries NO pending/non-orderable authority state at all — the
//   flags are set BY the authorities, so an unflagged row is a verified row.
//
// `orderableProcurementExport()` is the ONE export gate: a blocked row can never
// enter an orderable export, because the export is DERIVED from this subset.
// ═══════════════════════════════════════════════════════════════════════════

/** Why a row is excluded from procurement approval. */
export type ProcurementExclusionClass =
  /** DESIGN / CANDIDATE quantity — authority unverified (racking assembly,
   *  fastener assembly, open-air grounding, insufficient Q-Cable). */
  | 'non-orderable-design-quantity'
  /** the quantity itself is not established (sealing caps: field quantity). */
  | 'quantity-pending';

export interface ProcurementExclusion {
  category: string;
  model: string;
  partNumber: string;
  quantity: number;
  unit: string;
  exclusionClass: ProcurementExclusionClass;
  reason: string;
}

export interface ProcurementApproval {
  /** every BOM line, orderable or not (the SCHED "TOTAL LINE ITEMS" count). */
  totalLineItems: number;
  /** the AUTHORITATIVE procurement total: the count of orderable lines ONLY. */
  orderableLineItems: number;
  excludedLineItems: number;
  /** Σ quantity of the orderable subset, per unit — never mixes ft with ea. */
  orderableQuantityByUnit: Record<string, number>;
  /** THE only export-eligible rows. */
  orderableRows: PermitBOMItem[];
  /** every excluded row, with its class + reason (rendered, never implied). */
  exclusions: ProcurementExclusion[];
  excludedCountByClass: Record<ProcurementExclusionClass, number>;
  /** true ⇒ at least one row is excluded, so the total is a SUBSET and the
   *  procurement package cannot be approved as-is. */
  partial: boolean;
  /** the sentence the schedule renders — states the total AND what is excluded. */
  statement: string;
}

/** Is this row eligible for the authoritative procurement total / an export? */
export function isOrderableForProcurement(item: PermitBOMItem): boolean {
  return item.nonOrderable !== true && item.quantityState !== 'pending';
}

/** Build THE authoritative procurement approval object (pure). */
export function buildProcurementApproval(items: PermitBOMItem[]): ProcurementApproval {
  const orderableRows: PermitBOMItem[] = [];
  const exclusions: ProcurementExclusion[] = [];
  const excludedCountByClass: Record<ProcurementExclusionClass, number> = {
    'non-orderable-design-quantity': 0,
    'quantity-pending': 0,
  };
  const orderableQuantityByUnit: Record<string, number> = {};

  for (const it of items) {
    if (isOrderableForProcurement(it)) {
      orderableRows.push(it);
      const u = it.unit || 'ea';
      orderableQuantityByUnit[u] = (orderableQuantityByUnit[u] ?? 0) + (Number.isFinite(it.quantity) ? it.quantity : 0);
      continue;
    }
    const cls: ProcurementExclusionClass = it.nonOrderable === true
      ? 'non-orderable-design-quantity'
      : 'quantity-pending';
    excludedCountByClass[cls]++;
    exclusions.push({
      category: it.category,
      model: it.model,
      partNumber: it.partNumber,
      quantity: it.quantity,
      unit: it.unit,
      exclusionClass: cls,
      reason: it.nonOrderableReason
        ?? (cls === 'quantity-pending'
          ? (it.quantityStateLabel ?? 'QUANTITY PENDING — the modeled count is not the established field quantity')
          : 'DESIGN QUANTITY ONLY — pending verified authority (see RS-1)'),
    });
  }

  const partial = exclusions.length > 0;
  const statement = partial
    ? `AUTHORITATIVE PROCUREMENT TOTAL: ${orderableRows.length} of ${items.length} line items are ORDERABLE. `
      + `${exclusions.length} line item${exclusions.length === 1 ? ' is' : 's are'} EXCLUDED from this total and from every `
      + `procurement export — ${excludedCountByClass['non-orderable-design-quantity']} DESIGN/CANDIDATE quantit`
      + `${excludedCountByClass['non-orderable-design-quantity'] === 1 ? 'y' : 'ies'} (authority unverified) and `
      + `${excludedCountByClass['quantity-pending']} with a QUANTITY NOT ESTABLISHED. `
      + `Excluded: ${exclusions.map(e => `${e.category.replace(/_/g, ' ')} (${e.exclusionClass})`).join('; ')}. `
      + `This package is NOT an approved procurement release.`
    : `AUTHORITATIVE PROCUREMENT TOTAL: all ${items.length} line items are ORDERABLE — no row carries a design-only `
      + `quantity or an unestablished quantity.`;

  return {
    totalLineItems: items.length,
    orderableLineItems: orderableRows.length,
    excludedLineItems: exclusions.length,
    orderableQuantityByUnit,
    orderableRows,
    exclusions,
    excludedCountByClass,
    partial,
    statement,
  };
}

/**
 * THE procurement-export gate (gate 13). Any orderable export — purchase order,
 * CSV, distributor cart — MUST be derived from this function. A blocked row cannot
 * enter it: the subset is computed from the same fail-closed predicate the rendered
 * authoritative total uses, so the export and the sheet can never disagree.
 */
export function orderableProcurementExport(items: PermitBOMItem[]): PermitBOMItem[] {
  return buildProcurementApproval(items).orderableRows;
}
