// ============================================================
// POST /api/engineering/ironridge
// IronRidge Engineering API — structural calculations
// Computes: rail spans, attachment spacing, uplift ratings,
//           lag bolt sizing, rafter engagement, safety factors
// Based on IronRidge XR Rail Engineering Design Guide
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { handleRouteDbError } from '@/lib/db-neon';

export const dynamic = 'force-dynamic';
import { RACKING_SYSTEMS } from '@/lib/equipment-db';

// ── IronRidge Rail Specifications ────────────────────────────
const IRONRIDGE_RAILS = {
  'XR10': {
    model: 'XR10',
    partNumber: 'XR10-204B',
    material: '6005-T5 Aluminum',
    momentOfInertia: 0.213,   // in⁴
    sectionModulus: 0.142,    // in³
    allowableMoment: 1420,    // in-lbf (Fb × S)
    allowableShear: 1850,     // lbf
    maxSpan: 48,              // inches (conservative residential)
    weight: 0.85,             // lbs/ft
  },
  'XR100': {
    model: 'XR100',
    partNumber: 'XR100-204B',
    material: '6005-T5 Aluminum',
    momentOfInertia: 0.524,   // in⁴
    sectionModulus: 0.349,    // in³
    allowableMoment: 3490,    // in-lbf
    allowableShear: 3200,     // lbf
    maxSpan: 72,              // inches
    weight: 1.20,             // lbs/ft
  },
  'XR1000': {
    model: 'XR1000',
    partNumber: 'XR1000-204B',
    material: '6005-T5 Aluminum',
    momentOfInertia: 1.847,   // in⁴
    sectionModulus: 0.923,    // in³
    allowableMoment: 9230,    // in-lbf
    allowableShear: 7200,     // lbf
    maxSpan: 96,              // inches
    weight: 1.85,             // lbs/ft
  },
} as const;

// ── Lag Bolt Allowable Loads (ICC-ES ESR-1539) ───────────────
// 5/16" × 3" lag bolt into Douglas Fir / Southern Pine rafter
const LAG_BOLT_ALLOWABLE = {
  '5/16x3': {
    partNumber: 'LAG-516-3',
    diameter: 0.3125,         // inches
    length: 3.0,              // inches
    minEmbedment: 2.5,        // inches into rafter
    allowableWithdrawal: 266, // lbf per inch of embedment (Douglas Fir)
    allowableShear: 380,      // lbf lateral
    allowableUplift: 532,     // lbf (2" embedment × 266 lbf/in)
    notes: 'ICC-ES ESR-1539. Min 2.5" embedment into rafter.',
  },
  '3/8x3.5': {
    partNumber: 'LAG-38-35',
    diameter: 0.375,
    length: 3.5,
    minEmbedment: 2.5,
    allowableWithdrawal: 350,
    allowableShear: 520,
    allowableUplift: 700,
    notes: 'ICC-ES ESR-1539. Min 2.5" embedment into rafter.',
  },
} as const;

// ── Wind/Snow Load Defaults by Zone ──────────────────────────
const LOAD_DEFAULTS = {
  residential: {
    windPressure: 20,    // psf (ASCE 7-22 residential, Exposure B, 110 mph)
    snowLoad: 20,        // psf (ground snow load, moderate climate)
    deadLoad: 4,         // psf (panel + racking weight)
    safetyFactor: 1.5,   // ASD safety factor
  },
  highWind: {
    windPressure: 35,
    snowLoad: 20,
    deadLoad: 4,
    safetyFactor: 1.5,
  },
  highSnow: {
    windPressure: 20,
    snowLoad: 50,
    deadLoad: 4,
    safetyFactor: 1.5,
  },
} as const;

// ── Request/Response types ────────────────────────────────────

export interface IronRidgeCalcRequest {
  rackingId?: string;           // e.g. 'ironridge-xr100'
  railModel?: 'XR10' | 'XR100' | 'XR1000';
  moduleCount: number;
  moduleWidthIn: number;        // module width in inches (portrait)
  moduleLengthIn: number;       // module length in inches
  moduleWeightLbs: number;      // module weight in lbs
  rafterSpacingIn?: number;     // rafter spacing (default 24")
  roofPitchDeg?: number;        // roof pitch in degrees (default 18.4° = 4:12)
  windPressurePsf?: number;     // design wind pressure (psf)
  snowLoadPsf?: number;         // ground snow load (psf)
  loadZone?: 'residential' | 'highWind' | 'highSnow';
  lagBoltSize?: '5/16x3' | '3/8x3.5';
  arrayRows?: number;           // number of rows (default 2)
  arrayCols?: number;           // number of columns
}

export interface IronRidgeCalcResult {
  success: boolean;
  rackingId?: string;
  railModel?: string;
  railPartNumber?: string;

  // Span calculations
  maxAllowableSpanIn?: number;
  recommendedSpanIn?: number;
  attachmentSpacingIn?: number;
  attachmentsPerRail?: number;
  totalAttachments?: number;
  railSections?: number;
  totalRailLengthFt?: number;

  // Load calculations
  designWindPressurePsf?: number;
  designSnowLoadPsf?: number;
  totalDeadLoadLbs?: number;
  upliftPerAttachmentLbs?: number;
  downforcePerAttachmentLbs?: number;

  // Lag bolt sizing
  lagBoltSize?: string;
  lagBoltPartNumber?: string;
  lagBoltsPerAttachment?: number;
  allowableUpliftPerBoltLbs?: number;
  totalAllowableUpliftLbs?: number;
  safetyFactor?: number;
  safetyFactorAchieved?: number;
  passesUplift?: boolean;

  // Rafter engagement
  minEmbedmentIn?: number;
  rafterSpacingIn?: number;

  // BOM items
  bomItems?: Array<{
    category: string;
    manufacturer: string;
    model: string;
    partNumber: string;
    description: string;
    quantity: number;
    unit: string;
  }>;

  warnings?: string[];
  error?: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body: IronRidgeCalcRequest = await req.json();

    if (!body.moduleCount || body.moduleCount <= 0) {
      return NextResponse.json({ success: false, error: 'moduleCount required' }, { status: 400 });
    }

    const warnings: string[] = [];

    // ── Resolve rail model ────────────────────────────────────
    let railKey: keyof typeof IRONRIDGE_RAILS = 'XR100';
    if (body.railModel && body.railModel in IRONRIDGE_RAILS) {
      railKey = body.railModel;
    } else if (body.rackingId) {
      // Map racking ID to rail model
      if (body.rackingId.includes('xr10') && !body.rackingId.includes('xr100') && !body.rackingId.includes('xr1000')) {
        railKey = 'XR10';
      } else if (body.rackingId.includes('xr1000')) {
        railKey = 'XR1000';
      } else {
        railKey = 'XR100'; // default
      }
    }

    const rail = IRONRIDGE_RAILS[railKey];

    // ── Load zone defaults ────────────────────────────────────
    const zone = body.loadZone ?? 'residential';
    const loadDefaults = LOAD_DEFAULTS[zone];

    const windPressure = body.windPressurePsf ?? loadDefaults.windPressure;
    const snowLoad = body.snowLoadPsf ?? loadDefaults.snowLoad;
    const deadLoad = loadDefaults.deadLoad;
    const safetyFactor = loadDefaults.safetyFactor;

    // ── Module geometry ───────────────────────────────────────
    const moduleWidth = body.moduleWidthIn ?? 40.0;   // inches (portrait width)
    const moduleLength = body.moduleLengthIn ?? 66.0; // inches (portrait length)
    const moduleWeight = body.moduleWeightLbs ?? 42.0;
    const rafterSpacing = body.rafterSpacingIn ?? 24;  // inches
    const roofPitch = body.roofPitchDeg ?? 18.4;       // degrees (4:12)
    const lagBoltKey = body.lagBoltSize ?? '5/16x3';
    const lagBolt = LAG_BOLT_ALLOWABLE[lagBoltKey];

    // ── Array layout ──────────────────────────────────────────
    const arrayRows = body.arrayRows ?? 2;
    const arrayCols = body.arrayCols ?? Math.ceil(body.moduleCount / arrayRows);
    const totalModules = body.moduleCount;

    // ── Tributary area per attachment ─────────────────────────
    // For 2-rail portrait mount: tributary area = (span/2) × (module_width + overhang)
    // Conservative: use full span × module width
    const recommendedSpan = Math.min(rail.maxSpan, rafterSpacing * 2); // snap to rafter spacing
    const tributaryAreaFt2 = (recommendedSpan / 12) * (moduleWidth / 12);

    // ── Wind uplift calculation ───────────────────────────────
    // Net uplift pressure = wind pressure × Cp (uplift coefficient)
    // For roof-mounted arrays: Cp ≈ 1.0 (conservative per ASCE 7)
    const upliftPressure = windPressure * 1.0; // psf
    const upliftPerAttachment = upliftPressure * tributaryAreaFt2; // lbf

    // ── Snow/dead load (downforce) ────────────────────────────
    const downforcePressure = snowLoad + deadLoad; // psf
    const downforcePerAttachment = downforcePressure * tributaryAreaFt2; // lbf

    // ── Attachment count ──────────────────────────────────────
    // Per rail: attachments = ceil(rail_length / span) + 1
    // Rail length ≈ array width (cols × module_width)
    const arrayWidthIn = arrayCols * moduleWidth;
    const attachmentsPerRail = Math.ceil(arrayWidthIn / recommendedSpan) + 1;
    const totalRails = arrayRows * 2; // 2 rails per row (top + bottom)
    const totalAttachments = attachmentsPerRail * totalRails;

    // ── Rail sections ─────────────────────────────────────────
    // Standard rail section = 204" (17 ft)
    const railSectionLengthIn = 204;
    const railLengthPerRail = arrayWidthIn + 12; // add 6" overhang each end
    const sectionsPerRail = Math.ceil(railLengthPerRail / railSectionLengthIn);
    const totalRailSections = sectionsPerRail * totalRails;
    const totalRailLengthFt = (railLengthPerRail * totalRails) / 12;

    // ── Lag bolt sizing ───────────────────────────────────────
    // Required uplift capacity per attachment = upliftPerAttachment × safetyFactor
    const requiredUpliftCapacity = upliftPerAttachment * safetyFactor;
    const lagBoltsPerAttachment = 1; // Standard: 1 lag bolt per L-foot
    const allowableUpliftPerBolt = lagBolt.allowableUplift;
    const totalAllowableUplift = lagBoltsPerAttachment * allowableUpliftPerBolt;
    const safetyFactorAchieved = totalAllowableUplift / upliftPerAttachment;
    const passesUplift = safetyFactorAchieved >= safetyFactor;

    if (!passesUplift) {
      warnings.push(
        `Uplift safety factor ${safetyFactorAchieved.toFixed(2)} < required ${safetyFactor}. ` +
        `Consider reducing span to ${Math.floor(recommendedSpan * 0.8)}" or using 3/8" lag bolts.`
      );
    }

    if (windPressure > 30) {
      warnings.push('High wind zone: verify attachment spacing with licensed PE stamp.');
    }

    if (snowLoad > 40) {
      warnings.push('High snow load: verify rail span with licensed PE stamp.');
    }

    // ── Total dead load ───────────────────────────────────────
    const totalDeadLoad = totalModules * moduleWeight + totalRailLengthFt * rail.weight;

    // ── BOM items ─────────────────────────────────────────────
    const bomItems = [
      {
        category: 'rail',
        manufacturer: 'IronRidge',
        model: `${rail.model} Rail`,
        partNumber: rail.partNumber,
        description: `IronRidge ${rail.model} aluminum rail — ${railSectionLengthIn / 12}ft sections`,
        quantity: totalRailSections,
        unit: 'ea',
      },
      {
        category: 'l_foot',
        manufacturer: 'IronRidge',
        model: 'L-Foot',
        partNumber: 'LFT-0100-B',
        description: 'IronRidge L-Foot attachment — 1 per attachment point',
        quantity: totalAttachments,
        unit: 'ea',
      },
      {
        category: 'lag_bolt',
        manufacturer: 'IronRidge',
        model: `${lagBoltKey.replace('x', '" × ')} Lag Bolt`,
        partNumber: lagBolt.partNumber,
        description: `${lagBoltKey.replace('x', '" × ')} lag bolt — ${lagBolt.notes}`,
        quantity: totalAttachments * lagBoltsPerAttachment,
        unit: 'ea',
      },
      {
        category: 'flashing',
        manufacturer: 'IronRidge',
        model: 'EPDM Flashing',
        partNumber: 'FLS-0100-B',
        description: 'EPDM flashing for roof penetration waterproofing',
        quantity: totalAttachments,
        unit: 'ea',
      },
      {
        category: 'mid_clamp',
        manufacturer: 'IronRidge',
        model: 'UFO Mid Clamp',
        partNumber: 'UFO-MID-B',
        description: 'IronRidge UFO mid clamp — module-to-rail attachment',
        quantity: Math.max(0, totalModules * 2 - (arrayCols * 2 * arrayRows)), // interior clamps
        unit: 'ea',
      },
      {
        category: 'end_clamp',
        manufacturer: 'IronRidge',
        model: 'UFO End Clamp',
        partNumber: 'UFO-END-B',
        description: 'IronRidge UFO end clamp — array perimeter',
        quantity: arrayCols * 2 * arrayRows, // perimeter clamps
        unit: 'ea',
      },
      {
        category: 'splice',
        manufacturer: 'IronRidge',
        model: 'Rail Splice',
        partNumber: 'XR-SPLICE-B',
        description: 'IronRidge rail splice connector',
        quantity: Math.max(0, totalRailSections - totalRails), // splices = sections - rails
        unit: 'ea',
      },
      {
        category: 'grounding_lug',
        manufacturer: 'IronRidge',
        model: 'Grounding Lug',
        partNumber: 'GRD-LUG-B',
        description: 'IronRidge grounding lug — 1 per rail section per NEC 690.43',
        quantity: totalRailSections,
        unit: 'ea',
      },
    ];

    const result: IronRidgeCalcResult = {
      success: true,
      rackingId: body.rackingId ?? `ironridge-${railKey.toLowerCase()}`,
      railModel: rail.model,
      railPartNumber: rail.partNumber,

      maxAllowableSpanIn: rail.maxSpan,
      recommendedSpanIn: recommendedSpan,
      attachmentSpacingIn: recommendedSpan,
      attachmentsPerRail,
      totalAttachments,
      railSections: totalRailSections,
      totalRailLengthFt: parseFloat(totalRailLengthFt.toFixed(1)),

      designWindPressurePsf: windPressure,
      designSnowLoadPsf: snowLoad,
      totalDeadLoadLbs: parseFloat(totalDeadLoad.toFixed(1)),
      upliftPerAttachmentLbs: parseFloat(upliftPerAttachment.toFixed(1)),
      downforcePerAttachmentLbs: parseFloat(downforcePerAttachment.toFixed(1)),

      lagBoltSize: lagBoltKey,
      lagBoltPartNumber: lagBolt.partNumber,
      lagBoltsPerAttachment,
      allowableUpliftPerBoltLbs: allowableUpliftPerBolt,
      totalAllowableUpliftLbs: totalAllowableUplift,
      safetyFactor,
      safetyFactorAchieved: parseFloat(safetyFactorAchieved.toFixed(2)),
      passesUplift,

      minEmbedmentIn: lagBolt.minEmbedment,
      rafterSpacingIn: rafterSpacing,

      bomItems,
      warnings,
    };

    return NextResponse.json(result);

  } catch (err: unknown) {
    return handleRouteDbError('[app/api/engineering/ironridge/route.ts]', err);
  }
}

// GET for simple queries
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);

  const body: IronRidgeCalcRequest = {
    moduleCount:    parseInt(searchParams.get('moduleCount') ?? '20', 10),
    moduleWidthIn:  parseFloat(searchParams.get('moduleWidthIn') ?? '40'),
    moduleLengthIn: parseFloat(searchParams.get('moduleLengthIn') ?? '66'),
    moduleWeightLbs: parseFloat(searchParams.get('moduleWeightLbs') ?? '42'),
    railModel:      (searchParams.get('railModel') as 'XR10' | 'XR100' | 'XR1000') ?? 'XR100',
    loadZone:       (searchParams.get('loadZone') as 'residential' | 'highWind' | 'highSnow') ?? 'residential',
  };

  const mockReq = new NextRequest(req.url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });

  return POST(mockReq);
}