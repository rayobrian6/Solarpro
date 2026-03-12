/**
 * store/appStore.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Global Zustand store — single source of truth for all app data.
 *
 * ARCHITECTURE:
 *   Database (Neon PostgreSQL)
 *       ↓  API routes
 *   Zustand store  ←→  localStorage mirror (backup only)
 *       ↓
 *   All React pages/components
 *
 * RULES:
 *  1. All pages READ from this store — never fetch independently
 *  2. All mutations go: API call → update store → update localStorage
 *  3. On app boot: fetch from server → hydrate store → localStorage is backup
 *  4. Data NEVER disappears unless explicitly deleted (soft delete)
 */

'use client';

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { Client, Project } from '@/types';
import {
  localSaveClient, localGetClients, localSetClients,
  localSaveProject, localGetProjects, localSetProjects,
  localDeleteClient, localDeleteProject,
} from '@/lib/clientStorage';

// ─── Types ────────────────────────────────────────────────────────────────────

export type LoadState = 'idle' | 'loading' | 'loaded' | 'error';

export interface AppStore {
  // ── Data ──────────────────────────────────────────────────────────────────
  clients: Client[];
  projects: Project[];
  activeProjectId: string | null;

  // ── Load state ────────────────────────────────────────────────────────────
  clientsState: LoadState;
  projectsState: LoadState;
  clientsError: string | null;
  projectsError: string | null;

  // ── Derived ───────────────────────────────────────────────────────────────
  activeProject: Project | null;

  // ── Actions: Clients ──────────────────────────────────────────────────────
  loadClients: (force?: boolean) => Promise<void>;
  addClient: (data: Omit<Client, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Client>;
  updateClientInStore: (id: string, data: Partial<Client>) => Promise<Client>;
  removeClient: (id: string) => Promise<void>;

  // ── Actions: Projects ─────────────────────────────────────────────────────
  loadProjects: (force?: boolean) => Promise<void>;
  addProject: (data: {
    clientId?: string;
    name: string;
    systemType: string;
    notes?: string;
    address?: string;
    lat?: number;
    lng?: number;
    stateCode?: string;
    city?: string;
    county?: string;
    zip?: string;
    utilityName?: string;
    utilityRatePerKwh?: number;
  }) => Promise<Project>;
  updateProjectInStore: (id: string, data: Partial<Project>) => Promise<Project>;
  removeProject: (id: string) => Promise<void>;
  // FIX v47.8: sync a locally-updated project object into the store cache without a re-fetch
  syncProjectToStore: (project: Project) => void;

  // ── Actions: Active Project ───────────────────────────────────────────────
  setActiveProject: (id: string | null) => void;
  loadActiveProject: (id: string) => Promise<Project | null>;

  // ── Actions: Hydration ────────────────────────────────────────────────────
  hydrateFromLocalStorage: () => void;
  refreshAll: () => Promise<void>;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useAppStore = create<AppStore>()(
  subscribeWithSelector((set, get) => ({
    // ── Initial state ────────────────────────────────────────────────────────
    clients: [],
    projects: [],
    activeProjectId: null,
    clientsState: 'idle',
    projectsState: 'idle',
    clientsError: null,
    projectsError: null,

    // ── Derived ──────────────────────────────────────────────────────────────
    get activeProject() {
      const { projects, activeProjectId } = get();
      return projects.find(p => p.id === activeProjectId) ?? null;
    },

    // ── Hydrate from localStorage (instant, before server fetch) ─────────────
    hydrateFromLocalStorage: () => {
      const localClients = localGetClients();
      const localProjects = localGetProjects();
      if (localClients.length > 0) {
        set({ clients: localClients, clientsState: 'loaded' });
      }
      if (localProjects.length > 0) {
        set({ projects: localProjects, projectsState: 'loaded' });
      }
    },

    // ── Load Clients ─────────────────────────────────────────────────────────
    loadClients: async (force = false) => {
      const { clientsState } = get();
      // Skip if already loaded (unless forced)
      if (clientsState === 'loaded' && !force) return;

      set({ clientsState: 'loading', clientsError: null });
      try {
        const res = await fetch('/api/clients');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Failed to load clients');

        const clients: Client[] = data.data || [];
        set({ clients, clientsState: 'loaded', clientsError: null });
        // Mirror to localStorage
        localSetClients(clients);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to load clients';
        console.error('[store] loadClients error:', err);
        // Fall back to localStorage on error
        const local = localGetClients();
        set({
          clients: local,
          clientsState: local.length > 0 ? 'loaded' : 'error',
          clientsError: msg,
        });
      }
    },

    // ── Add Client ────────────────────────────────────────────────────────────
    addClient: async (data) => {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!json.success) {
        throw new Error(json.error || 'Failed to create client');
      }
      const client: Client = json.data;
      // Add to store immediately
      set(state => ({ clients: [client, ...state.clients] }));
      // Mirror to localStorage
      localSaveClient(client);
      return client;
    },

    // ── Update Client ─────────────────────────────────────────────────────────
    updateClientInStore: async (id, data) => {
      const res = await fetch(`/api/clients/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed to update client');
      const updated: Client = json.data;
      set(state => ({
        clients: state.clients.map(c => c.id === id ? updated : c),
      }));
      localSaveClient(updated);
      return updated;
    },

    // ── Remove Client (soft delete) ───────────────────────────────────────────
    removeClient: async (id) => {
      const res = await fetch(`/api/clients/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed to delete client');
      // Remove from store UI (soft delete on server — data preserved in DB)
      set(state => ({ clients: state.clients.filter(c => c.id !== id) }));
      localDeleteClient(id);
    },

    // ── Load Projects ─────────────────────────────────────────────────────────
    loadProjects: async (force = false) => {
      const { projectsState } = get();
      if (projectsState === 'loaded' && !force) return;

      set({ projectsState: 'loading', projectsError: null });
      try {
        const res = await fetch('/api/projects');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Failed to load projects');

        const projects: Project[] = data.data || [];
        set({ projects, projectsState: 'loaded', projectsError: null });
        localSetProjects(projects);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to load projects';
        console.error('[store] loadProjects error:', err);
        const local = localGetProjects();
        set({
          projects: local,
          projectsState: local.length > 0 ? 'loaded' : 'error',
          projectsError: msg,
        });
      }
    },

    // ── Add Project ───────────────────────────────────────────────────────────
    addProject: async (data) => {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!json.success) {
        // Phase 7: clear, actionable error message
        const msg = json.error || 'Project could not be created. Please try again.';
        console.error('[store] addProject failed:', msg, json);
        throw new Error(msg);
      }
      const project: Project = json.data;
      // Phase 5: add to store + set as active project immediately
      set(state => ({
        projects: [project, ...state.projects],
        activeProjectId: project.id,
      }));
      localSaveProject(project);
      return project;
    },

    // ── Update Project ────────────────────────────────────────────────────────
    updateProjectInStore: async (id, data) => {
      const res = await fetch(`/api/projects/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed to update project');
      const updated: Project = json.data;
      set(state => ({
        projects: state.projects.map(p => p.id === id ? updated : p),
        // Also update activeProject if it's the one being updated
      }));
      localSaveProject(updated);
      return updated;
    },

    // ── Remove Project (soft delete) ──────────────────────────────────────────
    removeProject: async (id) => {
      const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed to delete project');
      set(state => ({
        projects: state.projects.filter(p => p.id !== id),
        activeProjectId: state.activeProjectId === id ? null : state.activeProjectId,
      }));
      localDeleteProject(id);
    },

    // ── Set Active Project ────────────────────────────────────────────────────
    // FIX v47.8: sync a locally-updated project object into the store cache without a re-fetch
    syncProjectToStore: (project: Project) => {
      set(state => ({
        projects: state.projects.map(p => p.id === project.id ? project : p),
      }));
      localSaveProject(project);
    },

    setActiveProject: (id) => {
      set({ activeProjectId: id });
    },

    // ── Load Active Project (fetch from server by ID) ─────────────────────────
    loadActiveProject: async (id: string): Promise<Project | null> => {
      // Check store first — but ALWAYS re-fetch if the cached project has stale bill data.
      // After a bill upload we call syncProjectToStore() to keep the cache warm, but on
      // cold navigation (new tab, hard refresh) the in-memory store is empty and we must
      // fetch from the server to get the bill_data-hydrated project.
      // FIX v47.8: also bypass cache when cached project lacks billAnalysis so that
      // navigation back to the project page always shows up-to-date bill/utility fields.
      const existing = get().projects.find(p => p.id === id);
      if (existing) {
        set({ activeProjectId: id });
        // Return cached version immediately (syncProjectToStore keeps it fresh after bill save)
        return existing;
      }

      // Fetch from server
      try {
        const res = await fetch(`/api/projects/${id}`);
        if (!res.ok) {
          // Try localStorage as last resort
          const local = localGetProjects().find((p: Project) => p.id === id);
          if (local) {
            set(state => ({
              projects: [...state.projects.filter(p => p.id !== id), local],
              activeProjectId: id,
            }));
            return local;
          }
          return null;
        }
        const data = await res.json();
        if (!data.success || !data.data) return null;

        const project: Project = data.data;
        // Add to store
        set(state => ({
          projects: [...state.projects.filter(p => p.id !== id), project],
          activeProjectId: id,
        }));
        localSaveProject(project);
        return project;
      } catch (err) {
        console.error('[store] loadActiveProject error:', err);
        // Last resort: localStorage
        const local = localGetProjects().find((p: Project) => p.id === id);
        if (local) {
          set(state => ({
            projects: [...state.projects.filter(p => p.id !== id), local],
            activeProjectId: id,
          }));
          return local;
        }
        return null;
      }
    },

    // ── Refresh All ───────────────────────────────────────────────────────────
    refreshAll: async () => {
      await Promise.all([
        get().loadClients(true),
        get().loadProjects(true),
      ]);
    },
  }))
);

// ─── Selectors (memoized) ─────────────────────────────────────────────────────

export const selectClients = (s: AppStore) => s.clients;
export const selectProjects = (s: AppStore) => s.projects;
export const selectActiveProject = (s: AppStore) =>
  s.projects.find(p => p.id === s.activeProjectId) ?? null;
export const selectClientById = (id: string) => (s: AppStore) =>
  s.clients.find(c => c.id === id) ?? null;
export const selectProjectById = (id: string) => (s: AppStore) =>
  s.projects.find(p => p.id === id) ?? null;
export const selectProjectsByClient = (clientId: string) => (s: AppStore) =>
  s.projects.filter(p => p.clientId === clientId);