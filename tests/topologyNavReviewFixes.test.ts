// ═══════════════════════════════════════════════════════════════════════════
// 🚨 CLOSURE SLICE 1 — REVIEW FIXES (pure: writers, the interview, computeSystem, the page source).
// The route-level half is tests/topologyNavReviewFixes.postgres.test.ts; the clicked half is
// tests/topologyNavReviewFixes.component.test.tsx.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ServiceTopology } from '@/lib/electrical/serviceTopology';
import {
  answerBackup, answerDistribution, answerServiceRating, answerStorageLanding, answerSystemsArrangement,
  answerInterconnection, type AnswerResult,
} from '@/lib/electrical/systemConfigAnswers';
import { answerSystemEquipment, batteryCircuitOf } from '@/lib/electrical/systemConfigSystemEquipment';
import { computeSystem, type ComputedSystemInput } from '@/lib/computed-system';
import { csStringInput } from './goldens/wave0-fixtures';

const PW3 = 'tesla-powerwall-3';
const GW3 = 'tesla-backup-gateway-3';
const ok = (r: AnswerResult): ServiceTopology => { if (r.ok === false) throw new Error(r.refused); return r.topology; };

function raysJob(): ServiceTopology {
  let t = ok(answerServiceRating(null, 400));
  t = ok(answerDistribution(t, 'two-main-panels'));
  t = ok(answerBackup(t, 'whole', { gatewayProductId: GW3, storageProductId: PW3, totalUnits: 4,
    unitsPerPanel: { [t.panels[0].id]: 2, [t.panels[1].id]: 2 } }));
  t = { ...t, solarCoupling: 'dc-coupled-storage' };
  t = ok(answerStorageLanding(t, 'der-aggregation-panel'));
  t = ok(answerSystemsArrangement(t, 'independent-branch'));
  return ok(answerInterconnection(t, 'manufacturer-integrated'));
}

const PAGE = readFileSync(resolve(process.cwd(), 'app/engineering/page.tsx'), 'utf8');

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 one battery circuit, as the graph records it — the owner computeSystem\'s battery run reads', () => {
  it('batteryCircuitOf: the commissioned setting\'s current and OCPD; the LARGEST when systems differ; null without units', () => {
    const t = raysJob();
    expect(batteryCircuitOf(t)).toEqual({ continuousOutputA: 48, ocpdA: 60 });
    let both = t;
    for (const d of t.domains) both = ok(answerSystemEquipment(both, d.id, { outputConfigKw: 7.6 }));
    expect(batteryCircuitOf(both)).toEqual({ continuousOutputA: 31.7, ocpdA: 40 });
    const mixed = ok(answerSystemEquipment(t, t.domains[0].id, { outputConfigKw: 7.6 }));
    expect(batteryCircuitOf(mixed)).toEqual({ continuousOutputA: 48, ocpdA: 60 });
    expect(batteryCircuitOf(ok(answerServiceRating(null, 200)))).toBeNull();
    expect(batteryCircuitOf(null)).toBeNull();
  });

  it('computeSystem: BATTERY_TO_BUI_RUN is protected at the recorded circuit OCPD, the busbar contribution untouched', () => {
    const base = {
      ...csStringInput(), batteryIds: [PW3], batteryCount: 2, batteryBackfeedA: 60, batteryContinuousOutputA: 31.7,
      interconnectionMethod: 'LOAD_SIDE', panelBusRating: 400, mainPanelAmps: 400,
    } as ComputedSystemInput;
    const run = (input: ComputedSystemInput) => computeSystem(input).runs.find(r => r.id === 'BATTERY_TO_BUI_RUN');
    expect(run({ ...base, batteryCircuitOcpdA: 40 })!.ocpdAmps).toBe(40);
    expect(run({ ...base, batteryCircuitOcpdA: 40 })!.continuousCurrent).toBe(31.7);
    // Without a recorded circuit the run keeps the caller's figure, as before.
    expect(run(base)!.ocpdAmps).toBe(60);
  });

  it('the page sizes its own battery run from the graph\'s circuit before the catalogue maximum (both payloads)', () => {
    const live = PAGE.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    const runPayload = live.slice(live.indexOf('batteryContinuousOutputA: includePoi && config.batteryId'),
      live.indexOf('generatorOutputBreakerA: includePoi'));
    expect(runPayload).toContain('batteryCircuitOf(svcTopology)?.continuousOutputA');
    expect(runPayload).toContain('batteryCircuitOcpdA: includePoi && config.batteryId ? batteryCircuitOf(svcTopology)?.ocpdA');
    const calcAt = live.indexOf('batteryCount: config.batteryCount || 0,');
    const calc = live.slice(calcAt, live.indexOf('batteryModel: config.batteryModel', calcAt));
    expect(calc).toContain('batteryCircuitOf(svcTopology)?.continuousOutputA');
  });
});
