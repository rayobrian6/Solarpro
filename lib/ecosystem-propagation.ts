// ============================================================
// Ecosystem Propagation Engine V4
// Brand-agnostic, registry-driven propagation.
// NO hardcoded brand conditionals.
// Topology + requiredAccessories drives everything.
// ============================================================

import {
  SystemState, TopologyType, InverterConfig, StringConfig,
  EcosystemComponent, OptimizerInstance, ModuleInstance,
  TopologyChangeEntry, buildModuleInstances,
} from './system-state';

import {
  getRegistryEntry,
  getTopologyForEquipment,
  evaluateQuantityFormula,
  AccessoryRule,
  EquipmentRegistryEntry,
} from './equipment-registry';

import {
  detectTopology,
  normalizeTopology,
  validateTopologyTransition,
  TopologyContext,
} from './topology-engine';

import {
  resolveAccessories,
  ResolutionContext,
  ResolvedAccessory,
  calcAttachmentCount,
  sizeACDisconnect,
} from './accessory-resolver';

// ─── Propagation Result ───────────────────────────────────────────────────────

export interface PropagationResult {
  updatedState: SystemState;
  topologyChanged: boolean;
  previousTopology: TopologyType;
  newTopology: TopologyType;
  ecosystemAdded: EcosystemComponent[];
  ecosystemRemoved: string[];
  optimizersAdded: OptimizerInstance[];
  resetFields: string[];
  propagationLog: PropagationLogEntry[];
}

export interface PropagationLogEntry {
  action: string;
  component: string;
  quantity: number;
  reason: string;
  autoAdded: boolean;
}

// ─── Main Propagation Function ────────────────────────────────────────────────

export function propagateEcosystem(
  state: SystemState,
  newInverterId: string,
  newInverterType: 'string' | 'micro' | 'optimizer',
  targetInverterConfigId: string,
): PropagationResult {
  const log: PropagationLogEntry[] = [];
  const previousTopology = state.topologyType;

  // 1. Update inverter config
  let updatedState: SystemState = {
    ...state,
    inverters: state.inverters.map(inv =>
      inv.id === targetInverterConfigId
        ? { ...inv, inverterId: newInverterId, type: newInverterType }
        : inv
    ),
  };

  // 2. Compute totals
  const totalModules = updatedState.inverters.reduce((sum, inv) =>
    sum + inv.strings.reduce((s, str) => s + str.panelCount, 0), 0);
  const totalStrings = updatedState.inverters.reduce((sum, inv) => sum + inv.strings.length, 0);
  const totalInverters = updatedState.inverters.length;

  // 3. Detect new topology via registry (no brand checks)
  const topoCtx: TopologyContext = {
    inverterId: newInverterId,
    optimizerId: updatedState.ecosystemComponents.find(c => c.category === 'optimizer')?.id,
    rackingId: updatedState.mountingId,
    moduleCount: totalModules,
    stringCount: totalStrings,
    inverterCount: totalInverters,
  };

  const topoResult = detectTopology(topoCtx);
  const newTopology = topoResult.topology;
  const topologyChanged = normalizeTopology(newTopology) !== normalizeTopology(previousTopology);

  updatedState = { ...updatedState, topologyType: newTopology };

  // 4. Detect brand from registry (no hardcoded prefix checks)
  const inverterEntry = getRegistryEntry(newInverterId);
  const brand = inverterEntry?.manufacturer ?? 'Other';
  updatedState = { ...updatedState, inverterBrand: brand as any };

  // 5. Validate topology transition — get fields to reset
  const transition = validateTopologyTransition(previousTopology, newTopology);
  const resetFields = transition.fieldsToReset;

  // 6. PHASE 3 FIX: Clear ALL ecosystem components before regeneration.
  // This prevents cross-topology bleed (e.g. SolarEdge components appearing
  // with Enphase, or optimizer accessories persisting after switch to micro).
  // We clear the entire array — not just autoAdded — so no stale entries survive.
  const ecosystemRemoved = updatedState.ecosystemComponents.map(c => c.id);

  updatedState = {
    ...updatedState,
    ecosystemComponents: [],   // ← full clear, not filter
    optimizers: [],
  };

  // 7. Apply topology-specific state resets
  updatedState = applyTopologyResets(updatedState, normalizeTopology(previousTopology), normalizeTopology(newTopology));

  // 8. Resolve accessories from registry
  const resCtx: ResolutionContext = {
    inverterId: newInverterId,
    rackingId: updatedState.mountingId,
    moduleCount: totalModules,
    stringCount: totalStrings,
    inverterCount: totalInverters,
    branchCount: totalStrings,
    systemKw: totalModules * 0.4,
    roofType: updatedState.structuralData?.roofType ?? 'shingle',
    mountType: 'roof',
  };

  const resolution = resolveAccessories(resCtx);

  // 9. Convert resolved accessories to EcosystemComponents.
  // PHASE 3 FIX: Filter accessories by topology so MICRO never gets string
  // accessories and STRING never gets micro accessories.
  const normalizedNew = normalizeTopology(newTopology);

  // Categories that belong exclusively to micro topology
  const MICRO_ONLY_CATEGORIES = new Set([
    'trunk_cable', 'terminator', 'gateway', 'q_relay',
  ]);
  // Categories that belong exclusively to string/optimizer topology
  const STRING_ONLY_CATEGORIES = new Set([
    'dc_disconnect', 'combiner', 'string_fuse',
  ]);

  const filteredAccessories = resolution.accessories.filter(acc => {
    if (normalizedNew === 'MICROINVERTER') {
      // For micro: exclude string-only categories
      return !STRING_ONLY_CATEGORIES.has(acc.category);
    }
    if (normalizedNew === 'STRING_INVERTER' || normalizedNew === 'STRING_WITH_OPTIMIZER') {
      // For string: exclude micro-only categories
      return !MICRO_ONLY_CATEGORIES.has(acc.category);
    }
    return true;
  });

  const ecosystemAdded: EcosystemComponent[] = filteredAccessories.map(acc => ({
    id: `eco-${acc.category}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    category: mapAccessoryCategoryToEcosystem(acc.category),
    manufacturer: acc.manufacturer,
    model: acc.model,
    partNumber: acc.partNumber,
    quantity: acc.quantity,
    autoAdded: true,
    reason: acc.description,
    requiredBy: acc.derivedFrom,
  }));

  // 10. Build optimizer instances if topology requires them
  let optimizersAdded: OptimizerInstance[] = [];
  const optimizerAccessory = resolution.accessories.find(a => a.category === 'optimizer');
  if (optimizerAccessory) {
    const modules = buildModuleInstances(updatedState.inverters);
    const optimizerModelId = getRegistryEntry(newInverterId)
      ?.requiredAccessories.find(r => r.category === 'optimizer')
      ?.defaultPartNumber ?? 'optimizer';

    optimizersAdded = modules.map(mod => ({
      id: `opt-inst-${mod.id}`,
      optimizerModelId,
      moduleInstanceId: mod.id,
      panelId: mod.panelId,
    }));
  }

  // 11. Log all additions (only filtered accessories)
  const filteredCategories = new Set(filteredAccessories.map(a => a.category));
  for (const acc of resolution.log) {
    if (filteredCategories.has(acc.category)) {
      log.push({
        action: 'ADD_ECOSYSTEM',
        component: acc.category,
        quantity: acc.quantity,
        reason: acc.reason,
        autoAdded: true,
      });
    }
  }

  if (topologyChanged) {
    log.push({
      action: 'TOPOLOGY_SWITCH',
      component: 'System Architecture',
      quantity: 1,
      reason: `${previousTopology} → ${newTopology}: ${topoResult.reason}`,
      autoAdded: true,
    });
    for (const w of transition.warnings) {
      log.push({ action: 'RESET', component: w, quantity: 0, reason: w, autoAdded: true });
    }
  }

  // 12. Update state with new ecosystem
  updatedState = {
    ...updatedState,
    ecosystemComponents: [
      ...updatedState.ecosystemComponents,
      ...ecosystemAdded,
    ],
    optimizers: optimizersAdded,
    modules: buildModuleInstances(updatedState.inverters),
  };

  // 13. Log topology change
  if (topologyChanged) {
    const changeEntry: TopologyChangeEntry = {
      timestamp: new Date().toISOString(),
      fromTopology: previousTopology,
      toTopology: newTopology,
      trigger: `Inverter changed to ${newInverterId} (${brand})`,
      resetFields,
    };
    updatedState = {
      ...updatedState,
      topologyChangeLog: [...updatedState.topologyChangeLog, changeEntry],
    };
  }

  return {
    updatedState,
    topologyChanged,
    previousTopology,
    newTopology,
    ecosystemAdded,
    ecosystemRemoved,
    optimizersAdded,
    resetFields,
    propagationLog: log,
  };
}

// ─── Mount System Propagation ─────────────────────────────────────────────────
// Called when racking/mount system changes

export function propagateMountSystem(
  state: SystemState,
  newRackingId: string,
): PropagationResult {
  const log: PropagationLogEntry[] = [];
  const previousTopology = state.topologyType;

  const rackingEntry = getRegistryEntry(newRackingId);
  const mountTopology = rackingEntry?.mountTopology ?? 'ROOF_RAIL_BASED';

  let updatedState: SystemState = {
    ...state,
    mountingId: newRackingId,
  };

  const totalModules = updatedState.inverters.reduce((sum, inv) =>
    sum + inv.strings.reduce((s, str) => s + str.panelCount, 0), 0);
  const totalStrings = updatedState.inverters.reduce((sum, inv) => sum + inv.strings.length, 0);
  const totalInverters = updatedState.inverters.length;

  // Remove old structural ecosystem components
  const ecosystemRemoved = updatedState.ecosystemComponents
    .filter(c => ['attachment', 'flashing', 'driven_pile', 'mid_clamp', 'end_clamp'].includes(c.category))
    .map(c => c.id);

  updatedState = {
    ...updatedState,
    ecosystemComponents: updatedState.ecosystemComponents.filter(c => !ecosystemRemoved.includes(c.id)),
  };

  // Resolve new structural accessories
  const resCtx: ResolutionContext = {
    inverterId: updatedState.inverters[0]?.inverterId ?? '',
    rackingId: newRackingId,
    moduleCount: totalModules,
    stringCount: totalStrings,
    inverterCount: totalInverters,
    roofType: updatedState.structuralData?.roofType ?? 'shingle',
    mountType: mountTopology.startsWith('GROUND') ? 'ground' : 'roof',
  };

  const resolution = resolveAccessories(resCtx);

  const ecosystemAdded: EcosystemComponent[] = resolution.accessories
    .filter(a => ['attachment', 'flashing', 'driven_pile', 'mid_clamp', 'end_clamp'].includes(a.category))
    .map(acc => ({
      id: `eco-${acc.category}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      category: mapAccessoryCategoryToEcosystem(acc.category),
      manufacturer: acc.manufacturer,
      model: acc.model,
      partNumber: acc.partNumber,
      quantity: acc.quantity,
      autoAdded: true,
      reason: acc.description,
      requiredBy: acc.derivedFrom,
    }));

  for (const acc of resolution.log) {
    log.push({
      action: 'ADD_STRUCTURAL',
      component: acc.category,
      quantity: acc.quantity,
      reason: acc.reason,
      autoAdded: true,
    });
  }

  // Log structural changes
  if (rackingEntry) {
    log.push({
      action: 'MOUNT_CHANGE',
      component: `${rackingEntry.manufacturer} ${rackingEntry.model}`,
      quantity: 1,
      reason: `Mount system changed → ${mountTopology}`,
      autoAdded: true,
    });
  }

  updatedState = {
    ...updatedState,
    ecosystemComponents: [
      ...updatedState.ecosystemComponents,
      ...ecosystemAdded,
    ],
  };

  return {
    updatedState,
    topologyChanged: false,
    previousTopology,
    newTopology: previousTopology,
    ecosystemAdded,
    ecosystemRemoved,
    optimizersAdded: [],
    resetFields: ['attachmentSpacing', 'lagBoltCount', 'flashingCount'],
    propagationLog: log,
  };
}

// ─── Topology State Resets ────────────────────────────────────────────────────

function applyTopologyResets(
  state: SystemState,
  fromTopology: TopologyType,
  toTopology: TopologyType,
): SystemState {
  let updated = { ...state };

  // Switching TO microinverter
  if (toTopology === 'MICROINVERTER' || toTopology === 'AC_COUPLED_BATTERY') {
    updated = {
      ...updated,
      dcDisconnect: false,
      rapidShutdown: true, // integrated in microinverters
      optimizers: [],
      inverters: updated.inverters.map(inv => ({
        ...inv,
        strings: inv.strings.map(str => ({
          ...str,
          ocpdOverride: undefined,
          ocpdOverrideAcknowledged: undefined,
        })),
      })),
    };
  }

  // Switching AWAY from microinverter
  if ((fromTopology === 'MICROINVERTER') && toTopology !== 'MICROINVERTER') {
    updated = {
      ...updated,
      dcDisconnect: true,
      rapidShutdown: false,
    };
  }

  // Switching TO string with optimizer
  if (toTopology === 'STRING_WITH_OPTIMIZER' || toTopology === 'HYBRID_INVERTER' || toTopology === 'DC_COUPLED_BATTERY') {
    updated = {
      ...updated,
      dcDisconnect: true,
      rapidShutdown: true, // optimizers provide integrated RSD
    };
  }

  // Switching TO plain string inverter
  if (toTopology === 'STRING_INVERTER') {
    updated = {
      ...updated,
      dcDisconnect: true,
      rapidShutdown: false, // needs external RSD device
      optimizers: [],
    };
  }

  return updated;
}

// ─── Category Mapping ─────────────────────────────────────────────────────────

function mapAccessoryCategoryToEcosystem(
  category: string,
): EcosystemComponent['category'] {
  const map: Record<string, EcosystemComponent['category']> = {
    optimizer:      'optimizer',
    gateway:        'gateway',
    dc_disconnect:  'dc_disconnect',
    rapid_shutdown: 'rapid_shutdown',
    combiner:       'combiner',
    trunk_cable:    'trunk_cable',
    terminator:     'terminator',
    ac_disconnect:  'ac_disconnect',
    monitoring:     'monitoring',
    attachment:     'monitoring',   // structural — reuse monitoring slot
    flashing:       'monitoring',
    driven_pile:    'monitoring',
    mid_clamp:      'monitoring',
    end_clamp:      'monitoring',
    battery:        'monitoring',
  };
  return map[category] ?? 'monitoring';
}

// ─── Legacy Compatibility ─────────────────────────────────────────────────────
// Kept for backward compatibility with existing API routes

export function resetIncompatibleFields(
  state: SystemState,
  fromTopology: TopologyType,
  toTopology: TopologyType,
): { state: SystemState; resetFields: string[] } {
  const transition = validateTopologyTransition(fromTopology, toTopology);
  const updated = applyTopologyResets(state, normalizeTopology(fromTopology), normalizeTopology(toTopology));
  return { state: updated, resetFields: transition.fieldsToReset };
}