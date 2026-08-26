/**
 * Design entity — the project → design hierarchy boundary.
 *
 * A project can have N designs; each design carries its own $/W pricing
 * used for ROI calculations. Matches Aurora's "Create Design" modal flow
 * (HANDOFF_2026-08-25_AURORA_ANALYSIS.md §5).
 *
 * Storage is localStorage-backed for now — see TODO below for the future
 * API migration path.
 */

export interface Design {
  id: string;
  projectId: string;
  name: string;
  costPerWatt: number;
  createdAt: string;
  active: boolean;
}

export interface DesignDraft {
  name: string;
  costPerWatt: number;
}

export const DEFAULT_COST_PER_WATT = 4.0;
export const DEFAULT_NAME_PREFIX = 'Design';
export const NAME_MIN_LEN = 1;
export const NAME_MAX_LEN = 80;
export const COST_MIN = 0.01;
export const COST_MAX = 100;

const STORAGE_KEY = 'solarpro.designs.v1';

export type DesignValidation = {
  ok: boolean;
  name?: string;
  costPerWatt?: string;
};

export function validateDesignDraft(draft: DesignDraft): DesignValidation {
  const errors: DesignValidation = { ok: false };

  const trimmedName = (draft.name ?? '').trim();
  if (trimmedName.length < NAME_MIN_LEN) {
    errors.name = 'Name is required';
  } else if (trimmedName.length > NAME_MAX_LEN) {
    errors.name = `Name must be ${NAME_MAX_LEN} characters or fewer`;
  }

  const cost = Number(draft.costPerWatt);
  if (!Number.isFinite(cost)) {
    errors.costPerWatt = 'Cost must be a number';
  } else if (cost <= 0) {
    errors.costPerWatt = 'Cost must be greater than 0';
  } else if (cost > COST_MAX) {
    errors.costPerWatt = `Cost must be ${COST_MAX} or less`;
  }

  if (errors.name === undefined && errors.costPerWatt === undefined) {
    return { ok: true };
  }
  return errors;
}

export function suggestDesignName(existingNames: string[]): string {
  if (!Array.isArray(existingNames) || existingNames.length === 0) {
    return `${DEFAULT_NAME_PREFIX} 1`;
  }

  let maxN = 0;
  for (const name of existingNames) {
    const m = name.match(new RegExp(`^${DEFAULT_NAME_PREFIX}\\s+(\\d+)$`));
    if (m && m[1]) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > maxN) maxN = n;
    }
  }

  return `${DEFAULT_NAME_PREFIX} ${maxN + 1}`;
}

export function readDesigns(): Design[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Design[]) : [];
  } catch {
    return [];
  }
}

export function writeDesigns(designs: Design[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(designs));
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[Design] localStorage write failed:', e);
  }
}

export function appendDesign(design: Design): Design[] {
  const all = readDesigns();
  const next = [...all, design];
  writeDesigns(next);
  return next;
}

export function listDesignsForProject(projectId: string): Design[] {
  return readDesigns().filter((d) => d.projectId === projectId);
}

export function generateDesignId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const rnd = () => Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
  return `${rnd()}${rnd()}-${rnd()}-4${rnd().slice(1)}-${rnd()}-${rnd()}${rnd()}${rnd()}`;
}

export function __resetDesignsForTesting(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
