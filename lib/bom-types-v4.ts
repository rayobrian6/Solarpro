// Neutral BOM V4 shared types. Kept separate from the BOM engine and system
// profile builders to avoid type-only import cycles between those modules.

export type BOMStageId =
  | 'array'
  | 'dc'
  | 'inverter'
  | 'ac'
  | 'structural'
  | 'monitoring'
  | 'labels'
  // Recommended extra/consumable materials crews carry per job — NOT installed
  // quantities. Kept as a distinct stage so consumers can subtotal it separately
  // ($/W stays on required materials) and the permit SCHED can exclude it.
  | 'truck_stock'
  // Suggested TOOLS for this job (bandsaw for rails, Q-cable disconnect tool,
  // EMT bender, torque tools…) — resolved from what the job actually involves.
  // Never priced, never counted in totals/unpriced KPIs, never on the permit.
  | 'tools';

export type BOMSystemType = 'roof' | 'ground' | 'fence';

export interface BOMLineItemV4 {
  id: string;
  stageId: BOMStageId;
  stageLabel: string;
  category: string;
  manufacturer: string;
  model: string;
  partNumber: string;
  description: string;
  quantity: number;
  unit: 'ea' | 'ft' | 'lf' | 'roll' | 'set' | 'lot';
  unitCost?: number;
  totalCost?: number;
  necReference?: string;
  derivedFrom: string;
  formula?: string;
  notes?: string;
  required: boolean;
  /** Owning subsystem (contract §1.3 permit carriage — docs/
   *  ARCHITECTURE-per-subsystem-equipment.md). Absent on the legacy
   *  single-system path; stamped in addItem by the per-sub BOM stages
   *  (Wave 2c) only when the generation input carries subSystems. */
  subSystem?: BOMSystemType;

  // ── PPC §5/§8/§9 — PROCUREMENT ORDERABILITY STATE ───────────────────────────
  // Audit rule (PPC cross-cutting finding 3): any authority state that crosses
  // RackingBOMRow → BOMLineItemV4 → PermitBOMItem must be DECLARED ON ALL THREE.
  // These fields exist because it wasn't: calcRackingBOM already set
  // pending/orderable:false on the seven assembly-dependent racking rows and
  // emitRackingBOMInto silently discarded them — there was nowhere to put them —
  // so SCHED-3 printed bare quantities and an intact manufacturer on rows the
  // engine had already classified NON-ORDERABLE.
  //
  // Every field is OPTIONAL and conditionally spread by addItem, so a row with no
  // orderability state serializes byte-identically to before (Wave-0 goldens).
  /** true ⇒ NOT an orderable procurement line: a DESIGN/CANDIDATE quantity only,
   *  excluded from the authoritative procurement total and from every orderable
   *  export. The quantity is retained so the exact orderable row regenerates the
   *  moment its authority verifies. */
  nonOrderable?: boolean;
  /** why — carries the governing blocker code + the human reason. Rendered. */
  nonOrderableReason?: string;
  /** Is the QUANTITY itself established?
   *   'established' ⇒ the count is proven by the topology/geometry.
   *   'pending'     ⇒ the count is NOT established (the modeled value may be 0 but
   *                   0 is not the answer). A pending quantity may NEVER render as
   *                   a certain number, and its row is excluded from procurement
   *                   approval. This is distinct from `nonOrderable`: the sealing
   *                   caps ARE orderable equipment whose FIELD quantity is unknown. */
  quantityState?: 'established' | 'pending';
  /** what the quantity cell prints while pending — e.g.
   *  '0 MODELED / FIELD QUANTITY PENDING'. Never a bare number. */
  quantityStateLabel?: string;

  // ══════════════════════════════════════════════════════════════════════════
  // ECD W1-A/W1-B/W1-D — PROCUREMENT AUTHORITY (producer half).
  // The V4 engine runs BEFORE the snapshot exists, so it cannot know which
  // release requirements are open. It therefore declares the FACTS ONLY (where
  // the quantity came from, which route/equipment objects it depends on, and —
  // where the producer itself already knows the row is not a selected product —
  // an explicit state hint). `classifyProcurementAuthority` in
  // lib/permit/utils/bomForPermit.ts is the SINGLE consumer that turns these
  // facts plus the snapshot's open requirements into the row's one
  // `authorityState`. No renderer reads these directly.
  // ══════════════════════════════════════════════════════════════════════════
  /** Stable content-derived row identity — see lib/bom/bomLineId.ts. Stamped by
   *  the ONE pass at the end of generateBOMForPermit (which is why it is
   *  optional here: the V4 engine does not assign it). */
  bomLineId?: string;
  /** WHERE the quantity came from. `route-derived` is the load-bearing value:
   *  while ROUTE-LENGTH-ESTIMATE is open such a row can never be
   *  VERIFIED_ORDERABLE (ECD §3). `unknown` means a length/count the producer
   *  could NOT establish — it must never be replaced by a fabricated default. */
  quantitySource?: BomQuantitySource;
  /** canonical run/raceway segment ids this row's quantity depends on. */
  affectedRouteIds?: string[];
  /** canonical equipment ids this row's identity depends on. */
  affectedEquipmentIds?: string[];
  /** producer-declared state when the PRODUCER itself knows the row is not a
   *  verified selected product (Q-CONN field-splice connectors, the Polaris tap
   *  connector). The classifier may LOWER a row from this hint, never raise it. */
  authorityStateHint?: ProcurementAuthorityState;
  /** why the producer emitted the hint (kept out of the description prose). */
  authorityStateHintReason?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// ECD §2 — THE ONE PER-ROW PROCUREMENT AUTHORITY STATE.
//
// Exactly one per row. Before this, THREE partially-overlapping mechanisms
// existed on two sides of a type boundary (`nonOrderable` boolean,
// `quantityState` two-valued, and `StructuralBomRow.procurementClass` A/B/C/D
// which never crossed into PermitBOMItem at all), and an UNFLAGGED row was
// assumed verified — a fail-OPEN default that silently counted the module row,
// 21 route-estimated rows, both Q-Cable field-splice connectors and the Polaris
// tap connector inside the "authoritative procurement total".
// ═══════════════════════════════════════════════════════════════════════════

export type ProcurementAuthorityState =
  /** A — exact identity + exact/approved quantity + verified authority + no
   *  blocking requirement affects the row. THE ONLY exportable state. */
  | 'VERIFIED_ORDERABLE'
  /** B — the quantity depends on unresolved routed geometry or a field
   *  measurement. Budgeting only; visible and labeled FIELD VERIFY; excluded
   *  from the authoritative total and from every export. */
  | 'ESTIMATED_FIELD_VERIFY'
  /** C — the product is not selected / not verified. No SKU may be presented as
   *  a selected authority; excluded. */
  | 'CANDIDATE_NON_ORDERABLE'
  /** D — the row may well be required but its QUANTITY is unknown; excluded. */
  | 'QUANTITY_PENDING'
  /** E — not applicable to this design; excluded. */
  | 'EXCLUDED_NOT_APPLICABLE';

/** Every state, in the canonical reporting order (counts render in this order). */
export const PROCUREMENT_AUTHORITY_STATES: readonly ProcurementAuthorityState[] = [
  'VERIFIED_ORDERABLE',
  'ESTIMATED_FIELD_VERIFY',
  'CANDIDATE_NON_ORDERABLE',
  'QUANTITY_PENDING',
  'EXCLUDED_NOT_APPLICABLE',
] as const;

/** The ONE rendered label per state (no renderer may invent its own wording). */
export const PROCUREMENT_AUTHORITY_STATE_LABEL: Record<ProcurementAuthorityState, string> = {
  VERIFIED_ORDERABLE:      'VERIFIED — ORDERABLE',
  ESTIMATED_FIELD_VERIFY:  'ESTIMATED — FIELD VERIFY',
  CANDIDATE_NON_ORDERABLE: 'CANDIDATE — NOT SELECTED / NOT ORDERABLE',
  QUANTITY_PENDING:        'QUANTITY NOT ESTABLISHED',
  EXCLUDED_NOT_APPLICABLE: 'EXCLUDED — NOT APPLICABLE',
};

/** Where a row's quantity came from. */
export type BomQuantitySource =
  /** a canonical device/module COUNT (31 modules ⇒ 31 microinverters). */
  | 'count-derived'
  /** canonical structural/array GEOMETRY (rail length ÷ stock, clamp counts). */
  | 'geometry-derived'
  /** the AC-branch / trunk TOPOLOGY (branch count, drop count, splice pairs). */
  | 'topology-derived'
  /** UNRESOLVED ROUTE GEOMETRY — CAD-derived run length, not routed or field
   *  measured. ECD §3: never VERIFIED_ORDERABLE while ROUTE-LENGTH-ESTIMATE is
   *  open. Includes every fitting whose count is a function of that footage. */
  | 'route-derived'
  /** a fixed per-installation constant established by code/manufacturer
   *  (2 terminations per raceway end, 1 per conductor L1/L2/N). */
  | 'per-installation-constant'
  /** an actual field measurement is already recorded. */
  | 'field-measured'
  /** the producer could NOT establish the quantity. Fail-closed: the row is
   *  QUANTITY_PENDING; nothing is fabricated in its place. */
  | 'unknown';

/** ECD §2 — the per-row authority record. Exactly one is attached to every
 *  final BOM row by the single classifier; every count, label, export decision
 *  and evidence entry reads THIS and nothing else. */
export interface ProcurementAuthorityRecord {
  /** the stable content-derived row identity (lib/bom/bomLineId.ts). */
  bomLineId: string;
  /** what the row IS — manufacturer + model + part number as one identity
   *  string, or the withheld-identity placeholder when no product is selected. */
  itemIdentity: string;
  quantity: number;
  quantityUnit: string;
  /** THE state. Exactly one. */
  authorityState: ProcurementAuthorityState;
  /** projection of the state — `authorityState === 'VERIFIED_ORDERABLE'`. */
  orderable: boolean;
  /** projection of the state — only VERIFIED_ORDERABLE rows may be exported. */
  exportable: boolean;
  quantitySource: BomQuantitySource;
  /** the authority object / rule that produced the classification. */
  authoritySource: string;
  /** 'verified' | 'unverified' | 'pending-authority' | 'pending-measurement' |
   *  'not-applicable'. */
  verificationStatus: ProcurementVerificationStatus;
  /** OPEN release-requirement codes (registry codes) that block this row. */
  blockingRequirementCodes: string[];
  /** canonical run/segment ids the quantity depends on. */
  affectedRouteIds: string[];
  /** canonical equipment ids the identity depends on. */
  affectedEquipmentIds: string[];
  /** the concrete action that would move the row to VERIFIED_ORDERABLE. */
  resolutionAction: string;
  /** authority paths / documents backing the classification. */
  evidenceReferences: string[];
  snapshotId: string | null;
  snapshotDigest: string | null;
  // ── ECD §2 — the PRODUCER FACTS this classification consumed ──────────────
  // `PermitBOMItem.nonOrderable` / `.quantityState` are BOTH producer inputs and
  // (since W1-B) back-compat PROJECTIONS the classifier writes back. Recording
  // what the PRODUCER declared is what keeps the classifier from reading its own
  // output on a second pass — a projection that becomes an input is exactly the
  // "fourth flag system" §2 forbids, and it silently turned every
  // ESTIMATED_FIELD_VERIFY row into a CANDIDATE_NON_ORDERABLE on re-classification.
  /** what the PRODUCER declared for `nonOrderable` (never the projection). */
  producerNonOrderable: boolean;
  /** what the PRODUCER declared for `quantityState` (never the projection). */
  producerQuantityState: 'established' | 'pending' | null;
}

export type ProcurementVerificationStatus =
  | 'verified'
  | 'unverified'
  | 'pending-authority'
  | 'pending-measurement'
  | 'not-applicable';
