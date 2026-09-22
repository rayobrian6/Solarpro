/**
 * tests/sldCombinerSheetAuthority.test.ts
 *
 * WHAT THE SHEET IS ALLOWED TO CLAIM ABOUT THE COMBINER.
 *
 * Two defects, both of which put a device nobody chose on a permit drawing with
 * the authority of one somebody did:
 *
 *  1. `sldCombinerFields().combinerSelectionIsDecided` — the shared adapter both
 *     SLD routes call — was COMPUTED AND READ BY NOTHING. "Enphase IQ Combiner
 *     6C" printed identically whether the installer recorded it or whether the
 *     last-resort literal produced it, and that literal is the exact mechanism
 *     that once put a 6C on a 5C job. The renderer now qualifies a derived
 *     device in the vocabulary these sheets already use for a missing answer
 *     ('⚠ INVERTER NOT SELECTED', '⚠ ESS CAPACITY UNRESOLVED').
 *
 *  2. On a hybrid, the ONE project-level selection was stamped onto EVERY micro
 *     lane regardless of brand. `resolveIntegratedEquipment` honours a selection
 *     BEFORE it checks the ecosystem, so an APsystems fence lane came back with
 *     the Enphase device and the drawing labelled that fence "Enphase IQ
 *     Combiner …" — a box that is not on that wall, on a sheet that reaches a
 *     permit office and a BOM.
 *
 * WHY THE 4C IS THE PROBE DEVICE (same reasoning as
 * tests/combinerSelectionPropagation.test.ts): the IQ8 pairing recommends the
 * 5C and the resolver's last resort is the 6C, so a 4C on a sheet can ONLY have
 * arrived by honouring a selection. Asserting on either of the others would pass
 * vacuously down some path.
 */

import { describe, it, expect } from 'vitest';
import {
  COMBINER_NOT_SELECTED,
  acCollectionFromLanes,
  combinerScheduleCell,
  renderSLDProfessional,
  type SLDProfessionalInput,
  type SLDSourceBranch,
} from '@/lib/sld-professional-renderer';
import { sldCombinerFields } from '@/lib/equipment/sldCombinerFields';
import { combinerBasisIsDecided } from '@/lib/combinerSelection/service';

const SELECTED = 'enphase-iq-combiner-4c';
const SELECTED_MODEL = 'IQ Combiner 4C';
const RECOMMENDED_MODEL = 'IQ Combiner 5C';

// ════════════════════════════════════════════════════════════════════
// FINDING 2 — a derived combiner must be visibly qualified.
// ════════════════════════════════════════════════════════════════════

describe('combinerScheduleCell — the schedule row is tri-state', () => {
  it('🚨 a DERIVED device is qualified', () => {
    expect(combinerScheduleCell('Enphase IQ Combiner 6C', false))
      .toBe(`Enphase IQ Combiner 6C  ${COMBINER_NOT_SELECTED}`);
  });

  it('a RECORDED selection is printed unqualified — the sheet may assert it', () => {
    expect(combinerScheduleCell('Enphase IQ Combiner 4C', true)).toBe('Enphase IQ Combiner 4C');
  });

  it('🚨 undefined means the BUILDER did not answer, not that nobody chose', () => {
    // The contract `hasProductionMeter` states on the same input type: a new
    // flag ADDS a statement and never removes one. A planset builder that has
    // not been wired to the adapter must not start printing "not selected" as
    // though it knew.
    expect(combinerScheduleCell('Enphase IQ Combiner 6C')).toBe('Enphase IQ Combiner 6C');
  });
});

describe('🚨 the single-lane sheet consumes combinerSelectionIsDecided', () => {
  const base = {
    projectName: 'Probe', clientName: 'Jane Doe', address: '123 Sunshine Ave',
    designer: 'SolarPro', drawingDate: '2026-09-22', drawingNumber: 'SLD-001', revision: 'A',
    topologyType: 'MICROINVERTER',
    totalModules: 12, totalStrings: 1, panelModel: 'Q.PEAK 430', panelWatts: 430,
    panelVoc: 37.2, panelIsc: 13.9, dcWireGauge: '#10 AWG', dcConduitType: 'EMT', dcOCPD: 20,
    inverterModel: 'IQ8M', inverterManufacturer: 'Enphase',
    acOutputKw: 3.84, acOutputAmps: 16, acWireGauge: '#10 AWG', acConduitType: 'EMT', acOCPD: 20,
    mainPanelAmps: 200, panelBusRating: 200, backfeedAmps: 20,
    utilityName: 'APS', interconnection: 'LOAD_SIDE',
    rapidShutdownIntegrated: true, hasProductionMeter: false, hasBattery: false,
    batteryModel: '', batteryKwh: 0, scale: 'NOT TO SCALE', acWireLength: 60,
    deviceCount: 12, microBranches: [{ ocpdAmps: 20, branchCurrentA: 12.8, deviceCount: 12 }],
    combinerLabel: 'Enphase IQ Combiner 5C', combinerModel: 'Enphase IQ Combiner 5C',
    combinerHasIntegratedGateway: true, combinerProvidesAcDisconnect: false,
  } as unknown as SLDProfessionalInput;

  it('a DERIVED combiner is marked on the drawing and in the schedule', () => {
    // 🚨 THE ASSERTION THAT FAILS ON THE OLD CODE: the field did not exist on
    // the input type and nothing read it, so this string could not appear.
    const svg = renderSLDProfessional({ ...base, combinerSelectionIsDecided: false });
    expect(svg).toContain(COMBINER_NOT_SELECTED);
    expect(svg, 'the derived device is still NAMED — the sheet stays buildable')
      .toContain('Enphase IQ Combiner 5C');
    expect(svg, 'the qualifier must say WHY, not just warn').toMatch(/NOT AN INSTALLER DECISION/);
  });

  it('a RECORDED selection prints with no qualifier at all', () => {
    const svg = renderSLDProfessional({ ...base, combinerSelectionIsDecided: true });
    expect(svg).not.toContain(COMBINER_NOT_SELECTED);
    expect(svg).toContain('Enphase IQ Combiner 5C');
  });

  it('🚨 an unanswered builder renders byte-for-byte as before the field existed', () => {
    // Invariant I-1 in spirit: adding this authority must not silently restyle
    // every sheet built by a path that has not been wired to the adapter yet.
    expect(renderSLDProfessional({ ...base, combinerSelectionIsDecided: undefined }))
      .toBe(renderSLDProfessional({ ...base }));
  });

  it('the adapter\'s own answer drives it end to end', () => {
    // sldCombinerFields is what both SLD routes call. Feed its output straight
    // into the renderer: an unselected project must come out qualified, a
    // selected one must not. This is the link the routes still have to map.
    const derived = sldCombinerFields({
      inverterManufacturer: 'Enphase', inverterModel: 'IQ8M', inverterId: 'enphase-iq8plus',
      isMicro: true, totalDevices: 12, branchCount: 3, hasBattery: false,
    });
    const chosen = sldCombinerFields({
      inverterManufacturer: 'Enphase', inverterModel: 'IQ8M', inverterId: 'enphase-iq8plus',
      isMicro: true, totalDevices: 12, branchCount: 3, hasBattery: false,
      selectedCombinerId: SELECTED,
    });
    expect(derived.combinerSelectionIsDecided).toBe(false);
    expect(chosen.combinerSelectionIsDecided).toBe(true);

    const map = (f: typeof derived) => ({
      ...base,
      combinerLabel: f.combinerLabel, combinerModel: f.combinerModel,
      combinerHasIntegratedGateway: f.combinerHasIntegratedGateway,
      combinerProvidesAcDisconnect: f.combinerProvidesAcDisconnect,
      combinerSelectionIsDecided: f.combinerSelectionIsDecided,
    } as SLDProfessionalInput);

    expect(renderSLDProfessional(map(derived))).toContain(COMBINER_NOT_SELECTED);
    expect(renderSLDProfessional(map(chosen))).not.toContain(COMBINER_NOT_SELECTED);
    expect(renderSLDProfessional(map(chosen))).toContain(SELECTED_MODEL);
  });
});

// ════════════════════════════════════════════════════════════════════
// FINDING 3 — one project selection is not every lane's answer.
// ════════════════════════════════════════════════════════════════════

/** An Enphase micro roof lane + an APsystems micro fence lane. Both are MICRO,
 *  so both take a brand combiner — which is exactly why the brand matters. */
const hybridLanes: SLDSourceBranch[] = [
  {
    key: 'roof', topologyType: 'MICROINVERTER',
    inverterManufacturer: 'Enphase', inverterModel: 'IQ8M',
    totalModules: 12, deviceCount: 12, panelWatts: 430, panelVoc: 37.2, panelIsc: 13.9,
    acOutputKw: 3.84, acOutputAmps: 16, backfeedAmps: 20, acOCPD: 20,
    microBranches: [{ ocpdAmps: 20, branchCurrentA: 12.8, deviceCount: 12 }],
  } as unknown as SLDSourceBranch,
  {
    key: 'fence', topologyType: 'MICROINVERTER',
    inverterManufacturer: 'APsystems', inverterModel: 'DS3-L',
    totalModules: 8, deviceCount: 4, panelWatts: 430, panelVoc: 37.2, panelIsc: 13.9,
    acOutputKw: 3.44, acOutputAmps: 14, backfeedAmps: 20, acOCPD: 20,
    microBranches: [{ ocpdAmps: 20, branchCurrentA: 11.5, deviceCount: 4 }],
  } as unknown as SLDSourceBranch,
];

const laneOf = (plan: ReturnType<typeof acCollectionFromLanes>, key: string) =>
  plan.perSource.find(s => s.key === key)!;

describe('🚨 a lane whose brand does not match the selection must NOT claim it', () => {
  it('the Enphase selection reaches the Enphase lane and stops there', () => {
    const plan = acCollectionFromLanes(hybridLanes, SELECTED);
    expect(laneOf(plan, 'roof').combiner?.model).toBe(SELECTED_MODEL);
    expect(laneOf(plan, 'roof').combinerBasis).toBe('project-selected');

    // 🚨 THE ASSERTION THAT FAILS ON THE OLD CODE: `selectedCombinerId` was
    // passed to every micro lane, and the selection branch of
    // resolveIntegratedEquipment runs BEFORE the ecosystem check — so the
    // APsystems fence lane came back holding the Enphase 4C.
    expect(laneOf(plan, 'fence').combiner?.brand).not.toBe('Enphase');
    expect(laneOf(plan, 'fence').combiner?.model).not.toBe(SELECTED_MODEL);
    expect(laneOf(plan, 'fence').combiner).toBeNull();
  });

  it('…and the lane it cannot answer for reports UNRESOLVED rather than nothing', () => {
    const fence = laneOf(acCollectionFromLanes(hybridLanes, SELECTED), 'fence');
    expect(fence.combinerBasis).toBe('unresolved-default');
    expect(combinerBasisIsDecided(fence.combinerBasis!), 'a lane with no answer is not decided')
      .toBe(false);
  });

  it('a PER-LANE recorded selection is the lane\'s own answer', () => {
    // selected_equipment.subSystems[key] — an answer about THAT array, so it
    // outranks the project-level one and is not brand-filtered against it.
    const plan = acCollectionFromLanes(hybridLanes, SELECTED, { fence: 'enphase-iq-combiner-6c' });
    expect(laneOf(plan, 'roof').combiner?.model).toBe(SELECTED_MODEL);
    expect(laneOf(plan, 'fence').combiner?.model).toBe('IQ Combiner 6C');
    expect(laneOf(plan, 'fence').combinerBasis).toBe('project-selected');
  });

  it('a BROKEN selection still fails loudly on every lane', () => {
    // An id the catalogue cannot resolve has no brand to compare, so it must not
    // be silently withheld — that would be the one outcome worse than the
    // defect: a selection nobody can see is wrong. Empty plan, basis still
    // project-selected, exactly as the single-lane sheet already behaves.
    const plan = acCollectionFromLanes(hybridLanes, 'acme-combiner-9000');
    for (const key of ['roof', 'fence']) {
      expect(laneOf(plan, key).combiner, `${key} must not fall through to a guess`).toBeNull();
      expect(laneOf(plan, key).combinerBasis).toBe('project-selected');
    }
  });

  it('no selection at all leaves each lane on its OWN declared pairing', () => {
    const plan = acCollectionFromLanes(hybridLanes);
    expect(laneOf(plan, 'roof').combiner?.model).toBe(RECOMMENDED_MODEL);
    expect(laneOf(plan, 'roof').combinerBasis).toBe('declared-compatibility');
    expect(laneOf(plan, 'fence').combiner).toBeNull();
  });
});

describe('🚨 the hybrid drawing stops labelling the fence lane with the roof\'s box', () => {
  const hybridInput = (over: Record<string, unknown> = {}): SLDProfessionalInput => ({
    projectName: 'Hybrid', clientName: 'Jane Doe', address: '123 Sunshine Ave',
    designer: 'SolarPro', drawingDate: '2026-09-22', drawingNumber: 'SLD-001', revision: 'A',
    topologyType: 'HYBRID_MULTI_SOURCE',
    totalModules: 20, totalStrings: 1, panelModel: 'Q.PEAK 430', panelWatts: 430,
    panelVoc: 37.2, panelIsc: 13.9, dcWireGauge: '#10 AWG', dcConduitType: 'EMT', dcOCPD: 20,
    inverterModel: 'IQ8M', inverterManufacturer: 'Enphase',
    acOutputKw: 7.28, acOutputAmps: 31, acWireGauge: '#8 AWG', acConduitType: 'EMT', acOCPD: 40,
    mainPanelAmps: 200, panelBusRating: 200, backfeedAmps: 40,
    utilityName: 'APS', interconnection: 'LOAD_SIDE',
    rapidShutdownIntegrated: true, hasProductionMeter: true, hasBattery: false,
    batteryModel: '', batteryKwh: 0, scale: 'NOT TO SCALE', acWireLength: 60,
    sources: hybridLanes,
    ...over,
  } as unknown as SLDProfessionalInput);

  it('the selected Enphase combiner appears ONCE, on the Enphase lane', () => {
    const svg = renderSLDProfessional(hybridInput({ selectedCombinerId: SELECTED }));
    const hits = svg.toUpperCase().split(SELECTED_MODEL.toUpperCase()).length - 1;
    // 🚨 ON THE OLD CODE BOTH LANES CARRIED IT. Each lane prints its combiner
    // nameplate twice (the label under the symbol + the header above it), so
    // one lane is 2 and two lanes was 4.
    expect(hits, 'the Enphase device must not appear on the APsystems lane').toBe(2);
    expect(svg.toUpperCase()).toContain('APSYSTEMS AC COMBINER');
  });

  it('and the lane with no answer is QUALIFIED on the drawing', () => {
    const svg = renderSLDProfessional(hybridInput({ selectedCombinerId: SELECTED }));
    expect(svg).toContain(COMBINER_NOT_SELECTED);
  });

  it('the roof lane itself is not qualified — it WAS chosen', () => {
    // Control: only the unanswered lane is marked. A drawing that warns about
    // everything says nothing.
    const onlyEnphase = renderSLDProfessional(hybridInput({
      selectedCombinerId: SELECTED,
      sources: [hybridLanes[0], { ...(hybridLanes[1] as object), key: 'ground',
        topologyType: 'STRING_INVERTER', inverterManufacturer: 'SolarEdge',
        inverterModel: 'SE7600H', totalStrings: 2 } as unknown as SLDSourceBranch],
    }));
    expect(onlyEnphase.toUpperCase()).toContain(SELECTED_MODEL.toUpperCase());
    expect(onlyEnphase, 'a string lane has no combiner to qualify')
      .not.toContain(COMBINER_NOT_SELECTED);
  });
});
