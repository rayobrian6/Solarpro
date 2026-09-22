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
  WallMeasurement,
  SectionEdit,
  FacePitchPreview,
  PitchAnchor,
} from '@/lib/3d/sectionEditing';
import { FT_PER_M } from '@/lib/3d/sectionEditing';
import { formatRise12, parsePitchInput, riseOver12 } from '@/lib/3d/pitchFormat';

export type InspectorLevel = 'none' | 'section' | 'face' | 'wall';

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
  /**
   * Present at level 'wall'.
   *
   * 🚨 A WALL IS DERIVED, SO THIS LEVEL MEASURES AND DOES NOT EDIT. A wall is
   * one edge of one roof face dropped to the ground; it has no record of its
   * own, and the way to change it is the section's eave or its pad. Offering a
   * control here that writes nowhere is the silent no-op this panel exists to
   * remove — so the panel says which control does the job and sends you there.
   */
  wall: WallMeasurement | null;
  /** The label of the section a selected FACE belongs to, when it has one. */
  faceSectionLabel: string | null;
  /** For the empty state: how much building there is to select. */
  sectionCount: number;
  standaloneFaceCount: number;
  /** The last refusal, already phrased for a person. */
  refusal: string | null;
  /**
   * How many faces of the selected section Stitch or Square Up reshaped by
   * hand. While this is non-zero the section's parametric controls would
   * DISCARD that reshape, so they are shown disabled with the choice stated.
   */
  reshapedFaceCount: number;
  /**
   * WHAT STAYS PUT WHEN A PITCH CHANGES. UI state, owned by the engine so it
   * survives a selection change — but it is not a stored property of any roof.
   * See `SectionEdit.pitchAnchor`.
   */
  pitchAnchor: PitchAnchor;
}

export interface SectionInspectorProps {
  state: InspectorState;
  /** Emit an intent. The authority decides whether it is legal. */
  onEdit: (edit: SectionEdit, label: string, coalesceKey: string) => void;
  /** Move between Section, Roof Face and Wall for the current selection. */
  onSelectLevel: (level: 'section' | 'face' | 'wall') => void;
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
  /**
   * SET THE SELECTED FACE'S PITCH. Degrees — the one stored form. The rise:run
   * box converts to degrees before it gets here, so there is exactly one value
   * travelling and exactly one authority receiving it.
   */
  onSetFacePitch: (pitchDeg: number, anchor: PitchAnchor) => void;
  onSetPitchAnchor: (anchor: PitchAnchor) => void;
  /**
   * WHAT WOULD HAPPEN, without doing it. Called while the installer is typing
   * so the coupling is on screen BEFORE they commit: "the ridge rises 1 ft 4 in;
   * Slope B keeps its own pitch." Returns null when there is nothing to preview.
   *
   * 🚨 IT MUST BE THE REAL AUTHORITY'S ANSWER. `previewFacePitch` applies the
   * edit to a copy and reads the result; a closed-form guess in this component
   * would be a second implementation of the ridge solution, free to disagree
   * with the one that actually runs.
   */
  previewPitch: (pitchDeg: number, anchor: PitchAnchor) => FacePitchPreview | null;
  /** Select a named face of the current section (the face list at section level). */
  onSelectFace: (faceId: string) => void;
  /**
   * Rebuild this section from its footprint/eave/pitch, DISCARDING a hand
   * reshape. Only ever called from the explicit button below — never inferred.
   */
  onRebuildFromParameters: () => void;
  /**
   * DELETE WHAT IS SELECTED.
   *
   * 🚨 IT IS HERE BECAUSE THE SELECTION IS HERE. The owner's instruction was
   * "do not bury deletion inside internal tooling" — the control belongs on the
   * object, beside the controls that edit it, so that "which one will go" is
   * answered by the same highlight that answers "which one am I editing".
   *
   * The component does not delete anything. It names a scope; the owner plans
   * it, shows exactly what would be removed, asks for confirmation when the
   * scope deserves it, and applies it through the one canonical path that
   * records the undo step and the tombstone.
   */
  onDelete: (scope: 'face' | 'section') => void;
  /**
   * WHICH WAY A SINGLE-PLANE ROOF FALLS, compass degrees.
   *
   * 🚨 IT IS ASKED FOR, NOT DERIVED. A mono-slope needs a magnitude AND a
   * direction, and deriving the direction from the order the corners were
   * clicked is how a porch ends up draining toward the house. The control is
   * offered wherever the pitch control is, for the same object, so "which way"
   * and "how steep" are answered in one place.
   */
  onSetSlopeAzimuth: (azimuthDeg: number) => void;
  /** Rendered as a disabled hint when the section has no editable record. */
  disabled?: boolean;
}

// ── Presentation ────────────────────────────────────────────────────────────

const PANEL: React.CSSProperties = {
  width: 268,
  // 🚨 IT IS ANCHORED TO THE BOTTOM, SO IT GROWS UPWARD INTO THE CHROME.
  //
  // The dock places this panel at `bottom: 96`, so every row added to it pushes
  // the TOP further up — and the level chips (Section / Roof face / Wall) are
  // the topmost thing in it. Adding the delete control was enough to slide them
  // under the studio header, where the header's own flex row swallows the
  // pointer events: the chips were visible, enabled, and unclickable. Three
  // browser specs caught it by timing out on a click that Playwright reported
  // as "intercepts pointer events", which is exactly what a person would
  // experience and would have no way to describe.
  //
  // Capping the height and scrolling inside is the fix that survives the NEXT
  // row somebody adds, rather than one that works until the panel grows again.
  maxHeight: 'calc(100vh - 220px)',
  overflowY: 'auto',
  overscrollBehavior: 'contain',
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
  /** Every parseable keystroke, and null when the box is left. Used to preview
   *  the consequences of a value BEFORE it is committed. Never an edit. */
  onDraft?: (next: number | null) => void;
}) {
  const { label, value, unit, step, decimals, disabled, testId, onCommit, onStep, onDraft } = props;
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
        onChange={e => {
          setDraft(e.target.value);
          if (onDraft) {
            const n = parseFloat(e.target.value);
            onDraft(isFinite(n) ? n : null);
          }
        }}
        onFocus={() => { if (!unresolved) setDraft(shown); }}
        onBlur={() => {
          const raw = draft;
          setDraft(null);
          if (onDraft) onDraft(null);
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

/**
 * THE PITCH EDITOR. One physical quantity, two ways to type it.
 *
 * 🚨 DEGREES ARE THE VALUE; RISE:RUN IS A SECOND KEYBOARD ONTO IT. Both boxes
 * commit through the SAME `onCommit(deg)`, and both re-read the model every
 * render. There is no `riseDraft` that survives a commit and no stored rise
 * anywhere — so the two boxes cannot drift apart, which is the entire reason
 * the conversion lives in lib/3d/pitchFormat.ts rather than in this file.
 *
 * 🚨 A FACE THAT CANNOT TAKE A PITCH GETS NO EDITOR AND A REASON. Offering a
 * box that accepts a number and changes nothing is the silent no-op this
 * editor was rebuilt to remove.
 */
function PitchEditor(props: {
  pitchDeg: number | null;
  disabled?: boolean;
  notEditableWhy?: string | null;
  onCommit: (deg: number) => void;
  onStep: (deg: number) => void;
  onDraft?: (deg: number | null) => void;
  idPrefix: string;
}) {
  const { pitchDeg, disabled, notEditableWhy, onCommit, onStep, onDraft, idPrefix } = props;
  const [riseDraft, setRiseDraft] = useState<string | null>(null);
  const [riseError, setRiseError] = useState<string | null>(null);
  const riseShown = pitchDeg == null || !isFinite(pitchDeg) ? '' : riseOver12(pitchDeg).toFixed(2);
  useEffect(() => { setRiseDraft(null); setRiseError(null); }, [riseShown]);

  if (notEditableWhy) {
    return (
      <>
        <Derived
          label="Pitch"
          value={pitchDeg == null ? '—' : `${pitchDeg.toFixed(1)}°`}
          note="measured"
        />
        <div data-testid={`${idPrefix}-pitch-locked`} style={{
          marginTop: 4, padding: '5px 7px', borderRadius: 5,
          background: 'rgba(148,163,184,0.10)', border: '1px solid rgba(148,163,184,0.25)',
          color: '#9aa8bd', fontSize: 9.5, lineHeight: 1.45,
        }}>{notEditableWhy}</div>
      </>
    );
  }

  return (
    <>
      <NumberField
        label="Pitch" unit="°" step={1} decimals={1}
        testId={`${idPrefix}-pitch`}
        value={pitchDeg} disabled={disabled}
        onCommit={onCommit} onStep={onStep} onDraft={onDraft}
      />
      <div style={ROW}>
        <span style={LABEL}>Rise : run</span>
        <input
          type="text"
          data-no-drag
          data-testid={`${idPrefix}-pitch-rise`}
          disabled={disabled}
          placeholder="6:12"
          value={riseDraft ?? (riseShown === '' ? '—' : `${riseShown} : 12`)}
          onChange={e => setRiseDraft(e.target.value)}
          onFocus={() => { if (riseShown !== '') setRiseDraft(riseShown); }}
          onBlur={() => {
            const raw = riseDraft;
            setRiseDraft(null);
            if (raw == null || raw.trim() === '') { setRiseError(null); return; }
            // A bare number in THIS box is a rise over 12, because that is what
            // the box is labelled. The degrees box above reads a bare number as
            // degrees. Neither one has to guess.
            const parsed = parsePitchInput(/[:/]|\bin\b/.test(raw) ? raw : `${raw.trim()}:12`);
            if (!parsed.ok) { setRiseError(parsed.reason); return; }
            setRiseError(null);
            onCommit(parsed.pitchDeg);
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') { setRiseDraft(null); setRiseError(null); (e.target as HTMLInputElement).blur(); }
          }}
          style={{ ...NUM_INPUT, width: 86, textAlign: 'center', opacity: disabled ? 0.5 : 1 }}
        />
        <span style={{ ...UNIT, flex: 1, textAlign: 'right' }}>
          {pitchDeg == null ? '' : formatRise12(pitchDeg)}
        </span>
      </div>
      {riseError ? (
        <div data-testid={`${idPrefix}-pitch-rise-error`} style={{
          margin: '2px 0 0 84px', color: '#ffcf7a', fontSize: 9.5, lineHeight: 1.4,
        }}>{riseError}</div>
      ) : null}
    </>
  );
}

/** Hold the eave, or hold the ridge. Named, because it is a physical choice. */
function AnchorToggle(props: {
  anchor: PitchAnchor;
  disabled?: boolean;
  onChange: (a: PitchAnchor) => void;
}) {
  const { anchor, disabled, onChange } = props;
  return (
    <div style={{ ...ROW, marginTop: 3 }}>
      <span style={LABEL}>Changing pitch</span>
      <div style={{ display: 'flex', gap: 3, flex: 1 }}>
        {([
          ['eave', 'Holds the wall', 'The wall height stays; the ridge moves.'],
          ['ridge', 'Holds the ridge', 'The ridge elevation stays; the wall height is re-derived.'],
        ] as Array<[PitchAnchor, string, string]>).map(([a, text, title]) => (
          <button
            key={a} type="button" data-no-drag
            data-testid={`inspector-anchor-${a}`}
            disabled={disabled}
            title={title}
            onClick={() => onChange(a)}
            style={{
              flex: 1, padding: '2px 0', borderRadius: 4, fontSize: 9.5, fontWeight: 700,
              cursor: disabled ? 'default' : 'pointer',
              background: anchor === a ? 'rgba(160,140,255,0.22)' : 'rgba(255,255,255,0.05)',
              border: `1px solid ${anchor === a ? 'rgba(160,140,255,0.55)' : 'rgba(255,255,255,0.10)'}`,
              color: anchor === a ? '#c0b0ff' : '#9aa8bd',
            }}
          >{text}</button>
        ))}
      </div>
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

/**
 * The eight directions a roof can fall, as a designer says them.
 *
 * 🚨 EIGHT, NOT A FREE NUMBER FIELD. A porch drains toward the yard, not toward
 * 197 degrees. An installer who needs the exact figure can still read it from
 * the face, and nobody has to type one to describe a lean-to.
 */
const SLOPE_DIRECTIONS: ReadonlyArray<{ label: string; deg: number }> = [
  { label: 'N', deg: 0 }, { label: 'NE', deg: 45 }, { label: 'E', deg: 90 }, { label: 'SE', deg: 135 },
  { label: 'S', deg: 180 }, { label: 'SW', deg: 225 }, { label: 'W', deg: 270 }, { label: 'NW', deg: 315 },
];

function compassName(deg: number): string {
  const names = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  return names[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

/** One look for every delete control, so "this removes something" is learned
 *  once and recognised everywhere. */
const DELETE_BTN: React.CSSProperties = {
  marginTop: 8, width: '100%', padding: '5px 0', borderRadius: 6,
  background: 'rgba(255,90,90,0.12)', border: '1px solid rgba(255,90,90,0.40)',
  color: '#ffb3b3', fontSize: 10.5, fontWeight: 800, cursor: 'pointer',
};

// ── The component ───────────────────────────────────────────────────────────

export function SectionInspector({
  state, onEdit, onSelectLevel, onNudgeFace, onClearSelection, onDismissRefusal,
  onSetFacePitch, onSetPitchAnchor, previewPitch, onSelectFace, onRebuildFromParameters,
  onDelete, onSetSlopeAzimuth, disabled,
}: SectionInspectorProps) {
  const s = state.section;
  const f = state.face;
  const w = state.wall;

  // ── WHAT WOULD HAPPEN, LIVE, WHILE THE NUMBER IS BEING TYPED ─────────────
  //
  // 🚨 THE ANSWER COMES FROM THE AUTHORITY, NOT FROM THIS COMPONENT.
  // `previewPitch` runs `previewFacePitch`, which applies the edit to a COPY of
  // the real planes and reports the real outcome. Nothing here re-derives a
  // ridge height, so the sentence on screen cannot promise something the commit
  // will not do.
  const [pitchDraft, setPitchDraft] = useState<number | null>(null);
  // A selection change abandons any half-typed number.
  useEffect(() => { setPitchDraft(null); }, [f?.faceId, state.level]);

  const preview = React.useMemo(() => {
    if (state.level !== 'face' || !f || f.pitchScope === 'not-editable') return null;
    const candidate = pitchDraft != null && isFinite(pitchDraft) ? pitchDraft : f.pitchDeg;
    if (candidate == null || !isFinite(candidate)) return null;
    return previewPitch(candidate, state.pitchAnchor);
    // `previewPitch` closes over the live planes; the deps that matter are the
    // ones that change what is asked, plus the face's own measured pitch, which
    // moves whenever the model does.
  }, [state.level, f?.faceId, f?.pitchDeg, f?.pitchScope, pitchDraft, state.pitchAnchor, previewPitch]);

  const pitchConsequences: string[] = preview
    ? (preview.ok ? preview.consequences : preview.refusals.map(r => r.message))
    : [];
  const previewIsRefusal = !!preview && !preview.ok;

  // 🚨 THE SECTION'S PARAMETRIC CONTROLS GO INERT WHILE A FACE IS HAND-RESHAPED.
  // Every one of them rebuilds the section from footprint + eave + pitch, so
  // every one of them would discard the stitch. The authority refuses them
  // anyway; disabling them here is what stops the installer finding that out by
  // pressing a stepper and reading a refusal.
  const sectionDisabled = disabled || state.reshapedFaceCount > 0;

  const levelChip = (level: InspectorLevel, text: string, active: boolean, enabled: boolean) => (
    <button
      key={level}
      type="button"
      data-no-drag
      data-testid={`inspector-level-${level}`}
      disabled={!enabled}
      onClick={() => {
        if (level === 'section' || level === 'face' || level === 'wall') onSelectLevel(level);
      }}
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
        {/* 🚨 ENABLED ONLY WHEN THERE IS A SECTION TO GO TO. It used to be lit
            for a standalone face too, so clicking it accepted the press, changed
            nothing and said nothing — a control that looks available and is not
            is the same defect as a control that accepts a number and ignores it. */}
        {levelChip('section', 'Section', state.level === 'section',
          !!s || !!(f && f.sectionId) || !!(w && w.sectionId))}
        {levelChip('face', 'Roof face', state.level === 'face', !!f || !!s || !!w)}
        {/* 🚨 THE WALL CHIP IS ONLY LIT WHEN A WALL IS SELECTED. There is no
               "the wall of this face" — a face has several — so this level is
               reached by clicking one, not by switching to it. */}
        {levelChip('wall', 'Wall', state.level === 'wall', !!w)}
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

          {/* ── HAND-RESHAPED: THE CHOICE, STATED ────────────────────────────
                 Stitch produces corners no footprint-and-pitch pair describes.
                 The controls below would rebuild from those parameters and
                 throw the stitch away — which is what used to happen with no
                 warning at all. So they are disabled, the reason is on screen,
                 and discarding the reshape takes a deliberate press. ── */}
          {state.reshapedFaceCount > 0 ? (
            <div data-testid="inspector-reshaped" style={{
              margin: '4px 0 8px', padding: '6px 8px', borderRadius: 6,
              background: 'rgba(255,190,80,0.10)', border: '1px solid rgba(255,190,80,0.35)',
              color: '#ffcf7a', fontSize: 9.5, lineHeight: 1.45,
            }}>
              {state.reshapedFaceCount} face{state.reshapedFaceCount === 1 ? '' : 's'} here{' '}
              {state.reshapedFaceCount === 1 ? 'was' : 'were'} reshaped by hand (Stitch or Square Up),
              so this section&apos;s footprint and pitch no longer describe{' '}
              {state.reshapedFaceCount === 1 ? 'it' : 'them'}. Any change here rebuilds every face from
              the original trace. Undo to step back before the reshape, or:
              <button
                type="button" data-no-drag data-testid="inspector-rebuild-parametric"
                onClick={onRebuildFromParameters}
                style={{
                  display: 'block', marginTop: 5, width: '100%', padding: '4px 0', borderRadius: 5,
                  background: 'rgba(255,190,80,0.16)', border: '1px solid rgba(255,190,80,0.5)',
                  color: '#ffcf7a', fontSize: 9.5, fontWeight: 800, cursor: 'pointer',
                }}
              >Rebuild from the trace (discards the reshape)</button>
            </div>
          ) : null}
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
            value={m2ft(s.eaveHeightM)} disabled={sectionDisabled}
            onCommit={v => onEdit({ eaveHeightM: ft2m(v) }, 'Set eave height', `eave:${s.sectionId}`)}
            onStep={v => onEdit({ eaveHeightM: ft2m(v) }, 'Set eave height', `eave:${s.sectionId}`)}
          />
          {/* 🚨 ONE DECIMAL, NOT ZERO. `decimals={0}` printed a 22.5° roof as
                 "23" — a half-degree lie in the number that drives the ridge
                 height, the array tilt PVWatts reads and the pitch on the
                 permit drawing (22.5° is 4.65:12; 23° is 5.09:12). Worse, the
                 stepper then sent `hidden 22.5 + 1` = 23.5, which printed as
                 "24", so the user could not even predict what a press would
                 do. A field that rounds is a field that lies. */}
          {/* 🚨 THE FLAT LOCK IS GONE FROM HERE TOO, AND THAT IS THE HALF
                 THAT WAS STILL BROKEN.

                 The refusal that stood here was written for a real defect: a
                 flat deck accepted a pitch, reported success, built itself
                 horizontal anyway and then displayed the number it had not
                 used. Refusing beat lying. It was still the wrong cure, and
                 the owner said so holding a 2-in-12 porch: "I should NOT have
                 to delete it and redraw it using a completely different
                 internal object."

                 🚨 AND THE FIRST FIX ONLY REACHED THE FACE LEVEL. `flat` was
                 unlocked in `measureFaceVertical` and left locked HERE, so
                 selecting the porch — which lands on the SECTION level —
                 still showed "Pitch 0.0°" with no way to change it. Half a
                 fix reads to the user exactly like no fix, because the door
                 they actually walk through is still shut.
                 `applySectionEdit` converts the section in place, keeping the
                 footprint, pad, eave and id. */}
          <PitchEditor
            idPrefix="inspector"
            pitchDeg={s.pitchDeg}
            disabled={sectionDisabled}
            notEditableWhy={null}
            onCommit={v => onEdit({ pitchDeg: v, pitchAnchor: state.pitchAnchor }, 'Set roof pitch', `pitch:${s.sectionId}`)}
            onStep={v => onEdit({ pitchDeg: v, pitchAnchor: state.pitchAnchor }, 'Set roof pitch', `pitch:${s.sectionId}`)}
          />
          {/* 🚨 A SINGLE PLANE HAS NO RIDGE TO HOLD, so the eave/ridge anchor
                 is meaningless for it — there is one edge that rises and one
                 that does not. Offering the toggle would be a control that
                 decides nothing. */}
          {!s.singlePlane ? (
            <AnchorToggle
              anchor={state.pitchAnchor}
              disabled={sectionDisabled}
              onChange={onSetPitchAnchor}
            />
          ) : null}
          {s.mixedPitch ? (
            <div data-testid="inspector-mixed-pitch" style={{
              margin: '2px 0 2px 84px', fontSize: 9.5, color: '#c0b0ff', lineHeight: 1.4,
            }}>
              Faces differ — setting this returns them all to one pitch.
            </div>
          ) : null}
          <NumberField
            label="Pad elevation" unit="ft" step={1} decimals={1}
            testId="inspector-ground"
            value={m2ft(s.groundElevM)} disabled={sectionDisabled}
            onCommit={v => onEdit({ groundElevM: ft2m(v) }, 'Set pad elevation', `pad:${s.sectionId}`)}
            onStep={v => onEdit({ groundElevM: ft2m(v) }, 'Set pad elevation', `pad:${s.sectionId}`)}
          />

          <div style={{ height: 1, background: 'rgba(148,163,184,0.18)', margin: '7px 0 6px' }} />

          <Derived label="Eave above sea" value={fmtFt(s.eaveElevM)} note="derived" />
          <Derived label="Ridge height" value={fmtFt(s.ridgeHeightM)} note="derived" />
          <Derived label="Ridge above sea" value={fmtFt(s.ridgeElevM)} note="derived" />

          {/* ── EVERY FACE AND ITS ACTUAL PITCH. "Which slope is the 4:12 one"
                 has to be answerable without clicking each one to find out.
                 Clicking a row selects that face, where its pitch is editable. ── */}
          {s.facePitches.length > 1 ? (
            <div data-testid="inspector-face-list" style={{ marginTop: 7 }}>
              <div style={SECTION_TITLE}>Faces</div>
              {s.facePitches.map(fp => (
                <button
                  key={fp.key} type="button" data-no-drag
                  data-testid={`inspector-face-row-${fp.key}`}
                  disabled={sectionDisabled}
                  title={`Select ${fp.label} to edit its pitch`}
                  onClick={() => onSelectFace(fp.faceId)}
                  style={{
                    display: 'flex', width: '100%', alignItems: 'center', gap: 6,
                    padding: '3px 5px', marginBottom: 2, borderRadius: 4,
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    color: '#cfd8e6', fontSize: 10, cursor: disabled ? 'default' : 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <span style={{ flex: 1 }}>{fp.label}</span>
                  <span style={{
                    fontVariantNumeric: 'tabular-nums', fontWeight: 700,
                    color: Math.abs(fp.pitchDeg - s.pitchDeg) > 0.05 ? '#c0b0ff' : '#cfe3ff',
                  }}>
                    {fp.pitchDeg.toFixed(1)}° · {formatRise12(fp.pitchDeg)}
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          {/* ── Ridge direction. A cross-gable wing is wrong 90° without it. ── */}
          {s.kind === 'gable' || s.kind === 'hip' ? (
            <div style={{ ...ROW, marginTop: 5 }}>
              <span style={LABEL}>Ridge runs</span>
              <div style={{ display: 'flex', gap: 3, flex: 1 }}>
                {(['long', 'short'] as const).map(axis => (
                  <button
                    key={axis} type="button" data-no-drag
                    data-testid={`inspector-ridge-${axis}`}
                    disabled={sectionDisabled}
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
                  disabled={sectionDisabled}
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
            label="Faces"
            value={f.azimuthDeg == null ? '—' : `${Math.round(f.azimuthDeg)}° ${compass(f.azimuthDeg)}`}
            note="measured"
          />

          <div style={{ height: 1, background: 'rgba(148,163,184,0.18)', margin: '7px 0 6px' }} />

          {/* ── THE FACE'S OWN PITCH, EDITABLE. This is the capability the
                 live gauntlet named as blocking: "the current UI can display
                 pitch for a selected roof face but cannot edit that face's
                 pitch." ── */}
          <PitchEditor
            idPrefix="inspector-face"
            pitchDeg={f.pitchDeg}
            disabled={disabled}
            notEditableWhy={f.pitchScope === 'not-editable' ? f.pitchNotEditableWhy : null}
            onCommit={v => onSetFacePitch(v, state.pitchAnchor)}
            onStep={v => onSetFacePitch(v, state.pitchAnchor)}
            onDraft={setPitchDraft}
          />
          {f.pitchScope !== 'not-editable' ? (
            <>
              <AnchorToggle
                anchor={state.pitchAnchor}
                disabled={disabled}
                onChange={onSetPitchAnchor}
              />
              {f.overridesSectionPitch && f.sectionPitchDeg != null ? (
                <div data-testid="inspector-face-overrides" style={{
                  marginTop: 5, fontSize: 9.5, color: '#c0b0ff', lineHeight: 1.45,
                }}>
                  This face has its own pitch. The rest of the section defaults to{' '}
                  {f.sectionPitchDeg.toFixed(1)}° ({formatRise12(f.sectionPitchDeg)}).
                </div>
              ) : null}
              {pitchConsequences.length > 0 ? (
                <ul data-testid="inspector-pitch-consequences" style={{
                  margin: '6px 0 0', padding: '0 0 0 14px',
                  fontSize: 9.5, lineHeight: 1.5,
                  color: previewIsRefusal ? '#ffcf7a' : '#9aa8bd',
                }}>
                  {pitchConsequences.map((c, i) => <li key={i}>{c}</li>)}
                </ul>
              ) : null}
            </>
          ) : null}

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
              {/* 🚨 THE ADVICE MUST NAME SOMETHING THE USER CAN DO, AND SAY WHAT IT
                  COSTS. "Trace it as a building section" meant delete and re-trace
                  with a different tool — there is no promote/group operation
                  anywhere in the product — and re-tracing mints new face ids, so
                  every panel standing on this face orphans. Saying only the first
                  half of that sends a person to redo work and lose an array they
                  did not know was at risk. */}
              <div style={{ marginTop: 6, fontSize: 9.5, color: '#7c8aa5', lineHeight: 1.45 }}>
                This is a single traced face, so it has no wall, pad or ridge to set —
                only a relative move. To get those, model the mass with
                <b> Building → Gable, Hip or Flat/Block</b>, which builds a section.
                That means re-tracing this face: it is a different object, and any
                panels on this one would have to be laid again.
              </div>
            </>
          )}
        </div>
      ) : null}

      {/* ── A WALL: measured, and honest about having no controls ───────── */}
      {state.level === 'wall' && w ? (
        <div data-testid="inspector-wall">
          <div style={{ fontWeight: 800, color: '#fff', fontSize: 12.5, marginBottom: 1 }}>
            Wall
          </div>
          <div style={{ color: '#7c8aa5', fontSize: 10, marginBottom: 8 }}>
            {state.faceSectionLabel
              ? <>under <span style={{ color: '#cfe3ff' }}>{state.faceSectionLabel}</span></>
              : 'under a roof face that belongs to no section'}
          </div>

          {/* 🚨 EVERY ROW IS MEASURED FROM THE FACE'S OWN GEOMETRY, with the
                 render lift removed vertically and ignored horizontally — it
                 shifts both ends of an edge by the same vector, so the plan
                 length must not be "corrected" twice. */}
          <Derived label="Length" value={fmtFt(w.lengthM)} note="measured" />
          {w.raked ? (
            <>
              {/* A gable end is a triangle: "the wall height" is a range, and
                  printing one number for it would be a lie at both ends. */}
              <Derived label="Height (low)" value={fmtFt(w.heightLowM)}
                       note={w.baseElevM == null ? 'unresolved' : 'measured'} />
              <Derived label="Height (high)" value={fmtFt(w.heightHighM)}
                       note={w.baseElevM == null ? 'unresolved' : 'measured'} />
            </>
          ) : (
            <Derived label="Height" value={fmtFt(w.heightHighM)}
                     note={w.baseElevM == null ? 'unresolved' : 'measured'} />
          )}
          <Derived label="Top above sea" value={fmtFt(w.topHighElevM)} note="measured" />
          <Derived label="Base above sea" value={fmtFt(w.baseElevM)}
                   note={w.baseElevM == null ? 'unresolved' : 'measured'} />
          <Derived
            label="Faces"
            value={w.facingDeg == null ? '—' : `${Math.round(w.facingDeg)}° ${compass(w.facingDeg)}`}
            note="measured"
          />

          {w.baseElevM == null ? (
            <div data-testid="inspector-wall-unresolved" style={{
              marginTop: 7, padding: '5px 7px', borderRadius: 5,
              background: 'rgba(255,190,80,0.10)', border: '1px solid rgba(255,190,80,0.3)',
              color: '#ffcf7a', fontSize: 9.5, lineHeight: 1.45,
            }}>
              No ground elevation is known here, so this wall&apos;s height has no answer.
              The elevations above are still real.
            </div>
          ) : null}

          {/* 🚨 NO CONTROLS, AND A REASON. A wall is one edge of a roof face
                 dropped to the ground — it is derived, it has no record, and
                 nothing written here could reach it. The things that DO move it
                 are named, and the button goes to them. */}
          <div style={{ marginTop: 7, fontSize: 9.5, color: '#7c8aa5', lineHeight: 1.45 }}>
            A wall is derived from the roof face above it and the pad below it.
            Change its height with the section&apos;s <b>Wall / eave</b>, or its base
            with <b>Pad elevation</b>.
          </div>
          <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
            {w.sectionId ? (
              <button
                type="button" data-no-drag data-testid="inspector-wall-to-section"
                onClick={() => onSelectLevel('section')}
                style={{
                  flex: 1, padding: '5px 0', borderRadius: 6,
                  background: 'rgba(0,229,255,0.14)', border: '1px solid rgba(0,229,255,0.45)',
                  color: '#00e5ff', fontSize: 10.5, fontWeight: 800, cursor: 'pointer',
                }}
              >Edit the section</button>
            ) : null}
            <button
              type="button" data-no-drag data-testid="inspector-wall-to-face"
              onClick={() => onSelectLevel('face')}
              style={{
                flex: 1, padding: '5px 0', borderRadius: 6,
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.16)',
                color: '#cfd8e6', fontSize: 10.5, fontWeight: 800, cursor: 'pointer',
              }}
            >The roof above it</button>
          </div>
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

      {/* ── WHICH WAY A SINGLE-PLANE ROOF FALLS ───────────────────────────
             Offered only where it means something: one planar surface. A gable
             has no single downhill direction, and a control that appears for it
             would be a control that decides nothing. */}
      {s && s.singlePlane ? (
        <div data-testid="inspector-slope-direction" style={{ marginTop: 9 }}>
          <div style={SECTION_TITLE}>Slopes down toward</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
            {SLOPE_DIRECTIONS.map(d => {
              const on = s.slopeAzimuthDeg !== null
                && Math.abs(((s.slopeAzimuthDeg - d.deg + 540) % 360) - 180) < 22.5;
              return (
                <button
                  key={d.label}
                  type="button" data-no-drag
                  data-testid={`inspector-slope-${d.label}`}
                  onClick={() => onSetSlopeAzimuth(d.deg)}
                  style={{
                    padding: '3px 7px', borderRadius: 5, fontSize: 10, fontWeight: 800,
                    cursor: 'pointer',
                    background: on ? 'rgba(0,229,255,0.20)' : 'rgba(255,255,255,0.05)',
                    border: '1px solid ' + (on ? 'rgba(0,229,255,0.55)' : 'rgba(255,255,255,0.14)'),
                    color: on ? '#7fe9ff' : '#cfd8e6',
                  }}
                >{d.label}</button>
              );
            })}
          </div>
          <div style={{ marginTop: 4, fontSize: 9.5, color: '#9aa8bd', lineHeight: 1.4 }}>
            {s.slopeAzimuthDeg === null
              ? 'Not set yet. Choose the direction water runs before giving this roof a pitch.'
              : `Water runs ${compassName(s.slopeAzimuthDeg)}. The opposite edge is the high one.`}
          </div>
        </div>
      ) : null}

      {/* ── DELETE WHAT IS SELECTED ──────────────────────────────────────
             One control, named for the object the highlight is on. A face and
             a section are both single-click deletions with a real undo — the
             ceremony belongs on the two that cannot be a slip (Clear Custom
             Building, Start Over), and those live at the workspace level, not
             here. Making every removal cost a modal is how people stop trying
             things, and a modelling tool that punishes experiment is the
             usability failure this whole pass exists to remove. */}
      {state.level === 'face' && f ? (
        <button
          type="button" data-no-drag data-testid="inspector-delete-face"
          onClick={() => onDelete('face')}
          style={DELETE_BTN}
        >🗑 Delete this roof face</button>
      ) : null}
      {state.level === 'section' && s ? (
        <button
          type="button" data-no-drag data-testid="inspector-delete-section"
          onClick={() => onDelete('section')}
          style={DELETE_BTN}
        >🗑 Delete this building section</button>
      ) : null}
      {state.level === 'wall' && w ? (
        /* 🚨 NO DELETE BUTTON FOR A WALL, AND THE REASON IS SAID OUT LOUD.
           A wall is GENERATED from its section's footprint and eave height; it
           has no independent existence to remove, and a control that appeared
           to delete one would either do nothing or silently delete something
           else. Naming the object that can actually go is the honest answer. */
        <div data-testid="inspector-wall-delete-note" style={{
          marginTop: 8, padding: '6px 8px', borderRadius: 6,
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)',
          color: '#9aa8bd', fontSize: 10, lineHeight: 1.45,
        }}>
          A wall is built from its section&rsquo;s footprint, so it cannot be deleted on its
          own. {w.sectionId ? 'Delete the section to remove it.' : 'It belongs to no section.'}
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
