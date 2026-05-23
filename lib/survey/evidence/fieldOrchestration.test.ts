import { describe, expect, it } from 'vitest';
import {
  buildFieldEvidenceOrchestrationModel,
  fieldEvidenceStepForCategory,
} from './fieldOrchestration';

describe('field evidence orchestration', () => {
  it('orders capture steps by technician movement instead of uploaded photo order', () => {
    const model = buildFieldEvidenceOrchestrationModel();

    expect(model.modelVersion).toBe('field_evidence_orchestration_v1');
    expect(model.movementLogic).toBe('technician_movement_order');
    expect(model.steps.map(step => step.stepId)).toEqual([
      '01_exterior_overview',
      '02_utility_service',
      '03_main_service_equipment',
      '04_routing_path',
      '05_attic_structural',
      '06_roof_planes_and_obstructions',
      '07_detached_structures',
      '08_ess_battery',
      '09_ground_mount_trench',
    ]);
    expect(model.steps.map(step => step.sequence)).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90]);
    expect(model.steps.map(step => step.movementZone)).toEqual([
      'exterior_arrival',
      'utility_service_area',
      'main_service_equipment',
      'routing_path',
      'attic_structural_area',
      'roof_area',
      'detached_structure_area',
      'ess_mounting_area',
      'ground_mount_trench_area',
    ]);
  });

  it('covers canonical field evidence groups and readiness-relevant categories', () => {
    const model = buildFieldEvidenceOrchestrationModel();

    expect(model.groups.map(group => group.label).sort((a, b) => a.localeCompare(b))).toEqual([
      'Detached Structures',
      'Electrical',
      'ESS / Battery',
      'Ground Mount / Trench',
      'Roof',
      'Routing',
      'Structural',
      'Utility',
    ]);
    expect(model.canonicalCategoryOrder).toEqual(expect.arrayContaining([
      'overview',
      'meter',
      'utility_connection',
      'main_service_panel',
      'grounding',
      'trench_path',
      'attic_access',
      'rafters',
      'roof_plane',
      'roof_edge',
      'ridge',
      'obstructions',
      'detached_structures',
      'battery_location',
      'gateway_location',
    ]));

    const requiredItems = model.steps.flatMap(step => step.captureItems).filter(item => item.priority === 'required');
    expect(requiredItems.map(item => item.canonicalCategory)).toEqual(expect.arrayContaining([
      'overview',
      'meter',
      'main_service_panel',
      'roof_plane',
    ]));
  });

  it('maps evidence categories back to the deterministic movement step', () => {
    expect(fieldEvidenceStepForCategory('main_service_panel')?.stepId).toBe('03_main_service_equipment');
    expect(fieldEvidenceStepForCategory('trench_path')?.stepId).toBe('04_routing_path');
    expect(fieldEvidenceStepForCategory('roof_plane')?.stepId).toBe('06_roof_planes_and_obstructions');
    expect(fieldEvidenceStepForCategory('uncategorized')).toBeNull();
  });

  it('declares prohibited runtime behavior rather than enabling it', () => {
    const model = buildFieldEvidenceOrchestrationModel();

    expect(model.prohibitedRuntimeBehavior).toEqual(expect.arrayContaining([
      'no AI copilot runtime',
      'no OpenCV runtime',
      'no OCR runtime',
      'no YOLO runtime',
      'no semantic inference',
      'no image-byte analysis',
      'no autonomous CAD generation',
      'no autonomous regeneration',
    ]));
    expect(model.deterministicNotes.join(' ')).toContain('Photo ordering is not random uploader order');
  });
});
