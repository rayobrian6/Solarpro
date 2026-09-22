/**
 * tests/batteryUnresolvedRecovery.test.ts
 *
 * TWO REGRESSIONS INTRODUCED BY 76632633, WHICH STOPPED THE FABRICATIONS AND
 * LEFT NOTHING IN THEIR PLACE.
 *
 * 1. `E-BATTERY-BACKFEED-UNRESOLVED` hard-failed NEC 705.12(B) for any design
 *    whose battery carried no catalogue id. The REFUSAL is right — an unknown
 *    battery's contribution genuinely is unresolved. What was wrong is that it
 *    was UNRECOVERABLE: a legacy / free-text design carries
 *    `batteryBrand` + `batteryModel` and no `batteryId`, the repository can
 *    resolve exactly that, and nothing tried. Saved designs that passed
 *    yesterday failed for a reason the installer could not act on.
 *
 * 2. THREE SHEETS OF ONE PLANSET PRINTED THREE DIFFERENT CAPACITIES for the
 *    same unresolved battery: PV-1 a fabricated 5.0 kWh per unit, PV-5 10.0
 *    (the same fabrication × 2 units), and the SLD equipment schedule nothing
 *    at all — the row was gated on `input.batteryKwh` being truthy, so it
 *    silently disappeared.
 *
 * The rule both halves share: an unresolvable value is UNRESOLVED and says so
 * in one voice on every sheet. It is never a typical number, never 0, and
 * never a row that quietly vanishes.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveBatteryBranch,
  computeBatteryBusImpact,
  BATTERIES,
} from '@/lib/equipment-db';
import { runElectricalCalc, type ElectricalCalcInput } from '@/lib/electrical-calc';
import {
  resolveBatteryCapacity,
  BATTERY_CAPACITY_UNRESOLVED,
  isBatteryCapacityUnresolvedMarker,
} from '@/lib/permit/utils/helpers';
import { buildSLDInputFromPermit } from '@/lib/permit/utils/sldAdapter';
import { renderSLDProfessional } from '@/lib/sld-professional-renderer';
import { pageSiteInformation } from '@/lib/permit/sections/sitePlan';
import { pageWarningLabels, pageDisconnectDirectory } from '@/lib/permit/sections/compliancePages';
import { generateCADLayout } from '@/lib/cad/cadEngine';
import { generatePermitHTML } from '@/lib/permit';
import { roofProject } from '@/test-fixtures/roofProject';
import { ecStringInput } from './goldens/wave0-fixtures';
import { validateReleaseGateMap, REQUIREMENT_DECLARATIONS } from '@/lib/permit/snapshot/releaseGates';
import { SEVERITY_POLICY } from '@/lib/permit/snapshot/severityPolicy';
import type { PermitInput } from '@/lib/permit/types';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';

const FIVE_P = 'enphase-iq-battery-5p';
const TEN_C = 'enphase-iq-battery-10c';

// ════════════════════════════════════════════════════════════════════════════
// REGRESSION 1 — THE REFUSAL IS RECOVERABLE
// ════════════════════════════════════════════════════════════════════════════

/**
 * The repo's own Wave-0 string fixture, with enough busbar headroom that the
 * 120% rule is not itself the thing under test — these tests are about whether
 * the battery term can be RESOLVED, not about whether this particular bus can
 * carry it.
 */
function baseInput(over: Partial<ElectricalCalcInput> = {}): ElectricalCalcInput {
  return {
    ...ecStringInput(),
    interconnection: { method: 'LOAD_SIDE', busRating: 400, mainBreaker: 100 },
    ...over,
  };
}
const backfeedBlocked = (res: ReturnType<typeof runElectricalCalc>) =>
  res.errors.find(e => e.code === 'E-BATTERY-BACKFEED-UNRESOLVED');

describe('🚨 a battery with NO catalogue id but a real brand/model is RECOVERED, not failed', () => {
  it('a legacy design carrying only batteryBrand + batteryModel passes 705.12(B)', () => {
    // The exact shape app/engineering/page.tsx documents: the two carriages
    // populate different fields, so this design has no batteryId at all and
    // no caller pre-resolved a backfeed for it.
    const res = runElectricalCalc(baseInput({
      batteryCount: 2,
      batteryManufacturer: 'Enphase',
      batteryModel: 'IQ Battery 5P',
    }));
    expect(backfeedBlocked(res),
      'a battery this repository can identify must not block interconnection').toBeUndefined();
    expect(res.interconnection.passes).toBe(true);
  });

  it('…and the recovered backfeed is actually IN the busbar total, not just un-blocked', () => {
    const without = runElectricalCalc(baseInput());
    const withBat = runElectricalCalc(baseInput({
      batteryCount: 2,
      batteryManufacturer: 'Enphase',
      batteryModel: 'IQ Battery 5P',
    }));
    // The 5P is gateway-fed: 2 units are ONE point of connection, so the
    // contribution is the single 20 A breaker, not 40 A.
    expect(resolveBatteryBranch(FIVE_P, 2).busbarContributionA).toBe(20);
    expect(withBat.interconnection.solarBreakerRequired)
      .toBe(without.interconnection.solarBreakerRequired + 20);
  });

  it('a design carrying only a catalogue batteryId is recovered too', () => {
    const res = runElectricalCalc(baseInput({ batteryCount: 3, batteryId: FIVE_P }));
    expect(backfeedBlocked(res)).toBeUndefined();
    expect(res.interconnection.passes).toBe(true);
  });

  it('a pre-resolved batteryBackfeedA still WINS — no existing design moves', () => {
    const res = runElectricalCalc(baseInput({
      batteryCount: 2, batteryBackfeedA: 80,
      batteryManufacturer: 'Enphase', batteryModel: 'IQ Battery 5P',
    }));
    const without = runElectricalCalc(baseInput());
    // 80, the caller's figure — NOT the catalogue's 20.
    expect(res.interconnection.solarBreakerRequired)
      .toBe(without.interconnection.solarBreakerRequired + 80);
  });
});

describe('🚨 the recovery is an EXACT match, never a substring — and still refuses', () => {
  it('"IQ Battery 10" does NOT become the IQ Battery 10C', () => {
    // A substring matcher is how a 40/80 A step-function product gets picked
    // for a name that does not identify it. The refusal stands.
    const res = runElectricalCalc(baseInput({
      batteryCount: 2,
      batteryManufacturer: 'Enphase',
      batteryModel: 'IQ Battery 10',
    }));
    const blocked = backfeedBlocked(res);
    expect(blocked, 'a model SUBSTRING must never resolve a battery').toBeTruthy();
    expect(res.interconnection.passes).toBe(false);
  });

  it('a product that is genuinely not in the catalogue is still BLOCKED', () => {
    const res = runElectricalCalc(baseInput({
      batteryCount: 2,
      batteryManufacturer: 'Acme Power',
      batteryModel: 'Vault 9000',
    }));
    expect(backfeedBlocked(res)!.severity).toBe('error');
    expect(res.interconnection.passes).toBe(false);
  });

  it('🚨 …and when it refuses it NAMES the battery and WHAT THE INSTALLER MUST DO', () => {
    const res = runElectricalCalc(baseInput({
      batteryCount: 2,
      batteryManufacturer: 'Acme Power',
      batteryModel: 'Vault 9000',
    }));
    const blocked = backfeedBlocked(res)!;
    const text = `${blocked.message} ${blocked.suggestion ?? ''}`;
    // What was tried, in the installer's own words — not a source-file path.
    expect(text).toContain('Acme Power');
    expect(text).toContain('Vault 9000');
    // A named action. The previous message pointed at lib/equipment-db.ts.
    expect(text).toMatch(/re-select|equipment picker/i);
    expect(text).not.toMatch(/resolveBatteryBranch/);
  });

  it('a supply-side tap stays exempt — NEC 705.11, the 120% rule does not apply', () => {
    const res = runElectricalCalc(baseInput({
      batteryCount: 2,
      batteryManufacturer: 'Acme Power', batteryModel: 'Vault 9000',
      interconnection: { method: 'SUPPLY_SIDE_TAP', busRating: 200, mainBreaker: 200 },
    }));
    expect(backfeedBlocked(res)).toBeUndefined();
    expect(res.interconnection.passes).toBe(true);
  });

  it('no battery on the job is still 0 A and still passes', () => {
    const res = runElectricalCalc(baseInput());
    expect(backfeedBlocked(res)).toBeUndefined();
    expect(res.interconnection.passes).toBe(true);
  });
});

describe('the identity recovery lives in THE authority, so it answers once for everyone', () => {
  it('resolveBatteryBranch accepts {brand, model} and reports the basis', () => {
    const r = resolveBatteryBranch({ brand: 'Enphase', model: 'IQ Battery 10C' }, 2);
    expect(r.resolved).toBe(true);
    expect(r.identityBasis).toBe('exact-model-match');
    expect(r.batteryId).toBe(TEN_C);
    // The 10C step function is unchanged by the route taken to it.
    expect(r.branchOcpdA).toBe(80);
  });

  it('an id still wins and is reported as the id', () => {
    const r = resolveBatteryBranch({ id: TEN_C, brand: 'Enphase', model: 'IQ Battery 5P' }, 1);
    expect(r.identityBasis).toBe('catalogue-id');
    expect(r.batteryId).toBe(TEN_C);
    expect(r.branchOcpdA).toBe(40);
  });

  it('a bare string id still works — every existing caller is untouched', () => {
    const r = resolveBatteryBranch(TEN_C, 2);
    expect(r.resolved).toBe(true);
    expect(r.identityBasis).toBe('catalogue-id');
    expect(r.branchOcpdA).toBe(80);
    expect(computeBatteryBusImpact(TEN_C)).toBe(40);
  });

  it('🚨 a model SUBSTRING is UNRESOLVED through the identity path too', () => {
    for (const model of ['IQ Battery 10', 'IQ Battery', '10C', 'iq battery 10c extra']) {
      const r = resolveBatteryBranch({ brand: 'Enphase', model }, 1);
      if (model === 'iq battery 10c extra' || model !== 'IQ Battery 10C') {
        expect(r.resolved, `'${model}' must not resolve`).toBe(false);
        expect(r.identityBasis).toBe('unresolved');
      }
    }
  });

  it('🚨 the shared-gateway rule survives the identity path — one gateway, ONE point of connection', () => {
    const gatewayFed = BATTERIES.filter(
      b => b.requiresGateway === true
        && !b.branchArchitecture
        && b.subcategory !== 'dc_coupled'
        && typeof b.backfeedBreakerA === 'number' && b.backfeedBreakerA > 0,
    );
    expect(gatewayFed.length, 'no gateway-fed scalar battery — the guard would be vacuous')
      .toBeGreaterThan(0);
    for (const b of gatewayFed) {
      const byText = resolveBatteryBranch({ brand: b.manufacturer, model: b.model }, 3);
      expect(byText.resolved, b.id).toBe(true);
      expect(byText.busbarContributionA, `${b.id} x3 must not triple`).toBe(b.backfeedBreakerA);
      expect(byText.busbarBasis).toBe('catalogue-scalar-shared-gateway');
      // identical to the id route — one answer, two ways in.
      expect(byText.busbarContributionA).toBe(resolveBatteryBranch(b.id, 3).busbarContributionA);
    }
  });

  it('…and a battery with NO gateway still sums, so the rule is not applied blindly', () => {
    const standalone = BATTERIES.filter(
      b => b.requiresGateway !== true
        && !b.branchArchitecture
        && b.subcategory !== 'dc_coupled'
        && typeof b.backfeedBreakerA === 'number' && b.backfeedBreakerA > 0,
    );
    expect(standalone.length, 'no standalone scalar battery — the control is vacuous')
      .toBeGreaterThan(0);
    for (const b of standalone) {
      const byText = resolveBatteryBranch({ brand: b.manufacturer, model: b.model }, 3);
      expect(byText.busbarContributionA, b.id).toBe(b.backfeedBreakerA! * 3);
      expect(byText.busbarBasis).toBe('catalogue-scalar-sum');
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// REGRESSION 2 — ONE CAPACITY, EVERY SHEET
// ════════════════════════════════════════════════════════════════════════════

describe('resolveBatteryCapacity — THE capacity the planset prints', () => {
  const unknownBat = { batteryCount: 2, batteryBrand: 'Acme Power', batteryModel: 'Vault 9000' };

  it('🚨 an unresolvable battery is UNRESOLVED — not 5.0, not 0, not blank', () => {
    const cap = resolveBatteryCapacity(unknownBat);
    expect(cap.hasBattery).toBe(true);
    expect(cap.resolved).toBe(false);
    expect(cap.totalKwh).toBeNull();
    expect(cap.perUnitKwh).toBeNull();
    expect(cap.label).toBe(BATTERY_CAPACITY_UNRESOLVED);
    expect(cap.perUnitLabel).toBe(BATTERY_CAPACITY_UNRESOLVED);
    expect(cap.label).not.toMatch(/5\.0|0\.0 kWh/);
    expect(isBatteryCapacityUnresolvedMarker(cap.label)).toBe(true);
    // The reason travels with it, for the release registry.
    expect(cap.unresolvedReason).toBeTruthy();
  });

  it('the catalogue answers when the design carries only brand + model', () => {
    const cap = resolveBatteryCapacity({
      batteryCount: 2, batteryBrand: 'Enphase', batteryModel: 'IQ Battery 10C',
    });
    expect(cap.resolved).toBe(true);
    expect(cap.basis).toBe('catalogue');
    expect(cap.perUnitKwh).toBe(10.0);
    expect(cap.totalKwh).toBe(20.0);
    expect(cap.label).toBe('20.0 kWh (2 × 10.0)');
  });

  it("the design's own per-unit figure wins over the catalogue", () => {
    const cap = resolveBatteryCapacity({
      batteryCount: 2, batteryId: TEN_C, batteryKwh: 9.6,
    });
    expect(cap.basis).toBe('project-record');
    expect(cap.totalKwh).toBe(19.2);
  });

  it('no battery ⇒ no capacity and no marker (a count alone is a phantom)', () => {
    expect(resolveBatteryCapacity({ batteryCount: 2 }).hasBattery).toBe(false);
    expect(resolveBatteryCapacity({ batteryCount: 2 }).label).toBe('');
    expect(resolveBatteryCapacity(null).hasBattery).toBe(false);
  });
});

describe('🚨 THREE SHEETS OF ONE PLANSET NOW AGREE', () => {
  /** The repo's own roof fixture, with a battery the catalogue cannot identify. */
  function unresolvedBatteryProject(): PermitInput {
    const p = JSON.parse(JSON.stringify(roofProject)) as PermitInput;
    p.project.batteryCount = 2;
    p.project.batteryBrand = 'Acme Power';
    p.project.batteryModel = 'Vault 9000';
    delete (p.project as Record<string, unknown>).batteryId;
    delete (p.project as Record<string, unknown>).batteryKwh;
    return p;
  }

  /**
   * Render the four surfaces that used to disagree. `generatePermitHTML` runs
   * first because the sheet functions fail closed without a validated snapshot
   * — this is the same order production uses, and it means the project object
   * these sheets read is the one generatePermit actually produced.
   */
  const sheets = (input: PermitInput): { name: string; html: string }[] => {
    generatePermitHTML(input as never);
    const cad = generateCADLayout(input as never);
    const sld = renderSLDProfessional(buildSLDInputFromPermit(input, cad));
    return [
      { name: 'PV-1 site plan legend', html: pageSiteInformation(input, cad, 2, 20) },
      { name: 'PV-5 power-sources placard', html: pageWarningLabels(input, cad, 5, 20) },
      { name: 'disconnect directory', html: pageDisconnectDirectory(input, cad, 6, 20) },
      { name: 'SLD equipment schedule', html: sld },
    ];
  };

  it('every sheet prints the SAME unresolved marker', () => {
    for (const s of sheets(unresolvedBatteryProject())) {
      expect(s.html, `${s.name} does not print the unresolved marker`)
        .toContain('ESS CAPACITY UNRESOLVED');
    }
  });

  it('🚨 no sheet prints the fabricated 5.0 kWh, nor its ×2', () => {
    for (const s of sheets(unresolvedBatteryProject())) {
      expect(s.html, `${s.name} still prints a fabricated capacity`).not.toMatch(/5\.0 kWh/);
      expect(s.html, `${s.name} still prints a fabricated capacity`).not.toMatch(/10\.0 kWh/);
      expect(s.html, `${s.name} prints a zero capacity`).not.toMatch(/\b0(\.0)? kWh/);
    }
  });

  it('🚨 the SLD equipment schedule still CARRIES the Battery Capacity row', () => {
    // The row was gated on `input.batteryKwh` being truthy, so an unresolved
    // battery deleted it from the schedule while other sheets printed a number.
    const sld = sheets(unresolvedBatteryProject()).find(s => s.name === 'SLD equipment schedule')!.html;
    expect(sld).toContain('Battery Capacity');
  });

  it('…and when the battery IS resolvable, every sheet prints that one capacity', () => {
    const input = unresolvedBatteryProject();
    input.project.batteryBrand = 'Enphase';
    input.project.batteryModel = 'IQ Battery 10C';
    const rendered = sheets(input);
    for (const s of rendered) {
      expect(s.html, s.name).not.toContain('ESS CAPACITY UNRESOLVED');
    }
    // 10.0 per unit on PV-1; 20.0 fleet total on the placard and the directory.
    expect(rendered[0].html, rendered[0].name).toContain('10.0 kWh');
    expect(rendered[1].html, rendered[1].name).toContain('20.0 kWh');
    expect(rendered[2].html, rendered[2].name).toContain('20.0 kWh');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// …AND THE MARKER BLOCKS RELEASE, SO IT CANNOT SHIP AS DECORATION
// ════════════════════════════════════════════════════════════════════════════

describe('BATTERY-CAPACITY-UNRESOLVED is a real release blocker, not a label', () => {
  function snapshotFor(project: Partial<PermitInput['project']>): PermitDesignSnapshot {
    const input = JSON.parse(JSON.stringify(roofProject)) as PermitInput;
    Object.assign(input.project, project);
    generatePermitHTML(input as never);
    return (input as unknown as { _snapshot: PermitDesignSnapshot })._snapshot;
  }

  it('🚨 an unresolvable ESS capacity lands in the readiness registry as BLOCKING', () => {
    const snap = snapshotFor({
      batteryCount: 2, batteryBrand: 'Acme Power', batteryModel: 'Vault 9000',
      batteryId: undefined, batteryKwh: undefined,
    });
    const rec = (snap.permitReadiness?.registry ?? [])
      .find(r => r.code === 'BATTERY-CAPACITY-UNRESOLVED');
    expect(rec, 'the visible marker must also stop the package being released').toBeTruthy();
    expect(rec!.severity).toBe('blocking');
    expect(rec!.domain).toBe('equipment');
    // It names the product the design claims, so the operator knows what to fix.
    expect(JSON.stringify(rec!.payload)).toContain('Vault 9000');
    // And it says what to do, not where the code lives.
    expect(rec!.resolutionAction).toMatch(/re-select|record the manufacturer-stated/i);
  });

  it('a resolvable battery does NOT raise it', () => {
    const snap = snapshotFor({
      batteryCount: 2, batteryBrand: 'Enphase', batteryModel: 'IQ Battery 10C',
      batteryId: undefined, batteryKwh: undefined,
    });
    expect((snap.permitReadiness?.registry ?? [])
      .some(r => r.code === 'BATTERY-CAPACITY-UNRESOLVED')).toBe(false);
  });

  it('a job with no battery does NOT raise it', () => {
    const snap = snapshotFor({});
    expect((snap.permitReadiness?.registry ?? [])
      .some(r => r.code === 'BATTERY-CAPACITY-UNRESOLVED')).toBe(false);
  });

  it('🚨 the code is DECLARED — it can never fall into the fail-closed UNMAPPED gate', () => {
    // A code the release-gate map does not know blocks every axis under
    // RG-UNMAPPED and fails verifyNoUnmappedRequirements. Declaring it is the
    // difference between a governed blocker and an accident.
    expect(validateReleaseGateMap()).toEqual([]);
    const decl = REQUIREMENT_DECLARATIONS['BATTERY-CAPACITY-UNRESOLVED'];
    expect(decl, 'undeclared — it would land in the UNMAPPED sink').toBeTruthy();
    expect(decl.gateId).toBe('RG-2');
    expect(decl.findingType).toBe('PENDING_SELECTION');
    expect(decl.modeBasis.trim().length).toBeGreaterThan(0);
    expect(SEVERITY_POLICY['BATTERY-CAPACITY-UNRESOLVED']).toBeTruthy();
    expect(Object.values(SEVERITY_POLICY['BATTERY-CAPACITY-UNRESOLVED'].impact).some(Boolean)).toBe(true);
  });
});
