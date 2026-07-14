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
  /** Default panel ID for this system type (used when no panel is selected) */
  defaultPanelId?: string;
  /** Panel degradation rate override (%/yr as decimal, e.g. 0.004) */
  panelDegradationRate?: number;
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
    // Design Studio ground mounts are Speck PLP POWER DRIVE™ (driven I-beam pylon
    // + strongback + PX rail, single-strut cantilever) — the reality engine
    // (lib/3d/ground/groundMountRealityEngine.ts, SP3284 RevE). Was hardcoded to
    // Unirac RM10, which contradicted the studio the ground designer is built on.
    racking: {
      rackingBrand:   'PLP (Preformed Line Products)',
      rackingModel:   'POWER DRIVE Driven Pylon System',
      railMaterial:   'Hot-Dip Galvanized Steel (I-beam pylon + PX rail)',
      hardware:       'Stainless Steel Grade 316 fasteners',
      attachmentType: 'Driven I-beam Pylon — single-strut cantilever',
      attachmentNote: 'One pylon per bay, driven to refusal — no concrete',
      tiltRange:      'Fixed tilt (per design)',
      warranty:       '25-year product warranty',
      certifications: 'ICC-ES ESR-3895, UL 2703, ASCE 7-22',
    },
    attachmentCards: [
      {
        label:    'Standard Soil',
        hardware: 'Speck PLP POWER DRIVE™ driven pylon',
        note:     'Driven I-beam pylons, one per bay @ ~20 ft O.C. — no concrete',
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
    // v47.239: Philadelphia Solar Nexus PS-MNB108(HCBF)-440W is the standard Sol Fence panel.
    // Only applies to fence systems — roof/ground use their own panel selection.
    defaultPanelId: 'panel-fence-ps1',
    // Philadelphia Solar Nexus has -0.4%/yr degradation (better than standard 0.5%)
    panelDegradationRate: 0.004,
    racking: {
      rackingBrand:   'SolFence',                       // Sol Fence LLC (solfence.solar), Newburgh IN
      rackingModel:   'SOL Fence Vertical Section System',
      railMaterial:   '6061-T6 aluminum (121-mil), galvanized steel foundation posts', // per SolFence GOLD datasheet (was wrongly '6063-T6')
      hardware:       'Pre-built sections (side channels + rails) on 4x4 posts',
      attachmentType: 'Vertical Fence Post Mount (8 ft wide sections)',
      attachmentNote: 'Panels mounted vertically on 4x4 posts, bifacial; steel post + concrete sourced locally',
      tiltRange:      '90° vertical (bifacial)',
      warranty:       'Lifetime fence-system warranty / 30-yr panel warranty',
      certifications: 'UL 2703 · wind rated 115 mph · snow load 113 PSF',
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
        label:    'Power Electronics (installer-supplied)',
        hardware: 'Tigo TS4-A-O optimizer (per datasheet) or Enphase IQ8 microinverter',
        note:     'Per SolFence GOLD datasheet: Tigo TS4-A-O optimizer (panel monitoring + rapid shutdown) when needed. Enphase IQ8 micro also fits the racking (APsystems micros do NOT — larger form factor). Power electronics + all wiring are NOT in the SolFence kit — supplied by the installer.',
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
 * v47.239: Resolve the default panel spec for a Sol Fence system.
 * Returns the Philadelphia Solar Nexus PS-MNB108(HCBF)-440W panel spec.
 * This is ONLY used for fence systems — roof/ground use their own panel selection.
 * When a project already has selectedPanel set, that takes priority.
 */
// CROSS-REF: panel-fence-ps1 also defined in equipment-registry-v4.ts (V4 BOM lookup)
//            and db.ts defaultPanels (UI/DB seed). This is the structural spec version.
export function resolveDefaultFencePanelSpec(): import('@/types').SolarPanel {
  return {
    id:               'panel-fence-ps1',
    manufacturer:     'Philadelphia Solar',
    model:            'Nexus PS-MNB108(HCBF)-440W',
    wattage:          440,
    width:            1.133,
    height:           1.721,
    efficiency:       22.57,
    bifacial:         true,
    bifacialFactor:   1.20,
    temperatureCoeff: -0.30,
    pricePerWatt:     0.31,
    warranty:         30,
    cellType:         'N-Type Mono-Crystalline 16BB Half-Cell',
  };
}

/**
 * v47.239: Get the panel degradation rate for a system type.
 * Sol Fence (Philadelphia Solar Nexus): 0.4%/yr
 * All other types: 0.5%/yr (industry standard)
 */
export function getPanelDegradationRate(systemType: string): number {
  const key = toSystemTypeKey(systemType);
  return equipmentMap[key]?.panelDegradationRate ?? 0.005;
}

/**
 * Get just the racking spec for a given system type.
 */
export function resolveRacking(systemType: string): RackingSpec {
  return resolveEquipment(systemType).racking;
}

/**
 * Get the display label for a system type.
 * v47.217: Returns 'Unknown System Type' for unrecognized inputs instead of
 * silently defaulting to 'Roof Mount'. This makes bad data visible in the UI.
 */
export function getSystemTypeLabel(systemType: string): string {
  const labels: Record<SystemTypeKey, string> = {
    ROOF_MOUNT:   'Roof Mount',
    GROUND_MOUNT: 'Ground Mount',
    SOL_FENCE:    'Sol Fence',
    CARPORT:      'Solar Carport',
  };
  if (!systemType || (typeof systemType === 'string' && systemType.trim() === '')) {
    console.warn('[getSystemTypeLabel] systemType is empty/missing — cannot determine install type');
    return 'Unknown System Type';
  }
  return labels[toSystemTypeKey(systemType)];
}

/**
 * Get a dynamic system description driven by installType.
 * v47.217: Proposal system description must reflect actual install type —
 * roof, ground mount, or solar fence each get distinct language.
 */
export function getSystemDescription(systemType: string): string {
  const descriptions: Record<SystemTypeKey, string> = {
    ROOF_MOUNT: [
      'This roof-mounted solar photovoltaic system is designed to integrate seamlessly with your existing roof structure. ',
      'High-efficiency monocrystalline panels are flush-mounted using an engineered aluminum rail system secured with waterproof flashing attachments. ',
      'The system is optimized for your roof\'s orientation, pitch, and shading conditions to maximize annual energy production.',
    ].join(''),
    GROUND_MOUNT: [
      'This ground-mounted solar photovoltaic system is installed on a freestanding racking structure anchored directly into the ground. ',
      'The system uses galvanized steel posts or helical anchors with adjustable-tilt aluminum racking, allowing optimal panel angle selection independent of any roof constraints. ',
      'Ground-mount systems are ideal for properties with ample open land, and offer easy maintenance access and maximum design flexibility.',
    ].join(''),
    SOL_FENCE: [
      'This Sol Fence solar photovoltaic system uses vertical bifacial panels mounted along a fence line to generate clean energy while defining a property boundary. ',
      'Panels are mounted vertically at 90° using a no-penetration post clamp system, capturing irradiance from both front and rear surfaces. ',
      'The agrivoltaic design is ideal for agricultural, residential, and commercial properties seeking dual-purpose infrastructure that combines privacy, security, and solar generation.',
    ].join(''),
    CARPORT: [
      'This solar carport system integrates photovoltaic panels into a canopy structure that simultaneously provides covered vehicle parking. ',
      'Engineered steel columns support an aluminum-purlin canopy at a low slope for drainage, with solar panels mounted flush to the canopy surface. ',
      'Solar carports are ideal for commercial and multi-family properties, maximizing land use efficiency while providing shade and EV charging readiness.',
    ].join(''),
  };
  if (!systemType || (typeof systemType === 'string' && systemType.trim() === '')) {
    console.warn('[getSystemDescription] systemType is empty/missing — cannot generate system description');
    return 'This solar photovoltaic system has been engineered to meet your energy production goals.';
  }
  return descriptions[toSystemTypeKey(systemType)];
}