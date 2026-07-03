// ============================================================
// BOM Validation Layer — Warnings Only
// lib/bom-validation.ts
//
// MASTER TASK: Validates BOM inputs for consistency.
// NEVER blocks or overrides — only emits warnings.
//
// Checks:
//   1. Panel-systemType compatibility
//   2. Inverter topology validation
//   3. Structure-exists-for-systemType
//   4. Module count sanity
// ============================================================

import type { BOMSystemType } from './bom-system-profiles';

export interface BOMValidationInput {
  systemType?: BOMSystemType | string;
  panelId?: string;
  inverterId?: string;
  moduleCount: number;
  inverterCount?: number;
  stringCount?: number;
  systemKw?: number;
  rackingId?: string;
  fenceData?: any;
  groundData?: any;
  roofType?: string;
  // Standby power — schema-only, no new validation logic per brief
  generatorId?: string;
  atsId?: string;
  backupInterfaceId?: string;
}

export interface BOMValidationResult {
  warnings: string[];
  checks: Array<{
    id: string;
    label: string;
    pass: boolean;
    detail: string;
    severity: 'info' | 'warning' | 'error';
  }>;
}

/**
 * Validate BOM inputs for consistency. Returns warnings only — never blocks.
 */
export function validateBOMInputs(input: BOMValidationInput): BOMValidationResult {
  const warnings: string[] = [];
  const checks: BOMValidationResult['checks'] = [];

  const sysType = (input.systemType || 'roof') as string;

  // ── CHECK 1: Panel-systemType compatibility ──
  const panelId = input.panelId || '';
  if (sysType === 'fence' && panelId && !panelId.includes('fence') && !panelId.includes('ps1')) {
    const msg = `Panel "${panelId}" may not be optimized for fence mount. Fence systems typically use bifacial vertical panels (e.g., panel-fence-ps1).`;
    warnings.push(msg);
    checks.push({ id: 'panel-system-compat', label: 'Panel-System Compatibility', pass: false, detail: msg, severity: 'warning' });
  } else {
    checks.push({ id: 'panel-system-compat', label: 'Panel-System Compatibility', pass: true, detail: 'Panel is compatible with system type', severity: 'info' });
  }

  // ── CHECK 2: Inverter topology validation ──
  const inverterId = input.inverterId || '';
  const isMicroInverter = inverterId.includes('iq8') || inverterId.includes('iq7') || inverterId.includes('enphase');
  const isStringInverter = inverterId.includes('fronius') || inverterId.includes('sma') || inverterId.includes('sungrow') || inverterId.includes('se-');

  if (sysType === 'fence' && isStringInverter && !isMicroInverter) {
    const msg = `Fence systems typically use microinverters. String inverter "${inverterId}" detected — verify this is intentional.`;
    warnings.push(msg);
    checks.push({ id: 'inverter-topology', label: 'Inverter Topology', pass: false, detail: msg, severity: 'warning' });
  } else {
    checks.push({ id: 'inverter-topology', label: 'Inverter Topology', pass: true, detail: 'Inverter topology is appropriate for system type', severity: 'info' });
  }

  // ── CHECK 3: Structure-exists-for-systemType ──
  if (sysType === 'fence' && !input.fenceData) {
    const msg = 'Fence system type but no fence structural data provided — structural BOM may be incomplete.';
    warnings.push(msg);
    checks.push({ id: 'structure-exists', label: 'Structural Data', pass: false, detail: msg, severity: 'warning' });
  } else if (sysType === 'ground' && !input.groundData) {
    const msg = 'Ground mount system but no ground structural data provided — structural BOM may be incomplete.';
    warnings.push(msg);
    checks.push({ id: 'structure-exists', label: 'Structural Data', pass: false, detail: msg, severity: 'warning' });
  } else if (sysType === 'roof' && !input.rackingId) {
    const msg = 'Roof system but no racking ID provided — using default racking.';
    warnings.push(msg);
    checks.push({ id: 'structure-exists', label: 'Structural Data', pass: false, detail: msg, severity: 'info' });
  } else {
    checks.push({ id: 'structure-exists', label: 'Structural Data', pass: true, detail: 'Structural data present for system type', severity: 'info' });
  }

  // ── CHECK 4: Module count sanity ──
  if (input.moduleCount <= 0) {
    const msg = 'Module count is 0 or negative — BOM will have no panels.';
    warnings.push(msg);
    checks.push({ id: 'module-count', label: 'Module Count', pass: false, detail: msg, severity: 'error' });
  } else if (input.moduleCount > 500) {
    const msg = `Module count is ${input.moduleCount} — verify this is correct for a ${sysType} system.`;
    warnings.push(msg);
    checks.push({ id: 'module-count', label: 'Module Count', pass: false, detail: msg, severity: 'warning' });
  } else {
    checks.push({ id: 'module-count', label: 'Module Count', pass: true, detail: `${input.moduleCount} modules`, severity: 'info' });
  }

  // ── CHECK 5: System kW sanity ──
  if (input.systemKw && input.moduleCount > 0) {
    const wattsPerPanel = (input.systemKw * 1000) / input.moduleCount;
    if (wattsPerPanel < 200 || wattsPerPanel > 700) {
      const msg = `Implied ${wattsPerPanel.toFixed(0)}W per panel (${input.systemKw}kW / ${input.moduleCount} panels) — outside typical range (200-700W).`;
      warnings.push(msg);
      checks.push({ id: 'kw-sanity', label: 'System kW Sanity', pass: false, detail: msg, severity: 'warning' });
    } else {
      checks.push({ id: 'kw-sanity', label: 'System kW Sanity', pass: true, detail: `${wattsPerPanel.toFixed(0)}W per panel`, severity: 'info' });
    }
  }

  // ── CHECK 6: EcoFlow inverter sizing (v47.358) ──
  // Verifies EcoFlow inverter selection matches the DC kW tier per MASTER TASK rule:
  //   ≤ 6 kW  → 5 kW inverter (ecoflow-power-ocean-5kw)
  //   6–12 kW → 10 kW inverter (ecoflow-power-ocean-10kw)
  //   > 12 kW → 20 kW inverter (ecoflow-power-ocean-20kw)
  const invId = input.inverterId || '';
  const isEcoFlow = invId.startsWith('ecoflow-');
  if (isEcoFlow && input.systemKw !== undefined) {
    let expected: string | null = null;
    if (input.systemKw <= 6)      expected = 'ecoflow-power-ocean-5kw';
    else if (input.systemKw <= 12) expected = 'ecoflow-power-ocean-10kw';
    else                           expected = 'ecoflow-power-ocean-20kw';
    if (expected && invId !== expected) {
      const msg = `EcoFlow inverter (${invId}) may be over/under-sized for ${input.systemKw} kW DC. Recommended tier: ${expected}.`;
      warnings.push(msg);
      checks.push({ id: 'ecoflow-sizing', label: 'EcoFlow Inverter Sizing', pass: false, detail: msg, severity: 'warning' });
    } else {
      checks.push({ id: 'ecoflow-sizing', label: 'EcoFlow Inverter Sizing', pass: true, detail: `Inverter tier matches ${input.systemKw} kW DC`, severity: 'info' });
    }
  }

  return { warnings, checks };
}