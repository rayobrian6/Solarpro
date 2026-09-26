// ═══════════════════════════════════════════════════════════════════════════
// THE RECORDED COMBINER, READ ON THE SERVER — one reader for every artefact.
//
// The installer's pick lives in projects.selected_equipment.combinerSelection.
// The engineering page reads it once and posts its copy with every SLD, SLD PDF,
// BOM and permit request — and that read fails OPEN (a dropped GET leaves the
// page on "nothing selected"). The permit route already read the store itself;
// the Diagram SLD, the SLD PDF and the BOM trusted the page's copy, so after one
// dropped read the permit package named the installer's combiner while every
// drawing and the priced BOM named the catalogue pairing (review, 2026-09-25).
//
// Every route now asks THIS. The stored answer wins whenever it can be read —
// including "nothing selected", which removes a posted id. The posted value
// stands only when there is no project to read: no projectId (or not a UUID),
// no database configured (the DB-less harnesses and e2e), or no row. What a
// route does with an UNREADABLE store is its own call: the permit refuses (it
// is the sealed artefact); a preview drawing keeps the posted value.
//
// No DB import here: the caller hands in its own `getDbReady`, so a test that
// fakes a route's database handle fakes this read too.
// ═══════════════════════════════════════════════════════════════════════════

import { readCombinerSelection, selectedCombinerDeviceId } from './service';
import { DbConfigError } from '@/lib/db-ready';

type SqlTag = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type StoredCombinerRead =
  /** The project row was read. `deviceId` null ⇔ nothing is selected. */
  | { kind: 'stored'; deviceId: string | null }
  /** There was nothing to read — the posted value stands. */
  | { kind: 'not-read'; reason: 'no-project' | 'no-database' | 'no-row' }
  /** A real project whose store could not be read. */
  | { kind: 'unreadable'; error: string };

/** True when there is a project to read. Check it BEFORE reaching for a DB
 *  handle, so a request with no project never touches the database module. */
export function isReadableProjectId(projectId: unknown): projectId is string {
  return typeof projectId === 'string' && UUID_RE.test(projectId);
}

export async function readStoredCombinerSelection(
  getSql: (() => Promise<SqlTag>) | undefined,
  projectId: unknown,
): Promise<StoredCombinerRead> {
  if (!isReadableProjectId(projectId)) return { kind: 'not-read', reason: 'no-project' };
  if (typeof getSql !== 'function') return { kind: 'not-read', reason: 'no-database' };
  try {
    const sql = await getSql();
    const rows = (await sql`
      SELECT selected_equipment FROM projects WHERE id = ${projectId} LIMIT 1
    `) as Array<{ selected_equipment?: unknown }>;
    if (!Array.isArray(rows) || rows.length === 0) return { kind: 'not-read', reason: 'no-row' };
    const se = rows[0]?.selected_equipment;
    const store = se && typeof se === 'object' && !Array.isArray(se) ? se as Record<string, unknown> : null;
    return { kind: 'stored', deviceId: selectedCombinerDeviceId(readCombinerSelection(store)) };
  } catch (err: unknown) {
    // No database at all: nothing to contradict the payload.
    if (err instanceof DbConfigError) return { kind: 'not-read', reason: 'no-database' };
    return { kind: 'unreadable', error: (err as Error)?.message ?? String(err) };
  }
}

/** The posted id, trimmed; null when absent. */
export function postedCombinerId(posted: unknown): string | null {
  return typeof posted === 'string' && posted.trim() ? posted.trim() : null;
}

/**
 * The combiner id a route resolves with: the stored answer when it was read,
 * otherwise the posted one (also on `unreadable` — a caller that must refuse
 * checks `read.kind` first). Logs when the two disagree, so a dropped page read
 * is visible in the server log rather than silent.
 */
export function effectiveCombinerId(posted: unknown, read: StoredCombinerRead, tag: string): string | null {
  const p = postedCombinerId(posted);
  if (read.kind === 'stored') {
    if (read.deviceId !== p) {
      console.warn(`[${tag}] combiner selection — stored:`, read.deviceId ?? '(none)',
        'posted:', p ?? '(none)', '— using the project record');
    }
    return read.deviceId;
  }
  if (read.kind === 'unreadable') {
    console.warn(`[${tag}] combiner selection unreadable (${read.error}) — the posted value stands:`, p ?? '(none)');
  }
  return p;
}
