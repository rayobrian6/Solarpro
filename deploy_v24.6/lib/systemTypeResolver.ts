// ============================================================
// SYSTEM TYPE RESOLVER
// Maps system type strings to equipment sets and display labels.
// Ensures Sol Fence never shows roof racking, etc.
// ============================================================

export type SystemTypeString = 'roof' | 'ground' | 'fence' | 'carport';

export interface EquipmentSet {
  rackingBrand:    string;
  rackingModel:    string;
  rackingDesc:     string;
  mountingType:    string;
  attachmentType:  string;
  attachmentDesc:  string;
  groundingType?:  string;
  specialNotes?:   string;
}

// ─── Equipment map by system type ────────────────────────────────────────────

const EQUIPMENT_MAP: Record<SystemTypeString, EquipmentSet> = {
  roof: {
    rackingBrand:   'IronRidge',
    rackingModel:   'XR100 Flush Mount Rail System',
    rackingDesc:    'Heavy-duty extruded aluminum rail, 50-year warranty',
    mountingType:   'Flush Roof Mount',
    attachmentType: 'IronRidge UFO Flashing',
    attachmentDesc: 'Waterproof lag-bolt flashing, code-compliant',
  },
  ground: {
    rackingBrand:   'Unirac',
    rackingModel:   'RM10 Ground Mount System',
    rackingDesc:    'Ballasted or driven-post ground mount, adjustable tilt',
    mountingType:   'Ground Mount',
    attachmentType: 'Driven Steel Posts',
    attachmentDesc: 'Galvanized steel posts, frost-depth installation',
    groundingType:  'Copper ground rod with exothermic weld',
  },
  fence: {
    rackingBrand:   'SolFence',
    rackingModel:   'Vertical Fence Rail System',
    rackingDesc:    'Agrivoltaic vertical bifacial fence-integrated mounting',
    mountingType:   'Vertical Fence Mount',
    attachmentType: 'SolFence Post Clamp System',
    attachmentDesc: 'No-penetration post clamp — attaches to existing fence posts',
    specialNotes:   'Bifacial panels required — captures front and rear irradiance',
  },
  carport: {
    rackingBrand:   'SolarCarport',
    rackingModel:   'Canopy Mount System',
    rackingDesc:    'Steel canopy structure with integrated solar mounting',
    mountingType:   'Carport Canopy',
    attachmentType: 'Structural Steel Columns',
    attachmentDesc: 'Engineered steel columns, concrete footing',
    specialNotes:   'Includes LED lighting integration option',
  },
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Resolve equipment set for a given system type string.
 * Accepts both short forms ('roof', 'fence') and legacy keys ('ROOF_MOUNT', 'SOL_FENCE').
 */
export function resolveSystemEquipment(systemType: string): EquipmentSet {
  const normalized = normalizeSystemType(systemType);
  return EQUIPMENT_MAP[normalized] ?? EQUIPMENT_MAP.roof;
}

/**
 * Get display label for system type.
 */
export function getSystemTypeDisplayLabel(systemType: string): string {
  const labels: Record<SystemTypeString, string> = {
    roof:    'Roof Mount',
    ground:  'Ground Mount',
    fence:   'Sol Fence',
    carport: 'Carport',
  };
  return labels[normalizeSystemType(systemType)] ?? 'Roof Mount';
}

/**
 * Normalize any system type string to the canonical short form.
 */
export function normalizeSystemType(systemType: string): SystemTypeString {
  const map: Record<string, SystemTypeString> = {
    roof:         'roof',
    ground:       'ground',
    fence:        'fence',
    carport:      'carport',
    ROOF_MOUNT:   'roof',
    GROUND_MOUNT: 'ground',
    SOL_FENCE:    'fence',
    CARPORT:      'carport',
  };
  return map[systemType] ?? 'roof';
}

/**
 * Get all system types with their labels and equipment.
 */
export function getAllSystemTypes(): Array<{ type: SystemTypeString; label: string; equipment: EquipmentSet }> {
  return (['roof', 'ground', 'fence', 'carport'] as SystemTypeString[]).map(type => ({
    type,
    label:     getSystemTypeDisplayLabel(type),
    equipment: EQUIPMENT_MAP[type],
  }));
}