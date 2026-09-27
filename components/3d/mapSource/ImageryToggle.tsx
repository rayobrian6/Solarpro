/**
 * components/3d/mapSource/ImageryToggle.tsx
 *
 * ═══ THE CONTROL RAY COULD NOT FIND ═══
 *
 * "I am in the 3D environment right now. There is no visible Nearmap toggle. I can still only
 * access Nearmap from the 2D environment." Measured in a real browser, he was right in the way
 * that matters: the 3D imagery picker WAS on screen, visible, enabled and clickable — and a sweep
 * of every button and menu item on the page found the string "Nearmap" exactly ZERO times. The
 * provider lived one click inside a dropdown labelled "Google", in a bar labelled
 * "Details / LiDAR / Street View". Meanwhile the 2D toolbar has a button that says, in words,
 * "🛰️ Nearmap HD" — and that button is rendered only when `!show3D`.
 *
 * A control you cannot find is not a control. His requirement, verbatim:
 *
 *     Imagery
 *     `Native 3D | Nearmap`
 *
 * So that is what this is: both choices visible at once, labelled, never behind a menu.
 *
 * ONE AUTHORITY. It writes the same `MapPickerState.source` the dropdown writes — the state the
 * engine's reference-imagery effect already consumes. It is a second AFFORDANCE, not a second
 * source of truth, the way a toolbar button and a menu item can both run one command.
 *
 * "Native 3D" is `google`, because in this viewer the native imagery IS Google's Photorealistic
 * 3D mesh. It is labelled for what the user sees rather than for the vendor.
 */

'use client';

import React from 'react';
import SourceIcon from './SourceIcon';
import type { MapSource } from './types';

interface Props {
  source: MapSource;
  onChange: (source: MapSource) => void;
  disabled?: boolean;
  className?: string;
}

export default function ImageryToggle({ source, onChange, disabled, className }: Props) {
  const isNearmap = source === 'nearmap';

  const seg = (
    active: boolean, label: string, testId: string, title: string, next: MapSource,
    icon?: React.ReactNode,
  ) => (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      title={title}
      data-testid={testId}
      onClick={() => { if (!disabled && source !== next) onChange(next); }}
      className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold transition-colors ${
        active ? 'bg-white text-slate-900' : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div
      role="group"
      aria-label="Imagery source"
      data-testid="imagery-toggle"
      data-imagery-source={isNearmap ? 'nearmap' : 'native'}
      className={`flex items-stretch border-l border-slate-700 ${className ?? ''}`}
    >
      <span className="flex items-center px-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-slate-900/70">
        Imagery
      </span>
      {seg(!isNearmap, 'Native 3D', 'imagery-native',
        'The viewer’s own 3D imagery (Google Photorealistic mesh)', 'google')}
      {seg(isNearmap, 'Nearmap', 'imagery-nearmap',
        'Show this project’s already-acquired Nearmap aerial as a reference surface — '
        + 'no new imagery is purchased', 'nearmap',
        <SourceIcon kind="nearmap" size={12} />)}
    </div>
  );
}
