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
}
