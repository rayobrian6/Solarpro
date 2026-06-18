// ============================================================================
// v47.438 - Survey V2: Step 1 - Site Overview
//
// Captures project name, site address, GPS coords, structure type,
// stories count, inspector name, and access notes.
//
// Pre-filled from JWT claims via buildInitialDraft().
//
// v47.438: Standalone survey support.
//   When draft.standalone === true, shows a "Associate with Client or Project"
//   card at the top. Field worker must pick either:
//     - An existing project (direct attach)
//     - A client (create new project under that client)
//       - Then optionally pick from that client's existing projects
//   This selection is required before Step 1 can advance.
//
//   The picker is a searchable combobox — type to filter, tap to select.
//   Data comes from GET /api/survey/lookup-data?token=<jwt>.
//
// Pure ASCII, no Unicode.
// ============================================================================

'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import type { SurveySiteOverview, SurveyLookupClient, SurveyLookupProject } from '../../lib/survey/v2/types';
import { StepCard, StepField, StepInput, StepTextArea } from './ui/StepCard';
import {
  ChipGroup,
  STRUCTURE_TYPE_OPTIONS,
  STORIES_OPTIONS,
} from './ui/ChipGroup';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface StepSiteOverviewProps {
  data: SurveySiteOverview;
  onChange: (data: SurveySiteOverview) => void;
  disabled?: boolean;

  // v47.438: standalone picker props
  // Only rendered when standalone=true on the parent draft.
  standalone?: boolean;
  lookupClients?: SurveyLookupClient[];
  lookupProjects?: SurveyLookupProject[];
  lookupLoading?: boolean;
  lookupError?: string | null;
  selectedClientId?: string | null;
  selectedProjectId?: string | null;
  onSelectClient?: (clientId: string, clientName: string) => void;
  onSelectProject?: (projectId: string, projectName: string) => void;
  onClearSelection?: () => void;
}

// ---------------------------------------------------------------------------
// PickerItem - flat list item for the searchable combobox
// ---------------------------------------------------------------------------
interface PickerItem {
  type: 'project' | 'client';
  id: string;
  label: string;         // primary display text
  sublabel: string;      // secondary text (client name for projects, address for clients)
  clientId: string | null;
}

// ---------------------------------------------------------------------------
// ClientProjectPicker - the searchable combobox
// ---------------------------------------------------------------------------
interface ClientProjectPickerProps {
  clients: SurveyLookupClient[];
  projects: SurveyLookupProject[];
  loading: boolean;
  error: string | null;
  selectedClientId: string | null;
  selectedProjectId: string | null;
  onSelectClient: (clientId: string, clientName: string) => void;
  onSelectProject: (projectId: string, projectName: string) => void;
  onClear: () => void;
  disabled?: boolean;
}

function ClientProjectPicker({
  clients,
  projects,
  loading,
  error,
  selectedClientId,
  selectedProjectId,
  onSelectClient,
  onSelectProject,
  onClear,
  disabled,
}: ClientProjectPickerProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Build flat list: clients first, then projects (with client name as sublabel)
  const allItems: PickerItem[] = useMemo(() => {
    const clientItems: PickerItem[] = clients.map((c) => ({
      type: 'client',
      id: c.id,
      label: c.name,
      sublabel: c.address || 'Client',
      clientId: c.id,
    }));

    const projectItems: PickerItem[] = projects.map((p) => ({
      type: 'project',
      id: p.id,
      label: p.name,
      sublabel: p.clientName ? `${p.clientName}` : (p.address || 'Project'),
      clientId: p.clientId,
    }));

    return [...clientItems, ...projectItems];
  }, [clients, projects]);

  // Filter by search query
  const filtered = useMemo(() => {
    if (!query.trim()) return allItems;
    const q = query.toLowerCase();
    return allItems.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.sublabel.toLowerCase().includes(q),
    );
  }, [allItems, query]);

  // Group filtered items by type for display
  const filteredClients = filtered.filter((i) => i.type === 'client');
  const filteredProjects = filtered.filter((i) => i.type === 'project');

  // Derive display value for the input when something is selected
  const selectedItem = useMemo(() => {
    if (selectedProjectId) {
      return allItems.find((i) => i.type === 'project' && i.id === selectedProjectId) ?? null;
    }
    if (selectedClientId) {
      return allItems.find((i) => i.type === 'client' && i.id === selectedClientId) ?? null;
    }
    return null;
  }, [allItems, selectedProjectId, selectedClientId]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        listRef.current &&
        !listRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function handleInputFocus() {
    if (!disabled) {
      setOpen(true);
      setQuery('');
    }
  }

  function handleSelect(item: PickerItem) {
    if (item.type === 'client') {
      onSelectClient(item.id, item.label);
    } else {
      onSelectProject(item.id, item.label);
    }
    setOpen(false);
    setQuery('');
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation();
    onClear();
    setQuery('');
    setOpen(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-3">
        <div className="w-4 h-4 border-2 border-cyan-300 border-t-cyan-600 rounded-full animate-spin" />
        <span className="text-xs text-gray-500">Loading clients and projects...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-red-50 border border-red-200 p-3">
        <p className="text-xs text-red-600 font-medium">Failed to load client list</p>
        <p className="text-xs text-red-500 mt-0.5">{error}</p>
      </div>
    );
  }

  const hasSelection = !!(selectedClientId || selectedProjectId);
  const inputDisplayValue = open
    ? query
    : (selectedItem?.label ?? '');

  return (
    <div className="relative">
      {/* Input trigger */}
      <div
        className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 bg-white
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-text'}
          ${hasSelection
            ? 'border-cyan-400 ring-1 ring-cyan-200'
            : 'border-gray-300 focus-within:border-cyan-400 focus-within:ring-1 focus-within:ring-cyan-200'
          }`}
      >
        {/* Search icon */}
        <svg
          className="w-4 h-4 text-gray-400 shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
        </svg>

        <input
          ref={inputRef}
          type="text"
          value={inputDisplayValue}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={handleInputFocus}
          placeholder={allItems.length === 0 ? 'No clients or projects found' : 'Search clients and projects...'}
          disabled={disabled || allItems.length === 0}
          className="flex-1 min-w-0 text-sm text-gray-900 placeholder-gray-400 bg-transparent outline-none"
        />

        {/* Clear button */}
        {hasSelection && !disabled ? (
          <button
            type="button"
            onClick={handleClear}
            className="shrink-0 w-5 h-5 rounded-full bg-gray-200 hover:bg-gray-300 flex items-center justify-center transition-colors"
          >
            <svg className="w-3 h-3 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        ) : null}

        {/* Chevron */}
        {!hasSelection ? (
          <svg
            className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        ) : null}
      </div>

      {/* Selection badge */}
      {hasSelection && selectedItem ? (
        <div className="mt-2 flex items-center gap-2 px-1">
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide
              ${selectedItem.type === 'project'
                ? 'bg-cyan-100 text-cyan-700'
                : 'bg-purple-100 text-purple-700'
              }`}
          >
            {selectedItem.type === 'project' ? 'Project' : 'Client'}
          </span>
          <span className="text-xs text-gray-600 truncate">{selectedItem.sublabel}</span>
        </div>
      ) : null}

      {/* Dropdown */}
      {open ? (
        <div
          ref={listRef}
          className="absolute z-50 top-full left-0 right-0 mt-1 bg-white rounded-xl border border-gray-200
            shadow-lg max-h-64 overflow-y-auto"
        >
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <p className="text-xs text-gray-500">No results for "{query}"</p>
            </div>
          ) : (
            <>
              {/* Clients section */}
              {filteredClients.length > 0 ? (
                <div>
                  <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-100">
                    <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">
                      Clients
                    </span>
                  </div>
                  {filteredClients.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); handleSelect(item); }}
                      className="w-full text-left px-4 py-2.5 hover:bg-purple-50 transition-colors border-b border-gray-50 last:border-0"
                    >
                      <p className="text-sm font-medium text-gray-900">{item.label}</p>
                      {item.sublabel ? (
                        <p className="text-xs text-gray-500 truncate mt-0.5">{item.sublabel}</p>
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}

              {/* Projects section */}
              {filteredProjects.length > 0 ? (
                <div>
                  <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-100">
                    <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">
                      Projects
                    </span>
                  </div>
                  {filteredProjects.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); handleSelect(item); }}
                      className="w-full text-left px-4 py-2.5 hover:bg-cyan-50 transition-colors border-b border-gray-50 last:border-0"
                    >
                      <p className="text-sm font-medium text-gray-900">{item.label}</p>
                      {item.sublabel ? (
                        <p className="text-xs text-gray-500 truncate mt-0.5">{item.sublabel}</p>
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StepSiteOverview
// ---------------------------------------------------------------------------
export function StepSiteOverview({
  data,
  onChange,
  disabled,
  standalone,
  lookupClients = [],
  lookupProjects = [],
  lookupLoading = false,
  lookupError = null,
  selectedClientId,
  selectedProjectId,
  onSelectClient,
  onSelectProject,
  onClearSelection,
}: StepSiteOverviewProps) {
  function set<K extends keyof SurveySiteOverview>(
    key: K,
    value: SurveySiteOverview[K],
  ) {
    onChange({ ...data, [key]: value });
  }

  return (
    <div className="space-y-4">

      {/* ---- v47.438: Client/Project picker (standalone surveys only) ---- */}
      {standalone ? (
        <StepCard
          title="Associate with Client or Project"
          subtitle="Required - select who this survey is for"
        >
          <StepField
            label="Client or Project"
            required
            hint="Pick an existing project to attach this survey to, or pick a client to create a new project under them"
          >
            <ClientProjectPicker
              clients={lookupClients}
              projects={lookupProjects}
              loading={lookupLoading}
              error={lookupError}
              selectedClientId={selectedClientId ?? null}
              selectedProjectId={selectedProjectId ?? null}
              onSelectClient={onSelectClient ?? (() => {})}
              onSelectProject={onSelectProject ?? (() => {})}
              onClear={onClearSelection ?? (() => {})}
              disabled={disabled}
            />
          </StepField>

          {/* Hint about what happens with each selection type */}
          {!selectedClientId && !selectedProjectId && !lookupLoading && !lookupError ? (
            <div className="mt-2 rounded-lg bg-amber-50 border border-amber-200 p-3">
              <p className="text-xs text-amber-700 font-medium">
                Selection required before continuing
              </p>
              <p className="text-xs text-amber-600 mt-0.5">
                Picking a <strong>Project</strong> attaches this survey to an existing project.
                Picking a <strong>Client</strong> creates a new project under that client.
              </p>
            </div>
          ) : null}

          {selectedProjectId ? (
            <div className="mt-2 rounded-lg bg-cyan-50 border border-cyan-200 p-3">
              <p className="text-xs text-cyan-700 font-medium">Survey will attach to this project</p>
              <p className="text-xs text-cyan-600 mt-0.5">
                Data will be linked to the selected project when submitted.
              </p>
            </div>
          ) : null}

          {selectedClientId && !selectedProjectId ? (
            <div className="mt-2 rounded-lg bg-purple-50 border border-purple-200 p-3">
              <p className="text-xs text-purple-700 font-medium">A new project will be created under this client</p>
              <p className="text-xs text-purple-600 mt-0.5">
                Survey data will be attached to a new project under this client when submitted.
              </p>
            </div>
          ) : null}
        </StepCard>
      ) : null}

      {/* ---- Project Info ---- */}
      <StepCard title="Project Info">
        <StepField label="Project Name" required>
          <StepInput
            value={data.projectName}
            onChange={(v) => set('projectName', v)}
            placeholder="e.g. Smith Residence"
            disabled={disabled}
          />
        </StepField>

        <StepField
          label="Site Address"
          required
          hint="Street address where the survey is being conducted"
        >
          <StepInput
            value={data.siteAddress}
            onChange={(v) => set('siteAddress', v)}
            placeholder="123 Main St, City, ST 00000"
            disabled={disabled}
          />
        </StepField>
      </StepCard>

      {/* ---- Structure ---- */}
      <StepCard title="Structure">
        <StepField label="Structure Type" required>
          <ChipGroup
            options={STRUCTURE_TYPE_OPTIONS}
            value={data.structureType}
            onChange={(v) =>
              set('structureType', v as SurveySiteOverview['structureType'])
            }
            columns={3}
            disabled={disabled}
          />
        </StepField>

        <StepField label="Number of Stories" required>
          <ChipGroup
            options={STORIES_OPTIONS}
            value={data.stories}
            onChange={(v) => set('stories', v as SurveySiteOverview['stories'])}
            columns={3}
            disabled={disabled}
          />
        </StepField>
      </StepCard>

      {/* ---- GPS (read-only if pre-filled) ---- */}
      <StepCard
        title="GPS Coordinates"
        subtitle="Pre-filled from handoff token when available"
      >
        <div className="grid grid-cols-2 gap-3">
          <StepField label="Latitude">
            <StepInput
              value={data.latitude != null ? String(data.latitude) : ''}
              onChange={(v) => {
                const n = parseFloat(v);
                set('latitude', isNaN(n) ? null : n);
              }}
              placeholder="e.g. 34.0522"
              type="number"
              disabled={disabled}
            />
          </StepField>
          <StepField label="Longitude">
            <StepInput
              value={data.longitude != null ? String(data.longitude) : ''}
              onChange={(v) => {
                const n = parseFloat(v);
                set('longitude', isNaN(n) ? null : n);
              }}
              placeholder="e.g. -118.2437"
              type="number"
              disabled={disabled}
            />
          </StepField>
        </div>

        {/* GPS status indicator */}
        {data.latitude != null && data.longitude != null ? (
          <div className="mt-2 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
            <span className="text-xs text-green-600 font-medium">
              GPS locked ({data.latitude.toFixed(4)}, {data.longitude.toFixed(4)})
            </span>
          </div>
        ) : (
          <div className="mt-2 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-gray-300 inline-block" />
            <span className="text-xs text-gray-400">No GPS - enter manually if needed</span>
          </div>
        )}
      </StepCard>

      {/* ---- Inspector + Notes ---- */}
      <StepCard title="Inspector">
        <StepField label="Inspector Name" required>
          <StepInput
            value={data.inspectorName}
            onChange={(v) => set('inspectorName', v)}
            placeholder="Your name"
            disabled={disabled}
          />
        </StepField>

        <StepField
          label="Access Notes"
          hint="Gate codes, dogs, parking instructions, etc."
        >
          <StepTextArea
            value={data.accessNotes}
            onChange={(v) => set('accessNotes', v)}
            placeholder="e.g. Gate code #1234, beware of dog in backyard"
            rows={3}
            disabled={disabled}
          />
        </StepField>
      </StepCard>
    </div>
  );
}