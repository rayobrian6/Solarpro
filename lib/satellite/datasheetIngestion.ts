// ============================================================================
// v47.441 - Datasheet Ingestion
//
// Ingests manufacturer datasheets (PDFs or HTML pages) from URLs and
// extracts hardware specs (wattage, efficiency, voltage, current, etc.)
// that feed into the equipment database.
//
// 3-layer extraction strategy:
//   1. PDF text extraction — fetch PDF, extract text via pdftotext,
//      then regex-parse spec values from the text
//   2. HTML scrape — if the URL is an HTML page (not a PDF),
//      scrape the page text and regex-parse spec values
//   3. Heuristic fallback — if no specs can be extracted from the content,
//      infer basic specs from the model name / URL path
//
// Each detected spec carries confidence + source for ConfidenceBadge.
// Results feed the ComputedField + ConfidenceBadge UX pattern.
//
// FUTURE ML INTEGRATION POINTS:
//   - Cloud Vision API for PDF image extraction (tables, charts)
//   - GPT-4 vision for spec table interpretation
//   - Structured data extraction from JSON-LD / schema.org markup
// ============================================================================

import type {
  DatasheetIngestionResult,
  DatasheetPanelSpecs,
  DatasheetInverterSpecs,
  DetectedSpec,
} from './types';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
export interface DatasheetIngestionInput {
  /** URL of the manufacturer datasheet (PDF or HTML) */
  url: string;
  /** Optional equipment type hint (if known from context) */
  equipmentTypeHint?: 'panel' | 'string_inverter' | 'microinverter' | 'optimizer';
  /** Optional manufacturer hint (if known from context) */
  manufacturerHint?: string;
  /** Optional model hint (if known from context) */
  modelHint?: string;
}

// ---------------------------------------------------------------------------
// Helper: create a DetectedSpec
// ---------------------------------------------------------------------------
function spec<T>(value: T, confidence: number, source: DetectedSpec<T>['source'], derivation: string): DetectedSpec<T> {
  return { value, confidence, source, derivation };
}

// ---------------------------------------------------------------------------
// Regex patterns for spec extraction
// ---------------------------------------------------------------------------

/** Common panel spec patterns found in datasheets */
const PANEL_PATTERNS = {
  wattage: [
    /(?:rated\s+)?power\s*(?:output)?[:\s]*(\d{2,4})\s*W/i,
    /(?:maximum\s+)?(?:power|pmax)[:\s]*(\d{2,4})\s*W/i,
    /(\d{2,4})\s*W\s*(?:rated|power|output)/i,
    /(\d{3,4})\s*W\b/,
  ],
  efficiency: [
    /module\s+efficiency[:\s]*(\d+(?:\.\d+)?)\s*%/i,
    /efficiency[:\s]*(\d+(?:\.\d+)?)\s*%/i,
    /(\d+(?:\.\d+)?)\s*%\s*(?:module\s+)?efficiency/i,
  ],
  voc: [
    /open[- ]circuit\s+voltage[:\s]*(\d+(?:\.\d+)?)\s*V/i,
    /voc[:\s]*(\d+(?:\.\d+)?)\s*V/i,
  ],
  vmp: [
    /(?:max(?:imum)?\s+)?power\s+voltage[:\s]*(\d+(?:\.\d+)?)\s*V/i,
    /vmp[:\s]*(\d+(?:\.\d+)?)\s*V/i,
  ],
  isc: [
    /short[- ]circuit\s+current[:\s]*(\d+(?:\.\d+)?)\s*A/i,
    /isc[:\s]*(\d+(?:\.\d+)?)\s*A/i,
  ],
  imp: [
    /(?:max(?:imum)?\s+)?power\s+current[:\s]*(\d+(?:\.\d+)?)\s*A/i,
    /imp[:\s]*(\d+(?:\.\d+)?)\s*A/i,
  ],
  tempCoeffVoc: [
    /temperature\s+coefficient\s+(?:of\s+)?voc[:\s]*-?(\d+(?:\.\d+)?)\s*%\/°C/i,
    /temp\.?\s*coeff\.?\s*(?:of\s+)?voc[:\s]*-?(\d+(?:\.\d+)?)\s*%/i,
  ],
  tempCoeffPmax: [
    /temperature\s+coefficient\s+(?:of\s+)?pmax[:\s]*-?(\d+(?:\.\d+)?)\s*%\/°C/i,
    /temp\.?\s*coeff\.?\s*(?:of\s+)?pmax[:\s]*-?(\d+(?:\.\d+)?)\s*%/i,
  ],
  maxSystemVoltage: [
    /max(?:imum)\s+system\s+voltage[:\s]*(\d+)\s*V/i,
    /system\s+voltage[:\s]*(\d+)\s*V/i,
  ],
  weight: [
    /weight[:\s]*(\d+(?:\.\d+)?)\s*(?:kg|lbs?|lb)/i,
    /(\d+(?:\.\d+)?)\s*(?:kg|lbs?)\s*$/im,
  ],
  dimensions: [
    /dimensions[:\s]*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i,
    /(\d+(?:\.\d+)?)\s*mm\s*[x×]\s*(\d+(?:\.\d+)?)\s*mm\s*[x×]\s*(\d+(?:\.\d+)?)\s*mm/i,
    /(\d+(?:\.\d+)?)\s*in\s*[x×]\s*(\d+(?:\.\d+)?)\s*in\s*[x×]\s*(\d+(?:\.\d+)?)\s*in/i,
  ],
  cellType: [
    /(mono[\s-]?PERC)/i,
    /(N-type\s+TOPCon)/i,
    /(HJT|heterojunction)/i,
    /(poly|polycrystalline)/i,
    /(mono|monocrystalline)/i,
  ],
  bifacial: [
    /\bbifacial\b/i,
  ],
  warranty: [
    /(\d+)\s*[-–]\s*year\s+(?:product\s+)?warranty/i,
    /warranty[:\s]*(\d+)\s*years?/i,
  ],
  ulListing: [
    /UL\s+(\d+)/i,
    /UL\s+listed/i,
  ],
};

/** Common inverter spec patterns */
const INVERTER_PATTERNS = {
  acOutputW: [
    /(?:rated|nominal|maximum)\s+ac\s+(?:output\s+)?power[:\s]*(\d+(?:\.\d+)?)\s*(?:W|kW)/i,
    /ac\s+(?:output|power)[:\s]*(\d+(?:\.\d+)?)\s*(?:W|kW)/i,
  ],
  dcInputWMax: [
    /(?:maximum\s+)?dc\s+input\s+power[:\s]*(\d+(?:\.\d+)?)\s*(?:W|kW)/i,
    /dc\s+input[:\s]*(\d+(?:\.\d+)?)\s*(?:W|kW)/i,
  ],
  maxDcVoltage: [
    /max(?:imum)\s+dc\s+voltage[:\s]*(\d+)\s*V/i,
    /dc\s+voltage\s+range[:\s]*(\d+)/i,
  ],
  mpptVoltageMin: [
    /mppt\s+voltage\s+range[:\s]*(\d+)\s*[-–]\s*(\d+)\s*V/i,
    /mppt\s+(?:operating\s+)?range[:\s]*(\d+)\s*V/i,
  ],
  mpptVoltageMax: [
    /mppt\s+voltage\s+range[:\s]*(\d+)\s*[-–]\s*(\d+)\s*V/i,
  ],
  efficiency: [
    /(?:maximum\s+)?efficiency[:\s]*(\d+(?:\.\d+)?)\s*%/i,
    /cec\s+efficiency[:\s]*(\d+(?:\.\d+)?)\s*%/i,
  ],
  cecEfficiency: [
    /cec\s+efficiency[:\s]*(\d+(?:\.\d+)?)\s*%/i,
    /california\s+energy\s+commission\s+efficiency[:\s]*(\d+(?:\.\d+)?)\s*%/i,
  ],
  weight: [
    /weight[:\s]*(\d+(?:\.\d+)?)\s*(?:kg|lbs?|lb)/i,
  ],
  warranty: [
    /(\d+)\s*[-–]\s*year\s+(?:product\s+)?warranty/i,
    /warranty[:\s]*(\d+)\s*years?/i,
  ],
  ulListing: [
    /UL\s+(\d+)/i,
    /UL\s+1741/i,
  ],
};

// ---------------------------------------------------------------------------
// Manufacturer detection from URL and content
// ---------------------------------------------------------------------------

/** Known solar manufacturers with URL patterns and common model prefixes */
const MANUFACTURER_PATTERNS: Array<{
  pattern: RegExp;
  manufacturer: string;
  type: 'panel' | 'string_inverter' | 'microinverter' | 'optimizer';
}> = [
  // Panels
  { pattern: /sunpower/i, manufacturer: 'SunPower', type: 'panel' },
  { pattern: /recgroup|rec\s*alpha/i, manufacturer: 'REC', type: 'panel' },
  { pattern: /panasonic.*evervolt/i, manufacturer: 'Panasonic', type: 'panel' },
  { pattern: /jinkosolar|jinko/i, manufacturer: 'Jinko Solar', type: 'panel' },
  { pattern: /canadiansolar|csi\s*solar/i, manufacturer: 'Canadian Solar', type: 'panel' },
  { pattern: /longi/i, manufacturer: 'LONGi', type: 'panel' },
  { pattern: /trinasolar|trina/i, manufacturer: 'Trina Solar', type: 'panel' },
  { pattern: /qcells|q\s*cells/i, manufacturer: 'Qcells', type: 'panel' },
  { pattern: /silfab/i, manufacturer: 'Silfab', type: 'panel' },
  { pattern: /hyundai.*energy/i, manufacturer: 'Hyundai', type: 'panel' },
  { pattern: /lg.*energy|lg.*neon/i, manufacturer: 'LG', type: 'panel' },
  // Inverters
  { pattern: /solaredge/i, manufacturer: 'SolarEdge', type: 'string_inverter' },
  { pattern: /fronius/i, manufacturer: 'Fronius', type: 'string_inverter' },
  { pattern: /sma.*sunny/i, manufacturer: 'SMA', type: 'string_inverter' },
  { pattern: /goodwe/i, manufacturer: 'GoodWe', type: 'string_inverter' },
  { pattern: /huawei.*fusion/i, manufacturer: 'Huawei', type: 'string_inverter' },
  // Microinverters
  { pattern: /enphase|iq8/i, manufacturer: 'Enphase', type: 'microinverter' },
  { pattern: /apmicro.*ds3|apm/i, manufacturer: 'APmicro', type: 'microinverter' },
  { pattern: /hoymiles/i, manufacturer: 'Hoymiles', type: 'microinverter' },
  // Optimizers
  { pattern: /solaredge.*optimizer|p[- ]?series/i, manufacturer: 'SolarEdge', type: 'optimizer' },
];

/**
 * Detect manufacturer and equipment type from URL and content.
 */
function detectManufacturer(
  url: string,
  text: string,
): {
  manufacturer: string | null;
  equipmentType: 'panel' | 'string_inverter' | 'microinverter' | 'optimizer' | null;
} {
  const combined = `${url} ${text.substring(0, 2000)}`.toLowerCase();

  for (const mp of MANUFACTURER_PATTERNS) {
    if (mp.pattern.test(combined)) {
      return { manufacturer: mp.manufacturer, equipmentType: mp.type };
    }
  }

  return { manufacturer: null, equipmentType: null };
}

/**
 * Extract model name from datasheet text.
 * Looks for patterns like "JKM570-590N-72HL4" or "IQ8H-72-T" etc.
 */
function extractModelName(text: string): string | null {
  const modelPatterns = [
    // Jinko: JKM570-590N-72HL4-BDV-F30
    /(?:JKM|JKM\d{3})[\w-]+/i,
    // Canadian Solar: CS7L-MS
    /CS[\d\w]+-[\d\w]+/i,
    // REC: RECxxxAA
    /REC\d{3,4}\w*/i,
    // SunPower: SPR-X22-360
    /SPR-[\w-]+/i,
    // Qcells: Q.PEAK DUO
    /Q\.\w+\s+\w+/i,
    // Enphase: IQ8H-72-T, IQ8M-24-12
    /IQ\d\w?-\d+-\d+/i,
    // SolarEdge: SE\d+K
    /SE\d{3,4}\w*/i,
    // Fronius: Fronius Primo
    /Fronius\s+\w+/i,
    // SMA: Sunny Boy
    /Sunny\s+\w+\s+\d+/i,
    // Silfab: SIL-430
    /SIL-\d+/i,
    // Generic: model + alphanumeric
    /(?:model|type|part\s*#)[:\s]*([A-Z0-9][-A-Z0-9]{3,30})/i,
  ];

  for (const pattern of modelPatterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1] || match[0];
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Regex spec extraction from text
// ---------------------------------------------------------------------------

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1] || m[0];
  }
  return null;
}

/**
 * Extract panel specs from text using regex patterns.
 */
function extractPanelSpecsFromText(text: string): DatasheetPanelSpecs {
  const w = firstMatch(text, PANEL_PATTERNS.wattage);
  const eff = firstMatch(text, PANEL_PATTERNS.efficiency);
  const vocVal = firstMatch(text, PANEL_PATTERNS.voc);
  const vmpVal = firstMatch(text, PANEL_PATTERNS.vmp);
  const iscVal = firstMatch(text, PANEL_PATTERNS.isc);
  const impVal = firstMatch(text, PANEL_PATTERNS.imp);
  const tcVoc = firstMatch(text, PANEL_PATTERNS.tempCoeffVoc);
  const tcPmax = firstMatch(text, PANEL_PATTERNS.tempCoeffPmax);
  const maxSysV = firstMatch(text, PANEL_PATTERNS.maxSystemVoltage);
  const wt = firstMatch(text, PANEL_PATTERNS.weight);
  const dims = text.match(PANEL_PATTERNS.dimensions[0]) ||
               text.match(PANEL_PATTERNS.dimensions[1]) ||
               text.match(PANEL_PATTERNS.dimensions[2]);
  const ct = firstMatch(text, PANEL_PATTERNS.cellType);
  const bifi = PANEL_PATTERNS.bifacial[0].test(text);
  const war = firstMatch(text, PANEL_PATTERNS.warranty);
  const ul = firstMatch(text, PANEL_PATTERNS.ulListing);

  return {
    wattage: w ? spec(parseFloat(w), 0.8, 'regex-parse', `Extracted wattage: ${w}W from datasheet text`) : null,
    efficiency: eff ? spec(parseFloat(eff), 0.75, 'regex-parse', `Extracted efficiency: ${eff}% from datasheet text`) : null,
    voc: vocVal ? spec(parseFloat(vocVal), 0.8, 'regex-parse', `Extracted Voc: ${vocVal}V from datasheet text`) : null,
    vmp: vmpVal ? spec(parseFloat(vmpVal), 0.8, 'regex-parse', `Extracted Vmp: ${vmpVal}V from datasheet text`) : null,
    isc: iscVal ? spec(parseFloat(iscVal), 0.8, 'regex-parse', `Extracted Isc: ${iscVal}A from datasheet text`) : null,
    imp: impVal ? spec(parseFloat(impVal), 0.8, 'regex-parse', `Extracted Imp: ${impVal}A from datasheet text`) : null,
    tempCoeffVoc: tcVoc ? spec(-parseFloat(tcVoc), 0.7, 'regex-parse', `Extracted temp coeff Voc: -${tcVoc}%/°C from datasheet text`) : null,
    tempCoeffPmax: tcPmax ? spec(-parseFloat(tcPmax), 0.7, 'regex-parse', `Extracted temp coeff Pmax: -${tcPmax}%/°C from datasheet text`) : null,
    maxSystemVoltage: maxSysV ? spec(parseFloat(maxSysV), 0.85, 'regex-parse', `Extracted max system voltage: ${maxSysV}V from datasheet text`) : null,
    weight: wt ? spec(parseFloat(wt), 0.7, 'regex-parse', `Extracted weight: ${wt} from datasheet text`) : null,
    length: dims ? spec(parseFloat(dims[1]), 0.6, 'regex-parse', `Extracted dimension from datasheet text`) : null,
    width: dims ? spec(parseFloat(dims[2]), 0.6, 'regex-parse', `Extracted dimension from datasheet text`) : null,
    thickness: dims ? spec(parseFloat(dims[3]), 0.6, 'regex-parse', `Extracted dimension from datasheet text`) : null,
    cellType: ct ? spec(ct, 0.65, 'regex-parse', `Detected cell type: ${ct} from datasheet text`) : null,
    bifacial: bifi ? spec(true, 0.8, 'regex-parse', 'Bifacial keyword detected in datasheet text') : null,
    warranty: war ? spec(`${war}-year`, 0.7, 'regex-parse', `Extracted warranty: ${war} years from datasheet text`) : null,
    ulListing: ul ? spec(`UL ${ul}`, 0.75, 'regex-parse', `Extracted UL listing from datasheet text`) : null,
  };
}

/**
 * Extract inverter specs from text using regex patterns.
 */
function extractInverterSpecsFromText(text: string): DatasheetInverterSpecs {
  const acW = firstMatch(text, INVERTER_PATTERNS.acOutputW);
  const dcIn = firstMatch(text, INVERTER_PATTERNS.dcInputWMax);
  const maxDcV = firstMatch(text, INVERTER_PATTERNS.maxDcVoltage);
  const mpptRange = text.match(INVERTER_PATTERNS.mpptVoltageMin[0]);
  const eff = firstMatch(text, INVERTER_PATTERNS.efficiency);
  const cecEff = firstMatch(text, INVERTER_PATTERNS.cecEfficiency);
  const wt = firstMatch(text, INVERTER_PATTERNS.weight);
  const war = firstMatch(text, INVERTER_PATTERNS.warranty);
  const ul = firstMatch(text, INVERTER_PATTERNS.ulListing);

  // Handle kW → W conversion
  // Escape the captured number before building a RegExp — a decimal like "7.6"
  // has a '.' that would otherwise match any char (e.g. "7X6 kW"), spuriously
  // triggering the ×1000 kW conversion and inflating AC output 1000×.
  const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const acWVal = acW ? parseFloat(acW) : null;
  const acWFinal = acWVal !== null ? (text.match(new RegExp(`${escRe(String(acW))}\\s*kW`, 'i')) ? acWVal * 1000 : acWVal) : null;

  const dcInVal = dcIn ? parseFloat(dcIn) : null;
  const dcInFinal = dcInVal !== null ? (text.match(new RegExp(`${escRe(String(dcIn))}\\s*kW`, 'i')) ? dcInVal * 1000 : dcInVal) : null;

  let mpptMin: number | null = null;
  let mpptMax: number | null = null;
  if (mpptRange) {
    mpptMin = parseFloat(mpptRange[1]);
    mpptMax = parseFloat(mpptRange[2]);
  }

  return {
    acOutputW: acWFinal !== null ? spec(acWFinal, 0.8, 'regex-parse', `Extracted AC output: ${acW} from datasheet text`) : null,
    dcInputWMax: dcInFinal !== null ? spec(dcInFinal, 0.75, 'regex-parse', `Extracted DC input: ${dcIn} from datasheet text`) : null,
    maxDcVoltage: maxDcV ? spec(parseFloat(maxDcV), 0.8, 'regex-parse', `Extracted max DC voltage: ${maxDcV}V from datasheet text`) : null,
    mpptVoltageMin: mpptMin !== null ? spec(mpptMin, 0.75, 'regex-parse', `Extracted MPPT min voltage: ${mpptMin}V from datasheet text`) : null,
    mpptVoltageMax: mpptMax !== null ? spec(mpptMax, 0.75, 'regex-parse', `Extracted MPPT max voltage: ${mpptMax}V from datasheet text`) : null,
    efficiency: eff ? spec(parseFloat(eff), 0.75, 'regex-parse', `Extracted efficiency: ${eff}% from datasheet text`) : null,
    cecEfficiency: cecEff ? spec(parseFloat(cecEff), 0.8, 'regex-parse', `Extracted CEC efficiency: ${cecEff}% from datasheet text`) : null,
    weight: wt ? spec(parseFloat(wt), 0.7, 'regex-parse', `Extracted weight: ${wt} from datasheet text`) : null,
    warranty: war ? spec(`${war}-year`, 0.7, 'regex-parse', `Extracted warranty: ${war} years from datasheet text`) : null,
    ulListing: ul ? spec(`UL ${ul}`, 0.75, 'regex-parse', `Extracted UL listing from datasheet text`) : null,
  };
}

// ---------------------------------------------------------------------------
// Heuristic spec inference from model name / URL
// ---------------------------------------------------------------------------

/**
 * Infer basic panel specs from the model name.
 * E.g. "JKM570N" → ~570W panel, ~21% efficiency
 * E.g. "SPR-X22-360" → ~360W panel, ~22% efficiency
 */
function heuristicPanelSpecs(
  modelName: string | null,
  manufacturer: string | null,
): DatasheetPanelSpecs {
  let wattage: DetectedSpec<number> | null = null;

  // Try to extract wattage from model name (3-4 digit number typically = wattage)
  if (modelName) {
    const wattMatch = modelName.match(/(\d{3,4})/);
    if (wattMatch) {
      const w = parseInt(wattMatch[1]);
      // Reasonable panel wattage range: 100W - 700W
      if (w >= 100 && w <= 700) {
        wattage = spec(w, 0.35, 'heuristic',
          `Inferred wattage from model name: ${modelName}`);
      }
    }
  }

  // Infer efficiency from wattage (rough correlation)
  let efficiency: DetectedSpec<number> | null = null;
  if (wattage) {
    // Rough: higher wattage panels tend to be more efficient
    const estEff = wattage.value > 500 ? 21.5 : wattage.value > 400 ? 20.5 : 19.5;
    efficiency = spec(estEff, 0.2, 'heuristic',
      `Rough efficiency estimate based on ${wattage.value}W wattage`);
  }

  // Bifacial inference from manufacturer + wattage
  let bifacial: DetectedSpec<boolean> | null = null;
  if (modelName?.toLowerCase().includes('bif') || modelName?.toLowerCase().includes('bdv')) {
    bifacial = spec(true, 0.6, 'heuristic', 'Bifacial inferred from model name suffix');
  }

  return {
    wattage,
    efficiency,
    voc: null,
    vmp: null,
    isc: null,
    imp: null,
    tempCoeffVoc: null,
    tempCoeffPmax: null,
    maxSystemVoltage: null,
    weight: null,
    length: null,
    width: null,
    thickness: null,
    cellType: null,
    bifacial,
    warranty: null,
    ulListing: null,
  };
}

/**
 * Infer basic inverter specs from the model name.
 * E.g. "SE7600H" → ~7600W inverter
 * E.g. "IQ8H-72" → ~240W microinverter
 */
function heuristicInverterSpecs(
  modelName: string | null,
  _manufacturer: string | null,
): DatasheetInverterSpecs {
  let acOutputW: DetectedSpec<number> | null = null;

  if (modelName) {
    // SolarEdge: SE7600H → 7600W
    const seMatch = modelName.match(/SE(\d{4})/i);
    if (seMatch) {
      acOutputW = spec(parseInt(seMatch[1]), 0.4, 'heuristic',
        `Inferred AC output from SolarEdge model: ${modelName}`);
    }

    // Enphase: IQ8H → ~240W (based on known mapping)
    const iqMatch = modelName.match(/IQ(\d)(\w?)/i);
    if (iqMatch) {
      const iqPowerMap: Record<string, number> = {
        '7': 250, '8': 240, '8H': 240, '8M': 280, '8P': 330,
      };
      const key = `${iqMatch[1]}${iqMatch[2] || ''}`;
      const p = iqPowerMap[key];
      if (p) {
        acOutputW = spec(p, 0.4, 'heuristic',
          `Inferred AC output from Enphase model: ${modelName}`);
      }
    }

    // Generic 4-digit number in model name → likely wattage
    if (!acOutputW) {
      const genMatch = modelName.match(/(\d{3,5})/);
      if (genMatch) {
        const w = parseInt(genMatch[1]);
        if (w >= 1000 && w <= 50000) {
          acOutputW = spec(w, 0.25, 'heuristic',
            `Inferred AC output from model name: ${modelName}`);
        } else if (w >= 100 && w < 1000) {
          acOutputW = spec(w, 0.25, 'heuristic',
            `Inferred AC output from model name: ${modelName}`);
        }
      }
    }
  }

  return {
    acOutputW,
    dcInputWMax: null,
    maxDcVoltage: null,
    mpptVoltageMin: null,
    mpptVoltageMax: null,
    efficiency: null,
    cecEfficiency: null,
    weight: null,
    warranty: null,
    ulListing: null,
  };
}

// ---------------------------------------------------------------------------
// PDF text extraction
// ---------------------------------------------------------------------------

/**
 * Fetch a PDF from a URL and extract text using pdftotext CLI.
 * Returns null if the URL is not a PDF or if extraction fails.
 */
async function extractTextFromPdf(url: string): Promise<string | null> {
  try {
    // Only attempt for URLs that look like PDFs
    if (!url.toLowerCase().endsWith('.pdf') && !url.toLowerCase().includes('.pdf?')) {
      return null;
    }

    const { execSync } = await import('child_process');
    const { writeFileSync, unlinkSync, mkdtempSync } = await import('fs');
    const { join } = await import('path');
    const { tmpdir } = await import('os');

    // Download the PDF
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'SolarPro-DatasheetBot/1.0' },
    });

    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('pdf') && !url.endsWith('.pdf')) return null;

    const buffer = Buffer.from(await res.arrayBuffer());

    // Write to temp file
    const tmpDir = mkdtempSync(join(tmpdir(), 'dspdf-'));
    const pdfPath = join(tmpDir, 'datasheet.pdf');
    const txtPath = join(tmpDir, 'datasheet.txt');

    try {
      writeFileSync(pdfPath, buffer);

      // Extract text using pdftotext
      execSync(`pdftotext -layout "${pdfPath}" "${txtPath}"`, {
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });

      const { readFileSync } = await import('fs');
      const text = readFileSync(txtPath, 'utf-8');

      return text || null;
    } finally {
      try { unlinkSync(pdfPath); } catch { /* ignore */ }
      try { unlinkSync(txtPath); } catch { /* ignore */ }
      try { const { rmdirSync } = await import('fs'); rmdirSync(tmpDir); } catch { /* ignore */ }
    }
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// HTML text extraction
// ---------------------------------------------------------------------------

/**
 * Fetch an HTML page and extract visible text content.
 * Simple approach: fetch, strip tags, return text.
 */
async function extractTextFromHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'SolarPro-DatasheetBot/1.0' },
    });

    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      return null;
    }

    const html = await res.text();

    // Strip HTML tags to get raw text
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#\d+;/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    return text || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main ingestion function
// ---------------------------------------------------------------------------

/**
 * Ingest a manufacturer datasheet URL and extract hardware specs.
 *
 * Strategy:
 *   1. If URL ends in .pdf → fetch PDF, extract text via pdftotext, regex-parse specs
 *   2. If URL is HTML → scrape page text, regex-parse specs
 *   3. If no specs extracted → heuristic inference from model name / URL
 *
 * Each spec carries confidence + source for ConfidenceBadge.
 */
export async function ingestDatasheet(
  input: DatasheetIngestionInput,
): Promise<DatasheetIngestionResult> {
  const { url, equipmentTypeHint, manufacturerHint, modelHint } = input;

  let text: string | null = null;
  let method: DatasheetIngestionResult['method'] = 'none';

  // ── Layer 1: PDF text extraction ─────────────────────────────────────────
  if (url.toLowerCase().endsWith('.pdf') || url.toLowerCase().includes('.pdf?')) {
    const pdfText = await extractTextFromPdf(url);
    if (pdfText && pdfText.length > 100) {
      text = pdfText;
      method = 'pdf-ocr';
    }
  }

  // ── Layer 2: HTML scrape ─────────────────────────────────────────────────
  if (!text) {
    const htmlText = await extractTextFromHtml(url);
    if (htmlText && htmlText.length > 100) {
      text = htmlText;
      method = 'html-scrape';
    }
  }

  // ── Detect manufacturer and equipment type ──────────────────────────────
  const urlAndHint = `${url} ${manufacturerHint || ''} ${modelHint || ''}`;
  const detected = detectManufacturer(url, text || urlAndHint);

  const manufacturer = manufacturerHint || detected.manufacturer;
  const equipmentType = equipmentTypeHint || detected.equipmentType;

  // ── Extract model name ──────────────────────────────────────────────────
  const modelName = modelHint || (text ? extractModelName(text) : null);

  // ── Extract specs based on equipment type ────────────────────────────────
  let panelSpecs: DatasheetPanelSpecs | null = null;
  let inverterSpecs: DatasheetInverterSpecs | null = null;

  if (text) {
    if (equipmentType === 'panel') {
      panelSpecs = extractPanelSpecsFromText(text);
      method = 'regex-parse';
    } else if (equipmentType === 'string_inverter' || equipmentType === 'microinverter') {
      inverterSpecs = extractInverterSpecsFromText(text);
      method = 'regex-parse';
    } else {
      // Try both — whichever has more non-null fields wins
      const pSpecs = extractPanelSpecsFromText(text);
      const iSpecs = extractInverterSpecsFromText(text);

      const pCount = Object.values(pSpecs).filter(v => v !== null).length;
      const iCount = Object.values(iSpecs).filter(v => v !== null).length;

      if (pCount > iCount) {
        panelSpecs = pSpecs;
        method = 'regex-parse';
      } else if (iCount > 0) {
        inverterSpecs = iSpecs;
        method = 'regex-parse';
      }
    }
  }

  // ── Layer 3: Heuristic fallback ─────────────────────────────────────────
  if (!panelSpecs && !inverterSpecs) {
    method = 'heuristic';

    if (equipmentType === 'panel') {
      panelSpecs = heuristicPanelSpecs(modelName, manufacturer);
    } else if (equipmentType === 'string_inverter' || equipmentType === 'microinverter') {
      inverterSpecs = heuristicInverterSpecs(modelName, manufacturer);
    } else if (manufacturer) {
      // Default to panel if manufacturer is known as a panel maker
      panelSpecs = heuristicPanelSpecs(modelName, manufacturer);
    }
  }

  return {
    equipmentType: equipmentType
      ? spec(equipmentType, 0.7, method === 'heuristic' ? 'heuristic' : 'regex-parse',
          `Detected equipment type: ${equipmentType}`)
      : null,
    manufacturer: manufacturer
      ? spec(manufacturer, 0.75, method === 'heuristic' ? 'heuristic' : 'regex-parse',
          `Detected manufacturer: ${manufacturer}`)
      : null,
    model: modelName
      ? spec(modelName, 0.7, method === 'heuristic' ? 'heuristic' : 'regex-parse',
          `Extracted model: ${modelName}`)
      : null,
    panelSpecs,
    inverterSpecs,
    method,
    sourceUrl: url,
    ingestedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Future ML integration points
// ---------------------------------------------------------------------------

/**
 * FUTURE: Use cloud vision API to extract specs from datasheet images/tables.
 * Currently returns null — placeholder for future implementation.
 */
export async function extractSpecsWithVision(
  _imageUrl: string,
): Promise<DatasheetPanelSpecs | DatasheetInverterSpecs | null> {
  // TODO: Implement GPT-4 Vision / Cloud Vision API extraction
  // 1. Send datasheet page image to vision API
  // 2. Ask model to extract structured spec data from tables
  // 3. Parse response into DatasheetPanelSpecs / DatasheetInverterSpecs
  return null;
}
