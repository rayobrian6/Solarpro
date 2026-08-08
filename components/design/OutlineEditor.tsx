'use client';

// components/design/OutlineEditor.tsx
// Main editor for the design outline. Coordinates:
//   - 2D drawing canvas (OutlineDrawCanvas)
//   - 3D preview (Outline3DPreview)
//   - toolbar (undo, clear, close, units, roof type, pitch, height inputs, save)
//
// State is held in this component and threaded down. The 3D preview only
// re-renders when the outline geometry actually changes (the inner useEffect
// tears down and re-creates the meshes).
//
// Internal storage is ALWAYS meters. The UI converts to feet when the user
// picks imperial units. Pitch is stored as rise/run (unitless) and displayed
// as "X:12".

import { useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, ArrowRight, RotateCcw, Trash2, Eye, Square,
  AlertTriangle, CheckCircle2, Save, Ruler,
} from 'lucide-react';
import OutlineDrawCanvas from './OutlineDrawCanvas';
import Outline3DPreview from './Outline3DPreview';
import {
  DEFAULT_OUTLINE,
  type OutlineDocument,
  type OutlinePolygon,
  type RoofType,
} from '@/lib/outline/types';
import { validateOutlineForExtrude } from '@/lib/3d/outlineExtrude';
import {
  formatPitch,
  type Units,
} from '@/lib/outline/units';

export interface OutlineEditorProps {
  /** When set, the editor treats this as the project context. */
  projectId?: string;
  /** Lat/lng of the site. When set, the drawing canvas shows a satellite
   *  tile of the property so the user has a real surface to draw on. */
  center?: { lat: number; lng: number };
  /** Called when the user clicks "Save & Continue". */
  onSave?: (doc: OutlineDocument) => void | Promise<void>;
  /** When set, the "Save & Continue" button routes here. Otherwise the
   *  editor just calls onSave. */
  continueHref?: string;
}

export default function OutlineEditor({
  projectId,
  center,
  onSave,
  continueHref,
}: OutlineEditorProps) {
  const router = useRouter();
  const [doc, setDoc] = useState<OutlineDocument>(DEFAULT_OUTLINE);
  const [view, setView] = useState<'2d' | '3d'>('2d');
  const [saving, setSaving] = useState(false);

  const units: Units = doc.units;
  const isImperial = units === 'imperial';

  // Display-only strings for the dimension inputs. The underlying state
  // is always meters; we render the number in the user's units and convert
  // back to meters on edit.
  const dimStep = isImperial ? 0.5 : 0.05;     // feet / meters
  const dimPrecision = isImperial ? 1 : 2;     // 1 decimal ft, 2 decimals m
  const dimSuffix = isImperial ? 'ft' : 'm';
  const toUnits = (m: number) => (isImperial ? m * 3.28084 : m);
  const fromUnits = (v: number) => (isImperial ? v / 3.28084 : v);
  const fmtDim = (m: number) => toUnits(m).toFixed(dimPrecision);

  const problems = useMemo(() => validateOutlineForExtrude(doc), [doc]);
  const canPreview = problems.length === 0;
  const canSave = problems.length === 0;

  const setRoofPolygon = useCallback((p: OutlinePolygon) => {
    setDoc(prev => ({ ...prev, roof: p }));
  }, []);

  const setHousePolygon = useCallback((p: OutlinePolygon) => {
    setDoc(prev => ({ ...prev, house: p }));
  }, []);

  // ── Units toggle ─────────────────────────────────────────────────────────
  const handleUnitsChange = useCallback((next: Units) => {
    setDoc(prev => (prev.units === next ? prev : { ...prev, units: next }));
  }, []);

  // ── Dimension edits (always store in meters) ─────────────────────────────
  const setRoofHeightMeters = useCallback((m: number) => {
    setDoc(prev => ({ ...prev, roofHeightM: Math.max(0.05, m) }));
  }, []);
  const setHouseHeightMeters = useCallback((m: number) => {
    setDoc(prev => ({ ...prev, houseHeightM: Math.max(0.5, m) }));
  }, []);
  const setHouseOffsetMeters = useCallback((m: number) => {
    setDoc(prev => ({ ...prev, houseOffsetM: Math.max(0, m) }));
  }, []);

  // ── Roof type + pitch ────────────────────────────────────────────────────
  const setRoofType = useCallback((rt: RoofType) => {
    setDoc(prev => ({ ...prev, roofType: rt }));
  }, []);
  const setPitchRise = useCallback((rise: number) => {
    setDoc(prev => {
      if (!Number.isFinite(rise) || rise <= 0) return prev;
      return { ...prev, pitch: { rise, run: prev.pitch.run || 12 } };
    });
  }, []);

  const handleUndoRoof = useCallback(() => {
    setDoc(prev => {
      if (prev.roof.vertices.length === 0) return prev;
      const vertices = prev.roof.vertices.slice(0, -1);
      return {
        ...prev,
        roof: { vertices, closed: vertices.length < 3 ? false : prev.roof.closed },
      };
    });
  }, []);

  const handleClearRoof = useCallback(() => {
    setDoc(prev => ({ ...prev, roof: { vertices: [], closed: false } }));
  }, []);

  const handleClearHouse = useCallback(() => {
    setDoc(prev => ({ ...prev, house: { vertices: [], closed: false } }));
  }, []);

  const handleAutoHouse = useCallback(() => {
    // Use the roof's bbox + houseOffsetM to make a default rectangle.
    // Implementation lives in types.ts (expandPolygon).
    setDoc(prev => {
      if (prev.roof.vertices.length < 3) return prev;
      // Lazy import to avoid circular concerns in this component file.
      const { expandPolygon } = require('@/lib/outline/types') as typeof import('@/lib/outline/types');
      const housePts = expandPolygon(prev.roof.vertices, prev.houseOffsetM);
      return { ...prev, house: { vertices: housePts, closed: true } };
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      if (onSave) await onSave(doc);
      if (projectId) {
        // Persist to localStorage keyed by projectId so the design studio
        // can pick it up on next load. (DB persistence is a follow-up.)
        try {
          window.localStorage.setItem(
            `solarpro.outline.${projectId}`,
            JSON.stringify(doc),
          );
        } catch {
          // localStorage may be unavailable; safe to ignore.
        }
      }
      if (continueHref) {
        router.push(continueHref);
      } else if (projectId) {
        router.push(`/design?projectId=${projectId}`);
      }
    } finally {
      setSaving(false);
    }
  }, [canSave, onSave, doc, projectId, continueHref, router]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-slate-950 text-slate-100">
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push(continueHref || '/design')}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
            title="Back"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <div className="text-sm font-semibold">Mark out your roof</div>
            {problems.length === 0 ? (
              <div className="flex items-center gap-1.5 text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-full px-2 py-0.5 w-fit">
                <CheckCircle2 size={12} />
                <span className="text-xs font-medium">Model accepted</span>
              </div>
            ) : (
              <div className="text-xs text-slate-400">
                Draw the roof outline, then lift it into 3D.
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex items-center bg-slate-800 rounded-lg p-0.5">
            <button
              onClick={() => setView('2d')}
              className={`px-2.5 py-1.5 text-xs rounded-md flex items-center gap-1.5 ${
                view === '2d'
                  ? 'bg-amber-500 text-slate-900 font-medium'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Square size={12} /> 2D
            </button>
            <button
              onClick={() => setView('3d')}
              disabled={!canPreview}
              className={`px-2.5 py-1.5 text-xs rounded-md flex items-center gap-1.5 ${
                view === '3d'
                  ? 'bg-amber-500 text-slate-900 font-medium'
                  : 'text-slate-300 hover:text-white disabled:opacity-40 disabled:hover:text-slate-300'
              }`}
            >
              <Eye size={12} /> 3D
            </button>
          </div>
          <button
            onClick={handleSave}
            disabled={!canSave || saving}
            className="btn-primary text-sm flex items-center gap-2 disabled:opacity-40"
          >
            <Save size={14} />
            {saving ? 'Saving…' : 'Save & Continue'}
            <ArrowRight size={14} />
          </button>
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-2 border-b border-slate-800 text-xs">
        {/* Edit actions */}
        <div className="flex items-center gap-1">
          <button
            onClick={handleUndoRoof}
            disabled={doc.roof.vertices.length === 0}
            className="px-2 py-1.5 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 flex items-center gap-1.5 disabled:opacity-40"
            title="Remove last vertex"
          >
            <RotateCcw size={12} /> Undo
          </button>
          <button
            onClick={handleClearRoof}
            disabled={doc.roof.vertices.length === 0}
            className="px-2 py-1.5 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 flex items-center gap-1.5 disabled:opacity-40"
          >
            <Trash2 size={12} /> Clear roof
          </button>
        </div>

        <div className="h-5 w-px bg-slate-700" />

        {/* Units toggle (metric / imperial) */}
        <div className="flex items-center gap-1.5 text-slate-400">
          <Ruler size={12} />
          <div className="flex items-center bg-slate-800 rounded-md p-0.5">
            <button
              onClick={() => handleUnitsChange('imperial')}
              className={`px-2 py-1 text-[11px] rounded ${
                isImperial
                  ? 'bg-amber-500 text-slate-900 font-medium'
                  : 'text-slate-300 hover:text-white'
              }`}
              title="Feet and inches (US construction convention)"
            >
              ft
            </button>
            <button
              onClick={() => handleUnitsChange('metric')}
              className={`px-2 py-1 text-[11px] rounded ${
                !isImperial
                  ? 'bg-amber-500 text-slate-900 font-medium'
                  : 'text-slate-300 hover:text-white'
              }`}
              title="Meters"
            >
              m
            </button>
          </div>
        </div>

        <div className="h-5 w-px bg-slate-700" />

        {/* Roof type */}
        <label className="flex items-center gap-1.5 text-slate-400">
          Roof type
          <select
            value={doc.roofType}
            onChange={e => setRoofType(e.target.value as RoofType)}
            className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-slate-100 text-xs"
          >
            <option value="flat">Flat</option>
            <option value="gable">Gable</option>
            <option value="hip">Hip</option>
          </select>
        </label>

        {/* Pitch (only when not flat) */}
        {doc.roofType !== 'flat' && (
          <label className="flex items-center gap-1.5 text-slate-400" title="Roof pitch (US convention: rise per 12 inches of run)">
            Pitch
            <input
              type="number"
              min={0.5}
              max={18}
              step={0.5}
              value={doc.pitch.rise}
              onChange={e => setPitchRise(Math.max(0.5, Number(e.target.value) || 6))}
              className="w-14 px-2 py-1 bg-slate-800 border border-slate-700 rounded text-slate-100"
            />
            <span className="text-slate-500">:12</span>
            <span className="text-slate-500 text-[10px]">
              ({formatPitch(doc.pitch.rise, doc.pitch.run)})
            </span>
          </label>
        )}

        <div className="h-5 w-px bg-slate-700" />

        {/* Dimensions — display in current units, store in meters */}
        <label className="flex items-center gap-1.5 text-slate-400">
          Roof thickness
          <input
            type="number"
            min={isImperial ? 0.1 : 0.05}
            max={isImperial ? 6 : 2}
            step={dimStep}
            value={fmtDim(doc.roofHeightM)}
            onChange={e => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) setRoofHeightMeters(fromUnits(v));
            }}
            className="w-16 px-2 py-1 bg-slate-800 border border-slate-700 rounded text-slate-100"
          />
          <span className="text-slate-500">{dimSuffix}</span>
        </label>
        <label className="flex items-center gap-1.5 text-slate-400">
          House height
          <input
            type="number"
            min={isImperial ? 2 : 0.5}
            max={isImperial ? 60 : 20}
            step={dimStep}
            value={fmtDim(doc.houseHeightM)}
            onChange={e => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) setHouseHeightMeters(fromUnits(v));
            }}
            className="w-16 px-2 py-1 bg-slate-800 border border-slate-700 rounded text-slate-100"
          />
          <span className="text-slate-500">{dimSuffix}</span>
        </label>
        <label className="flex items-center gap-1.5 text-slate-400">
          Eave
          <input
            type="number"
            min={0}
            max={isImperial ? 10 : 3}
            step={dimStep}
            value={fmtDim(doc.houseOffsetM)}
            onChange={e => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) setHouseOffsetMeters(fromUnits(v));
            }}
            className="w-16 px-2 py-1 bg-slate-800 border border-slate-700 rounded text-slate-100"
          />
          <span className="text-slate-500">{dimSuffix}</span>
        </label>

        <div className="h-5 w-px bg-slate-700" />

        <button
          onClick={handleAutoHouse}
          disabled={doc.roof.vertices.length < 3}
          className="px-2 py-1.5 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 flex items-center gap-1.5 disabled:opacity-40"
          title="Generate a default rectangle footprint from the roof bbox + eave offset"
        >
          Auto house
        </button>
        {doc.house.vertices.length > 0 && (
          <button
            onClick={handleClearHouse}
            className="px-2 py-1.5 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 flex items-center gap-1.5"
          >
            <Trash2 size={12} /> Clear house
          </button>
        )}
      </div>

      {/* ── Main area ── */}
      <div className="flex-1 min-h-0 flex">
        {/* Drawing / Preview canvas */}
        <div className="flex-1 min-h-0 flex items-center justify-center p-6 overflow-auto">
          {view === '2d' ? (
            <OutlineDrawCanvas
              polygon={doc.roof}
              onChange={setRoofPolygon}
              center={center}
              units={units}
              hint={doc.roof.closed ? 'closed — drag vertices to adjust' : 'click to add'}
            />
          ) : (
            <Outline3DPreview outline={doc} />
          )}
        </div>

        {/* Side panel: house footprint drawer + validation */}
        <div className="w-80 border-l border-slate-800 p-4 flex flex-col gap-4 overflow-y-auto">
          <div>
            <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide mb-2">
              House footprint
            </h3>
            {doc.house.vertices.length === 0 ? (
              <p className="text-xs text-slate-400 mb-2">
                Not drawn. Click <em>Auto house</em> in the toolbar to
                generate a default rectangle from the roof, or draw one
                manually below.
              </p>
            ) : (
              <p className="text-xs text-slate-400 mb-2">
                {doc.house.closed
                  ? `Closed (${doc.house.vertices.length} vertices)`
                  : `${doc.house.vertices.length} vertices — double-click to close`}
              </p>
            )}
            {doc.roof.closed && doc.house.vertices.length === 0 && (
              <div className="text-[10px] text-slate-500 bg-slate-800/50 rounded p-2 mb-2">
                Drawing a separate footprint is optional. The 3D preview
                will auto-generate a rectangle from the roof bbox + eave
                offset.
              </div>
            )}
            {doc.roof.closed && (
              <div className="border border-slate-700 rounded-lg p-1 bg-slate-900">
                <OutlineDrawCanvas
                  polygon={doc.house}
                  onChange={setHousePolygon}
                  width={300}
                  height={220}
                  accent="slate"
                  hideSatellite
                  units={units}
                  hint={doc.house.closed ? 'closed' : 'click to add'}
                />
              </div>
            )}
          </div>

          <div>
            <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide mb-2">
              Status
            </h3>
            {problems.length === 0 ? (
              <div className="flex items-center gap-2 text-emerald-400 text-xs">
                <CheckCircle2 size={14} /> Ready to lift into 3D
              </div>
            ) : (
              <ul className="space-y-1 text-xs text-amber-300">
                {problems.map((p, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="text-[10px] text-slate-500 leading-relaxed border-t border-slate-800 pt-3">
            <p className="font-medium text-slate-400 mb-1">How to draw</p>
            <p>1. Click on the grid to place each vertex of your roof outline.</p>
            <p>2. Double-click (or press Enter) to close the polygon.</p>
            <p>3. Toggle to 3D to preview. Drag vertices to adjust.</p>
            <p>4. Pick roof type and pitch (X:12 = rise per 12 in of run).</p>
            <p>5. Adjust roof thickness / house height / eave as needed.</p>
            <p>6. Save &amp; Continue to open the full 3D design studio.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
