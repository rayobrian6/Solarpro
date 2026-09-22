/**
 * @vitest-environment jsdom
 *
 * tests/sectionInspector.test.tsx
 *
 * THE INSPECTOR MUST NOT BE ABLE TO LIE.
 *
 * The control it replaces rendered `WALLS {ftStr(effectiveWallM)}` — a global
 * React counter seeded at 3.0 m that moved only by how often the stepper had
 * been pressed. It was never measured from anything, so it named no wall, and
 * a live test found it reading "around 17 ft" about a wall that was 10' 6".
 *
 * These tests drive the real component in a real DOM and check the two
 * properties that failure came down to:
 *
 *   1. every number shown is READ FROM THE MODEL on each render, so it cannot
 *      drift away from the building it claims to describe
 *   2. an edit emits an ABSOLUTE value derived from that model, so pressing a
 *      stepper twice against an unchanged model emits the same value twice —
 *      which a counter cannot do
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { SectionInspector, type InspectorState } from '@/components/3d/inspector/SectionInspector';
import { measureSection, measureFaceVertical } from '@/lib/3d/sectionEditing';
import { buildSectionRoofPlanes, sectionFaceId } from '@/lib/3d/buildingSection';
import { mainSection, EXPECTED, GROUND_MAIN_M } from './fixtures/multiSectionHouse';

afterEach(cleanup);

const FT_PER_M = 3.280839895013123;

function baseState(): InspectorState {
  return {
    level: 'none', section: null, face: null, wall: null, faceSectionLabel: null,
    sectionCount: 0, standaloneFaceCount: 0, refusal: null,
    pitchAnchor: 'eave', reshapedFaceCount: 0,
  };
}

function sectionState(): InspectorState {
  return { ...baseState(), level: 'section', section: measureSection(mainSection(), 2) };
}

function mount(state: InspectorState, overrides: Partial<Parameters<typeof SectionInspector>[0]> = {}) {
  const onEdit = vi.fn();
  const onSelectLevel = vi.fn();
  const onNudgeFace = vi.fn();
  const onClearSelection = vi.fn();
  const onDismissRefusal = vi.fn();
  const onSetFacePitch = vi.fn();
  const onSetPitchAnchor = vi.fn();
  const onSelectFace = vi.fn();
  const onRebuildFromParameters = vi.fn();
  const onDelete = vi.fn();
  const onSetSlopeAzimuth = vi.fn();
  // Default: no preview. Tests that care pass their own, backed by the real
  // `previewFacePitch` so the sentence on screen is the authority's answer.
  const previewPitch = vi.fn(() => null);
  render(
    <SectionInspector
      state={state}
      onEdit={onEdit}
      onSelectLevel={onSelectLevel}
      onNudgeFace={onNudgeFace}
      onClearSelection={onClearSelection}
      onDismissRefusal={onDismissRefusal}
      onSetFacePitch={onSetFacePitch}
      onSetPitchAnchor={onSetPitchAnchor}
      onSelectFace={onSelectFace}
      onDelete={onDelete}
      onSetSlopeAzimuth={onSetSlopeAzimuth}
      onRebuildFromParameters={onRebuildFromParameters}
      previewPitch={previewPitch}
      {...overrides}
    />,
  );
  return {
    onEdit, onSelectLevel, onNudgeFace, onClearSelection, onDismissRefusal,
    onSetFacePitch, onSetPitchAnchor, onSelectFace, previewPitch, onRebuildFromParameters, onDelete, onSetSlopeAzimuth,
  };
}

// ═══════════════════════════════════════════════════════════════════════════

describe('a selected section shows its own physical dimensions', () => {
  it('🚨 the wall field shows the SECTION eave, not a 3.0 m default', () => {
    mount(sectionState());
    const eave = screen.getByTestId('inspector-eave') as HTMLInputElement;

    // The fixture house has a 2.9 m eave = 9.5 ft.
    expect(eave.value).toBe((2.9 * FT_PER_M).toFixed(1));
    expect(eave.value).toBe('9.5');

    // MUTATION PROOF: the value the old control would have shown, from
    // FLAT_TRACE_EAVE_HEIGHT_M = 3.0, is a different number and this asserts
    // against it rather than merely "some number".
    expect(eave.value).not.toBe((3.0 * FT_PER_M).toFixed(1));
  });

  it('pitch and pad elevation are the section’s own', () => {
    mount(sectionState());
    // One decimal, not zero: `decimals={0}` printed a 22.5 deg roof as "23",
    // a half-degree lie in the number that drives the ridge height, the array
    // tilt PVWatts reads and the pitch on the permit drawing.
    expect((screen.getByTestId('inspector-pitch') as HTMLInputElement).value).toBe('30.0');
    expect((screen.getByTestId('inspector-ground') as HTMLInputElement).value)
      .toBe((GROUND_MAIN_M * FT_PER_M).toFixed(1));
  });

  it('the ridge is DERIVED — shown, and with no input to type it into', () => {
    mount(sectionState());
    const wanted = `${(EXPECTED['sec-main'].ridgeHeightM * FT_PER_M).toFixed(1)} ft`;
    expect(screen.getByText(wanted)).toBeTruthy();
    // There is no ridge field. Two editable numbers that both move the ridge is
    // how the old editor asked the user to do the algebra in their head.
    expect(screen.queryByTestId('inspector-ridge-height')).toBeNull();
    // It is labelled as derived, so nobody mistakes it for an input.
    expect(screen.getAllByText('derived').length).toBeGreaterThanOrEqual(3);
  });

  it('the header names the section, its kind and its face count', () => {
    mount(sectionState());
    expect(screen.getByText('House')).toBeTruthy();
    expect(screen.getByText(/Gable roof · 2 faces/)).toBeTruthy();
  });
});

describe('🚨 an edit emits an absolute value read from the model', () => {
  it('pressing + twice against an UNCHANGED model emits the same value twice', () => {
    const { onEdit } = mount(sectionState());
    const plus = screen.getByTestId('inspector-eave').parentElement!
      .querySelector('button[title^="Increase"]') as HTMLButtonElement;

    fireEvent.click(plus);
    fireEvent.click(plus);

    expect(onEdit).toHaveBeenCalledTimes(2);
    const a = onEdit.mock.calls[0][0].eaveHeightM;
    const b = onEdit.mock.calls[1][0].eaveHeightM;

    // 🚨 THE WHOLE POINT. A stepper holding its own counter would emit
    // 10.5 ft then 11.5 ft while the building had not moved — which is exactly
    // how the old readout ran eight feet ahead of the wall. This one re-reads
    // the section each time, so both presses ask for the same absolute height.
    expect(a).toBe(b);
    // …and that height is one foot above the section's real eave.
    expect(a).toBeCloseTo(2.9 + 0.3048, 4);
  });

  it('typing a value commits it as an absolute height in metres', () => {
    const { onEdit } = mount(sectionState());
    const eave = screen.getByTestId('inspector-eave');
    fireEvent.focus(eave);
    fireEvent.change(eave, { target: { value: '12' } });
    fireEvent.blur(eave);

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit.mock.calls[0][0].eaveHeightM).toBeCloseTo(12 / FT_PER_M, 6);
    expect(onEdit.mock.calls[0][1]).toBe('Set eave height');
    // The coalesce key names the SECTION, so editing the garage next does not
    // merge into this undo entry.
    expect(onEdit.mock.calls[0][2]).toBe('eave:sec-main');
  });

  it('🚨 an unparseable box emits NOTHING — it is not a zero', () => {
    const { onEdit } = mount(sectionState());
    const eave = screen.getByTestId('inspector-eave');
    for (const bad of ['', '  ', 'abc', '-']) {
      fireEvent.focus(eave);
      fireEvent.change(eave, { target: { value: bad } });
      fireEvent.blur(eave);
    }
    // A zero here drops the house to the ellipsoid, and roofPlaneFromFootprint
    // substitutes 0 for a non-finite ground without complaining.
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('the field snaps back to the model — it does not keep what was typed', () => {
    const { onEdit } = mount(sectionState());
    const eave = screen.getByTestId('inspector-eave') as HTMLInputElement;
    fireEvent.focus(eave);
    fireEvent.change(eave, { target: { value: '99' } });
    expect(eave.value).toBe('99');          // a draft, while focused
    fireEvent.blur(eave);
    // The authority was ASKED for 99 ft; whether it agreed is its business, and
    // the field shows the building, not the request.
    expect(onEdit).toHaveBeenCalled();
    expect(eave.value).toBe('9.5');
  });

  it('moving a section emits motion, never a position', () => {
    const { onEdit } = mount(sectionState());
    fireEvent.click(screen.getByTestId('inspector-move-east'));
    expect(onEdit.mock.calls[0][0]).toEqual({ moveEastM: expect.closeTo(0.3048, 6) });
    expect(onEdit.mock.calls[0][1]).toBe('Move section');
  });

  it('the ridge direction is selectable, because a cross-gable needs the short axis', () => {
    const { onEdit } = mount(sectionState());
    fireEvent.click(screen.getByTestId('inspector-ridge-short'));
    expect(onEdit.mock.calls[0][0]).toEqual({ ridgeAxis: 'short' });
  });
});

describe('🚨 a face whose ground is unknown says so', () => {
  function standaloneFaceState(): InspectorState {
    const plane = buildSectionRoofPlanes(mainSection()).planes[0];
    delete (plane as any).section;
    delete (plane as any).sectionId;
    plane.id = 'hand-traced';
    return { ...baseState(), level: 'face', face: measureFaceVertical(plane) };
  }

  it('renders an em dash for the wall height, and the word unresolved', () => {
    mount(standaloneFaceState());
    expect(screen.getByText('unresolved')).toBeTruthy();
    expect(screen.getByTestId('inspector-unresolved')).toBeTruthy();
    // The dash, not a number — and specifically not the old 9.8 ft default.
    const row = screen.getByText('Wall height').parentElement!;
    expect(row.textContent).toContain('—');
    expect(row.textContent).not.toMatch(/\d/);
  });

  it('its ELEVATIONS are still real and still shown', () => {
    mount(standaloneFaceState());
    // What is unknown is where the ground is, not where the roof is.
    const eaveRow = screen.getByText('Eave above sea').parentElement!;
    expect(eaveRow.textContent).toMatch(/\d+\.\d ft/);
    expect(screen.getAllByText('measured').length).toBeGreaterThanOrEqual(3);
  });

  it('offers a relative move and NO eave field', () => {
    const { onNudgeFace } = mount(standaloneFaceState());
    expect(screen.queryByTestId('inspector-eave')).toBeNull();
    expect(screen.queryByTestId('inspector-ground')).toBeNull();

    fireEvent.click(screen.getByTestId('inspector-face-up'));
    expect(onNudgeFace).toHaveBeenCalledWith(expect.closeTo(0.3048, 6));
    // 🚨 AND NO NUMBER BESIDE IT. There is nothing honest to display: a counter
    // of presses is what read 17 ft on a ten-foot wall.
    const moveRow = screen.getByText('Move face').parentElement!;
    expect(moveRow.textContent).not.toMatch(/\d+\.\d/);
  });
});

describe('🚨 a face that belongs to a section is not given height controls', () => {
  function sectionFaceState(): InspectorState {
    const planes = buildSectionRoofPlanes(mainSection()).planes;
    const face = planes.find(p => p.id === sectionFaceId('sec-main', 'slopeA'))!;
    return {
      ...baseState(), level: 'face',
      face: measureFaceVertical(face), faceSectionLabel: 'House',
    };
  }

  it('it offers the SECTION instead — moving half a gable opens the ridge', () => {
    const { onSelectLevel } = mount(sectionFaceState());
    expect(screen.queryByTestId('inspector-face-up')).toBeNull();
    expect(screen.queryByTestId('inspector-face-down')).toBeNull();

    fireEvent.click(screen.getByTestId('inspector-edit-section'));
    expect(onSelectLevel).toHaveBeenCalledWith('section');
  });

  it('and its wall height IS resolved, because the section carries the pad', () => {
    mount(sectionFaceState());
    const row = screen.getByText('Wall height').parentElement!;
    expect(row.textContent).toContain((2.9 * FT_PER_M).toFixed(1));
    expect(screen.queryByTestId('inspector-unresolved')).toBeNull();
  });

  it('names the section it is part of', () => {
    mount(sectionFaceState());
    expect(screen.getByText('House')).toBeTruthy();
    expect(screen.getByText(/part of/)).toBeTruthy();
  });
});

describe('the empty state and refusals', () => {
  it('with nothing selected it says what there is to select', () => {
    mount({ ...baseState(), sectionCount: 3, standaloneFaceCount: 2 });
    expect(screen.getByTestId('inspector-empty')).toBeTruthy();
    expect(screen.getByText(/3 building sections · 2 separate roof faces/)).toBeTruthy();
    // No fields at all — there is nothing to be wrong about.
    expect(screen.queryByTestId('inspector-eave')).toBeNull();
  });

  it('a refusal is shown in the panel, in words, and can be dismissed', () => {
    const { onDismissRefusal } = mount({
      ...sectionState(),
      refusal: 'A roof cannot be pitched more than 89°.',
    });
    expect(screen.getByTestId('inspector-refusal').textContent)
      .toContain('A roof cannot be pitched more than 89°.');
    fireEvent.click(screen.getByTestId('inspector-refusal').querySelector('button')!);
    expect(onDismissRefusal).toHaveBeenCalled();
  });

  it('the selected LEVEL is visible and switchable', () => {
    const { onSelectLevel } = mount(sectionState());
    const chip = screen.getByTestId('inspector-level-section');
    // Lit for the active level — this is the "selected level is visible"
    // requirement, asserted rather than assumed.
    expect(chip.getAttribute('style')).toContain('0, 229, 255');
    fireEvent.click(screen.getByTestId('inspector-level-face'));
    expect(onSelectLevel).toHaveBeenCalledWith('face');
  });

  it('every editable control disables together when the panel is disabled', () => {
    mount(sectionState(), { disabled: true });
    for (const id of ['inspector-eave', 'inspector-pitch', 'inspector-ground']) {
      expect((screen.getByTestId(id) as HTMLInputElement).disabled).toBe(true);
    }
    expect((screen.getByTestId('inspector-move-east') as HTMLButtonElement).disabled).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PER-FACE PITCH — the capability the live gauntlet named as blocking:
// "the current UI can display pitch for a selected roof face but cannot edit
// that face's pitch."
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 a selected roof face can have its pitch EDITED', () => {
  function sectionFacePitchState(): InspectorState {
    const planes = buildSectionRoofPlanes(mainSection()).planes;
    const face = planes.find(p => p.id === sectionFaceId('sec-main', 'slopeA'))!;
    return {
      ...baseState(), level: 'face',
      face: measureFaceVertical(face), faceSectionLabel: 'House',
    };
  }

  it('the degrees box is an INPUT, not a measured readout', () => {
    const { onSetFacePitch } = mount(sectionFacePitchState());
    const box = screen.getByTestId('inspector-face-pitch') as HTMLInputElement;
    expect(box.tagName).toBe('INPUT');
    // It shows what the face actually is, to one decimal.
    expect(parseFloat(box.value)).toBeCloseTo(30, 1);

    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: '45' } });
    fireEvent.blur(box);
    expect(onSetFacePitch).toHaveBeenCalledTimes(1);
    expect(onSetFacePitch.mock.calls[0][0]).toBeCloseTo(45, 9);
    expect(onSetFacePitch.mock.calls[0][1]).toBe('eave');
  });

  it('🚨 rise:run is a second keyboard onto the SAME value, not a second value', () => {
    const { onSetFacePitch } = mount(sectionFacePitchState());
    const rise = screen.getByTestId('inspector-face-pitch-rise') as HTMLInputElement;
    // It renders the face's real pitch as a builder's fraction.
    expect(rise.value).toMatch(/6\.93\s*:\s*12/);  // 30 degrees is 6.93:12

    fireEvent.focus(rise);
    fireEvent.change(rise, { target: { value: '6' } });
    fireEvent.blur(rise);
    // 🚨 A BARE NUMBER IN THIS BOX IS A RISE, because that is what the box is
    // labelled — and it arrives at the authority in DEGREES, the one stored
    // form. 6:12 is exactly 26.565 degrees.
    expect(onSetFacePitch).toHaveBeenCalledTimes(1);
    expect(onSetFacePitch.mock.calls[0][0]).toBeCloseTo(26.5651, 3);
  });

  it('an explicit 6:12 reads the same as a bare 6 in that box', () => {
    const { onSetFacePitch } = mount(sectionFacePitchState());
    const rise = screen.getByTestId('inspector-face-pitch-rise');
    fireEvent.focus(rise);
    fireEvent.change(rise, { target: { value: '6:12' } });
    fireEvent.blur(rise);
    expect(onSetFacePitch.mock.calls[0][0]).toBeCloseTo(26.5651, 3);
  });

  it('an unreadable rise:run emits nothing and says why', () => {
    const { onSetFacePitch } = mount(sectionFacePitchState());
    const rise = screen.getByTestId('inspector-face-pitch-rise');
    fireEvent.focus(rise);
    fireEvent.change(rise, { target: { value: 'steep' } });
    fireEvent.blur(rise);
    expect(onSetFacePitch).not.toHaveBeenCalled();
    expect(screen.getByTestId('inspector-face-pitch-rise-error').textContent)
      .toMatch(/rise over run/i);
  });

  it('the anchor is a named physical choice, and it is passed to the edit', () => {
    const { onSetPitchAnchor } = mount(sectionFacePitchState());
    expect(screen.getByTestId('inspector-anchor-eave')).toBeTruthy();
    fireEvent.click(screen.getByTestId('inspector-anchor-ridge'));
    expect(onSetPitchAnchor).toHaveBeenCalledWith('ridge');
    cleanup();

    // With the anchor held at 'ridge', the edit carries it.
    const { onSetFacePitch } = mount({ ...sectionFacePitchState(), pitchAnchor: 'ridge' });
    const box = screen.getByTestId('inspector-face-pitch');
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: '40' } });
    fireEvent.blur(box);
    expect(onSetFacePitch.mock.calls[0][1]).toBe('ridge');
  });

  it('🚨 the consequences are on screen BEFORE the commit, from the authority', () => {
    // The component must not compute them. It calls back into
    // `previewFacePitch`, which applies the edit to a copy of the real planes.
    const preview = vi.fn(() => ({
      ok: true, scope: 'section-face' as const, faceId: 'sec-main::slopeA',
      sectionId: 'sec-main', faceKey: 'slopeA' as const,
      pitchBeforeDeg: 30, pitchAfterDeg: 45,
      ridgeHeightBeforeM: 5.5, ridgeHeightAfterM: 6.8,
      eaveHeightBeforeM: 2.9, eaveHeightAfterM: 2.9,
      consequences: ['Slope B keeps their own pitch.', 'No other building section moves.'],
      refusals: [],
    }));
    mount(sectionFacePitchState(), { previewPitch: preview });
    expect(preview).toHaveBeenCalled();
    const list = screen.getByTestId('inspector-pitch-consequences');
    expect(list.textContent).toMatch(/Slope B keeps their own pitch/);
    expect(list.textContent).toMatch(/No other building section moves/);
  });

  it('a refused pitch shows the refusal in place of the consequences', () => {
    const preview = vi.fn(() => ({
      ok: false, scope: 'none' as const, faceId: 'x', sectionId: null, faceKey: null,
      pitchBeforeDeg: null, pitchAfterDeg: NaN,
      ridgeHeightBeforeM: null, ridgeHeightAfterM: null,
      eaveHeightBeforeM: null, eaveHeightAfterM: null,
      consequences: [],
      refusals: [{ code: 'FACE_PITCH_TOO_FLAT' as const, message: 'That face never reaches the ridge.' }],
    }));
    mount(sectionFacePitchState(), { previewPitch: preview });
    expect(screen.getByTestId('inspector-pitch-consequences').textContent)
      .toMatch(/never reaches the ridge/);
  });

  it('🚨 A FLAT DECK DOES GET THE EDITOR — one plane is not zero degrees for ever', () => {
    // ─────────────────────────────────────────────────────────────────────
    // THIS TEST ASSERTED THE OPPOSITE UNTIL THE OWNER USED IT.
    //
    // It required NO editor and the message "a flat section has no pitch —
    // change its roof kind to Shed". That was written for a real defect (a flat
    // section silently STORED a pitch it did not have) and it was still the
    // wrong cure: it told a person holding a 2-in-12 porch to go and learn an
    // internal noun, or to delete the porch and redraw it.
    //
    // `flat` and `shed` are one topology here — a single planar face built by
    // one call — so the pitch control belongs on both. Typing a number converts
    // the section in place, keeping the footprint, the pad, the eave and the id.
    // ─────────────────────────────────────────────────────────────────────
    const flat = buildSectionRoofPlanes({
      ...mainSection(), id: 'sec-flat', kind: 'flat', pitchDeg: 0,
    }).planes[0];
    mount({ ...baseState(), level: 'face', face: measureFaceVertical(flat) });
    expect(screen.getByTestId('inspector-face-pitch')).toBeTruthy();
    expect(screen.queryByTestId('inspector-face-pitch-locked')).toBeNull();
  });

  it('🚨 …but a face that genuinely cannot take one still gets NO editor and a reason', () => {
    // The invariant the test above used to carry, kept and pointed at a case
    // that is actually true: a face naming a section whose definition is not
    // there has nowhere for a pitch to live.
    const orphan = buildSectionRoofPlanes({
      ...mainSection(), id: 'sec-gone',
    }).planes[0];
    const stripped = { ...orphan, section: undefined } as typeof orphan;
    mount({ ...baseState(), level: 'face', face: measureFaceVertical(stripped) });
    expect(screen.queryByTestId('inspector-face-pitch')).toBeNull();
    expect(screen.queryByTestId('inspector-face-pitch-rise')).toBeNull();
    expect(screen.getByTestId('inspector-face-pitch-locked').textContent)
      .toMatch(/carries no definition/i);
  });
});

describe('🚨 a single-plane roof says which way it falls', () => {
  it('the direction control is offered for a flat deck and for a shed', () => {
    for (const kind of ['flat', 'shed'] as const) {
      const sec = measureSection({ ...mainSection(), kind, pitchDeg: kind === 'flat' ? 0 : 12, shedAzimuthDeg: 180 }, 1);
      mount({ ...baseState(), level: 'section', section: sec });
      expect(screen.getByTestId('inspector-slope-direction'), kind).toBeTruthy();
      expect(screen.getByTestId('inspector-slope-S'), kind).toBeTruthy();
      cleanup();
    }
  });

  it('🚨 it is NOT offered for a gable — there is no single downhill direction', () => {
    // A control that appears for an object it cannot describe is the same
    // defect as one that accepts a number and ignores it.
    mount({ ...baseState(), level: 'section', section: measureSection(mainSection(), 2) });
    expect(screen.queryByTestId('inspector-slope-direction')).toBeNull();
  });

  it('an undecided direction says so rather than showing a default', () => {
    const sec = measureSection({ ...mainSection(), kind: 'flat', pitchDeg: 0, shedAzimuthDeg: null }, 1);
    mount({ ...baseState(), level: 'section', section: sec });
    expect(screen.getByTestId('inspector-slope-direction').textContent)
      .toMatch(/Not set yet/i);
  });

  it('pressing a direction reports it in compass degrees', () => {
    const sec = measureSection({ ...mainSection(), kind: 'shed', pitchDeg: 12, shedAzimuthDeg: 180 }, 1);
    const { onSetSlopeAzimuth } = mount({ ...baseState(), level: 'section', section: sec });
    fireEvent.click(screen.getByTestId('inspector-slope-W'));
    expect(onSetSlopeAzimuth).toHaveBeenCalledWith(270);
  });
});

describe('🚨 the section lists its faces and their real pitches', () => {
  it('each face is a row showing degrees and rise:run, and selects that face', () => {
    const s = measureSection({ ...mainSection(), facePitchDeg: { slopeA: 45 } }, 2);
    const { onSelectFace } = mount({ ...baseState(), level: 'section', section: s });

    const rowA = screen.getByTestId('inspector-face-row-slopeA');
    expect(rowA.textContent).toMatch(/Slope A/);
    expect(rowA.textContent).toMatch(/45\.0°/);
    expect(rowA.textContent).toMatch(/12:12/);      // 45 degrees is exactly 12:12
    expect(screen.getByTestId('inspector-face-row-slopeB').textContent).toMatch(/30\.0°/);

    fireEvent.click(rowA);
    expect(onSelectFace).toHaveBeenCalledWith('sec-main::slopeA');

    // And the section says its faces no longer agree, so the ridge is off-centre.
    expect(screen.getByTestId('inspector-mixed-pitch')).toBeTruthy();
  });

  it('a section whose faces agree shows no mixed-pitch warning', () => {
    mount(sectionState());
    expect(screen.queryByTestId('inspector-mixed-pitch')).toBeNull();
  });
});

describe('🚨 a hand-reshaped section says so instead of silently reverting', () => {
  it('the parametric controls go inert and the choice is stated', () => {
    const { onEdit, onRebuildFromParameters } =
      mount({ ...sectionState(), reshapedFaceCount: 2 });

    expect(screen.getByTestId('inspector-reshaped').textContent)
      .toMatch(/reshaped by hand/);
    // Every control that would rebuild from the trace is disabled...
    expect((screen.getByTestId('inspector-eave') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByTestId('inspector-pitch') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByTestId('inspector-ground') as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('inspector-move-east'));
    expect(onEdit).not.toHaveBeenCalled();

    // ...and discarding the reshape takes a deliberate press.
    fireEvent.click(screen.getByTestId('inspector-rebuild-parametric'));
    expect(onRebuildFromParameters).toHaveBeenCalledTimes(1);
  });

  it('an untouched section shows no such banner and its controls work', () => {
    const { onEdit } = mount(sectionState());
    expect(screen.queryByTestId('inspector-reshaped')).toBeNull();
    expect((screen.getByTestId('inspector-eave') as HTMLInputElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId('inspector-move-east'));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});
