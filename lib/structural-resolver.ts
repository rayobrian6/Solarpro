// ============================================================
// Structural Auto-Resolution Engine
// Deterministic resolution order for structural failures
// ASCE 7-22 / IBC 2021 / NDS 2018
// ============================================================
//
// Resolution Order (when rafter utilization > 100%):
//   Step 1: Reduce attachment spacing (reduces tributary area → reduces load per attachment)
//   Step 2: Increase rafter size (2x6 → 2x8 → 2x10 → 2x12)
//   Step 3: Increase lag bolt diameter (5/16" → 3/8" → 1/2")
//   Step 4: Recommend structural engineer upgrade
//
// AUTO mode: Apply fix automatically, log adjustment
// MANUAL mode: Return selectable resolution options array
//
// ============================================================

import { runStructuralCalc, StructuralInput, StructuralCalcResult } from './structural-calc';
import { runStructuralCalcV2, StructuralInputV2, StructuralResultV2 } from './structural-engine-v2';
import { StructuralResolutionEntry } from './system-state';

// ─── Resolution Types ─────────────────────────────────────────────────────────

export type StructuralResolutionStatus =
  | 'RESOLVED'          // auto-resolution found a passing configuration
  | 'RESOLVED_PARTIAL'  // improved but still has warnings
  | 'UNRESOLVABLE'      // no auto-resolution possible — structural engineer required
  | 'NO_ACTION_NEEDED'; // original calc already passes

export interface StructuralResolutionOption {
  id: string;
  step: number;
  action: string;
  description: string;
  fromValue: string | number;
  toValue: string | number;
  field: string;           // which StructuralInput field changes
  reference: string;
  estimatedImpact: string; // e.g. "Reduces utilization from 112% to 87%"
  requiresEngineer: boolean;
}

export interface StructuralAutoResolutionResult {
  status: StructuralResolutionStatus;
  originalCalc: StructuralCalcResult;
  resolvedCalc: StructuralCalcResult | null;
  resolvedInput: StructuralInput | null;
  resolutionLog: StructuralResolutionEntry[];
  options: StructuralResolutionOption[];  // for MANUAL mode
  appliedOption: StructuralResolutionOption | null; // for AUTO mode
  mode: 'AUTO' | 'MANUAL';
}

// ─── Rafter Size Upgrade Order ────────────────────────────────────────────────

const RAFTER_UPGRADE_ORDER = ['2x4', '2x6', '2x8', '2x10', '2x12'];

function getNextRafterSize(current: string): string | null {
  const idx = RAFTER_UPGRADE_ORDER.indexOf(current);
  if (idx === -1 || idx >= RAFTER_UPGRADE_ORDER.length - 1) return null;
  return RAFTER_UPGRADE_ORDER[idx + 1];
}

// ─── Attachment Spacing Reduction Steps ──────────────────────────────────────

const ATTACHMENT_SPACING_STEPS = [72, 60, 48, 36, 24]; // inches, descending

function getNextReducedSpacing(current: number): number | null {
  const smaller = ATTACHMENT_SPACING_STEPS.filter(s => s < current);
  return smaller.length > 0 ? smaller[0] : null;
}

// ─── Lag Bolt Capacity by Diameter ───────────────────────────────────────────

const LAG_BOLT_CAPACITIES: Record<string, { withdrawalPerInch: number; label: string }> = {
  '5/16"': { withdrawalPerInch: 305, label: '5/16" × 3" lag bolt' },
  '3/8"':  { withdrawalPerInch: 380, label: '3/8" × 3" lag bolt' },
  '1/2"':  { withdrawalPerInch: 490, label: '1/2" × 3.5" lag bolt' },
};

const LAG_BOLT_UPGRADE_ORDER = ['5/16"', '3/8"', '1/2"'];

function getNextLagBoltSize(current: string): string | null {
  const idx = LAG_BOLT_UPGRADE_ORDER.indexOf(current);
  if (idx === -1 || idx >= LAG_BOLT_UPGRADE_ORDER.length - 1) return null;
  return LAG_BOLT_UPGRADE_ORDER[idx + 1];
}

// ─── Main Resolution Function ─────────────────────────────────────────────────

export function resolveStructural(
  input: StructuralInput,
  mode: 'AUTO' | 'MANUAL',
  currentLagBoltSize: string = '5/16"'
): StructuralAutoResolutionResult {
  const originalCalc = runStructuralCalc(input);
  const resolutionLog: StructuralResolutionEntry[] = [];
  const options: StructuralResolutionOption[] = [];

  // No action needed
  if (originalCalc.status === 'PASS') {
    return {
      status: 'NO_ACTION_NEEDED',
      originalCalc,
      resolvedCalc: originalCalc,
      resolvedInput: input,
      resolutionLog: [],
      options: [],
      appliedOption: null,
      mode,
    };
  }

  // Build all available resolution options
  let stepNum = 1;

  // ── Option 1: Reduce attachment spacing ──────────────────────────────────
  const reducedSpacing = getNextReducedSpacing(input.attachmentSpacing);
  if (reducedSpacing !== null) {
    const testInput = { ...input, attachmentSpacing: reducedSpacing, railSpan: reducedSpacing };
    const testCalc = runStructuralCalc(testInput);
    const newUtil = testCalc.rafter.utilizationRatio;
    const oldUtil = originalCalc.rafter.utilizationRatio;

    options.push({
      id: `opt-spacing-${reducedSpacing}`,
      step: stepNum++,
      action: 'REDUCE_ATTACHMENT_SPACING',
      description: `Reduce attachment spacing from ${input.attachmentSpacing}" to ${reducedSpacing}"`,
      fromValue: input.attachmentSpacing,
      toValue: reducedSpacing,
      field: 'attachmentSpacing',
      reference: 'ASCE 7-22 / Racking manufacturer specs',
      estimatedImpact: `Reduces rafter utilization from ${(oldUtil * 100).toFixed(0)}% to ${(newUtil * 100).toFixed(0)}%. Status: ${testCalc.status}`,
      requiresEngineer: false,
    });
  }

  // ── Option 2: Increase rafter size ───────────────────────────────────────
  const nextRafterSize = getNextRafterSize(input.rafterSize);
  if (nextRafterSize !== null) {
    const testInput = { ...input, rafterSize: nextRafterSize };
    const testCalc = runStructuralCalc(testInput);
    const newUtil = testCalc.rafter.utilizationRatio;
    const oldUtil = originalCalc.rafter.utilizationRatio;

    options.push({
      id: `opt-rafter-${nextRafterSize}`,
      step: stepNum++,
      action: 'INCREASE_RAFTER_SIZE',
      description: `Upgrade rafter from ${input.rafterSize} to ${nextRafterSize}`,
      fromValue: input.rafterSize,
      toValue: nextRafterSize,
      field: 'rafterSize',
      reference: 'NDS 2018 / IBC 2021',
      estimatedImpact: `Reduces rafter utilization from ${(oldUtil * 100).toFixed(0)}% to ${(newUtil * 100).toFixed(0)}%. Status: ${testCalc.status}`,
      requiresEngineer: false,
    });
  }

  // ── Option 3: Increase lag bolt diameter ─────────────────────────────────
  const nextLagBolt = getNextLagBoltSize(currentLagBoltSize);
  if (nextLagBolt !== null) {
    const nextCapacity = LAG_BOLT_CAPACITIES[nextLagBolt];
    options.push({
      id: `opt-lag-${nextLagBolt}`,
      step: stepNum++,
      action: 'INCREASE_LAG_DIAMETER',
      description: `Upgrade lag bolt from ${currentLagBoltSize} to ${nextLagBolt} (${nextCapacity.label})`,
      fromValue: currentLagBoltSize,
      toValue: nextLagBolt,
      field: 'lagBoltSize',
      reference: 'NDS 2018 Table 12.2A / IBC 2021',
      estimatedImpact: `Increases lag bolt withdrawal capacity from ${LAG_BOLT_CAPACITIES[currentLagBoltSize]?.withdrawalPerInch ?? 305} to ${nextCapacity.withdrawalPerInch} lbs/inch embedment`,
      requiresEngineer: false,
    });
  }

  // ── Option 4: Structural engineer upgrade ────────────────────────────────
  options.push({
    id: 'opt-engineer',
    step: stepNum++,
    action: 'STRUCTURAL_ENGINEER_REVIEW',
    description: 'Engage licensed structural engineer for site-specific analysis',
    fromValue: 'Current configuration',
    toValue: 'Engineer-stamped design',
    field: 'none',
    reference: 'IBC 2021 Section 1604 / AHJ requirement',
    estimatedImpact: 'Engineer can specify custom attachment pattern, blocking, or sister rafters',
    requiresEngineer: true,
  });

  // ── AUTO MODE: Apply fixes in order until passing ─────────────────────────
  if (mode === 'AUTO') {
    let currentInput = { ...input };
    let currentCalc = originalCalc;
    let appliedOption: StructuralResolutionOption | null = null;

    for (const option of options) {
      if (option.requiresEngineer) break; // don't auto-apply engineer requirement

      let testInput = { ...currentInput };

      if (option.action === 'REDUCE_ATTACHMENT_SPACING') {
        testInput = { ...testInput, attachmentSpacing: option.toValue as number, railSpan: option.toValue as number };
      } else if (option.action === 'INCREASE_RAFTER_SIZE') {
        testInput = { ...testInput, rafterSize: option.toValue as string };
      }
      // Note: lag bolt size is not a StructuralInput field — it affects capacity calc
      // For now, skip lag bolt auto-apply (requires calc engine update)

      const testCalc = runStructuralCalc(testInput);

      resolutionLog.push({
        step: option.step,
        action: option.action,
        fromValue: option.fromValue,
        toValue: option.toValue,
        reason: option.description,
        reference: option.reference,
      });

      if (testCalc.status === 'PASS' || testCalc.status === 'WARNING') {
        currentInput = testInput;
        currentCalc = testCalc;
        appliedOption = option;

        resolutionLog[resolutionLog.length - 1] = {
          ...resolutionLog[resolutionLog.length - 1],
          reason: `${option.description} → RESOLVED (${testCalc.status})`,
        };
        break;
      }

      // If still failing, try combining with next option
      if (option.action === 'REDUCE_ATTACHMENT_SPACING' && testCalc.status === 'FAIL') {
        // Try combining spacing reduction with rafter upgrade
        const nextRafter = getNextRafterSize(testInput.rafterSize);
        if (nextRafter) {
          const combinedInput = { ...testInput, rafterSize: nextRafter };
          const combinedCalc = runStructuralCalc(combinedInput);
          if (combinedCalc.status === 'PASS' || combinedCalc.status === 'WARNING') {
            currentInput = combinedInput;
            currentCalc = combinedCalc;
            appliedOption = option;

            resolutionLog.push({
              step: option.step + 0.5,
              action: 'COMBINED_RESOLUTION',
              fromValue: input.rafterSize,
              toValue: nextRafter,
              reason: `Combined: reduced spacing to ${option.toValue}" AND upgraded rafter to ${nextRafter} → RESOLVED`,
              reference: 'NDS 2018 / ASCE 7-22',
            });
            break;
          }
        }
      }
    }

    const finalStatus: StructuralResolutionStatus =
      currentCalc.status === 'PASS' ? 'RESOLVED' :
      currentCalc.status === 'WARNING' ? 'RESOLVED_PARTIAL' :
      'UNRESOLVABLE';

    return {
      status: finalStatus,
      originalCalc,
      resolvedCalc: currentCalc,
      resolvedInput: currentInput,
      resolutionLog,
      options,
      appliedOption,
      mode,
    };
  }

  // ── MANUAL MODE: Return all options for user selection ────────────────────
  return {
    status: originalCalc.status === 'FAIL' ? 'UNRESOLVABLE' : 'RESOLVED_PARTIAL',
    originalCalc,
    resolvedCalc: null,
    resolvedInput: null,
    resolutionLog: [],
    options,
    appliedOption: null,
    mode,
  };
}

// ─── Apply a specific resolution option ──────────────────────────────────────

export function applyStructuralResolutionOption(
  input: StructuralInput,
  option: StructuralResolutionOption
): { input: StructuralInput; calc: StructuralCalcResult } {
  let updatedInput = { ...input };

  switch (option.action) {
    case 'REDUCE_ATTACHMENT_SPACING':
      updatedInput = {
        ...updatedInput,
        attachmentSpacing: option.toValue as number,
        railSpan: option.toValue as number,
      };
      break;
    case 'INCREASE_RAFTER_SIZE':
      updatedInput = { ...updatedInput, rafterSize: option.toValue as string };
      break;
    // INCREASE_LAG_DIAMETER and STRUCTURAL_ENGINEER_REVIEW don't change StructuralInput fields
    // They are informational — user must manually update hardware
  }

  return {
    input: updatedInput,
    calc: runStructuralCalc(updatedInput),
  };
}