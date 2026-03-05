// ============================================================
// SYSTEM EQUIPMENT RESOLVER
// Maps system types to correct racking/mounting hardware.
// Used by the proposal generator to display accurate equipment.
// ============================================================

import type { SystemTypeKey } from './companyPricing';
import { toSystemTypeKey } from './companyPricing';

export interface RackingSpec {
  rackingBrand:    string;
  rackingModel:    string;
  railMaterial:    string;
  hardware:        string;
  attachmentType:  string;
  attachmentNote:  string;
  tiltRange:       string;
  warranty:        string;
  certifications:  string;
}

export interface EquipmentSpec {
  racking:         RackingSpec;
  sectionTitle:    string;   // Label shown in proposal (e.g. "Roof Attachment Hardware")
  attachmentCards: AttachmentCard[];
}

export interface AttachmentCard {
  label:    string;
  hardware: string;
  note:     string;
  icon:     string;
}

// ── Equipment map by system type ──────────────────────────────────────────

const equipmentMap: Record<SystemTypeKey, EquipmentSpec> = {

  ROOF_MOUNT: {
    sectionTitle: 'Roof Attachment Hardware',
    racking: {
      rackingBrand:   'IronRidge',
      rackingModel:   'XR100 Flush Mount Rail System',
      railMaterial:   'Anodized Aluminum 6005-T5',
      hardware:       'Stainless Steel Grade 316',
      attachmentType: 'Flush Mount',
      attachmentNote: 'Lag bolt into rafter with EPDM flashing',
      tiltRange:      'Follows roof pitch (0°–45°)',
      warranty:       '10-year product warranty',
      certifications: 'UL 2703, IBC, ASCE 7',
    },
    attachmentCards: [
      {
        label:    'Asphalt Shingle',
        hardware: 'Flashed L-Foot + 5/16" × 3" lag bolt into rafter',
        note:     'EPDM flashing, min. 2.5" rafter embedment',
        icon:     '🏠',
      },
      {
        label:    'Tile Roof',
        hardware: 'QuickMount PV Tile Hook or tile replacement mount',
        note:     'Remove tile, install flashing, replace tile',
        icon:     '🏛️',
      },
      {
        label:    'Metal Roof',
        hardware: 'S-5! PVKIT 2.0 clamp — no penetrations',
        note:     'Clamp to standing seam, no roof penetrations',
        icon:     '🏗️',
      },
      {
        label:    'Flat TPO/EPDM',
        hardware: 'Esdec FlatFix Fusion ballasted system',
        note:     'No penetrations, ballasted tray system',
        icon:     '🏢',
      },
      {
        label:    'Corrugated Metal',
        hardware: 'SnapNrack Series 100 + EPDM washers',
        note:     'Self-tapping screws into structural purlins',
        icon:     '🏭',
      },
    ],
  },

  GROUND_MOUNT: {
    sectionTitle: 'Ground Mount Foundation System',
    racking: {
      rackingBrand:   'Unirac',
      rackingModel:   'RM10 Ground Mount System',
      railMaterial:   'Hot-Dip Galvanized Steel',
      hardware:       'Stainless Steel Grade 316 fasteners',
      attachmentType: 'Driven Pier / Helical Anchor',
      attachmentNote: 'Adjustable tilt 10°–30°, galvanized steel piers',
      tiltRange:      '10°–30° adjustable',
      warranty:       '10-year product warranty',
      certifications: 'UL 2703, IBC, ASCE 7',
    },
    attachmentCards: [
      {
        label:    'Standard Soil',
        hardware: 'Unirac RM10 driven pier system',
        note:     'Galvanized steel piers, adjustable tilt 10°–30°',
        icon:     '🌱',
      },
      {
        label:    'Rocky / Hard Soil',
        hardware: 'IronRidge helical anchor system',
        note:     'Helical piers for rocky or hard soil conditions',
        icon:     '⛏️',
      },
      {
        label:    'Concrete Ballast',
        hardware: 'Ballasted concrete footing system',
        note:     'No ground penetration, concrete ballast blocks',
        icon:     '🧱',
      },
      {
        label:    'Flood Zone',
        hardware: 'Engineered concrete pier with rebar',
        note:     'Engineered footings for flood zone compliance',
        icon:     '💧',
      },
      {
        label:    'Tracker Ready',
        hardware: 'NEXTracker NX Horizon single-axis tracker',
        note:     'Optional single-axis tracking for +15–25% yield',
        icon:     '☀️',
      },
    ],
  },

  SOL_FENCE: {
    sectionTitle: 'Sol Fence Vertical Rail System',
    racking: {
      rackingBrand:   'SolFence',
      rackingModel:   'Vertical Fence Rail System',
      railMaterial:   'Extruded Aluminum 6063-T6',
      hardware:       'Stainless Steel Grade 316 fasteners',
      attachmentType: 'Vertical Fence Post Mount',
      attachmentNote: 'Panels mounted vertically on fence posts, bifacial optimized',
      tiltRange:      '90° vertical (bifacial)',
      warranty:       '15-year product warranty',
      certifications: 'UL 2703, IEC 61215, Wind Zone D',
    },
    attachmentCards: [
      {
        label:    'Standard Fence Post',
        hardware: 'SolFence vertical rail clamp system',
        note:     'Clamps to existing or new fence posts, no drilling',
        icon:     '🚧',
      },
      {
        label:    'Bifacial Optimization',
        hardware: 'Rear-side reflective ground cover',
        note:     'White gravel or reflective membrane boosts rear gain 10–20%',
        icon:     '🔆',
      },
      {
        label:    'Wind Load',
        hardware: 'Engineered post spacing per wind zone',
        note:     'Post spacing calculated for local wind load requirements',
        icon:     '💨',
      },
      {
        label:    'Privacy Screen',
        hardware: 'Integrated privacy panel option',
        note:     'Opaque back panel available for privacy applications',
        icon:     '🛡️',
      },
      {
        label:    'Microinverter Ready',
        hardware: 'Enphase IQ8 microinverter per panel',
        note:     'Recommended for vertical bifacial — eliminates string mismatch',
        icon:     '⚡',
      },
    ],
  },

  CARPORT: {
    sectionTitle: 'Carport Canopy Structure',
    racking: {
      rackingBrand:   'SolarCarport',
      rackingModel:   'Canopy Mount System',
      railMaterial:   'Hot-Dip Galvanized Steel + Aluminum Purlins',
      hardware:       'Stainless Steel Grade 316 fasteners',
      attachmentType: 'Canopy Column Foundation',
      attachmentNote: 'Engineered steel columns on concrete footings',
      tiltRange:      '5°–15° (drainage slope)',
      warranty:       '20-year structural warranty',
      certifications: 'UL 2703, IBC, ASCE 7, ADA compliant',
    },
    attachmentCards: [
      {
        label:    'Single Row Carport',
        hardware: 'Single-post cantilever column system',
        note:     'Single row of parking spaces, cantilever design',
        icon:     '🚗',
      },
      {
        label:    'Double Row Carport',
        hardware: 'T-post center column system',
        note:     'Double row of parking spaces, center T-post',
        icon:     '🚙',
      },
      {
        label:    'EV Charging Ready',
        hardware: 'Integrated EV charging conduit rough-in',
        note:     'Pre-wired conduit for Level 2 EV charger installation',
        icon:     '🔌',
      },
      {
        label:    'LED Lighting',
        hardware: 'Integrated LED canopy lighting',
        note:     'Solar-powered LED lighting under canopy',
        icon:     '💡',
      },
      {
        label:    'Snow Load',
        hardware: 'Engineered for local snow load requirements',
        note:     'Structural design per local building code snow load',
        icon:     '❄️',
      },
    ],
  },
};

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Get equipment spec for a given system type string.
 * Accepts both legacy ('roof', 'ground', 'fence') and new ('ROOF_MOUNT', etc.) formats.
 */
export function resolveEquipment(systemType: string): EquipmentSpec {
  const key = toSystemTypeKey(systemType);
  return equipmentMap[key] ?? equipmentMap.ROOF_MOUNT;
}

/**
 * Get just the racking spec for a given system type.
 */
export function resolveRacking(systemType: string): RackingSpec {
  return resolveEquipment(systemType).racking;
}

/**
 * Get the display label for a system type.
 */
export function getSystemTypeLabel(systemType: string): string {
  const labels: Record<SystemTypeKey, string> = {
    ROOF_MOUNT:   'Roof Mount',
    GROUND_MOUNT: 'Ground Mount',
    SOL_FENCE:    'Sol Fence',
    CARPORT:      'Solar Carport',
  };
  return labels[toSystemTypeKey(systemType)] ?? 'Roof Mount';
}