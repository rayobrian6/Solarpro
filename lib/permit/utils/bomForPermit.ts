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
import { buildConductorAuthority } from './conductorAuthority';
import { buildIntegratedEquipment } from './integratedEquipment';

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
  unitCost?: number;
  totalCost?: number;
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

  const stringCount   = system.inverters?.reduce((sum, inv) => sum + (inv.strings?.length || 0), 0) || 1;
  const inverterCount = isMicro ? totalPanels : (system.inverters?.length || 1);
  const deviceCount   = isMicro ? totalPanels : undefined;

  const elec = compliance.electrical;
  const dcWireGauge   = firstStr?.wireGauge || elec?.dcConductorCallout || '#10 AWG';
  // Plain gauge from the authority (e.g. '#8 AWG'), not the raw callout string
  // ('3#8 THWN-2 …') which V4 mis-parsed into an oversized conductor.
  const acWireGauge   = _auth.acFeeder.wireGauge;
  const dcWireLength  = firstStr?.wireLength || project.wireLength || 50;
  const acWireLength  = project.wireLength || 60;
  const conduitType   = (project.conduitType || 'EMT').toUpperCase() as 'EMT' | 'PVC' | 'RMC' | 'LFMC';
  const conduitSize   = project.conduitSize || '3/4';

  // ── 3. Structural ─────────────────────────────────────────
  const bomSystemType = cadTypeToBOMType(cad.systemType);
  const structInput   = extractStructuralInputFromCAD(bomSystemType, totalPanels, cad);
  const structResult  = deriveStructuralBOM(structInput);
  const structItems   = structResult.items.map((item, idx) =>
    structuralToPermit(item, idx),
  );
  log.push(`[bomForPermit] structural: ${structItems.length} items (${bomSystemType})`);

  // ── 4. V4 BOM (electrical) ───────────────────────────────
  let v4Items: PermitBOMItem[] = [];

  if (inverterId) {
    try {
      const v4Input: BOMGenerationInputV4 = {
        inverterId,
        panelId,
        rackingId:           project.rackingId,
        batteryId:           project.batteryId,
        moduleCount:         totalPanels,
        deviceCount,
        stringCount,
        inverterCount,
        systemKw:            totalDcKw,
        acOutputKw:          totalAcKw > 0 ? totalAcKw : undefined,
        dcWireGauge,
        acWireGauge,
        dcWireLength,
        acWireLength,
        conduitType,
        conduitSizeInch:     conduitSize,
        roofType:            project.roofType || 'shingle',
        attachmentCount:     project.attachmentCount || Math.ceil(totalPanels * 1.2),
        railSections:        project.railSections   || Math.ceil(totalPanels / 2),
        mainPanelAmps:       mainPanelA,
        backfeedAmps,
        acOCPD:              backfeedAmps,
        dcOCPD:              necNextStandardOcpd((firstStr?.panelIsc || 10) * 1.25 * 1.25),
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
  const bosPlan = buildIntegratedEquipment(input, cad);
  if (bosPlan.devices.length) {
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