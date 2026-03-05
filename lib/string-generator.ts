// ============================================================
// Auto String Generator — NEC 690.7 Compliant
// Generates electrically valid PV string configurations from
// module + inverter specifications.
//
// NEC 690.7: Voc correction for minimum design temperature
// NEC 690.8: OCPD sizing (Isc × 1.25 × 1.25)
// NEC 690.9: String fusing requirements
// ============================================================

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface ModuleSpecs {
  voc:           number;   // Open-circuit voltage (V) at STC
  vmp:           number;   // Max power voltage (V) at STC
  isc:           number;   // Short-circuit current (A) at STC
  imp:           number;   // Max power current (A) at STC
  watts:         number;   // STC power (W)
  tempCoeffVoc:  number;   // Temperature coefficient of Voc (%/°C, negative, e.g. -0.27)
  tempCoeffVmp?: number;   // Temperature coefficient of Vmp (%/°C, negative)
  maxSeriesFuse: number;   // Max series fuse rating (A)
}

export interface InverterSpecs {
  maxDcVoltage:       number;   // Maximum DC input voltage (V)
  mpptVoltageMin:     number;   // MPPT minimum voltage (V)
  mpptVoltageMax:     number;   // MPPT maximum voltage (V)
  mpptChannels:       number;   // Number of MPPT inputs
  maxInputCurrentPerMppt?: number; // Max DC input current per MPPT (A)
  dcInputKwMax?:      number;   // Max DC input power (kW)
  acOutputKw:         number;   // AC output power (kW)
}

export interface StringGeneratorInput {
  totalModules:      number;
  moduleSpecs:       ModuleSpecs;
  inverterSpecs:     InverterSpecs;
  designTempMin?:    number;   // °C — minimum design temperature (default: -10°C)
  necVersion?:       string;   // '2020' | '2023' (default: '2020')
}

// A single generated string
export interface GeneratedString {
  stringIndex:    number;   // 0-based
  panelsInString: number;
  mpptChannel:    number;   // 0-based MPPT channel assignment
  vocCorrected:   number;   // Voc at design temp (V)
  vmpAtTemp:      number;   // Vmp at design temp (V)
  iscCorrected:   number;   // Isc at design temp (A)
  stringVoc:      number;   // Total string Voc (V)
  stringVmp:      number;   // Total string Vmp (V)
  stringIsc:      number;   // String Isc (A) = module Isc (strings in parallel share current)
  stringPower:    number;   // String power (W)
}

// MPPT channel summary
export interface MpptChannel {
  channelIndex:   number;
  strings:        GeneratedString[];
  totalVoc:       number;   // Max string Voc on this channel
  totalIsc:       number;   // Sum of string Isc on this channel
  totalPower:     number;   // Sum of string power on this channel
}

// Combiner/junction box type
export type CombinerType = 'DIRECT' | 'JUNCTION_BOX' | 'COMBINER_BOX';

export interface StringGeneratorResult {
  // Input echo
  totalModules:       number;
  designTempMin:      number;

  // NEC 690.7 correction
  tempCorrectionFactor: number;   // multiplier applied to Voc
  vocCorrected:         number;   // module Voc at design temp (V)
  vmpCorrected:         number;   // module Vmp at design temp (V)

  // String sizing limits
  maxPanelsPerString:   number;   // floor(inverter_max_V / vocCorrected)
  minPanelsPerString:   number;   // ceil(mppt_min_V / vmpCorrected)
  recommendedPanelsPerString: number; // optimal for MPPT center

  // Generated strings
  strings:              GeneratedString[];
  totalStrings:         number;

  // MPPT allocation
  mpptChannels:         MpptChannel[];

  // Combiner logic
  combinerType:         CombinerType;
  combinerLabel:        string;

  // System totals
  totalDcPower:         number;   // W
  totalDcVoltageMax:    number;   // Max string Voc (V)
  totalDcCurrentMax:    number;   // Sum of all string Isc (A)

  // NEC sizing
  ocpdPerString:        number;   // A — NEC 690.8: Isc × 1.25 × 1.25, rounded up to standard
  dcWireAmpacity:       number;   // A — minimum ampacity for DC conductors

  // Validation
  warnings:             string[];
  errors:               string[];
  isValid:              boolean;
}

// ─── NEC standard OCPD sizes ─────────────────────────────────────────────────
const STANDARD_OCPD = [15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200];

function nextStandardOCPD(amps: number): number {
  return STANDARD_OCPD.find(s => s >= amps) ?? Math.ceil(amps / 5) * 5;
}

// ─── Main generator ──────────────────────────────────────────────────────────

export function generateStringConfig(input: StringGeneratorInput): StringGeneratorResult {
  const {
    totalModules,
    moduleSpecs,
    inverterSpecs,
    designTempMin = -10,
    necVersion = '2020',
  } = input;

  const warnings: string[] = [];
  const errors:   string[] = [];

  // ─── NEC 690.7 Temperature Correction ────────────────────────────────────
  // Voc_corrected = Voc × [1 + (tempCoeffVoc/100) × (Tmin - 25)]
  // tempCoeffVoc is in %/°C (negative value, e.g. -0.27)
  const deltaT = designTempMin - 25; // always negative for cold temps
  const tempCorrectionFactor = 1 + (moduleSpecs.tempCoeffVoc / 100) * deltaT;
  const vocCorrected = moduleSpecs.voc * tempCorrectionFactor;

  // Vmp correction (use same coefficient if tempCoeffVmp not provided)
  const tempCoeffVmp = moduleSpecs.tempCoeffVmp ?? moduleSpecs.tempCoeffVoc;
  const vmpCorrected = moduleSpecs.vmp * (1 + (tempCoeffVmp / 100) * deltaT);

  // Isc correction (slight increase at cold temps — conservative, use STC value)
  const iscCorrected = moduleSpecs.isc; // conservative: use STC Isc

  // ─── String Sizing Limits ─────────────────────────────────────────────────
  // Max panels: inverter max DC voltage / corrected Voc (NEC 690.7)
  const maxPanelsPerString = Math.floor(inverterSpecs.maxDcVoltage / vocCorrected);

  // Min panels: MPPT minimum voltage / corrected Vmp
  const minPanelsPerString = Math.ceil(inverterSpecs.mpptVoltageMin / vmpCorrected);

  // Recommended: target MPPT center voltage
  const mpptCenter = (inverterSpecs.mpptVoltageMin + inverterSpecs.mpptVoltageMax) / 2;
  const recommendedPanelsPerString = Math.round(mpptCenter / moduleSpecs.vmp);

  // Clamp recommended to valid range
  const clampedRecommended = Math.max(
    minPanelsPerString,
    Math.min(maxPanelsPerString, recommendedPanelsPerString)
  );

  // Validate
  if (maxPanelsPerString < minPanelsPerString) {
    errors.push(
      `Inverter MPPT range incompatible with module Voc. ` +
      `Max panels/string=${maxPanelsPerString} < Min panels/string=${minPanelsPerString}. ` +
      `Check inverter MPPT voltage range vs module Voc.`
    );
  }

  if (maxPanelsPerString <= 0) {
    errors.push(`Invalid max panels per string (${maxPanelsPerString}). Check inverter max DC voltage.`);
  }

  // ─── String Distribution ──────────────────────────────────────────────────
  // Use max panels per string to minimize string count (fewer conductors)
  // Fill strings with maxPanelsPerString, last string gets remainder
  const panelsPerFullString = Math.min(maxPanelsPerString, clampedRecommended);
  const panelsPerFullStringFinal = panelsPerFullString > 0 ? panelsPerFullString : 1;

  const numFullStrings = Math.floor(totalModules / panelsPerFullStringFinal);
  const remainder = totalModules % panelsPerFullStringFinal;

  const stringPanelCounts: number[] = [];
  for (let i = 0; i < numFullStrings; i++) {
    stringPanelCounts.push(panelsPerFullStringFinal);
  }
  if (remainder > 0) {
    // Check if remainder string meets minimum
    if (remainder >= minPanelsPerString) {
      stringPanelCounts.push(remainder);
    } else {
      // Redistribute: take 1 panel from last full string to add to remainder
      if (stringPanelCounts.length > 0) {
        const lastFull = stringPanelCounts[stringPanelCounts.length - 1];
        if (lastFull - 1 >= minPanelsPerString && remainder + 1 >= minPanelsPerString) {
          stringPanelCounts[stringPanelCounts.length - 1] = lastFull - 1;
          stringPanelCounts.push(remainder + 1);
        } else {
          // Just add it with a warning
          stringPanelCounts.push(remainder);
          warnings.push(
            `Last string has ${remainder} panels which is below minimum ${minPanelsPerString}. ` +
            `Consider adjusting total module count.`
          );
        }
      } else {
        stringPanelCounts.push(remainder);
      }
    }
  }

  const totalStrings = stringPanelCounts.length;

  // ─── MPPT Channel Assignment ──────────────────────────────────────────────
  // Distribute strings evenly across MPPT channels
  const numMppt = Math.max(1, inverterSpecs.mpptChannels);
  const stringsPerMppt = Math.ceil(totalStrings / numMppt);

  // Check max input current per MPPT
  if (inverterSpecs.maxInputCurrentPerMppt) {
    const maxStringsPerMpptByCurrent = Math.floor(
      inverterSpecs.maxInputCurrentPerMppt / (iscCorrected * 1.25)
    );
    if (stringsPerMppt > maxStringsPerMpptByCurrent) {
      warnings.push(
        `${stringsPerMppt} strings per MPPT may exceed max input current. ` +
        `Max ${maxStringsPerMpptByCurrent} strings per MPPT based on ${inverterSpecs.maxInputCurrentPerMppt}A limit.`
      );
    }
  }

  // ─── Build Generated Strings ──────────────────────────────────────────────
  const generatedStrings: GeneratedString[] = stringPanelCounts.map((panelCount, idx) => {
    const mpptChannel = Math.floor(idx / stringsPerMppt);
    const stringVoc = vocCorrected * panelCount;
    const stringVmp = vmpCorrected * panelCount;
    const stringPower = moduleSpecs.watts * panelCount;

    // Validate string voltage
    if (stringVoc > inverterSpecs.maxDcVoltage) {
      errors.push(
        `String ${idx + 1}: Voc=${stringVoc.toFixed(1)}V exceeds inverter max ${inverterSpecs.maxDcVoltage}V. ` +
        `Reduce panels per string.`
      );
    }
    if (stringVmp < inverterSpecs.mpptVoltageMin) {
      warnings.push(
        `String ${idx + 1}: Vmp=${stringVmp.toFixed(1)}V is below MPPT minimum ${inverterSpecs.mpptVoltageMin}V.`
      );
    }
    if (stringVmp > inverterSpecs.mpptVoltageMax) {
      warnings.push(
        `String ${idx + 1}: Vmp=${stringVmp.toFixed(1)}V exceeds MPPT maximum ${inverterSpecs.mpptVoltageMax}V.`
      );
    }

    return {
      stringIndex:    idx,
      panelsInString: panelCount,
      mpptChannel:    Math.min(mpptChannel, numMppt - 1),
      vocCorrected,
      vmpAtTemp:      vmpCorrected,
      iscCorrected,
      stringVoc,
      stringVmp,
      stringIsc:      iscCorrected,   // each string carries module Isc
      stringPower,
    };
  });

  // ─── MPPT Channel Summary ─────────────────────────────────────────────────
  const mpptChannelMap = new Map<number, GeneratedString[]>();
  for (let i = 0; i < numMppt; i++) mpptChannelMap.set(i, []);
  for (const s of generatedStrings) {
    mpptChannelMap.get(s.mpptChannel)!.push(s);
  }

  const mpptChannels: MpptChannel[] = Array.from(mpptChannelMap.entries()).map(([idx, strings]) => ({
    channelIndex: idx,
    strings,
    totalVoc:   strings.length > 0 ? strings[0].stringVoc : 0,
    totalIsc:   strings.reduce((sum, s) => sum + s.stringIsc, 0),
    totalPower: strings.reduce((sum, s) => sum + s.stringPower, 0),
  }));

  // ─── Combiner Box Logic ───────────────────────────────────────────────────
  let combinerType: CombinerType;
  let combinerLabel: string;

  if (totalStrings <= 2) {
    combinerType = 'DIRECT';
    combinerLabel = 'Direct inverter connection';
  } else if (totalStrings <= 6) {
    combinerType = 'JUNCTION_BOX';
    combinerLabel = `Roof junction box (${totalStrings} strings)`;
  } else {
    combinerType = 'COMBINER_BOX';
    combinerLabel = `Combiner box (${totalStrings} strings)`;
  }

  // ─── System Totals ────────────────────────────────────────────────────────
  const totalDcPower = generatedStrings.reduce((sum, s) => sum + s.stringPower, 0);
  const totalDcVoltageMax = generatedStrings.length > 0
    ? Math.max(...generatedStrings.map(s => s.stringVoc))
    : 0;
  const totalDcCurrentMax = generatedStrings.reduce((sum, s) => sum + s.stringIsc, 0);

  // ─── NEC 690.8 OCPD Sizing ────────────────────────────────────────────────
  // OCPD = Isc × 1.25 (NEC 690.8(A)) — then round up to standard size
  // For string fusing: Isc × 1.25 × 1.25 per NEC 690.9
  const ocpdRaw = iscCorrected * 1.25 * 1.25;
  const ocpdPerString = nextStandardOCPD(ocpdRaw);

  // DC wire minimum ampacity = Isc × 1.25 (NEC 690.8)
  const dcWireAmpacity = iscCorrected * 1.25;

  // ─── Additional Warnings ──────────────────────────────────────────────────
  if (totalStrings > numMppt * 3) {
    warnings.push(
      `${totalStrings} strings across ${numMppt} MPPT channels (${Math.ceil(totalStrings/numMppt)} per channel). ` +
      `Consider a larger inverter or multiple inverters.`
    );
  }

  const dcPowerRatio = totalDcPower / (inverterSpecs.acOutputKw * 1000);
  if (dcPowerRatio > 1.5) {
    warnings.push(
      `DC/AC ratio is ${dcPowerRatio.toFixed(2)}. Recommended max is 1.5. ` +
      `Consider reducing module count or using a larger inverter.`
    );
  } else if (dcPowerRatio < 1.0) {
    warnings.push(
      `DC/AC ratio is ${dcPowerRatio.toFixed(2)}. Recommended minimum is 1.0. ` +
      `System may be undersized for the inverter.`
    );
  }

  return {
    totalModules,
    designTempMin,
    tempCorrectionFactor,
    vocCorrected,
    vmpCorrected,
    maxPanelsPerString,
    minPanelsPerString,
    recommendedPanelsPerString: clampedRecommended,
    strings: generatedStrings,
    totalStrings,
    mpptChannels,
    combinerType,
    combinerLabel,
    totalDcPower,
    totalDcVoltageMax,
    totalDcCurrentMax,
    ocpdPerString,
    dcWireAmpacity,
    warnings,
    errors,
    isValid: errors.length === 0,
  };
}

// ─── Helper: build ModuleSpecs from registry ElectricalSpecs ─────────────────
export function moduleSpecsFromRegistry(specs: {
  voc?: number; vmp?: number; isc?: number; imp?: number;
  watts?: number; tempCoeffVoc?: number; tempCoeffVmp?: number;
  maxSeriesFuseRating?: number;
}): ModuleSpecs {
  return {
    voc:           specs.voc           ?? 49.6,
    vmp:           specs.vmp           ?? 41.8,
    isc:           specs.isc           ?? 10.18,
    imp:           specs.imp           ?? 9.57,
    watts:         specs.watts         ?? 400,
    tempCoeffVoc:  specs.tempCoeffVoc  ?? -0.27,
    tempCoeffVmp:  specs.tempCoeffVmp,
    maxSeriesFuse: specs.maxSeriesFuseRating ?? 20,
  };
}

// ─── Helper: build InverterSpecs from registry ElectricalSpecs ───────────────
export function inverterSpecsFromRegistry(specs: {
  maxDcVoltage?: number; mpptVoltageMin?: number; mpptVoltageMax?: number;
  mpptChannels?: number; maxInputCurrent?: number; dcInputKwMax?: number;
  acOutputKw?: number;
}): InverterSpecs {
  return {
    maxDcVoltage:            specs.maxDcVoltage       ?? 600,
    mpptVoltageMin:          specs.mpptVoltageMin      ?? 100,
    mpptVoltageMax:          specs.mpptVoltageMax      ?? 600,
    mpptChannels:            specs.mpptChannels        ?? 2,
    maxInputCurrentPerMppt:  specs.maxInputCurrent,
    dcInputKwMax:            specs.dcInputKwMax,
    acOutputKw:              specs.acOutputKw          ?? 8.2,
  };
}

// ─── Helper: format string config for display ─────────────────────────────────
export function formatStringConfigSummary(result: StringGeneratorResult): string {
  const lines: string[] = [
    `${result.totalStrings} strings × ${result.strings[0]?.panelsInString ?? '?'} panels`,
  ];
  if (result.strings.some(s => s.panelsInString !== result.strings[0]?.panelsInString)) {
    const counts = result.strings.map(s => s.panelsInString);
    lines[0] = counts.join(' + ') + ' panels';
  }
  lines.push(`Voc (corrected): ${result.vocCorrected.toFixed(1)}V/module`);
  lines.push(`String Voc: ${result.strings[0]?.stringVoc.toFixed(1) ?? '?'}V`);
  lines.push(`MPPT: ${result.mpptChannels.length} channels`);
  lines.push(`Combiner: ${result.combinerLabel}`);
  return lines.join(' | ');
}