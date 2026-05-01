'use client';
import React from 'react';
import type { DrawingMode, SystemType } from '@/types';
import {
  MousePointer2, PenTool, Square, Minus, Ruler,
  Trash2, CheckSquare, Home, Layers, Fence
} from 'lucide-react';

interface Props {
  mode: DrawingMode;
  systemType: SystemType;
  onModeChange: (mode: DrawingMode) => void;
  onFinalize: () => void;
  onDeleteSelected: () => void;
  hasSelection: boolean;
  drawnPoints: number;
}

export default function DesignToolbar({
  mode, systemType, onModeChange, onFinalize, onDeleteSelected, hasSelection, drawnPoints
}: Props) {
  const tools = [
    { id: 'select' as DrawingMode, icon: <MousePointer2 size={16} />, label: 'Select / Pan', shortcut: 'V' },
    ...(systemType === 'roof' ? [
      { id: 'draw_roof' as DrawingMode, icon: <Home size={16} />, label: 'Draw Roof Plane', shortcut: 'R' },
    ] : []),
    ...(systemType === 'ground' ? [
      { id: 'draw_ground' as DrawingMode, icon: <Square size={16} />, label: 'Draw Ground Area', shortcut: 'G' },
    ] : []),
    ...(systemType === 'fence' ? [
      { id: 'draw_fence' as DrawingMode, icon: <Minus size={16} />, label: 'Draw Fence Line', shortcut: 'F' },
    ] : []),
    { id: 'measure' as DrawingMode, icon: <Ruler size={16} />, label: 'Measure', shortcut: 'M' },
  ];

  const typeColor = {
    roof: 'bg-amber-500/20 border-amber-500/40 text-amber-400',
    ground: 'bg-teal-500/20 border-teal-500/40 text-teal-400',
    fence: 'bg-purple-500/20 border-purple-500/40 text-purple-400',
  }[systemType];

  return (
    <div className="w-14 bg-slate-900 border-r border-slate-700/50 flex flex-col items-center py-3 gap-1 flex-shrink-0">
      {/* System type indicator */}
      <div className={`w-8 h-8 rounded-lg border flex items-center justify-center mb-2 ${typeColor}`}>
        {systemType === 'roof' ? <Home size={14} /> :
         systemType === 'ground' ? <Layers size={14} /> :
         <Fence size={14} />}
      </div>

      <div className="w-8 border-t border-slate-700/50 mb-1" />

      {/* Drawing tools */}
      {tools.map(tool => (
        <button
          key={tool.id}
          onClick={() => onModeChange(tool.id)}
          title={`${tool.label} (${tool.shortcut})`}
          className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all group relative ${
            mode === tool.id
              ? 'bg-amber-500/20 border border-amber-500/40 text-amber-400'
              : 'text-slate-500 hover:text-slate-300 hover:bg-slate-700/60'
          }`}
        >
          {tool.icon}
          {/* Tooltip */}
          <div className="absolute left-full ml-2 px-2 py-1 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-50 transition-opacity">
            {tool.label}
            <span className="ml-1.5 text-slate-500">{tool.shortcut}</span>
          </div>
        </button>
      ))}

      <div className="w-8 border-t border-slate-700/50 my-1" />

      {/* Finalize drawing */}
      {drawnPoints >= 2 && (
        <button
          onClick={onFinalize}
          title="Finish Drawing (Double-click)"
          className="w-10 h-10 rounded-xl flex items-center justify-center bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/30 transition-all group relative"
        >
          <CheckSquare size={16} />
          <div className="absolute left-full ml-2 px-2 py-1 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-50">
            Finish Drawing
          </div>
        </button>
      )}

      {/* Delete selected */}
      {hasSelection && (
        <button
          onClick={onDeleteSelected}
          title="Delete Selected Panels"
          className="w-10 h-10 rounded-xl flex items-center justify-center bg-red-500/20 border border-red-500/40 text-red-400 hover:bg-red-500/30 transition-all group relative"
        >
          <Trash2 size={16} />
          <div className="absolute left-full ml-2 px-2 py-1 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-50">
            Delete Selected
          </div>
        </button>
      )}

      {/* Drawing point counter */}
      {drawnPoints > 0 && (
        <div className="mt-auto mb-2 w-8 h-8 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 text-xs font-bold">
          {drawnPoints}
        </div>
      )}
    </div>
  );
}