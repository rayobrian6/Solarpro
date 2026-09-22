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
    level: 'none', section: null, face: null, faceSectionLabel: null,
    sectionCount: 0, standaloneFaceCount: 0, refusal: null,
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
  render(
    <SectionInspector
      state={state}
      onEdit={onEdit}
      onSelectLevel={onSelectLevel}
      onNudgeFace={onNudgeFace}
      onClearSelection={onClearSelection}
      onDismissRefusal={onDismissRefusal}
      {...overrides}
    />,
  );
  return { onEdit, onSelectLevel, onNudgeFace, onClearSelection, onDismissRefusal };
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
    expect((screen.getByTestId('inspector-pitch') as HTMLInputElement).value).toBe('30');
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
