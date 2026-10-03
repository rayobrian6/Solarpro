// ═══════════════════════════════════════════════════════════════════════════
// THE CANONICAL ELECTRICAL RUN — lib/electrical/electricalRuns.ts.
//
// Ray: "60 A breaker → #6 / 200 A breaker → 3/0 and then print that like engineered truth" is the
// defect. The chain is FACTS → CANONICAL RUN → SIZING ENGINE → ENGINEERED RESULT → every consumer.
// These tests pin the engine against hand calculations from the NEC tables, and pin that a missing
// input produces NOT EVALUATED naming the input — never a conductor.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { buildRaysIntendedJob, buildTesla400ATwoGateway } from '@/lib/electrical/fixtures/tesla400aTwoGateway';
import { buildNormalResidence200A } from '@/lib/electrical/fixtures/normalResidence200a';
import type { ServiceTopology } from '@/lib/electrical/serviceTopology';
import {
  deriveServiceRuns, engineerRun, engineerServiceRuns, runEnvironmentFrom, runCallout,
  runScheduleCells, runReadiness, runConductorText,
  type EngineeredRun, type RunSpec,
} from '@/lib/electrical/electricalRuns';

const IL_EMT = runEnvironmentFrom({ state: 'IL', racewayType: 'EMT' });   // ASHRAE 2 % high 33 °C → 0.96
const AZ_EMT = runEnvironmentFrom({ state: 'AZ', racewayType: 'EMT' });   // 43 °C → 0.87
const ray = (): ServiceTopology => buildRaysIntendedJob().topology;
const byId = (runs: EngineeredRun[], id: string) => {
  const r = runs.find(x => x.id === id);
  if (!r) throw new Error(`no run ${id} in ${runs.map(x => x.id).join(', ')}`);
  return r;
};
const ess1 = 'der-circuit:agg-1:agg-1-in-1';
const gen1 = 'generation-feeder:agg-1';
const backupA = 'backup-feeder:domain-a:msp-1';

describe('Ray\'s job — the runs are the conductors that exist, terminal to terminal', () => {
  const runs = engineerServiceRuns(ray(), IL_EMT);

  it('four PW3 circuits, two generation feeders, two backup feeders, two branch feeders split at each isolation switch', () => {
    expect(runs.map(r => r.id)).toEqual([
      'der-circuit:agg-1:agg-1-in-1', 'der-circuit:agg-1:agg-1-in-2', 'generation-feeder:agg-1',
      'der-circuit:agg-2:agg-2-in-1', 'der-circuit:agg-2:agg-2-in-2', 'generation-feeder:agg-2',
      'backup-feeder:domain-a:msp-1', 'backup-feeder:domain-b:msp-2',
      'branch-feeder:branch-a:1', 'branch-feeder:branch-a:2',
      'branch-feeder:branch-b:1', 'branch-feeder:branch-b:2',
    ]);
  });

  it('each run names the terminal it leaves and the terminal it lands on — never a box', () => {
    const ends = (id: string) => {
      const r = byId(runs, id);
      return `${r.source.deviceLabel} [${r.source.terminalId}] → ${r.destination.deviceLabel} [${r.destination.terminalId}]`;
    };
    expect(ends(ess1)).toBe('Tesla Powerwall 3 #1 [BATTERY_AC] → Generation panel — System 1 [BRANCH:agg-1-in-1]');
    expect(ends(gen1)).toBe('Generation panel — System 1 [MAIN] → Tesla Backup Gateway 3 — System 1 [DER_IN]');
    expect(ends(backupA)).toBe('Tesla Backup Gateway 3 — System 1 [LOAD_OUT] → MSP #1 [MAIN]');
    expect(ends('branch-feeder:branch-a:1')).toBe('the 400 A service distribution [FEEDER:branch-a] → Utility isolation switch — 200 A service path 1 [LINE]');
    expect(ends('branch-feeder:branch-a:2')).toBe('Utility isolation switch — 200 A service path 1 [LOAD] → Tesla Backup Gateway 3 — System 1 [GRID_IN]');
  });

  it('🚨 the 60 A PW3 circuit is #4, not #6: 110.14(C)(1)(a) puts an unlisted ≤ 100 A termination on the 60 °C column', () => {
    // 48 A × 1.25 = 60 A against the 60 °C column: #6 = 55 A ✗, #4 = 70 A ✓. (wireGaugeForOcpd(60)
    // says #6 — the 75 °C column, which needs BOTH terminations listed for 75 °C.)
    const r = byId(runs, ess1);
    expect(r.conductor.size).toBe('#4 AWG');
    expect(r.conductor.terminalTempC).toBe(60);
    expect(r.conductor.allowableAmpacityA).toBe(70);
    expect(r.conductor.requiredAmpacityA).toBe(60);
    expect(r.conductor.egcSize).toBe('#10 AWG');
    expect(r.conductor.terminalBasis).toContain('NEC 110.14(C)(1)(a)');
    expect(r.conductor.terminalBasis).toContain('terminal listing not recorded');
  });

  it('with BOTH terminations recorded as 75 °C the same circuit is #6 — the engine reads the listing, not the breaker', () => {
    const t = ray();
    t.aggregationPanels = t.aggregationPanels.map(a => ({ ...a, productId: 'listed-gen-panel' }));
    const env = runEnvironmentFrom({
      state: 'IL', racewayType: 'EMT',
      terminalFacts: {
        'tesla-powerwall-3': { acTerminalTempC: 75, basis: 'test listing' },
        'listed-gen-panel': { acTerminalTempC: 75, basis: 'test listing' },
      },
    });
    const r = byId(engineerServiceRuns(t, env), ess1);
    expect(r.conductor.size).toBe('#6 AWG');   // 65 A @ 75 °C ≥ 60 A; 75 A × 0.96 = 72 A ≥ 48 A
    expect(r.conductor.terminalTempC).toBe(75);
    // ONE end listed is not enough: the lower termination governs.
    const oneEnd = runEnvironmentFrom({ state: 'IL', racewayType: 'EMT', terminalFacts: { 'tesla-powerwall-3': { acTerminalTempC: 75 } } });
    expect(byId(engineerServiceRuns(t, oneEnd), ess1).conductor.size).toBe('#4 AWG');
  });

  it('the generation feeder carries 2 × 48 A: 120 A against the 75 °C column (125 A circuit) → #1, #6 EGC', () => {
    const r = byId(runs, gen1);
    expect(r.continuousCurrentA).toBe(96);
    expect(r.conductor.requiredAmpacityA).toBe(120);
    expect(r.conductor.terminalTempC).toBe(75);
    expect(r.conductor.size).toBe('#1 AWG');
    expect(r.conductor.egcSize).toBe('#6 AWG');
  });

  it('the backup feeder: 3/0 + 3/0 N + #6 EGC in 2" EMT (25.5 % fill), under NEC 705.12(B)(1)(b)', () => {
    const r = byId(runs, backupA);
    expect(runCallout(r)).toEqual(['2 #3/0 CU THWN-2 + #3/0 N + #6 EGC', '2" EMT', '200 A OCPD']);
    expect(r.evaluationStatus).toBe('ENGINEERED');
    expect(r.raceway.fillPct).toBe(25.5);                 // (3 × 0.2679 + 0.0507) / 3.356
    expect(r.conductor.necReferences).toContain('NEC 705.12(B)(1)(b)');
    expect(r.provenance.join(' | ')).toContain('the main breaker in MSP #1 (200 A) protects the feeder at its load end');
  });

  it('🚨 the PW3 circuits do not invent a neutral: conductors are engineered, the raceway waits on the manufacturer fact', () => {
    const r = byId(runs, ess1);
    expect(runCallout(r)).toEqual(['2 #4 CU THWN-2 + #10 EGC', 'NEUTRAL / RACEWAY — INPUT REQUIRED', '60 A OCPD']);
    expect(r.evaluationStatus).toBe('NOT_EVALUATED');
    expect(r.raceway.status).toBe('NOT_EVALUATED');
    expect(r.missingInputs.map(m => m.key)).toContain('neutral');
  });

  it('a recorded neutral resolves the circuit AND the generation feeder that carries it', () => {
    const env = runEnvironmentFrom({
      state: 'IL', racewayType: 'EMT',
      terminalFacts: { 'tesla-powerwall-3': { acNeutral: 'required', basis: 'test manual' } },
    });
    const rs = engineerServiceRuns(ray(), env);
    // 3 × 0.0824 + 0.0211 = 0.2683 in² > 40 % of 3/4" (0.2132) → 1" (31.1 %).
    expect(runCallout(byId(rs, ess1))).toEqual(['2 #4 CU THWN-2 + #4 N + #10 EGC', '1" EMT', '60 A OCPD']);
    expect(byId(rs, ess1).raceway.fillPct).toBe(31.1);
    // 3 × 0.1562 + 0.0507 = 0.5193 in² → 1-1/4" (34.7 %).
    expect(runCallout(byId(rs, gen1))).toEqual(['2 #1 CU THWN-2 + #1 N + #6 EGC', '1-1/4" EMT', '125 A OCPD']);
    expect(byId(rs, gen1).raceway.fillPct).toBe(34.7);
  });
});

describe('the engine considers every input, not the breaker', () => {
  it('🚨 ambient correction: in Arizona (43 °C → 0.87) the backup feeder is 4/0; the branch feeder may stay 3/0 by 240.4(B)', () => {
    const rs = engineerServiceRuns(ray(), AZ_EMT);
    // 3/0: 225 A × 0.87 = 195.75 A < the 200 A load-end main, which 705.12(B)(1)(b) requires the
    // feeder to carry → 4/0 (260 × 0.87 = 226.2 A).
    expect(byId(rs, backupA).conductor.size).toBe('#4/0 AWG');
    expect(byId(rs, backupA).conductor.allowableAmpacityA).toBe(226.2);
    // The branch feeder is protected by its own 200 A OCPD only: 195.75 A is not a standard rating
    // and 200 A is the next one above it (240.4(B)).
    expect(byId(rs, 'branch-feeder:branch-a:1').conductor.size).toBe('#3/0 AWG');
  });

  it('705.12(B)(1)(a): with no main breaker at the load end, the feeder must carry 200 A + 125 % × 96 A = 320 A', () => {
    const t = ray();
    t.panels = t.panels.map(p => (p.id === 'msp-1' ? { ...p, mainBreakerA: null } : p));
    const r = byId(engineerServiceRuns(t, IL_EMT), backupA);
    expect(r.conductor.status).toBe('NOT_EVALUATED');      // > 4/0 Cu (230 A): outside the engine
    expect(r.provenance.join(' | ')).toContain('200 A + 125 % × 96 A DER = 320 A');
    expect(r.missingInputs.map(m => m.key)).toContain('table-range');
    expect(runCallout(r)).toEqual(['200 A BACKUP FEEDER', 'CONDUCTORS / RACEWAY — NOT EVALUATED']);
  });

  it('a backup feeder whose storage landing nobody has stated, with no main at the load end, is NOT EVALUATED naming both', () => {
    const t = buildTesla400ATwoGateway({ powerwallsPerSystem: 2, expansionsPerSystem: 0, storageConnection: 'unresolved' }).topology;
    t.panels = t.panels.map(p => ({ ...p, mainBreakerA: null }));
    const r = byId(engineerServiceRuns(t, IL_EMT), backupA);
    expect(r.conductor.status).toBe('NOT_EVALUATED');
    expect(r.missingInputs.find(m => m.key === 'load-end-ocpd')?.need)
      .toBe('the main breaker in MSP #1, or where the storage lands — NEC 705.12(B)(1)');
  });

  it('voltage drop over a recorded length: 100 ft keeps #4 (1.23 %); 200 ft upsizes to #3 and the EGC follows (250.122(B))', () => {
    const at = (ft: number) => byId(engineerServiceRuns(ray(), runEnvironmentFrom({
      state: 'IL', racewayType: 'EMT', runLengthsFt: { [ess1]: ft },
    })), ess1);
    const short = at(100);                                     // 2 × 48 × 0.308 × 100 / 1000 / 240
    expect(short.conductor.size).toBe('#4 AWG');
    expect(short.voltageDrop).toMatchObject({ status: 'ENGINEERED', pct: 1.23, pass: true, lengthFt: 100 });
    const long = at(200);                                      // #4: 2.46 % > 2 % → #3: 1.96 %
    expect(long.conductor.size).toBe('#3 AWG');
    expect(long.conductor.upsizedForVoltageDrop).toBe(true);
    expect(long.voltageDrop.pct).toBe(1.96);
    expect(long.conductor.egcSize).toBe('#8 AWG');             // 10 380 × 52 620 / 41 740 = 13 086 cmil → #8
    expect(long.conductor.necReferences).toContain('NEC 250.122(B)');
  });

  it('240.4(D): a 40 A circuit never lands on #10, even where every ampacity check would pass', () => {
    const spec: RunSpec = {
      id: 'synthetic', role: 'der-circuit', name: 'DER AC CIRCUIT',
      source: { deviceId: 'u', terminalId: 'AC_OUT', deviceLabel: 'Unit', productId: 'u90' },
      destination: { deviceId: 'p', terminalId: 'BRANCH:u', deviceLabel: 'Panel', productId: 'p90' },
      currentBasis: 'der-continuous', continuousCurrentA: 24, ocpdA: 40, ocpdLabel: 'its breaker',
      hotCount: 2, neutral: 'not-required', nominalVoltageV: 240, phaseConfiguration: '120/240 V split phase',
      voltageDropCurrentA: 24,
    };
    // Both ends listed 90 °C, ambient 26 °C (factor 1.00): #10 = 40 A ≥ 40 A and ≥ 30 A — only 240.4(D) refuses it.
    const env = runEnvironmentFrom({ state: 'AK', racewayType: 'EMT', terminalFacts: { u90: { acTerminalTempC: 90 }, p90: { acTerminalTempC: 90 } } });
    expect(engineerRun(spec, env).conductor.size).toBe('#8 AWG');
  });
});

describe('🚨 a missing input is NOT EVALUATED and named — never a fabricated size', () => {
  it('no project location → no ambient → no conductor on any run, and the callout says so', () => {
    const rs = engineerServiceRuns(ray(), runEnvironmentFrom({ racewayType: 'EMT' }));
    expect(rs.every(r => r.conductor.size === null && r.conductor.status === 'NOT_EVALUATED')).toBe(true);
    expect(runCallout(byId(rs, backupA))).toEqual(['200 A BACKUP FEEDER', 'CONDUCTORS / RACEWAY — NOT EVALUATED']);
    expect(runCallout(byId(rs, ess1))).toEqual(['60 A ESS AC CIRCUIT', 'CONDUCTORS / RACEWAY — NOT EVALUATED']);
    expect(runReadiness(rs).blocking.find(i => i.key === 'ambient')?.need)
      .toBe('the site design temperature — the project location (state) is not established');
  });

  it('no raceway type recorded → conductors engineered, raceway not', () => {
    const r = byId(engineerServiceRuns(ray(), runEnvironmentFrom({ state: 'IL' })), backupA);
    expect(runCallout(r)).toEqual(['2 #3/0 CU THWN-2 + #3/0 N + #6 EGC', 'RACEWAY — INPUT REQUIRED', '200 A OCPD']);
    expect(r.raceway).toMatchObject({ status: 'NOT_EVALUATED', tradeSize: null, fillPct: null });
  });

  it('the controller\'s main breaker not recorded → its backup feeder is not sized, and readiness names the breaker', () => {
    const t = ray();
    t.domains = t.domains.map(d => (d.id === 'domain-a' ? { ...d, gateway: { ...d.gateway, mainBreakerA: null } } : d));
    const rs = engineerServiceRuns(t, IL_EMT);
    expect(byId(rs, backupA).conductor.size).toBeNull();
    expect(byId(rs, 'backup-feeder:domain-b:msp-2').conductor.size).toBe('#3/0 AWG');
    expect(runReadiness(rs).blocking.find(i => i.key === 'ocpd')).toEqual({
      key: 'ocpd',
      need: 'the main breaker fitted in Tesla Backup Gateway 3 — System 1 — rating not recorded',
      runs: ['Tesla Backup Gateway 3 — System 1 → MSP #1'],
    });
  });

  it('a unit whose continuous output is not recorded leaves its circuit and its generation feeder unsized', () => {
    const t = ray();
    const first = t.storage.find(u => u.role === 'inverter-unit')!;
    t.storage = t.storage.map(u => (u.id === first.id ? { ...u, continuousOutputA: null } : u));
    const rs = engineerServiceRuns(t, IL_EMT);
    expect(byId(rs, ess1).conductor.size).toBeNull();
    expect(byId(rs, gen1).conductor.size).toBeNull();
    expect(byId(rs, 'der-circuit:agg-1:agg-1-in-2').conductor.size).toBe('#4 AWG');
  });

  it('readiness lists each missing fact ONCE with the runs waiting on it', () => {
    const rd = runReadiness(engineerServiceRuns(ray(), IL_EMT));
    expect(rd.engineered).toBe(6);
    expect(rd.notEvaluated).toBe(6);
    expect(rd.blocking).toHaveLength(1);
    expect(rd.blocking[0].need).toBe('Tesla Powerwall 3 — whether its AC terminals take a neutral (manufacturer installation manual)');
    expect(rd.blocking[0].runs).toHaveLength(6);   // four circuits + the two feeders that carry them
    expect(rd.voltageDrop.find(i => i.key === 'run-length')?.runs).toHaveLength(12);
  });
});

describe('other landings', () => {
  it('storage in the controller\'s own panelboard: the circuit lands on DER_IN and the backup feeder sees the DER at its supply end', () => {
    const t = buildTesla400ATwoGateway({ powerwallsPerSystem: 2, expansionsPerSystem: 0, outputConfigKw: 11.5, storageConnection: 'gateway-panelboard' }).topology;
    const rs = engineerServiceRuns(t, IL_EMT);
    const circuits = rs.filter(r => r.role === 'der-circuit');
    expect(circuits).toHaveLength(4);
    expect(circuits.every(c => c.destination.terminalId === 'DER_IN')).toBe(true);
    const fs = deriveServiceRuns(t).find(r => r.id === backupA)!.feederSources!;
    expect(fs).toMatchObject({ derContinuousA: 96, noDer: false, loadEndOcpdA: 200 });
  });

  it('storage on the backed-up panel\'s busbar: the circuit lands in that panel\'s branch space', () => {
    const t = buildNormalResidence200A({ storageConnection: 'backed-up-panel-busbar' }).topology;
    const c = deriveServiceRuns(t).filter(r => r.role === 'der-circuit');
    expect(c).toHaveLength(1);
    expect(c[0].destination.deviceId).toBe('msp-1');
    expect(c[0].destination.terminalId).toBe(`BRANCH:${c[0].source.deviceId}`);
  });
});

describe('one wording, one result', () => {
  it('the schedule cells are the callout\'s words', () => {
    for (const r of engineerServiceRuns(ray(), IL_EMT)) {
      const cells = runScheduleCells(r);
      const callout = runCallout(r);
      if (runConductorText(r)) expect(callout[0]).toBe(cells.conductors);
      else expect(cells.conductors).toBe('NOT EVALUATED');
    }
  });

  it('🚨 the engine never uses the breaker-to-gauge shortcut', () => {
    const src = readFileSync('lib/electrical/electricalRuns.ts', 'utf8');
    expect(src).not.toMatch(/wireGaugeForOcpd\s*\(/);
    expect(src).not.toMatch(/from '@\/lib\/permit\/utils\/conductorAuthority'/);
  });

  it('deterministic: the same graph gives the same runs, in the same order', () => {
    expect(engineerServiceRuns(ray(), IL_EMT)).toEqual(engineerServiceRuns(ray(), IL_EMT));
  });
});
