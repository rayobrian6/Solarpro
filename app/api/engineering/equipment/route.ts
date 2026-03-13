// ============================================================
// GET /api/engineering/equipment
// CEC Solar Equipment Database — panel & inverter specs
// Sources: NREL SAM CEC database (public domain)
// Serves real manufacturer data for permit-grade engineering
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { handleRouteDbError } from '@/lib/db-neon';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
import {
  SOLAR_PANELS,
  STRING_INVERTERS,
  MICROINVERTERS,
  OPTIMIZERS,
  RACKING_SYSTEMS,
  SolarPanel,
  StringInverter,
  Microinverter,
  Optimizer,
  RackingSystem,
} from '@/lib/equipment-db';

// ── CEC-normalized panel record ──────────────────────────────
export interface CECPanelRecord {
  id: string;
  manufacturer: string;
  model: string;
  watts: number;
  efficiency: number;
  voc: number;
  vmp: number;
  isc: number;
  imp: number;
  tempCoeffVoc: number;
  tempCoeffIsc: number;
  tempCoeffPmax: number;
  maxSystemVoltage: number;
  maxSeriesFuseRating: number;
  nominalOperatingTemp: number;
  bifacial: boolean;
  cellType: string;
  weight: number;
  length: number;
  width: number;
  warranty: string;
  ulListing: string;
  datasheetUrl: string;
  source: 'CEC' | 'internal';
}

// ── CEC-normalized inverter record ───────────────────────────
export interface CECInverterRecord {
  id: string;
  manufacturer: string;
  model: string;
  type: 'string' | 'micro' | 'optimizer';
  acOutputKw: number;
  dcInputKwMax: number;
  maxDcVoltage: number;
  mpptVoltageMin: number;
  mpptVoltageMax: number;
  efficiency: number;
  cec_efficiency: number;
  acOutputVoltage: number;
  acOutputCurrentMax: number;
  weight: number;
  warranty: string;
  ulListing: string;
  rapidShutdownCompliant: boolean;
  datasheetUrl: string;
  // Micro-specific
  modulesPerDevice?: number;
  acOutputW?: number;
  // String-specific
  mpptChannels?: number;
  numberOfMPPT?: number;
  recommendedStringRange?: { min: number; max: number };
  source: 'CEC' | 'internal';
}

// ── Racking record ───────────────────────────────────────────
export interface RackingRecord {
  id: string;
  manufacturer: string;
  model: string;
  systemType: string;
  roofTypes: string[];
  maxWindSpeed: number;
  maxSnowLoad: number;
  railSpanMax: number;
  attachmentSpacingMax: number;
  material: string;
  warranty: string;
  ulListing: string;
  attachmentMethod: string;
  loadModel?: string;
  fastenersPerAttachment?: number;
  upliftCapacity?: number;
  datasheetUrl: string;
  source: 'internal';
}

function panelToRecord(p: SolarPanel): CECPanelRecord {
  return {
    id: p.id,
    manufacturer: p.manufacturer,
    model: p.model,
    watts: p.watts,
    efficiency: p.efficiency,
    voc: p.voc,
    vmp: p.vmp,
    isc: p.isc,
    imp: p.imp,
    tempCoeffVoc: p.tempCoeffVoc,
    tempCoeffIsc: p.tempCoeffIsc,
    tempCoeffPmax: p.tempCoeffPmax,
    maxSystemVoltage: p.maxSystemVoltage,
    maxSeriesFuseRating: p.maxSeriesFuseRating,
    nominalOperatingTemp: p.nominalOperatingTemp,
    bifacial: p.bifacial,
    cellType: p.cellType,
    weight: p.weight,
    length: p.length,
    width: p.width,
    warranty: p.warranty,
    ulListing: p.ulListing,
    datasheetUrl: p.datasheetUrl,
    source: 'CEC',
  };
}

function stringInverterToRecord(inv: StringInverter): CECInverterRecord {
  return {
    id: inv.id,
    manufacturer: inv.manufacturer,
    model: inv.model,
    type: 'string',
    acOutputKw: inv.acOutputKw,
    dcInputKwMax: inv.dcInputKwMax,
    maxDcVoltage: inv.maxDcVoltage,
    mpptVoltageMin: inv.mpptVoltageMin,
    mpptVoltageMax: inv.mpptVoltageMax,
    efficiency: inv.efficiency,
    cec_efficiency: inv.cec_efficiency,
    acOutputVoltage: inv.acOutputVoltage,
    acOutputCurrentMax: inv.acOutputCurrentMax,
    weight: inv.weight,
    warranty: inv.warranty,
    ulListing: inv.ulListing,
    rapidShutdownCompliant: inv.rapidShutdownCompliant,
    datasheetUrl: inv.datasheetUrl,
    mpptChannels: inv.mpptChannels,
    numberOfMPPT: inv.numberOfMPPT,
    recommendedStringRange: inv.recommendedStringRange,
    source: 'CEC',
  };
}

function microinverterToRecord(inv: Microinverter): CECInverterRecord {
  return {
    id: inv.id,
    manufacturer: inv.manufacturer,
    model: inv.model,
    type: 'micro',
    acOutputKw: inv.acOutputW / 1000,
    acOutputW: inv.acOutputW,
    dcInputKwMax: inv.dcInputWMax / 1000,
    maxDcVoltage: inv.maxDcVoltage,
    mpptVoltageMin: inv.mpptVoltageMin,
    mpptVoltageMax: inv.mpptVoltageMax,
    efficiency: inv.efficiency,
    cec_efficiency: inv.cec_efficiency,
    acOutputVoltage: inv.acOutputVoltage,
    acOutputCurrentMax: inv.acOutputCurrentMax,
    weight: inv.weight,
    warranty: inv.warranty,
    ulListing: inv.ulListing,
    rapidShutdownCompliant: inv.rapidShutdownCompliant,
    datasheetUrl: inv.datasheetUrl,
    modulesPerDevice: inv.modulesPerDevice,
    source: 'CEC',
  };
}

function rackingToRecord(r: RackingSystem): RackingRecord {
  return {
    id: r.id,
    manufacturer: r.manufacturer,
    model: r.model,
    systemType: r.systemType,
    roofTypes: r.roofTypes,
    maxWindSpeed: r.maxWindSpeed,
    maxSnowLoad: r.maxSnowLoad,
    railSpanMax: r.railSpanMax,
    attachmentSpacingMax: r.attachmentSpacingMax,
    material: r.material,
    warranty: r.warranty,
    ulListing: r.ulListing,
    attachmentMethod: r.attachmentMethod,
    loadModel: r.loadModel,
    fastenersPerAttachment: r.fastenersPerAttachment,
    upliftCapacity: r.upliftCapacity,
    datasheetUrl: r.datasheetUrl,
    source: 'internal',
  };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const category = searchParams.get('category') ?? 'all';
  const manufacturer = searchParams.get('manufacturer')?.toLowerCase();
  const search = searchParams.get('search')?.toLowerCase();
  const id = searchParams.get('id');

  // ── Single item lookup by ID ──────────────────────────────
  if (id) {
    const panel = SOLAR_PANELS.find(p => p.id === id);
    if (panel) return NextResponse.json({ success: true, item: panelToRecord(panel), category: 'panel' });

    const strInv = STRING_INVERTERS.find(i => i.id === id);
    if (strInv) return NextResponse.json({ success: true, item: stringInverterToRecord(strInv), category: 'string_inverter' });

    const micro = MICROINVERTERS.find(m => m.id === id);
    if (micro) return NextResponse.json({ success: true, item: microinverterToRecord(micro), category: 'microinverter' });

    const opt = OPTIMIZERS.find(o => o.id === id);
    if (opt) return NextResponse.json({ success: true, item: { ...opt, type: 'optimizer', source: 'CEC' }, category: 'optimizer' });

    const rack = RACKING_SYSTEMS.find(r => r.id === id);
    if (rack) return NextResponse.json({ success: true, item: rackingToRecord(rack), category: 'racking' });

    return NextResponse.json({ success: false, error: `Equipment ID '${id}' not found` }, { status: 404 });
  }

  // ── Category-filtered list ────────────────────────────────
  let panels: CECPanelRecord[] = [];
  let inverters: CECInverterRecord[] = [];
  let racking: RackingRecord[] = [];

  if (category === 'all' || category === 'panel' || category === 'solar_panel') {
    panels = SOLAR_PANELS.map(panelToRecord);
  }

  if (category === 'all' || category === 'string_inverter' || category === 'inverter') {
    inverters = [
      ...inverters,
      ...STRING_INVERTERS.map(stringInverterToRecord),
    ];
  }

  if (category === 'all' || category === 'microinverter' || category === 'micro') {
    inverters = [
      ...inverters,
      ...MICROINVERTERS.map(microinverterToRecord),
    ];
  }

  if (category === 'all' || category === 'optimizer') {
    inverters = [
      ...inverters,
      ...OPTIMIZERS.map(o => ({
        id: o.id,
        manufacturer: o.manufacturer,
        model: o.model,
        type: 'optimizer' as const,
        acOutputKw: 0,
        dcInputKwMax: o.dcInputWMax / 1000,
        maxDcVoltage: o.maxDcVoltage,
        mpptVoltageMin: o.mpptVoltageMin,
        mpptVoltageMax: o.mpptVoltageMax,
        efficiency: o.efficiency,
        cec_efficiency: o.efficiency,
        acOutputVoltage: 0,
        acOutputCurrentMax: o.maxOutputCurrent,
        weight: o.weight,
        warranty: o.warranty,
        ulListing: o.ulListing,
        rapidShutdownCompliant: false,
        datasheetUrl: o.datasheetUrl,
        source: 'CEC' as const,
      })),
    ];
  }

  if (category === 'all' || category === 'racking') {
    racking = RACKING_SYSTEMS.map(rackingToRecord);
  }

  // ── Apply filters ─────────────────────────────────────────
  if (manufacturer) {
    panels = panels.filter(p => p.manufacturer.toLowerCase().includes(manufacturer));
    inverters = inverters.filter(i => i.manufacturer.toLowerCase().includes(manufacturer));
    racking = racking.filter(r => r.manufacturer.toLowerCase().includes(manufacturer));
  }

  if (search) {
    panels = panels.filter(p =>
      p.manufacturer.toLowerCase().includes(search) ||
      p.model.toLowerCase().includes(search) ||
      p.id.toLowerCase().includes(search)
    );
    inverters = inverters.filter(i =>
      i.manufacturer.toLowerCase().includes(search) ||
      i.model.toLowerCase().includes(search) ||
      i.id.toLowerCase().includes(search)
    );
    racking = racking.filter(r =>
      r.manufacturer.toLowerCase().includes(search) ||
      r.model.toLowerCase().includes(search) ||
      r.id.toLowerCase().includes(search)
    );
  }

  return NextResponse.json({
    success: true,
    panels,
    inverters,
    racking,
    counts: {
      panels: panels.length,
      inverters: inverters.length,
      racking: racking.length,
      total: panels.length + inverters.length + racking.length,
    },
    source: 'CEC Solar Equipment Database + Internal Registry',
    lastUpdated: '2024-01',
  });
}

// POST for batch lookups
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json();
    const ids: string[] = body.ids ?? [];

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ success: false, error: 'ids array required' }, { status: 400 });
    }

    const results: Record<string, unknown> = {};

    for (const id of ids) {
      const panel = SOLAR_PANELS.find(p => p.id === id);
      if (panel) { results[id] = { ...panelToRecord(panel), category: 'panel' }; continue; }

      const strInv = STRING_INVERTERS.find(i => i.id === id);
      if (strInv) { results[id] = { ...stringInverterToRecord(strInv), category: 'string_inverter' }; continue; }

      const micro = MICROINVERTERS.find(m => m.id === id);
      if (micro) { results[id] = { ...microinverterToRecord(micro), category: 'microinverter' }; continue; }

      const rack = RACKING_SYSTEMS.find(r => r.id === id);
      if (rack) { results[id] = { ...rackingToRecord(rack), category: 'racking' }; continue; }

      results[id] = null; // not found
    }

    return NextResponse.json({ success: true, results, found: Object.values(results).filter(Boolean).length });

  } catch (err: unknown) {
    return handleRouteDbError('[app/api/engineering/equipment/route.ts]', err);
  }
}