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
  PROCUREMENT_AUTHORITY_STATES,
  PROCUREMENT_AUTHORITY_STATE_LABEL,
  type BomQuantitySource,
  type ProcurementAuthorityRecord,
  type ProcurementAuthorityState,
  type ProcurementVerificationStatus,
} from '@/lib/bom-types-v4';
import { stampBomLineIds, auditBomLineIds, isPartNumberPlaceholder, type BomLineIdAudit } from '@/lib/bom/bomLineId';
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
// ECD W1-B/W1-E/W1-F — the classifier's authority inputs.
import type { PermitDesignSnapshot, SupplySideTapConnectionAuthority, CableExtensionSolution } from '../snapshot/types';
import { severityImpactForCode } from '../snapshot/releaseGates';
import { supplySideTapReason } from '../snapshot/supplySideTap';
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

  // ══════════════════════════════════════════════════════════════════════════
  // ECD §1/§2 (W1-A/W1-B) — STABLE IDENTITY + THE ONE PROCUREMENT STATE.
  //
  // `bomLineId` is the content-derived row identity (lib/bom/bomLineId.ts) that
  // makes the §1 row-ID multiset gate (rendered == evidence == export)
  // implementable at all. `procurement` is the ONE authority record; every
  // count, label, export decision and evidence entry reads it.
  //
  // `nonOrderable` / `quantityState` above are now PROJECTIONS of
  // `procurement.authorityState`, written by the classifier so that every
  // existing reader keeps working unchanged. They are no longer independent
  // inputs — producers declare FACTS (below) and the classifier decides.
  // ══════════════════════════════════════════════════════════════════════════
  bomLineId?: string;
  /** THE per-row procurement authority. Attached by the single classifier at
   *  the end of generateBOMForPermit. Absent ⇒ the row has not been classified;
   *  every consumer treats that FAIL-CLOSED (not orderable, not exportable). */
  procurement?: ProcurementAuthorityRecord;
  // ── producer-declared facts the classifier consumes (see bom-types-v4) ────
  quantitySource?: BomQuantitySource;
  affectedRouteIds?: string[];
  affectedEquipmentIds?: string[];
  authorityStateHint?: ProcurementAuthorityState;
  authorityStateHintReason?: string;

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

  // ── CMEI SCOPE BOUNDARY ────────────────────────────────────────────────
  // The two tiers below are SUBSTRING matches. For MODULES they are gone: the
  // module call site resolves through `resolveModuleIdentity` and never reaches
  // this function (see `panelEntry` below).
  //
  // They REMAIN for inverters and accessories, deliberately and temporarily.
  // Those are their own identity domains (`inverterId`, accessory SKUs) with no
  // canonical accessor yet, and removing the tiers blind broke 37 tests across
  // procurement, grounding and sheet pagination — i.e. it silently changed which
  // hardware is ordered. That is a separate phase, not a side effect of this one.
  //
  // ⚠ NAMED FOLLOW-UP: give inverters and accessories the same treatment modules
  //    just received. Until then this function must not be used for modules.
  if (mfr) {
    const byBoth = EQUIPMENT_REGISTRY_V4.find(
      e =>
        e.manufacturer.toLowerCase().includes(mfr) &&
        (e.model.toLowerCase().includes(m) || m.includes(e.model.toLowerCase())),
    );
    if (byBoth) return byBoth;
  }
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
    // ECD W1-B/W1-D — the PRODUCER-declared procurement facts cross the last
    // type boundary too. Dropping them here is exactly the class of loss the
    // audit found for procurementClass (declared on the snapshot row, never
    // present on any rendered row).
    quantitySource:           item.quantitySource,
    affectedRouteIds:         item.affectedRouteIds,
    affectedEquipmentIds:     item.affectedEquipmentIds,
    authorityStateHint:       item.authorityStateHint,
    authorityStateHintReason: item.authorityStateHintReason,
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

// CMEI — module identity comes from THE canonical accessor.
import { resolveModuleIdentity, resolveStringModuleIdentity } from '@/lib/equipment/moduleIdentity';
import { getRegistryEntryV4 } from '@/lib/equipment-registry-v4';

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

/** CMEI — a MODULE is identified by THE canonical accessor. This swept
 *  SOLAR_PANELS with a two-way substring match on both manufacturer AND model,
 *  which is how a per-subsystem BOM row could name a product nobody selected. */
function resolvePanelIdFromNames(mfr: string, model: string): string | undefined {
  if (_norm(model) === '' || _norm(model) === '—') return undefined;
  return resolveModuleIdentity({ model, manufacturer: mfr }).panelId ?? undefined;
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
  // ── CMEI — THE MODULE IS IDENTIFIED, NOT MATCHED ────────────────────────
  // This decides which PANEL IS ORDERED. It used to run the substring tiers
  // above, so any registry entry whose model merely contained — or was
  // contained by — the posted text became the purchased hardware.
  // `resolveStringModuleIdentity` returns the stable catalogue id or nothing.
  const _panelIdentity = resolveStringModuleIdentity(firstStr);
  const panelEntry = _panelIdentity.panelId
    ? (getRegistryEntryV4(_panelIdentity.panelId) ?? { id: _panelIdentity.panelId } as EquipmentRegistryEntry)
    : undefined;

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
  // WS-2 — the canonical procurement design. When it is VERIFIED the measured
  // shortfall HAS an answer (per-branch allocation + a package to buy), so the
  // trunk row is no longer non-orderable and 5f.3 below states the resolution
  // instead. A footage was never an order quantity; a package is.
  const _qpBom = peekSnapshot(input)?.electrical?.qcableProcurement ?? null;
  const _qpResolvedBom = _qpBom?.present === true && _qpBom.compatibilityStatus === 'VERIFIED';
  if (_psBom?.insufficient && !_qpResolvedBom) {
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

  // ── 5f.3 WS-2 — THE BOM CONSUMES THE CANONICAL PROCUREMENT RESOLUTION ───────
  // Every quantity below comes from `electrical.qcableProcurement`, which derived
  // it from an ACTUAL branch modification and an archived per-unit rule. The BOM
  // does not recompute a purchase, and it never prints an installed footage as an
  // order quantity.
  if (_qpResolvedBom && _qpBom) {
    const _ev = _qpBom.evidenceIds[0] ?? 'the archived manufacturer manual';
    // (a) the trunk row states the RESOLVED order, in the manufacturer's package.
    for (const it of merged) {
      if (it.category !== 'trunk_cable') continue;
      it.nonOrderable = false;
      it.nonOrderableReason = undefined;
      // BRAIDON PDF AUDIT 2026-08-27 (N6) — this block rewrote the DESCRIPTION to state the
      // resolved order ("ORDER 1 × Q-12-10-240 — box of 240 connector sections") but left
      // it.quantity at the pre-resolution drop count (31). The rendered BOM row therefore read
      // `Q-12-10-240 | 31 | ea` beside a description saying to order ONE box, and a procurement
      // export reading the QTY column would order 31 boxes — 31,620 ft of trunk cable for a
      // 166.5 ft installation. The row is orderable now, so the quantity cell must state the
      // orderable package count, in packages. Guard the assignment: if the resolution somehow
      // carries no stock-unit count, leave the old quantity rather than writing undefined.
      if (_qpBom.stockUnitsRequired != null) {
        it.quantity = _qpBom.stockUnitsRequired;
        it.unit = _qpBom.stockUnitsRequired === 1 ? 'package' : 'packages';
        it.quantitySource = it.quantitySource ?? undefined;
        log.push(`[bomForPermit] N6 trunk_cable QTY corrected to ${_qpBom.stockUnitsRequired} ${it.unit} `
          + `(was ${_qpBom.baseSectionsOrdered ?? '?'} drop-count sections rendered as 'ea')`);
      }
      it.description =
        `ORDER ${_qpBom.stockUnitsRequired ?? '—'} × ${_qpBom.stockUnitDescription ?? _qpBom.selectedStockSku ?? '—'} `
        + `covering ${_qpBom.totalSectionsRequired} connector section(s) `
        + `(${_qpBom.baseSectionsOrdered} base + ${_qpBom.additionalSectionsRequired} allocated to the short branches; `
        + `${_qpBom.additionalStockUnitsRequired === 0
          ? 'no additional package beyond the base order'
          : `${_qpBom.additionalStockUnitsRequired} package(s) beyond the base order`}). `
        + `INSTALLED additional requirement ${_qpBom.topologyConstrainedInstalledDeficitFt} ft per-branch `
        + `(${_qpBom.branchAllocations.filter(a => a.shortageFt > 0).map(a => `${a.branchLabel} ${a.shortageFt} ft`).join(' + ') || 'none'}) `
        + `— an INSTALLED length, never an order quantity. Expected remaining stock `
        + `${_qpBom.expectedRemainingStockFt ?? '—'} ft. Method: cut listed cable + IQ Field Wireable Connector `
        + `pair per ${_ev}. ${it.description ?? ''}`;
      it.derivedFrom = `qcableProcurement (${_qpBom.resolutionId}) — resolved procurement design`;
      log.push(`[bomForPermit] WS-2 trunk_cable ORDERABLE: ${_qpBom.stockUnitsRequired} package(s), `
        + `${_qpBom.additionalSectionsRequired} additional section(s), remainder ${_qpBom.expectedRemainingStockFt} ft`);
    }
    // (b) accessories: quantity, orderability and basis from the resolution.
    const _accBySku = new Map<string, { qty: number; purpose: string[]; section: string }>();
    for (const a of _qpBom.accessories) {
      const cur = _accBySku.get(a.sku) ?? { qty: 0, purpose: [], section: a.evidenceSection };
      cur.qty += a.quantity; cur.purpose.push(a.purpose);
      _accBySku.set(a.sku, cur);
    }
    for (const [sku, agg] of _accBySku) {
      const row = merged.find(r => String(r.partNumber ?? '') === sku);
      const _basis = `WS-2 canonical procurement: ${agg.purpose.join('; ')} — per ${_ev} ${agg.section}`;
      if (row) {
        row.quantity = agg.qty;
        row.nonOrderable = false;
        row.nonOrderableReason = undefined;
        row.quantityState = 'established';
        // The v4 engine emitted the field-wireable connectors with a
        // CANDIDATE_NON_ORDERABLE hint ("no verified CableExtensionSolution
        // selects a field-wireable connector solution"). That was true when the
        // ONLY route to the method was an operator-selected extension product;
        // the archived manufacturer manual now states the method for this exact
        // cable and names these exact SKUs, so the hint is stale and is cleared
        // — the row is established by evidence, not by an absent selection.
        row.authorityStateHint = undefined;
        row.authorityStateHintReason = undefined;
        row.quantitySource = 'topology-derived';
        row.derivedFrom = _basis;
        // The prior description carried PENDING-quantity prose ("MODELED / FIELD
        // QUANTITY PENDING"). Prepending the established basis in front of it
        // would leave an ESTABLISHED row claiming its own quantity is pending —
        // the exact certain-zero-beside-a-pending-claim defect PPC gate 11 exists
        // to catch. The stale clause is REMOVED, not buried.
        const _priorDesc = String(row.description ?? '')
          .replace(/\(?\s*(?:MODELED\s*\/\s*)?(?:FIELD\s+)?QUANTITY PENDING[^.]*\.?\s*\)?/gi, '')
          .replace(/\s{2,}/g, ' ').trim();
        row.description = `${_basis}. ${_priorDesc}`.trim();
      } else {
        const proto = merged.find(r => r.category === 'trunk_cable');
        merged.push({
          ...(proto ?? {} as PermitBOMItem),
          category: 'cable_support', manufacturer: 'Enphase',
          model: _qpBom.accessories.find(a => a.sku === sku)?.description ?? sku,
          partNumber: sku, quantity: agg.qty, unit: 'ea',
          nonOrderable: false, nonOrderableReason: undefined,
          quantityState: 'established',
          authorityStateHint: undefined, authorityStateHintReason: undefined,
          quantitySource: 'topology-derived',
          bomLineId: undefined,
          description: _basis, derivedFrom: _basis,
        } as PermitBOMItem);
      }
      log.push(`[bomForPermit] WS-2 accessory ${sku} × ${agg.qty} (established)`);
    }
  }

  // ── 5f.2 AAC WS-5 — PROCUREMENT CONSUMES THE TOPOLOGY OBJECT ────────────────
  // bom-engine-v4 orders the trunk by DROP COUNT (one connector-drop per micro)
  // because it is a pre-snapshot engine with no geometry. The Q-Cable topology
  // object is the ONE derivation of the ordered cable, and the drop count is its
  // LOWER BOUND: orderedSections = max(drops, ceil(required ÷ pitch)). Where the
  // as-routed path needs more sections than one per micro (a row / array
  // transition longer than the molded pitch), the order rises to the topology's
  // section count and the surplus molded connectors become DEAD DROPS, each
  // closed with the manufacturer's listed sealing cap. Both rows are corrected
  // here from the same object, so the schedule, the BOM and the sheets can never
  // state two different quantities again.
  const _topoBom = peekSnapshot(input)?.electrical?.qcableTopology ?? null;
  const _compositionAdopted =
    peekSnapshot(input)?.electrical?.procurementSufficiency?.adoptedOptionId === 'derived-stock-order-composition';
  if (_topoBom?.present && _topoBom.connectorSpacingFt && _compositionAdopted) {
    const _sections = _topoBom.totals.orderedSections;
    const _drops = _topoBom.totals.dropCount;
    if (_sections > _drops) {
      for (const it of merged) {
        if (it.category !== 'trunk_cable') continue;
        it.quantity = _sections;
        it.formula = `${_drops} drop(s) + ${_sections - _drops} transition section(s) = ${_sections} connector section(s) `
          + `(${_topoBom.totals.procurementLengthFt} ft at ${_topoBom.connectorSpacingFt} ft pitch)`;
        it.derivedFrom = 'Q-Cable topology object (as-routed cable path — drops are the lower bound)';
        it.description = `${it.description ?? ''} ORDERED FROM THE CABLE TOPOLOGY: ${_sections} section(s) `
          + `= max(${_drops} drops, as-routed path ÷ ${_topoBom.connectorSpacingFt} ft pitch); `
          + `${_topoBom.totals.rowTransitionCount} row + ${_topoBom.totals.arrayTransitionCount} array transition(s) consume more than one section.`;
        log.push(`[bomForPermit] WS-5 trunk_cable quantity from topology: ${_drops} drops → ${_sections} sections (${_topoBom.totals.procurementLengthFt} ft)`);
      }
    }
    if (_topoBom.deadDropTreatment.established && _topoBom.totals.sealingCapsRequired > 0) {
      for (const it of merged) {
        if (it.category !== 'sealing_cap') continue;
        it.quantity = _topoBom.totals.sealingCapsRequired;
        // ESTABLISHED, not pending: the unused-connector count is now a
        // topology fact (ordered sections − occupied drops), not a field guess.
        it.quantityState = 'established';
        it.quantityStateLabel = undefined;
        it.formula = `${_sections} ordered connector(s) − ${_drops} occupied drop(s) = ${_topoBom.totals.sealingCapsRequired} unused connector(s)`;
        it.derivedFrom = 'Q-Cable topology object (dead drops) + the manufacturer unused-connector rule';
        it.description = `${_topoBom.deadDropTreatment.sku ?? 'Sealing cap'} — one per UNUSED molded connector. `
          + `TOPOLOGY-DERIVED, NOT 1-per-branch: ${_sections} drops ordered (connector sections) − ${_drops} occupied by micros `
          + `= ${_topoBom.totals.sealingCapsRequired} unused connector(s), each capped. Basis: ${_topoBom.deadDropTreatment.basis}`;
        log.push(`[bomForPermit] WS-5 sealing_cap quantity from topology dead drops: ${_topoBom.totals.sealingCapsRequired}`);
      }
    }
  }

  // ── 5g. ECD §5 (W1-F) — the SUPPLY-SIDE TAP CONNECTOR row states its
  // CANDIDATE status from the AUTHORITY, not from prose baked into the engine.
  // bom-engine-v4 is a PRE-snapshot engine, so (exactly as 5e/5f) the seam is
  // this post-pass: it reads electrical.supplySideTapConnection and stamps the
  // ONE mandated label plus the enumerated unresolved facts onto the row. The
  // SKU and quantity stay VISIBLE — the connector is a real candidate product
  // and 3 (L1/L2/N) is a real code-established count; what is NOT established
  // is that this connector fits the existing service conductor.
  const _tapAuth = peekSnapshot(input)?.electrical?.supplySideTapConnection ?? null;
  if (_tapAuth && _tapAuth.verificationStatus !== 'verified') {
    for (const it of merged) {
      if (it.category !== 'connector') continue;
      if (String(it.partNumber).toUpperCase() !== String(_tapAuth.connectorSku ?? '').toUpperCase()) continue;
      it.model = `${it.model} — ${_tapAuth.candidateLabel}`;
      it.nonOrderableReason = supplySideTapReason(_tapAuth);
      it.description =
        `${_tapAuth.candidateLabel}. ${it.description ?? ''} `
        + `EXISTING SERVICE CONDUCTOR: ${_tapAuth.existingServiceConductorSize ?? 'NOT SURVEYED'}`
        + `${_tapAuth.existingServiceConductorMaterial ? ` ${_tapAuth.existingServiceConductorMaterial}` : ''}`
        + ` · CONNECTOR LISTED RANGE: ${_tapAuth.listedConductorRange ?? '—'}`
        + ` · LUG-RANGE COMPATIBILITY: ${_tapAuth.lugRangeCompatibility == null ? 'NOT EVALUABLE' : _tapAuth.lugRangeCompatibility ? 'VERIFIED' : 'FAILS'}. `
        + `Unresolved: ${_tapAuth.unresolvedFacts.join('; ')}. Design quantity only — EXCLUDED from the `
        + `authoritative procurement total and from every export; retained on the design-review schedule.`;
      it.derivedFrom = `supply-side tap connection authority (verification=${_tapAuth.verificationStatus}) — candidate connector, non-orderable`;
      it.authorityStateHint = 'CANDIDATE_NON_ORDERABLE';
      it.authorityStateHintReason = supplySideTapReason(_tapAuth);
      log.push(`[bomForPermit] ECD §5 tap connector ${it.partNumber} CANDIDATE: ${_tapAuth.unresolvedFacts.length} unresolved fact(s)`);
    }
  } else if (_tapAuth) {
    // ── the SAME authority, VERIFIED — the rule must be two-way ─────────────
    // bom-engine-v4 stamps SUPPLY_SIDE_TAP_CONNECTOR_HINT (a CANDIDATE hint)
    // UNCONDITIONALLY on this row, because it is a PRE-snapshot engine and has no
    // authority to consult. With no counterpart here, a VERIFIED tap authority
    // could never promote the row: the hint alone would hold it at CANDIDATE
    // forever — a one-way gate, and §5's "until verified" would have no `after`.
    // The authority is the only thing that decides, in BOTH directions; the row
    // still has to clear TAP-CONDUCTOR-LENGTH-PENDING and every other open
    // procurement requirement through the classifier's normal path.
    for (const it of merged) {
      if (it.category !== 'connector') continue;
      if (String(it.partNumber).toUpperCase() !== String(_tapAuth.connectorSku ?? '').toUpperCase()) continue;
      it.authorityStateHint = undefined;
      it.authorityStateHintReason = undefined;
      it.nonOrderable = undefined;
      it.nonOrderableReason = undefined;
      it.derivedFrom = 'supply-side tap connection authority (verification=verified) — listed connector '
        + 'verified against the surveyed existing service conductor';
      log.push(`[bomForPermit] ECD §5 tap connector ${it.partNumber} authority VERIFIED — candidate hint cleared`);
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

  // ── 7. ECD W1-A + W1-B — THE SINGLE IDENTITY + CLASSIFICATION PASS ───────
  // Runs LAST, over the FINAL row collection, so it covers every row including
  // the two that used to reach the package with no id at all (the integrated
  // combiner appended in 5b and the open-air branch EGC appended in 5d) and
  // every row whose state the post-passes above just set. One pass, one owner:
  // nothing downstream may write a row state, and nothing downstream may derive
  // orderability from anything except the record this pass attaches.
  const _idAudit = stampBomLineIds(merged);
  const _procCtx = buildProcurementClassificationContext(input);
  applyProcurementAuthority(merged, _procCtx);
  log.push(
    `[bomForPermit] ECD W1-A row identity: ${_idAudit.total} rows / ${_idAudit.unique} unique bomLineIds, `
    + `${_idAudit.duplicateIds.length} duplicates, ${_idAudit.hashCollisions.length} hash collisions, `
    + `${_idAudit.missingIds} missing`,
  );
  log.push(`[bomForPermit] ECD W1-B states: ${JSON.stringify(countProcurementStates(merged))}`);

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
// ECD §1/§2/§3/§4/§5/§10 (W1-B…W1-F) — THE ONE PROCUREMENT AUTHORITY MODEL.
//
// ── WHAT THIS REPLACES ─────────────────────────────────────────────────────
// THREE partially-overlapping mechanisms on two sides of a type boundary:
//   1. `PermitBOMItem.nonOrderable`   — a boolean set by four authorities.
//   2. `PermitBOMItem.quantityState`  — two-valued, one user (the sealing cap).
//   3. `StructuralBomRow.procurementClass` A/B/C/D — richer than both, and it
//      NEVER crossed into PermitBOMItem: the column was empty on all 48 rows.
// …plus a FAIL-OPEN default that the previous version of this comment block
// stated outright — "an unflagged row is a verified row". That one sentence is
// what silently counted the module row, 22 route-estimated rows, both Q-Cable
// field-splice connectors and the Polaris tap connector inside the
// "authoritative procurement total".
//
// ── THE MODEL ──────────────────────────────────────────────────────────────
// Producers declare FACTS (`quantitySource`, `affectedRouteIds`,
// `authorityStateHint`, and the authority-set `nonOrderable`/`quantityState`
// pre-passes above). `classifyProcurementAuthority` is the ONE function that
// turns those facts plus the snapshot's OPEN release requirements into exactly
// one `ProcurementAuthorityState` per row. `nonOrderable` and `quantityState`
// are then rewritten as PROJECTIONS of that state, so every existing reader
// keeps working and no reader can disagree with the classifier.
//
// ── FAIL-CLOSED ────────────────────────────────────────────────────────────
// VERIFIED_ORDERABLE is REACHED, never defaulted to. A row gets it only by
// satisfying an EXPLICIT per-category rule (exact product identity + a declared
// quantity basis + no OPEN procurement-impacting requirement affecting it). A
// row in an unknown category, or with a placeholder part number, or with no
// attached record at all, is NOT orderable.
// ═══════════════════════════════════════════════════════════════════════════

// ── (a) WHICH OPEN REQUIREMENTS CAN BLOCK A PROCUREMENT ROW ─────────────────
// A release requirement blocks a BOM row only when ALL THREE hold:
//   1. it is OPEN (in permitReadiness.registry and not resolved),
//   2. its DECLARED release impact includes the PROCUREMENT axis
//      (severityPolicy → `impact.procurement` — the same declaration RS-1's
//      readiness axes derive from; no second opinion is invented here),
//   3. it AFFECTS this row per the explicit map below.
// A code with `procurement: false` (CONDUIT-FILL-PENDING, FRAMING-AUTHORITY-
// UNVERIFIED, CODE-AUTHORITY-INCOMPLETE, ENGINEERING-REVIEW-PENDING …) can
// never make a row non-orderable — that is what the axis declaration MEANS.

const RACKING_ASSEMBLY_CATEGORIES = new Set([
  'rail', 'splice', 'l_foot', 'mid_clamp', 'end_clamp', 'mount_hardware', 'grounding', 'racking', 'flashing',
]);
const MODULE_CATEGORIES = new Set(['solar_panel', 'panels', 'module']);
const EQUIPMENT_IDENTITY_CATEGORIES = new Set([
  'solar_panel', 'panels', 'module',
  'microinverter', 'string_inverter', 'hybrid_inverter', 'inverter', 'inverters', 'optimizer',
  'battery',
]);

/** Which rows a procurement-impacting requirement code affects. Explicit and
 *  enumerated: no description regexes, no "everything is blocked" fallback. */
const REQUIREMENT_ROW_SCOPE: Record<string, (row: PermitBOMItem) => boolean> = {
  // RG-5 already declares this verbatim: "the procurement conductor / raceway
  // FOOTAGE (length-dependent results only)". The consumer is right here.
  'ROUTE-LENGTH-ESTIMATE': r => r.quantitySource === 'route-derived',
  // the open-air branch EGC section only (its own authority already flags it).
  'QCABLE-GROUNDING-AUTHORITY-UNVERIFIED': r => r.category === 'wire' && String(r.partNumber).startsWith('GRN-OPENAIR'),
  // every assembly-dependent racking row + the mount-base lot line.
  'PENDING-RACKING-ASSEMBLY-SELECTION': r => RACKING_ASSEMBLY_CATEGORIES.has(r.category),
  // the roof-attachment fastener row.
  'FASTENER-ASSEMBLY-UNVERIFIED': r => r.category === 'lag_bolt',
  // the exact-wattage module datasheet is absent; severityPolicy declares this
  // procurement-impacting (it fixes the ordered module SKU), so the module row
  // is NOT verified-orderable while it is open. Microinverters are unaffected.
  'MODULE-EXACT-DATASHEET-PENDING': r => MODULE_CATEGORIES.has(r.category),
  // the ordered trunk-cable base quantity is short of the installed path, and
  // the field-splice connectors are the unselected candidate resolution.
  'QCABLE-PROCUREMENT-INSUFFICIENT': r => r.category === 'trunk_cable'
    || (r.category === 'connector' && /^Q-CONN-/i.test(String(r.partNumber))),
  // operator-entered identity conflict between the design record and the
  // selected equipment — it invalidates the ORDERED identity of those rows.
  // (Standing rule: EQUIPMENT-IDENTITY-CONFLICT is operator-only. It is absent
  // from the frozen fixture and present on the live project record.)
  'EQUIPMENT-IDENTITY-CONFLICT': r => EQUIPMENT_IDENTITY_CATEGORIES.has(r.category),
  // the tap-conductor length is unmeasured; the tap connector row is the
  // procurement line that depends on the tap connection being established.
  'TAP-CONDUCTOR-LENGTH-PENDING': r => r.category === 'connector' && /^IPLD/i.test(String(r.partNumber)),
};

// ── (b) PER-CATEGORY CLASSIFICATION RULES ───────────────────────────────────
// The DECLARED quantity basis for every category the permit BOM can emit. A
// category NOT in this table has no rule, and a row without a rule can never be
// VERIFIED_ORDERABLE (fail-closed). A producer-declared `quantitySource` always
// wins — the table is the baseline for rows whose producer declared nothing.
const CATEGORY_QUANTITY_BASIS: Record<string, BomQuantitySource> = {
  // ── exact equipment identity, quantity = a canonical COUNT ───────────────
  solar_panel:      'count-derived',   // = the canonical module count
  panels:           'count-derived',
  microinverter:    'count-derived',   // = 1 per module (canonical pairing)
  string_inverter:  'count-derived',
  hybrid_inverter:  'count-derived',
  inverter:         'count-derived',
  inverters:        'count-derived',
  optimizer:        'count-derived',
  battery:          'count-derived',
  generator:        'count-derived',
  ats:              'count-derived',
  backup_interface: 'count-derived',
  combiner:         'count-derived',   // integrated-BOS resolver: 1 per brand group
  gateway:          'count-derived',
  monitoring:       'count-derived',
  meter:            'count-derived',
  // ── code/topology-established per-installation devices ───────────────────
  disconnect:       'per-installation-constant',
  breaker:          'per-installation-constant',
  fuse:             'per-installation-constant',
  rapid_shutdown:   'per-installation-constant',
  junction_box:     'per-installation-constant',
  label:            'per-installation-constant',
  connector:        'per-installation-constant',
  consumable:       'per-installation-constant',
  // ── AC-branch topology objects (drops / branch ends) ─────────────────────
  trunk_cable:      'topology-derived',
  terminator:       'topology-derived',
  sealing_cap:      'topology-derived',
  // WS-2 — cable support hardware. Its quantity is the installed cable path
  // divided by the manufacturer's documented maximum support spacing, which is a
  // topology derivation like every other Q-Cable accessory. Without this entry
  // the category was UNMAPPED and the row failed closed as non-orderable — the
  // correct default, and the reason it is being mapped deliberately rather than
  // by widening the fallback.
  cable_support:    'topology-derived',
  // ── unresolved route geometry (ECD §3) ───────────────────────────────────
  wire:             'route-derived',
  conduit:          'route-derived',
  conduit_fitting:  'route-derived',
  conduit_body:     'route-derived',
  // ── canonical array/structural geometry ──────────────────────────────────
  rail:             'geometry-derived',
  splice:           'geometry-derived',
  l_foot:           'geometry-derived',
  lag_bolt:         'geometry-derived',
  mount_hardware:   'geometry-derived',
  mid_clamp:        'geometry-derived',
  end_clamp:        'geometry-derived',
  flashing:         'geometry-derived',
  grounding:        'geometry-derived',
  racking:          'geometry-derived',
};

/** Categories with an explicit rule. A row outside this set cannot be
 *  VERIFIED_ORDERABLE even with a part number — no rule says what "verified"
 *  would mean for it. */
const CLASSIFIABLE_CATEGORIES = new Set(Object.keys(CATEGORY_QUANTITY_BASIS));

// ── (c) THE CLASSIFICATION CONTEXT ──────────────────────────────────────────

export interface ProcurementClassificationContext {
  /** OPEN requirement codes that DECLARE a procurement-axis impact. */
  openProcurementRequirementCodes: string[];
  // ── 2026-08-28 — PROCUREMENT IS NOT A SHADOW OF A COMPLIANCE REQUIREMENT ──
  // The ESTIMATED_FIELD_VERIFY branch below used to be gated on
  // ROUTE-LENGTH-ESTIMATE being OPEN, on the assumption that "no open route
  // requirement ⇒ the routes are verified". That held while the only ways to
  // close it were routed geometry or a field measurement.
  //
  // It stopped holding when a run could also be closed by the DESIGN BOUNDING it
  // (lib/electrical/routeLengthBound.ts). A bounded run's COMPLIANCE question is
  // answered — the conductor is valid for any installed length under the
  // maximum the drawing states — but its QUANTITY is still Σ heuristic length.
  // Ordering conduit and sweeps off that, marked VERIFIED_ORDERABLE, is exactly
  // the over-claim the ESTIMATED state exists to prevent.
  //
  // So the quantity state is decided by the LENGTH SOURCE, which is the fact it
  // was always about. These are the route ids whose length is estimate-grade.
  estimateGradeRouteIds: readonly string[];
  /** every OPEN requirement code (evidence/provenance, not blocking). */
  openRequirementCodes: string[];
  /** resolution action per code, from the registry (rendered verbatim). */
  resolutionByCode: Record<string, string>;
  /** ECD §4 — cable-extension solutions available to PROMOTE connector rows. */
  cableExtensionSolutions: readonly CableExtensionSolution[];
  /** ECD §5 — the supply-side tap connection authority (null when N/A). */
  supplySideTap: SupplySideTapConnectionAuthority | null;
  snapshotId: string | null;
  snapshotDigest: string | null;
}

export function buildProcurementClassificationContextFromSnapshot(
  snap: Readonly<PermitDesignSnapshot> | null,
): ProcurementClassificationContext {
  const registry = (snap?.permitReadiness?.registry ?? []).filter(b => !b.resolved);
  const openRequirementCodes = registry.map(b => b.code);
  // Every route id whose length is estimate-grade. Fail-closed: a segment with
  // no recognised source counts as an estimate. The PHYSICAL RACEWAY ids are
  // included alongside the segment ids because a raceway row's
  // `affectedRouteIds` names both, and the raceway inherits its members' source.
  const estimateGradeRouteIds: string[] = (() => {
    const segs = snap?.electrical?.routeSegments ?? [];
    const NON_ESTIMATE = new Set(['cad-route', 'field-measurement', 'field-verified']);
    const bad = segs.filter(r => !NON_ESTIMATE.has(String(r.lengthSource ?? '')));
    const ids = new Set<string>(bad.map(r => r.segmentId));
    for (const r of bad) if (r.physicalRacewayId) ids.add(r.physicalRacewayId);
    return [...ids];
  })();
  const resolutionByCode: Record<string, string> = {};
  for (const b of registry) resolutionByCode[b.code] = b.resolutionAction;
  return {
    openRequirementCodes,
    openProcurementRequirementCodes: openRequirementCodes.filter(c => severityImpactForCode(c).procurement),
    estimateGradeRouteIds,
    resolutionByCode,
    cableExtensionSolutions: snap?.electrical?.procurementSufficiency?.solutions ?? [],
    supplySideTap: snap?.electrical?.supplySideTapConnection ?? null,
    snapshotId: snap?.meta?.snapshotId ?? null,
    snapshotDigest: snap?.meta?.digest ?? null,
  };
}

/** Build the context from the validated snapshot. FAIL-CLOSED on absence: with
 *  no snapshot no blocker is invented, but no row is promoted either — the
 *  category rules still have to be satisfied. */
export function buildProcurementClassificationContext(input: PermitInput): ProcurementClassificationContext {
  return buildProcurementClassificationContextFromSnapshot(peekSnapshot(input));
}

/** The empty context — for pure callers classifying without a snapshot. */
export const EMPTY_PROCUREMENT_CONTEXT: ProcurementClassificationContext = {
  openProcurementRequirementCodes: [], estimateGradeRouteIds: [],
  openRequirementCodes: [], resolutionByCode: {},
  cableExtensionSolutions: [], supplySideTap: null, snapshotId: null, snapshotDigest: null,
};

// ── (d) ECD §4 — THE CableExtensionSolution PROMOTION CONTRACT ──────────────
// Clearing the LENGTH DEFICIT and PROMOTING a connector row are different
// questions. `evaluateCableExtensionClearance` (procurementSufficiency.ts)
// answers the first. This answers the second, and it is strictly stronger: the
// solution must additionally be SELECTED by an operator, be itself VERIFIED,
// and NAME the exact bomLineId it supplies. No solution ⇒ no promotion — which
// is the live state today (`cableExtensionSolutions` is always empty).

export interface CableExtensionPromotion {
  promoted: boolean;
  solutionId: string | null;
  missing: string[];
}

export function evaluateCableExtensionPromotion(
  bomLineId: string,
  solutions: readonly CableExtensionSolution[],
): CableExtensionPromotion {
  if (!solutions.length) {
    return { promoted: false, solutionId: null, missing: ['no CableExtensionSolution exists for this design'] };
  }
  const candidates = solutions.filter(s => (s.bomLineIds ?? []).includes(bomLineId));
  if (!candidates.length) {
    return { promoted: false, solutionId: null, missing: [`no CableExtensionSolution names BOM line ${bomLineId}`] };
  }
  for (const s of candidates) {
    const missing: string[] = [];
    if (s.selected !== true) missing.push('solution is not SELECTED');
    if (s.verificationState !== 'verified') missing.push(`solution verificationState is '${s.verificationState ?? 'unset'}', not 'verified'`);
    if (!s.selectedSku) missing.push('no exact listed product SKU is selected');
    if (s.compatibilityVerified !== true) missing.push('compatibility with the selected system is not verified');
    if (!s.manufacturerDocument) missing.push('no verified manufacturer document');
    if (s.representedInBom !== true) missing.push('solution is not represented in the BOM');
    if (!missing.length) return { promoted: true, solutionId: s.solutionId, missing: [] };
  }
  return {
    promoted: false,
    solutionId: candidates[0].solutionId,
    missing: ['the naming CableExtensionSolution does not satisfy the promotion contract'],
  };
}

// ── (e) THE CLASSIFIER ──────────────────────────────────────────────────────

const WITHHELD_IDENTITY = 'IDENTITY WITHHELD — NO VERIFIED SELECTION';

function itemIdentityOf(row: PermitBOMItem): string {
  const parts = [row.manufacturer, row.model, row.partNumber]
    .map(v => (v ?? '').trim())
    .filter(v => v.length > 0 && v !== '—');
  return parts.length ? parts.join(' | ') : WITHHELD_IDENTITY;
}

/** THE classifier. Pure: (row, context) → exactly one authority record. */
export function classifyProcurementAuthority(
  row: PermitBOMItem,
  ctx: ProcurementClassificationContext,
): ProcurementAuthorityRecord {
  const bomLineId = row.bomLineId ?? '(unstamped)';
  // A PRODUCER-declared 'unknown' (an absent route length) is a QUANTITY
  // question. An UNMAPPED CATEGORY is an IDENTITY/rule question — those must
  // not be conflated, or a row in an unknown category would be reported as
  // "quantity not established" when the real defect is that no classification
  // rule exists for it.
  const declaredSource = row.quantitySource;
  const quantitySource: BomQuantitySource =
    declaredSource ?? CATEGORY_QUANTITY_BASIS[row.category] ?? 'unknown';

  // Which OPEN, procurement-impacting requirements affect THIS row.
  const blockingRequirementCodes = ctx.openProcurementRequirementCodes
    .filter(code => REQUIREMENT_ROW_SCOPE[code]?.(row) === true);

  const evidenceReferences: string[] = [];
  if (ctx.snapshotId) evidenceReferences.push(`snapshot:${ctx.snapshotId}`);
  for (const c of blockingRequirementCodes) evidenceReferences.push(`requirement:${c}`);

  const base = {
    bomLineId,
    itemIdentity: itemIdentityOf(row),
    quantity: Number.isFinite(row.quantity) ? row.quantity : 0,
    quantityUnit: row.unit || 'ea',
    quantitySource,
    blockingRequirementCodes,
    affectedRouteIds: row.affectedRouteIds ?? [],
    affectedEquipmentIds: row.affectedEquipmentIds ?? [],
    evidenceReferences,
    snapshotId: ctx.snapshotId,
    snapshotDigest: ctx.snapshotDigest,
    // ECD §2 — what the PRODUCER declared, recorded so a second classification
    // pass can be handed the producer view instead of this pass's projections.
    producerNonOrderable: row.nonOrderable === true,
    producerQuantityState: row.quantityState ?? null,
  };
  const make = (
    authorityState: ProcurementAuthorityState,
    verificationStatus: ProcurementVerificationStatus,
    authoritySource: string,
    resolutionAction: string,
  ): ProcurementAuthorityRecord => ({
    ...base,
    authorityState,
    orderable: authorityState === 'VERIFIED_ORDERABLE',
    exportable: authorityState === 'VERIFIED_ORDERABLE',
    verificationStatus,
    authoritySource,
    resolutionAction,
  });
  const codeResolution = (codes: string[], fallback: string): string =>
    codes.map(c => ctx.resolutionByCode[c]).filter(Boolean).join(' ') || fallback;

  // 1. QUANTITY NOT ESTABLISHED beats everything: a count that is unknown may
  //    never render as a certain number, whatever else is true of the row.
  if (row.quantityState === 'pending') {
    return make('QUANTITY_PENDING', 'pending-measurement',
      'quantity-state authority (the modeled count is not the established field quantity)',
      row.quantityStateLabel ?? 'Establish the field quantity, then re-derive the row.');
  }
  // 2. The producer could not establish the quantity at all — an absent route
  //    length that used to be silently replaced by a fabricated 30 ft default.
  if (declaredSource === 'unknown') {
    return make('QUANTITY_PENDING', 'pending-measurement',
      'producer declared the quantity basis UNKNOWN — no length/count authority exists for this row '
      + '(no value is substituted in its place)',
      'Establish the missing run length / count on the canonical route objects, then re-derive.');
  }
  // 3. A producer-declared state hint (candidate connectors: Q-CONN field
  //    splices, the Polaris tap connector). A hint may only LOWER a row.
  if (row.authorityStateHint && row.authorityStateHint !== 'VERIFIED_ORDERABLE') {
    // ECD §4 — the ONE escape hatch: a verified, SELECTED CableExtensionSolution
    // that names this exact bomLineId promotes the row.
    if (row.category === 'connector' && /^Q-CONN-/i.test(String(row.partNumber))) {
      const promo = evaluateCableExtensionPromotion(bomLineId, ctx.cableExtensionSolutions);
      if (promo.promoted) {
        return make('VERIFIED_ORDERABLE', 'verified',
          `CableExtensionSolution ${promo.solutionId} (selected + verified + names this BOM line)`,
          'None — the connector is supplied by a verified selected cable-extension solution.');
      }
      return make('CANDIDATE_NON_ORDERABLE', 'unverified',
        `${row.authorityStateHintReason ?? 'candidate product'} PROMOTION CONTRACT: ${promo.missing.join('; ')}`,
        codeResolution(blockingRequirementCodes,
          'Select a listed cable-extension / field-splice solution, archive its verified manufacturer document, '
          + 'and bind it to this BOM line.'));
    }
    return make(row.authorityStateHint,
      row.authorityStateHint === 'QUANTITY_PENDING' ? 'pending-measurement' : 'unverified',
      row.authorityStateHintReason ?? 'producer-declared candidate (not a selected, verified product)',
      codeResolution(blockingRequirementCodes,
        'Establish the missing authority for this product, then re-derive the row.'));
  }
  // 4. An AUTHORITY already ruled the row non-orderable (fastener assembly,
  //    racking assembly, open-air grounding, Q-Cable procurement sufficiency).
  if (row.nonOrderable === true) {
    return make('CANDIDATE_NON_ORDERABLE', 'pending-authority',
      row.nonOrderableReason ?? 'DESIGN QUANTITY ONLY — pending verified authority (see RS-1)',
      codeResolution(blockingRequirementCodes, 'Verify the governing authority (see RS-1), then re-derive the row.'));
  }
  // 5. Nothing to procure.
  if (!(base.quantity > 0)) {
    return make('EXCLUDED_NOT_APPLICABLE', 'not-applicable',
      'zero quantity — the row is not applicable to this design',
      'None — nothing is ordered for this line.');
  }
  // 6. An OPEN, procurement-impacting requirement affects the row.
  if (blockingRequirementCodes.length) {
    // ECD §3 — the ROUTE case is an ESTIMATE, not a candidate: the product IS
    // selected and the design quantity IS meaningful for budgeting; only the
    // routed length is unresolved. It stays visible, labeled FIELD VERIFY, and
    // out of the authoritative total and every export.
    const routeOnly = blockingRequirementCodes.every(c => c === 'ROUTE-LENGTH-ESTIMATE');
    if (routeOnly && quantitySource === 'route-derived') {
      return make('ESTIMATED_FIELD_VERIFY', 'pending-measurement',
        'ROUTE-LENGTH-ESTIMATE (RG-5) is OPEN — this quantity is Σ CAD-derived route length, neither '
        + 'routed nor field-measured; budgeting quantity only',
        codeResolution(blockingRequirementCodes,
          'Route or field-measure the runs, record them on the canonical route objects, then re-derive.'));
    }
    return make('CANDIDATE_NON_ORDERABLE', 'pending-authority',
      `OPEN procurement-impacting requirement(s): ${blockingRequirementCodes.join(', ')}`,
      codeResolution(blockingRequirementCodes, 'Resolve the listed requirement(s) — see RS-1.'));
  }
  // 6b. A ROUTE-DERIVED quantity whose underlying length is still an ESTIMATE is
  //     ESTIMATED — whatever the requirement registry says. This runs OUTSIDE the
  //     open-requirement branch above precisely because it must not depend on one:
  //     a design-BOUNDED run closes the compliance question and leaves the
  //     quantity exactly as estimated as it was.
  if (quantitySource === 'route-derived') {
    const touched = (row.affectedRouteIds ?? []).filter(id => ctx.estimateGradeRouteIds.includes(id));
    if (touched.length > 0) {
      return make('ESTIMATED_FIELD_VERIFY', 'pending-measurement',
        `Σ route length for ${touched.join(', ')} is CAD-derived, neither routed nor field-measured — `
        + 'budgeting quantity only. The design may BOUND these runs (which answers the voltage-drop '
        + 'question) without making the quantity a measurement.',
        'Route or field-measure the runs, record them on the canonical route objects, then re-derive.');
    }
  }
  // 7. FAIL-CLOSED identity + rule checks — the ONLY path to VERIFIED_ORDERABLE.
  //    (A route-derived row with NO open route requirement reaches here: the
  //    routes are verified, so it is orderable. Unreachable while RG-5 is open,
  //    kept so the model is not a one-way gate.)
  if (!CLASSIFIABLE_CATEGORIES.has(row.category)) {
    return make('CANDIDATE_NON_ORDERABLE', 'unverified',
      `no procurement classification rule exists for category '${row.category}' — fail-closed`,
      'Add an explicit classification rule for this category before it can be ordered.');
  }
  if (isPartNumberPlaceholder(row.partNumber)) {
    return make('CANDIDATE_NON_ORDERABLE', 'unverified',
      'no exact part number — the row names no selected product',
      'Select the exact product and record its part number.');
  }
  return make('VERIFIED_ORDERABLE', 'verified',
    `exact product identity + ${quantitySource} quantity + no OPEN procurement-impacting requirement affects this row`,
    'None — the row is orderable.');
}

/**
 * ECD §2 — the PRODUCER VIEW of a row.
 *
 * `nonOrderable` / `quantityState` are producer inputs to the classifier AND the
 * back-compat projections the classifier writes back. Handing an already-
 * classified row straight back to `classifyProcurementAuthority` therefore fed
 * this pass's own output in as a producer fact: rule 4 (`row.nonOrderable ===
 * true` ⇒ CANDIDATE_NON_ORDERABLE) fired on every ESTIMATED_FIELD_VERIFY and
 * QUANTITY_PENDING row, so re-classification silently collapsed 22 estimated
 * rows into candidates. The classifier is documented as idempotent; this makes
 * it so, by restoring the producer's declared values from the record.
 *
 * Callers that re-classify (the classifier is pure, so tests, probes and any
 * what-if evaluation do) MUST classify this view, never the mutated row.
 */
export function producerViewOf(row: PermitBOMItem): PermitBOMItem {
  const rec = row.procurement;
  if (!rec) return row;
  return {
    ...row,
    nonOrderable: rec.producerNonOrderable === true ? true : undefined,
    quantityState: rec.producerQuantityState ?? undefined,
  };
}

/** Run the classifier over the FINAL row collection and write the record plus
 *  its back-compat projections. Idempotent — see `producerViewOf`. THE only
 *  writer of row state. */
export function applyProcurementAuthority(
  rows: PermitBOMItem[],
  ctx: ProcurementClassificationContext,
): void {
  for (const row of rows) {
    const rec = classifyProcurementAuthority(producerViewOf(row), ctx);
    row.procurement = rec;
    // ── back-compat PROJECTIONS (no renderer had to change to keep working) ──
    // Any state other than VERIFIED_ORDERABLE is excluded from the authoritative
    // total, which is exactly what `nonOrderable` has always meant to its
    // readers; QUANTITY_PENDING additionally sets the pending quantity state so
    // the cell can never print a bare number.
    if (rec.authorityState === 'VERIFIED_ORDERABLE') {
      row.nonOrderable = undefined;
      row.quantityState = row.quantityState ?? 'established';
    } else if (rec.authorityState === 'QUANTITY_PENDING') {
      row.quantityState = 'pending';
      row.quantityStateLabel = row.quantityStateLabel ?? `${row.quantity} MODELED / FIELD QUANTITY PENDING`;
      row.nonOrderable = true;
      row.nonOrderableReason = row.nonOrderableReason ?? rec.authoritySource;
    } else {
      row.nonOrderable = true;
      row.nonOrderableReason = row.nonOrderableReason ?? rec.authoritySource;
    }
  }
}

/** Fail-closed accessor. A row that was never run through the classifier
 *  against a real snapshot has NOT been checked against any open requirement,
 *  so it can never be reported VERIFIED_ORDERABLE — it is classified on its
 *  row-local facts and any resulting A is DOWNGRADED, with the reason stated.
 *  Nothing is assumed verified because nobody looked at it. */
export function procurementAuthorityOf(row: PermitBOMItem): ProcurementAuthorityRecord {
  if (row.procurement) return row.procurement;
  const rec = classifyProcurementAuthority(row, EMPTY_PROCUREMENT_CONTEXT);
  if (rec.authorityState !== 'VERIFIED_ORDERABLE') return rec;
  return {
    ...rec,
    authorityState: 'CANDIDATE_NON_ORDERABLE',
    orderable: false,
    exportable: false,
    verificationStatus: 'unverified',
    authoritySource:
      'row was never classified against a snapshot authority — no open-requirement check has been '
      + 'performed for it, so it cannot be reported orderable (fail-closed)',
    resolutionAction: 'Classify the row through generateBOMForPermit / applyProcurementAuthority.',
  };
}

/** State histogram over any row collection. */
export function countProcurementStates(
  rows: readonly PermitBOMItem[],
): Record<ProcurementAuthorityState, number> {
  const counts = Object.fromEntries(
    PROCUREMENT_AUTHORITY_STATES.map(s => [s, 0]),
  ) as Record<ProcurementAuthorityState, number>;
  for (const r of rows) counts[procurementAuthorityOf(r).authorityState]++;
  return counts;
}

/** The ONE rendered label per state (re-exported so renderers never re-word). */
export { PROCUREMENT_AUTHORITY_STATE_LABEL, PROCUREMENT_AUTHORITY_STATES };
export type { ProcurementAuthorityState, ProcurementAuthorityRecord, BomQuantitySource };

// ═══════════════════════════════════════════════════════════════════════════
// ECD §1/§10 — THE ONE COUNTER OVER THE ONE POPULATION.
//
// POPULATION DECISION (ECD §1, W1-C): the canonical population is the FULL BOM
// — every line the package orders, modules and inverters included. Before this,
// `buildProcurementApproval` counted the full 48 rows while the table it printed
// under counted the 47 that survive BOM_SKIP_CATEGORIES, so the sheet printed
// "36 of 48" three inches below 47 rendered rows. BOM_SKIP_CATEGORIES is now a
// DISPLAY-SECTION concern only: those rows are scheduled in the module /
// inverter tables above the BOM table, and the SCHED table names them and their
// row ids, so the rendered id multiset still equals the population.
// ═══════════════════════════════════════════════════════════════════════════

/** Why a row is excluded (legacy two-class view, kept so existing consumers and
 *  tests keep working — DERIVED from authorityState, never set independently). */
export type ProcurementExclusionClass =
  | 'non-orderable-design-quantity'
  | 'quantity-pending';

export interface ProcurementExclusion {
  bomLineId: string;
  category: string;
  model: string;
  partNumber: string;
  quantity: number;
  unit: string;
  /** the ECD state (the authority); `exclusionClass` is its legacy projection. */
  authorityState: ProcurementAuthorityState;
  exclusionClass: ProcurementExclusionClass;
  reason: string;
}

export interface ProcurementApproval {
  // ── ECD §1 canonical count fields ─────────────────────────────────────────
  totalRowCount: number;
  verifiedOrderableCount: number;
  estimatedFieldVerifyCount: number;
  candidateNonOrderableCount: number;
  quantityPendingCount: number;
  excludedCount: number;
  /** the count that may enter an authoritative procurement export. */
  authoritativeExportCount: number;
  /** ECD §12 gate 3 — the five state counts sum to totalRowCount. */
  countsReconcile: boolean;
  /** every row id in the population, and the export subset — the §1 multiset. */
  allRowIds: string[];
  orderableRowIds: string[];
  /** ECD §10 — false while ANY row is not VERIFIED_ORDERABLE. */
  procurementReady: boolean;
  /** OPEN, procurement-impacting requirement codes across the population. */
  openProcurementRequirementCodes: string[];

  // ── legacy field names (SCHED, ppc-artifacts and tests read them) ────────
  /** === totalRowCount. */
  totalLineItems: number;
  /** === verifiedOrderableCount. */
  orderableLineItems: number;
  /** === total − verifiedOrderable (every non-A state). */
  excludedLineItems: number;
  orderableQuantityByUnit: Record<string, number>;
  orderableRows: PermitBOMItem[];
  exclusions: ProcurementExclusion[];
  excludedCountByClass: Record<ProcurementExclusionClass, number>;
  partial: boolean;
  statement: string;

  // ── ECD §1 identity audit over the population ────────────────────────────
  rowIdAudit: BomLineIdAudit;
  /** per-state row ids (evidence artifacts + the anti-vacuity probes). */
  rowIdsByState: Record<ProcurementAuthorityState, string[]>;
}

/** Is this row eligible for the authoritative procurement total / an export?
 *  ECD §2: FAIL-CLOSED — exactly one state qualifies, and an unclassified row
 *  never does. (Before: `!nonOrderable && quantityState !== 'pending'`, i.e.
 *  "an unflagged row is a verified row".) */
export function isOrderableForProcurement(item: PermitBOMItem): boolean {
  return procurementAuthorityOf(item).authorityState === 'VERIFIED_ORDERABLE';
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
  const counts = Object.fromEntries(
    PROCUREMENT_AUTHORITY_STATES.map(s => [s, 0]),
  ) as Record<ProcurementAuthorityState, number>;
  const rowIdsByState = Object.fromEntries(
    PROCUREMENT_AUTHORITY_STATES.map(s => [s, [] as string[]]),
  ) as Record<ProcurementAuthorityState, string[]>;
  const allRowIds: string[] = [];
  const openCodes = new Set<string>();

  for (const it of items) {
    const rec = procurementAuthorityOf(it);
    const id = rec.bomLineId;
    allRowIds.push(id);
    counts[rec.authorityState]++;
    rowIdsByState[rec.authorityState].push(id);
    for (const c of rec.blockingRequirementCodes) openCodes.add(c);

    if (rec.authorityState === 'VERIFIED_ORDERABLE') {
      orderableRows.push(it);
      const u = it.unit || 'ea';
      orderableQuantityByUnit[u] = (orderableQuantityByUnit[u] ?? 0) + (Number.isFinite(it.quantity) ? it.quantity : 0);
      continue;
    }
    const cls: ProcurementExclusionClass = rec.authorityState === 'QUANTITY_PENDING'
      ? 'quantity-pending'
      : 'non-orderable-design-quantity';
    excludedCountByClass[cls]++;
    exclusions.push({
      bomLineId: id,
      category: it.category,
      model: it.model,
      partNumber: it.partNumber,
      quantity: it.quantity,
      unit: it.unit,
      authorityState: rec.authorityState,
      exclusionClass: cls,
      reason: it.nonOrderableReason ?? rec.authoritySource,
    });
  }

  const totalRowCount = items.length;
  const verifiedOrderableCount = counts.VERIFIED_ORDERABLE;
  const stateSum = PROCUREMENT_AUTHORITY_STATES.reduce((n, s) => n + counts[s], 0);
  const partial = exclusions.length > 0;

  // ECD §10 — the summary sentence is DERIVED from the row states. It never says
  // "all required", "no manual estimates", "complete procurement package" or
  // "authoritative total" unless the states prove it.
  const statement = partial
    ? `PROCUREMENT AUTHORITY SUMMARY — ${totalRowCount} BOM rows: `
      + `${verifiedOrderableCount} VERIFIED ORDERABLE · ${counts.ESTIMATED_FIELD_VERIFY} ESTIMATED (FIELD VERIFY) · `
      + `${counts.CANDIDATE_NON_ORDERABLE} CANDIDATE (NOT SELECTED) · ${counts.QUANTITY_PENDING} QUANTITY NOT ESTABLISHED · `
      + `${counts.EXCLUDED_NOT_APPLICABLE} NOT APPLICABLE. AUTHORITATIVE PROCUREMENT EXPORT: `
      + `${verifiedOrderableCount} row${verifiedOrderableCount === 1 ? '' : 's'} — every other row is excluded from `
      + `the total AND from every export. PROCUREMENT READY: NO.`
    : `PROCUREMENT AUTHORITY SUMMARY — all ${totalRowCount} BOM rows are VERIFIED ORDERABLE. `
      + `AUTHORITATIVE PROCUREMENT EXPORT: ${totalRowCount} rows. PROCUREMENT READY: YES.`;

  return {
    totalRowCount,
    verifiedOrderableCount,
    estimatedFieldVerifyCount: counts.ESTIMATED_FIELD_VERIFY,
    candidateNonOrderableCount: counts.CANDIDATE_NON_ORDERABLE,
    quantityPendingCount: counts.QUANTITY_PENDING,
    excludedCount: counts.EXCLUDED_NOT_APPLICABLE,
    authoritativeExportCount: verifiedOrderableCount,
    countsReconcile: stateSum === totalRowCount,
    allRowIds,
    orderableRowIds: rowIdsByState.VERIFIED_ORDERABLE.slice(),
    procurementReady: !partial,
    openProcurementRequirementCodes: [...openCodes].sort(),

    totalLineItems: totalRowCount,
    orderableLineItems: verifiedOrderableCount,
    excludedLineItems: exclusions.length,
    orderableQuantityByUnit,
    orderableRows,
    exclusions,
    excludedCountByClass,
    partial,
    statement,

    rowIdAudit: auditBomLineIds(items),
    rowIdsByState,
  };
}

/**
 * THE procurement-export gate (ECD §12 gates 18/19). Any orderable export —
 * purchase order, CSV, distributor cart, evidence artifact — MUST be derived
 * from this function. A row that is not VERIFIED_ORDERABLE cannot enter it.
 */
export function orderableProcurementExport(items: PermitBOMItem[]): PermitBOMItem[] {
  return buildProcurementApproval(items).orderableRows;
}

/** The companion artifact ECD §12 gate 19 needs: every NON-orderable row, with
 *  its state and reason, so "visible in review but never in an order export" is
 *  provable rather than asserted. */
export function nonOrderableProcurementExport(items: PermitBOMItem[]): ProcurementExclusion[] {
  return buildProcurementApproval(items).exclusions;
}
