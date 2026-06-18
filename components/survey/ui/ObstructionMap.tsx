// ============================================================================
// v47.437 - Survey V2: ObstructionMap
//
// An interactive roof diagram showing a top-down view with 8 zones.
// Users tap a zone to flag it as having an obstruction, then fill in
// type + notes via the ObstructionEditor panel below.
//
// The diagram is a pure CSS/SVG layout - no external deps.
// Each zone maps to an ObstructionLocation value.
//
// Pure ASCII, no Unicode.
// ============================================================================

import React, { useState } from 'react';
import { ChipGroup, OBSTRUCTION_TYPE_OPTIONS, OBSTRUCTION_LOCATION_OPTIONS } from './ChipGroup';
import type { Obstruction, ObstructionLocation, ObstructionType } from '../../../lib/survey/v2/types';

// ---------------------------------------------------------------------------
// generateId - simple collision-resistant id for obstructions
// ---------------------------------------------------------------------------
function generateId(): string {
  return `obs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

// ---------------------------------------------------------------------------
// ObstructionMap
// ---------------------------------------------------------------------------
interface ObstructionMapProps {
  obstructions: Obstruction[];
  onChange: (obstructions: Obstruction[]) => void;
  disabled?: boolean;
}

type EditorMode = { type: 'new'; location: ObstructionLocation } | { type: 'edit'; id: string } | null;

export function ObstructionMap({ obstructions, onChange, disabled }: ObstructionMapProps) {
  const [editorMode, setEditorMode] = useState<EditorMode>(null);

  // Zones: 7 locations arranged in compass + center layout
  const zones: { location: ObstructionLocation; label: string; gridArea: string }[] = [
    { location: 'north',  label: 'N',      gridArea: '1 / 2 / 2 / 3' },
    { location: 'west',   label: 'W',      gridArea: '2 / 1 / 3 / 2' },
    { location: 'center', label: 'Center', gridArea: '2 / 2 / 3 / 3' },
    { location: 'east',   label: 'E',      gridArea: '2 / 3 / 3 / 4' },
    { location: 'south',  label: 'S',      gridArea: '3 / 2 / 4 / 3' },
    { location: 'ridge',  label: 'Ridge',  gridArea: '1 / 1 / 2 / 2' },
    { location: 'valley', label: 'Valley', gridArea: '3 / 3 / 4 / 4' },
  ];

  function countAt(loc: ObstructionLocation): number {
    return obstructions.filter((o) => o.location === loc).length;
  }

  function handleZoneClick(location: ObstructionLocation) {
    if (disabled) return;
    // If already editing this zone, close
    if (
      editorMode &&
      editorMode.type === 'new' &&
      editorMode.location === location
    ) {
      setEditorMode(null);
      return;
    }
    setEditorMode({ type: 'new', location });
  }

  function handleAddObstruction(location: ObstructionLocation, obType: ObstructionType) {
    if (!obType) return;
    const newOb: Obstruction = {
      id: generateId(),
      type: obType,
      location,
      notes: '',
    };
    onChange([...obstructions, newOb]);
    setEditorMode(null);
  }

  function handleRemove(id: string) {
    onChange(obstructions.filter((o) => o.id !== id));
    if (editorMode && editorMode.type === 'edit' && editorMode.id === id) {
      setEditorMode(null);
    }
  }

  function handleNoteChange(id: string, notes: string) {
    onChange(obstructions.map((o) => (o.id === id ? { ...o, notes } : o)));
  }

  return (
    <div className="space-y-4">
      {/* ---- Roof diagram grid ---- */}
      <div className="relative">
        <p className="text-xs text-gray-500 mb-2 text-center">
          Tap a roof zone to add an obstruction
        </p>
        <div
          className="mx-auto"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 2fr 1fr',
            gridTemplateRows: '1fr 2fr 1fr',
            gap: '4px',
            width: '240px',
            height: '240px',
          }}
        >
          {zones.map(({ location, label, gridArea }) => {
            const count = countAt(location);
            const isActive =
              editorMode?.type === 'new' && editorMode.location === location;
            return (
              <button
                key={location}
                type="button"
                disabled={disabled}
                onClick={() => handleZoneClick(location)}
                style={{ gridArea }}
                className={`
                  relative rounded-lg border-2 text-xs font-semibold
                  flex flex-col items-center justify-center gap-0.5
                  transition-all duration-150
                  ${isActive
                    ? 'bg-cyan-100 border-cyan-500 text-cyan-700'
                    : count > 0
                    ? 'bg-orange-50 border-orange-400 text-orange-700'
                    : 'bg-gray-100 border-gray-300 text-gray-500 hover:border-cyan-400 hover:bg-cyan-50'
                  }
                  disabled:opacity-50 disabled:cursor-not-allowed
                `}
              >
                <span>{label}</span>
                {count > 0 ? (
                  <span className="bg-orange-400 text-white text-[10px] font-bold
                    w-4 h-4 rounded-full flex items-center justify-center">
                    {count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {/* ---- Zone editor (appears when zone is tapped) ---- */}
      {editorMode?.type === 'new' ? (
        <ZoneAdder
          location={editorMode.location}
          onAdd={handleAddObstruction}
          onCancel={() => setEditorMode(null)}
        />
      ) : null}

      {/* ---- Obstruction list ---- */}
      {obstructions.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
            Logged Obstructions ({obstructions.length})
          </p>
          {obstructions.map((ob) => (
            <ObstructionRow
              key={ob.id}
              obstruction={ob}
              onRemove={() => handleRemove(ob.id)}
              onNoteChange={(notes) => handleNoteChange(ob.id, notes)}
              disabled={disabled}
            />
          ))}
        </div>
      ) : null}

      {obstructions.length === 0 && !editorMode ? (
        <p className="text-center text-xs text-gray-400 py-2">
          No obstructions logged. Tap a zone above to add one.
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ZoneAdder - inline editor when a zone is tapped
// ---------------------------------------------------------------------------
interface ZoneAdderProps {
  location: ObstructionLocation;
  onAdd: (location: ObstructionLocation, type: ObstructionType) => void;
  onCancel: () => void;
}

function ZoneAdder({ location, onAdd, onCancel }: ZoneAdderProps) {
  const [selectedType, setSelectedType] = useState<string>('');

  const locationLabel = OBSTRUCTION_LOCATION_OPTIONS.find(
    (o) => o.value === location,
  )?.label ?? location;

  return (
    <div className="rounded-xl border-2 border-cyan-400 bg-cyan-50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-cyan-800">
          Add obstruction - {locationLabel}
        </p>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-gray-400 hover:text-gray-600"
        >
          cancel
        </button>
      </div>
      <ChipGroup
        options={OBSTRUCTION_TYPE_OPTIONS}
        value={selectedType}
        onChange={setSelectedType}
        columns={3}
      />
      <button
        type="button"
        disabled={!selectedType}
        onClick={() => onAdd(location, selectedType as ObstructionType)}
        className="w-full py-2 rounded-lg bg-cyan-500 text-white text-sm font-semibold
          disabled:opacity-40 disabled:cursor-not-allowed hover:bg-cyan-600 transition-colors"
      >
        Add
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ObstructionRow - a logged obstruction with inline notes
// ---------------------------------------------------------------------------
interface ObstructionRowProps {
  obstruction: Obstruction;
  onRemove: () => void;
  onNoteChange: (notes: string) => void;
  disabled?: boolean;
}

function ObstructionRow({ obstruction, onRemove, onNoteChange, disabled }: ObstructionRowProps) {
  const typeLabel = OBSTRUCTION_TYPE_OPTIONS.find(
    (o) => o.value === obstruction.type,
  )?.label ?? obstruction.type;

  const locationLabel = OBSTRUCTION_LOCATION_OPTIONS.find(
    (o) => o.value === obstruction.location,
  )?.label ?? obstruction.location;

  return (
    <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2.5 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-orange-700 bg-orange-200 px-2 py-0.5 rounded-full">
            {locationLabel}
          </span>
          <span className="text-xs font-semibold text-gray-700">{typeLabel}</span>
        </div>
        {!disabled ? (
          <button
            type="button"
            onClick={onRemove}
            className="text-[10px] text-red-400 hover:text-red-600 font-semibold uppercase tracking-wide"
          >
            remove
          </button>
        ) : null}
      </div>
      {!disabled ? (
        <input
          type="text"
          value={obstruction.notes}
          onChange={(e) => onNoteChange(e.target.value)}
          placeholder="Notes (optional)"
          className="w-full text-xs rounded border border-orange-200 bg-white px-2 py-1
            placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-orange-400"
        />
      ) : null}
      {disabled && obstruction.notes ? (
        <p className="text-xs text-gray-600">{obstruction.notes}</p>
      ) : null}
    </div>
  );
}