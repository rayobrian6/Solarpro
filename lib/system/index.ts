// ═══════════════════════════════════════════════════════════════════
// System Definition Layer — Public API
// ═══════════════════════════════════════════════════════════════════

// ── Vocabulary (canonical types, normalizers, predicates) ────────
export type {
  CanonicalSystemType,
  InverterTopology,
  MountType,
  VerboseSystemType,
} from './systemVocabulary';

export {
  normalizeSystemType,
  toVerboseSystemType,
  toCanonicalSystemType,
  normalizeTopology,
  toUpperTopology,
  isRoof,
  isGround,
  isFence,
  isMicro,
  isString,
  isOptimizer,
  displaySystemType,
  displaySystemTypeShort,
  displayTopology,
  pv2SheetTitle,
  pv3SheetTitle,
} from './systemVocabulary';

// ── Core types & builder (from systemDefinition.ts) ──────────────
export type {
  SystemType,
  PanelOrientation,
  RailOrientation,
  InverterType,
  RackingStyle,
  PanelDefinition,
  LayoutDefinition,
  StructureDefinition,
  ElectricalDefinition,
  SystemDefinition,
  SystemDefinitionInput,
} from './systemDefinition';

export {
  buildSystemDefinition,
  resolveSystemType,
} from './systemDefinition';

// ── Normalized accessors (from systemAccessors.ts) ───────────────
export {
  getSystemType,
  getInverterTopology,
  getEquipmentContext,
  getEquipmentContextBySubSystem,
  topologyToLegacy,
} from './systemAccessors';