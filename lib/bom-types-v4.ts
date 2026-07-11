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
}
