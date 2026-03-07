// ============================================================
// POST /api/engineering/enphase
// Enphase Installer API — microinverter ecosystem resolver
// Returns: trunk cable, terminators, cable caps, combiner,
//          IQ Gateway, RSD accessories for a given system
// Based on Enphase IQ8 Series installer specifications
// ============================================================

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
import { MICROINVERTERS } from '@/lib/equipment-db';

// ── Enphase Part Number Database ─────────────────────────────
// Official Enphase part numbers from installer price list

const ENPHASE_PARTS = {
  // IQ8 Series Microinverters
  microinverters: {
    'enphase-iq8plus': {
      partNumber: 'IQ8PLUS-72-2-US',
      model: 'IQ8+ Microinverter',
      description: 'Enphase IQ8+ Microinverter, 295W AC, 240V, 1-phase',
      acOutputW: 295,
      modulesPerDevice: 1,
    },
    'enphase-iq8m': {
      partNumber: 'IQ8M-72-2-US',
      model: 'IQ8M Microinverter',
      description: 'Enphase IQ8M Microinverter, 330W AC, 240V, 1-phase',
      acOutputW: 330,
      modulesPerDevice: 1,
    },
    'enphase-iq8h': {
      partNumber: 'IQ8H-240-2-US',
      model: 'IQ8H Microinverter',
      description: 'Enphase IQ8H Microinverter, 380W AC, 240V, 1-phase',
      acOutputW: 380,
      modulesPerDevice: 1,
    },
  },

  // Q Cable (AC Trunk Cable) — 240V, 1-phase
  // 1 section per 16 microinverters (standard branch circuit)
  trunkCable: {
    '240v-standard': {
      partNumber: 'Q-12-10-240',
      model: 'Q Cable 240V 10-Connector',
      description: 'Enphase Q Cable, 240V, 10-connector section, 1-phase',
      connectorsPerSection: 10,
      voltage: 240,
      notes: '1 section per 16 microinverters (standard). Use 2 sections for 17-32 units.',
    },
    '240v-4connector': {
      partNumber: 'Q-12-4-240',
      model: 'Q Cable 240V 4-Connector',
      description: 'Enphase Q Cable, 240V, 4-connector section, 1-phase',
      connectorsPerSection: 4,
      voltage: 240,
      notes: 'Short section for small arrays or end-of-run',
    },
  },

  // Q Cable Terminators — 2 per trunk section (one each end)
  terminators: {
    '240v': {
      partNumber: 'Q-TERM-10-240',
      model: 'Q Cable Terminator 240V',
      description: 'Enphase Q Cable terminator, 240V, 1-phase — 2 required per trunk section',
      qtyPerSection: 2,
    },
  },

  // Cable Caps — weatherproof caps for unused Q Cable connectors
  cableCaps: {
    standard: {
      partNumber: 'Q-CAP-10',
      model: 'Q Cable Cap',
      description: 'Enphase Q Cable weatherproof cap for unused connectors',
      notes: 'Required for any unused connector on trunk cable',
    },
  },

  // IQ Gateway — system monitoring and communication hub
  gateway: {
    standard: {
      partNumber: 'ENV-IQ-AM1-240',
      model: 'IQ Gateway Standard',
      description: 'Enphase IQ Gateway Standard, 240V, monitors up to 600 microinverters',
      maxMicroinverters: 600,
      connectivity: 'Wi-Fi + Ethernet',
    },
    metered: {
      partNumber: 'ENV-IQ-AM3-240',
      model: 'IQ Gateway Metered',
      description: 'Enphase IQ Gateway Metered, 240V, with revenue-grade production/consumption CT',
      maxMicroinverters: 600,
      connectivity: 'Wi-Fi + Ethernet',
      notes: 'Includes CT clamps for production + consumption monitoring',
    },
  },

  // IQ Combiner — aggregates AC branch circuits
  combiner: {
    '4c': {
      partNumber: 'ENV-IQ-C4C-240',
      model: 'IQ Combiner 4C',
      description: 'Enphase IQ Combiner 4C, 240V, 4 branch circuits, includes IQ Gateway Standard',
      branchCircuits: 4,
      includesGateway: true,
      notes: 'Preferred for systems up to 64 microinverters (4 branches × 16)',
    },
    '4': {
      partNumber: 'ENV-IQ-C4-240',
      model: 'IQ Combiner 4',
      description: 'Enphase IQ Combiner 4, 240V, 4 branch circuits, no gateway included',
      branchCircuits: 4,
      includesGateway: false,
    },
  },

  // Rapid Shutdown Device (RSD) — NEC 690.12
  // IQ8 microinverters have integrated RSD — no external device needed
  rsd: {
    integrated: {
      partNumber: 'INTEGRATED-IQ8',
      model: 'Integrated RSD (IQ8)',
      description: 'Rapid shutdown integrated in IQ8 microinverter per NEC 690.12 — no external device required',
      necReference: 'NEC 690.12',
      notes: 'IQ8 series microinverters comply with NEC 690.12 rapid shutdown without external devices',
    },
  },

  // AC Disconnect — NEC 690.14
  acDisconnect: {
    '30a': {
      partNumber: 'DU30RB',
      model: 'Square D 30A AC Disconnect',
      description: '30A, 240V AC disconnect switch, NEMA 3R, per NEC 690.14',
      manufacturer: 'Square D',
      amps: 30,
      voltage: 240,
      necReference: 'NEC 690.14',
    },
  },
} as const;

// ── Request/Response types ────────────────────────────────────

export interface EnphaseAccessoryRequest {
  inverterId: string;          // e.g. 'enphase-iq8plus'
  deviceCount: number;         // number of microinverters
  moduleCount?: number;        // total PV modules (for cable cap calc)
  includeGateway?: boolean;    // include IQ Gateway (default: true)
  includeCombiner?: boolean;   // include IQ Combiner (default: true)
  includeRSD?: boolean;        // include RSD note (default: true)
  includeACDisconnect?: boolean; // include AC disconnect (default: true)
  meteredGateway?: boolean;    // use metered gateway (default: false)
}

export interface EnphaseAccessoryItem {
  category: string;
  manufacturer: string;
  model: string;
  partNumber: string;
  description: string;
  quantity: number;
  unit: 'ea' | 'ft' | 'set' | 'lot';
  necReference?: string;
  notes?: string;
  required: boolean;
  derivedFrom: string;
  formula: string;
}

export interface EnphaseAccessoryResponse {
  success: boolean;
  inverterId?: string;
  inverterModel?: string;
  inverterPartNumber?: string;
  deviceCount?: number;
  accessories?: EnphaseAccessoryItem[];
  systemSummary?: {
    totalAcOutputW: number;
    totalAcOutputKw: number;
    trunkSections: number;
    branchCircuits: number;
    requiresExternalRSD: boolean;
  };
  error?: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body: EnphaseAccessoryRequest = await req.json();

    const { inverterId, deviceCount } = body;

    if (!inverterId || !deviceCount || deviceCount <= 0) {
      return NextResponse.json({
        success: false,
        error: 'inverterId and deviceCount (> 0) are required',
      }, { status: 400 });
    }

    // Validate it's an Enphase microinverter
    const microData = MICROINVERTERS.find(m => m.id === inverterId);
    if (!microData || microData.manufacturer !== 'Enphase') {
      return NextResponse.json({
        success: false,
        error: `Inverter '${inverterId}' is not a supported Enphase microinverter. Supported: enphase-iq8plus, enphase-iq8m, enphase-iq8h`,
      }, { status: 400 });
    }

    // Get Enphase part data
    const microParts = ENPHASE_PARTS.microinverters[inverterId as keyof typeof ENPHASE_PARTS.microinverters];
    if (!microParts) {
      return NextResponse.json({
        success: false,
        error: `No Enphase part data for '${inverterId}'`,
      }, { status: 404 });
    }

    const accessories: EnphaseAccessoryItem[] = [];

    // ── 1. Trunk Cable ────────────────────────────────────────
    // 1 section per 16 microinverters (standard branch circuit limit)
    const microPerBranch = 16;
    const trunkSections = Math.ceil(deviceCount / microPerBranch);
    const trunkParts = ENPHASE_PARTS.trunkCable['240v-standard'];

    accessories.push({
      category: 'trunk_cable',
      manufacturer: 'Enphase',
      model: trunkParts.model,
      partNumber: trunkParts.partNumber,
      description: trunkParts.description,
      quantity: trunkSections,
      unit: 'ea',
      necReference: 'NEC 690.31',
      notes: `${deviceCount} microinverters ÷ ${microPerBranch} per branch = ${trunkSections} section(s)`,
      required: true,
      derivedFrom: 'deviceCount',
      formula: `ceil(${deviceCount} / ${microPerBranch}) = ${trunkSections}`,
    });

    // ── 2. Terminators ────────────────────────────────────────
    // 2 per trunk section (one at each end)
    const terminatorQty = trunkSections * 2;
    const termParts = ENPHASE_PARTS.terminators['240v'];

    accessories.push({
      category: 'terminator',
      manufacturer: 'Enphase',
      model: termParts.model,
      partNumber: termParts.partNumber,
      description: termParts.description,
      quantity: terminatorQty,
      unit: 'ea',
      necReference: 'NEC 690.31',
      notes: `2 terminators per trunk section × ${trunkSections} sections`,
      required: true,
      derivedFrom: 'trunkSections',
      formula: `${trunkSections} × 2 = ${terminatorQty}`,
    });

    // ── 3. Cable Caps ─────────────────────────────────────────
    // Unused connectors on trunk cable need weatherproof caps
    // Each 10-connector section: connectors used = microinverters on that section
    const connectorsPerSection = 10;
    const totalConnectors = trunkSections * connectorsPerSection;
    const usedConnectors = deviceCount;
    const unusedConnectors = Math.max(0, totalConnectors - usedConnectors);
    const capParts = ENPHASE_PARTS.cableCaps.standard;

    if (unusedConnectors > 0) {
      accessories.push({
        category: 'cable_cap',
        manufacturer: 'Enphase',
        model: capParts.model,
        partNumber: capParts.partNumber,
        description: capParts.description,
        quantity: unusedConnectors,
        unit: 'ea',
        necReference: 'NEC 690.31',
        notes: `${totalConnectors} total connectors − ${usedConnectors} used = ${unusedConnectors} caps needed`,
        required: true,
        derivedFrom: 'unusedConnectors',
        formula: `(${trunkSections} × ${connectorsPerSection}) − ${deviceCount} = ${unusedConnectors}`,
      });
    }

    // ── 4. IQ Combiner ────────────────────────────────────────
    if (body.includeCombiner !== false) {
      const branchCircuits = trunkSections;
      // Use 4C combiner (includes gateway) for ≤4 branches, else use 4 + separate gateway
      const combinerKey = branchCircuits <= 4 ? '4c' : '4';
      const combinerParts = ENPHASE_PARTS.combiner[combinerKey];

      accessories.push({
        category: 'combiner',
        manufacturer: 'Enphase',
        model: combinerParts.model,
        partNumber: combinerParts.partNumber,
        description: combinerParts.description,
        quantity: 1,
        unit: 'ea',
        necReference: 'NEC 690.4',
        notes: `${branchCircuits} branch circuit(s). ${combinerParts.includesGateway ? 'Includes IQ Gateway Standard.' : 'Add IQ Gateway separately.'}`,
        required: true,
        derivedFrom: 'perSystem',
        formula: '1 per system',
      });

      // ── 5. IQ Gateway ─────────────────────────────────────
      // Only add separately if combiner doesn't include it
      if (body.includeGateway !== false && !combinerParts.includesGateway) {
        const gwKey = body.meteredGateway ? 'metered' : 'standard';
        const gwParts = ENPHASE_PARTS.gateway[gwKey];
        const gwNotes = 'notes' in gwParts ? gwParts.notes : `Monitors up to ${gwParts.maxMicroinverters} microinverters`;

        accessories.push({
          category: 'gateway',
          manufacturer: 'Enphase',
          model: gwParts.model,
          partNumber: gwParts.partNumber,
          description: gwParts.description,
          quantity: 1,
          unit: 'ea',
          necReference: 'NEC 690.4',
          notes: gwNotes,
          required: true,
          derivedFrom: 'perSystem',
          formula: '1 per system',
        });
      }
    } else if (body.includeGateway !== false) {
      // Combiner excluded but gateway still needed
      const gwKey = body.meteredGateway ? 'metered' : 'standard';
      const gwParts = ENPHASE_PARTS.gateway[gwKey];

      accessories.push({
        category: 'gateway',
        manufacturer: 'Enphase',
        model: gwParts.model,
        partNumber: gwParts.partNumber,
        description: gwParts.description,
        quantity: 1,
        unit: 'ea',
        necReference: 'NEC 690.4',
        notes: `Monitors up to ${gwParts.maxMicroinverters} microinverters`,
        required: true,
        derivedFrom: 'perSystem',
        formula: '1 per system',
      });
    }

    // ── 6. Rapid Shutdown ─────────────────────────────────────
    // IQ8 has integrated RSD — document compliance, no hardware needed
    if (body.includeRSD !== false) {
      const rsdParts = ENPHASE_PARTS.rsd.integrated;

      accessories.push({
        category: 'rsd',
        manufacturer: 'Enphase',
        model: rsdParts.model,
        partNumber: rsdParts.partNumber,
        description: rsdParts.description,
        quantity: 0, // No external hardware — integrated
        unit: 'ea',
        necReference: rsdParts.necReference,
        notes: rsdParts.notes,
        required: false, // Satisfied by microinverter
        derivedFrom: 'integrated',
        formula: 'Integrated in IQ8 — no external device',
      });
    }

    // ── 7. AC Disconnect ──────────────────────────────────────
    if (body.includeACDisconnect !== false) {
      const discParts = ENPHASE_PARTS.acDisconnect['30a'];

      accessories.push({
        category: 'ac_disconnect',
        manufacturer: discParts.manufacturer,
        model: discParts.model,
        partNumber: discParts.partNumber,
        description: discParts.description,
        quantity: 1,
        unit: 'ea',
        necReference: discParts.necReference,
        notes: `${discParts.amps}A, ${discParts.voltage}V — sized for system AC output`,
        required: true,
        derivedFrom: 'perSystem',
        formula: '1 per system',
      });
    }

    // ── System Summary ────────────────────────────────────────
    const totalAcOutputW = deviceCount * microParts.acOutputW;

    return NextResponse.json({
      success: true,
      inverterId,
      inverterModel: microParts.model,
      inverterPartNumber: microParts.partNumber,
      deviceCount,
      accessories,
      systemSummary: {
        totalAcOutputW,
        totalAcOutputKw: parseFloat((totalAcOutputW / 1000).toFixed(2)),
        trunkSections,
        branchCircuits: trunkSections,
        requiresExternalRSD: false, // IQ8 has integrated RSD
      },
    } satisfies EnphaseAccessoryResponse);

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Enphase accessory resolution failed';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// GET for simple queries
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const inverterId = searchParams.get('inverterId') ?? 'enphase-iq8plus';
  const deviceCount = parseInt(searchParams.get('deviceCount') ?? '20', 10);

  const mockReq = new NextRequest(req.url, {
    method: 'POST',
    body: JSON.stringify({ inverterId, deviceCount }),
    headers: { 'Content-Type': 'application/json' },
  });

  return POST(mockReq);
}