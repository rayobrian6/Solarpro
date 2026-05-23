import type { SurveyEvidenceCategory } from './categoryRegistry';

export type FieldEvidenceGroupId =
  | 'utility'
  | 'electrical'
  | 'roof'
  | 'structural'
  | 'routing'
  | 'detached_structures'
  | 'ess_battery'
  | 'ground_mount_trench';

export type FieldEvidenceMovementZone =
  | 'exterior_arrival'
  | 'utility_service_area'
  | 'main_service_equipment'
  | 'routing_path'
  | 'attic_structural_area'
  | 'roof_area'
  | 'detached_structure_area'
  | 'ess_mounting_area'
  | 'ground_mount_trench_area';

export type FieldEvidenceCapturePriority = 'required' | 'conditional' | 'optional';

export interface FieldEvidenceCaptureItem {
  captureId: string;
  label: string;
  description: string;
  priority: FieldEvidenceCapturePriority;
  canonicalCategory: SurveyEvidenceCategory;
  geometryTraceability: string[];
  engineeringUsage: string[];
  cadReadinessSignals: string[];
  deterministicNotes: string[];
}

export interface FieldEvidenceOrchestrationStep {
  stepId: string;
  sequence: number;
  movementZone: FieldEvidenceMovementZone;
  groupId: FieldEvidenceGroupId;
  label: string;
  technicianInstruction: string;
  captureItems: FieldEvidenceCaptureItem[];
  minimizesBacktrackingBecause: string;
  completionSignals: string[];
}

export interface FieldEvidenceOrchestrationGroup {
  groupId: FieldEvidenceGroupId;
  label: string;
  description: string;
  canonicalCategories: SurveyEvidenceCategory[];
  captureItems: FieldEvidenceCaptureItem[];
  deterministicNotes: string[];
}

export interface FieldEvidenceOrchestrationModel {
  modelVersion: 'field_evidence_orchestration_v1';
  movementLogic: 'technician_movement_order';
  steps: FieldEvidenceOrchestrationStep[];
  groups: FieldEvidenceOrchestrationGroup[];
  canonicalCategoryOrder: SurveyEvidenceCategory[];
  prohibitedRuntimeBehavior: string[];
  deterministicNotes: string[];
}

const item = (
  captureId: string,
  label: string,
  canonicalCategory: SurveyEvidenceCategory,
  priority: FieldEvidenceCapturePriority,
  description: string,
  geometryTraceability: string[],
  engineeringUsage: string[],
  cadReadinessSignals: string[],
): FieldEvidenceCaptureItem => ({
  captureId,
  label,
  canonicalCategory,
  priority,
  description,
  geometryTraceability,
  engineeringUsage,
  cadReadinessSignals,
  deterministicNotes: [
    'Capture item is a deterministic survey workflow requirement and does not inspect image bytes.',
    'Category satisfaction is evaluated only from canonical evidence manifest metadata and explicit survey fields.',
  ],
});

const STEPS: FieldEvidenceOrchestrationStep[] = [
  {
    stepId: '01_exterior_overview',
    sequence: 10,
    movementZone: 'exterior_arrival',
    groupId: 'utility',
    label: 'Exterior overview and site context',
    technicianInstruction: 'Start outside with a wide exterior overview before moving to equipment. Capture site access, structure context, and general obstacles while still at arrival position.',
    captureItems: [
      item('overview.site_exterior', 'Exterior site overview', 'overview', 'required', 'Wide exterior photo showing structure, access, and site context.', ['structure relationship', 'site access orientation'], ['site plan', 'permit validation'], ['detached-structure-ready', 'routing-ready']),
      item('utility.access_path', 'Utility access path', 'utility_access', 'conditional', 'Utility access path or working clearance context where visible from exterior approach.', ['utility service approach'], ['interconnection', 'site plan'], ['routing-ready']),
    ],
    minimizesBacktrackingBecause: 'The technician records site context before narrowing into utility and electrical details, preventing a later return to the arrival position.',
    completionSignals: ['overview category present', 'utility access captured when applicable'],
  },
  {
    stepId: '02_utility_service',
    sequence: 20,
    movementZone: 'utility_service_area',
    groupId: 'utility',
    label: 'Utility meter, socket, bill, and interconnection context',
    technicianInstruction: 'Move directly to the utility meter/service area. Capture meter, socket, labeling, service entrance, and bill/interconnection context when available.',
    captureItems: [
      item('utility.meter', 'Utility meter', 'meter', 'required', 'Utility meter or meter socket evidence.', ['meter location', 'service point'], ['interconnection', 'electrical design'], ['routing-ready']),
      item('utility.connection', 'Utility connection / service entrance', 'utility_connection', 'conditional', 'Overhead/underground service entrance and interconnection context.', ['service entrance path'], ['interconnection', 'SLD context'], ['routing-ready']),
      item('utility.labeling', 'Utility labeling / service labels', 'utility_access', 'conditional', 'Utility labels, access markings, or service approach notes.', ['service labeling context'], ['permit validation'], ['routing-ready']),
    ],
    minimizesBacktrackingBecause: 'Utility service evidence is adjacent to exterior access and should be captured before entering the MSP area.',
    completionSignals: ['meter category present', 'utility connection captured when visible'],
  },
  {
    stepId: '03_main_service_equipment',
    sequence: 30,
    movementZone: 'main_service_equipment',
    groupId: 'electrical',
    label: 'MSP, breakers, bus labels, disconnects, grounding, subpanels',
    technicianInstruction: 'Move from meter/service to MSP and nearby electrical equipment. Capture overview, interior, labels, breakers, grounding, disconnects, subpanels, rapid shutdown, placards, and inverter mounting wall.',
    captureItems: [
      item('electrical.msp_overview', 'MSP overview', 'main_service_panel', 'required', 'Closed/overview main service panel evidence.', ['equipment location'], ['electrical design', 'permit validation'], ['routing-ready']),
      item('electrical.msp_interior', 'MSP interior / bus / breaker context', 'main_service_panel', 'required', 'Open panel interior, main breaker, bus rating label, and panel schedule context where safely accessible.', ['breaker sizing lineage'], ['SLD', 'BOM', 'interconnection'], ['routing-ready']),
      item('electrical.disconnects', 'Disconnects and rapid shutdown', 'disconnect', 'conditional', 'AC/DC disconnects, rapid shutdown, and placard locations.', ['shutdown equipment locations'], ['electrical design', 'permit validation'], ['routing-ready']),
      item('electrical.grounding', 'Grounding and bonding', 'grounding', 'conditional', 'Grounding electrode conductor, bonding, or grounding context.', ['grounding route'], ['electrical design'], ['routing-ready']),
      item('electrical.subpanels', 'Subpanels', 'subpanel', 'conditional', 'Subpanel or downstream distribution equipment when present.', ['subpanel relationship'], ['electrical design'], ['routing-ready']),
      item('electrical.inverter_wall', 'Inverter mounting wall', 'inverter_location', 'conditional', 'Potential inverter wall or equipment mounting location.', ['equipment mounting area'], ['layout coordination'], ['routing-ready']),
    ],
    minimizesBacktrackingBecause: 'All electrical details near MSP are captured in one pass before tracing conduit routes away from the service area.',
    completionSignals: ['main_service_panel category present', 'disconnect/subpanel/grounding captured when applicable'],
  },
  {
    stepId: '04_routing_path',
    sequence: 40,
    movementZone: 'routing_path',
    groupId: 'routing',
    label: 'Conduit, attic/exterior routing, penetrations, garage transitions',
    technicianInstruction: 'Trace likely conduit route from service equipment toward array/battery/attic transition points. Capture exterior routing, wall penetrations, garage transitions, attic routing, and obstructions.',
    captureItems: [
      item('routing.exterior_path', 'Exterior conduit path', 'utility_connection', 'conditional', 'Exterior conduit route context and obstructions.', ['route path continuity'], ['routing', 'SLD'], ['routing-ready']),
      item('routing.wall_penetration', 'Wall penetrations / transitions', 'garage_interior_wall', 'conditional', 'Wall penetration, garage transition, or interior/exterior crossing context.', ['penetration point'], ['routing', 'site plan'], ['routing-ready']),
      item('routing.trench_preview', 'Trench preview if route leaves structure', 'trench_path', 'conditional', 'Ground/trench path preview when underground routing is expected.', ['underground route continuity'], ['site plan', 'trench planning'], ['trench-route-ready']),
    ],
    minimizesBacktrackingBecause: 'Routing is captured as a continuous walk away from MSP toward attic, roof, detached structures, or trench targets.',
    completionSignals: ['route categories present when route is non-trivial'],
  },
  {
    stepId: '05_attic_structural',
    sequence: 50,
    movementZone: 'attic_structural_area',
    groupId: 'structural',
    label: 'Attic access, framing, rafters/trusses, structural anomalies',
    technicianInstruction: 'Enter attic or structural access next, before roof movement. Capture access, framing, rafters/trusses, spacing, attachment zones, anomalies, water damage, and detached framing if applicable.',
    captureItems: [
      item('structural.attic_access', 'Attic access', 'attic_access', 'conditional', 'Attic access opening and accessibility context.', ['access point'], ['structural review'], ['roof-plane-ready']),
      item('structural.attic_framing', 'Attic framing / rafters / trusses', 'rafters', 'conditional', 'Framing members, spacing, and attachment-zone evidence.', ['framing orientation', 'attachment zones'], ['structural review'], ['roof-plane-ready']),
      item('structural.attic_context', 'Attic structural context', 'attic', 'conditional', 'General attic context, anomalies, load-bearing concerns, or water damage.', ['structural condition context'], ['structural review'], ['roof-plane-ready']),
    ],
    minimizesBacktrackingBecause: 'Attic capture happens before roof capture so framing context can be referenced while roof planes are documented.',
    completionSignals: ['attic/rafters captured when accessible', 'notes remain explicit when inaccessible'],
  },
  {
    stepId: '06_roof_planes_and_obstructions',
    sequence: 60,
    movementZone: 'roof_area',
    groupId: 'roof',
    label: 'Roof planes, ridges, valleys, hips, eaves, obstructions, material',
    technicianInstruction: 'Move to roof or roof vantage points. Capture each roof plane, ridge lines, valleys, hips, eaves, roof surface/material, obstructions, vents, chimneys, skylights, and setbacks.',
    captureItems: [
      item('roof.full_overview', 'Full roof overview / roof plane', 'roof_plane', 'required', 'Full roof overview and each usable roof plane.', ['roof plane identity', 'usable plane context'], ['roof layout', 'permit validation'], ['roof-plane-ready']),
      item('roof.edges', 'Eaves, rakes, and roof edges', 'roof_edge', 'conditional', 'Roof edges and setback-sensitive boundaries.', ['setback boundaries'], ['roof layout'], ['setback-ready']),
      item('roof.ridge_lines', 'Ridges / hips / valleys', 'ridge', 'conditional', 'Ridges, hips, valleys, and roof transitions.', ['ridge/valley topology'], ['roof layout'], ['roof-plane-ready', 'setback-ready']),
      item('roof.obstructions', 'Obstructions: vents/chimneys/skylights', 'obstructions', 'conditional', 'All roof obstruction context.', ['obstruction location context'], ['roof layout'], ['setback-ready']),
      item('roof.surface_material', 'Roof texture/material', 'roof_surface', 'conditional', 'Close-up roof material and condition.', ['surface/material context'], ['structural review', 'mounting'], ['roof-plane-ready']),
    ],
    minimizesBacktrackingBecause: 'Roof geometry and obstruction evidence is captured as a single roof movement pass after electrical/routing/attic context is known.',
    completionSignals: ['roof_plane category present', 'edge/ridge/obstruction categories captured when applicable'],
  },
  {
    stepId: '07_detached_structures',
    sequence: 70,
    movementZone: 'detached_structure_area',
    groupId: 'detached_structures',
    label: 'Detached garage, shed, barn, secondary roof structures',
    technicianInstruction: 'If detached structures exist, move to them after primary roof pass. Capture detached garage/shed/barn, secondary roof structures, relationships, distances, and framing access when available.',
    captureItems: [
      item('detached.structure_context', 'Detached structure context', 'detached_structures', 'conditional', 'Detached garage, shed, barn, secondary roof, structure relationships and distance context.', ['structure relationship', 'distance context'], ['site plan', 'layout coordination'], ['detached-structure-ready']),
    ],
    minimizesBacktrackingBecause: 'Detached structures are visited after the primary roof/electrical path so the technician can leave the main structure once.',
    completionSignals: ['detached structure category captured when present'],
  },
  {
    stepId: '08_ess_battery',
    sequence: 80,
    movementZone: 'ess_mounting_area',
    groupId: 'ess_battery',
    label: 'Battery, gateway, backup loads, clearances',
    technicianInstruction: 'Capture ESS/battery location after electrical/routing context. Document mounting area, wall clearances, ventilation, fire setbacks, gateway placement, and backup loads context.',
    captureItems: [
      item('ess.battery_location', 'Battery location and clearances', 'battery_location', 'conditional', 'Battery mounting area, clearances, ventilation, fire setback context.', ['battery wall clearance'], ['ESS design', 'site plan'], ['routing-ready']),
      item('ess.gateway_location', 'Gateway / controller placement', 'gateway_location', 'conditional', 'Gateway or controller placement context.', ['gateway relationship'], ['ESS design', 'electrical design'], ['routing-ready']),
    ],
    minimizesBacktrackingBecause: 'ESS locations are captured after the service/routing path is known, reducing repeated electrical-area visits.',
    completionSignals: ['battery/gateway category captured when ESS applies'],
  },
  {
    stepId: '09_ground_mount_trench',
    sequence: 90,
    movementZone: 'ground_mount_trench_area',
    groupId: 'ground_mount_trench',
    label: 'Ground mount, trench route, terrain, crossings, gate access',
    technicianInstruction: 'Finish with ground-mount or trench path walk if applicable. Capture trench route, terrain slope, fence/gate crossings, utility crossings, soil conditions, array location, and obstruction context.',
    captureItems: [
      item('ground.trench_route', 'Trench route', 'trench_path', 'conditional', 'Trench route, terrain, crossings, soil, gate access, and underground utility context.', ['trench path continuity', 'terrain context'], ['site plan', 'trench planning'], ['trench-route-ready']),
      item('ground.array_location', 'Ground array / site obstruction context', 'overview', 'conditional', 'Ground mount array location and surrounding obstruction context.', ['ground array area'], ['ground mount layout'], ['trench-route-ready']),
    ],
    minimizesBacktrackingBecause: 'Ground/trench capture happens last because it is farthest from the service/roof workflow and often ends away from the primary structure.',
    completionSignals: ['trench path category captured when trench/ground mount applies'],
  },
];

export function buildFieldEvidenceOrchestrationModel(): FieldEvidenceOrchestrationModel {
  const steps = [...STEPS].sort((a, b) => a.sequence - b.sequence || a.stepId.localeCompare(b.stepId));
  const groupIds = Array.from(new Set(steps.map(step => step.groupId)));
  const groups = groupIds.map(groupId => {
    const groupSteps = steps.filter(step => step.groupId === groupId);
    const captureItems = groupSteps.flatMap(step => step.captureItems);
    return {
      groupId,
      label: labelForGroup(groupId),
      description: descriptionForGroup(groupId),
      canonicalCategories: uniqueSorted(captureItems.map(item => item.canonicalCategory)),
      captureItems: [...captureItems].sort((a, b) => a.captureId.localeCompare(b.captureId)),
      deterministicNotes: [
        'Group is derived from technician movement workflow and canonical evidence category registry.',
        'Group membership is deterministic metadata and does not create fake engineering state.',
      ],
    } satisfies FieldEvidenceOrchestrationGroup;
  }).sort((a, b) => a.label.localeCompare(b.label));

  return {
    modelVersion: 'field_evidence_orchestration_v1',
    movementLogic: 'technician_movement_order',
    steps,
    groups,
    canonicalCategoryOrder: uniqueSorted(steps.flatMap(step => step.captureItems.map(capture => capture.canonicalCategory))),
    prohibitedRuntimeBehavior: [
      'no AI copilot runtime',
      'no OpenCV runtime',
      'no OCR runtime',
      'no YOLO runtime',
      'no semantic inference',
      'no image-byte analysis',
      'no autonomous CAD generation',
      'no autonomous regeneration',
    ],
    deterministicNotes: [
      'Workflow order follows technician movement logic: exterior overview → utility → MSP/electrical → routing → attic/structural → roof planes/obstructions → detached structures → ESS → trench/ground mount.',
      'Photo ordering is not random uploader order; it is an engineering completeness checklist optimized to reduce backtracking.',
      'Future CV/OCR/CAD capabilities may be documented as metadata only and are not activated by this model.',
    ],
  };
}

export function fieldEvidenceStepForCategory(category: SurveyEvidenceCategory): FieldEvidenceOrchestrationStep | null {
  return buildFieldEvidenceOrchestrationModel().steps.find(step => step.captureItems.some(item => item.canonicalCategory === category)) ?? null;
}

function labelForGroup(groupId: FieldEvidenceGroupId): string {
  return {
    utility: 'Utility',
    electrical: 'Electrical',
    roof: 'Roof',
    structural: 'Structural',
    routing: 'Routing',
    detached_structures: 'Detached Structures',
    ess_battery: 'ESS / Battery',
    ground_mount_trench: 'Ground Mount / Trench',
  }[groupId];
}

function descriptionForGroup(groupId: FieldEvidenceGroupId): string {
  return {
    utility: 'Utility meter, utility bill/context, meter socket, access path, labeling, and interconnection context.',
    electrical: 'MSP overview/interior, breaker, bus label, panel schedule, grounding, disconnects, subpanels, placards, rapid shutdown, inverter wall, and conduit entries/exits.',
    roof: 'Full roof overview, each roof plane, ridges, valleys, hips, eaves, obstructions, vents, chimneys, skylights, setbacks, and roof texture/material.',
    structural: 'Attic framing, rafters, trusses, spacing, attachment zones, load-bearing concerns, anomalies, water damage, and detached structure framing when applicable.',
    routing: 'Conduit path, attic/exterior routing, trench path previews, garage transitions, wall penetrations, and conduit obstructions.',
    detached_structures: 'Detached garage, shed, barn, secondary roof structures, relationships, and distances.',
    ess_battery: 'Battery location, wall clearances, mounting area, ventilation, fire setbacks, gateway placement, and backup loads context.',
    ground_mount_trench: 'Trench route, terrain slope, fence crossings, utility crossings, soil conditions, gate access, array location, and obstruction context.',
  }[groupId];
}

function uniqueSorted<T extends string>(values: T[]): T[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}
