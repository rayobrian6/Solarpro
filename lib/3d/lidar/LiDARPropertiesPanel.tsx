'use client';
/**
 * lib/3d/lidar/LiDARPropertiesPanel.tsx
 *
 * Aurora parity: floating top-left "LiDAR Properties" panel (frame 125).
 */

import React from 'react';
import type { LiDAROffset, LiDARState, LiDARStyle } from './types';

export interface LiDARPropertiesPanelProps {
  state: LiDARState;
  onStyleChange: (style: LiDARStyle) => void;
  onTexturedChange: (on: boolean) => void;
  onOffsetChange: (offset: LiDAROffset) => void;
  onLoadClick: () => void;
  onLiftRoofs: () => void;
  onFlattenRoofs: () => void;
  onClear?: () => void;
}

const PANEL_STYLE: React.CSSProperties = {
  position: 'absolute',
  top: 12,
  left: 12,
  zIndex: 60,
  background: 'rgba(15,15,30,0.92)',
  backdropFilter: 'blur(6px)',
  border: '1px solid rgba(34, 197, 94, 0.4)',
  borderRadius: 8,
  padding: '8px 10px',
  color: '#eee',
  fontSize: 11,
  lineHeight: '15px',
  minWidth: 200,
  fontFamily: 'system-ui, -apple-system, sans-serif',
  boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
};

const HEADER_STYLE: React.CSSProperties = {
  fontWeight: 700,
  color: '#4ade80',
  marginBottom: 6,
  fontSize: 12,
  borderBottom: '1px solid rgba(34, 197, 94, 0.25)',
  paddingBottom: 4,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

const ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  marginBottom: 4,
};

const LABEL_STYLE: React.CSSProperties = {
  color: '#9ca3af',
  fontSize: 11,
  width: 50,
  flexShrink: 0,
};

const INPUT_STYLE: React.CSSProperties = {
  width: 50,
  background: 'rgba(0,0,0,0.4)',
  border: '1px solid rgba(255,255,255,0.15)',
  color: '#eee',
  borderRadius: 4,
  padding: '2px 4px',
  fontSize: 11,
  fontFamily: 'monospace',
  textAlign: 'right',
};

const STEPPER_BTN: React.CSSProperties = {
  width: 18,
  height: 16,
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
  color: '#9ca3af',
  borderRadius: 3,
  cursor: 'pointer',
  fontSize: 10,
  padding: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const SELECT_STYLE: React.CSSProperties = {
  flex: 1,
  background: 'rgba(0,0,0,0.4)',
  border: '1px solid rgba(255,255,255,0.15)',
  color: '#eee',
  borderRadius: 4,
  padding: '2px 4px',
  fontSize: 11,
};

const BUTTON_STYLE: React.CSSProperties = {
  flex: 1,
  background: 'rgba(34, 197, 94, 0.15)',
  color: '#4ade80',
  border: '1px solid rgba(34, 197, 94, 0.3)',
  borderRadius: 5,
  padding: '4px 8px',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
};

const FOOTER_STYLE: React.CSSProperties = {
  marginTop: 6,
  paddingTop: 4,
  borderTop: '1px solid rgba(255,255,255,0.08)',
  fontSize: 10,
  color: '#9ca3af',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function LiDARPropertiesPanel(props: LiDARPropertiesPanelProps) {
  const { state, onStyleChange, onTexturedChange, onOffsetChange,
    onLoadClick, onLiftRoofs, onFlattenRoofs, onClear } = props;
  const { dataset, style, textured, offset, error } = state;

  const step = 0.1;
  const nudge = (axis: keyof LiDAROffset, delta: number) => {
    onOffsetChange({ ...offset, [axis]: Number((offset[axis] + delta).toFixed(2)) });
  };
  const setAxis = (axis: keyof LiDAROffset, raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    onOffsetChange({ ...offset, [axis]: n });
  };

  return (
    <div style={PANEL_STYLE} data-testid="lidar-properties-panel">
      <div style={HEADER_STYLE}>
        <span>LiDAR Properties</span>
        {dataset && onClear ? (
          <button
            onClick={onClear}
            style={{ ...STEPPER_BTN, width: 'auto', padding: '0 5px', color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)' }}
            title="Unload LiDAR"
            aria-label="Unload LiDAR"
          >×</button>
        ) : null}
      </div>

      <div style={ROW_STYLE}>
        <span style={LABEL_STYLE}>Style</span>
        <select
          style={SELECT_STYLE}
          value={style}
          onChange={(e) => onStyleChange(e.target.value as LiDARStyle)}
          aria-label="LiDAR render style"
        >
          <option value="mesh">Mesh</option>
          <option value="pointCloud">Point Cloud</option>
        </select>
      </div>

      <div style={ROW_STYLE}>
        <span style={LABEL_STYLE}>Textured</span>
        <input
          type="checkbox"
          checked={textured}
          onChange={(e) => onTexturedChange(e.target.checked)}
          style={{ marginRight: 'auto' }}
          aria-label="Toggle satellite-textured LiDAR"
          disabled={style === 'pointCloud'}
        />
        {style === 'pointCloud' ? <span style={{ fontSize: 9, color: '#666' }}>(mesh only)</span> : null}
      </div>

      {(['x', 'y', 'z'] as const).map((axis) => (
        <div key={axis} style={ROW_STYLE}>
          <span style={LABEL_STYLE}>{axis.toUpperCase()} Offset</span>
          <button style={STEPPER_BTN} onClick={() => nudge(axis, -step)} aria-label={`Decrease ${axis} offset`}>−</button>
          <input
            type="number"
            step={step}
            value={offset[axis]}
            onChange={(e) => setAxis(axis, e.target.value)}
            style={INPUT_STYLE}
            aria-label={`${axis.toUpperCase()} offset in feet`}
          />
          <button style={STEPPER_BTN} onClick={() => nudge(axis, step)} aria-label={`Increase ${axis} offset`}>+</button>
          <span style={{ fontSize: 10, color: '#666', minWidth: 18 }}>ft</span>
        </div>
      ))}

      {dataset ? (
        <>
          <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '6px 0' }} />
          <div style={{ display: 'flex', gap: 4 }}>
            <button style={BUTTON_STYLE} onClick={onLiftRoofs} title="Snap each roof plane to the highest LiDAR points under it">
              ⤴ Lift Roofs
            </button>
            <button style={BUTTON_STYLE} onClick={onFlattenRoofs} title="Snap each roof plane to the median LiDAR height under it">
              ⤵ Flatten Roofs
            </button>
          </div>
        </>
      ) : null}

      <div style={FOOTER_STYLE}>
        {error ? (
          <div style={{ color: '#ef4444' }}>⚠ {error}</div>
        ) : dataset ? (
          <>
            <div title={dataset.source} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              📄 {dataset.source || '(unnamed)'}
            </div>
            <div>{formatCount(dataset.count)} points</div>
          </>
        ) : null}
        <button
          onClick={onLoadClick}
          style={{
            ...BUTTON_STYLE,
            background: 'rgba(59, 130, 246, 0.15)',
            color: '#60a5fa',
            borderColor: 'rgba(59, 130, 246, 0.3)',
          }}
        >
          {dataset ? 'Replace .las File' : 'Load .las File'}
        </button>
      </div>
    </div>
  );
}

/** "LiDAR is running..." toast (Aurora frame 125). */
export function LiDARLoadingToast({ show, message }: { show: boolean; message?: string }) {
  if (!show) return null;
  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        right: 12,
        zIndex: 60,
        background: 'rgba(15, 15, 30, 0.92)',
        color: '#4ade80',
        padding: '6px 12px',
        borderRadius: 6,
        border: '1px solid rgba(34, 197, 94, 0.4)',
        fontSize: 12,
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
      role="status"
      aria-live="polite"
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: '#4ade80',
          animation: 'lidar-pulse 1.2s ease-in-out infinite',
        }}
      />
      {message ?? 'LiDAR is running...'}
      <style>{`@keyframes lidar-pulse { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }`}</style>
    </div>
  );
}
