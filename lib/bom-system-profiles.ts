// ============================================================
// BOM System Profiles — System-Type-Aware Structural BOM
// lib/bom-system-profiles.ts
//
// Extracts material rules from EXISTING codebase:
//   - systemEquipmentResolver.ts (SOL_FENCE, GROUND_MOUNT, ROOF_MOUNT racking specs)
//   - fenceCAD.ts (post spacing, rail count, gate openings)
//   - [v47.432] deriveFenceBOM / deriveWiring logic now lives in this file
//             (bom-unified.ts deleted in Stage 8.1 BOM dead-code cleanup)
//   - structural-engine-v4.ts (calcRackingBOM, analyzeGroundMount)
//   - array-geometry.ts (clamp counts, rail lengths)
//   - CAD types (CADFenceModel, CADGroundArray)
//
// Generates structural BOM items for fence/ground systems
// that V4 engine currently does NOT produce.
//
// DOES NOT modify V4 electrical stages — supplements only.
// ============================================================

import type { BOMLineItemV4, BOMStageId, BOMSystemType as BOMSystemTypeShared } from './bom-types-v4';
import { resolveEquipment, resolveDefaultFencePanelSpec } from './systemEquipmentResolver';

// ——— Meters / feet conversion (from cad/geometry.ts) ————————
const METERS_TO_FT = 3.28084;

// ——— System Type ————————————————————————————————————————————
export type BOMSystemType = BOMSystemTypeShared;

// ——— Input: what the caller passes from engineering page ————
export interface StructuralBOMInput {
  systemType: BOMSystemType;
  moduleCount: number;

  // —— Roof (from compliance.structural / array-geometry) ————
  // These are already handled by V4 racking stage when rackingId
  // is provided. Included here for completeness / validation only.
  roof?: {
    rackingId?: string;           // if set, V4 handles it
    mountCount?: number;          // from structural.mountLayout.mountCount
    railQty?: number;             // from structural.rackingBOM.rails.qty
    railLengthFt?: number;        // from structural.rackingBOM.rails.lengthFt
    midClamps?: number;           // from arrayGeometry.totalMidClamps
    endClamps?: number;           // from arrayGeometry.totalEndClamps
    railSplices?: number;         // from structural.rackingBOM.railSplices.qty
    lagBolts?: number;            // mountCount × fastenersPerMount
    flashingKits?: number;        // mountCount (if attachment needs flashing)
    groundLugs?: number;          // ceil(moduleCount / 2)
    bondingClips?: number;        // moduleCount
  };

  // —— Ground (from CADGroundArray / mounting-hardware-db) ————
  ground?: {
    pileCount: number;            // from groundMountAnalysis.pileCount or CAD
    pileSpacingFt: number;        // from CADGroundArray.pileSpacingM * 3.28084
    pileEmbedmentFt: number;      // from CADGroundArray.pileDepthM * 3.28084
    structureType: string;        // from CADGroundArray.structureType
    rowCount: number;             // from CADGroundArray.dimensions.rowCount
    panelsPerRow: number;         // from CADGroundArray.dimensions.panelsPerRow
    arrayWidthFt: number;         // from CADGroundArray.dimensions.arrayWidthM * 3.28084
    railsPerRow: number;          // 2 (standard for ground mount, from array-geometry default)
    groundClearanceFt: number;    // from CADGroundArray.groundClearanceM * 3.28084
  };

  // —— Fence (from CADFenceModel) ————————————————————————————
  fence?: {
    totalPosts: number;           // sum of segments[].posts.length
    postSpacingFt: number;        // from CADFenceModel.postSpacingM * 3.28084
    postEmbedFt: number;          // from CADFenceModel.postEmbedM * 3.28084
    postHeightFt: number;         // from segments[0].posts[0].heightM * 3.28084
    railCount: number;            // from CADFenceModel.railCount
    totalFenceLengthFt: number;   // from CADFenceModel.totalLengthM * 3.28084
    segmentCount: number;         // from CADFenceModel.segments.length
    gateCount: number;            // from CADFenceModel.gateOpenings.length
    gateWidthsFt: number[];       // from CADFenceModel.gateOpenings[].widthM * 3.28084
    solarSectionCount: number;    // from sections.filter(s => s.type === 'solar').length
    vinylSectionCount: number;    // from sections.filter(s => s.type === 'vinyl').length
    panelWidthFt: number;         // from panelWidthM * 3.28084 (CADModel.panelWidthM)
    panelHeightFt: number;        // from CADFenceModel.panelHeightM * 3.28084
  };
}

// ——— Output ——————————————————————————————————————————————————
export interface StructuralBOMResult {
  items: StructuralBOMItem[];
  systemType: BOMSystemType;
  derivationLog: string[];
}

export interface StructuralBOMItem {
  stageId: BOMStageId;
  category: string;
  manufacturer: string;
  model: string;
  partNumber: string;
  description: string;
  quantity: number;
  unit: string;
  derivedFrom: string;
  required: boolean;
}

// ——— MAIN ENTRY ——————————————————————————————————————————————
export function deriveStructuralBOM(input: StructuralBOMInput): StructuralBOMResult {
  const log: string[] = [];

  switch (input.systemType) {
    case 'fence':
      return deriveFenceStructural(input, log);
    case 'ground':
      return deriveGroundStructural(input, log);
    case 'roof':
      // Roof structural is already handled by V4 when rackingId is provided.
      // Return empty — V4 owns roof structural.
      log.push('Roof structural: delegated to V4 racking stage (rackingId)');
      return { items: [], systemType: 'roof', derivationLog: log };
    default:
      log.push(`Unknown systemType: ${input.systemType} — no structural items`);
      return { items: [], systemType: input.systemType, derivationLog: log };
  }
}

// ═══════════════════════════════════════════════════════════════
// FENCE STRUCTURAL BOM
// Sources:
//   - systemEquipmentResolver.ts SOL_FENCE spec:
//       rackingBrand: 'SolFence'
//       rackingModel: 'Vertical Fence Rail System'
//       railMaterial: 'Extruded Aluminum 6063-T6'
//       hardware: 'Stainless Steel Grade 316 fasteners'
//       attachmentType: 'Vertical Fence Post Mount'
//   - CADFenceModel.postSpacingM, postEmbedM, railCount
//   - CADFenceModel.segments[].posts[] (explicit post positions)
//   - CADFenceModel.gateOpenings[]
//   - CADFenceModel.sections[] (solar/gate/vinyl)
//   - v47.432: post/rail/bracket counts derived in buildFenceStructuralBOM() below
//     (legacy pattern from deleted bom-unified.ts deriveFenceBOM())
//   - fenceCAD.ts defaults: 8ft post spacing, 3ft embed, 2 rails
// ═══════════════════════════════════════════════════════════════

function deriveFenceStructural(input: StructuralBOMInput, log: string[]): StructuralBOMResult {
  const f = input.fence;
  if (!f) {
    log.push('No fence data provided — returning empty structural');
    return { items: [], systemType: 'fence', derivationLog: log };
  }

  const items: StructuralBOMItem[] = [];

  // Resolve equipment spec from systemEquipmentResolver.ts SOL_FENCE
  const fenceEquip = resolveEquipment('fence');
  const rack = fenceEquip.racking;
  // rack.rackingBrand = 'SolFence'
  // rack.rackingModel = 'Vertical Fence Rail System'
  // rack.railMaterial = 'Extruded Aluminum 6063-T6'
  // rack.hardware = 'Stainless Steel Grade 316 fasteners'
  // rack.attachmentType = 'Vertical Fence Post Mount'
  // rack.attachmentNote = 'Panels mounted vertically on fence posts, bifacial optimized'

  // —— Posts ——————————————————————————————————————————————————
  // Source: CADFenceModel.segments[].posts[] (counted by fenceCAD solver)
  // v47.432: totalSegmentPosts from CAD segments
  // (legacy pattern from deleted bom-unified.ts deriveFenceBOM() line 480)
  const totalPosts = f.totalPosts;
  log.push(`Posts: ${totalPosts} from CAD segments (${f.segmentCount} segments, ${f.postSpacingFt.toFixed(1)}ft spacing)`);

  items.push(mkItem('structural', 'fence_post', rack.rackingBrand, 'Fence Post (existing or new)',
    'SOLFENCE-POST',
    `Fence post — ${f.postHeightFt.toFixed(1)}ft height, ${f.postSpacingFt.toFixed(1)}ft O.C. — SolFence clamp-mount (no drilling)`,
    totalPosts, 'ea',
    `CAD: ${f.segmentCount} segments × posts at ${f.postSpacingFt.toFixed(1)}ft spacing`,
    true));

  // NOTE: SolFence system uses clamp-to-post attachment — NO concrete footings.
  // systemEquipmentResolver.ts SOL_FENCE attachment card:
  //   "Clamps to existing or new fence posts, no drilling"
  // Posts are existing infrastructure or provided separately — not part of SolFence racking BOM.

  // —— Rails ——————————————————————————————————————————————————
  // Source: CADFenceModel.railCount (from fenceCAD.ts, default: 2)
  // Length: total fence length × railCount
  // v47.432: totalRailLengthFt = seg.lengthM * METERS_TO_FT * railCount
  // (legacy pattern from deleted bom-unified.ts deriveFenceBOM() line 493)
  // Material: systemEquipmentResolver.ts SOL_FENCE.racking.railMaterial = 'Extruded Aluminum 6063-T6'
  const totalRailLengthFt = f.totalFenceLengthFt * f.railCount;
  // Standard rail sections: 10ft lengths (industry standard)
  const railSectionsFt = 10;
  const totalRailSections = Math.ceil(totalRailLengthFt / railSectionsFt);
  log.push(`Rails: ${f.railCount} rails × ${f.totalFenceLengthFt.toFixed(1)}ft = ${totalRailLengthFt.toFixed(1)} lf total (${totalRailSections} × ${railSectionsFt}ft sections)`);

  items.push(mkItem('structural', 'fence_rail', rack.rackingBrand, `${rack.rackingModel} Rail (${railSectionsFt}ft)`,
    'SOLFENCE-RAIL-10FT',
    `Horizontal fence rail — ${rack.railMaterial}, ${f.railCount} rails × ${f.totalFenceLengthFt.toFixed(1)}ft fence length`,
    totalRailSections, 'ea',
    `CAD: ${f.railCount} railCount × ${f.totalFenceLengthFt.toFixed(1)}ft ÷ ${railSectionsFt}ft sections`,
    true));

  // —— Panel Mounting Clamps ——————————————————————————————————
  // Source: systemEquipmentResolver.ts SOL_FENCE attachment card:
  //   'SolFence vertical rail clamp system' — 'Clamps to existing or new fence posts, no drilling'
  // v47.432: same clamp pattern as roof arrays
  // (legacy pattern from deleted bom-unified.ts deriveFenceBOM())
  //   mid clamps between adjacent panels, end clamps at row edges
  // Standard: 4 clamps per panel (2 top + 2 bottom on 2-rail system)
  const clampsPerPanel = 4;
  const totalClamps = input.moduleCount * clampsPerPanel;
  log.push(`Panel clamps: ${clampsPerPanel} per panel × ${input.moduleCount} panels = ${totalClamps}`);

  items.push(mkItem('structural', 'panel_clamp', rack.rackingBrand, `${rack.rackingModel} Panel Clamp`,
    'SOLFENCE-CLAMP',
    `Panel-to-rail clamp — ${rack.hardware}, ${rack.attachmentNote}`,
    totalClamps, 'ea',
    `${clampsPerPanel} clamps/panel × ${input.moduleCount} modules`,
    true));

  // —— Rail Brackets (rail-to-post connections) ————————————————
  // v47.432: bracket count = 2 x posts x railCount
  // (legacy pattern from deleted bom-unified.ts deriveFenceBOM() line 519-521)
  // 2 brackets per rail-to-post junction
  const railToPostConnections = totalPosts * f.railCount;
  const railBrackets = railToPostConnections * 2;
  log.push(`Rail brackets: 2 per connection × ${totalPosts} posts × ${f.railCount} rails = ${railBrackets}`);

  items.push(mkItem('structural', 'rail_bracket', rack.rackingBrand, `${rack.rackingModel} Rail Bracket`,
    'SOLFENCE-RAIL-BRACKET',
    `Rail-to-post connection bracket — ${rack.hardware}, 2 per junction × ${f.railCount} rails × ${totalPosts} posts`,
    railBrackets, 'ea',
    `v47.432-bsp: 2 x ${totalPosts} posts x ${f.railCount} rails`,
    true));

  // —— Post Caps ——————————————————————————————————————————————
  // v47.432: 1 cap per post
  // (legacy pattern from deleted bom-unified.ts deriveFenceBOM() line 513-514)
  const postCaps = totalPosts;
  log.push(`Post caps: ${postCaps} (1 per post)`);

  items.push(mkItem('structural', 'post_cap', rack.rackingBrand, `${rack.rackingModel} Post Cap`,
    'SOLFENCE-POST-CAP',
    `Post cap — 1 per post (weather protection, ${rack.railMaterial})`,
    postCaps, 'ea',
    `v47.432-bsp: 1 per post x ${totalPosts} posts`,
    true));

  // —— Gate Hardware ———————————————————————————————————————————
  // Source: CADFenceModel.gateOpenings[] (from fenceCAD gate placement)
  // v47.432: 2 heavy-duty posts per gate
  // (legacy pattern from deleted bom-unified.ts deriveFenceBOM() line 480)
  if (f.gateCount > 0) {
    const gatePostCount = f.gateCount * 2;
    log.push(`Gate posts: ${gatePostCount} (2 per gate × ${f.gateCount} gates)`);

    items.push(mkItem('structural', 'gate_post', rack.rackingBrand, 'Gate Post (Heavy Duty)',
      'SOLFENCE-GATE-POST',
      `Heavy-duty gate post — 2 per gate opening (${rack.hardware})`,
      gatePostCount, 'ea',
      `CAD: 2 × ${f.gateCount} gate openings`,
      true));

    // Gate kit: 1 per gate (hinges + latch + closer)
    items.push(mkItem('structural', 'gate_hardware', rack.rackingBrand, 'Gate Hardware Kit',
      'SOLFENCE-GATE-KIT',
      `Gate hardware kit (hinges, latch, closer) — ${f.gateWidthsFt.map(w => w.toFixed(1) + 'ft').join(', ')} opening(s)`,
      f.gateCount, 'kit',
      `CAD: ${f.gateCount} gate openings`,
      true));
  }

  // —— Vinyl Panels (non-solar sections) ——————————————————————
  // Source: CADFenceModel.sections[] filtered by type === 'vinyl'
  // v47.432: legacy pattern from deleted bom-unified.ts deriveFenceBOM() line 500
  if (f.vinylSectionCount > 0) {
    log.push(`Vinyl panels: ${f.vinylSectionCount} sections`);

    items.push(mkItem('structural', 'vinyl_panel', 'SolFence', 'Vinyl Fence Panel',
      'SOLFENCE-VINYL-PANEL',
      `Vinyl privacy panel for non-solar fence sections`,
      f.vinylSectionCount, 'ea',
      `CAD: ${f.vinylSectionCount} vinyl sections`,
      false));
  }

  // —— Grounding ——————————————————————————————————————————————
  // Fence-specific grounding: ground rod + ground wire along fence line
  // NEC 250.52 — ground electrode system
  // Ground rods: 1 per 200ft of fence (minimum 1)
  const groundRodCount = Math.max(1, Math.ceil(f.totalFenceLengthFt / 200));
  log.push(`Ground rods: ${groundRodCount} (1 per 200ft, ${f.totalFenceLengthFt.toFixed(0)}ft fence)`);

  items.push(mkItem('structural', 'ground_rod', 'Southwire', '8ft Ground Rod (5/8")',
    'GND-ROD-8FT',
    `Grounding electrode — NEC 250.52, 1 per 200ft of fence`,
    groundRodCount, 'ea',
    `NEC 250.52: ceil(${f.totalFenceLengthFt.toFixed(0)}ft / 200)`,
    true));

  // Ground wire: #6 AWG bare copper along fence line + 10ft per ground rod
  const groundWireFt = Math.ceil(f.totalFenceLengthFt + groundRodCount * 10);
  items.push(mkItem('structural', 'ground_wire', 'Southwire', '#6 AWG Bare Copper Ground',
    'GND-6AWG-BARE',
    `Equipment grounding conductor — fence line + ground rod connections`,
    groundWireFt, 'ft',
    `Fence length ${f.totalFenceLengthFt.toFixed(0)}ft + ${groundRodCount} rods × 10ft`,
    true));

  // Ground clamps: 1 per ground rod
  items.push(mkItem('structural', 'ground_clamp', 'Burndy', 'Ground Rod Clamp',
    'GND-CLAMP',
    `Ground rod clamp — 1 per ground rod`,
    groundRodCount, 'ea',
    `1 per ground rod × ${groundRodCount}`,
    true));

  return { items, systemType: 'fence', derivationLog: log };
}

// ═══════════════════════════════════════════════════════════════
// GROUND MOUNT STRUCTURAL BOM
// Sources:
//   - systemEquipmentResolver.ts GROUND_MOUNT spec:
//       rackingBrand: 'Unirac'
//       rackingModel: 'RM10 Ground Mount System'
//       railMaterial: 'Hot-Dip Galvanized Steel'
//       hardware: 'Stainless Steel Grade 316 fasteners'
//       attachmentType: 'Driven Pier / Helical Anchor'
//   - CADGroundArray.pileSpacingM, pileDepthM, structureType
//   - structural-engine-v4.ts: analyzeGroundMount() pile calc
//   - array-geometry.ts: mid/end clamps, rail lengths
// ═══════════════════════════════════════════════════════════════

function deriveGroundStructural(input: StructuralBOMInput, log: string[]): StructuralBOMResult {
  const g = input.ground;
  if (!g) {
    log.push('No ground data provided — returning empty structural');
    return { items: [], systemType: 'ground', derivationLog: log };
  }

  const items: StructuralBOMItem[] = [];

  // Resolve equipment spec from systemEquipmentResolver.ts GROUND_MOUNT
  const groundEquip = resolveEquipment('ground');
  const rack = groundEquip.racking;
  // rack.rackingBrand = 'Unirac'
  // rack.rackingModel = 'RM10 Ground Mount System'
  // rack.railMaterial = 'Hot-Dip Galvanized Steel'
  // rack.hardware = 'Stainless Steel Grade 316 fasteners'
  // rack.attachmentType = 'Driven Pier / Helical Anchor'

  // —— Piles / Posts ———————————————————————————————————————————
  // Source: groundMountAnalysis.pileCount (structural-engine-v4.ts line 675-677)
  // Calculation: pilesPerRow = ceil(arrayWidth / pileSpacing) + 1, × 2 rows
  log.push(`Piles: ${g.pileCount} (${g.structureType}, ${g.pileSpacingFt.toFixed(1)}ft spacing, ${g.pileEmbedmentFt.toFixed(1)}ft embed)`);

  const pileLabel = g.structureType === 'helical_pile' ? 'Helical Anchor' : 'Driven Pier';
  items.push(mkItem('structural', 'pile', rack.rackingBrand,
    `${rack.rackingModel} ${pileLabel}`,
    g.structureType === 'helical_pile' ? 'UNIRAC-RM10-HELICAL' : 'UNIRAC-RM10-DRIVEN',
    `${rack.attachmentType} — ${g.pileSpacingFt.toFixed(1)}ft spacing, ${g.pileEmbedmentFt.toFixed(1)}ft embedment (${rack.railMaterial})`,
    g.pileCount, 'ea',
    `structural-engine: pilesPerRow × 2 rows (${g.pileSpacingFt.toFixed(1)}ft spacing)`,
    true));

  // —— Cross Beams ————————————————————————————————————————————
  // v47.432: 1 beam per post position
  // (legacy pattern from deleted bom-unified.ts deriveGroundBOM())
  // mounting-hardware-db.ts ground mount specs
  const pilesPerRow = Math.ceil(g.pileCount / 2);
  log.push(`Cross beams: ${pilesPerRow} (1 per pile pair)`);

  items.push(mkItem('structural', 'beam', rack.rackingBrand, `${rack.rackingModel} Cross Beam`,
    'UNIRAC-RM10-BEAM',
    `Cross beam connecting front/back piles — 1 per pile pair (${rack.railMaterial})`,
    pilesPerRow, 'ea',
    `pileCount / 2 = ${pilesPerRow}`,
    true));

  // —— Rails / Purlins ————————————————————————————————————————
  // v47.432: railsPerRow x rowCount, length = array width
  // (legacy pattern from deleted bom-unified.ts deriveGroundBOM())
  // array-geometry.ts: 2 rails per row standard
  const totalRails = g.railsPerRow * g.rowCount;
  const railLengthFt = g.arrayWidthFt;
  const railSectionFt = 14;  // standard rail section length (from array-geometry.ts line 789: spliceIntervalIn/12)
  const railSectionsPerRun = Math.ceil(railLengthFt / railSectionFt);
  const totalRailSections = railSectionsPerRun * totalRails;
  log.push(`Rails: ${totalRails} rails × ${railLengthFt.toFixed(1)}ft = ${totalRailSections} sections`);

  items.push(mkItem('structural', 'rail', rack.rackingBrand, `${rack.rackingModel} Rail (${railSectionFt}ft)`,
    'UNIRAC-RM10-RAIL',
    `Ground mount rail — ${rack.railMaterial}, ${g.railsPerRow} per row × ${g.rowCount} rows, ${railLengthFt.toFixed(1)}ft each`,
    totalRailSections, 'ea',
    `array-geometry: ${g.railsPerRow} railsPerRow × ${g.rowCount} rows ÷ ${railSectionFt}ft sections`,
    true));

  // —— Rail Splices ————————————————————————————————————————————
  // Source: structural-engine-v4.ts calcRackingBOM line 799
  // splicesPerRail = max(0, railSectionsPerRun - 1)
  const splicesPerRail = Math.max(0, railSectionsPerRun - 1);
  const totalSplices = splicesPerRail * totalRails;
  log.push(`Rail splices: ${totalSplices} (${splicesPerRail} per rail × ${totalRails} rails)`);

  items.push(mkItem('structural', 'rail_splice', rack.rackingBrand, `${rack.rackingModel} Rail Splice`,
    'UNIRAC-RM10-SPLICE',
    `Rail splice — connects ${railSectionFt}ft rail sections (${rack.hardware})`,
    totalSplices, 'ea',
    `structural-engine: max(0, ${railSectionsPerRun}-1) × ${totalRails} rails`,
    true));

  // —— Mid Clamps ——————————————————————————————————————————————
  // Source: array-geometry.ts line 128-130
  // midClampsPerRail = max(0, panelsPerRow - 1)
  // v47.432: same pattern as roof BOM clamp derivation
  // (legacy pattern from deleted bom-unified.ts deriveRoofBOM())
  const midClampsPerRail = Math.max(0, g.panelsPerRow - 1);
  const totalMidClamps = midClampsPerRail * totalRails;
  log.push(`Mid clamps: ${totalMidClamps} (${midClampsPerRail}/rail × ${totalRails} rails)`);

  items.push(mkItem('structural', 'mid_clamp', rack.rackingBrand, `${rack.rackingModel} Mid Clamp`,
    'UNIRAC-RM10-MIDCLAMP',
    `Mid clamp — 1 per panel junction per rail (${rack.hardware})`,
    totalMidClamps, 'ea',
    `array-geometry: (panelsPerRow-1) × railsPerRow × rowCount`,
    true));

  // —— End Clamps ——————————————————————————————————————————————
  // Source: array-geometry.ts line 129
  // endClampsPerRail = 2
  const totalEndClamps = 2 * totalRails;
  log.push(`End clamps: ${totalEndClamps} (2/rail × ${totalRails} rails)`);

  items.push(mkItem('structural', 'end_clamp', rack.rackingBrand, `${rack.rackingModel} End Clamp`,
    'UNIRAC-RM10-ENDCLAMP',
    `End clamp — 2 per rail (left + right) (${rack.hardware})`,
    totalEndClamps, 'ea',
    `array-geometry: 2 × ${totalRails} rails`,
    true));

  // —— Ground Lugs ————————————————————————————————————————————
  // Source: structural-engine-v4.ts line 817: ceil(totalPanels / 2)
  const groundLugs = Math.ceil(input.moduleCount / 2);
  log.push(`Ground lugs: ${groundLugs} (NEC 690.47, 1 per 2 panels)`);

  items.push(mkItem('structural', 'ground_lug', 'Burndy', 'Ground Lug',
    'GNDMNT-GNDLUG',
    `Equipment grounding lug — NEC 690.47`,
    groundLugs, 'ea',
    `structural-engine: ceil(${input.moduleCount} / 2)`,
    true));

  // —— Bonding Clips ——————————————————————————————————————————
  // Source: structural-engine-v4.ts line 827: totalPanels
  log.push(`Bonding clips: ${input.moduleCount} (UL 2703, 1 per panel)`);

  items.push(mkItem('structural', 'bonding_clip', rack.rackingBrand, `${rack.rackingModel} Bonding Clip`,
    'UNIRAC-RM10-BOND',
    `Bonding clip — UL 2703, 1 per panel`,
    input.moduleCount, 'ea',
    `structural-engine: 1 per module`,
    true));

  // —— Grounding ——————————————————————————————————————————————
  // Ground rod + ground wire (same as V4 structural stage)
  const groundRodCount = Math.max(1, Math.ceil(g.arrayWidthFt / 100));
  log.push(`Ground rods: ${groundRodCount}`);

  items.push(mkItem('structural', 'ground_rod', 'Southwire', '8ft Ground Rod (5/8")',
    'GND-ROD-8FT',
    `Grounding electrode — NEC 250.52`,
    groundRodCount, 'ea',
    `NEC 250.52: ceil(${g.arrayWidthFt.toFixed(0)}ft / 100)`,
    true));

  return { items, systemType: 'ground', derivationLog: log };
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Extract StructuralBOMInput from CAD model
// This reads existing CAD data — no new assumptions.
// ═══════════════════════════════════════════════════════════════

export function extractStructuralInputFromCAD(
  systemType: BOMSystemType,
  moduleCount: number,
  cadModel?: any,         // CADModel from generateCADLayout
  structuralResult?: any, // StructuralResultV4 from runStructuralCalcV4
): StructuralBOMInput {

  const input: StructuralBOMInput = { systemType, moduleCount };

  if (systemType === 'fence' && cadModel?.fence) {
    const fence = cadModel.fence;
    const segments = fence.segments || [];
    const sections = fence.sections || [];
    const gateOpenings = fence.gateOpenings || [];

    let totalPosts = 0;
    for (const seg of segments) {
      totalPosts += (seg.posts || []).length;
    }

    const firstPost = segments[0]?.posts?.[0];

    input.fence = {
      totalPosts,
      postSpacingFt:       (fence.postSpacingM || 2.4384) * METERS_TO_FT,  // default 8ft from fenceCAD.ts
      postEmbedFt:         (fence.postEmbedM || 0.9144) * METERS_TO_FT,    // default 3ft from fenceCAD.ts
      postHeightFt:        (firstPost?.heightM || fence.panelHeightM || 1.8288) * METERS_TO_FT,
      railCount:           fence.railCount || 2,                            // default from fenceCAD.ts
      totalFenceLengthFt:  (fence.totalLengthM || 0) * METERS_TO_FT,
      segmentCount:        segments.length,
      gateCount:           gateOpenings.length,
      gateWidthsFt:        gateOpenings.map((g: any) => (g.widthM || 1.2) * METERS_TO_FT),
      solarSectionCount:   sections.filter((s: any) => s.type === 'solar').length,
      vinylSectionCount:   sections.filter((s: any) => s.type === 'vinyl').length,
      panelWidthFt:        (cadModel.panelWidthM || 1.016) * METERS_TO_FT,
      panelHeightFt:       (fence.panelHeightM || cadModel.panelHeightM || 1.676) * METERS_TO_FT,
    };
  }

  if (systemType === 'ground' && cadModel?.ground) {
    const ground = cadModel.ground;
    const firstArray = ground.arrays?.[0];

    if (firstArray) {
      // Pile count: from structural engine if available, else compute from CAD
      const pileSpacingFt = (firstArray.pileSpacingM || 2.4384) * METERS_TO_FT;
      const arrayWidthFt = (firstArray.dimensions?.arrayWidthM || 10) * METERS_TO_FT;
      const pilesPerRow = Math.ceil(arrayWidthFt / pileSpacingFt) + 1;
      const pileCount = structuralResult?.groundMountAnalysis?.pileCount
        || pilesPerRow * 2;  // front + back rows (structural-engine-v4.ts line 677)

      input.ground = {
        pileCount,
        pileSpacingFt,
        pileEmbedmentFt:   structuralResult?.groundMountAnalysis?.pileEmbedmentFt
                           || (firstArray.pileDepthM || 1.524) * METERS_TO_FT,
        structureType:     firstArray.structureType || 'driven_pile',
        rowCount:          firstArray.dimensions?.rowCount || 1,
        panelsPerRow:      firstArray.dimensions?.panelsPerRow || moduleCount,
        arrayWidthFt,
        railsPerRow:       2,  // from array-geometry.ts default
        groundClearanceFt: (firstArray.groundClearanceM || 0.6096) * METERS_TO_FT,
      };
    }
  }

  if (systemType === 'roof') {
    // Roof structural handled by V4 — just pass through any existing data
    if (structuralResult?.rackingBOM) {
      const rb = structuralResult.rackingBOM;
      input.roof = {
        rackingId:    structuralResult.mountingSystem?.id,
        mountCount:   rb.mounts?.qty,
        railQty:      rb.rails?.qty,
        railLengthFt: rb.rails?.lengthFt,
        midClamps:    rb.midClamps?.qty,
        endClamps:    rb.endClamps?.qty,
        railSplices:  rb.railSplices?.qty,
        lagBolts:     rb.lagBolts?.qty,
        flashingKits: rb.flashingKits?.qty,
        groundLugs:   rb.groundLugs?.qty,
        bondingClips: rb.bondingClips?.qty,
      };
    }
  }

  return input;
}

// ——— Item builder ————————————————————————————————————————————
function mkItem(
  stageId: BOMStageId,
  category: string,
  manufacturer: string,
  model: string,
  partNumber: string,
  description: string,
  quantity: number,
  unit: string,
  derivedFrom: string,
  required: boolean,
): StructuralBOMItem {
  return { stageId, category, manufacturer, model, partNumber, description, quantity, unit, derivedFrom, required };
}