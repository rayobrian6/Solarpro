// ============================================================
// Accessory Resolver V4
// Resolves accessory quantities from registry rules.
// No brand logic. Pure math from topology + equipment rules.
// ============================================================

import {
  AccessoryRule,
  EquipmentRegistryEntry,
  evaluateQuantityFormula,
  getRegistryEntry,
  getRequiredAccessories,
} from './equipment-registry';

// ─── Resolution Context ───────────────────────────────────────────────────────

export interface ResolutionContext {
  // Equipment IDs
  inverterId: string;
  optimizerId?: string;
  rackingId?: string;
  batteryId?: string;

  // Quantities
  moduleCount: number;
  stringCount: number;
  inverterCount: number;
  branchCount?: number;       // AC branches (microinverter topology)

  // Layout (Phase 3 - Future Layout Engine)
  rowCount?: number;          // number of rows in the array layout
  columnCount?: number;       // number of columns per row
  layoutOrientation?: 'portrait' | 'landscape';

  // Structural
  railSectionCount?: number;
  attachmentCount?: number;
  systemKw?: number;

  // Site conditions
  roofType?: string;          // 'shingle' | 'tile' | 'metal' | 'flat'
  mountType?: string;         // 'roof' | 'ground'
}

// ─── Resolved Accessory ───────────────────────────────────────────────────────

export interface ResolvedAccessory {
  category: string;
  description: string;
  manufacturer: string;
  model: string;
  partNumber: string;
  quantity: number;
  quantityFormula: string;
  required: boolean;
  necReference?: string;
  notes?: string;
  derivedFrom: string;        // which equipment drove this accessory
  autoAdded: boolean;
}

// ─── Resolution Result ────────────────────────────────────────────────────────

export interface AccessoryResolutionResult {
  accessories: ResolvedAccessory[];
  byCategory: Record<string, ResolvedAccessory[]>;
  totalItems: number;
  log: ResolutionLogEntry[];
}

export interface ResolutionLogEntry {
  category: string;
  quantity: number;
  formula: string;
  derivedFrom: string;
  reason: string;
}

// ─── Main Resolver ────────────────────────────────────────────────────────────

export function resolveAccessories(ctx: ResolutionContext): AccessoryResolutionResult {
  const log: ResolutionLogEntry[] = [];
  const accessories: ResolvedAccessory[] = [];

  // Compute attachment count if not provided
  // Phase 1 Fix: Use rowCount if provided, fall back to panelCount/2
  const railFt = calcRailFt(ctx.moduleCount, 41.7, ctx.rowCount);
  const attachmentSpacing = 48; // default, overridden by structural data
  const attachmentCount = ctx.attachmentCount ?? Math.ceil((railFt * 12) / attachmentSpacing) + 2;
  const railSectionCount = ctx.railSectionCount ?? Math.ceil(railFt / 14);
  const systemKw = ctx.systemKw ?? (ctx.moduleCount * 0.4); // default 400W modules

  const formulaCtx = {
    modules: ctx.moduleCount,
    strings: ctx.stringCount,
    inverters: ctx.inverterCount,
    branches: ctx.branchCount ?? ctx.stringCount,
    railSections: railSectionCount,
    attachments: attachmentCount,
    rows: ctx.rowCount ?? Math.ceil(ctx.moduleCount / 2), // Phase 1 Fix: use actual rowCount
    systemKw,
  };

  // Collect all equipment entries to process
  const equipmentIds = [
    ctx.inverterId,
    ctx.optimizerId,
    ctx.rackingId,
    ctx.batteryId,
  ].filter(Boolean) as string[];

  for (const equipId of equipmentIds) {
    const entry = getRegistryEntry(equipId);
    if (!entry) continue;

    for (const rule of entry.requiredAccessories) {
      // Check conditional
      if (rule.conditional && !evaluateConditional(rule.conditional, ctx)) {
        continue;
      }

      const quantity = resolveQuantity(rule, formulaCtx);
      if (quantity <= 0 && rule.required) continue;

      const resolved: ResolvedAccessory = {
        category: rule.category,
        description: rule.description,
        manufacturer: rule.defaultManufacturer ?? 'Generic',
        model: rule.defaultModel ?? rule.category,
        partNumber: rule.defaultPartNumber ?? '',
        quantity,
        quantityFormula: buildFormulaString(rule, formulaCtx),
        required: rule.required,
        necReference: rule.necReference,
        notes: rule.notes,
        derivedFrom: `${entry.manufacturer} ${entry.model}`,
        autoAdded: true,
      };

      accessories.push(resolved);

      log.push({
        category: rule.category,
        quantity,
        formula: resolved.quantityFormula,
        derivedFrom: resolved.derivedFrom,
        reason: rule.description,
      });
    }
  }

  // Deduplicate: if same category appears from multiple sources, keep highest quantity
  const deduped = deduplicateAccessories(accessories);

  // Group by category
  const byCategory: Record<string, ResolvedAccessory[]> = {};
  for (const acc of deduped) {
    if (!byCategory[acc.category]) byCategory[acc.category] = [];
    byCategory[acc.category].push(acc);
  }

  return {
    accessories: deduped,
    byCategory,
    totalItems: deduped.length,
    log,
  };
}

// ─── Quantity Resolution ──────────────────────────────────────────────────────

function resolveQuantity(
  rule: AccessoryRule,
  ctx: {
    modules: number;
    strings: number;
    inverters: number;
    branches: number;
    railSections: number;
    attachments: number;
    systemKw: number;
  }
): number {
  const multiplier = rule.quantityMultiplier ?? 1;

  switch (rule.quantityRule) {
    case 'perModule':
      return ctx.modules * multiplier;
    case 'perString':
      return ctx.strings * multiplier;
    case 'perInverter':
      return ctx.inverters * multiplier;
    case 'perSystem':
      return 1 * multiplier;
    case 'perBranch':
      return ctx.branches * multiplier;
    case 'perRailSection':
      return ctx.railSections * multiplier;
    case 'perAttachment':
      return ctx.attachments * multiplier;
    case 'perKw':
      return Math.ceil(ctx.systemKw) * multiplier;
    case 'formula':
      if (rule.quantityFormula) {
        return Math.ceil(evaluateQuantityFormula(rule.quantityFormula, ctx) * multiplier);
      }
      return 0;
    default:
      return 0;
  }
}

// ─── Formula String Builder ───────────────────────────────────────────────────

function buildFormulaString(
  rule: AccessoryRule,
  ctx: {
    modules: number;
    strings: number;
    inverters: number;
    branches: number;
    railSections: number;
    attachments: number;
    systemKw: number;
  }
): string {
  switch (rule.quantityRule) {
    case 'perModule':
      return `${ctx.modules} modules × ${rule.quantityMultiplier ?? 1}`;
    case 'perString':
      return `${ctx.strings} strings × ${rule.quantityMultiplier ?? 1}`;
    case 'perInverter':
      return `${ctx.inverters} inverters × ${rule.quantityMultiplier ?? 1}`;
    case 'perSystem':
      return '1 per system';
    case 'perBranch':
      return `${ctx.branches} branches × ${rule.quantityMultiplier ?? 1}`;
    case 'perRailSection':
      return `${ctx.railSections} rail sections × ${rule.quantityMultiplier ?? 1}`;
    case 'perAttachment':
      return `${ctx.attachments} attachments × ${rule.quantityMultiplier ?? 1}`;
    case 'perKw':
      return `${ctx.systemKw.toFixed(1)} kW × ${rule.quantityMultiplier ?? 1}`;
    case 'formula':
      return rule.quantityFormula ?? 'custom formula';
    default:
      return 'unknown';
  }
}

// ─── Conditional Evaluator ────────────────────────────────────────────────────

function evaluateConditional(condition: string, ctx: ResolutionContext): boolean {
  // Safe conditional evaluation
  const safeCondition = condition
    .replace(/roofType\s*===\s*(\w+)/g, (_, val) => `"${ctx.roofType}" === "${val}"`)
    .replace(/roofType\s*!==\s*(\w+)/g, (_, val) => `"${ctx.roofType}" !== "${val}"`)
    .replace(/mountType\s*===\s*(\w+)/g, (_, val) => `"${ctx.mountType}" === "${val}"`)
    .replace(/strings\s*>\s*(\d+)/g, (_, val) => `${ctx.stringCount} > ${val}`)
    .replace(/strings\s*>=\s*(\d+)/g, (_, val) => `${ctx.stringCount} >= ${val}`)
    .replace(/modules\s*>\s*(\d+)/g, (_, val) => `${ctx.moduleCount} > ${val}`)
    .replace(/\|\|/g, '||')
    .replace(/&&/g, '&&');

  try {
    // eslint-disable-next-line no-new-func
    return Boolean(new Function(`return ${safeCondition}`)());
  } catch {
    return true; // default to including if condition can't be evaluated
  }
}

// ─── Deduplication ────────────────────────────────────────────────────────────

function deduplicateAccessories(accessories: ResolvedAccessory[]): ResolvedAccessory[] {
  const seen = new Map<string, ResolvedAccessory>();

  for (const acc of accessories) {
    const key = `${acc.category}::${acc.model}`;
    const existing = seen.get(key);

    if (!existing) {
      seen.set(key, acc);
    } else {
      // Keep the one with higher quantity, merge derivedFrom
      if (acc.quantity > existing.quantity) {
        seen.set(key, {
          ...acc,
          derivedFrom: `${existing.derivedFrom}, ${acc.derivedFrom}`,
        });
      } else {
        seen.set(key, {
          ...existing,
          derivedFrom: `${existing.derivedFrom}, ${acc.derivedFrom}`,
        });
      }
    }
  }

  return Array.from(seen.values());
}

// ─── Rail Calculation Helper ──────────────────────────────────────────────────

function calcRailFt(panelCount: number, panelWidthIn: number = 41.7, rowCount?: number): number {
  // Phase 1 Fix: Use actual rowCount if provided, otherwise fall back to 2 (default)
  const panelsPerRow = rowCount ? Math.ceil(panelCount / rowCount) : Math.ceil(panelCount / 2);
  const railIn = panelsPerRow * panelWidthIn + 12;
  return Math.ceil((railIn / 12) * 2); // 2 rails (top and bottom)
}

// ─── Attachment Count Calculator ─────────────────────────────────────────────

export function calcAttachmentCount(
  moduleCount: number,
  attachmentSpacingIn: number = 48,
  panelWidthIn: number = 41.7,
  rowCount?: number,
): number {
  const railFt = calcRailFt(moduleCount, panelWidthIn, rowCount);
  return Math.ceil((railFt * 12) / attachmentSpacingIn) + 2;
}

// ─── AC Disconnect Sizing ─────────────────────────────────────────────────────

export function sizeACDisconnect(
  totalACAmps: number,
  safetyFactor: number = 1.25,
): number {
  const required = totalACAmps * safetyFactor;
  const sizes = [15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 125, 150, 175, 200];
  return sizes.find(s => s >= required) ?? Math.ceil(required / 10) * 10;
}

// ─── Trunk Cable Count (Enphase-style) ───────────────────────────────────────

export function calcTrunkCableSections(
  moduleCount: number,
  modulesPerSection: number = 16,
): number {
  return Math.ceil(moduleCount / modulesPerSection);
}