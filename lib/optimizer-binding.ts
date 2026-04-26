// ============================================================
// Optimizer Per-Module Binding Engine
// Optimizer binds to each module instance — NOT to strings
// String count stays consistent when optimizer added/removed
// ============================================================

import { SystemState, OptimizerInstance, ModuleInstance, buildModuleInstances, InverterConfig } from './system-state';
import { OPTIMIZERS } from './equipment-db';

export interface OptimizerBindingResult {
  optimizers: OptimizerInstance[];
  totalBound: number;
  totalModules: number;
  unbound: string[];        // module instance ids with no optimizer
  bindingLog: string[];
}

// ─── Bind optimizer to every module in the system ────────────────────────────

export function bindOptimizerToAllModules(
  state: SystemState,
  optimizerModelId: string
): OptimizerBindingResult {
  const log: string[] = [];
  const modules = buildModuleInstances(state.inverters);
  const optimizer = OPTIMIZERS.find(o => o.id === optimizerModelId);

  if (!optimizer) {
    return {
      optimizers: [],
      totalBound: 0,
      totalModules: modules.length,
      unbound: modules.map(m => m.id),
      bindingLog: [`ERROR: Optimizer model ${optimizerModelId} not found in equipment database`],
    };
  }

  const optimizerInstances: OptimizerInstance[] = [];

  for (const mod of modules) {
    // Verify optimizer is compatible with this panel's wattage
    const panel = getPanelWatts(mod.panelId);
    if (panel > optimizer.dcInputWMax) {
      log.push(`WARNING: Module ${mod.id} (${panel}W) exceeds optimizer max input (${optimizer.dcInputWMax}W) — binding anyway, verify compatibility`);
    }

    optimizerInstances.push({
      id: `opt-${mod.id}-${optimizerModelId}`,
      optimizerModelId,
      moduleInstanceId: mod.id,
      panelId: mod.panelId,
    });
  }

  log.push(`Bound ${optimizerInstances.length} ${optimizer.manufacturer} ${optimizer.model} optimizers to ${modules.length} modules`);
  log.push(`String count unchanged: ${state.inverters.reduce((s, i) => s + i.strings.length, 0)} strings`);

  return {
    optimizers: optimizerInstances,
    totalBound: optimizerInstances.length,
    totalModules: modules.length,
    unbound: [],
    bindingLog: log,
  };
}

// ─── Remove all optimizers (topology switch) ──────────────────────────────────

export function removeAllOptimizers(state: SystemState): {
  state: SystemState;
  removedCount: number;
} {
  const removedCount = state.optimizers.length;
  return {
    state: { ...state, optimizers: [], topologyType: 'STRING' },
    removedCount,
  };
}

// ─── Update optimizer bindings when panel count changes ──────────────────────

export function syncOptimizerBindings(
  state: SystemState
): SystemState {
  if (state.optimizers.length === 0) return state;

  // Get current optimizer model (from first binding)
  const firstOptimizer = state.optimizers[0];
  if (!firstOptimizer) return state;

  // Rebuild all bindings from current module instances
  const result = bindOptimizerToAllModules(state, firstOptimizer.optimizerModelId);
  return { ...state, optimizers: result.optimizers };
}

// ─── Get optimizer count per string ──────────────────────────────────────────

export function getOptimizerCountByString(
  state: SystemState
): Map<string, number> {
  const countMap = new Map<string, number>();
  const modules = buildModuleInstances(state.inverters);

  for (const mod of modules) {
    const hasOptimizer = state.optimizers.some(o => o.moduleInstanceId === mod.id);
    if (hasOptimizer) {
      countMap.set(mod.stringId, (countMap.get(mod.stringId) ?? 0) + 1);
    }
  }

  return countMap;
}

// ─── Validate optimizer-panel compatibility ───────────────────────────────────

export interface OptimizerCompatibilityCheck {
  compatible: boolean;
  issues: string[];
  warnings: string[];
}

export function checkOptimizerCompatibility(
  optimizerModelId: string,
  panelId: string
): OptimizerCompatibilityCheck {
  const optimizer = OPTIMIZERS.find(o => o.id === optimizerModelId);
  const issues: string[] = [];
  const warnings: string[] = [];

  if (!optimizer) {
    return { compatible: false, issues: [`Optimizer ${optimizerModelId} not found`], warnings: [] };
  }

  const panelWatts = getPanelWatts(panelId);
  const panelVoc = getPanelVoc(panelId);

  if (panelWatts > optimizer.dcInputWMax) {
    issues.push(`Panel wattage (${panelWatts}W) exceeds optimizer max input (${optimizer.dcInputWMax}W)`);
  }

  if (panelVoc > optimizer.maxDcVoltage) {
    issues.push(`Panel Voc (${panelVoc}V) exceeds optimizer max DC voltage (${optimizer.maxDcVoltage}V)`);
  }

  if (panelWatts > optimizer.dcInputWMax * 0.9) {
    warnings.push(`Panel wattage is within 10% of optimizer max — verify thermal derating`);
  }

  return {
    compatible: issues.length === 0,
    issues,
    warnings,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getPanelWatts(panelId: string): number {
  // Import inline to avoid circular deps
  const PANEL_WATTS: Record<string, number> = {
    'sunpower-maxeon7-440': 440,
    'sunpower-maxeon6-400': 400,
    'rec-alpha-pure-430': 430,
    'panasonic-evervolt-410': 410,
    'jinko-tiger-neo-580': 580,
    'canadian-solar-hiku7-600': 600,
    'longi-himo6-580': 580,
    'trina-vertex-s-435': 435,
    'qcells-peak-duo-400': 400,
    'silfab-elite-400': 400,
  };
  return PANEL_WATTS[panelId] ?? 400;
}

function getPanelVoc(panelId: string): number {
  const PANEL_VOC: Record<string, number> = {
    'sunpower-maxeon7-440': 51.6,
    'sunpower-maxeon6-400': 47.1,
    'rec-alpha-pure-430': 48.9,
    'panasonic-evervolt-410': 51.9,
    'jinko-tiger-neo-580': 49.52,
    'canadian-solar-hiku7-600': 49.80,
    'longi-himo6-580': 49.65,
    'trina-vertex-s-435': 37.80,
    'qcells-peak-duo-400': 41.60,
    'silfab-elite-400': 40.8,
  };
  return PANEL_VOC[panelId] ?? 41.6;
}