// ═══════════════════════════════════════════════════════════════════════════
// validatePermitDesignSnapshot — V1..V15 fail-closed invariant engine.
// Runs on the snapshot BEFORE any sheet renders; generation throws on any
// 'blocking' violation. Every violation carries the authority path, offending
// value, source record, and affected projections (W1 requirement 4).
//
// Enforcement classes (honest about wave sequencing):
//   blocking — snapshot-internal invariants enforceable NOW.
//   deferred — cross-SHEET equalities (V9 conductor identity across sheets,
//     V11 code editions on sheets) that require the W2–W4 projection refactor;
//     until then they are MEASURED by scripts/planset-evidence.mjs, never
//     silently assumed. V12/V13 are render-level and enforced by a post-render
//     assertion in generatePermit.
// ═══════════════════════════════════════════════════════════════════════════
import type { PermitDesignSnapshot, SnapshotViolation } from './types';

const SHEETS_ELECTRICAL = ['E-1', 'PV-4A', 'PV-4B', 'PV-5', 'PV-6', 'SCHED', 'BOM'];

export function validatePermitDesignSnapshot(s: PermitDesignSnapshot): SnapshotViolation[] {
  const v: SnapshotViolation[] = [];
  const add = (invariant: string, authorityPath: string, offendingValue: unknown,
               sourceRecord: string, affectedProjections: string[], message: string,
               enforcement: 'blocking' | 'deferred' = 'blocking') =>
    v.push({ invariant, authorityPath, offendingValue, sourceRecord, affectedProjections, message, enforcement });

  const planeSum = s.geometry.roofPlanes.reduce((a, p) => a + p.moduleCount, 0);
  const nModules = s.geometry.modules.length;

  // V1 — plane sums == module instances == derived count
  if (nModules > 0 && planeSum !== nModules) {
    add('V1', 'geometry.roofPlanes[].moduleCount', planeSum, 'geometry builder',
      ['PV-1', 'PV-1B', 'PV-2'], `Σ modules per plane (${planeSum}) ≠ module instances (${nModules})`);
  }
  if (nModules > 0 && s.derived.moduleCount !== nModules) {
    add('V1', 'derived.moduleCount', s.derived.moduleCount, 'derived builder',
      ['PV-0', 'SCHED'], `derived.moduleCount (${s.derived.moduleCount}) ≠ module instances (${nModules})`);
  }

  const isMicro = s.electrical.topology === 'MICRO';
  if (isMicro && nModules > 0) {
    // V2 — 1:1 micro:module
    if (s.electrical.microInverterUnits.length !== nModules) {
      add('V2', 'electrical.microInverterUnits', s.electrical.microInverterUnits.length,
        'electrical builder', SHEETS_ELECTRICAL,
        `microinverter units (${s.electrical.microInverterUnits.length}) ≠ modules (${nModules}) on a 1:1 system`);
    }
    // V3 — Σ branch module counts == micro count
    const branchSum = s.electrical.branches.reduce((a, b) => a + b.moduleCount, 0);
    if (branchSum !== s.electrical.microInverterUnits.length) {
      add('V3', 'electrical.branches[].moduleCount', branchSum, 'planMicroBranches',
        SHEETS_ELECTRICAL, `Σ branch modules (${branchSum}) ≠ microinverters (${s.electrical.microInverterUnits.length})`);
    }
    // V4 — every device in exactly one branch
    const seen = new Map<string, number>();
    for (const u of s.electrical.microInverterUnits) seen.set(u.deviceId, (seen.get(u.deviceId) ?? 0) + 1);
    const branchIds = new Set(s.electrical.branches.map(b => b.branchId));
    for (const u of s.electrical.microInverterUnits) {
      if (!branchIds.has(u.branchId)) {
        add('V4', `electrical.microInverterUnits[${u.deviceId}].branchId`, u.branchId,
          'planMicroBranches', SHEETS_ELECTRICAL, `device ${u.deviceId} assigned to unknown branch ${u.branchId}`);
      }
      if ((seen.get(u.deviceId) ?? 0) > 1) {
        add('V4', `electrical.microInverterUnits[${u.deviceId}]`, seen.get(u.deviceId),
          'electrical builder', SHEETS_ELECTRICAL, `device ${u.deviceId} appears ${seen.get(u.deviceId)}×`);
      }
    }
    // V5/V5a — manufacturer branch limits (D-1: hard wall, incl. IQ8A ≤11 / ≤20A)
    const inv = s.equipment.microInverters[0];
    if (inv) {
      for (const b of s.electrical.branches) {
        if (b.moduleCount > inv.spec.maxUnitsPerBranch) {
          add(/iq8a/i.test(inv.model) ? 'V5a' : 'V5', `electrical.branches[${b.label}].moduleCount`,
            b.moduleCount, `equipment.microInverters[${inv.model}]`, SHEETS_ELECTRICAL,
            `branch ${b.label} has ${b.moduleCount} units > manufacturer max ${inv.spec.maxUnitsPerBranch} (${inv.model})`);
        }
        if (b.ocpdA > inv.spec.maxBranchOcpdA) {
          add(/iq8a/i.test(inv.model) ? 'V5a' : 'V5', `electrical.branches[${b.label}].ocpdA`,
            b.ocpdA, `equipment.microInverters[${inv.model}]`, SHEETS_ELECTRICAL,
            `branch ${b.label} OCPD ${b.ocpdA}A > manufacturer max ${inv.spec.maxBranchOcpdA}A (${inv.model})`);
        }
      }
    }
  }

  // V6 — DC watts = Σ module STC watts
  const mod0 = s.equipment.modules[0];
  if (nModules > 0 && mod0 && mod0.spec.wattsStc > 0) {
    const expect = nModules * mod0.spec.wattsStc;
    if (Math.abs(s.derived.dcWattsStc - expect) > 0.5) {
      add('V6', 'derived.dcWattsStc', s.derived.dcWattsStc, `equipment.modules[${mod0.model}]`,
        ['PV-0', 'PV-1', 'SCHED', 'E-1'], `dcWattsStc ${s.derived.dcWattsStc} ≠ ${nModules} × ${mod0.spec.wattsStc} = ${expect}`);
    }
  }

  // V7 — AC watts = Σ inverter continuous outputs
  if (isMicro && nModules > 0) {
    const inv = s.equipment.microInverters[0];
    const per = inv?.spec.continuousVa ?? (inv ? inv.spec.continuousOutputA * 240 : 0);
    if (per > 0) {
      const expect = Math.round(nModules * per);
      if (Math.abs(s.derived.acWattsContinuous - expect) > nModules) {
        add('V7', 'derived.acWattsContinuous', s.derived.acWattsContinuous,
          `equipment.microInverters[${inv!.model}]`, ['PV-0', 'E-1', 'PV-6'],
          `acWattsContinuous ${s.derived.acWattsContinuous} ≠ ${nModules} × ${per} ≈ ${expect}`);
      }
    }
  }

  // V8 — module geometry uses catalog dims (deferred: footprints W3)
  if (mod0 && (mod0.spec.lengthIn == null || mod0.spec.widthIn == null)) {
    add('V8', `equipment.modules[${mod0.model}].spec`, { lengthIn: mod0.spec.lengthIn, widthIn: mod0.spec.widthIn },
      mod0.provenance.source, ['PV-1', 'PV-3', 'APP-A'],
      'module record lacks catalog dimensions — sheets would fall back to literals', 'deferred');
  }

  // V9 — conductor identity across sheets (deferred until W2 projections; measured by evidence)
  // V10 — BOM/structural quantity reconciliation (deferred until W3/W5 carry the objects)
  if (s.structural.attachmentCount == null) {
    add('V10', 'structural.attachmentCount', null, 'structural builder',
      ['PV-3', 'PV-4C', 'SCHED-2'], 'attachment count not snapshot-carried (rackingBOM not persisted) — W3 gap', 'deferred');
  }

  // V11 — code editions from AHJ authority (deferred to W4 projections; source flagged now)
  if (s.project.ahj.codesSource === 'default') {
    add('V11', 'project.ahj.adoptedCodes', s.project.ahj.adoptedCodes, 'default (no AHJ record)',
      ['ALL SHEETS'], 'code editions defaulted — AHJ record missing; sheets must mark UNVERIFIED (W4)', 'deferred');
  }

  // V12/V13 are render-level — enforced post-render in generatePermit.

  // ── W2.1 invariants ────────────────────────────────────────────────────
  // V16 — canonical engine identity + plan/engine branch reconciliation.
  if (s.electrical.engineOfRecord !== 'computeSystem') {
    add('V16', 'electrical.engineOfRecord', s.electrical.engineOfRecord, 'snapshot builder',
      SHEETS_ELECTRICAL, 'computeSystem is the sole canonical electrical engine (W2.1 binding)');
  }
  if (isMicro) {
    for (const b of s.electrical.branches) {
      if (!(b.ocpdA > 0) || !(b.currentA > 0)) {
        add('V16', `electrical.branches[${b.label}]`, { ocpdA: b.ocpdA, currentA: b.currentA },
          'computeSystem.microBranches ↔ planMicroBranches',
          SHEETS_ELECTRICAL,
          `branch ${b.label} has no matching canonical-engine row (plan/engine size-multiset mismatch)`);
      }
    }
  }
  // V17 — classified parity: no unresolved permit-critical rows may remain.
  if (s.electrical.parity.unresolved.length) {
    add('V17', 'electrical.parity.unresolved', s.electrical.parity.unresolved, 'parity matrix',
      SHEETS_ELECTRICAL, `unresolved parity rows: ${s.electrical.parity.unresolved.join(', ')} — classify or fix`);
  }
  // V18 — route-length authority: every segment carries a length + source;
  // estimate-grade sources must be reflected in permitReadiness blockers.
  for (const r of s.electrical.routeSegments) {
    if (r.oneWayFt == null || !r.lengthSource) {
      add('V18', `electrical.routeSegments[${r.segmentId}]`, { oneWayFt: r.oneWayFt, lengthSource: r.lengthSource },
        'computeSystem runs', ['E-1', 'PV-4B', 'SCHED', 'BOM'],
        `segment ${r.segmentId} lacks an authoritative length/source`);
    }
  }
  if (s.electrical.routeSegments.some(r => r.lengthSource === 'cad-derived-estimate' || r.lengthSource === 'unknown')
      && !s.permitReadiness.blockers.some(b => b.code === 'ROUTE-LENGTH-ESTIMATE')) {
    add('V18', 'permitReadiness.blockers', s.permitReadiness.blockers.map(b => b.code),
      'snapshot builder', ['PV-0', 'VAL-1'],
      'estimate-grade route lengths present but not reflected as a permit-readiness blocker');
  }

  // V14 — pitch is degrees
  for (const p of s.geometry.roofPlanes) {
    if (p.pitchDeg != null && (p.pitchDeg < 0 || p.pitchDeg > 60)) {
      add('V14', `geometry.roofPlanes[${p.planeId}].pitchDeg`, p.pitchDeg, 'cad.roof.planes',
        ['PV-1', 'PV-3', 'PV-4C'], `pitch ${p.pitchDeg} outside plausible degree range — unit confusion`);
    }
  }

  // V15 — ONE thermal basis, verified against what the engine actually ran
  // with (W2: BLOCKING on mismatch; deferred only when the engine didn't
  // report — e.g. client-supplied compliance suppressed... which D-3 forbids).
  const _thNote = s.project.thermal.provenance.note ?? '';
  if (_thNote.includes('ENGINE THERMAL MISMATCH')) {
    add('V15', 'project.thermal.designTempMinC', s.project.thermal.designTempMinC, 'runElectricalCalc',
      ['PV-4A', 'PV-4B', 'APP-A', 'E-1'], _thNote, 'blocking');
  } else if (_thNote.includes('not reported')) {
    add('V15', 'project.thermal', s.project.thermal.designTempMinC, 'designTemps.ts',
      ['PV-4A', 'PV-4B', 'APP-A', 'E-1'], _thNote, 'deferred');
  }

  return v;
}

export function blockingViolations(vs: SnapshotViolation[]): SnapshotViolation[] {
  return vs.filter(x => x.enforcement === 'blocking');
}

export class SnapshotValidationError extends Error {
  violations: SnapshotViolation[];
  constructor(violations: SnapshotViolation[]) {
    super(`[PermitDesignSnapshot] ${violations.length} blocking invariant violation(s): `
      + violations.map(x => `${x.invariant} ${x.authorityPath}=${JSON.stringify(x.offendingValue)} — ${x.message}`).join(' | '));
    this.violations = violations;
    this.name = 'SnapshotValidationError';
  }
}
