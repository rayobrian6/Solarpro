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
  // V10 — §11 ACTIVATED (W3): structural BOM quantities reconcile with the
  // canonical objects. Object quantities are authority; any divergence from the
  // §10 checklist or the V4 producer is a BLOCKING quantity-authority failure.
  // (The DRAWN==snapshot render equalities — drawn module/rail/attachment counts
  // — are enforced post-render by V12/V13 + the non-zero-exit evidence harness,
  // since validate runs pre-render on the snapshot itself.)
  {
    const recon = s.structural.bomReconciliation;
    if (recon && !recon.ok) {
      add('V10', 'structural.bomReconciliation', recon.checks.filter(c => !c.ok).map(c => c.name),
        'W3 §10 structural BOM', ['BOM', 'SCHED', 'SCHED-2', 'PV-3', 'PV-4C'],
        `structural BOM does not reconcile with canonical objects: `
        + recon.checks.filter(c => !c.ok).map(c => `${c.name}(exp ${c.expected}≠act ${c.actual})`).join(', '));
    }
    // Rail-based assembly must carry object-derived rail + mount rows.
    if (s.structural.rails.length > 0) {
      const bom = s.structural.bom ?? [];
      if (!bom.some(r => r.key === 'rails') || !bom.some(r => r.key === 'mounts')) {
        add('V10', 'structural.bom', bom.map(r => r.key), 'W3 §10 structural BOM',
          ['BOM', 'SCHED', 'PV-3'], 'rail-based assembly carries rail/attachment objects but the structural BOM has no rail/mount row');
      }
      // Every BOM row must carry an auditable source (object IDs or aggregation).
      const orphanRow = bom.find(r => r.sourceObjectIds === undefined && r.aggregation === undefined);
      if (orphanRow) {
        add('V10', `structural.bom[${orphanRow.key}]`, orphanRow.qty, 'W3 §10 structural BOM',
          ['BOM', 'SCHED'], `BOM row '${orphanRow.key}' carries no source object IDs and no aggregation reference (§10 requires one)`);
      }
    }
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

  // ── W3 canonical STRUCTURAL invariants (snapshot-internal, blocking) ─────
  const st = s.structural;
  const gi = s.geometry.moduleInstances ?? [];
  // V19 — module instance count == module count (when instances are carried)
  if (gi.length > 0 && nModules > 0 && gi.length !== nModules) {
    add('V19', 'geometry.moduleInstances.length', gi.length, 'W3 structural authority',
      ['PV-1', 'PV-1B', 'PV-3'], `module instances (${gi.length}) ≠ module count (${nModules})`);
  }
  // V20 — every instance uses EXACT catalog dims (no generic size)
  if (gi.length > 0 && mod0 && mod0.spec.widthIn != null && mod0.spec.lengthIn != null) {
    for (const m of gi) {
      if (m.widthIn !== mod0.spec.widthIn || m.heightIn !== mod0.spec.lengthIn) {
        add('V20', `geometry.moduleInstances[${m.instanceId}]`, { w: m.widthIn, h: m.heightIn },
          `equipment.modules[${mod0.model}]`, ['PV-1', 'PV-3', 'APP-A'],
          `module footprint dims (${m.widthIn}×${m.heightIn}) ≠ catalog record (${mod0.spec.widthIn}×${mod0.spec.lengthIn}) — generic size forbidden`);
        break;
      }
    }
  }
  // V21 — array area == Σ canonical module polygon areas (exact catalog footprint)
  for (const m of gi) {
    const expect = Math.round((m.widthIn * m.heightIn) / 144 * 1000) / 1000;
    if (Math.abs(m.areaFt2 - expect) > 0.01) {
      add('V21', `geometry.moduleInstances[${m.instanceId}].areaFt2`, m.areaFt2, 'W3 structural authority',
        ['PV-1', 'NEW-ARRAY-AREA'], `instance area ${m.areaFt2} ≠ exact catalog footprint ${expect} ft²`);
      break;
    }
  }
  // V22 — rail ↔ attachment ↔ module referential integrity (when rails carried)
  if (st.rails.length > 0) {
    const railIds = new Set(st.rails.map(r => r.railId));
    const attIds = new Set(st.attachments.map(a => a.attachmentId));
    // §6/§11 — every attachment carries a rail AND a roof-plane reference.
    for (const a of st.attachments) {
      if (!a.railId || !a.roofPlaneId) {
        add('V22', `structural.attachments[${a.attachmentId}]`, { railId: a.railId, roofPlaneId: a.roofPlaneId },
          'W3 structural authority', ['PV-3', 'PV-4C', 'BOM'],
          `attachment ${a.attachmentId} missing rail/roof-plane reference (referential integrity)`);
        break;
      }
    }
    // §5/§11 — every rail references ≥1 supported module and ≥1 attachment + a plane.
    for (const r of st.rails) {
      if (!r.roofPlaneId || r.supportedModuleIds.length === 0 || r.attachmentIds.length === 0) {
        add('V22', `structural.rails[${r.railId}]`,
          { plane: r.roofPlaneId, modules: r.supportedModuleIds.length, atts: r.attachmentIds.length },
          'W3 structural authority', ['PV-3', 'BOM'],
          `rail ${r.railId} missing plane / supported-module / attachment references (referential integrity)`);
        break;
      }
    }
    for (const a of st.attachments) {
      if (!railIds.has(a.railId)) {
        add('V22', `structural.attachments[${a.attachmentId}].railId`, a.railId, 'W3 structural authority',
          ['PV-3', 'PV-4C', 'SCHED-2', 'BOM'], `attachment ${a.attachmentId} references unknown rail ${a.railId}`);
        break;
      }
    }
    let railAttSum = 0;
    for (const r of st.rails) {
      railAttSum += r.attachmentIds.length;
      for (const aid of r.attachmentIds) {
        if (!attIds.has(aid)) {
          add('V22', `structural.rails[${r.railId}].attachmentIds`, aid, 'W3 structural authority',
            ['PV-3', 'BOM'], `rail ${r.railId} references unknown attachment ${aid}`);
          break;
        }
      }
    }
    if (railAttSum !== st.attachments.length) {
      add('V22', 'structural.rails[].attachmentIds', railAttSum, 'W3 structural authority',
        ['PV-3', 'BOM'], `Σ rail attachment refs (${railAttSum}) ≠ attachment objects (${st.attachments.length})`);
    }
    // every module supported by ≥1 rail
    const supported = new Set(st.rails.flatMap(r => r.supportedModuleIds));
    if (gi.length > 0) {
      const orphan = gi.find(m => !supported.has(m.instanceId.replace(/^mi-/, '')) && !supported.has(m.instanceId));
      if (orphan) {
        add('V22', 'structural.rails[].supportedModuleIds', orphan.instanceId, 'W3 structural authority',
          ['PV-3'], `module ${orphan.instanceId} is not supported by any canonical rail`);
      }
    }
  }
  // V23 — structural environmental values agree with the loads mirror (one source)
  if (st.env.ultimateWindSpeedMph != null && st.loads.windSpeedMph != null
      && st.env.ultimateWindSpeedMph !== st.loads.windSpeedMph) {
    add('V23', 'structural.env.ultimateWindSpeedMph', st.env.ultimateWindSpeedMph, 'W3 structural authority',
      ['PV-3', 'PV-4C', 'CERT', 'PE-1', 'COVER'],
      `env wind ${st.env.ultimateWindSpeedMph} ≠ loads wind ${st.loads.windSpeedMph} — the 115-vs-90 disagreement must be single-sourced`);
  }
  // V24 — FRAMING HONESTY: an engineering-review-required result must NOT carry
  // a fabricated framing pass, and must be reflected in permitReadiness.
  if (st.engine.engineeringReviewRequired) {
    const framing = st.checks.find(c => c.limitState === 'framing-capacity');
    if (framing && framing.passes === true) {
      add('V24', 'structural.checks[framing-capacity].passes', true, 'W3 structural engine',
        ['PV-4C', 'CERT', 'PE-1'], 'framing check reports PASS while engineering review is required — fabricated truss capacity forbidden');
    }
    if (!s.permitReadiness.blockers.some(b => b.code === 'STRUCTURAL-FRAMING-UNVERIFIED')) {
      add('V24', 'permitReadiness.blockers', s.permitReadiness.blockers.map(b => b.code), 'W3 structural authority',
        ['PV-0', 'VAL-1'], 'engineering review required but no STRUCTURAL-FRAMING-UNVERIFIED blocker present');
    }
  }
  // V25 — REACTION HONESTY (§11): an attachment reaction exceeding its adjusted
  // allowable capacity must NOT be reported as a passing check and must surface
  // as a permit blocker — never a silent over-capacity. (§12: over-utilization
  // blocks permit-ready; the planset still renders for review — so this is a
  // consistency invariant, not a physics hard-throw.)
  {
    const over = st.attachments.find(a => a.upliftReactionLbs != null && a.allowableCapacityLbs != null
      && a.upliftReactionLbs > a.allowableCapacityLbs);
    if (over) {
      const att = st.checks.find(c => c.limitState === 'attachment-uplift');
      if (att && att.passes === true) {
        add('V25', 'structural.checks[attachment-uplift].passes', true, 'W3 structural engine',
          ['PV-3', 'PV-4C', 'PE-1'],
          `attachment ${over.attachmentId} uplift ${over.upliftReactionLbs} > allowable ${over.allowableCapacityLbs} but the attachment check reports PASS — reaction exceeding capacity must not be hidden`);
      }
      if (!s.permitReadiness.blockers.some(b => b.code === 'STRUCTURAL-UTILIZATION-EXCEEDED')) {
        add('V25', 'permitReadiness.blockers', s.permitReadiness.blockers.map(b => b.code), 'W3 structural authority',
          ['PV-0', 'VAL-1'],
          `attachment reaction exceeds allowable capacity (${over.attachmentId}) but no STRUCTURAL-UTILIZATION-EXCEEDED blocker present`);
      }
    }
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
