// ============================================================
// SystemFactory — Topology Isolation Layer
// Returns MicroSystem, StringSystem, or OptimizerSystem instance.
// Switching topology DESTROYS previous instance, clears inverter
// arrays, clears ecosystem components, recalculates electrical
// model and BOM.
// DO NOT reuse string objects for micro systems.
// ============================================================

import { calcMicroSystem, MicroSystemInput, MicroElectricalResult } from './microSystem';
import { calcStringSystem, StringSystemInput, StringSystemResult } from './stringSystem';

// ── Topology types ────────────────────────────────────────────────────────────

export type TopologyType = 'MICROINVERTER' | 'STRING_INVERTER' | 'STRING_WITH_OPTIMIZER';

export type SystemResult = MicroElectricalResult | StringSystemResult;

// ── System instance interfaces ────────────────────────────────────────────────

export interface MicroSystemInstance {
  type: 'MICROINVERTER';
  calculate(input: MicroSystemInput): MicroElectricalResult;
  destroy(): void;
}

export interface StringSystemInstance {
  type: 'STRING_INVERTER' | 'STRING_WITH_OPTIMIZER';
  calculate(input: StringSystemInput): StringSystemResult;
  destroy(): void;
}

export type SystemInstance = MicroSystemInstance | StringSystemInstance;

// ── Factory state ─────────────────────────────────────────────────────────────

let _currentInstance: SystemInstance | null = null;
let _currentTopology: TopologyType | null = null;

// ── Engineering state shape (minimal — only what factory manages) ─────────────

export interface FactoryManagedState {
  /** Cleared on topology switch — micro: no DC string objects */
  inverterArray: unknown[];
  /** Cleared on topology switch — prevents ecosystem bleed */
  ecosystem: unknown[];
  /** Cleared on topology switch */
  dcStrings: unknown[];
  /** Set by factory after topology switch */
  topologyType: TopologyType;
}

// ── Factory functions ─────────────────────────────────────────────────────────

/**
 * Create or retrieve the system instance for the given topology.
 * If topology has changed, destroys the previous instance and clears
 * all topology-specific state arrays before returning the new instance.
 *
 * @param topology  The desired topology type
 * @param state     Mutable engineering state — arrays are cleared in-place
 * @returns         The system instance for the requested topology
 */
export function getSystemInstance(
  topology: TopologyType,
  state: FactoryManagedState
): SystemInstance {
  if (_currentTopology !== topology) {
    // 1. Destroy previous instance
    if (_currentInstance !== null) {
      _currentInstance.destroy();
      _currentInstance = null;
    }

    // 2. Clear inverter arrays — micro must NOT inherit string objects
    state.inverterArray.length = 0;
    state.dcStrings.length = 0;

    // 3. Clear ecosystem — prevents SolarEdge bleed into Enphase and vice-versa
    state.ecosystem.length = 0;

    // 4. Update topology marker
    state.topologyType = topology;

    // 5. Create new instance
    _currentInstance = createInstance(topology);
    _currentTopology = topology;
  }

  return _currentInstance!;
}

/**
 * Force-destroy the current instance and reset factory state.
 * Call this when the engineering page unmounts or resets.
 */
export function destroyCurrentInstance(): void {
  if (_currentInstance !== null) {
    _currentInstance.destroy();
    _currentInstance = null;
  }
  _currentTopology = null;
}

/**
 * Return the current topology type without creating a new instance.
 */
export function getCurrentTopology(): TopologyType | null {
  return _currentTopology;
}

// ── Instance constructors ─────────────────────────────────────────────────────

function createInstance(topology: TopologyType): SystemInstance {
  switch (topology) {
    case 'MICROINVERTER':
      return createMicroInstance();
    case 'STRING_INVERTER':
      return createStringInstance('STRING_INVERTER');
    case 'STRING_WITH_OPTIMIZER':
      return createStringInstance('STRING_WITH_OPTIMIZER');
    default: {
      const _exhaustive: never = topology;
      throw new Error(`Unknown topology: ${_exhaustive}`);
    }
  }
}

function createMicroInstance(): MicroSystemInstance {
  let _destroyed = false;

  return {
    type: 'MICROINVERTER',

    calculate(input: MicroSystemInput): MicroElectricalResult {
      if (_destroyed) {
        throw new Error('MicroSystemInstance has been destroyed. Call getSystemInstance() to get a new one.');
      }
      return calcMicroSystem(input);
    },

    destroy(): void {
      _destroyed = true;
    },
  };
}

function createStringInstance(
  type: 'STRING_INVERTER' | 'STRING_WITH_OPTIMIZER'
): StringSystemInstance {
  let _destroyed = false;

  return {
    type,

    calculate(input: StringSystemInput): StringSystemResult {
      if (_destroyed) {
        throw new Error('StringSystemInstance has been destroyed. Call getSystemInstance() to get a new one.');
      }
      // Pass topology type through to the calc function
      const result = calcStringSystem(input);
      return { ...result, topologyType: type };
    },

    destroy(): void {
      _destroyed = true;
    },
  };
}

// ── Convenience: run calculation directly ────────────────────────────────────

/**
 * Switch topology (if needed) and immediately run the calculation.
 * This is the primary entry point for the engineering page.
 *
 * @param topology  Desired topology
 * @param state     Mutable engineering state (arrays cleared in-place on switch)
 * @param input     Calculation input for the given topology
 * @returns         Typed calculation result
 */
export function runTopologyCalc(
  topology: 'MICROINVERTER',
  state: FactoryManagedState,
  input: MicroSystemInput
): MicroElectricalResult;

export function runTopologyCalc(
  topology: 'STRING_INVERTER' | 'STRING_WITH_OPTIMIZER',
  state: FactoryManagedState,
  input: StringSystemInput
): StringSystemResult;

export function runTopologyCalc(
  topology: TopologyType,
  state: FactoryManagedState,
  input: MicroSystemInput | StringSystemInput
): SystemResult {
  const instance = getSystemInstance(topology, state);

  if (instance.type === 'MICROINVERTER') {
    return (instance as MicroSystemInstance).calculate(input as MicroSystemInput);
  } else {
    return (instance as StringSystemInstance).calculate(input as StringSystemInput);
  }
}

// ── Type guards ───────────────────────────────────────────────────────────────

export function isMicroResult(result: SystemResult): result is MicroElectricalResult {
  return result.topologyType === 'MICROINVERTER';
}

export function isStringResult(result: SystemResult): result is StringSystemResult {
  return result.topologyType === 'STRING_INVERTER' || result.topologyType === 'STRING_WITH_OPTIMIZER';
}