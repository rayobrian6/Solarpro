// ============================================================
// SolarPro Rules Engine V3
// Deterministic NEC 690/705 + ASCE 7-22 rules with dependency graph
// ============================================================

import { ElectricalCalcInput, runElectricalCalc, ElectricalCalcResult } from './electrical-calc';
import { StructuralInput, runStructuralCalc, StructuralCalcResult } from './structural-calc';
import { resolveStructural, StructuralAutoResolutionResult } from './structural-resolver';

export type RuleSeverity = 'error' | 'warning' | 'info' | 'pass';

export interface RuleResult {
  ruleId: string;
  category: 'electrical' | 'structural' | 'equipment' | 'bom';
  severity: RuleSeverity;
  title: string;
  message: string;
  value?: string | number;
  limit?: string | number;
  necReference?: string;
  asceReference?: string;
  autoFixed?: boolean;
  autoFixDescription?: string;
  overridable?: boolean;
  overrideField?: string;
}

export interface OverrideEntry {
  id: string;
  field: string;
  originalValue: string | number;
  overrideValue: string | number;
  justification: string;
  engineer: string;
  timestamp: string;
  necReference?: string;
  ruleId?: string;
}

export interface RulesEngineInput {
  electrical: ElectricalCalcInput;
  structural: StructuralInput;
  engineeringMode: 'AUTO' | 'MANUAL';
  overrides: OverrideEntry[];
}

export interface StructuralAutoResolution {
  field: string;
  originalValue: string | number;
  resolvedValue: string | number;
  reason: string;
  necReference: string;
}

export interface RulesEngineResult {
  electricalResult: ElectricalCalcResult;
  structuralResult: StructuralCalcResult;
  rules: RuleResult[];
  overallStatus: 'PASS' | 'WARNING' | 'FAIL';
  errorCount: number;
  warningCount: number;
  autoFixCount: number;
  overrideCount: number;
  dependencyChain: string[];
  structuralAutoResolutions: StructuralAutoResolution[];
}

export const DEPENDENCY_MAP: Record<string, string[]> = {
  panelIsc:         ['NEC_690_8_CURRENT', 'NEC_690_9_OCPD', 'NEC_310_WIRE'],
  panelVoc:         ['NEC_690_7_VOLTAGE', 'NEC_690_8_CURRENT'],
  panelCount:       ['NEC_690_8_CURRENT', 'NEC_705_12_BUSBAR', 'STRUCT_DEAD_LOAD'],
  tempCoeffVoc:     ['NEC_690_7_VOLTAGE'],
  designTempMin:    ['NEC_690_7_VOLTAGE', 'NEC_310_WIRE'],
  ocpdRating:       ['NEC_690_9_OCPD'],
  wireGauge:        ['NEC_310_WIRE', 'NEC_310_VOLTAGE_DROP', 'NEC_358_CONDUIT_FILL'],
  wireLength:       ['NEC_310_VOLTAGE_DROP'],
  conduitType:      ['NEC_358_CONDUIT_FILL', 'NEC_310_WIRE'],
  acOutputKw:       ['NEC_705_12_BUSBAR', 'NEC_310_WIRE'],
  mainPanelAmps:    ['NEC_705_12_BUSBAR'],
  windSpeed:        ['ASCE_WIND_PRESSURE', 'ASCE_UPLIFT_ATTACHMENT', 'ASCE_RAFTER_BENDING'],
  windExposure:     ['ASCE_WIND_PRESSURE', 'ASCE_UPLIFT_ATTACHMENT'],
  groundSnowLoad:   ['ASCE_SNOW_LOAD', 'ASCE_RAFTER_BENDING'],
  roofPitch:        ['ASCE_SNOW_LOAD', 'ASCE_WIND_PRESSURE'],
  rafterSpacing:    ['ASCE_RAFTER_BENDING', 'ASCE_ATTACHMENT_SPACING'],
  rafterSpan:       ['ASCE_RAFTER_BENDING'],
  rafterSize:       ['ASCE_RAFTER_BENDING'],
  rafterSpecies:    ['ASCE_RAFTER_BENDING'],
  attachmentSpacing:['ASCE_ATTACHMENT_SPACING', 'ASCE_UPLIFT_ATTACHMENT'],
  panelWeight:      ['ASCE_DEAD_LOAD', 'ASCE_RAFTER_BENDING'],
};

function nextStandardOCPD(amps: number): number {
  const sizes = [15,20,25,30,35,40,45,50,60,70,80,90,100,110,125,150,175,200];
  return sizes.find(s => s >= amps) ?? Math.ceil(amps/10)*10;
}

function ruleNEC690_8(panelIsc: number, maxSeriesFuse: number, engineeringMode: 'AUTO'|'MANUAL', ocpdOverride?: number): RuleResult {
  const requiredOCPD = panelIsc * 1.25;
  const standardOCPD = nextStandardOCPD(requiredOCPD);
  const cappedOCPD = Math.min(standardOCPD, maxSeriesFuse);
  const effectiveOCPD = ocpdOverride ?? cappedOCPD;
  if (effectiveOCPD > maxSeriesFuse) {
    return { ruleId:'NEC_690_8_CURRENT', category:'electrical', severity:'error', title:'OCPD Exceeds Max Series Fuse',
      message:`OCPD ${effectiveOCPD}A exceeds panel maxSeriesFuse ${maxSeriesFuse}A`, value:effectiveOCPD, limit:maxSeriesFuse,
      necReference:'NEC 690.8(B)', autoFixed:engineeringMode==='AUTO', autoFixDescription:engineeringMode==='AUTO'?`Auto-capped to ${cappedOCPD}A`:undefined, overridable:true, overrideField:'ocpdRating' };
  }
  return { ruleId:'NEC_690_8_CURRENT', category:'electrical', severity:'pass', title:'NEC 690.8 Current',
    message:`OCPD ${effectiveOCPD}A <= maxSeriesFuse ${maxSeriesFuse}A`, value:effectiveOCPD, limit:maxSeriesFuse, necReference:'NEC 690.8(B)' };
}

function ruleNEC690_7(panelVoc: number, panelCount: number, tempCoeffVoc: number, designTempMin: number, maxDcVoltage: number): RuleResult {
  const tempDelta = 25 - designTempMin;
  const vocCorrected = panelVoc * (1 + (tempCoeffVoc/100) * tempDelta);
  const stringVoc = vocCorrected * panelCount;
  if (stringVoc > maxDcVoltage) {
    return { ruleId:'NEC_690_7_VOLTAGE', category:'electrical', severity:'error', title:'String Voltage Exceeds Inverter Max',
      message:`String Voc ${stringVoc.toFixed(1)}V exceeds inverter max ${maxDcVoltage}V at ${designTempMin}C`,
      value:stringVoc.toFixed(1), limit:maxDcVoltage, necReference:'NEC 690.7(A)', overridable:false };
  }
  if (stringVoc > maxDcVoltage * 0.95) {
    return { ruleId:'NEC_690_7_VOLTAGE', category:'electrical', severity:'warning', title:'String Voltage Near Inverter Max',
      message:`String Voc ${stringVoc.toFixed(1)}V within 5% of max ${maxDcVoltage}V`,
      value:stringVoc.toFixed(1), limit:maxDcVoltage, necReference:'NEC 690.7(A)', overridable:true, overrideField:'panelCount' };
  }
  return { ruleId:'NEC_690_7_VOLTAGE', category:'electrical', severity:'pass', title:'NEC 690.7 Voltage',
    message:`String Voc ${stringVoc.toFixed(1)}V <= max ${maxDcVoltage}V`, value:stringVoc.toFixed(1), limit:maxDcVoltage, necReference:'NEC 690.7(A)' };
}

function ruleNEC705_12(busRating: number, backfeedAmps: number, mainBreaker?: number): RuleResult {
  // NEC 705.12(B)(3)(2) — 120% Rule:
  // Solar breaker + Battery breaker + Main breaker ≤ Bus rating × 120%
  // Equivalent: backfeed breakers ≤ (busRating × 1.2) − mainBreaker
  const main = mainBreaker ?? busRating;
  const maxAllowed = (busRating * 1.2) - main;
  const totalWithMain = backfeedAmps + main;
  const busMax120 = busRating * 1.2;
  if (backfeedAmps > maxAllowed) {
    return { ruleId:'NEC_705_12_BUSBAR', category:'electrical', severity:'error', title:'120% Busbar Rule Violation',
      message:`NEC 705.12(B)(3)(2): Backfeed ${backfeedAmps}A + Main ${main}A = ${totalWithMain}A exceeds ${busRating}A bus × 120% = ${busMax120}A. Max backfeed allowed = ${maxAllowed.toFixed(0)}A. Fix: supply-side tap (NEC 705.11), derate main to ${Math.floor((busMax120 - backfeedAmps)/5)*5}A, or upgrade bus.`,
      value:backfeedAmps, limit:maxAllowed.toFixed(0), necReference:'NEC 705.12(B)(3)(2)', overridable:true, overrideField:'mainPanelAmps' };
  }
  return { ruleId:'NEC_705_12_BUSBAR', category:'electrical', severity:'pass', title:'NEC 705.12 Busbar Rule',
    message:`NEC 705.12(B)(3)(2): Backfeed ${backfeedAmps}A + Main ${main}A = ${totalWithMain}A ≤ ${busRating}A bus × 120% = ${busMax120}A ✓`,
    value:backfeedAmps, limit:maxAllowed.toFixed(0), necReference:'NEC 705.12(B)(3)(2)' };
}

function ruleVoltageDrop(voltageDrop: number, conductorCallout: string, wireLength: number, isAC: boolean): RuleResult {
  const id = isAC ? 'NEC_310_VOLTAGE_DROP_AC' : 'NEC_310_VOLTAGE_DROP';
  const title = isAC ? 'AC Voltage Drop' : 'DC Voltage Drop';
  if (voltageDrop > 3) {
    return { ruleId:id, category:'electrical', severity:'warning', title:`${title} Exceeds 3%`,
      message:`Voltage drop ${voltageDrop.toFixed(2)}% exceeds recommended 3% for ${wireLength}ft run`,
      value:voltageDrop.toFixed(2)+'%', limit:'3%', necReference:'NEC 310 / NEC 215.2',
      autoFixed:true, autoFixDescription:`Auto-sized to ${conductorCallout}`, overridable:true, overrideField:'wireGauge' };
  }
  return { ruleId:id, category:'electrical', severity:'pass', title:`${title} OK`,
    message:`Voltage drop ${voltageDrop.toFixed(2)}% <= 3%`, value:voltageDrop.toFixed(2)+'%', limit:'3%', necReference:'NEC 310' };
}

function ruleConduitFill(fillPercent: number, conduitSize: string, conduitType: string): RuleResult {
  if (fillPercent > 40) {
    return { ruleId:'NEC_358_CONDUIT_FILL', category:'electrical', severity:'error', title:'Conduit Fill Exceeds 40%',
      message:`Conduit fill ${fillPercent.toFixed(1)}% exceeds 40% max for ${conduitType} ${conduitSize}`,
      value:fillPercent.toFixed(1)+'%', limit:'40%', necReference:'NEC Chapter 9, Table 1',
      autoFixed:true, autoFixDescription:'Upsize conduit or reduce conductors', overridable:true, overrideField:'conduitType' };
  }
  return { ruleId:'NEC_358_CONDUIT_FILL', category:'electrical', severity:'pass', title:'Conduit Fill OK',
    message:`Fill ${fillPercent.toFixed(1)}% <= 40% in ${conduitType} ${conduitSize}`,
    value:fillPercent.toFixed(1)+'%', limit:'40%', necReference:'NEC Chapter 9, Table 1' };
}

function ruleRapidShutdown(rapidShutdown: boolean, necVersion: string): RuleResult {
  if (!rapidShutdown) {
    return { ruleId:'NEC_690_12_RSD', category:'electrical', severity:'error', title:'Rapid Shutdown Required',
      message:`NEC ${necVersion} requires rapid shutdown for roof-mounted systems`,
      necReference:'NEC 690.12', overridable:true, overrideField:'rapidShutdown' };
  }
  return { ruleId:'NEC_690_12_RSD', category:'electrical', severity:'pass', title:'Rapid Shutdown',
    message:'Rapid shutdown compliant', necReference:'NEC 690.12' };
}

function ruleAttachmentSpacing(attachmentSpacing: number, upliftPerAttachment: number, allowableUplift: number): RuleResult {
  if (upliftPerAttachment > allowableUplift) {
    const requiredSpacing = Math.floor(attachmentSpacing * (allowableUplift / upliftPerAttachment) / 6) * 6;
    return { ruleId:'ASCE_ATTACHMENT_SPACING', category:'structural', severity:'error', title:'Attachment Spacing Exceeds Capacity',
      message:`Uplift ${upliftPerAttachment.toFixed(0)} lbs/attachment exceeds allowable ${allowableUplift.toFixed(0)} lbs at ${attachmentSpacing}" spacing`,
      value:`${upliftPerAttachment.toFixed(0)} lbs`, limit:`${allowableUplift.toFixed(0)} lbs`,
      asceReference:'ASCE 7-22 §26.10', autoFixed:true,
      autoFixDescription:`Reduce spacing to ${requiredSpacing}" or upgrade attachment hardware`, overridable:true, overrideField:'attachmentSpacing' };
  }
  const maxAllowed = Math.min(attachmentSpacing * (allowableUplift / upliftPerAttachment), 72);
  return { ruleId:'ASCE_ATTACHMENT_SPACING', category:'structural', severity:'pass', title:'Attachment Spacing OK',
    message:`${attachmentSpacing}" spacing: uplift ${upliftPerAttachment.toFixed(0)} lbs <= allowable ${allowableUplift.toFixed(0)} lbs (max: ${maxAllowed.toFixed(0)}")`,
    value:`${upliftPerAttachment.toFixed(0)} lbs`, limit:`${allowableUplift.toFixed(0)} lbs`, asceReference:'ASCE 7-22 §26.10' };
}

function ruleRafterBending(bendingMoment: number, allowableMoment: number, utilizationRatio: number, rafterSize: string): RuleResult {
  if (utilizationRatio > 1.0) {
    return { ruleId:'ASCE_RAFTER_BENDING', category:'structural', severity:'error', title:'Rafter Overstressed',
      message:`${rafterSize} utilization ${(utilizationRatio*100).toFixed(0)}% exceeds 100%`,
      value:(utilizationRatio*100).toFixed(0)+'%', limit:'100%', asceReference:'ASCE 7-22 / NDS 2018',
      autoFixed:true, autoFixDescription:'Upgrade rafter size or reduce attachment spacing', overridable:true, overrideField:'rafterSize' };
  }
  if (utilizationRatio > 0.85) {
    return { ruleId:'ASCE_RAFTER_BENDING', category:'structural', severity:'warning', title:'Rafter Near Capacity',
      message:`${rafterSize} utilization ${(utilizationRatio*100).toFixed(0)}% approaching limit`,
      value:(utilizationRatio*100).toFixed(0)+'%', limit:'100%', asceReference:'ASCE 7-22 / NDS 2018', overridable:true, overrideField:'rafterSize' };
  }
  return { ruleId:'ASCE_RAFTER_BENDING', category:'structural', severity:'pass', title:'Rafter Bending OK',
    message:`${rafterSize} utilization ${(utilizationRatio*100).toFixed(0)}% <= 100%`,
    value:(utilizationRatio*100).toFixed(0)+'%', limit:'100%', asceReference:'ASCE 7-22 / NDS 2018' };
}

export function runRulesEngine(input: RulesEngineInput): RulesEngineResult {
  const rules: RuleResult[] = [];
  const dependencyChain: string[] = [];
  const structuralAutoResolutions: StructuralAutoResolution[] = [];

  const electricalResult = runElectricalCalc({
    ...input.electrical,
    designTempMin: (input.electrical as any).designTempMin ?? -10,
    designTempMax: (input.electrical as any).designTempMax ?? 40,
    rooftopTempAdder: (input.electrical as any).rooftopTempAdder ?? 30,
    necVersion: (input.electrical as any).necVersion ?? '2023',
  });

  const structuralResult = runStructuralCalc(input.structural);

  let resolvedStructural = structuralResult;
  if (input.engineeringMode === 'AUTO' && structuralResult.status === 'FAIL') {
    const resolution: StructuralAutoResolutionResult = resolveStructural(input.structural, 'AUTO');
    if (resolution.status === 'RESOLVED' || resolution.status === 'RESOLVED_PARTIAL') {
      resolvedStructural = resolution.resolvedCalc ?? structuralResult;
      resolution.resolutionLog.forEach(r => {
        structuralAutoResolutions.push({ field:r.action, originalValue:r.fromValue, resolvedValue:r.toValue, reason:r.reason, necReference:r.reference??'ASCE 7-22' });
      });
    }
  }

  electricalResult.inverters?.forEach((inv: any) => {
    inv.strings?.forEach((str: any) => {
      dependencyChain.push('NEC_690_7_VOLTAGE');
      rules.push(ruleNEC690_7(str.vocSTC/(str.panelCount||1), str.panelCount,
        input.electrical.inverters[0]?.strings[0]?.tempCoeffVoc??-0.26,
        (input.electrical as any).designTempMin??-10,
        input.electrical.inverters[0]?.maxDcVoltage??480));
      dependencyChain.push('NEC_690_8_CURRENT');
      const ocpdOverride = input.overrides.find(o => o.field==='ocpdRating')?.overrideValue as number|undefined;
      rules.push(ruleNEC690_8(str.iscSTC, str.ocpdResolution?.maxSeriesFuse??20, input.engineeringMode, ocpdOverride));
      if (str.dcWireResult) {
        dependencyChain.push('NEC_310_VOLTAGE_DROP');
        rules.push(ruleVoltageDrop(str.dcWireResult.voltageDrop, str.dcWireResult.conductorCallout, input.electrical.inverters[0]?.strings[0]?.wireLength??50, false));
      }
    });
    if (inv.acWireResult) {
      dependencyChain.push('NEC_310_VOLTAGE_DROP_AC');
      rules.push(ruleVoltageDrop(inv.acWireResult.voltageDrop, inv.acWireResult.conductorCallout, input.electrical.wireLength, true));
    }
  });

  if (electricalResult.busbar) {
    dependencyChain.push('NEC_705_12_BUSBAR');
    const icMethod = electricalResult.interconnection?.method ?? 'LOAD_SIDE';
    if (icMethod === 'SUPPLY_SIDE_TAP') {
      // Supply-side tap (NEC 705.11): 120% busbar rule does NOT apply — always pass
      rules.push({ ruleId:'NEC_705_12_BUSBAR', category:'electrical', severity:'pass',
        title:'NEC 705.12 Busbar Rule — N/A (Supply-Side Tap)',
        message:'Supply-side tap (NEC 705.11) — 120% busbar rule does not apply. No busbar loading concern.',
        value:'N/A', limit:'N/A', necReference:'NEC 705.11' } as any);
    } else {
      // Load-side: apply NEC 705.12(B)(3)(2) 120% rule
      const busRating = electricalResult.interconnection?.busRating ?? electricalResult.busbar.mainPanelAmps;
      const mainBreaker = electricalResult.interconnection?.mainBreaker ?? busRating;
      rules.push(ruleNEC705_12(busRating, electricalResult.busbar.backfeedBreakerRequired, mainBreaker));
    }
  }
  if (electricalResult.conduitFill) {
    dependencyChain.push('NEC_358_CONDUIT_FILL');
    rules.push(ruleConduitFill(electricalResult.conduitFill.fillPercent, electricalResult.conduitFill.conduitSize, electricalResult.conduitFill.conduitType));
  }
  dependencyChain.push('NEC_690_12_RSD');
  rules.push(ruleRapidShutdown(input.electrical.rapidShutdown, (input.electrical as any).necVersion??'2023'));

  if (resolvedStructural.wind) {
    dependencyChain.push('ASCE_ATTACHMENT_SPACING');
    // Use actual lagBoltCapacity from structural calc result (attachment.lagBoltCapacity)
    // NOT a hardcoded 500 lbs — standard 5/16" lag bolt NDS capacity is 984 lbs
    const allowableUplift = (resolvedStructural as any).attachment?.lagBoltCapacity ?? 984;
    rules.push(ruleAttachmentSpacing(input.structural.attachmentSpacing, resolvedStructural.wind.upliftPerAttachment, allowableUplift));
  }
  if (resolvedStructural.rafter) {
    dependencyChain.push('ASCE_RAFTER_BENDING');
    rules.push(ruleRafterBending(resolvedStructural.rafter.bendingMoment, resolvedStructural.rafter.allowableBendingMoment, resolvedStructural.rafter.utilizationRatio, input.structural.rafterSize));
  }

  input.overrides.forEach(override => {
    const ruleIdx = rules.findIndex(r => r.overrideField === override.field);
    if (ruleIdx >= 0 && rules[ruleIdx].severity === 'error') {
      rules[ruleIdx] = { ...rules[ruleIdx], severity:'warning', message:`${rules[ruleIdx].message} [OVERRIDDEN: ${override.justification}]`, autoFixed:false };
    }
  });

  const errorCount   = rules.filter(r => r.severity==='error').length;
  const warningCount = rules.filter(r => r.severity==='warning').length;
  const autoFixCount = rules.filter(r => r.autoFixed).length;
  const overrideCount = input.overrides.length;
  const overallStatus: 'PASS'|'WARNING'|'FAIL' = errorCount>0?'FAIL':warningCount>0?'WARNING':'PASS';

  return { electricalResult, structuralResult:resolvedStructural, rules, overallStatus, errorCount, warningCount, autoFixCount, overrideCount, dependencyChain:[...new Set(dependencyChain)], structuralAutoResolutions };
}

export function getRulesForField(field: string): string[] {
  return DEPENDENCY_MAP[field] ?? [];
}
