/**
 * @vitest-environment jsdom
 *
 * tests/obstructionEvidenceIsNotMisattributed.test.tsx
 *
 * ONE SLOT PER CATEGORY, AGAINST AN INSTRUCTION DEMANDING ONE PHOTO PER ITEM.
 *
 * The obstruction slot's own on-screen hint reads "Each obstruction, one photo
 * per item". The app then physically prevented it: `PhotoSlot.handleClick`
 * returns early when `url` is set, and StepPhotos renders exactly one slot per
 * category, so after the first obstruction photo the slot was INERT — tapping it
 * did nothing, with no error and no explanation. A roof with a chimney, an HVAC
 * unit and two vents shipped ONE obstruction photo.
 *
 * And the evidence mapper then labelled that photo with `obstructions[0].type` —
 * whatever happened to sit first in the Step-4 list. So the single photo could be
 * attributed to the wrong obstruction outright: an engineer reads "chimney"
 * against a photograph of a vent, with nothing on the sheet to contradict it.
 *
 * TWO REPAIRS, TESTED SEPARATELY:
 *   - the CAPTURE side (PhotoSlot) gains `repeatable`, so a category whose
 *     instruction needs several photos can render several slots plus an
 *     "Add another" tile. Rendered in jsdom and clicked.
 *   - the EVIDENCE side (lib/engineering/surveyEvidence.ts) stops guessing: it
 *     labels a photo only when the attribution is unambiguous — a link to one
 *     obstruction, or a survey that has exactly one.
 *
 * NOT FIXED HERE, AND REPORTED AS A HANDOFF: StepPhotos (which renders the slots)
 * and the `obstructionId` field on SurveyPhoto / SurveyPhotoRef are outside this
 * lane's file set. This suite pins the two halves that are in it, and the
 * evidence-side lookup is already written against `obstructionId` so it starts
 * working the moment the field lands.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { normalizeSurvey } from '@/lib/siteSurvey/normalizeSurvey';
import { enrichSurvey } from '@/lib/siteSurvey/enrichSurvey';
import type { RawSurveyPayload } from '@/lib/siteSurvey/types';
import { collectEngineeringSurveyEvidence, resolveObstructionType } from '@/lib/engineering/surveyEvidence';
import { PhotoSlot, PHOTO_SLOT_META } from '@/components/survey/ui/PhotoSlot';

// ── Survey fixtures, built through the REAL normalize/enrich pipeline ────────

function obstruction(id: string, type: string, latOffset: number) {
  return {
    id,
    type,
    position: { lat: 34.05 + latOffset, lng: -118.24 },
    dimensions: { widthFt: 3, lengthFt: 3, heightFt: 4 },
  };
}

function rawSurvey(obstructions: unknown[], photos: unknown[]): RawSurveyPayload {
  return {
    id: 'survey-obstruction-001',
    projectId: 'project-obstruction-001',
    location: { lat: 34.05, lng: -118.24, address: '1 Obstruction Way' },
    systemType: 'roof',
    geometry: {
      roofPlanes: [{
        id: 'roof-1', pitch: 22, azimuth: 180, area: 700,
        vertices: [
          { lat: 34.05, lng: -118.24 }, { lat: 34.0502, lng: -118.24 },
          { lat: 34.0502, lng: -118.2404 }, { lat: 34.05, lng: -118.2404 },
        ],
      }],
      obstructions: obstructions as never,
      setbacks: [{ edges: ['eave', 'rake'], distanceIn: 36 }],
      usableAreaSqFt: 500,
    },
    structural: {
      rafterSpacingIn: 24, rafterSize: '2x6', deckingThicknessIn: 0.5,
      roofMaterial: 'composition_shingle', roofPitch: 'standard',
      roofCondition: 'good', atticAccess: true,
    },
    electrical: {
      mainPanelRatingAmps: 200, busbarRatingAmps: 200, breakerSpacesAvailable: 4,
      meterType: 'standard', interconnectionPoint: 'main_panel',
      panelBrand: 'siemens', serviceEntrance: 'overhead',
    },
    photos: photos as never,
  } as RawSurveyPayload;
}

function obstructionEvidence(obstructions: unknown[], photos: unknown[]) {
  const survey = enrichSurvey(normalizeSurvey(rawSurvey(obstructions, photos)));
  const collected = collectEngineeringSurveyEvidence(survey, { normalizedAt: '2026-01-01T00:00:00.000Z' });
  return {
    survey,
    obstructionPhotos: collected.photos.filter((p) => p.category === 'obstructions'),
  };
}

const PHOTO = (slotKey: string, extra: Record<string, unknown> = {}) => ({
  slotKey, url: `https://cdn.example.com/${slotKey}.jpg`, category: 'obstruction', ...extra,
});

// ── The evidence side ───────────────────────────────────────────────────────

describe('an obstruction photo is never labelled with a guess', () => {
  it('four obstructions, one photo: NO type is claimed', () => {
    const { survey, obstructionPhotos } = obstructionEvidence(
      [
        obstruction('o1', 'chimney', 0),
        obstruction('o2', 'hvac', 0.0001),
        obstruction('o3', 'vent_pipe', 0.0002),
        obstruction('o4', 'vent_pipe', 0.0003),
      ],
      [PHOTO('obstruction')],
    );

    // The fixture really did survive normalisation — otherwise this test would be
    // asserting against an empty list and would pass for the wrong reason.
    expect(survey.geometry.obstructions).toHaveLength(4);
    expect(survey.geometry.obstructions[0].type).toBe('chimney');
    expect(obstructionPhotos.length).toBeGreaterThan(0);

    // 🚨 Every one of these used to read 'chimney' — the first list entry — for a
    // photograph that could just as easily have been the HVAC unit or a vent.
    for (const photo of obstructionPhotos) {
      expect(photo.extracted?.obstructionType).toBeUndefined();
    }
  });

  it('exactly one obstruction: the attribution IS unambiguous, so it is made', () => {
    const { obstructionPhotos } = obstructionEvidence(
      [obstruction('o1', 'skylight', 0)],
      [PHOTO('obstruction')],
    );
    expect(obstructionPhotos.length).toBeGreaterThan(0);
    // Saying nothing here would lose real information: there is only one thing the
    // photo can be of.
    expect(obstructionPhotos.some((p) => p.extracted?.obstructionType === 'skylight')).toBe(true);
  });

  it('no obstructions at all: nothing claimed, and no crash', () => {
    const { obstructionPhotos } = obstructionEvidence([], [PHOTO('obstruction')]);
    for (const photo of obstructionPhotos) {
      expect(photo.extracted?.obstructionType).toBeUndefined();
    }
  });

  it('an END-TO-END link is NOT yet carried: normalizeSurvey drops the field', () => {
    // 🚨 A MEASURED LIMIT, RECORDED SO NOBODY THINKS THE LINK ALREADY WORKS.
    //
    // This assertion was written the other way round first — expecting 'vent_pipe'
    // — and it FAILED. `normalizeSurvey`'s photo mapper (~:652) is an explicit
    // whitelist of slotKey/url/category/capturedAt/notes, so an `obstructionId` on
    // the raw payload never reaches the enriched survey. The handoff is therefore
    // three files, not one; see the note on `resolveObstructionType`.
    //
    // What the pipeline must NOT do meanwhile is fall back to guessing, and that
    // is what is asserted here: an unresolvable link yields no label.
    const { obstructionPhotos } = obstructionEvidence(
      [
        obstruction('o1', 'chimney', 0),
        obstruction('o2', 'hvac', 0.0001),
        obstruction('o3', 'vent_pipe', 0.0002),
        obstruction('o4', 'skylight', 0.0003),
      ],
      [PHOTO('obstruction', { obstructionId: 'o3' })],
    );
    expect(obstructionPhotos.length).toBeGreaterThan(0);
    for (const photo of obstructionPhotos) {
      expect(photo.extracted?.obstructionType).toBeUndefined();
    }
  });
});

// ── The link rule itself, unit-tested ahead of the wiring ───────────────────

describe('resolveObstructionType', () => {
  const four = enrichSurvey(normalizeSurvey(rawSurvey(
    [
      obstruction('o1', 'chimney', 0),
      obstruction('o2', 'hvac', 0.0001),
      obstruction('o3', 'vent_pipe', 0.0002),
      obstruction('o4', 'skylight', 0.0003),
    ],
    [],
  )));

  it('a link resolves to THAT obstruction, never the first', () => {
    expect(four.geometry.obstructions).toHaveLength(4);
    expect(resolveObstructionType(four, 'o3')).toBe('vent_pipe');
    expect(resolveObstructionType(four, 'o4')).toBe('skylight');
    // 🚨 The old behaviour, in one line: every one of these returned 'chimney'.
    expect(resolveObstructionType(four, 'o3')).not.toBe('chimney');
  });

  it('a dangling link claims nothing — an id that does not resolve is not a licence to guess', () => {
    expect(resolveObstructionType(four, 'does-not-exist')).toBeUndefined();
  });

  it('no link and several obstructions claims nothing', () => {
    expect(resolveObstructionType(four, undefined)).toBeUndefined();
    expect(resolveObstructionType(four, null)).toBeUndefined();
  });

  it('no link and exactly one obstruction is unambiguous', () => {
    const one = enrichSurvey(normalizeSurvey(rawSurvey([obstruction('o1', 'dormer', 0)], [])));
    expect(resolveObstructionType(one, undefined)).toBe('dormer');
  });
});

// ── The capture side ────────────────────────────────────────────────────────

describe('the repeatable categories are the ones whose instruction needs repeats', () => {
  it('obstruction and additional are repeatable; the single-subject slots are not', () => {
    const byCategory = new Map(PHOTO_SLOT_META.map((m) => [m.category, m]));
    expect(byCategory.get('obstruction')?.repeatable).toBe(true);
    expect(byCategory.get('additional')?.repeatable).toBe(true);
    // 🚨 These must NOT become repeatable: there is one main panel and one meter,
    // and duplicating their slots would invite the crew to photograph the same
    // subject twice while the required-count header stayed at 5.
    for (const c of ['main_panel_open', 'main_panel_closed', 'meter', 'roof_overview', 'service_entrance'] as const) {
      expect(byCategory.get(c)?.repeatable).toBeFalsy();
    }
  });

  it('the obstruction hint still demands one photo per item, which is now possible', () => {
    const meta = PHOTO_SLOT_META.find((m) => m.category === 'obstruction')!;
    expect(meta.hint).toMatch(/one photo per item/i);
    expect(meta.repeatable).toBe(true);
  });
});

describe('an "add another" slot is live even when siblings are filled', () => {
  const meta = PHOTO_SLOT_META.find((m) => m.category === 'obstruction')!;

  it('renders as a capturable tile labelled "Add another Obstruction"', () => {
    const onCapture = vi.fn();
    render(
      <>
        <PhotoSlot meta={meta} index={1} url="https://cdn.example.com/a.jpg" onCapture={onCapture} onRemove={() => {}} />
        <PhotoSlot meta={meta} index={2} url="https://cdn.example.com/b.jpg" onCapture={onCapture} onRemove={() => {}} />
        <PhotoSlot meta={meta} addAnother onCapture={onCapture} onRemove={() => {}} />
      </>,
    );

    // The filled tiles are numbered, so the crew can see which obstruction each is.
    expect(screen.getByAltText('Obstruction 1')).toBeTruthy();
    expect(screen.getByAltText('Obstruction 2')).toBeTruthy();

    // 🚨 And the third tile is an ACTIVE capture control. Under the old component
    // there was no such tile at all: the single slot went to its filled branch,
    // which renders a plain div with no click handler, so the crew's tap landed on
    // nothing.
    const add = screen.getByLabelText('Capture Add another Obstruction');
    expect(add).toBeTruthy();
    expect((add as HTMLButtonElement).disabled).toBe(false);
  });

  it('a FILLED repeatable tile still refuses re-capture, which is correct', () => {
    // Replacing a photo is what the remove button is for. This asserts the
    // repeatable change did not make filled tiles re-enter capture.
    render(<PhotoSlot meta={meta} index={1} url="https://cdn.example.com/a.jpg" onCapture={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.queryByLabelText(/^Capture /)).toBeNull();
    expect(screen.getByLabelText('Remove Obstruction 1')).toBeTruthy();
  });

  it('a single-subject slot keeps its plain label', () => {
    cleanup();
    const single = PHOTO_SLOT_META.find((m) => m.category === 'meter')!;
    render(<PhotoSlot meta={single} onCapture={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByLabelText('Capture Meter')).toBeTruthy();
  });
});
