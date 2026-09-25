/**
 * tests/permitBusbarBlocks.test.ts
 *
 * A VERDICT NOBODY ENFORCES IS WORSE THAN NO VERDICT.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT COST
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `lib/electrical-calc.ts` evaluates NEC 705.12(B) carefully: one total-backfeed
 * formula, per-inverter OCPD rounding before summation per 705.12(B)(3)(2),
 * battery backfeed folded in, and on a violation it raises a blocker coded
 * `E-BUSBAR-120` whose message carries the whole arithmetic.
 *
 * 🚨 THAT CODE APPEARED IN EXACTLY ONE PLACE IN THE REPOSITORY — the line that
 * raises it. Nothing consumed it. And `SEVERITY_POLICY`, the authority that
 * decides what stops a permit package, held 44 rules covering structure,
 * racking, documents, authority, the 705.11(C) tap-length pair and conduit
 * fill, and NOTHING for 705.12(B).
 *
 * The snapshot meanwhile recorded the answer as `electrical.poi.rulePasses` and
 * printed it. So a design whose own cover sheet declared a 120% violation could
 * reach `designComplete` and be issued, because the readiness registry was
 * never told.
 *
 * The competitor this product is aimed at prints that arithmetic on the
 * single-line diagram as an auditable block — "(200A bus x 120%) - 200A main =
 * 40A max". Printing a verdict we decline to enforce is strictly worse than
 * printing nothing, because it looks like a check.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { SEVERITY_POLICY, classifyBlockerSeverity } from '@/lib/permit/snapshot/severityPolicy';

const BUILD = fs.readFileSync(
  path.join(process.cwd(), 'lib/permit/snapshot/build.ts'), 'utf8',
);

describe('🚨 the busbar rule can stop a permit package', () => {
  it('the policy has a 705.12(B) rule at all', () => {
    expect(
      SEVERITY_POLICY['NEC-705-12B-EXCEEDED'],
      'the severity policy has no 705.12(B) rule, so a busbar violation cannot block',
    ).toBeTruthy();
  });

  it('and it is BLOCKING, not advisory', () => {
    const c = classifyBlockerSeverity('NEC-705-12B-EXCEEDED');
    expect(c.severity, 'an overloaded busbar was classified advisory').toBe('blocking');
  });

  it('it carries the axes an overloaded busbar actually touches', () => {
    const r = SEVERITY_POLICY['NEC-705-12B-EXCEEDED'];
    // A bus over its allowance is a fire risk, a plain code violation, and
    // something no PE signs and no AHJ accepts. It is NOT a procurement fault:
    // the parts are real, the configuration is not legal.
    expect(r.impact.safety, 'an overloaded busbar is not a safety matter?').toBe(true);
    expect(r.impact.codeCompliance).toBe(true);
    expect(r.impact.engineeringApproval).toBe(true);
    expect(r.impact.permitAcceptance).toBe(true);
    expect(r.impact.procurement).toBe(false);
  });
});

describe('🚨 and the snapshot actually raises it', () => {
  it('build.ts pushes the blocker when the rule fails', () => {
    expect(
      BUILD,
      'nothing in the snapshot raises NEC-705-12B-EXCEEDED, so the policy rule ' +
      'above is unreachable and the verdict is still only printed',
    ).toContain("push('NEC-705-12B-EXCEEDED'");
  });

  it('🚨 it reads the SAME value the snapshot reports', () => {
    // The blocker and the sheet must not be able to disagree. The snapshot
    // reports `rulePasses: (elec?.busbar as any)?.passes`; the blocker must be
    // driven by that same field rather than by a second computation.
    expect(BUILD, 'the blocker no longer reads elec.busbar')
      .toMatch(/const _busbar = elec\?\.busbar/);
    expect(BUILD, 'the snapshot no longer reports the same field it blocks on')
      .toMatch(/rulePasses: \(elec\?\.busbar as any\)\?\.passes/);
  });

  it('🚨 an UNEVALUATED rule is not a violation', () => {
    // `null` means there was no interconnection data to judge. Treating that as
    // a failure would block every design that has not reached electrical yet,
    // and "unknown" is a different fact from "fails" — the tap-length pair
    // models exactly that distinction with a separate PENDING code.
    const at = BUILD.indexOf("push('NEC-705-12B-EXCEEDED'");
    expect(at).toBeGreaterThan(-1);
    // Wide enough to reach the guard past the operand declarations between it
    // and the push.
    const guard = BUILD.slice(Math.max(0, at - 1400), at);
    // 🚨 ANCHORED TO THE WHOLE CONDITION. A loose /_busbar\?\.passes === false/
    // survived a mutation to `if (false && _busbar?.passes === false)` — the
    // blocker switched off entirely and the substring was still there. That is
    // the second time today a substring match has passed on the defect it
    // names; a guard that cannot tell a condition from a fragment of one is
    // not a guard.
    expect(
      guard,
      'the busbar blocker fires on anything other than an explicit false — a ' +
      'design with no electrical data yet would be reported as a code violation',
    ).toMatch(/^\s*if \(_busbar\?\.passes === false\) \{$/m);
  });

  it('the message carries the arithmetic, not just a conclusion', () => {
    const at = BUILD.indexOf("push('NEC-705-12B-EXCEEDED'");
    const body = BUILD.slice(Math.max(0, at - 900), at + 600);
    // A reviewer must be able to check the claim without opening the engine.
    expect(body, 'the blocker states a conclusion with no supporting numbers')
      .toMatch(/bus x 120%/);
    expect(body).toMatch(/_max/);
    // And it must say what to do about it.
    expect(body, 'the blocker does not name a remedy').toMatch(/705\.11|derate|bus upgrade/);
  });
});

describe('🚨 it presents as a busbar violation, not as "UNMAPPED"', () => {
  it('the code is declared and mapped to the electrical gate', async () => {
    const { requirementToGateMap, UNMAPPED_GATE_ID } =
      await import('@/lib/permit/snapshot/releaseGates');
    const map = requirementToGateMap();
    const entry = map['NEC-705-12B-EXCEEDED'];
    expect(
      entry,
      'the busbar code is not declared, so it lands in the fail-closed sink. It ' +
      'still BLOCKS — RG-UNMAPPED blocks every axis — but a reviewer is told ' +
      '"UNMAPPED RELEASE REQUIREMENT" instead of what is actually wrong',
    ).toBeTruthy();
    expect(entry.gateId, 'the busbar verdict is not on the electrical gate')
      .toBe('RG-5');
    expect(entry.gateId).not.toBe(UNMAPPED_GATE_ID);
  });

  it('🚨 it is a VERIFIED DEFICIENCY, not a pending authority', () => {
    // The calculation RAN and the design lost. This file already made that
    // ruling once, for the tap span: reporting a known violation as "PENDING"
    // made the worse outcome read quieter than the uncertain one.
    const gates = fs.readFileSync(
      path.join(process.cwd(), 'lib/permit/snapshot/releaseGates.ts'), 'utf8');
    const at = gates.indexOf("'NEC-705-12B-EXCEEDED': {");
    expect(at).toBeGreaterThan(-1);
    const decl = gates.slice(at, at + 900);
    expect(decl, 'a known busbar violation is being reported as pending')
      .toContain("findingType: 'VERIFIED_DEFICIENCY'");
    // And the sheet line has to name the remedy, because the installer's next
    // question is always "so what do I do".
    expect(decl).toMatch(/sheetLine: '[^']*705\.12\(B\)/);
    expect(decl).toMatch(/Supply-side tap, main derate, or bus upgrade/);
  });
});

describe('🚨 a blocker code needs FIVE registrations, not one', () => {
  // Adding the severity rule alone was not enough, and the ways it fell short
  // were all silent-ish:
  //   severityPolicy.ts   — or every unmapped code fails closed to BLOCKING
  //                         with no stated impact
  //   releaseGates.ts     — or it lands in RG-UNMAPPED and the reviewer is told
  //                         "UNMAPPED RELEASE REQUIREMENT" instead of the defect
  //   reviewStatus.ts     — or RS-1 has no payload component and the render
  //                         contract test fails
  //   build.ts META       — or the blocker carries no authorityPath, sheets or
  //                         resolution, so nobody knows where to go or what to do
  //   projectAuthority.ts — or it is not attributed to the electrical domain
  //
  // This mirrors the five-gate rule already recorded for migrations. It is
  // asserted here so the NEXT electrical code does not have to rediscover it.
  const FILES: Record<string, string> = {
    'severityPolicy.ts': 'lib/permit/snapshot/severityPolicy.ts',
    'releaseGates.ts': 'lib/permit/snapshot/releaseGates.ts',
    'reviewStatus.ts': 'lib/permit/sections/reviewStatus.ts',
    'build.ts META': 'lib/permit/snapshot/build.ts',
    'projectAuthority.ts': 'lib/permit/snapshot/projectAuthority.ts',
  };

  for (const [label, rel] of Object.entries(FILES)) {
    it(`NEC-705-12B-EXCEEDED is registered in ${label}`, () => {
      const src = fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
      expect(
        src.includes("'NEC-705-12B-EXCEEDED'"),
        `${rel} does not know the busbar code`,
      ).toBe(true);
    });
  }

  it('and it is attributed to the ELECTRICAL domain', async () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'lib/permit/snapshot/projectAuthority.ts'), 'utf8');
    expect(src).toMatch(/'NEC-705-12B-EXCEEDED': 'electrical'/);
  });

  it('its META names a sheet and a remedy', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'lib/permit/snapshot/build.ts'), 'utf8');
    const at = src.indexOf("'NEC-705-12B-EXCEEDED': { severity:");
    expect(at, 'the busbar code has no META entry').toBeGreaterThan(-1);
    const meta = src.slice(at, at + 500);
    expect(meta).toContain("severity: 'blocking'");
    expect(meta, 'the blocker does not say which sheet shows it').toMatch(/sheets: \['E-1'\]/);
    expect(meta, 'the blocker does not say how to resolve it').toMatch(/resolution:/);
  });
});
