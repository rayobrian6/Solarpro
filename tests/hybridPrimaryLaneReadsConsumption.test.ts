// ============================================================================
// THE HYBRID'S PRIMARY METERING LANE IS ONE THAT CAN READ CONSUMPTION.
//
// A site has one service, so one set of consumption CTs; sldCombinerFields
// `hybridLaneMetering` gives them to ONE lane and strips consumption from every
// other metering lane. The review of 2026-09-26 found it picked that lane by
// roof > ground > fence ALONE: a roof lane whose device meters production only
// (its capability provides no consumption channel — the composer's
// `drawing.consumption` is null) became the primary, the ground lane's 5C was
// cut to production only, and the site drew, stated and recorded NO
// consumption CTs. Reachable when two same-brand arrays resolve to different
// devices (`selectedCombinerIdByLane`, which the PDF route passes).
//
// No catalogue device today composes a production-only drawing, so the one
// composer is wrapped here: the IQ Combiner 6C's answer has its consumption
// channel removed — exactly the shape a production-only capability composes.
// (A module mock is file-wide, hence this file of its own.)
// ============================================================================

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { SLDSourceBranch } from '@/lib/sld-professional-renderer';
import { hybridLaneMetering } from '@/lib/equipment/sldCombinerFields';

vi.mock('@/lib/equipment/designMetering', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/equipment/designMetering')>();
  return {
    ...orig,
    resolveDesignMetering: (i: Parameters<typeof orig.resolveDesignMetering>[0]) => {
      const m = orig.resolveDesignMetering(i);
      // MeteringPlanLike types brains without an id; the resolved device carries one.
      if ((i.plan?.brains as { id?: string } | null | undefined)?.id !== 'enphase-iq-combiner-6c' || !m.drawing) return m;
      const leads = (m.drawing.leads ?? []).filter(l => l.channel === 'production');
      return { ...m, drawing: { ...m.drawing, consumption: null, lead: null, scheduleRow: null,
        ...(leads.length ? { leads } : { leads: undefined }) } };
    },
  };
});

let logSpy: ReturnType<typeof vi.spyOn>;
beforeAll(() => { logSpy = vi.spyOn(console, 'log').mockImplementation(() => {}); });
afterAll(() => { logSpy.mockRestore(); });

const enphaseLane = (key: 'roof' | 'ground' | 'fence'): SLDSourceBranch => ({
  key, topologyType: 'MICROINVERTER', systemType: key,
  inverterManufacturer: 'Enphase', inverterModel: 'IQ8M',
  totalModules: 12, deviceCount: 12, panelWatts: 430,
  acOutputKw: 3.96, acOutputAmps: 16.5, backfeedAmps: 25, acOCPD: 25,
  microBranches: [{ branchIndex: 1, deviceCount: 12, branchCurrentA: 16.5, ocpdAmps: 20,
    conductorCallout: '#10 AWG THWN-2', necReference: 'NEC 690.8(B)' }],
});
const run = (byLane: Record<string, string>) => hybridLaneMetering({
  lanes: [enphaseLane('roof'), enphaseLane('ground')],
  selectedCombinerIdByLane: byLane,
  interconnectionRaw: 'LOAD_SIDE', systemVoltage: 240,
});

describe('the primary metering lane is chosen among lanes that READ consumption first', () => {
  it('roof on a production-only device, ground on a 5C: the GROUND lane carries the site\'s consumption CTs', () => {
    const r = run({ roof: 'enphase-iq-combiner-6c', ground: 'enphase-iq-combiner-5c' });
    expect(r.primary?.key).toBe('ground');
    const ground = r.lanes.find(l => l.key === 'ground')!.meteringDrawing!;
    const roof = r.lanes.find(l => l.key === 'roof')!.meteringDrawing!;
    expect(ground.consumption).not.toBeNull();
    expect(ground.consumption).toMatchObject({ ctCount: 2 });
    // The roof keeps what its device reads — production — and nothing more.
    expect(roof.production).toBeTruthy();
    expect(roof.consumption).toBeNull();
    expect(r.metered.map(m => [m.key, m.isPrimary])).toEqual([['roof', false], ['ground', true]]);
    // The page's CT control and CT-1 read the ground lane's answer.
    expect(r.primary!.fields.meteringDrawing?.consumption).toEqual(ground.consumption);
  });

  it('with both lanes able to read consumption, rank decides as before: the roof', () => {
    const r = run({ roof: 'enphase-iq-combiner-5c', ground: 'enphase-iq-combiner-5c' });
    expect(r.primary?.key).toBe('roof');
    expect(r.lanes.find(l => l.key === 'ground')!.meteringDrawing!.consumption).toBeNull();
  });

  it('when no lane can read consumption, rank still names a primary (production only everywhere)', () => {
    const r = run({ roof: 'enphase-iq-combiner-6c', ground: 'enphase-iq-combiner-6c' });
    expect(r.primary?.key).toBe('roof');
    expect(r.lanes.every(l => !l.meteringDrawing?.consumption)).toBe(true);
  });
});
