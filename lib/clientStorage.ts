/**
 * clientStorage.ts — localStorage-based persistence layer
 *
 * WHY THIS EXISTS:
 * Even though the server now uses Neon PostgreSQL (persistent), localStorage
 * provides an instant-load cache and emergency backup:
 *
 * 1. INSTANT LOAD: UI renders immediately from cache while server fetch is in-flight
 * 2. OFFLINE RESILIENCE: If the server is unreachable, local data is shown
 * 3. EMERGENCY BACKUP: If a server save fails, data is preserved locally
 * 4. OPTIMISTIC UPDATES: New items appear immediately before server confirms
 *
 * Server data always wins on merge (server is source of truth).
 * This is a client-side module (browser only).
 */

const KEYS = {
  clients:  'solarpro:clients',
  projects: 'solarpro:projects',
  layouts:  'solarpro:layouts',
  user:     'solarpro:user',
} as const;

// ─── Generic helpers ──────────────────────────────────────────────────────────

function readStore<T>(key: string): T[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    return JSON.parse(raw) as T[];
  } catch {
    return [];
  }
}

function writeStore<T>(key: string, items: T[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch (e) {
    console.warn('[clientStorage] localStorage write failed:', e);
  }
}

function upsert<T extends { id: string }>(key: string, item: T): void {
  const items = readStore<T>(key);
  const idx = items.findIndex(i => i.id === item.id);
  if (idx >= 0) items[idx] = item;
  else items.push(item);
  writeStore(key, items);
}

function removeById(key: string, id: string): void {
  const items = readStore<{ id: string }>(key);
  writeStore(key, items.filter(i => i.id !== id));
}

// ─── Clients ──────────────────────────────────────────────────────────────────

export function localSaveClient(client: any): void {
  upsert(KEYS.clients, client);
}

export function localGetClients(): any[] {
  return readStore(KEYS.clients);
}

export function localGetClient(id: string): any | null {
  return readStore<any>(KEYS.clients).find(c => c.id === id) ?? null;
}

export function localDeleteClient(id: string): void {
  removeById(KEYS.clients, id);
}

export function localSetClients(clients: any[]): void {
  writeStore(KEYS.clients, clients);
}

// ─── Projects ─────────────────────────────────────────────────────────────────

export function localSaveProject(project: any): void {
  upsert(KEYS.projects, project);
}

export function localGetProjects(): any[] {
  return readStore(KEYS.projects);
}

export function localGetProject(id: string): any | null {
  return readStore<any>(KEYS.projects).find(p => p.id === id) ?? null;
}

export function localDeleteProject(id: string): void {
  removeById(KEYS.projects, id);
}

export function localSetProjects(projects: any[]): void {
  writeStore(KEYS.projects, projects);
}

// ─── Layouts ─────────────────────────────────────────────────────────────────

export function localSaveLayout(projectId: string, layout: any): void {
  const layouts = readStore<any>(KEYS.layouts);
  const idx = layouts.findIndex(l => l.projectId === projectId);
  const entry = { ...layout, projectId, savedAt: new Date().toISOString() };
  if (idx >= 0) layouts[idx] = entry;
  else layouts.push(entry);
  writeStore(KEYS.layouts, layouts);
}

export function localGetLayout(projectId: string): any | null {
  return readStore<any>(KEYS.layouts).find(l => l.projectId === projectId) ?? null;
}

// ─── Merge server + local data ────────────────────────────────────────────────
/**
 * Merge server response with local cache.
 * Server data takes precedence for items that exist on both sides.
 * Local-only items (created during a serverless cold start) are preserved.
 */
export function mergeWithLocal<T extends { id: string }>(
  serverItems: T[],
  localItems: T[]
): T[] {
  const merged = new Map<string, T>();
  // Local first (lower priority)
  localItems.forEach(item => merged.set(item.id, item));
  // Server overwrites (higher priority)
  serverItems.forEach(item => merged.set(item.id, item));
  return Array.from(merged.values());
}

// ─── Sync helpers ─────────────────────────────────────────────────────────────

/**
 * After a successful API GET /api/clients, call this to sync local cache.
 * Merges server data with any local-only items.
 */
export function syncClientsFromServer(serverClients: any[]): any[] {
  const local = localGetClients();
  const merged = mergeWithLocal(serverClients, local);
  localSetClients(merged);
  return merged;
}

/**
 * After a successful API GET /api/projects, call this to sync local cache.
 */
export function syncProjectsFromServer(serverProjects: any[]): any[] {
  const local = localGetProjects();
  const merged = mergeWithLocal(serverProjects, local);
  localSetProjects(merged);
  return merged;
}

/**
 * Get clients with localStorage fallback.
 * Tries server first; if server returns empty (cold start), returns local cache.
 */
export async function fetchClientsWithFallback(): Promise<any[]> {
  try {
    const res = await fetch('/api/clients');
    const data = await res.json();
    if (data.success && Array.isArray(data.data)) {
      const merged = syncClientsFromServer(data.data);
      return merged;
    }
  } catch (e) {
    console.warn('[clientStorage] Server fetch failed, using local cache:', e);
  }
  return localGetClients();
}

/**
 * Get projects with localStorage fallback.
 */
export async function fetchProjectsWithFallback(): Promise<any[]> {
  try {
    const res = await fetch('/api/projects');
    const data = await res.json();
    if (data.success && Array.isArray(data.data)) {
      const merged = syncProjectsFromServer(data.data);
      return merged;
    }
  } catch (e) {
    console.warn('[clientStorage] Server fetch failed, using local cache:', e);
  }
  return localGetProjects();
}

/**
 * Get a single project with localStorage fallback.
 */
export async function fetchProjectWithFallback(id: string): Promise<any | null> {
  try {
    const res = await fetch(`/api/projects/${id}`);
    const data = await res.json();
    if (data.success && data.data) {
      localSaveProject(data.data);
      return data.data;
    }
  } catch (e) {
    console.warn('[clientStorage] Server fetch failed, using local cache:', e);
  }
  return localGetProject(id);
}

/**
 * Get a single client with localStorage fallback.
 */
export async function fetchClientWithFallback(id: string): Promise<any | null> {
  try {
    const res = await fetch(`/api/clients/${id}`);
    const data = await res.json();
    if (data.success && data.data) {
      localSaveClient(data.data);
      return data.data;
    }
  } catch (e) {
    console.warn('[clientStorage] Server fetch failed, using local cache:', e);
  }
  return localGetClient(id);
}

// ─── Emergency Backup (auto-save failsafe) ─────────────────────────────────

const EMERGENCY_KEY_PREFIX = 'autosave_emergency_';
const MAX_EMERGENCY_BACKUPS = 5;

/**
 * Save an emergency backup of layout data.
 * Called by useAutoSave hook on page unload when server save hasn't completed.
 */
export function saveEmergencyBackup(projectId: string, data: any): void {
  if (typeof window === 'undefined') return;
  try {
    const key = `${EMERGENCY_KEY_PREFIX}${projectId}_${Date.now()}`;
    localStorage.setItem(key, JSON.stringify({
      projectId,
      data,
      savedAt: new Date().toISOString(),
    }));

    // Prune old backups — keep only the most recent MAX_EMERGENCY_BACKUPS per project
    const allKeys = Object.keys(localStorage)
      .filter(k => k.startsWith(`${EMERGENCY_KEY_PREFIX}${projectId}_`))
      .sort()
      .reverse();

    allKeys.slice(MAX_EMERGENCY_BACKUPS).forEach(k => localStorage.removeItem(k));
  } catch (e) {
    console.warn('[clientStorage] Emergency backup failed:', e);
  }
}

/**
 * Get the most recent emergency backup for a project.
 * Returns null if no backup exists or backup is older than 24 hours.
 */
export function getEmergencyBackup(projectId: string): { data: any; savedAt: string } | null {
  if (typeof window === 'undefined') return null;
  try {
    const keys = Object.keys(localStorage)
      .filter(k => k.startsWith(`${EMERGENCY_KEY_PREFIX}${projectId}_`))
      .sort()
      .reverse();

    if (keys.length === 0) return null;

    const raw = localStorage.getItem(keys[0]);
    if (!raw) return null;

    const backup = JSON.parse(raw);
    // Only return backups less than 24 hours old
    const age = Date.now() - new Date(backup.savedAt).getTime();
    if (age > 24 * 60 * 60 * 1000) return null;

    return { data: backup.data, savedAt: backup.savedAt };
  } catch {
    return null;
  }
}

/**
 * Clear all emergency backups for a project (after successful server save).
 */
export function clearEmergencyBackups(projectId: string): void {
  if (typeof window === 'undefined') return;
  try {
    Object.keys(localStorage)
      .filter(k => k.startsWith(`${EMERGENCY_KEY_PREFIX}${projectId}_`))
      .forEach(k => localStorage.removeItem(k));
  } catch {
    // ignore
  }
}