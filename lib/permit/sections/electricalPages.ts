// ═══════════════════════════════════════════════════════════════
// Electrical Pages — NEC Compliance, Conductor Schedule, SLD
// Extracted from route.ts — ZERO REGRESSION
// ═══════════════════════════════════════════════════════════════

import type { PermitInput } from '../types';
import type { CADModel } from '@/lib/cad/types';
import { titleBlock } from '../utils/titleBlock';
import { sysTypeLabel, topologyDisplayLabel, resolveInverterCount, statusColor, statusBg, statusBorder, statusLabel, interconnectionLabel, isSupplySideInterconnection, utilityDisplayName, necNextStandardOcpd, hasRealBattery, type SysType } from '../utils/helpers';
import { getEquipmentContext, getInverterTopology, isFence, isGround, isRoof, topologyToLegacy } from '@/lib/system';
import { generateLiveSLD } from '../utils/sldAdapter';
import { microBranchCount, planMicroBranches } from '../utils/branching';
import { getSnapshot } from '../snapshot/read';
// §3 SEGMENT AUTHORITY (post-campaign correction 07-22): every feeder raceway
// size, voltage drop, run length + conductor callout PROJECTS from the ONE
// canonical feeder segment — no sheet re-derives conduit/VD/length/callout.
import { projectCanonicalFeeder, projectCanonicalBranch, projectSharedBranchRaceway, projectRacewayDescriptor } from '../snapshot/electricalProjection';
import { buildConductorAuthority, type SubSystemConductorAuthority } from '../utils/conductorAuthority';
import { buildIntegratedEquipment } from '../utils/integratedEquipment';
import { SUB_LABEL } from './subSystemSheets';
import { getEGCSize } from '@/lib/manufacturer-specs';
// W4 §2/§11: code editions project from the ONE snapshot codeAuthority record
// (single source) — no sheet-local NEC/ASCE year literal. Missing ⇒ PENDING.
import { projectCodeAuthorityFromInput, PENDING_EDITION } from '../snapshot/codeAuthorityProjection';

// ═══════════════════════════════════════════════════════════════
// INTERCONNECTION — resolved ONCE for the whole set.
// ───────────────────────────────────────────────────────────────
// The set used to contradict itself: the cover flagged "EXCEEDS 120% —
// SUPPLY-SIDE REQ'D", PV-4A printed a red "BUSBAR RULE ✗ FAIL / evaluation
// pending", and the AC-feeder OCPD disagreed sheet-to-sheet (PV-4A rounded
// its own 175 A while PV-4B/PV-6 printed the engine's 155 A). This resolver
// is the SINGLE source every owned sheet reads:
//   • method: a load-side design that fails the 120% busbar rule resolves to
//     a SUPPLY-SIDE (line-side) tap per NEC 705.11 — never a FAIL/pending on
//     an issued set. Explicit supply-side stays supply-side.
//   • feeder: current + OCPD + conductor + EGC come from the shared conductor
//     authority (the same values E-1/PV-6 print), with the EGC sized off the
//     FEEDER OCPD per NEC 250.122 (not the 20 A branch OCPD — the #12→#6 fix).
// PURE: identical inputs → identical output, so no two sheets can drift.
export interface InterconnectionResolution {
  isSupplySide: boolean;
  methodLabel: string;
  necArticle: '705.11' | '705.12';
  feederOutputA: number;        // PV AC output current (single AC-kW source)
  feederContinuousA: number;    // × 1.25 (NEC 690.8(A))
  feederOcpd: number;           // tap / backfeed OCPD (authority single source)
  feederWireGauge: string;      // plain gauge, e.g. '#2 AWG'
  feederConductorCallout: string;      // full callout as computed upstream
  feederPhaseCallout: string;   // callout with any embedded GND stripped
  feederAmpacityA: number | null;
  feederEgcGauge: string;       // NEC 250.122 on the FEEDER OCPD
  busA: number;
  mainA: number;
  busLimit: number;
  maxBackfeedA: number;
  passes120: boolean;
  /** §1 (closeout 2026-07-23) — the CANONICAL tri-state 120% verdict. null ⇒
   *  the snapshot carries no busbar evaluation → the sheet renders PENDING (never
   *  a synthesized PASS). passes120 stays `rulePasses === true` for existing
   *  boolean consumers. On a supply-side tap the busbar rule is N/A (not shown). */
  rulePasses: boolean | null;
}

export function resolveInterconnection(input: PermitInput, cad?: CADModel | null): InterconnectionResolution {
  // W2 PROJECTION (Ray's snapshot mandate): every figure here comes from the
  // validated PermitDesignSnapshot — the sheet no longer derives feeder
  // current, re-rounds OCPDs, runs its own 120% math, or RESOLVES the
  // interconnection method (the old `|| !passes120` upgrade was a sheet
  // making an engineering decision). The engine decided; the sheet projects.
  const snap = getSnapshot(input);
  const auth = buildConductorAuthority(input, cad ?? undefined); // callout text carrier until conductors carry callouts (W2 gap)
  const busA = snap.electrical.poi.busbarA ?? 0;
  const mainA = snap.electrical.poi.mainBreakerA ?? 0;
  const feederOcpd = snap.electrical.feeder.ocpdA ?? 0;
  const feederOutputA = snap.electrical.feeder.currentA ?? 0;
  const feederContinuousA = snap.electrical.feeder.continuousA ?? feederOutputA * 1.25;
  const busLimit = busA * 1.2;
  const maxBackfeedA = busLimit - mainA;
  // §1: NO local recompute. The busbar verdict is the canonical snapshot value —
  // null stays null (PENDING). The old `?? (feederOcpd <= maxBackfeedA)` fallback
  // synthesized a PASS on a hole (the 27.5%-PASS class); dropped (gate 2/gate 4).
  const rulePasses = snap.electrical.poi.rulePasses ?? null;
  const passes120 = rulePasses === true;
  const isSupplySide = snap.project.interconnection.rule === '705.11';
  const feederConductorCallout = auth.acFeeder.conductorCallout || `${auth.acFeeder.wireGauge} THWN-2`;
  const feederPhaseCallout = feederConductorCallout.replace(/\s*\+\s*\d*\s*#[\d/]+\s*AWG\s*GND/ig, '');
  const feederGauge = snap.electrical.conductors.find(c => c.conductorId === snap.electrical.feeder.conductorId)?.gauge
    ?? auth.acFeeder.wireGauge;
  // FEEDER EGC = the snapshot's per-purpose grounding object for the feeder
  // segment (W2.1 — no "system EGC" abstraction). The 250.122 recompute is
  // retained only as a defensive floor when the object is absent.
  const _feederGnd = snap.electrical.groundingObjects.find(g => g.purpose === 'feeder-egc');
  const egcGauge = _feederGnd?.conductorSize
    ?? (feederOcpd > 0 ? getEGCSize(feederOcpd) : auth.egc.gauge);
  return {
    isSupplySide,
    methodLabel: isSupplySide ? 'Supply Side Tap — NEC 705.11' : 'Load Side — NEC 705.12(B)',
    necArticle: isSupplySide ? '705.11' : '705.12',
    feederOutputA,
    feederContinuousA,
    feederOcpd,
    feederWireGauge: feederGauge,
    feederConductorCallout,
    feederPhaseCallout,
    feederAmpacityA: auth.acFeeder.ampacityA,
    feederEgcGauge: egcGauge,
    busA,
    mainA,
    busLimit,
    maxBackfeedA,
    passes120,
    rulePasses,
  };
}

// ─── Wave 5B shared helpers: per-sub circuit schedule sections ──────────────
// One renderer for the sub-system heading line every hybrid electrical sheet
// prints — the sub's OWN equipment + topology, never a project-wide winner.
function subSectionLabel(sub: SubSystemConductorAuthority): string {
  const eq = sub.equipment;
  const inv = [eq.inverterManufacturer, eq.inverterModel].filter(s => s && s !== '—').join(' ');
  return `${SUB_LABEL[sub.key]} — ${sub.panelCount} MODULES${inv ? ` — ${inv}` : ''} (${sub.topology})`;
}

// ─── (Existing pages reused with minor upgrades) ─────────────────────────────


// ═══════════════════════════════════════════════════════════════
// PV-2B: GROUND ARRAY PLAN
// ═══════════════════════════════════════════════════════════════

export function pageNECCompliance(input: PermitInput, cad: CADModel, pageNum: number, totalPages: number): string {
  const { compliance, rulesResult, overrides, system } = input;
  const _auth = buildConductorAuthority(input, cad);
  const _ic = resolveInterconnection(input, cad);
  // §3 — the rules engine (legacy) reports voltage drop on a FLAT project-level
  // length (the 1.11% number). W2.1 classified the canonical basis as the routed
  // feeder segment (0.37%). Any VD row printed here MUST project the canonical
  // value so PV-4A never contradicts E-1/PV-4B on the same feeder.
  const _feedA = projectCanonicalFeeder(getSnapshot(input));
  const _remapVdRule = <T extends { title?: string; message?: string; value?: unknown; ruleId?: string; necReference?: string }>(rule: T): T => {
    const hay = `${rule.ruleId ?? ''} ${rule.title ?? ''} ${rule.message ?? ''}`.toLowerCase();
    const isVd = /voltage\s*drop|v-?drop/.test(hay);
    if (!isVd || _feedA.voltageDropPct == null) return rule;
    const canon = _feedA.voltageDropPct;
    return {
      ...rule,
      value: Number(canon.toFixed(2)),
      // rewrite any embedded legacy percentage in the message with the canonical one
      message: (rule.message ?? '').replace(/\d+(?:\.\d+)?\s*%/, `${canon.toFixed(2)}%`),
    };
  };
  // W4 §2/§11 (V11): the NEC edition comes from the ONE snapshot codeAuthority
  // record — never a sheet-local '2020'/'2023' literal (this was one half of the
  // 2023-vs-2020 disagreement). Unknown adoption renders PENDING, never a guess.
  const _cp = projectCodeAuthorityFromInput(input);
  const necVer = _cp.nec ?? PENDING_EDITION;
  // CAD-sourced electrical values — authoritative
  const cadTotalDcKw  = cad.totalDcKw  || system?.totalDcKw  || 0;
  const cadTotalPanels = cad.totalPanels || system?.totalPanels || 0;
  const _isRoof = isRoof(cad.systemType);
  const _isFence = isFence(cad.systemType);
  const _isGround = isGround(cad.systemType);
  // Micro overpower pairing — computed-system flags MICRO_DC_AC_PAIRING but
  // the snapshot's rulesResult (rules-engine) never carries it, so this sheet
  // declared "0 warnings / complies" while APP-A red-flagged the same pairing
  // on the same package. Same inputs APP-A uses.
  const _inv0 = system?.inverters?.[0];
  const _pairIsMicro = topologyToLegacy(getInverterTopology(input, cad)) === 'MICRO';
  const _pairModW = Number(_inv0?.strings?.[0]?.panelWatts)
    || (cadTotalPanels > 0 ? (cadTotalDcKw * 1000) / cadTotalPanels : 0);
  const _pairAcW = Number(_inv0?.acOutputKw) * 1000;
  const _pairRatio = _pairIsMicro && _pairAcW > 0 && _pairModW > 0 ? _pairModW / _pairAcW : 0;
  // Hybrid: inverters[0]-based pairing math is a project-wide-winner lie —
  // suppressed until the per-sub pairing check lands (Wave 6).
  const _pairWarn = !_auth.isHybrid && _pairRatio > 1.55;
  const _extraWarn = _pairWarn ? 1 : 0;

  // ══ W1a §compliance-summary — PV-4A's verdict DERIVES from the canonical
  // snapshot (permit-readiness blockers + canonical feeder holes + service-
  // topology PENDINGs + unresolved parity), NEVER the legacy rules-engine
  // counter that read `input.rulesResult`. That counter tallied only legacy
  // rules rows, so it printed "0 errors / 0 warnings / complies" while the
  // canonical feeder fill was PENDING and the supply-side tap length was
  // unmeasured. FAIL CLOSED (gate 4): any pending electrical authority forbids
  // a global PASS / zero-warning claim — the sheet prints PENDING honestly.
  const _snapA = getSnapshot(input);
  const _ELEC_BLOCKER_CODES = new Set([
    'ROUTE-LENGTH-ESTIMATE', 'FEEDER-RACEWAY-AUTHORITY', 'CONDUIT-FILL-PENDING',
    'TAP-LENGTH-PENDING', 'CONDUCTOR-AUTHORITY-INCOMPLETE', 'EQUIPMENT-IDENTITY-CONFLICT',
  ]);
  const _elecBlockers = (_snapA.permitReadiness?.blockers ?? []).filter(b => _ELEC_BLOCKER_CODES.has(b.code));
  const _elecPending: string[] = [];
  if (_feedA.hasHole) _elecPending.push(..._feedA.holes.map(h => `${h} unresolved`));
  if (_feedA.fillPct == null) _elecPending.push('feeder conduit fill pending');
  const _tapPending = (_snapA.electrical.serviceTopology ?? []).some(o =>
    o.constraints.some(c => c.state === 'pending'));
  if (_tapPending) _elecPending.push('supply-side tap-conductor length pending (≤10 ft — field verify)');
  // §1: with the legacy rules-engine advisory table retired, the module/micro
  // power-pairing warning surfaces here in the CANONICAL pending list (never a
  // separate legacy-counter row).
  if (_pairWarn) _elecPending.push(`module/micro power pairing ${_pairRatio.toFixed(2)} exceeds mfr range 1.55 — expect output clipping (${Math.round(_pairModW)}W on ${Math.round(_pairAcW)}W-AC)`);
  const _parityUnresolved = _snapA.electrical.parity?.unresolved ?? [];
  const _elecErrorCount = _elecBlockers.length + _parityUnresolved.length;
  const _elecWarnCount = _elecPending.length;
  // COMPLIES only when nothing is blocking AND nothing is pending (gate 4).
  const _elecComplies = _elecErrorCount === 0 && _elecWarnCount === 0;
  const _elecStatusLabel = _elecErrorCount > 0 ? 'BLOCKED — REVIEW REQUIRED'
    : _elecWarnCount > 0 ? 'PENDING — ITEMS OUTSTANDING' : 'COMPLIES';
  const _elecStatusColor = _elecErrorCount > 0 ? '#cc0000' : _elecWarnCount > 0 ? '#cc6600' : '#127a3e';
  const _elecSummaryCard = `
      <div class="rules-summary">
        <div class="rs" style="color:${_elecErrorCount > 0 ? '#cc0000' : '#000'}">
          <div class="rs-val">${_elecErrorCount}</div><div class="rs-lbl">Blocking</div>
        </div>
        <div class="rs" style="color:${_elecWarnCount > 0 ? '#cc6600' : '#000'}">
          <div class="rs-val">${_elecWarnCount}</div><div class="rs-lbl">Pending</div>
        </div>
        <div class="rs" style="color:${_elecStatusColor};grid-column:span 2">
          <div class="rs-val" style="font-size:13px">${_elecStatusLabel}</div><div class="rs-lbl">Electrical Compliance Status (snapshot ${_snapA.meta.snapshotId})</div>
        </div>
      </div>
      ${(_elecBlockers.length || _elecPending.length) ? `
      <table class="equip-table">
        <thead><tr><th style="width:22%">Type</th><th style="width:26%">Code</th><th>Outstanding Authority / Condition</th></tr></thead>
        <tbody>
          ${_elecBlockers.map(b => `<tr style="background:${statusBg('error')}"><td style="color:#cc0000;font-weight:bold">BLOCKING</td><td class="mono f-lg">${b.code}</td><td style="font-size:9px">${b.message}</td></tr>`).join('')}
          ${_parityUnresolved.map(p => `<tr style="background:${statusBg('error')}"><td style="color:#cc0000;font-weight:bold">BLOCKING</td><td class="mono f-lg">PARITY-UNRESOLVED</td><td style="font-size:9px">${p}</td></tr>`).join('')}
          ${_elecPending.map(p => `<tr style="background:${statusBg('warning')}"><td style="color:#cc6600;font-weight:bold">PENDING</td><td class="mono f-lg">—</td><td style="font-size:9px">${p}</td></tr>`).join('')}
        </tbody>
      </table>` : `<div style="padding:var(--xs);font-size:var(--f-md);border:var(--border);border-top:none;background:#f0f7f0;color:#127a3e;font-weight:700">No blocking or pending electrical authority items on the canonical snapshot.</div>`}`;
  return `
  <div class="page">
    ${titleBlock(input, 'PV-4A', 'NEC COMPLIANCE SHEET', pageNum, totalPages)}
    <div class="page-content">
      <div class="section-title">Electrical Compliance — ${_cp.tag('nec')}</div>
      <!-- W1a: AUTHORITATIVE electrical compliance status — snapshot-derived
           (blockers + canonical feeder + service topology + parity). The legacy
           rules-engine 4-counter card (errorCount/warningCount from
           input.rulesResult) is RETIRED: it under-counted (missed the PENDING
           feeder fill + tap length) and produced the false "0 errors / complies". -->
      ${_elecSummaryCard}
      ${/* §1 (closeout 2026-07-23): the legacy rules-engine advisory DETAIL table
           (input.rulesResult.rules) is RETIRED. It printed stale NEC rows sourced
           from a second engine (the 27.5% busbar-fill PASS class + duplicated
           705.12 literals) beside the canonical card. PV-4A now projects ONLY the
           canonical snapshot: the compliance card above enumerates every blocking/
           pending item (the pairing warning included). The info-table below shows
           the DERIVED DC/AC/grounding/interconnection facts — no local rule/counter/
           verdict, and the busbar cell is TRI-STATE (N/A on a supply-side tap,
           PENDING when the canonical snapshot carries no verdict, never a
           synthesized PASS). */''}
      ${compliance.electrical ? `
      <table class="info-table">
        <tr><td class="il">DC Size</td><td class="iv">${compliance.electrical.summary?.totalDcKw?.toFixed(2)} kW</td><td class="il">AC Capacity</td><td class="iv">${compliance.electrical.summary?.totalAcKw?.toFixed(2)} kW</td></tr>
        <tr><td class="il">Grounding Conductor</td><td class="iv">${_ic.feederEgcGauge}</td><td class="il">Interconnection</td><td class="iv" style="color:#000">${_ic.isSupplySide ? 'SUPPLY-SIDE TAP — 120% N/A (705.11)' : (_ic.rulePasses == null ? 'PENDING — busbar evaluation not on canonical snapshot' : (_ic.rulePasses ? '✓ 120% RULE PASS' : '✗ FAIL'))}</td></tr>
      </table>` : '<p style="color:#555;font-style:italic;padding:5px;text-align:center;font-size:8.5px">Run compliance check to populate this section.</p>'}
      <!-- Calculation Methodology -->
      <div class="section-title">Calculation Methodology — NEC ${necVer} Article 690</div>
      <table class="equip-table">
        <thead><tr><th style="width:22%">Parameter</th><th style="width:35%">Calculation Method</th><th style="width:25%">Code Reference</th><th>Notes</th></tr></thead>
        <tbody>
          <tr><td class="fw7">Max System Voltage</td><td>Voc × Temp. Correction Factor (Table 690.7(A))</td><td class="mono">NEC 690.7(A)</td><td>Corrected for lowest expected ambient temp.</td></tr>
          <tr class="bg-lt"><td class="fw7">Max Circuit Current</td><td>Isc × 1.25</td><td class="mono">NEC 690.8(A)(1)</td><td>Continuous duty factor</td></tr>
          <tr><td class="fw7">OCPD Rating</td><td>Max Circuit Current × 1.25</td><td class="mono">NEC 690.8(B)(1)</td><td>Or next standard fuse/breaker size</td></tr>
          <tr class="bg-lt"><td class="fw7">Conductor Ampacity</td><td>≥ Max Circuit Current (after derating)</td><td class="mono">NEC 690.8(B), 310.15</td><td>Corrected for temp. and conduit fill</td></tr>
          ${_ic.isSupplySide
            ? `<tr><td class="fw7">Interconnection</td><td>Supply-side tap: conductors ≥ 1.25 × PV output current; fused disconnect at tap</td><td class="mono">NEC 705.11</td><td>Line side of service disconnect — 120% rule N/A</td></tr>`
            : `<tr><td class="fw7">Backfeed Breaker</td><td>120% Rule: Main + PV ≤ Busbar × 1.2</td><td class="mono">NEC 705.12(B)(2)(3)</td><td>Load-side connection method</td></tr>`}
          <tr class="bg-lt"><td class="fw7">EGC Sizing</td><td>Per NEC Table 250.122 based on OCPD</td><td class="mono">NEC 690.45, 250.122</td><td>Min. #12 AWG Cu for ≤ 20A circuits</td></tr>
          <tr><td class="fw7">Voltage Drop</td><td>Vd = (2 × L × I × R) / 1000</td><td class="mono">NEC 210.19(A) FPN</td><td>Target ≤ 2% branch, ≤ 3% feeder</td></tr>
          <tr class="bg-lt"><td class="fw7">Conduit Fill</td><td>Per NEC Chapter 9, Table 1</td><td class="mono">NEC Ch. 9 Table 1</td><td>Max 40% fill for 3+ conductors</td></tr>
          <tr><td class="fw7">Rapid Shutdown</td><td>Array-level: ≤ 80V within 30s</td><td class="mono">NEC 690.12</td><td>Module-level per 690.12(B)(2)</td></tr>
          <tr class="bg-lt"><td class="fw7">Ground-Fault Protection</td><td>GFDI required per system type</td><td class="mono">NEC 690.41, 690.5</td><td>Inverter-integrated or standalone</td></tr>
        </tbody>
      </table>
      ${(() => {
        // ── Wave 5B: HYBRID — one circuit schedule PER SUB-SYSTEM ──────────
        // Each sub prints ITS OWN branch/string set from its own authority
        // entry (topology, perMicroA, OCPD from the sub's own equipment) —
        // never one 94-modules-single-branch-set claim.
        if (_auth.isHybrid) {
          return _auth.subSystems.map(sub => {
            if (sub.isMicro) {
              const rows = sub.microBranches.map((b, i) =>
                `<tr style="background:${i % 2 ? '#f5f5f5' : '#fff'}">` +
                `<td class="fw9 mono">B${b.index}</td>` +
                `<td>${b.deviceCount} × microinverter</td>` +
                `<td style="text-align:right;font-family:monospace">${b.branchCurrentA.toFixed(1)} A</td>` +
                `<td style="text-align:right;font-family:monospace">${b.continuousA.toFixed(1)} A</td>` +
                `<td style="text-align:center;font-family:monospace">${b.ocpdAmps} A</td>` +
                `<td>${b.conductorCallout}</td>` +
                `<td>AC Combiner / Subpanel — see E-1</td>` +
                `</tr>`).join('');
              return `
      <div class="section-title">AC Branch Circuit Schedule — ${subSectionLabel(sub)} — NEC 690.8(A)</div>
      <table class="equip-table">
        <thead><tr><th style="width:8%">Branch</th><th style="width:20%">Devices</th><th style="width:12%">Output</th><th style="width:14%">× 1.25 Cont.</th><th style="width:10%">OCPD</th><th style="width:20%">Conductor</th><th>Terminates</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="7" class="center">Branch plan pending module placement</td></tr>`}</tbody>
      </table>`;
            }
            const rows = sub.dcStrings.map((s, i) =>
              `<tr style="background:${i % 2 ? '#f5f5f5' : '#fff'}">` +
              `<td class="fw9 mono">${s.label}</td>` +
              `<td>DC string</td>` +
              `<td style="text-align:right;font-family:monospace">${s.ampacityA != null ? s.ampacityA.toFixed(2) + ' A' : '—'}</td>` +
              `<td style="text-align:center;font-family:monospace">${s.ocpdAmps != null ? s.ocpdAmps + ' A' : '—'}</td>` +
              `<td>${s.wireGauge} USE-2/PV Wire</td>` +
              `<td style="text-align:right;font-family:monospace">${s.voltageDropPct != null ? s.voltageDropPct.toFixed(2) + '%' : '—'}</td>` +
              `<td style="text-align:right;font-family:monospace">${s.lengthFt != null ? s.lengthFt + ' ft' : '—'}</td>` +
              `</tr>`).join('');
            return `
      <div class="section-title">DC String Schedule — ${subSectionLabel(sub)} — NEC 690.8(A)</div>
      <table class="equip-table">
        <thead><tr><th style="width:10%">String</th><th style="width:16%">Circuit</th><th style="width:14%">Isc × 1.25</th><th style="width:10%">OCPD</th><th style="width:22%">Conductor</th><th style="width:12%">V-Drop</th><th>Length</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="7" class="center">String plan pending — see PV-4B</td></tr>`}</tbody>
      </table>`;
          }).join('');
        }
        // AC branch circuit schedule (micro topology) — the sheet's bottom
        // 60% shipped blank while the branch plan existed in the engine.
        if (!_pairIsMicro) return '';
        const _pp = (input.project.panelPositions ?? []) as Array<{ id: string; planeId?: string; arrayId?: string; row?: number; col?: number; lat?: number; lng?: number }>;
        if (!_pp.length || !(_pairAcW > 0)) return '';
        // Branch OCPD / conductor / EGC come from the shared conductor
        // authority — the SAME values E-1, PV-4B and the BOM print, so this
        // schedule can never show a flat 20A/#10 while the SLD shows another.
        const _rows = _auth.microBranches.map((b, i) => {
          return `<tr style="background:${i % 2 ? '#f5f5f5' : '#fff'}">` +
            `<td class="fw9 mono">B${b.index}</td>` +
            `<td>${b.deviceCount} × microinverter</td>` +
            `<td style="text-align:right;font-family:monospace">${b.branchCurrentA.toFixed(1)} A</td>` +
            `<td style="text-align:right;font-family:monospace">${b.continuousA.toFixed(1)} A</td>` +
            `<td style="text-align:center;font-family:monospace">${b.ocpdAmps} A</td>` +
            `<td>${b.conductorCallout}</td>` +
            `<td>${i < 4 ? 'IQ Combiner' : 'AC Subpanel (see E-1)'}</td>` +
            `</tr>`;
        }).join('');
        const _pv4aBos = buildIntegratedEquipment(input, cad);
        const _bosNote = _pv4aBos.brains
          ? `<div style="padding:var(--xs);font-size:var(--f-md);line-height:1.5;border:var(--border);border-top:none;background:#f0f4f8;">` +
            `<strong>AC AGGREGATION — ${_pv4aBos.brains.brand.toUpperCase()} ${_pv4aBos.brains.model.toUpperCase()}:</strong> ` +
            `The AC branch circuits terminate at the ${_pv4aBos.brains.model}, a single integrated device providing ${_pv4aBos.brains.roleSummary.toLowerCase()}` +
            `${_pv4aBos.branchSlots ? ` (${_pv4aBos.branchSlots}-position)` : ''}. ` +
            `${_pv4aBos.providesAcDisconnect ? 'Its integral load-break serves as the PV-system AC disconnecting means per NEC 690.13; a separate exterior AC disconnect is provided only where required by the AHJ/utility. ' : ''}` +
            `${_pv4aBos.hasIntegratedGateway ? 'The integrated gateway provides production/consumption metering and monitoring per NEC 690.4. ' : ''}` +
            `Output feeds the point of interconnection per NEC 705.10.` +
            `${_pv4aBos.branchSlotWarning ? ` <span style="color:#cc6600;font-weight:700;">${_pv4aBos.branchSlotWarning}</span>` : ''}` +
            `</div>`
          : '';
        return `
      <div class="section-title">AC Branch Circuit Schedule — NEC 690.8(A)</div>
      <table class="equip-table">
        <thead><tr><th style="width:8%">Branch</th><th style="width:20%">Devices</th><th style="width:12%">Output</th><th style="width:14%">× 1.25 Cont.</th><th style="width:10%">OCPD</th><th style="width:20%">Conductor</th><th>Terminates</th></tr></thead>
        <tbody>${_rows}</tbody>
      </table>${_bosNote}`;
      })()}

      <div class="section-title">Interconnection Summary — ${_ic.isSupplySide ? 'NEC 705.11 (Supply-Side Tap)' : 'NEC 705.12 (Load-Side)'}</div>
      <table class="info-table">
        <tr>
          <td class="il">Method</td><td class="iv">${_ic.methodLabel}</td>
          <td class="il">PV Output Current</td><td class="iv">${_ic.feederOutputA.toFixed(1)} A</td>
        </tr>
        <tr>
          <td class="il">Continuous (× 1.25)</td><td class="iv">${_ic.feederContinuousA.toFixed(1)} A</td>
          <td class="il">${_ic.isSupplySide ? 'Tap OCPD' : 'Backfeed Breaker'}</td><td class="iv">${_ic.feederOcpd} A ${_ic.isSupplySide ? 'fused disconnect' : '2-pole breaker'}</td>
        </tr>
        <tr>
          <td class="il">Connection Point</td><td class="iv" colspan="3">${_ic.isSupplySide ? 'Line side of the service disconnecting means — 120% busbar rule (NEC 705.12(B)) not applicable' : 'Load center busbar — 120% rule per NEC 705.12(B)(2)'}</td>
        </tr>
      </table>

      <div style="padding:var(--xs);font-size:var(--f-md);line-height:1.6;border:var(--border);border-top:none;background:#fafafa;">
        <strong>ENGINEERING INTERPRETATION:</strong> The above methodology is applied to all DC and AC circuits in this system.
        Each conductor, overcurrent device, and disconnect has been sized using the calculation chain shown.
        Temperature correction factors per NEC 310.15(B)(1) are applied. ${_auth.isHybrid ? 'Rooftop temperature adders per NEC 310.15(B)(3)(c) apply to ROOF sub-system circuits only \u2014 ground and fence sub-system circuits use standard ambient (no rooftop adder).' : _isRoof ? 'Rooftop temperature adders per NEC 310.15(B)(3)(c) are applied where conduit is routed on or above the roof surface.' : _isFence ? 'No rooftop temperature adder applies \u2014 fence-mounted system (NEC 310.15(B)(3)(c) N/A).' : 'No rooftop temperature adder applies \u2014 ground-mounted system (NEC 310.15(B)(3)(c) N/A).'}
        ${_elecComplies ? 'All calculations produce compliant results with no blocking or pending electrical authority items on the canonical snapshot.' : 'Blocking or pending electrical authority items remain — resolve the items listed in the compliance status above before submission.'}
      </div>
      <div style="padding:var(--xs);margin-top:var(--sm);font-size:var(--f-md);line-height:1.5;border:2px solid #000;background:#fff;">
        <strong>PAGE CONCLUSION — NEC COMPLIANCE:</strong>
        This ${cadTotalDcKw.toFixed(2)} kW DC / ${cadTotalPanels} module ${_auth.isHybrid ? `HYBRID photovoltaic system (${_auth.subSystems.map(s => `${SUB_LABEL[s.key]}: ${s.panelCount}`).join(' · ')})` : 'photovoltaic system'} has been evaluated against NEC ${necVer} Articles 690, 705, 250, and 310.
        ${_auth.isHybrid ? 'Note: Rooftop temperature adder (NEC 310.15(B)(3)(c)) applies to the ROOF sub-system only.' : _isRoof ? '' : _isFence ? 'Note: Rooftop temperature adder (NEC 310.15(B)(3)(c)) does NOT apply — this is a fence-mounted system.' : 'Note: Rooftop temperature adder (NEC 310.15(B)(3)(c)) does NOT apply — this is a ground-mounted system.'}
        The canonical snapshot reports ${_elecErrorCount} blocking and ${_elecWarnCount} pending electrical authority item(s).${'' /* §1 (closeout 2026-07-23): the legacy rules-engine counter parenthetical is RETIRED — PV-4A reports ONLY canonical snapshot counts, no second-engine tally. */}
        Interconnection is resolved to a ${_ic.isSupplySide ? `SUPPLY-SIDE (line-side) tap per NEC 705.11 (${_ic.feederOcpd} A fused AC disconnect ahead of the ${_ic.mainA} A service disconnect) — the 120% busbar rule of NEC 705.12(B) does not apply` : `LOAD-SIDE connection per NEC 705.12(B) (${_ic.feederOcpd} A backfeed breaker; ${_ic.mainA} A main + ${_ic.feederOcpd} A ≤ ${_ic.busLimit.toFixed(0)} A busbar limit)`}.
        System configuration ${_elecComplies ? 'complies with' : 'requires review per'} NEC ${necVer} and applicable local amendments.
      </div>

      ${overrides && overrides.length > 0 ? `
      <div class="section-title">Engineering Overrides Log</div>
      <table class="equip-table">
        <thead><tr><th>Field</th><th>Override Value</th><th>Justification</th><th>Engineer</th><th>Date</th></tr></thead>
        <tbody>
          ${overrides.map(o => `
          <tr style="background:#f5f5f5">
            <td class="mono f-lg">${o.field}</td>
            <td style="color:#000;font-weight:bold">${o.overrideValue}</td>
            <td>${o.justification}</td>
            <td>${o.engineer}</td>
            <td>${new Date(o.timestamp).toLocaleDateString()}</td>
          </tr>`).join('')}
        </tbody>
      </table>` : ''}
    </div>
  </div>`;
}

export function pageConductorSchedule(input: PermitInput, cad: CADModel, pageNum: number, totalPages: number): string {
  const { project, system, compliance } = input;
  const elec = compliance.electrical;
  const _auth = buildConductorAuthority(input, cad);
  const _ic = resolveInterconnection(input, cad);
  // §3 — canonical feeder: raceway/size/VD/length/callout all single-sourced
  // from the ONE feeder segment. Replaces project.conduitType, project.wireLength,
  // elec.acVoltageDrop and elec.conduitFill (each of which was an independent,
  // divergent source: the "1-1/4\" 3/4\" EMT" callout + 1.11%-vs-0.37% conflict).
  const _snap = getSnapshot(input);
  const _feed = projectCanonicalFeeder(_snap);
  // §5 — canonical service-interconnection objects the supply-side text projects.
  const _svcTopo = _snap.electrical.serviceTopology ?? [];
  const _svc = (t: string) => _svcTopo.find(o => o.type === t) ?? null;
  const _feedLenTxt = _feed.oneWayFt != null ? `${_feed.oneWayFt} ft` : 'PENDING';
  const _feedVdTxt = _feed.voltageDropPct != null ? `${_feed.voltageDropPct.toFixed(2)}%` : 'PENDING';
  // §2 (closeout 2026-07-23): per-sub/string conduit cells DERIVE from the
  // canonical raceway descriptor (the ONE route-description accessor) — never
  // `project.conduitType || 'EMT'` (the fabricated EMT beside a PVC run). Absent
  // raceway authority prints an honest PENDING, never a default.
  const _rwDesc = projectRacewayDescriptor(_snap);
  const _condCell = _rwDesc.present
    ? (_rwDesc.entries[0].tradeSizeIn ? `${_rwDesc.entries[0].racewayType} ${_rwDesc.entries[0].tradeSizeIn}` : _rwDesc.entries[0].racewayType)
    : (project.conduitType ? project.conduitType : 'PENDING');
  const _feedCallout = _feed.conductorCallout ?? 'PENDING — feeder conductor authority incomplete';
  const _feedConduit = _feed.conduitLabel ?? 'PENDING';
  // W4 §2/§11 (V11): NEC/ASCE editions on this sheet project from the ONE
  // snapshot codeAuthority record — no sheet-local 'ASCE 7-22' literal.
  const _cpCS = projectCodeAuthorityFromInput(input);
  // CAD-sourced electrical values
  const cadTotalPanels = cad.totalPanels;
  const cadTotalDcKw   = cad.totalDcKw;
  const _isRoof = isRoof(cad.systemType);
  const _isFence = isFence(cad.systemType);
  const _isGround = isGround(cad.systemType);
  return `
  <div class="page">
    ${titleBlock(input, 'PV-4B', 'CONDUCTOR & CONDUIT SCHEDULE', pageNum, totalPages)}
    <div class="page-content">
      <div class="section-title">Conductor Schedule — NEC 310.15 Ampacity Compliance</div>
      <table class="equip-table">
        <thead>
          <tr><th>Circuit</th><th>From</th><th>To</th><th>Conductor</th><th>Ampacity</th><th>OCPD</th><th>V-Drop %</th><th>Conduit</th><th>Length</th></tr>
        </thead>
        <tbody>
          ${(() => {
            // ── Wave 5B: HYBRID — per-sub conductor sections + ONE shared
            // service section. Each sub's rows come from ITS OWN authority
            // entry (I-3): a fence optimizer sub prints DC strings, a roof
            // micro sub prints AC branches — never one topology fork over
            // the whole project's panels.
            if (_auth.isHybrid) {
              const subHdr = (label: string) =>
                `<tr style="background:#000;color:#fff;font-weight:900;"><td colspan="9" style="letter-spacing:0.6px;">${label}</td></tr>`;
              const sections = _auth.subSystems.map(sub => {
                if (sub.isMicro) {
                  return subHdr(subSectionLabel(sub)) + sub.microBranches.map(b => `
              <tr>
                <td class="fw7">AC Branch ${b.index}</td>
                <td>${b.deviceCount} × Microinverter</td>
                <td>AC Combiner / Panel</td>
                <td>${b.wireGauge} THWN-2</td>
                <td>${b.branchCurrentA.toFixed(1)}A</td>
                <td>${b.ocpdAmps}A</td>
                <td>—</td>
                <td>${_condCell}</td>
                <td>—</td>
              </tr>`).join('');
                }
                return subHdr(subSectionLabel(sub)) + sub.dcStrings.map(s => `
              <tr>
                <td class="fw7">${s.label}</td>
                <td>String ${s.invIdx + 1}-${s.strIdx + 1}</td>
                <td>Inverter ${s.invIdx + 1}</td>
                <td>${s.wireGauge} USE-2/PV Wire</td>
                <td>${s.ampacityA != null ? s.ampacityA.toFixed(2) + 'A' : '—'}</td>
                <td>${s.ocpdAmps != null ? s.ocpdAmps + 'A' : '—'}</td>
                <td>${s.voltageDropPct != null ? s.voltageDropPct.toFixed(2) + '%' : '—'}</td>
                <td>${_condCell}</td>
                <td>${s.lengthFt != null ? s.lengthFt + ' ft' : '—'}</td>
              </tr>`).join('');
              }).join('');
              // Per-sub AC feeders toward the POI (Σ into the shared service run).
              const feeders = subHdr('SHARED SERVICE — POINT OF INTERCONNECTION (NEC 705)')
                + _auth.subSystems.map(sub => `
              <tr>
                <td class="fw7">${SUB_LABEL[sub.key]} AC Feeder</td>
                <td>${SUB_LABEL[sub.key]} sub-system</td>
                <td>POI (shared service)</td>
                <td>${sub.acSubFeeder.wireGauge} THWN-2</td>
                <td>${sub.acSubFeeder.currentA.toFixed(1)}A</td>
                <td>${sub.acSubFeeder.ocpdAmps != null ? sub.acSubFeeder.ocpdAmps + 'A' : '—'}</td>
                <td>—</td>
                <td>${_condCell}</td>
                <td>—</td>
              </tr>`).join('');
              return sections + feeders;
            }
            // FIX v47.341: Topology-aware DC/AC branch rows
            const _csTopo = topologyToLegacy(getInverterTopology(input, cad));
            if (_csTopo === 'MICRO') {
              // Microinverter: No traditional DC strings — show AC branch circuit
              // rows sourced from the shared conductor authority (same branch
              // OCPD/gauge as PV-4A + E-1). The old code hardcoded '#10 AWG' and
              // re-derived the OCPD locally.
              // W1c: conduit + length come from the CANONICAL branch run segment,
              // NOT project.conduitType / project.wireLength. Micro AC branch
              // conductors on the Q-Cable trunk are FREE-AIR (NEC 690.31(C)); the
              // old code stamped the feeder's flat 60 ft "EMT" onto every branch.
              const _branch = projectCanonicalBranch(_snap);
              const _brConduit = _branch.conduitLabel ?? 'FREE AIR (Q-CABLE / TC-ER)';
              const _brLenTxt = _branch.oneWayFt != null ? `${_branch.oneWayFt} ft` : '—';
              // §3/§4 — the shared jbox→combiner home-run raceway as its OWN row.
              // The branch CONDUCTORS are open-air Q-Cable (rows above); the shared
              // conduit carries all branches bundled. Never one merged whole-branch
              // "95 ft #12 in 1-1/4\" PVC" string spanning two wiring methods.
              const _hr = projectSharedBranchRaceway(_snap);
              const _hrRow = _hr.present ? `
              <tr style="background:#eef4fa">
                <td class="fw7">Branch Home-Run</td>
                <td>Roof J-Box (${_hr.sharedCircuitCount ?? '—'} branches)</td>
                <td>AC Combiner</td>
                <td>${_hr.currentCarryingCount ?? '—'}×${_branch.gauge ?? '#10 AWG'} THWN-2 (shared)</td>
                <td>—</td>
                <td>—</td>
                <td>${_hr.fillPct != null ? _hr.fillPct.toFixed(1) + '%' : '—'}</td>
                <td>${_hr.conduitLabel ?? (_hr.racewayType ?? 'PENDING')}</td>
                <td>${_hr.oneWayFt != null ? _hr.oneWayFt + ' ft' : '—'}</td>
              </tr>` : '';
              return _auth.microBranches.map((b) => `
              <tr>
                <td class="fw7">AC Branch ${b.index}</td>
                <td>${b.deviceCount} × Microinverter</td>
                <td>Roof J-Box (open air)</td>
                <td>${b.wireGauge} THWN-2</td>
                <td>${b.branchCurrentA.toFixed(1)}A</td>
                <td>${b.ocpdAmps}A</td>
                <td>—</td>
                <td>${_brConduit}</td>
                <td>${_brLenTxt}</td>
              </tr>`).join('') + _hrRow;
            } else {
              // String / Optimizer: Show traditional DC string rows
              return (system.inverters?.flatMap((inv, invIdx) =>
                inv.strings?.map((str, strIdx) => `
                <tr>
                  <td class="fw7">DC ${invIdx + 1}-${strIdx + 1}</td>
                  <td>String ${invIdx + 1}-${strIdx + 1}</td>
                  <td>Inverter ${invIdx + 1}</td>
                  <td>${str.wireGauge} USE-2/PV Wire</td>
                  <td>${str.isc ? (Math.ceil(str.isc * 1.25 * 100) / 100).toFixed(2) + 'A' : (str.ampacity ? str.ampacity + 'A' : '—')}</td>
                  <td>${str.isc ? necNextStandardOcpd(str.isc * 1.56) + 'A' : (str.ocpd ? str.ocpd + 'A' : '—')}</td>
                  <td>${str.voltageDrop != null ? str.voltageDrop.toFixed(2) + '%' : '—'}</td>
                  <td>${_condCell}</td>
                  <td>${str.wireLength} ft</td>
                </tr>`) || []
              ) || []).join('');
            }
          })()}
          ${elec ? `
          <tr style="background:#f5f5f5">
            <td class="fw7">AC Output</td>
            <td>Inverter(s)</td><td>${_ic.isSupplySide ? 'Supply-Side Tap @ Service' : 'Main Panel'}</td>
            <td>${_feedCallout}</td>
            <td>${_ic.feederAmpacityA != null ? _ic.feederAmpacityA.toFixed(1) : '—'}A</td>
            <td>${_ic.feederOcpd || '—'}A</td>
            <td style="color:${(_feed.voltageDropPct || 0) > 3 ? '#cc0000' : '#000'}">${_feedVdTxt}</td>
            <td>${_feedConduit}</td>
            <td>${_feedLenTxt}</td>
          </tr>
          <tr style="background:#fff">
            <td class="fw7">EGC</td>
            <td>Array</td><td>${_ic.isSupplySide ? 'AC Disconnect (ground bus)' : 'Main Panel'}</td>
            <td>${_ic.feederEgcGauge} bare Cu</td>
            <td>—</td><td>—</td><td>—</td>
            <td>${_feedConduit}</td>
            <td>${_feedLenTxt}</td>
          </tr>` : ''}
        </tbody>
      </table>
      ${(_feed.raceway || _feed.tradeSizeIn) ? `
      <div class="section-title">Conduit Fill Analysis — NEC Chapter 9</div>
      <table class="info-table">
        <tr><td class="il">Conduit Type</td><td class="iv">${_feed.raceway ?? 'PENDING'}</td><td class="il">Conduit Size</td><td class="iv">${_feed.tradeSizeIn ?? 'PENDING'}</td></tr>
        <tr><td class="il">Fill Percentage</td><td class="iv" style="color:${(_feed.fillPct ?? 0) > 40 ? '#cc0000' : '#000'};font-weight:bold">${_feed.fillPct != null ? `${_feed.fillPct.toFixed(1)}% (Max: 40%)` : 'PENDING (Max: 40%)'}</td>
        <td class="il">Status</td><td class="iv" style="color:${_feed.fillPct == null ? '#cc6600' : (_feed.fillPct <= 40 ? '#000' : '#cc0000')};font-weight:bold">${_feed.fillPct == null ? 'PENDING' : (_feed.fillPct <= 40 ? '✓ PASS' : '✗ FAIL')}</td></tr>
      </table>` : ''}
      ${elec ? `
      <div class="section-title">Voltage Drop Calculation — NEC 210.19(A) Informational Note</div>
      <table class="equip-table">
        <thead><tr><th>Circuit</th><th>Length (ft)</th><th>Conductor</th><th>Amps</th><th>Voltage</th><th>V-Drop (V)</th><th>V-Drop %</th><th>Limit</th><th>Status</th></tr></thead>
        <tbody>
          <tr>
            <td class="fw7">AC Output</td>
            <td class="tr">${_feedLenTxt}</td>
            <td>${_feedCallout} Cu</td>
            <!-- W1d: the Amps column states the OPERATING current the voltage-drop
                 formula actually used (Vd = 2·L·I·R/1000, I = PV operating current),
                 NOT the feeder OCPD rating. Printing the 60 A OCPD here made the VD
                 look computed at 60 A while the engine derived it at ~45 A. -->
            <td class="tr">${_feed.currentA != null ? _feed.currentA.toFixed(1) : (_ic.feederOutputA ? _ic.feederOutputA.toFixed(1) : '—')}A<span style="color:#777;font-size:7px"> (op)</span></td>
            <td class="tr">240V</td>
            <td class="tr mono">${_feed.voltageDropPct != null ? (_feed.voltageDropPct * 240 / 100).toFixed(2) + 'V' : 'PENDING'}</td>
            <td class="tr mono fw7" style="color:${(_feed.voltageDropPct || 0) > 3 ? '#cc0000' : '#000'}">${_feedVdTxt}</td>
            <td class="tr">≤ 3.0%</td>
            <td class="center fw7" style="color:${_feed.voltageDropPct == null ? '#cc6600' : ((_feed.voltageDropPct || 0) > 3 ? '#cc0000' : '#000')}">${_feed.voltageDropPct == null ? 'PENDING' : ((_feed.voltageDropPct || 0) <= 3 ? '✓ PASS' : '✗ REVIEW')}</td>
          </tr>
        </tbody>
      </table>
      <div style="padding:var(--xs);font-size:var(--f-md);line-height:1.5;border:var(--border);border-top:none;background:#fafafa;">
        <strong>VOLTAGE DROP INTERPRETATION:</strong>
        Calculated AC feeder voltage drop is ${_feedVdTxt} over a ${_feedLenTxt} conductor run using ${_feedCallout} copper${_feed.currentA != null ? `, at the PV operating current of ${_feed.currentA.toFixed(1)} A (the feeder OCPD is ${_ic.feederOcpd || '—'} A — the OCPD rating is not the load current used in the Vd formula)` : ''}.
        NEC 210.19(A) Informational Note recommends ≤ 3% for feeders and ≤ 5% total (branch + feeder combined).
        ${_feed.voltageDropPct == null ? 'Feeder voltage drop is pending conductor authority — resolve before submission.' : ((_feed.voltageDropPct || 0) <= 3 ? 'The calculated drop is within recommended limits. No conductor upsizing is required.' : 'The calculated drop exceeds 3%. Consider upsizing conductors or reducing run length.')}
      </div>
      ${''/* Formula-tutorial box removed — code-book pedagogy that displaced
           project content on the fixed sheet; the calc row + interpretation
           above carry the engineering result. */}` : ''}

      ${/* Generic NEC reference tables (temp-correction factors, rooftop adder
           matrix) removed — they duplicated code-book content, pushed the
           project-specific LOAD CALC off the fixed sheet (silent clipping),
           and PV-4A's methodology table already cites the sections. */''}
      ${(_isRoof || (_auth.isHybrid && _auth.subSystems.some(s => s.key === 'roof'))) ? `
      <div style="padding:var(--xs);font-size:var(--f-md);line-height:1.5;border:var(--border);background:#fafafa;">
        <strong>TEMPERATURE DERATING NOTE${_auth.isHybrid ? ' — ROOF SUB-SYSTEM' : ''}:</strong>
        Conductors routed in conduit on the roof surface are subject to the rooftop temperature adder per NEC 310.15(B)(3)(c).
        All conductor selections account for the worst-case temperature condition.
        USE-2 and THWN-2 conductors (90°C rated) are specified to maximize ampacity retention.
      </div>` : ''}
      ${(_auth.isHybrid ? _auth.subSystems.some(s => s.key === 'fence') : _isFence) ? `
      <div class="section-title">Fence Array Wiring Notes — NEC 690, ${_cpCS.tag('asce')} §29</div>
      <div style="padding:var(--xs);font-size:var(--f-md);line-height:1.6;border:var(--border);background:#fafafa;">
        <strong>FENCE WIRING REQUIREMENTS${_auth.isHybrid ? ' — FENCE SUB-SYSTEM' : ''}:</strong><br/>
        • DC conductors: USE-2 or PV wire rated for outdoor/wet locations per NEC 690.31(C)<br/>
        • Conduit: RMC or IMC required below 8 ft above grade per NEC 690.31(G)<br/>
        • Rapid shutdown: Module-level shutdown required per NEC 690.12(B)(2)<br/>
        • Temperature correction: Standard ambient (no rooftop adder) — fence not on roof surface<br/>
        • Grounding: All metallic fence posts bonded to EGC per NEC 250.169 and 690.43
      </div>` : ''}
      ${(_auth.isHybrid ? _auth.subSystems.some(s => s.key === 'ground') : (!_isRoof && !_isFence)) ? `
      <div class="section-title">Ground Mount Wiring Notes — NEC 690</div>
      <div style="padding:var(--xs);font-size:var(--f-md);line-height:1.6;border:var(--border);background:#fafafa;">
        <strong>GROUND MOUNT WIRING REQUIREMENTS${_auth.isHybrid ? ' — GROUND SUB-SYSTEM' : ''}:</strong><br/>
        • DC conductors: USE-2 or PV wire per NEC 690.31(C)<br/>
        • Underground conductors: USE-2 direct burial or conduit per NEC 690.31(E)<br/>
        • Temperature correction: Standard ambient — no rooftop adder applies<br/>
        • Rapid shutdown: System-level per NEC 690.12(B)(1) acceptable for ground mount<br/>
        • Grounding: Per NEC 690.47 and 250.166
      </div>` : ''}
      ${_auth.isHybrid ? `
      <div style="padding:var(--xs);font-size:var(--f-md);line-height:1.5;border:var(--border);background:#fff8e1;">
        <strong>SHARED TRENCH / SEPARATE CONDUITS (HYBRID):</strong>
        Where two sub-systems run toward the point of interconnection along a combinable path, ONE shared trench is
        permitted, but each sub-system keeps its OWN conduit — conductors of different sub-systems shall not share a
        raceway in this design (no shared-raceway derating scenario). Field-verify routing.
      </div>` : ''}

      ${/* Full NEC code-reference table removed — duplicated PV-4A's
           methodology table row-for-row and displaced project content. */''}
      <div class="section-title">Service &amp; Interconnection — NEC 705</div>
      ${(() => {
        // Single-sourced from resolveInterconnection (a snapshot projection) —
        // the SAME bus/main/OCPD and method PV-4A, the cover and PV-4B print.
        const busA = _ic.busA;
        const mainA = _ic.mainA;
        const acKw = system.totalAcKw || 0;
        const acAmps = _ic.feederOutputA;
        const continuousA = _ic.feederContinuousA;  // NEC 690.8(A)(1)
        const bfAmps = _ic.feederOcpd;
        const busLimit = _ic.busLimit;
        const maxBfAllowed = _ic.maxBackfeedA;
        const passes120 = _ic.passes120;
        const _rulePasses = _ic.rulePasses;   // §1 tri-state (null ⇒ PENDING)
        const _lcSupply = _ic.isSupplySide;
        // D-4 (Ray, binding 2026-07-20): the former NEC 220.82 dwelling-load
        // table FABRICATED its inputs (square footage assumed from service
        // amps, invented appliance and HVAC loads) and is REMOVED. A load
        // calculation renders only when verified source inputs + calculation
        // provenance exist (none do today). The interconnection compliance
        // path below does not require one: supply-side taps are governed by
        // NEC 705.11, and the load-side path is governed by the 120% busbar
        // rule — neither depends on a dwelling load calc.
        return `
        <table class="equip-table">
          <thead><tr>
            <th style="width:5%">Step</th>
            <th style="width:28%">Description</th>
            <th style="width:42%">Calculation</th>
            <th style="width:25%">Result</th>
          </tr></thead>
          <tbody>
            <tr ><td class="fw9 mono">1</td><td>Dwelling Load Calculation</td><td>Not provided — no verified dwelling load inputs on file. Not required for the selected interconnection method (${_lcSupply ? 'NEC 705.11 supply-side tap' : 'NEC 705.12(B) 120% busbar rule'}).</td><td class="tr fw9">N/A</td></tr>
            <tr class="bg-lt"><td class="fw9 mono">2</td><td>Service Rating</td><td>${mainA}A main service disconnect / ${busA}A busbar</td><td class="tr fw9">${mainA}A</td></tr>
            <tr ><td class="fw9 mono">3</td><td>PV AC Output</td><td>${acKw.toFixed(2)} kW AC ÷ 240V</td><td class="tr fw9">${acAmps.toFixed(1)}A PV</td></tr>
            ${_lcSupply ? `
            <tr class="bg-lt"><td class="fw9 mono">4</td><td>Tap OCPD — NEC 705.11 / 690.8(A)(1)</td><td>${acAmps.toFixed(1)}A × 125% → next standard OCPD per NEC 240.6(A)</td><td class="tr fw9">${bfAmps}A fused disconnect</td></tr>
            <tr style="background:#fff;border:2px solid #000;"><td class="fw9 mono">5</td><td style="font-weight:900;">Supply-Side Connection — NEC 705.11</td><td>Tap made LINE side of the ${mainA}A service disconnect; 120% busbar rule (NEC 705.12(B)) not applicable</td><td style="font-weight:900;text-align:right;font-size:11px;">COMPLIES</td></tr>
            ` : `
            <tr class="bg-lt"><td class="fw9 mono">4</td><td>PV Backfeed Breaker — NEC 690.8(A)(1)</td><td>${acAmps.toFixed(1)}A × 125% → next standard OCPD per NEC 240.6(A)</td><td class="tr fw9">${bfAmps}A breaker required</td></tr>
            <tr style="background:#fff;border:2px solid #000;"><td class="fw9 mono">5</td><td style="font-weight:900;">120% Busbar Rule — NEC 705.12(B)</td><td>${busA}A bus × 120% = ${busLimit.toFixed(0)}A max; minus ${mainA}A main = ${maxBfAllowed.toFixed(0)}A for PV</td><td style="font-weight:900;text-align:right;font-size:11px;">${_rulePasses == null ? 'PENDING — NO CANONICAL BUSBAR VERDICT' : (_rulePasses ? 'PASS' : 'EXCEEDS 120% — SUPPLY-SIDE TAP OR PANEL UPGRADE REQUIRED')}</td></tr>
            `}
          </tbody>
        </table>
        ${_lcSupply ? `
        ${(() => {
          // §5 — project the canonical service-topology objects. The 10-ft rule
          // is the tap-CONDUCTOR object's own constraint; its state is honest
          // (PENDING while the tap-conductor length is unknown — never a compliant
          // 10-ft claim on an unmeasured run). The 60-ft feeder run is a separate
          // object (the route segment), so the two can't be conflated.
          const _tap = _svc('tap-conductors');
          const _fused = _svc('fused-ocpd');
          const _svcDisco = _svc('service-disconnect');
          const _tapRule = _tap?.constraints.find(c => c.code === 'NEC-705.11(C)-TAP-10FT');
          const _tapLenTxt = _tap?.lengthFt != null
            ? `${_tap.lengthFt} ft` : 'PENDING — tap-conductor length not measured (FIELD-VERIFY ≤10 ft)';
          const _ruleStateTxt = _tapRule
            ? (_tapRule.state === 'pass' ? '✓ within 10 ft'
               : _tapRule.state === 'fail' ? '✗ EXCEEDS 10 ft'
               : 'PENDING — length unknown')
            : 'PENDING';
          const _fusedA = _fused?.ocpdRatingA ?? bfAmps;
          const _svcA = _svcDisco?.ocpdRatingA ?? mainA;
          return `
        <table class="equip-table" style="margin-bottom:var(--xs);">
          <thead><tr><th style="width:22%">Service Object</th><th style="width:30%">Description</th><th style="width:16%">Rating / Conductor</th><th style="width:16%">Length</th><th>10-ft Tap Rule (705.11(C))</th></tr></thead>
          <tbody>
            ${_svcTopo.map(o => {
              const _r = o.constraints.find(c => c.code === 'NEC-705.11(C)-TAP-10FT');
              const _rTxt = _r ? (_r.state === 'pass' ? '✓ ≤10 ft' : _r.state === 'fail' ? '✗ >10 ft' : 'PENDING (length unknown)') : '—';
              const _lenTxt = o.lengthSource === 'not-applicable' ? '—'
                : o.lengthFt != null ? `${o.lengthFt} ft` : 'PENDING';
              const _spec = o.conductorSpec ?? (o.ocpdRatingA != null ? `${o.ocpdRatingA}A` : '—');
              return `<tr><td class="fw7">${o.label}</td><td style="font-size:8px">${o.description ?? '—'}</td><td class="tr mono">${_spec}</td><td class="tr">${_lenTxt}</td><td class="center fw7" style="color:${_r?.state === 'pending' ? '#cc6600' : _r?.state === 'fail' ? '#cc0000' : '#000'}">${_rTxt}</td></tr>`;
            }).join('')}
          </tbody>
        </table>
        <div style="padding:var(--xs);font-size:var(--f-md);line-height:1.5;border:var(--border);border-top:none;background:#fafafa;">
          <strong>SUPPLY-SIDE INTERCONNECTION — NEC 705.11:</strong>
          The PV output connects to the supply (line) side of the ${_svcA}A service disconnecting means. The topology above is a chain
          of distinct objects, each with its OWN length: the <em>tap conductors</em> (tap point → ${_fusedA}A fused AC disconnect,
          sized ≥ 125% of PV output current = ${continuousA.toFixed(1)}A) carry the NEC 705.11(C)/240.21(B) ≤10-ft rule
          (currently <strong>${_ruleStateTxt}</strong>; tap-conductor run = ${_tapLenTxt}). This is a SEPARATE segment from the
          <em>PV AC feeder</em> (array combiner → disconnect, ${_feedLenTxt}${_feed.lengthSource === 'cad-derived-estimate' ? ' CAD-derived estimate' : ''}, ${_feedVdTxt} drop shown above) —
          the 10-ft rule does not govern the feeder run. The 120% busbar limitation of NEC 705.12(B) applies only to load-side
          connections. Service conductor and metering adequacy to be field-verified with the serving utility.
        </div>`;
        })()}
        ${''/* formula-tutorial box removed — displaced project content */}` : `
        <div style="padding:var(--xs);font-size:var(--f-md);line-height:1.5;border:var(--border);border-top:none;background:#fafafa;">
          <strong>120% RULE INTERPRETATION:</strong>
          The PV system requires a ${bfAmps}A backfeed breaker installed at the load end of the existing ${busA}A busbar.
          Per NEC 705.12(B)(2)(3), the sum of the main breaker (${mainA}A) and the PV backfeed breaker (${bfAmps}A) = ${mainA + bfAmps}A,
          which ${_rulePasses == null ? 'has NOT been evaluated on the canonical snapshot for' : (_rulePasses ? 'does not exceed' : 'exceeds')} the 120% limit of ${busLimit.toFixed(0)}A.
          ${_rulePasses == null ? 'The 120% busbar evaluation is PENDING — resolve before submission.' : (_rulePasses ? 'No panel upgrade is required.' : 'A supply-side connection per NEC 705.11 or a panel upgrade is required.')}
        </div>
        ${''/* formula-tutorial box removed — displaced project content */}`}`;
      })()}
      <!-- Grounding & Bonding Standard Detail -->
      <div class="section-title">Grounding & Bonding Detail — NEC 690.43, 250.166</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--xs);border:var(--border);padding:2px;align-items:center;">
        <div style="text-align:center;">
          <svg viewBox="0 0 300 198" width="128" height="84" style="display:block;margin:0 auto;font-family:Arial,Helvetica,sans-serif;">
            <!-- PV module frames (aluminum, white with inner frame line) -->
            <g stroke="#1a2230" stroke-width="1.1" fill="#ffffff">
              <rect x="22" y="14" width="66" height="34" rx="1"/>
              <rect x="117" y="14" width="66" height="34" rx="1"/>
              <rect x="212" y="14" width="66" height="34" rx="1"/>
            </g>
            <g stroke="#9aa4b2" stroke-width="0.6" fill="none">
              <rect x="26" y="18" width="58" height="26"/>
              <rect x="121" y="18" width="58" height="26"/>
              <rect x="216" y="18" width="58" height="26"/>
            </g>
            <g font-size="7" fill="#1a2230" text-anchor="middle" font-weight="bold">
              <text x="55" y="34">MODULE 1</text>
              <text x="150" y="34">MODULE 2</text>
              <text x="245" y="34">MODULE N</text>
            </g>
            <!-- bonding jumpers module frame -> rail, with WEEB clip nodes -->
            <g stroke="#127a3e" stroke-width="1.6">
              <line x1="55" y1="48" x2="55" y2="61"/>
              <line x1="150" y1="48" x2="150" y2="61"/>
              <line x1="245" y1="48" x2="245" y2="61"/>
            </g>
            <g fill="#127a3e" stroke="#0f5c30" stroke-width="0.5">
              <rect x="51" y="53" width="8" height="8" transform="rotate(45 55 57)"/>
              <rect x="146" y="53" width="8" height="8" transform="rotate(45 150 57)"/>
              <rect x="241" y="53" width="8" height="8" transform="rotate(45 245 57)"/>
            </g>
            <!-- module rail -->
            <rect x="18" y="61" width="264" height="10" fill="#dfe4ec" stroke="#1a2230" stroke-width="1.1"/>
            <text x="150" y="69" text-anchor="middle" font-size="6.5" fill="#1a2230" font-weight="bold">MODULE RAIL — BONDED (UL 2703)</text>
            <!-- EGC rail -> inverter -->
            <line x1="150" y1="71" x2="150" y2="94" stroke="#127a3e" stroke-width="1.8"/>
            <text x="156" y="86" font-size="7" fill="#0f5c30" font-weight="bold">EGC</text>
            <text x="156" y="94" font-size="6" fill="#0f5c30">${_ic.feederEgcGauge} Cu · 250.122</text>
            <!-- inverter / combiner -->
            <rect x="108" y="94" width="84" height="26" fill="#f4f6f9" stroke="#1a2230" stroke-width="1.2" rx="1"/>
            <text x="150" y="110" text-anchor="middle" font-size="7" fill="#1a2230" font-weight="bold">INVERTER / AC COMBINER</text>
            <!-- inverter -> equipment ground bus -->
            <line x1="150" y1="120" x2="150" y2="142" stroke="#127a3e" stroke-width="1.8"/>
            <!-- equipment grounding bus -->
            <rect x="24" y="142" width="252" height="14" fill="#eef2f7" stroke="#1a2230" stroke-width="1.2"/>
            <text x="150" y="151" text-anchor="middle" font-size="7" fill="#1a2230" font-weight="bold">EQUIPMENT GROUNDING BUS</text>
            <g fill="#1a2230"><circle cx="60" cy="149" r="1.4"/><circle cx="150" cy="149" r="1.4"/><circle cx="240" cy="149" r="1.4"/></g>
            <!-- GEC -> grounding electrode (IEEE symbol) -->
            <line x1="252" y1="156" x2="252" y2="174" stroke="#127a3e" stroke-width="1.8"/>
            <text x="246" y="167" font-size="6" fill="#0f5c30" text-anchor="end" font-weight="bold">GEC</text>
            <line x1="240" y1="176" x2="264" y2="176" stroke="#127a3e" stroke-width="1.6"/>
            <line x1="244" y1="180" x2="260" y2="180" stroke="#127a3e" stroke-width="1.4"/>
            <line x1="247" y1="184" x2="257" y2="184" stroke="#127a3e" stroke-width="1.2"/>
            <text x="232" y="182" font-size="5.6" fill="#0f5c30" text-anchor="end">GROUNDING</text>
            <text x="232" y="189" font-size="5.6" fill="#0f5c30" text-anchor="end">ELECTRODE · 250.166</text>
          </svg>
        </div>
        <div style="font-size:var(--f-sm);line-height:1.2;">
          <div style="font-weight:900;font-size:9px;margin-bottom:2px;letter-spacing:0.5px;">GROUNDING & BONDING REQUIREMENTS</div>
          <div style="margin-bottom:1px;">1. All module frames bonded to mounting rail via ${(() => {
            // §10/§7 (07-22): pin the ACTUAL bonding hardware the canonical racking
            // assembly specifies — never "or equivalent". Unpinned ⇒ explicit
            // PENDING SELECTION (the structural agent's convention), never a guess.
            const _bond = _snap.structural.rackingAssembly?.groundingBonding;
            return _bond
              ? `${_bond} (listed to UL 2703)`
              : 'the racking manufacturer’s listed UL 2703 bonding hardware — <strong>PENDING SELECTION</strong>';
          })()}.</div>
          <div style="margin-bottom:1px;">2. Equipment grounding conductor (EGC): ${_ic.feederEgcGauge} bare Cu min. per NEC 250.122 and 690.45.</div>
          <div style="margin-bottom:1px;">3. EGC routed with circuit conductors in same raceway per NEC 690.43(A).</div>
          <div style="margin-bottom:1px;">4. ${(() => {
            // §7 — project the canonical GEC grounding object. For a grid-tied
            // interconnected PV system the equipment grounding path bonds to the
            // EXISTING service grounding electrode system; a separate GEC + new
            // electrode is added ONLY when an authoritative design input requires
            // one (none here). Never auto-invent a ground rod / #6 GEC.
            const _gec = getSnapshot(input).electrical.groundingObjects.find(g => g.purpose === 'gec');
            return _gec && !_gec.required
              ? 'Equipment grounding bonds to the EXISTING service grounding electrode system per NEC 250.64 / 690.47 — no separate grounding electrode conductor or new electrode is added by this PV interconnection.'
              : 'Grounding electrode conductor (GEC) connected to the building grounding electrode system per NEC 250.166.';
          })()}</div>
          <div style="margin-bottom:1px;">5. All connections made with listed connectors rated for the conductor material and environment.</div>
          <div style="margin-bottom:1px;">6. Bonding jumpers installed at all mechanical joints in the racking system per NEC 250.96.</div>
          <div style="color:#555;font-size:7px;margin-top:3px;font-style:italic;">Detail is typical — verify with racking manufacturer bonding requirements.</div>
        </div>
      </div>

      <div style="padding:3px 6px;margin-top:var(--xs);font-size:var(--f-sm);line-height:1.4;border:2px solid #000;background:#fff;">
        <strong>PAGE CONCLUSION — CONDUCTOR & CONDUIT SCHEDULE:</strong>
        Conductors sized per NEC 690.8 (Isc × 1.25), OCPD per NEC 690.9, temperature/fill derating per NEC 310.15.
        ${_feed.voltageDropPct != null && _feed.voltageDropPct <= 3 ? 'AC feeder voltage drop is within NEC recommended limits.' : 'Voltage drop requires review.'}
        All conductors are sized appropriately for the calculated load conditions of this ${system.totalDcKw?.toFixed(2) || '—'} kW DC system.
      </div>
    </div>
  </div>`;
}



export function pageSingleLineDiagram(input: PermitInput, cad: CADModel, pageNum: number, totalPages: number, storedSldSvg?: string): string {
  const { project, system, compliance } = input;
  // Wave 5B / Invariant I-8: at N>1 sub-systems E-1 must NEVER render the
  // stored single-system SVG or an inline single-source fallback — a plausible-
  // looking single-lane diagram over a hybrid system is the worst failure mode a
  // permit sheet has. Live renderer or an explicit banner.
  const _sldAuth = buildConductorAuthority(input, cad);
  const _sldHybrid = _sldAuth.isHybrid;

  // ── SLD content: SINGLE canonical renderer (W4 §5) ────────────────────────
  //   The ONLY SLD source is the live professional renderer — renderSLDProfessional
  //   (renderSLDMultiLane at N>1 lanes) built from CURRENT snapshot authority via
  //   generateLiveSLD. The retired inline buildSLD() fallback and the frozen
  //   storedSldSvg tier are DELETED (W4 §5): a stored SVG froze whatever engine
  //   version rendered it and resurrected fixed E-1 defects, and the inline
  //   builder held sheet-local literals — both could contradict the snapshot
  //   digest. Generation now FAILS CLOSED rather than degrade to a bypass.
  let sldBodyHtml: string;

  {
    let liveSvg: string | null = null;
    try {
      // embedded: E-1 has its own sheet title block — the SLD's internal
      // SOLARPRO panel duplicated project/system/code data beside it.
      liveSvg = generateLiveSLD(input, cad, { embedded: true });
      if (!liveSvg || !liveSvg.trim().startsWith('<svg')) {
        liveSvg = null;
      }
    } catch (sldErr: unknown) {
      console.warn('[E-1] Live SLD generation failed, falling back to stored/inline SLD:', sldErr instanceof Error ? (sldErr as Error).message : sldErr);
      liveSvg = null;
    }

    // W2 FAIL-CLOSED (Ray's snapshot mandate): E-1 renders the LIVE diagram
    // built from current authority, or generation FAILS. The stored-SVG tier
    // (frozen at whatever engine version rendered it — it resurrected fixed
    // defects and can contradict the snapshot digest on every regen) and the
    // inline buildSLD() literal-fallback tier are RETIRED. `storedSldSvg` is
    // accepted only as provenance, never rendered.
    void storedSldSvg;
    if (!liveSvg) {
      throw new Error(`[E-1] live single-line diagram generation failed for snapshot ${
        (input as unknown as { _snapshot?: { meta?: { snapshotId?: string } } })._snapshot?.meta?.snapshotId ?? '(unstamped)'
      } — fail closed (no stored/inline fallback renders on an authority-governed set)`);
    }
    {
      // Live professional SLD — render full-bleed (same layout as stored SLD)
      sldBodyHtml = `
      <div style="padding:0;overflow:hidden;width:100%;margin:0;display:block;text-align:center;">
        <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;text-align:center;">
          ${liveSvg}
        </div>
      </div>`;
    }
  }

  // ── Wave 5B: hybrid per-sub SOURCE SUMMARY data zone ──────────────────────
  // One row per sub-system from the shared conductor authority — the SAME
  // values PV-4A/PV-4B print, so E-1's data zone can never disagree with the
  // schedules regardless of which renderer produced the diagram above.
  const _sldSubZone = _sldHybrid ? `
    <div style="margin:6px 12px 10px;">
      <div style="background:#000;color:#fff;font-weight:900;font-size:8px;letter-spacing:0.8px;padding:3px 6px;">E-1 SOURCE SUMMARY — PER SUB-SYSTEM (SHARED CONDUCTOR AUTHORITY)</div>
      <table class="equip-table" style="width:100%;">
        <thead><tr>
          <th>Sub-System</th><th>Modules</th><th>Topology</th><th>Inverter</th>
          <th>Circuits</th><th>Governing OCPD</th><th>EGC</th><th>AC Feeder → POI</th>
        </tr></thead>
        <tbody>
          ${_sldAuth.subSystems.map(sub => {
            const eq2 = sub.equipment;
            const inv = [eq2.inverterManufacturer, eq2.inverterModel].filter(s => s && s !== '—').join(' ') || '—';
            const circuits = sub.isMicro
              ? `${sub.microBranches.length} AC branch${sub.microBranches.length === 1 ? '' : 'es'}`
              : `${sub.dcStrings.length} DC string${sub.dcStrings.length === 1 ? '' : 's'}`;
            return `<tr>
            <td class="fw7">${SUB_LABEL[sub.key]}</td>
            <td class="tr">${sub.panelCount}</td>
            <td>${sub.topology}</td>
            <td>${inv}</td>
            <td>${circuits}</td>
            <td class="tr">${sub.governingOcpd}A</td>
            <td>${sub.egc.gauge}</td>
            <td>${sub.acSubFeeder.currentA.toFixed(1)}A${sub.acSubFeeder.ocpdAmps != null ? ` / ${sub.acSubFeeder.ocpdAmps}A OCPD` : ''} — ${sub.acSubFeeder.wireGauge}</td>
          </tr>`;
          }).join('')}
        </tbody>
      </table>
      <div style="border:var(--border);border-top:none;padding:3px 6px;font-size:7px;color:#333;background:#fafafa;">
        Backfeed basis: Σ of each physical inverter's rounded OCPD per sub-system + battery (NEC 705.12(B)) — one shared
        service feeder; shared runs emitted once. Shared trench permitted, separate conduits per sub-system (no shared raceway).
      </div>
    </div>` : '';

  // W4 §5 — SLD ↔ snapshot binding: every rendered SLD carries the canonical
  // snapshot id, schema version and digest as MACHINE-EXTRACTABLE attributes so
  // the evidence harness can prove the diagram was produced from THIS validated
  // snapshot (not a stored/inline bypass). Absent snapshot ⇒ empty values, which
  // the harness reads as an unstamped (non-authority) SLD. Text form of the same
  // stamp is also printed in the title block (V12), but the SLD is tagged in its
  // own right so it is verifiable independent of title-block parsing.
  const _sldMeta = (input as unknown as {
    _snapshot?: { meta?: { snapshotId?: string; schemaVersion?: string; digest?: string } }
  })._snapshot?.meta;
  // digest is emitted as the SAME 20-char prefix the title block prints
  // (one digest representation across the whole set — a full-length form here
  // would be an inconsistent second rendering of the same fact).
  const _sldStamp =
    `<div class="sld-snapshot-stamp" data-sld-snapshot-id="${_sldMeta?.snapshotId ?? ''}"`
    + ` data-sld-schema-version="${_sldMeta?.schemaVersion ?? ''}"`
    + ` data-sld-digest="${(_sldMeta?.digest ?? '').slice(0, 20)}" style="display:none"></div>`;

  return `
  <div class="page sld-page">
    ${titleBlock(input, 'E-1', 'SINGLE-LINE ELECTRICAL DIAGRAM', pageNum, totalPages)}
    ${_sldStamp}
    ${sldBodyHtml}
    ${_sldSubZone}
  </div>`;
}




