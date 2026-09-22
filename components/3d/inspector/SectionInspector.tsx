/**
 * components/3d/inspector/SectionInspector.tsx
 *
 * THE CONTEXTUAL INSPECTOR — what is selected, and what is true about it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE THIS COMPONENT EXISTS TO ENFORCE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   "Do not show WALLS 17 ft if that number does not represent a real 17 ft
 *    physical wall. If the true physical value is unresolved, show unresolved
 *    rather than a misleading number."
 *
 * Every number rendered here comes from `lib/3d/sectionEditing`, which derives
 * it from canonical geometry or from the section's own record. There is no
 * component state holding a value, and therefore no way for a stepper to drift
 * away from the model it claims to describe — which is exactly what the old
 * global `wallHeightM` counter did on its way to reading 17 ft about a 10 ft
 * wall.
 *
 * A field whose physical value cannot be established renders an em dash. That
 * is not a placeholder for a number we will find later; it is the answer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SECTION IS THE DEFAULT EDIT TARGET
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A roof face cannot answer "how high is this wall" and must not be asked to
 * move on its own: raising one half of a gable opens the ridge, and closing it
 * again is the compensating edit the installer reported. So selecting any face
 * of a section selects the SECTION, and the face level is a deliberate drill-in
 * that offers measurements rather than vertical controls.
 *
 * 🚨 NO GEOMETRY IN THIS FILE. No Cesium, no ECEF, no trigonometry beyond a
 * unit conversion. It renders a measurement and emits an intent; the authority
 * decides whether the intent is legal.
 */

'use client';

import React, { useEffect, useState } from 'react';
import type {
  SectionMeasurement,
  FaceMeasurement,
  SectionEdit,
} from '@/lib/3d/sectionEditing';
import { FT_PER_M } from '@/lib/3d/sectionEditing';

export type InspectorLevel = 'none' | 'section' | 'face';

/**
 * 🚨 A UNIFORM SHAPE, NOT A DISCRIMINATED UNION — `strict: false` and no
 * strictNullChecks, so narrowing on `level` does not survive to runtime.
 */
export interface InspectorState {
  level: InspectorLevel;
  /** Present at level 'section'. */
  section: SectionMeasurement | null;
  /** Present at level 'face'. */
  face: FaceMeasurement | null;
  /** The label of the section a selected FACE belongs to, when it has one. */
  faceSectionLabel: string | null;
  /** For the empty state: how much building there is to select. */
  sectionCount: number;
  standaloneFaceCount: number;
  /** The last refusal, already phrased for a person. */
  refusal: string | null;
}

export interface SectionInspectorProps {
  state: InspectorState;
  /** Emit an intent. The authority decides whether it is legal. */
  onEdit: (edit: SectionEdit, label: string, coalesceKey: string) => void;
  /** Move between Section and Roof Face for the current selection. */
  onSelectLevel: (level: 'section' | 'face') => void;
  /**
   * Move ONE standalone face up or down by this many metres.
   *
   * 🚨 OFFERED ONLY FOR A FACE WITH NO SECTION, AND NAMED AS MOTION. A face
   * with no pad has no absolute height to set; pretending otherwise is what
   * produced a readout of 17 ft on a ten-foot wall. A face that DOES belong to
   * a section is never offered this, because moving half a gable opens the
   * ridge — the section is the thing that moves.
   */
  onNudgeFace: (deltaM: number) => void;
  onClearSelection: () => void;
  onDismissRefusal: () => void;
  /** Rendered as a disabled hint when the section has no editable record. */
  disabled?: boolean;
}

// ── Presentation ────────────────────────────────────────────────────────────

const PANEL: React.CSSProperties = {
  width: 268,
  background: 'rgba(10,14,24,0.92)',
  border: '1px solid rgba(148,163,184,0.28)',
  borderRadius: 10,
  padding: '10px 11px 11px',
  backdropFilter: 'blur(8px)',
  color: '#e2e8f0',
  fontSize: 11,
  boxShadow: '0 8px 26px rgba(0,0,0,0.45)',
};

const SECTION_TITLE: React.CSSProperties = {
  fontSize: 9, fontWeight: 800, letterSpacing: 1.1,
  color: '#7c8aa5', textTransform: 'uppercase', marginBottom: 6,
};

const ROW: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, minHeight: 24,
};

const LABEL: React.CSSProperties = {
  flex: '0 0 84px', color: '#9aa8bd', fontSize: 10.5,
};

const STEP_BTN: React.CSSProperties = {
  width: 20, height: 20, lineHeight: '18px', textAlign: 'center',
  background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.16)',
  color: '#cfd8e6', borderRadius: 5, fontSize: 12, fontWeight: 800,
  cursor: 'pointer', padding: 0, flex: '0 0 auto',
};

const NUM_INPUT: React.CSSProperties = {
  width: 62, background: 'rgba(0,0,0,0.42)', color: '#fff',
  border: '1px solid rgba(255,255,255,0.18)', borderRadius: 5,
  padding: '2px 5px', fontSize: 11, fontWeight: 700,
  fontVariantNumeric: 'tabular-nums', textAlign: 'right',
};

const UNIT: React.CSSProperties = { color: '#7c8aa5', fontSize: 10, flex: '0 0 18px' };

/** A read-only derived value. Styled differently so it never looks editable. */
function Derived({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div style={ROW}>
      <span style={LABEL}>{label}</span>
      <span style={{
        flex: 1, textAlign: 'right', fontWeight: 700,
        fontVariantNumeric: 'tabular-nums',
        color: value === '—' ? '#7c8aa5' : '#cfe3ff',
      }}>{value}</span>
      <span style={{ ...UNIT, flex: '0 0 auto', minWidth: 46, textAlign: 'right' }}>
        {note ?? ''}
      </span>
    </div>
  );
}

/**
 * A numeric field in the user's units.
 *
 * 🚨 IT SHOWS THE MODEL, NOT WHAT WAS TYPED. `value` is re-read from the
 * measurement on every render, so if the authority refuses an edit the field
 * snaps back to what the building actually is. The local draft exists only
 * while the box has focus, so typing "1" on the way to "12" does not rebuild
 * the roof at one foot.
 */
function NumberField(props: {
  label: string;
  value: number | null;
  unit: string;
  step: number;
  decimals: number;
  disabled?: boolean;
  testId?: string;
  onCommit: (next: number) => void;
  onStep: (next: number) => void;
}) {
  const { label, value, unit, step, decimals, disabled, testId, onCommit, onStep } = props;
  const shown = value == null || !isFinite(value) ? '' : value.toFixed(decimals);
  const [draft, setDraft] = useState<string | null>(null);

  // A selection change must replace the draft, not keep editing the old object.
  useEffect(() => { setDraft(null); }, [shown]);

  const unresolved = value == null || !isFinite(value);

  return (
    <div style={ROW}>
      <span style={LABEL}>{label}</span>
      <button
        type="button" data-no-drag style={STEP_BTN} disabled={disabled || unresolved}
        title={`Decrease by ${step}`}
        onClick={() => onStep(+(value! - step).toFixed(6))}
      >{'−'}</button>
      <input
        type="text"
        inputMode="decimal"
        data-no-drag
        data-testid={testId}
        disabled={disabled}
        value={draft ?? (unresolved ? '—' : shown)}
        onChange={e => setDraft(e.target.value)}
        onFocus={() => { if (!unresolved) setDraft(shown); }}
        onBlur={() => {
          const raw = draft;
          setDraft(null);
          if (raw == null) return;
          const n = parseFloat(raw);
          // 🚨 AN UNPARSEABLE BOX IS NOT A ZERO. Emitting one would drop a house
          // to the ellipsoid, and `roofPlaneFromFootprint` substitutes 0 for a
          // non-finite ground without complaint.
          if (!isFinite(n)) return;
          onCommit(n);
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') { setDraft(null); (e.target as HTMLInputElement).blur(); }
        }}
        style={{ ...NUM_INPUT, opacity: disabled ? 0.5 : 1 }}
      />
      <button
        type="button" data-no-drag style={STEP_BTN} disabled={disabled || unresolved}
        title={`Increase by ${step}`}
        onClick={() => onStep(+(value! + step).toFixed(6))}
      >+</button>
      <span style={UNIT}>{unit}</span>
    </div>
  );
}

const m2ft = (m: number | null | undefined): number | null =>
  m == null || !isFinite(m) ? null : m * FT_PER_M;
const ft2m = (ft: number): number => ft / FT_PER_M;

const fmtFt = (m: number | null | undefined, dp = 1): string =>
  m == null || !isFinite(m) ? '—' : `${(m * FT_PER_M).toFixed(dp)} ft`;

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const compass = (deg: number | null): string =>
  deg == null || !isFinite(deg) ? '—' : COMPASS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];

const KIND_LABEL: Record<string, string> = {
  gable: 'Gable', hip: 'Hip', shed: 'Shed', flat: 'Flat',
};

// ── The component ───────────────────────────────────────────────────────────

export function SectionInspector({
  state, onEdit, onSelectLevel, onNudgeFace, onClearSelection, onDismissRefusal, disabled,
}: SectionInspectorProps) {
  const s = state.section;
  const f = state.face;

  const levelChip = (level: InspectorLevel, text: string, active: boolean, enabled: boolean) => (
    <button
      key={level}
      type="button"
      data-no-drag
      data-testid={`inspector-level-${level}`}
      disabled={!enabled}
      onClick={() => { if (level === 'section' || level === 'face') onSelectLevel(level); }}
      style={{
        flex: 1, padding: '3px 0', borderRadius: 5, fontSize: 9.5, fontWeight: 800,
        letterSpacing: 0.4, textTransform: 'uppercase',
        cursor: enabled ? 'pointer' : 'default',
        background: active ? 'rgba(0,229,255,0.18)' : 'rgba(255,255,255,0.05)',
        border: `1px solid ${active ? 'rgba(0,229,255,0.55)' : 'rgba(255,255,255,0.10)'}`,
        color: active ? '#00e5ff' : (enabled ? '#9aa8bd' : '#4d586b'),
      }}
    >{text}</button>
  );

  return (
    <div style={PANEL} data-testid="section-inspector">
      {/* ── WHAT IS SELECTED. The instruction was explicit: when I select
             geometry I need to see unmistakably Selected: Section / Roof Face /
             Wall, and the controls must change to that object's scope. ── */}
      <div style={SECTION_TITLE}>Selected</div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {levelChip('section', 'Section', state.level === 'section', !!s || !!f)}
        {levelChip('face', 'Roof face', state.level === 'face', !!f || !!s)}
      </div>

      {/* ── NOTHING SELECTED ────────────────────────────────────────────── */}
      {state.level === 'none' ? (
        <div data-testid="inspector-empty" style={{ color: '#9aa8bd', lineHeight: 1.5 }}>
          <div style={{ fontWeight: 700, color: '#cfd8e6', marginBottom: 3 }}>
            Nothing selected
          </div>
          <div>
            {state.sectionCount} building section{state.sectionCount === 1 ? '' : 's'}
            {state.standaloneFaceCount > 0
              ? ` · ${state.standaloneFaceCount} separate roof face${state.standaloneFaceCount === 1 ? '' : 's'}`
              : ''}
          </div>
          <div style={{ marginTop: 6, fontSize: 10, color: '#7c8aa5' }}>
            Click a roof to select the section it belongs to.
          </div>
        </div>
      ) : null}

      {/* ── A BUILDING SECTION: absolute physical values, all editable ───── */}
      {state.level === 'section' && s ? (
        <div data-testid="inspector-section">
          <div style={{ fontWeight: 800, color: '#fff', fontSize: 12.5, marginBottom: 1 }}>
            {s.label}
          </div>
          <div style={{ color: '#7c8aa5', fontSize: 10, marginBottom: 8 }}>
            {KIND_LABEL[s.kind] ?? s.kind} roof · {s.faceCount} face{s.faceCount === 1 ? '' : 's'}
            {' · '}{fmtFt(s.planAM, 0)} × {fmtFt(s.planBM, 0)}
          </div>

          {/* 🚨 EVERY ONE OF THESE IS ABSOLUTE AND PHYSICAL.
                 pad     — elevation of the ground this section stands on
                 wall    — eave above THAT pad; the thing a tape measures
                 pitch   — the slope
                 ridge   — DERIVED from the three above and the footprint, so
                           it is shown and never typed. Two editable fields that
                           both move the ridge is how the old editor asked the
                           user to do relative-offset algebra in their head. */}
          <NumberField
            label="Wall / eave" unit="ft" step={1} decimals={1}
            testId="inspector-eave"
            value={m2ft(s.eaveHeightM)} disabled={disabled}
            onCommit={v => onEdit({ eaveHeightM: ft2m(v) }, 'Set eave height', `eave:${s.sectionId}`)}
            onStep={v => onEdit({ eaveHeightM: ft2m(v) }, 'Set eave height', `eave:${s.sectionId}`)}
          />
          <NumberField
            label="Roof pitch" unit="°" step={1} decimals={0}
            testId="inspector-pitch"
            value={s.pitchDeg} disabled={disabled}
            onCommit={v => onEdit({ pitchDeg: v }, 'Set roof pitch', `pitch:${s.sectionId}`)}
            onStep={v => onEdit({ pitchDeg: v }, 'Set roof pitch', `pitch:${s.sectionId}`)}
          />
          <NumberField
            label="Pad elevation" unit="ft" step={1} decimals={1}
            testId="inspector-ground"
            value={m2ft(s.groundElevM)} disabled={disabled}
            onCommit={v => onEdit({ groundElevM: ft2m(v) }, 'Set pad elevation', `pad:${s.sectionId}`)}
            onStep={v => onEdit({ groundElevM: ft2m(v) }, 'Set pad elevation', `pad:${s.sectionId}`)}
          />

          <div style={{ height: 1, background: 'rgba(148,163,184,0.18)', margin: '7px 0 6px' }} />

          <Derived label="Eave above sea" value={fmtFt(s.eaveElevM)} note="derived" />
          <Derived label="Ridge height" value={fmtFt(s.ridgeHeightM)} note="derived" />
          <Derived label="Ridge above sea" value={fmtFt(s.ridgeElevM)} note="derived" />

          {/* ── Ridge direction. A cross-gable wing is wrong 90° without it. ── */}
          {s.kind === 'gable' || s.kind === 'hip' ? (
            <div style={{ ...ROW, marginTop: 5 }}>
              <span style={LABEL}>Ridge runs</span>
              <div style={{ display: 'flex', gap: 3, flex: 1 }}>
                {(['long', 'short'] as const).map(axis => (
                  <button
                    key={axis} type="button" data-no-drag
                    data-testid={`inspector-ridge-${axis}`}
                    disabled={disabled}
                    onClick={() => onEdit({ ridgeAxis: axis }, 'Set ridge direction', `ridge:${s.sectionId}`)}
                    style={{
                      flex: 1, padding: '2px 0', borderRadius: 4, fontSize: 9.5, fontWeight: 700,
                      cursor: 'pointer',
                      background: (s.ridgeAxis === axis || (s.ridgeAxis === 'auto' && axis === 'long'))
                        ? 'rgba(160,140,255,0.22)' : 'rgba(255,255,255,0.05)',
                      border: `1px solid ${(s.ridgeAxis === axis || (s.ridgeAxis === 'auto' && axis === 'long'))
                        ? 'rgba(160,140,255,0.55)' : 'rgba(255,255,255,0.10)'}`,
                      color: (s.ridgeAxis === axis || (s.ridgeAxis === 'auto' && axis === 'long'))
                        ? '#c0b0ff' : '#9aa8bd',
                    }}
                  >{axis === 'long' ? 'Long way' : 'Short way'}</button>
                ))}
              </div>
            </div>
          ) : null}

          {/* ── Move the whole volume. Named as motion, because a footprint has
                 no single position to set. ── */}
          <div style={{ ...ROW, marginTop: 7 }}>
            <span style={LABEL}>Move</span>
            <div style={{ display: 'flex', gap: 3, flex: 1 }}>
              {([
                ['←', { moveEastM: -ft2m(1) }, 'west'],
                ['→', { moveEastM: ft2m(1) }, 'east'],
                ['↑', { moveNorthM: ft2m(1) }, 'north'],
                ['↓', { moveNorthM: -ft2m(1) }, 'south'],
              ] as Array<[string, SectionEdit, string]>).map(([glyph, edit, dir]) => (
                <button
                  key={dir} type="button" data-no-drag
                  data-testid={`inspector-move-${dir}`}
                  disabled={disabled}
                  title={`Move this section 1 ft ${dir}`}
                  onClick={() => onEdit(edit, 'Move section', `move:${s.sectionId}`)}
                  style={{ ...STEP_BTN, flex: 1, width: 'auto' }}
                >{glyph}</button>
              ))}
              <span style={{ ...UNIT, flex: '0 0 auto', alignSelf: 'center' }}>1 ft</span>
            </div>
          </div>

          <div style={{ marginTop: 7, fontSize: 9.5, color: '#7c8aa5', lineHeight: 1.45 }}>
            Every face of this section moves together. Neighbouring sections stay put.
          </div>
        </div>
      ) : null}

      {/* ── A SINGLE ROOF FACE: measurements, and no vertical controls ───── */}
      {state.level === 'face' && f ? (
        <div data-testid="inspector-face">
          <div style={{ fontWeight: 800, color: '#fff', fontSize: 12.5, marginBottom: 1 }}>
            Roof face
          </div>
          <div style={{ color: '#7c8aa5', fontSize: 10, marginBottom: 8 }}>
            {state.faceSectionLabel
              ? <>part of <span style={{ color: '#cfe3ff' }}>{state.faceSectionLabel}</span></>
              : 'not part of a building section'}
          </div>

          {/* 🚨 "measured" MEANS MEASURED. These are read back out of the
                 canonical geometry with the render lift removed — not from any
                 control, and not from anything a stepper has been pressed on. */}
          <Derived label="Eave above sea" value={fmtFt(f.eaveElevM)} note="measured" />
          <Derived label="Ridge above sea" value={fmtFt(f.ridgeElevM)} note="measured" />
          <Derived
            label="Wall height"
            value={fmtFt(f.wallHeightM)}
            note={f.groundResolved ? 'measured' : 'unresolved'}
          />
          <Derived
            label="Pitch"
            value={f.pitchDeg == null ? '—' : `${f.pitchDeg.toFixed(1)}°`}
            note="measured"
          />
          <Derived
            label="Faces"
            value={f.azimuthDeg == null ? '—' : `${Math.round(f.azimuthDeg)}° ${compass(f.azimuthDeg)}`}
            note="measured"
          />

          {!f.groundResolved ? (
            <div data-testid="inspector-unresolved" style={{
              marginTop: 7, padding: '5px 7px', borderRadius: 5,
              background: 'rgba(255,190,80,0.10)', border: '1px solid rgba(255,190,80,0.3)',
              color: '#ffcf7a', fontSize: 9.5, lineHeight: 1.45,
            }}>
              No ground elevation is known for this face, so its wall height has
              no answer. The elevations above are still real.
            </div>
          ) : null}

          {f.sectionId ? (
            <button
              type="button" data-no-drag data-testid="inspector-edit-section"
              onClick={() => onSelectLevel('section')}
              style={{
                marginTop: 8, width: '100%', padding: '5px 0', borderRadius: 6,
                background: 'rgba(0,229,255,0.14)', border: '1px solid rgba(0,229,255,0.45)',
                color: '#00e5ff', fontSize: 10.5, fontWeight: 800, cursor: 'pointer',
              }}
            >Edit the whole section</button>
          ) : (
            <>
              <div style={{ ...ROW, marginTop: 8 }}>
                <span style={LABEL}>Move face</span>
                <button
                  type="button" data-no-drag data-testid="inspector-face-down"
                  title="Move this face down 1 ft"
                  onClick={() => onNudgeFace(-ft2m(1))}
                  style={{ ...STEP_BTN, flex: 1, width: 'auto' }}
                >↓</button>
                <button
                  type="button" data-no-drag data-testid="inspector-face-up"
                  title="Move this face up 1 ft"
                  onClick={() => onNudgeFace(ft2m(1))}
                  style={{ ...STEP_BTN, flex: 1, width: 'auto' }}
                >↑</button>
                <span style={{ ...UNIT, flex: '0 0 auto' }}>1 ft</span>
              </div>
              {/* 🚨 NAMED AS MOTION, WITH NO NUMBER BESIDE IT. There is nothing
                     honest to display: this face has no pad, so "wall height"
                     has no value, and a counter of how often the button was
                     pressed is what read 17 ft on a ten-foot wall. */}
              <div style={{ marginTop: 6, fontSize: 9.5, color: '#7c8aa5', lineHeight: 1.45 }}>
                This face was traced on its own, so it has no wall or pad to set —
                only a relative move. Trace it as a building section to get real
                heights.
              </div>
            </>
          )}
        </div>
      ) : null}

      {/* ── A REFUSAL, in the user's words ──────────────────────────────── */}
      {state.refusal ? (
        <div data-testid="inspector-refusal" style={{
          marginTop: 8, padding: '6px 8px', borderRadius: 6,
          background: 'rgba(255,90,90,0.12)', border: '1px solid rgba(255,90,90,0.4)',
          color: '#ffb3b3', fontSize: 10, lineHeight: 1.45,
        }}>
          {state.refusal}
          <button
            type="button" data-no-drag onClick={onDismissRefusal}
            style={{
              marginLeft: 6, background: 'none', border: 'none', color: '#ffb3b3',
              cursor: 'pointer', fontWeight: 800, fontSize: 11, padding: 0,
            }}
          >×</button>
        </div>
      ) : null}

      {state.level !== 'none' ? (
        <button
          type="button" data-no-drag data-testid="inspector-clear"
          onClick={onClearSelection}
          style={{
            marginTop: 8, width: '100%', padding: '4px 0', borderRadius: 6,
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
            color: '#9aa8bd', fontSize: 10, fontWeight: 700, cursor: 'pointer',
          }}
        >Deselect</button>
      ) : null}
    </div>
  );
}

export default SectionInspector;
