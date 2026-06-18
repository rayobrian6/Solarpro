'use client';
/**
 * ShadeAnalysisPanel.tsx — Roof Shade Analysis + Per-Panel Derate UI
 *
 * Displays:
 *   1. Run shade analysis button → triggers computeShadeAnalysis()
 *   2. System-level shade derate summary (%)
 *   3. Per-panel shade heatmap grid (color coded)
 *   4. Worst/best panel callouts
 *   5. Obstruction input fields (optional)
 *   6. Adjusted production estimate after derate
 */
import React, { useState, useCallback } from 'react';
import { Sun, CloudSun, AlertTriangle, CheckCircle, Info, RefreshCw, Layers } from 'lucide-react';
import type { PlacedPanel } from '@/types';

interface Props {
  panels: PlacedPanel[];
  lat: number;
  lng: number;
  annualProductionKwh: number;   // before shade derate
  onShadeAnalysisComplete?: (shadeLossPct: number, panels: PlacedPanel[]) => void;
}

interface ObstructionEntry {
  id: string;
  label: string;
  heightM: number;
  distanceM: number;
  azimuthDeg: number;
}

export default function ShadeAnalysisPanel({
  panels,
  lat,
  lng,
  annualProductionKwh,
  onShadeAnalysisComplete,
}: Props) {
  const [running, setRunning]   = useState(false);
  const [result, setResult]     = useState<import('@/lib/shadeAnalysis').ShadeAnalysisResult | null>(null);
  const [obstructions, setObstructions] = useState<ObstructionEntry[]>([]);
  const [rowSpacingM, setRowSpacingM]   = useState(1.5);
  const [error, setError]       = useState<string | null>(null);

  const runAnalysis = useCallback(async () => {
    if (panels.length === 0) {
      setError('No panels placed. Add panels first.');
      return;
    }
    if (!lat || !lng) {
      setError('Site location required for shade analysis.');
      return;
    }

    setRunning(true);
    setError(null);

    try {
      const { computeShadeAnalysis } = await import('@/lib/shadeAnalysis');

      const panelInputs = panels.map(p => ({
        id:      p.id,
        tilt:    p.tilt    ?? 20,
        azimuth: p.azimuth ?? 180,
        row:     p.row     ?? 0,
        col:     p.col     ?? 0,
        lat:     p.lat,
        lng:     p.lng,
      }));

      const obstructionProfile = obstructions.length > 0
        ? {
            nearbyObstruction: obstructions.map(o => ({
              heightM:    o.heightM,
              distanceM:  o.distanceM,
              azimuthDeg: o.azimuthDeg,
              arcDeg:     30,
            })),
          }
        : undefined;

      const res = computeShadeAnalysis(
        panelInputs,
        lat,
        lng,
        obstructionProfile,
        rowSpacingM,
      );

      setResult(res);

      // Attach annualShadeFactor back to panels and notify parent
      const updatedPanels: PlacedPanel[] = panels.map(p => ({
        ...p,
        annualShadeFactor: res.panelShadeFactors[p.id] ?? 1.0,
      }));
      onShadeAnalysisComplete?.(res.systemShadeDeratePct, updatedPanels);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed. Please try again.');
    } finally {
      setRunning(false);
    }
  }, [panels, lat, lng, obstructions, rowSpacingM, onShadeAnalysisComplete]);

  const addObstruction = () => {
    setObstructions(prev => [...prev, {
      id:         crypto.randomUUID(),
      label:      `Tree/Structure ${prev.length + 1}`,
      heightM:    6,
      distanceM:  5,
      azimuthDeg: 180,
    }]);
  };

  const removeObstruction = (id: string) => {
    setObstructions(prev => prev.filter(o => o.id !== id));
  };

  const updateObstruction = (id: string, field: keyof ObstructionEntry, value: string | number) => {
    setObstructions(prev => prev.map(o => o.id === id ? { ...o, [field]: value } : o));
  };

  const adjustedProduction = result
    ? Math.round(annualProductionKwh * (1 - result.systemShadeDeratePct / 100))
    : annualProductionKwh;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center">
          <Sun size={16} className="text-amber-400" />
        </div>
        <div>
          <div className="text-sm font-semibold text-white">Shade Analysis</div>
          <div className="text-xs text-slate-400">Per-panel solar access + production derate</div>
        </div>
      </div>

      {/* Obstruction inputs */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-300">Nearby Obstructions</span>
          <button
            onClick={addObstruction}
            className="text-xs text-amber-400 hover:text-amber-300 transition-colors"
          >
            + Add tree/structure
          </button>
        </div>

        {obstructions.map(obs => (
          <div key={obs.id} className="bg-slate-800/50 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <input
                type="text"
                value={obs.label}
                onChange={e => updateObstruction(obs.id, 'label', e.target.value)}
                className="text-xs bg-transparent text-slate-200 border-none outline-none w-36"
                placeholder="Label"
              />
              <button
                onClick={() => removeObstruction(obs.id)}
                className="text-xs text-slate-500 hover:text-red-400 transition-colors"
              >
                Remove
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <div className="text-[10px] text-slate-500 mb-1">Height (m)</div>
                <input
                  type="number"
                  value={obs.heightM}
                  min={0.5} max={30} step={0.5}
                  onChange={e => updateObstruction(obs.id, 'heightM', parseFloat(e.target.value))}
                  className="w-full text-xs bg-slate-700 rounded px-2 py-1 text-white border border-slate-600 outline-none"
                />
              </div>
              <div>
                <div className="text-[10px] text-slate-500 mb-1">Distance (m)</div>
                <input
                  type="number"
                  value={obs.distanceM}
                  min={1} max={100} step={1}
                  onChange={e => updateObstruction(obs.id, 'distanceM', parseFloat(e.target.value))}
                  className="w-full text-xs bg-slate-700 rounded px-2 py-1 text-white border border-slate-600 outline-none"
                />
              </div>
              <div>
                <div className="text-[10px] text-slate-500 mb-1">Azimuth (°)</div>
                <input
                  type="number"
                  value={obs.azimuthDeg}
                  min={0} max={359} step={5}
                  onChange={e => updateObstruction(obs.id, 'azimuthDeg', parseFloat(e.target.value))}
                  className="w-full text-xs bg-slate-700 rounded px-2 py-1 text-white border border-slate-600 outline-none"
                />
              </div>
            </div>
          </div>
        ))}

        {/* Row spacing */}
        <div>
          <div className="flex justify-between items-center mb-1">
            <label className="text-xs text-slate-400">Row Spacing (m)</label>
            <span className="text-xs font-semibold text-white">{rowSpacingM}m</span>
          </div>
          <input
            type="range" min={0.8} max={4.0} step={0.1} value={rowSpacingM}
            onChange={e => setRowSpacingM(parseFloat(e.target.value))}
            className="w-full h-1.5 bg-slate-700 rounded-full appearance-none cursor-pointer accent-amber-500"
          />
        </div>
      </div>

      {/* Run button */}
      <button
        onClick={runAnalysis}
        disabled={running || panels.length === 0}
        className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:bg-slate-700 disabled:text-slate-500 text-black font-semibold text-xs rounded-lg px-4 py-2.5 transition-colors"
      >
        {running ? (
          <>
            <RefreshCw size={12} className="animate-spin" />
            Analysing {panels.length} panels…
          </>
        ) : (
          <>
            <CloudSun size={12} />
            Run Shade Analysis
          </>
        )}
      </button>

      {/* Error */}
      {error ? (
        <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">
          <AlertTriangle size={12} />
          {error}
        </div>
      ) : null}

      {/* Results */}
      {result ? (
        <div className="space-y-3">
          {/* System summary */}
          <div className="bg-slate-800/60 rounded-xl p-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[10px] text-slate-400 uppercase tracking-wide">Shade Derate</div>
                <div className={`text-xl font-bold ${
                  result.systemShadeDeratePct < 5  ? 'text-emerald-400' :
                  result.systemShadeDeratePct < 12 ? 'text-amber-400'   :
                  result.systemShadeDeratePct < 25 ? 'text-orange-400'  : 'text-red-400'
                }`}>
                  {result.systemShadeDeratePct}%
                </div>
                <div className="text-[10px] text-slate-500">annual loss</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-400 uppercase tracking-wide">Adj. Production</div>
                <div className="text-xl font-bold text-white">
                  {adjustedProduction.toLocaleString()}
                </div>
                <div className="text-[10px] text-slate-500">kWh/yr (post-derate)</div>
              </div>
            </div>

            {/* Severity indicator */}
            <div className="mt-3 flex items-center gap-2">
              {result.systemShadeDeratePct < 5 ? (
                <><CheckCircle size={12} className="text-emerald-400" />
                <span className="text-xs text-emerald-400">Minimal shading — excellent site</span></>
              ) : result.systemShadeDeratePct < 12 ? (
                <><Info size={12} className="text-amber-400" />
                <span className="text-xs text-amber-400">Light shading — good site</span></>
              ) : result.systemShadeDeratePct < 25 ? (
                <><AlertTriangle size={12} className="text-orange-400" />
                <span className="text-xs text-orange-400">Moderate shading — consider optimizer/micro topology</span></>
              ) : (
                <><AlertTriangle size={12} className="text-red-400" />
                <span className="text-xs text-red-400">Significant shading — microinverters strongly recommended</span></>
              )}
            </div>
          </div>

          {/* Per-panel heatmap */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Layers size={12} className="text-slate-400" />
              <span className="text-xs font-medium text-slate-300">Panel Shade Map</span>
              <span className="text-[10px] text-slate-500">({result.heatmapBuckets.length} panels)</span>
            </div>

            {/* Heatmap grid */}
            <div className="bg-slate-900/50 rounded-lg p-3">
              <PanelHeatmapGrid buckets={result.heatmapBuckets} panels={panels} />
            </div>

            {/* Legend */}
            <div className="flex items-center gap-3 mt-2 text-[10px] text-slate-400">
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-sm inline-block" style={{ background: 'rgb(220,0,0)' }} />
                Heavy shade
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-sm inline-block" style={{ background: 'rgb(220,200,0)' }} />
                Partial
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-sm inline-block" style={{ background: 'rgb(0,200,0)' }} />
                Full sun
              </span>
            </div>
          </div>

          {/* Worst/best callouts */}
          <div className="grid grid-cols-2 gap-2">
            {result.worstPanelId ? (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                <div className="text-[10px] text-red-400 font-medium">Most Shaded</div>
                <div className="text-xs text-white">
                  {(result.worstShadeFactor * 100).toFixed(1)}% solar access
                </div>
                <div className="text-[10px] text-slate-500 truncate">
                  Panel {result.worstPanelId.slice(0, 8)}…
                </div>
              </div>
            ) : null}
            {result.bestPanelId ? (
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
                <div className="text-[10px] text-emerald-400 font-medium">Least Shaded</div>
                <div className="text-xs text-white">
                  {(result.bestShadeFactor * 100).toFixed(1)}% solar access
                </div>
                <div className="text-[10px] text-slate-500 truncate">
                  Panel {result.bestPanelId.slice(0, 8)}…
                </div>
              </div>
            ) : null}
          </div>

          {/* Production impact note */}
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg px-3 py-2 text-xs text-blue-300">
            <strong>Impact:</strong> Production adjusted from{' '}
            <strong>{annualProductionKwh.toLocaleString()} kWh</strong> to{' '}
            <strong>{adjustedProduction.toLocaleString()} kWh</strong>{' '}
            (−{(annualProductionKwh - adjustedProduction).toLocaleString()} kWh/yr).
            Shade factors are stored per panel and applied to PVWatts losses.
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── Panel Heatmap Grid ────────────────────────────────────────────────────────

function PanelHeatmapGrid({
  buckets,
  panels,
}: {
  buckets: import('@/lib/shadeAnalysis').ShadeHeatmapBucket[];
  panels: PlacedPanel[];
}) {
  const [hovered, setHovered] = useState<string | null>(null);

  // Build row/col map from panels
  const maxRow = Math.max(0, ...panels.map(p => p.row ?? 0));
  const maxCol = Math.max(0, ...panels.map(p => p.col ?? 0));

  // Create 2D grid
  type Cell = { panelId: string; shadeFactor: number; color: string } | null;
  const grid: Cell[][] = Array.from({ length: maxRow + 1 }, () =>
    Array.from({ length: maxCol + 1 }, () => null)
  );

  const bucketMap = new Map(buckets.map(b => [b.panelId, b]));
  for (const panel of panels) {
    const r = panel.row ?? 0;
    const c = panel.col ?? 0;
    if (r <= maxRow && c <= maxCol) {
      const bucket = bucketMap.get(panel.id);
      if (bucket) {
        grid[r][c] = {
          panelId: panel.id,
          shadeFactor: bucket.shadeFactor,
          color: bucket.color,
        };
      }
    }
  }

  const CELL_SIZE = Math.max(10, Math.min(24, Math.floor(180 / Math.max(maxCol + 1, 1))));
  const hoveredBucket = hovered ? bucketMap.get(hovered) : null;

  return (
    <div>
      {/* Grid */}
      <div className="overflow-x-auto">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${maxCol + 1}, ${CELL_SIZE}px)`,
            gap: 2,
          }}
        >
          {grid.map((row, ri) =>
            row.map((cell, ci) => (
              <div
                key={`${ri}-${ci}`}
                style={{
                  width:  CELL_SIZE,
                  height: CELL_SIZE,
                  background: cell ? cell.color : '#1e293b',
                  borderRadius: 2,
                  cursor: cell ? 'pointer' : 'default',
                  border: hovered === cell?.panelId ? '1px solid white' : '1px solid transparent',
                  transition: 'border-color 0.1s',
                }}
                onMouseEnter={() => cell && setHovered(cell.panelId)}
                onMouseLeave={() => setHovered(null)}
                title={cell ? `${(cell.shadeFactor * 100).toFixed(1)}% solar access` : 'empty'}
              />
            ))
          )}
        </div>
      </div>

      {/* Hover tooltip */}
      {hoveredBucket ? (
        <div className="mt-2 text-[10px] text-slate-300 bg-slate-800 rounded px-2 py-1 inline-block">
          Solar access: <strong>{(hoveredBucket.shadeFactor * 100).toFixed(1)}%</strong>
          {' '}·{' '}
          Derate: <strong>{((1 - hoveredBucket.shadeFactor) * 100).toFixed(1)}%</strong>
        </div>
      ) : null}
    </div>
  );
}
