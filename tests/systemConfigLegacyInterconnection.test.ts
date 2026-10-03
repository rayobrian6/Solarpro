// ═══════════════════════════════════════════════════════════════════════════
// System Config V3 — the interconnection is answered on the service graph, and the legacy
// `config.interconnectionMethod` scalar follows it.
//
// WRITER + CONSUMER LAW. The SLD, BOM and permit routes already project the graph onto that scalar
// (`interconnectionMethodScalar`); the page's mirror must say the SAME thing wherever that projection
// says anything, or the page's compliance and the sheet disagree. Where the server projects nothing
// (manufacturer-integrated, meter collar, unresolved, mixed) the posted scalar is what reaches the
// sheet, so the mirror must never hand those a code article.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { answerServiceRating, answerInterconnection, type AnswerResult } from '@/lib/electrical/systemConfigAnswers';
import { answerMeterCollarPermitted } from '@/lib/electrical/systemConfigUtilityDisconnects';
import { updatePointOfInterconnection, setInterconnection } from '@/lib/electrical/topologyAuthoring';
import { buildRaysIntendedJob } from '@/lib/electrical/fixtures/tesla400aTwoGateway';
import type { PoiRelationship, ServiceTopology } from '@/lib/electrical/serviceTopology';
import { interconnectionRuleOf } from '@/lib/permit/utils/interconnectionRule';
import { pvConnectionSide } from '@/lib/equipment/currentTransformers';
import { isNecEvaluableInterconnection } from '@/lib/electrical-calc';
import {
  legacyInterconnectionToken, legacyInterconnectionMirror, LOAD_SIDE_REMEDIES,
} from '@/lib/electrical/systemConfigLegacyInterconnection';

const ok = (r: AnswerResult): ServiceTopology => { if (r.ok === false) throw new Error(r.refused); return r.topology; };
const house200 = () => ok(answerServiceRating(null, 200));
const answered = (rel: PoiRelationship | 'meter-collar') => ok(answerInterconnection(house200(), rel));
const rays = () => buildRaysIntendedJob().topology;
/** Ray's two points of interconnection, re-classified one by one. */
const raysWith = (a: PoiRelationship, b: PoiRelationship) => {
  const t = rays();
  const [p1, p2] = t.pointsOfInterconnection;
  return updatePointOfInterconnection(updatePointOfInterconnection(t, p1.id, { relationship: a }), p2.id, { relationship: b });
};

const RELATIONSHIPS: PoiRelationship[] = [
  'load-side-busbar', 'load-side-feeder-tap', 'supply-side', 'aggregation-to-supply-side',
  'manufacturer-integrated', 'meter-collar',
];

describe('the graph, as the legacy scalar', () => {
  it('each relationship maps to the scalar its code article (or its absence) calls for', () => {
    expect(RELATIONSHIPS.map(r => [r, legacyInterconnectionToken(answered(r))])).toEqual([
      ['load-side-busbar', 'LOAD_SIDE'],
      ['load-side-feeder-tap', 'LOAD_SIDE'],
      ['supply-side', 'SUPPLY_SIDE_TAP'],
      ['aggregation-to-supply-side', 'SUPPLY_SIDE_TAP'],
      ['manufacturer-integrated', 'MANUFACTURER_INTEGRATED'],
      ['meter-collar', 'METER_COLLAR'],
    ]);
  });

  it('🚨 agrees with the server\'s projection wherever that projection names a value — single and mixed points', async () => {
    const { interconnectionMethodScalar } = await import('@/lib/electrical/loadElectricalProject');
    const cases: ServiceTopology[] = [
      ...RELATIONSHIPS.map(answered),
      ...RELATIONSHIPS.flatMap(a => [...RELATIONSHIPS, 'unresolved' as const].map(b => raysWith(a, b))),
    ];
    let named = 0;
    for (const t of cases) {
      const server = interconnectionMethodScalar(t);
      if (server) { named++; expect(legacyInterconnectionToken(t)).toBe(server.value); }
    }
    expect(named).toBeGreaterThan(10);   // the comparison actually ran
  });

  it('where the server projects nothing, the mirror never names a code article', async () => {
    const { interconnectionMethodScalar } = await import('@/lib/electrical/loadElectricalProject');
    const silent = RELATIONSHIPS.flatMap(a => [...RELATIONSHIPS, 'unresolved' as const].map(b => raysWith(a, b)))
      .filter(t => interconnectionMethodScalar(t) === null);
    expect(silent.length).toBeGreaterThan(0);
    for (const t of silent) {
      const token = legacyInterconnectionToken(t);
      expect(interconnectionRuleOf(token), `${token} cited an NEC article the graph does not name`).toBe('not-established');
      expect(isNecEvaluableInterconnection(token)).toBe(false);
      expect(pvConnectionSide(token)).toBe('unresolved');
    }
  });

  it('mixed articles, or nothing classified, is UNRESOLVED; no point of interconnection at all leaves the scalar alone', () => {
    expect(legacyInterconnectionToken(raysWith('load-side-busbar', 'supply-side'))).toBe('UNRESOLVED');
    expect(legacyInterconnectionToken(raysWith('manufacturer-integrated', 'load-side-busbar'))).toBe('UNRESOLVED');
    expect(legacyInterconnectionToken(raysWith('unresolved', 'unresolved'))).toBe('UNRESOLVED');
    // one classified, one not: the classified one speaks, as the server's projection reads it
    expect(legacyInterconnectionToken(raysWith('load-side-busbar', 'unresolved'))).toBe('LOAD_SIDE');
    expect(house200().pointsOfInterconnection).toHaveLength(0);
    expect(legacyInterconnectionToken(house200())).toBeNull();
    expect(legacyInterconnectionToken(null)).toBeNull();
    // a collar recorded on the interconnection before any point is classified is still a collar
    expect(legacyInterconnectionToken(setInterconnection(house200(), { meterCollarSelected: true }))).toBe('METER_COLLAR');
  });

  it('a withdrawn meter collar (utility says no) leaves the scalar UNRESOLVED, not METER_COLLAR', () => {
    const collar = answered('meter-collar');
    expect(legacyInterconnectionToken(collar)).toBe('METER_COLLAR');
    const withdrawn = ok(answerMeterCollarPermitted(collar, false));
    expect(legacyInterconnectionMirror(withdrawn, 'METER_COLLAR')).toBe('UNRESOLVED');
  });
});

describe('the mirror — what to write after a graph write', () => {
  it('writes the graph\'s token when the scalar says something else, and nothing when it already agrees', () => {
    expect(legacyInterconnectionMirror(answered('load-side-busbar'), 'UNRESOLVED')).toBe('LOAD_SIDE');
    expect(legacyInterconnectionMirror(answered('supply-side'), 'LOAD_SIDE')).toBe('SUPPLY_SIDE_TAP');
    expect(legacyInterconnectionMirror(answered('supply-side'), 'SUPPLY_SIDE_TAP')).toBeNull();
    expect(legacyInterconnectionMirror(answered('manufacturer-integrated'), 'LOAD_SIDE')).toBe('MANUFACTURER_INTEGRATED');
    expect(legacyInterconnectionMirror(house200(), 'LOAD_SIDE')).toBeNull();   // the graph was never asked
  });

  it('🚨 a 120% remedy recorded on a load-side connection is kept — it IS that connection, refined', () => {
    for (const remedy of Object.keys(LOAD_SIDE_REMEDIES)) {
      expect(legacyInterconnectionMirror(answered('load-side-busbar'), remedy), remedy).toBeNull();
      // …but a connection that is no longer load-side does replace it
      expect(legacyInterconnectionMirror(answered('supply-side'), remedy)).toBe('SUPPLY_SIDE_TAP');
    }
  });
});

describe('the page — the scalar follows the graph on the ONE write path', () => {
  const page = readFileSync(`${process.cwd()}/app/engineering/page.tsx`, 'utf8');
  const at = page.indexOf('const writeInterviewAnswer = guardGraphRead(async');
  const body = page.slice(at, page.indexOf('\n  }, () => svcTopologyReadRef.current', at));

  it('writeInterviewAnswer mirrors the interconnection after the graph write, before updateConfig', () => {
    expect(at).toBeGreaterThan(0);
    const write = body.indexOf('const ok = await writeTopology(next, what);');
    const mirror = body.indexOf('legacyInterconnectionMirror(next, config.interconnectionMethod)');
    const commit = body.indexOf('if (Object.keys(patch).length > 0) updateConfig(patch);');
    expect(write).toBeGreaterThan(0);
    expect(mirror, 'Guided [Answer], Answer Next and every dialog write skip the scalar mirror').toBeGreaterThan(write);
    expect(commit).toBeGreaterThan(mirror);
  });

  it('nothing else on the page writes the interconnection scalar beside the graph', () => {
    expect(page).not.toMatch(/updateConfig\(\{\s*interconnectionMethod:\s*'SUPPLY_SIDE_TAP'/);
    expect(page).not.toContain('onLegacyInterconnection={m => updateConfig({ interconnectionMethod: m })}');
  });
});
