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
import { microBranchCount, planMicroBranches, microMaxPerBranch, microBranchMaxOcpdA } from '../utils/branching';
import { getSnapshot, peekSnapshot } from '../snapshot/read';
// §3 SEGMENT AUTHORITY (post-campaign correction 07-22): every feeder raceway
// size, voltage drop, run length + conductor callout PROJECTS from the ONE
// canonical feeder segment — no sheet re-derives conduit/VD/length/callout.
import { projectCanonicalFeeder, projectCanonicalBranch, projectSharedBranchRaceway, projectRacewayDescriptor, projectE1PhysicalSchedule, projectListedCableAssembly, projectOpenAirBranchGrounding, projectGroundingSegments, ampacityChainLines, type E1PhysicalSection, type AmpacityAdjustmentResult } from '../snapshot/electricalProjection';
import { projectRackingBondingAuthority } from '../snapshot/rackingBonding';
import { GROUNDING_PENDING_LABEL, GROUNDING_PENDING_BONDING_CELL_LABEL, GROUNDING_NON_ORDERABLE_LABEL, GROUNDING_AUTHORITY_BLOCKER_CODE } from '../snapshot/groundingAuthority';
import { escapeH } from '../utils/drawing';
import { complianceBadge, evaluateCompliance } from '../snapshot/complianceState';
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

// §1 (closeout 2026-07-23) — E-1 SECTIONED PHYSICAL SCHEDULE renderer. Prints the
// CANONICAL section objects (Q-Cable branch trunks, shared home-run raceway with
// its full CCC inventory, feeder, disconnect→tap, tap conductors) with every §1
// field. Never merges sections into one generalized row; every verdict is the ONE
// shared tri-state result (no PASS on a pending length / blank fill).
function renderE1PhysicalSchedule(sections: E1PhysicalSection[]): string {
  if (!sections.length) return '';
  const n = (v: number | null, d = 1, suf = '') => v == null ? '—' : `${v.toFixed(d)}${suf}`;
  const s = (v: string | null | undefined) => v == null || v === '' ? '—' : v;
  const rows = sections.map((x, i) => {
    const condLine = `${x.conductorCount != null ? `${x.conductorCount}×` : ''}${s(x.conductorSize)}`;
    const raceway = x.physicalRacewayId
      ? `${s(x.racewayType)}${x.racewaySize ? ` ${x.racewaySize}` : ''}`
      : s(x.racewayType);
    return `<tr style="background:${i % 2 ? '#f7f7f7' : '#fff'}">`
      + `<td style="font-size:6.5px"><span class="mono fw7">${x.sectionId}</span><br/><span style="color:#333">${x.sectionLabel}</span>`
        + `<br/><span style="color:#666">${s(x.fromDevice)} → ${s(x.toDevice)}</span></td>`
      + `<td style="font-size:6.5px">${s(x.cableType)}<br/><span class="mono">${condLine}</span>`
        // PPC §1/§7 — the bonding sub-cell is authority-projected and carries its
        // canonical GroundingSegment id (gate 10: no rendered grounding conductor
        // without one) plus a machine-readable pending/assertion tag.
        // ECD §6 — the id here is THIS section's OWN physical grounding segment
        // (gnd-br-1 / gnd-br-2 / gnd-br-3), not one id stamped on every branch.
        // `data-grounding-authority-group` names the ONE authority result the three
        // physical segments share (rendered in full on PV-4B), so the row
        // reconciles to exactly one canonical object without the physical identity
        // having to double as the authority identity.
        + `<br/><span style="color:${x.bondingPendingAuthority ? '#b45309' : '#666'}"`
          + `${x.groundingSegmentId ? ` data-grounding-segment-id="${x.groundingSegmentId}" data-grounding-identity-kind="physical-segment"` : ''}`
          + `${x.groundingAuthorityGroupId ? ` data-grounding-authority-group="${x.groundingAuthorityGroupId}"` : ''}`
          + ` data-grounding-pending="${x.bondingPendingAuthority ? 'true' : 'false'}">${s(x.bonding)}`
          + `${x.groundingSegmentId ? `<br/><span class="mono" style="color:#888;font-size:5.5px">${x.groundingSegmentId}</span>` : ''}</span></td>`
      + `<td style="font-size:6.5px">${x.physicalRacewayId ? `<span class="mono fw7">${x.physicalRacewayId}</span><br/>` : ''}${raceway}`
        + `<br/><span style="color:#666">${x.fillApplicable ? (x.fillPct != null ? `fill ${x.fillPct.toFixed(1)}%` : 'fill PENDING') : 'open air'}</span>`
        // §4 — the FULL itemized ampacity chain (base × count-adj × ambient →
        // 75 °C-capped allowable vs required continuous), replacing the bare 0.96.
        + `${x.ampacity && x.ampacity.present
            ? `<br/><span class="mono" style="color:#333;font-size:5.5px">${ampacityChainLines(x.ampacity).join('<br/>')}</span>`
            : `${x.deratingFactor != null ? `<br/><span style="color:#666">derate ${x.deratingFactor.toFixed(2)}</span>` : ''}`}</td>`
      + `<td class="tr" style="font-size:6.5px">${n(x.operatingCurrentA, 1, 'A')} op<br/>${n(x.continuousCurrentA, 1, 'A')} cont<br/>${x.ocpdA != null ? `${x.ocpdA}A OCPD` : '—'}</td>`
      + `<td class="tr" style="font-size:6.5px">${x.lengthFt != null ? `${x.lengthFt} ft` : 'PENDING'}`
        + `${x.lengthLabel ? `<br/><span style="color:#333">${x.lengthLabel}</span>` : ''}`
        + `${x.lengthObjectId ? `<br/><span class="mono" style="color:#888;font-size:5.5px">${x.lengthObjectId}</span>` : ''}`
        + `<br/><span style="color:#666">${s(x.verificationStatus)}</span></td>`
      + `<td class="tr" style="font-size:6.5px">${x.voltageDropPct != null ? `${x.voltageDropPct.toFixed(2)}%` : '—'}<br/><span style="color:#666">≤${x.vdLimitPct}%</span></td>`
      + `<td class="center" style="font-size:6.5px;overflow-wrap:anywhere;">${complianceBadge(x.compliance)}</td>`
      + `</tr>`;
  }).join('');
  return `
    <div style="margin:6px 12px 10px;">
      <div style="background:#000;color:#fff;font-weight:900;font-size:8px;letter-spacing:0.8px;padding:3px 6px;">PHYSICAL CONDUCTOR / RACEWAY SCHEDULE — CANONICAL SECTION OBJECTS (NEC 690.8 / 310.15 / 705.11)</div>
      <!-- table-layout:fixed — without it the declared column widths are only hints:
           the long itemized ampacity chain (§4) grew column 3, the auto layout took the
           space out of the last column, and the COMPLIANCE badge (PENDING — REVIEW REQ'D)
           overflowed its cell and was clipped at the sheet edge. The widths below sum to
           100%, so fixed layout renders exactly the intended geometry. -->
      <table class="equip-table" style="width:100%;table-layout:fixed;">
        <!-- .equip-table th is white-space:nowrap globally, which under fixed layout let
             the LENGTH header overrun the V-DROP header. These headers wrap instead. -->
        <thead><tr style="white-space:normal;">
          <th style="width:20%;white-space:normal;">Section / From → To</th>
          <th style="width:16%;white-space:normal;">Cable · Conductors · Bonding</th>
          <th style="width:16%;white-space:normal;">Physical Raceway · Fill · Derate</th>
          <th style="width:12%;white-space:normal;">Currents</th>
          <th style="width:12%;white-space:normal;">Length (quantity · source) · Verify</th>
          <th style="width:9%;white-space:normal;">V-Drop</th>
          <th style="width:15%;white-space:normal;">Compliance</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="border:var(--border);border-top:none;padding:3px 6px;font-size:7px;color:#333;background:#fafafa;">
        Each row is a DISTINCT canonical physical section — the open-air Enphase Q Cable branch trunks (NEC 690.31(C)),
        the shared jbox→combiner home-run raceway (conductor count = its physical-raceway current-carrying inventory),
        the combiner feeder, and the supply-side tap conductors — never merged. Compliance is the shared tri-state
        authority: no section shows PASS while its route length is an estimate, its conduit fill is uncomputed, or the
        NEC 705.11(C) ≤10-ft tap rule is unmeasured.
        <br/><strong>Length quantities:</strong> the Q-Cable branch rows print the <em>cable path (geometry)</em> —
        the designed-installed trunk path (Σ inter-module + lead-in) traced to each <span class="mono">QCABLE-ASSEMBLY:Bn</span>
        object; the home-run / feeder / disconnect rows print the <em>route (one-way)</em> estimate traced to their run
        segment id. These are DIFFERENT quantities from the BOM Q-Cable <em>procurement</em> footage (Σ drops × pitch ×
        waste, drop-count basis) — one quantity per label, never conflated.
      </div>
    </div>
    ${renderAmpacityEvidenceBlock(sections)}`;
}

// §4 (BAR closeout 2026-07-25) — the CANONICAL shared-raceway ampacity EVIDENCE
// block. Itemizes EVERY factor of the six-CCC home-run ampacity adjustment
// (conductor material/insulation/size, 90 °C base, 110.14(C) 75 °C terminal cap,
// CCC count + 310.15(C)(1) count-adjustment, ambient + 310.15(B)(1) correction,
// optional rooftop adder, corrected + final allowable, required continuous,
// NEC refs, pass/fail/pending). Rendered identically on E-1 AND PV-4B (single
// source), so no sheet prints a lone unexplained "0.96". Returns '' when no
// in-conduit shared section is present.
export function renderAmpacityEvidenceBlock(
  sections: E1PhysicalSection[],
  heading = 'SHARED-RACEWAY AMPACITY ADJUSTMENT — NEC 310.15 / 110.14(C) (EVERY FACTOR)',
  compact = false,
): string {
  const hr = sections.find(s => s.sectionId === 'BRANCH_HOMERUN_RUN' && s.ampacity?.present)?.ampacity
    ?? sections.find(s => s.fillApplicable && s.ampacity?.present)?.ampacity
    ?? null;
  if (!hr || !hr.present) return '';
  const A = (n: number | null, d = 2) => n == null ? 'PENDING' : `${n.toFixed(d)} A`;
  const F = (n: number | null) => n == null ? 'PENDING' : n.toFixed(2);
  const stateColor = hr.state === 'PASS' ? '#1b7a1b' : hr.state === 'FAIL' ? '#b00' : '#946200';
  const row = (k: string, v: string) =>
    `<tr><td style="padding:1.5px 6px;color:#555;white-space:nowrap">${k}</td><td style="padding:1.5px 6px" class="mono">${v}</td></tr>`;
  // COMPACT (PV-4A / PV-4B page-fit, gate 13): the SAME canonical object and the
  // SAME every-factor content as E-1's table, rendered as one dense inline block
  // instead of an 11-row table. Same numbers, same NEC refs, same verdict — the
  // "identical" requirement is on the VALUES/factors, not the layout.
  if (compact) {
    return `
      <div style="margin:3px 12px 6px;padding:2px 6px;font-size:6.5px;line-height:1.2;border:var(--border);background:#f4f4f8;">
        <strong>${heading}</strong> —
        conductor ${hr.conductorMaterial ?? '—'} ${hr.conductorSize ?? '—'} ${hr.insulation ?? '—'} (ins. ${hr.insulationRatingC} °C) ·
        base <span class="mono">${A(hr.baseTableAmpacityA, 0)}</span> (${hr.baseTableTempC} °C col., 310.16) ·
        CCC <span class="mono">${hr.currentCarryingCount ?? 'PENDING'}</span> → count-adj <span class="mono">×${F(hr.countAdjustmentFactor)}</span> (310.15(C)(1)) ·
        ambient ${hr.effectiveAmbientTempC != null ? `${hr.effectiveAmbientTempC} °C` : 'PENDING'}${hr.rooftopAdderC ? ` (incl. +${hr.rooftopAdderC} °C rooftop adder, 310.15(B)(2))` : ''} → corr <span class="mono">×${F(hr.ambientCorrectionFactor)}</span> (310.15(B)(1)) ·
        corrected <span class="mono">${A(hr.correctedAmpacityA)}</span> ·
        terminal cap ${hr.terminalTempLimitC} °C = <span class="mono">${A(hr.terminalTableAmpacityA, 0)}</span> (110.14(C)) ·
        <strong>FINAL ALLOWABLE <span class="mono">${A(hr.finalAllowableAmpacityA)}</span></strong> vs required continuous <span class="mono">${A(hr.requiredContinuousA)}</span>${hr.ocpdA ? ` (branch OCPD ${hr.ocpdA} A)` : ''} ⇒
        <span style="color:${stateColor};font-weight:900">${hr.state}</span>.
        Two independent adjustments (count AND ambient) — never a lone derate; same <span class="mono">AmpacityAdjustmentResult</span> object E-1 and the evidence JSON project.
      </div>`;
  }
  return `
    <div style="margin:6px 12px 10px;">
      <div style="background:#1a1a1a;color:#fff;font-weight:900;font-size:8px;letter-spacing:0.6px;padding:3px 6px;">${heading}</div>
      <table class="equip-table" style="width:100%;font-size:7px;border-top:none;">
        <tbody>
          ${row('Conductor', `${hr.conductorMaterial ?? '—'} ${hr.conductorSize ?? '—'} ${hr.insulation ?? '—'} (insulation rated ${hr.insulationRatingC} °C)`)}
          ${row('Base table ampacity (NEC 310.16)', `${A(hr.baseTableAmpacityA, 0)} — ${hr.baseTableTempC} °C column`)}
          ${row('Terminal temp limit (NEC 110.14(C))', `${hr.terminalTempLimitC} °C → 75 °C table = ${A(hr.terminalTableAmpacityA, 0)}`)}
          ${row('Current-carrying conductors (CCC)', `${hr.currentCarryingCount ?? 'PENDING'}`)}
          ${row('Count-adjustment factor (NEC 310.15(C)(1))', `× ${F(hr.countAdjustmentFactor)}${hr.countAdjustmentBasis ? ` — ${hr.countAdjustmentBasis}` : ''}`)}
          ${row('Ambient correction (NEC 310.15(B)(1))', `× ${F(hr.ambientCorrectionFactor)}${hr.ambientCorrectionBasis ? ` — ${hr.ambientCorrectionBasis}` : ''}`)}
          ${hr.rooftopAdderC ? row('Rooftop temperature adder (NEC 310.15(B)(2))', `+ ${hr.rooftopAdderC} °C ambient`) : ''}
          ${row('Corrected ampacity', `${A(hr.baseTableAmpacityA, 0)} × ${F(hr.countAdjustmentFactor)} × ${F(hr.ambientCorrectionFactor)} = ${A(hr.correctedAmpacityA)}`)}
          ${row('FINAL ALLOWABLE', `<strong>${A(hr.finalAllowableAmpacityA)}</strong>${hr.finalAllowableBasis ? ` — ${hr.finalAllowableBasis}` : ''}`)}
          ${row('Required continuous', `${A(hr.requiredContinuousA)}${hr.requiredContinuousBasis ? ` — ${hr.requiredContinuousBasis}` : ''}${hr.ocpdA ? ` · branch OCPD ${hr.ocpdA} A` : ''}`)}
          ${row('Result', `<span style="color:${stateColor};font-weight:900">${hr.state}</span> · ${hr.necReferences.join(' · ')}`)}
        </tbody>
      </table>
      <div style="border:var(--border);border-top:none;padding:3px 6px;font-size:6.5px;color:#555;background:#fafafa;">
        The six-CCC shared home-run carries TWO independent adjustments — the ${hr.currentCarryingCount ?? '—'}-conductor count factor
        (NEC 310.15(C)(1)) AND the ambient factor (NEC 310.15(B)(1)) — applied to the 90 °C base, then capped at the 75 °C terminal
        ampacity (NEC 110.14(C)). This is the canonical <span class="mono">AmpacityAdjustmentResult</span>; PV-4B and the evidence JSON
        project the same object — never a lone unexplained derate.
      </div>
    </div>`;
}

// OPEN-AIR BRANCH GROUNDING note — the DOCUMENT-BASED three-outcome authority
// (corrected 2026-07-25). It renders the SAME canonical result on every surface:
//   A  no additional conductor in this section (with the citation + the retained
//      module/racking bonding requirement)
//   B  an additional NEC 250.122 conductor (with the citation + the BOM quantity)
//   C  GROUNDING METHOD: PENDING MANUFACTURER AUTHORITY — fail-closed. No method
//      is asserted either way, no PASS, and the candidate quantity is labelled a
//      PROPOSED / DESIGN QUANTITY.
// Returns '' only for non-micro / no branch-EGC objects.
export function renderOpenAirBranchGroundingNote(
  snap: import('../snapshot/types').PermitDesignSnapshot | null | undefined,
  compact = false,
): string {
  const g = projectOpenAirBranchGrounding(snap);
  if (!g.present) return '';
  const a = g.authority;
  const bg = g.outcome === 'PENDING_MANUFACTURER_AUTHORITY' ? '#fdf4e7' : '#eef7ee';
  const pad = compact ? '2px 6px' : '3px 6px';
  const mar = compact ? '2px 12px 5px' : '4px 12px 8px';
  const head = `<div style="margin:${mar};padding:${pad};font-size:6.5px;line-height:${compact ? '1.18' : '1.2'};border:var(--border);background:${bg};">`;

  if (g.outcome === 'PENDING_MANUFACTURER_AUTHORITY') {
    const why = (a?.applicabilityVerification.failures ?? []).slice(0, 2).join('; ');
    return `${head}
        <strong style="color:#b45309;">OPEN-AIR BRANCH GROUNDING — ${GROUNDING_PENDING_LABEL} (${GROUNDING_AUTHORITY_BLOCKER_CODE}, BLOCKING):</strong>
        The equipment grounding / bonding method for the open-air microinverter branch (listed cable assembly) section of the exact selected
        <span class="mono">${a?.selectedMicroinverterSku ?? 'microinverter'}</span> + <span class="mono">${a?.selectedCableAssemblySku ?? 'cable assembly'}</span>
        is <strong>NOT ESTABLISHED</strong>. ${why || 'No applicable manufacturer document is archived.'}
        Neither outcome may be asserted for this section. ${a?.necBasis ?? 'NEC 110.3(B).'}
        Cable conductor construction (<span class="mono">${a?.cableConductorCount ?? '—'}-conductor${a?.cableConductorConstruction ? `, ${a.cableConductorConstruction}` : ''}</span>)
        is recorded and is <strong>NOT determinative</strong> of the method.
        Candidate conductor <span class="mono">${g.conductorSize ?? '—'} ${g.conductorMaterial ?? 'Cu'}</span>,
        <span class="mono">${g.bomFootageFt ?? '—'} ft</span> = <strong>${GROUNDING_NON_ORDERABLE_LABEL}</strong>
        (excluded from procurement totals). Module-frame / racking bonding is a DISTINCT requirement and remains required
        (${a?.rackingModuleBondingRequirement.codeBasis ?? 'NEC 690.43'}). See RS-1.
      </div>`;
  }

  if (g.outcome === 'NO_SEPARATE_EGC_REQUIRED') {
    return `${head}
        <strong>OPEN-AIR BRANCH GROUNDING — LISTED METHOD (no additional conductor in this section):</strong>
        ${a?.explanation ?? ''} <strong>Authority:</strong> ${g.sourceAuthority}. ${a?.necBasis ?? ''}
        Module-frame / racking bonding remains required on its own authority (${a?.rackingModuleBondingRequirement.codeBasis ?? 'NEC 690.43'})
        and its hardware is retained in the BOM. No open-air branch grounding conductor is ordered for this section.
      </div>`;
  }

  // (B) — an additional EGC, established by the cited document.
  return `${head}
      <strong>OPEN-AIR BRANCH GROUNDING — ADDITIONAL EQUIPMENT GROUNDING CONDUCTOR REQUIRED
      (${g.conductorSize ?? '#12'} ${g.conductorMaterial ?? 'Cu'}):</strong>
      <strong>Authority:</strong> ${g.sourceAuthority}. ${a?.necBasis ?? ''}
      Route = ${g.pathBasis} on ${g.branchIds.join(', ') || 'each branch'}.
      <strong>Quantity (matches BOM):</strong> <span class="mono">${g.bomFootageFt ?? 'PENDING'} ft</span>
      (designed-installed <span class="mono">${g.designedInstalledFt ?? '—'} ft</span> × ${g.wasteFactor} waste). ${g.verificationState}.
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// PPC §7 — the PV-4B GROUNDING & BONDING conductor rows, rendered from the
// canonical GroundingSegment objects.
//
// What this replaces: a hardcoded `<tr>` that took the FEEDER's EGC gauge, called
// it "Array → AC Disconnect (ground bus)", and reprinted the feeder row's own
// conduit ("PVC Sch 80 1-1/4"") and length ("20 ft") as the grounding run's. That
// row reconciled with nothing — no id, no segment, no raceway of its own, no BOM
// line, no authority state.
//
// Now: one row per canonical object, each carrying its OWN id (rendered AND
// machine-tagged via data-grounding-segment-id — gate 10), its own endpoints, its
// own raceway (or FREE AIR), its own length + length provenance, its own NEC basis
// and its own authority state. A PENDING object asserts NO installed conductor.
// Six domains stay six objects; nothing borrows from another.
// ═══════════════════════════════════════════════════════════════════════════
export function renderGroundingSegmentRows(
  snap: import('../snapshot/types').PermitDesignSnapshot | null | undefined,
): string {
  const segments = projectGroundingSegments(snap);
  if (!segments.length) return '';
  // Compact device labels — the canonical objects keep the full strings; the row
  // prints the short form (PV-4B page-fit, gate 13).
  const dev = (s: string): string => s.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  const shortLabel: Record<string, string> = {
    'branch-egc': 'Open-air branch EGC',
    'feeder-egc': 'Feeder EGC (raceway)',
    'raceway-bond': 'Raceway / enclosure bond',
    'gec': 'Grounding electrode conductor',
    'integrated-listed-method': 'Listed integrated method',
    'module-racking-bonding': 'Module / racking bonding',
  };
  const rows = segments.map(gs => {
    // The conductor cell NEVER asserts an installed conductor for a PENDING
    // object; it states the pending method + the explicit non-assertion. Kept
    // compact (PV-4B page-fit, gate 13) — the full mandated label renders on E-1's
    // bonding column and in the open-air grounding note.
    const conductorCell = gs.authorityState === 'pending-manufacturer-authority'
      ? `<strong style="color:#b45309">PENDING MFR AUTHORITY — INSTALLED EGC NOT ASSERTED</strong>`
      : gs.method === 'integrated-listed'
        ? 'LISTED INTEGRATED METHOD — no additional conductor'
        : gs.method === 'none-required'
          ? 'NOT REQUIRED — bonded to existing GES'
          : gs.method === 'raceway'
            ? 'raceway as EGC (250.118)'
            : `${gs.conductorSize ?? 'PENDING'} ${gs.conductorMaterial ?? ''}`.trim();
    const lengthCell = gs.lengthFt != null
      ? `${gs.lengthFt} ft`
      : (gs.method === 'none-required' || gs.method === 'integrated-listed' ? 'n/a' : 'NOT EST.');
    // ONE dense line per canonical object. Rendered as a single colspan row rather
    // than N nine-column rows: the ampacity / OCPD / V-drop columns are all "n/a"
    // for a grounding conductor, and PV-4B has ~18px of printable slack (page-fit
    // gate 13). Every field Ray requires is still present and machine-tagged —
    // id, endpoints, size/method, raceway, length + its provenance, NEC basis,
    // authority state — one object per line, nothing borrowed from another row.
    // ECD §6 — a GROUP-AUTHORITY node is visibly a group-authority row, never a
    // physical segment row: it names the ONE authority result and the branch scope
    // it governs, and it is machine-tagged `identity-kind="group-authority"` so no
    // counter can mistake it for an installed grounding path. Its members' PHYSICAL
    // ids (gnd-br-1/2/3) render per-branch on E-1.
    const isGroup = gs.identityKind === 'group-authority';
    const scopeSuffix = isGroup && gs.branchScope.length
      ? ` <span style="color:#0f5c30">(${escapeH(gs.branchScope.join('/'))})</span>`
      : '';
    return `<span data-grounding-segment-id="${escapeH(gs.groundingSegmentId)}"`
      + ` data-grounding-identity-kind="${escapeH(gs.identityKind)}"`
      + `${gs.groundingAuthorityGroupId ? ` data-grounding-authority-group="${escapeH(gs.groundingAuthorityGroupId)}"` : ''}`
      + `${gs.branchScope.length ? ` data-grounding-branch-scope="${escapeH(gs.branchScope.join(','))}"` : ''}`
      + `${gs.memberGroundingIds.length ? ` data-grounding-member-ids="${escapeH(gs.memberGroundingIds.join(','))}"` : ''}`
      + ` data-grounding-authority-state="${escapeH(gs.authorityState)}"`
      + ` data-grounding-length-source="${escapeH(gs.lengthSource)}"`
      + ` data-grounding-nec-basis="${escapeH(gs.necBasis.split(/[—:]/)[0].trim().slice(0, 60))}"`
      + ` data-grounding-bom-line="${escapeH(gs.bomLineId ?? '')}"`
      + ` data-grounding-installed-asserted="${gs.installedConductorAsserted ? 'true' : 'false'}"`
      + `>`
      + `<strong>${escapeH(shortLabel[gs.purpose] ?? gs.label)}${isGroup ? ' &mdash; GROUP AUTHORITY' : ''}</strong> `
      + `<span class="mono" style="color:#0f5c30;">${escapeH(gs.groundingSegmentId)}</span>${scopeSuffix} `
      + `[${escapeH(dev(gs.fromDeviceId))}&rarr;${escapeH(dev(gs.toDeviceId))} &middot; `
      + `${conductorCell} &middot; ${escapeH(gs.racewayLabel ?? 'RACEWAY NOT EST.')} &middot; `
      + `${lengthCell}${gs.lengthSource === 'not-established' ? '' : ` ${escapeH(gs.lengthSource)}`}]`
      + `</span>`;
  // One flowing dense paragraph rather than one line per object: PV-4B has ZERO
  // printable slack (the page-content flex child cannot shrink), so a per-object
  // line-per-row rendering clipped the page conclusion (gate 13). Every field is
  // still present per object, each object still tagged with its own id + state.
  }).join(' &nbsp;·&nbsp; ');
  // 5.5px/1.1 (was 5.8px/1.18) — PV-4B's page-content flex child cannot shrink and
  // this block grows with the open-air grounding explanation; at 5.8px a
  // procurement-insufficient design clipped the page conclusion by 5.6px (gate 17).
  return `<tr style="background:#f4fbf6"><td colspan="9" style="font-size:5.5px;line-height:1.1;padding:1px 4px;">`
    + `<strong style="color:#0f5c30;">GROUNDING &amp; BONDING &mdash; CANONICAL GroundingSegment OBJECTS</strong> `
    + `(own id / size / raceway / length / authority &mdash; nothing borrowed; NEC basis + BOM line machine-tagged): `
    + rows
    + `</td></tr>`;
}

// §5 (closeout 2026-07-23) — PV-4A AC BRANCH ELECTRICAL RATING SUMMARY (option B).
// PV-4A no longer prints a conductor/raceway column implying a '#12 THWN-2 → IQ
// Combiner' branch conductor (that fabricated conductor is the exact defect §5
// forbids). The SECTIONED PHYSICAL schedule (conductors, raceways, Q-Cable) lives
// on E-1; PV-4A shows the DEVICE RATING facts only: device count, operating
// current, ×1.25 continuous, branch OCPD, and the manufacturer per-branch limit,
// with a tri-state status (over-limit ⇒ FAIL; blank rating ⇒ PENDING).
interface Pv4aRatingBranch { index: number; deviceCount: number; branchCurrentA: number; continuousA: number; ocpdAmps: number; }
function pv4aBranchRatingTable(
  title: string,
  branches: Pv4aRatingBranch[],
  inverterModel?: string | null,
  inverterMfr?: string | null,
): string {
  const mfrLimit = microMaxPerBranch(inverterModel, inverterMfr);
  const mfrOcpdLimit = microBranchMaxOcpdA(inverterModel, inverterMfr);
  const rows = branches.map((b, i) => {
    const compliance = evaluateCompliance({
      requiredValues: [
        { label: 'device count', value: b.deviceCount, numeric: true },
        { label: 'branch OCPD', value: b.ocpdAmps, numeric: true },
        { label: 'operating current', value: b.branchCurrentA, numeric: true },
      ],
      checks: [
        { label: 'continuous ≤ OCPD (NEC 240.4)', pass: Number.isFinite(b.continuousA) && Number.isFinite(b.ocpdAmps) ? b.continuousA <= b.ocpdAmps : null },
        { label: `devices ≤ mfr per-branch limit (${mfrLimit})`, pass: mfrLimit > 0 ? b.deviceCount <= mfrLimit : null },
        { label: `OCPD ≤ mfr branch max (${mfrOcpdLimit}A)`, pass: mfrOcpdLimit > 0 ? b.ocpdAmps <= mfrOcpdLimit : null },
      ],
    });
    return `<tr style="background:${i % 2 ? '#f5f5f5' : '#fff'}">`
      + `<td class="fw9 mono">B${b.index}</td>`
      + `<td>${b.deviceCount} × microinverter</td>`
      + `<td style="text-align:right;font-family:monospace">${b.branchCurrentA.toFixed(1)} A</td>`
      + `<td style="text-align:right;font-family:monospace">${b.continuousA.toFixed(1)} A</td>`
      + `<td style="text-align:center;font-family:monospace">${b.ocpdAmps} A</td>`
      + `<td style="text-align:center;font-family:monospace">${mfrLimit > 0 ? `${mfrLimit} · ${mfrOcpdLimit}A` : '—'}</td>`
      + `<td class="center">${complianceBadge(compliance)}</td>`
      + `</tr>`;
  }).join('');
  return `
      <div class="section-title">${title}</div>
      <table class="equip-table">
        <thead><tr><th style="width:8%">Branch</th><th style="width:22%">Devices</th><th style="width:14%">Operating</th><th style="width:16%">× 1.25 Cont.</th><th style="width:12%">Branch OCPD</th><th style="width:16%">Mfr Limit</th><th>Status</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="7" class="center">Branch plan pending module placement — see PV-1B</td></tr>`}</tbody>
      </table>
      <div style="padding:2px 6px;font-size:7px;color:#555;border:var(--border);border-top:none;background:#fafafa">Physical conductor, cable-assembly and raceway schedule (Enphase Q Cable / shared home-run / feeder) is on E-1 — this table is the branch DEVICE rating summary only.</div>`;
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
  // §4 (closeout 2026-07-23) — PV-4A CONSUMES the canonical permit-readiness
  // REGISTRY (domain-filtered to ELECTRICAL), never a sheet-local hardcoded code
  // allowlist + re-derived pending list. The old path (a) used the allowlist code
  // `TAP-LENGTH-PENDING` which does NOT match the real registry code
  // `TAP-CONDUCTOR-LENGTH-PENDING` (downgrading a blocking item to a local
  // "pending"), (b) re-added conduit fill as a duplicate pending, and (c) dropped
  // every non-allowlisted electrical blocker. RS-1 renders the SAME registry
  // grouped by `domain`, so PV-4A's electrical blocker multiset now EQUALS RS-1's
  // electrical subset EXACTLY (gate 5): same codes, canonical severities, no
  // synthetic duplicates, no downgrades, no cross-domain miscounts. Registry
  // severity 'blocking' → Blocking; 'warning' → Pending.
  const _elecRegistry = (_snapA.permitReadiness?.registry ?? [])
    .filter(r => !r.resolved && r.domain === 'electrical');
  const _elecBlocking = _elecRegistry.filter(r => r.severity === 'blocking');
  const _elecWarnings = _elecRegistry.filter(r => r.severity === 'warning');
  const _parityUnresolved = _snapA.electrical.parity?.unresolved ?? [];
  const _elecErrorCount = _elecBlocking.length + _parityUnresolved.length;
  const _elecWarnCount = _elecWarnings.length;
  // COMPLIES only when nothing is blocking AND nothing is pending (gate 4).
  const _elecComplies = _elecErrorCount === 0 && _elecWarnCount === 0;
  // The module/micro power-pairing observation is an ENGINEERING ADVISORY, not a
  // permit-readiness authority gap — it is surfaced as a note, NEVER counted into
  // the registry multiset (so PV-4A's electrical count stays == RS-1's, gate 5).
  const _pairAdvisory = _pairWarn
    ? `Module/micro power pairing ${_pairRatio.toFixed(2)} exceeds the manufacturer range 1.55 — expect output clipping (${Math.round(_pairModW)}W module on ${Math.round(_pairAcW)}W-AC micro). Engineering advisory — not a permit-readiness blocker.`
    : '';
  const _elecStatusLabel = _elecErrorCount > 0 ? 'BLOCKED — REVIEW REQUIRED'
    : _elecWarnCount > 0 ? 'PENDING — ITEMS OUTSTANDING' : 'COMPLIES';
  const _elecStatusColor = _elecErrorCount > 0 ? '#cc0000' : _elecWarnCount > 0 ? '#cc6600' : '#127a3e';
  /** Cap a canonical authority string for this dense sheet, stating the cap and
   *  where the full text lives. Never silently truncates. */
  const _cap = (s: string, n: number): string =>
    s.length > n ? `${s.slice(0, n).replace(/\s+\S*$/, '')}… (full text on RS-1)` : s;
  const _elecRegRow = (r: typeof _elecRegistry[number], sev: 'error' | 'warning') => {
    const seg = r.affectedSheets.length ? r.affectedSheets.join(', ') : '—';
    return `<tr style="background:${statusBg(sev)}">`
      + `<td style="color:${sev === 'error' ? '#cc0000' : '#cc6600'};font-weight:bold">${sev === 'error' ? 'BLOCKING' : 'PENDING'}</td>`
      + `<td class="mono f-lg">${r.code}</td>`
      // PV-4A is a DENSE calc sheet and this list grows one row per electrical
      // blocker: at the full explanation + a 200-char resolution, a sixth blocker
      // pushed the page conclusion 38px past the printable box (page-fit gate 17).
      // BOTH strings are capped here with an explicit pointer to RS-1, which renders
      // the FULL canonical explanation and resolutionAction — no authority text is
      // lost, and the cap is stated rather than silent.
      + `<td style="font-size:7.4px;line-height:1.2">${_cap(r.explanation, 190)}`
      + `<br/><span style="color:#555">Authority: <span class="mono">${r.authorityPath}</span>`
      + ` · Sheets: ${seg} · Resolve: ${_cap(r.resolutionAction, 130)}</span></td></tr>`;
  };
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
      ${(_elecRegistry.length || _parityUnresolved.length) ? `
      <table class="equip-table">
        <thead><tr><th style="width:14%">Type</th><th style="width:24%">Registry Code</th><th>Authority Path · Affected Sheets · Resolution</th></tr></thead>
        <tbody>
          ${_elecBlocking.map(r => _elecRegRow(r, 'error')).join('')}
          ${_parityUnresolved.map(p => `<tr style="background:${statusBg('error')}"><td style="color:#cc0000;font-weight:bold">BLOCKING</td><td class="mono f-lg">PARITY-UNRESOLVED</td><td style="font-size:8px">${p}</td></tr>`).join('')}
          ${_elecWarnings.map(r => _elecRegRow(r, 'warning')).join('')}
        </tbody>
      </table>` : `<div style="padding:var(--xs);font-size:var(--f-md);border:var(--border);border-top:none;background:#f0f7f0;color:#127a3e;font-weight:700">No blocking or pending electrical authority items on the canonical snapshot registry.</div>`}
      ${_pairAdvisory ? `<div style="padding:var(--xs);font-size:8.5px;border:var(--border);border-top:none;background:#fff8e1;color:#8a6d00">${_pairAdvisory}</div>` : ''}`;
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
        ${/* PPC §7 / gate 10 — a rendered row whose SUBJECT is a grounding conductor
              must reconcile to a canonical GroundingSegment. This summary row printed
              a bare feeder EGC gauge under the unqualified label "Grounding
              Conductor", which reads as a project-wide grounding conductor — the same
              collapse of six distinct objects into one that §1b killed on E-1. It now
              names its DOMAIN and carries its object's id. */''}
        <tr${(() => {
          const _fe = projectGroundingSegments(_snapA).find(g => g.purpose === 'feeder-egc');
          return _fe ? ` data-grounding-segment-id="${escapeH(_fe.groundingSegmentId)}"` : '';
        })()}><td class="il">Feeder EGC (in raceway)</td><td class="iv">${_ic.feederEgcGauge}</td><td class="il">Interconnection</td><td class="iv" style="color:#000">${_ic.isSupplySide ? 'SUPPLY-SIDE TAP — 120% N/A (705.11)' : (_ic.rulePasses == null ? 'PENDING — busbar evaluation not on canonical snapshot' : (_ic.rulePasses ? '✓ 120% RULE PASS' : '✗ FAIL'))}</td></tr>
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
          ${/* PPC §1b / gate 10 — this is a METHOD row (a code rule), not a rendered
                conductor: it is tagged as such so the grounding-row gate does not read
                it as an untagged conductor assertion, and its note no longer states a
                single gauge as if it were a PROJECT-WIDE minimum — each raceway /
                segment is sized on ITS OWN OCPD from its own canonical object. */''}
          <tr class="bg-lt" data-grounding-code-basis="true"><td class="fw7">EGC Sizing</td><td>Per NEC Table 250.122, on the OCPD of EACH circuit</td><td class="mono">NEC 690.45, 250.122</td><td>Sized per segment — not a project-wide minimum (see PV-4B GroundingSegment objects)</td></tr>
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
              // §5 — option B rating summary (no conductor/raceway column). The
              // sectioned physical schedule for this sub's branches is on E-1.
              return pv4aBranchRatingTable(
                `AC Branch Circuit Rating Summary — ${subSectionLabel(sub)} — NEC 690.8(A)`,
                sub.microBranches.map(b => ({ index: b.index, deviceCount: b.deviceCount, branchCurrentA: b.branchCurrentA, continuousA: b.continuousA, ocpdAmps: b.ocpdAmps })),
                sub.equipment.inverterModel, sub.equipment.inverterManufacturer,
              );
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
        // §5 — AC branch RATING SUMMARY (option B). The device rating facts only
        // (count / operating / continuous / OCPD / mfr per-branch limit); the
        // physical conductor + cable-assembly + raceway schedule is on E-1. No
        // '#12 THWN-2 → IQ Combiner' conductor implication anywhere on PV-4A.
        if (!_pairIsMicro) return '';
        const _pp = (input.project.panelPositions ?? []) as Array<{ id: string; planeId?: string; arrayId?: string; row?: number; col?: number; lat?: number; lng?: number }>;
        if (!_pp.length || !(_pairAcW > 0)) return '';
        const _pv4aEq = getEquipmentContext(input, cad);
        const _ratingTable = pv4aBranchRatingTable(
          'AC Branch Circuit Rating Summary — NEC 690.8(A)',
          _auth.microBranches.map(b => ({ index: b.index, deviceCount: b.deviceCount, branchCurrentA: b.branchCurrentA, continuousA: b.continuousA, ocpdAmps: b.ocpdAmps })),
          _pv4aEq.inverterModel, _pv4aEq.inverterManufacturer,
        );
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
        return `${_ratingTable}${_bosNote}`;
      })()}
      ${/* §4 (BAR closeout 2026-07-25) — PV-4A carries the SAME canonical
           AmpacityAdjustmentResult as E-1 and PV-4B (every factor itemized), so
           the three sheets can never disagree and none prints a lone derate. */
        renderAmpacityEvidenceBlock(projectE1PhysicalSchedule(_snapA), 'SHARED-RACEWAY AMPACITY ADJUSTMENT — NEC 310.15 / 110.14(C) (EVERY FACTOR; SAME OBJECT AS PV-4B / PV-4B.1)', true)}

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
  // ECD §7 — the canonical bonding authority for the grounding/bonding detail.
  const _bondE = projectRackingBondingAuthority(_snap);
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
              // §6 — the free-air branch CONDUCTOR is the LISTED Q-Cable ASSEMBLY
              // (manufacturer + model/SKU + construction), NEVER "#12 AWG THWN-2".
              // §7/§10 — the per-branch length is the geometry-derived designed-
              // installed path, labeled and traced to its BranchCablePath object.
              const _asm = projectListedCableAssembly(_snap);
              const _brPathById = new Map(_asm.branchPaths.map(p => [p.branchLabel, p]));
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
              return _auth.microBranches.map((b) => {
                const _bp = _brPathById.get(`B${b.index}`) ?? null;
                const _bLen = _bp?.designedInstalledLengthFt ?? _branch.oneWayFt;
                // §Q — NAME the quantity inline (compact, no extra row): the branch
                // trunk length is the geometric cable path (designed-installed), NOT a
                // route estimate or the BOM procurement footage. The reconciliation note
                // below + E-1's per-row label/object-id carry the full authority.
                const _bLenTxt = _bLen != null
                  ? `${_bLen} ft <span style="color:#888;font-size:5.5px">${_bp ? '(cable path)' : '(route est.)'}</span>`
                  : '—';
                // §6 — compact assembly SKU here (the full listed-assembly authority
                // is the dedicated table below); never a generic THWN gauge.
                const _condCellAsm = _asm.present
                  ? `${_asm.assembly!.sku ?? _asm.assembly!.ecosystem}`
                  : `Q-Cable ${_branch.gauge ?? '#12 AWG'}`;
                return `
              <tr>
                <td class="fw7">AC Branch ${b.index}</td>
                <td>${b.deviceCount} × Microinverter</td>
                <td>Roof J-Box (open air)</td>
                <td style="font-size:7.5px">${_condCellAsm}</td>
                <td>${b.branchCurrentA.toFixed(1)}A</td>
                <td>${b.ocpdAmps}A</td>
                <td>—</td>
                <td>${_brConduit}</td>
                <td>${_bLenTxt}</td>
              </tr>`;
              }).join('') + _hrRow;
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
          ${/* PPC §7 — the legacy hardcoded project-level EGC <tr> is DELETED.
                It printed the FEEDER's EGC gauge relabelled "Array → AC Disconnect
                (ground bus)" with the feeder row's own conduit + length reprinted
                as if they were the grounding run's — a grounding conductor with no
                id, no segment, no raceway of its own, no BOM line and no authority
                state. Replaced by the canonical GroundingSegment objects below
                (gate 10: every rendered grounding row carries a groundingSegmentId). */
            renderGroundingSegmentRows(_snap)}` : ''}
        </tbody>
      </table>
      ${(() => {
        // §6/§7/§10 — the LISTED CABLE ASSEMBLY authority + the geometric length
        // reconciliation. The open-air branch trunk is a manufacturer-listed
        // factory-connectorized cable (not a field-run THWN conductor); its length
        // is DERIVED from module coordinates (not the plane-width heuristic), so the
        // per-branch designed-installed footage and the drop-based procurement
        // quantity reconcile with the BOM (gate 6/7). Micro topology only.
        const _asmB = projectListedCableAssembly(_snap);
        if (!_asmB.present || !_asmB.assembly) return '';
        const a = _asmB.assembly;
        const _perBranch = _asmB.branchPaths
          .map(p => `${p.branchLabel} ${p.dropCount}d/${p.designedInstalledLengthFt != null ? p.designedInstalledLengthFt.toFixed(0) : '—'}ft`)
          .join(' · ');
        // §Q — the canonical procurement-sufficiency authority. When the ordered
        // (drop-based) footage is SHORT of the Σ designed-installed path, the base
        // cable quantity is NOT an orderable final total (NON-ORDERABLE / PENDING
        // SOLUTION, like the racking pattern) and a fail-closed
        // QCABLE-PROCUREMENT-INSUFFICIENT blocker fires — never a "jumpers required"
        // note. Speculative jumpers are excluded from authoritative totals.
        const _ps = _snap?.electrical?.procurementSufficiency ?? null;
        const _short = !!_ps?.insufficient;
        const _procTxt = _ps?.procurementLengthFt ?? _asmB.totalProcurementFt ?? '—';
        // The open-air branch GROUNDING authority rides INSIDE this same assembly
        // note (no extra box — PV-4B page-fit, gate 13). The METHOD comes from the
        // document-based three-outcome resolver — NEVER from the conductor count,
        // which is recorded here only as non-determinative construction data. Under
        // the live PENDING outcome the sheet asserts no method at all.
        const _gndB = projectOpenAirBranchGrounding(_snap);
        const _gndA = _gndB.authority;
        const _gndInline = !_gndB.present ? ''
          : _gndB.outcome === 'PENDING_MANUFACTURER_AUTHORITY'
            // PPC §1 — compacted: the full pending explanation now renders ONCE per
            // sheet (the GroundingSegment block + grounding note 3 above), not twice.
            // The authority-bearing content is preserved: the pending label, the
            // blocker code, the exact selected equipment, the non-determinative
            // conductor count, and the CANDIDATE non-orderable quantity.
            ? ` <strong style="color:#b45309">${GROUNDING_PENDING_LABEL} (${GROUNDING_AUTHORITY_BLOCKER_CODE} — BLOCKING):</strong> not established for the selected <span class="mono">${_gndA?.selectedMicroinverterSku ?? 'micro'}</span> + <span class="mono">${_gndA?.selectedCableAssemblySku ?? 'cable'}</span>; the ${a.conductorCount ?? 2}-conductor construction is NOT determinative. Candidate <span class="mono">${_gndB.conductorSize ?? '—'} ${_gndB.conductorMaterial ?? 'Cu'} ${_gndB.bomFootageFt ?? '—'}ft</span> = ${GROUNDING_NON_ORDERABLE_LABEL}. Module/racking bonding is distinct and still required. See RS-1.`
            : _gndB.outcome === 'NO_SEPARATE_EGC_REQUIRED'
              ? ` <strong>GROUNDING (LISTED METHOD):</strong> ${_gndB.sourceAuthority} — no additional grounding conductor is installed in this open-air section; module/racking bonding remains required on its own authority (${_gndA?.rackingModuleBondingRequirement.codeBasis ?? 'NEC 690.43'}).`
              : ` <strong>GROUNDING (${_gndA?.documentId ?? 'verified document'}, NEC 250.122/690.43(C)):</strong> an ADDITIONAL <strong>${_gndB.conductorSize ?? '#12'} ${_gndB.conductorMaterial ?? 'Cu'} EGC</strong> is required by the cited manufacturer instruction, run open-air with each branch trunk (${_gndB.branchIds.join(', ') || 'all branches'}); <em>BOM qty</em> <span class="mono">${_gndB.bomFootageFt ?? 'PENDING'}ft</span> = designed-installed <span class="mono">${_gndB.designedInstalledFt ?? '—'}ft</span> × ${_gndB.wasteFactor} waste (${_gndB.lengthProvenance ?? 'pending'}) — same route geometry as the trunk.`;
        const _insuffBlock = _short
          ? ` <strong style="color:#b00">⚠ PROCUREMENT INSUFFICIENCY (QCABLE-PROCUREMENT-INSUFFICIENT — BLOCKING): designed ${_ps!.totalDesignedInstalledFt} ft + allowance ${_ps!.requiredServiceLoopAllowanceFt} ft (${_ps!.allowanceProvenance}) &gt; procurement ${_ps!.procurementLengthFt} ft by <span class="mono">${_ps!.deficitFt} ft</span>. Base cable qty <span class="mono">${_procTxt} ft</span> = CURRENT BASE CABLE QUANTITY only — NON-ORDERABLE / PENDING SOLUTION (verified listed extension required; "jumpers required" does NOT clear this). Affected: ${_ps!.affectedBranchIds.join(', ') || '—'}. See RS-1.</strong>`
          : '';
        // Compact one-line authority + reconciliation note (the per-branch designed
        // lengths already print in the branch rows; the full per-branch math lives on
        // E-1's sectioned schedule + the evidence artifact). Keeps PV-4B page-fit.
        return `
      <div style="padding:1px 6px;font-size:6.3px;line-height:1.1;border:var(--border);border-top:none;background:#eef4fa;">
        ${/* PPC gate 17 — 1.25 leading: this note carries the open-air grounding
              explanation AND (when the deficit fires) the procurement statement, and
              PV-4B's page-content flex child cannot shrink. */''}
        <strong>LISTED AC TRUNK CABLE ASSEMBLY (${a.assemblyId}, §6/§7/§10):</strong>
        ${a.manufacturer} ${a.ecosystem} <span class="mono">${a.sku ?? 'PENDING'}</span>${a.conductorCount && a.conductorGauge ? ` · ${a.conductorCount}×${a.conductorGauge}` : ''} · ${a.connectorSpacingFt != null ? a.connectorSpacingFt + 'ft O.C.' : ''} · ${a.maxBranchCurrentA != null ? a.maxBranchCurrentA + 'A branch (TC-ER, 690.31(C))' : ''}. <strong>Lengths (one quantity per label):</strong> ${_asmB.totalDrops ?? '—'} drops (BOM/PV-1B invariant) · <em>cable path (geometry)</em> <span class="mono">${_asmB.totalDesignedInstalledFt != null ? _asmB.totalDesignedInstalledFt.toFixed(1) : '—'}ft</span> (Σ BranchCablePath designed-installed; per-branch in Length col) · <em>procurement (base cable qty)</em> <span class="mono">${_procTxt}ft</span> (Σ drops×${a.connectorSpacingFt ?? '—'}ft pitch×waste — drop-count basis, not designed×waste); distinct quantities per BranchCablePath object.${_insuffBlock}${_gndInline}
      </div>`;
      })()}
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
      <div style="padding:2px 6px;font-size:7px;line-height:1.35;border:var(--border);border-top:none;background:#fafafa;">
        <strong>VOLTAGE DROP INTERPRETATION:</strong>
        AC feeder Vd = ${_feedVdTxt} over ${_feedLenTxt} of ${_feedCallout} Cu${_feed.currentA != null ? ` at the PV operating current ${_feed.currentA.toFixed(1)} A (OCPD ${_ic.feederOcpd || '—'} A is not the Vd load current)` : ''}. NEC 210.19(A) IN recommends ≤3% feeder / ≤5% total.
        ${_feed.voltageDropPct == null ? 'Feeder Vd pending conductor authority — resolve before submission.' : ((_feed.voltageDropPct || 0) <= 3 ? 'Within limits — no upsizing required.' : 'Exceeds 3% — upsize conductors or reduce run length.')}
      </div>
      ${''/* Formula-tutorial box removed — code-book pedagogy that displaced
           project content on the fixed sheet; the calc row + interpretation
           above carry the engineering result. */}` : ''}

      ${/* Generic NEC reference tables (temp-correction factors, rooftop adder
           matrix) removed — they duplicated code-book content, pushed the
           project-specific LOAD CALC off the fixed sheet (silent clipping),
           and PV-4A's methodology table already cites the sections. */''}
      ${/* §4 (BAR closeout 2026-07-25) — the generic "TEMPERATURE DERATING NOTE"
           prose that used to sit here is RETIRED: it asserted a rooftop adder and
           "worst-case" derating with NO numbers, which is precisely the
           unexplained-derate defect §4 forbids. It is replaced by the CANONICAL
           AmpacityAdjustmentResult — the SAME object E-1 and PV-4A project, with
           every factor (90 °C base, CCC count-adjustment, ambient correction,
           rooftop adder where applicable, corrected, 75 °C terminal cap, final
           allowable vs required continuous, verdict). */
        renderAmpacityEvidenceBlock(projectE1PhysicalSchedule(_snap), `SHARED-RACEWAY AMPACITY ADJUSTMENT${_auth.isHybrid ? ' — ROOF SUB-SYSTEM' : ''} — NEC 310.15 / 110.14(C) (EVERY FACTOR; SAME OBJECT AS PV-4B.1 / PV-4A)`, true)}
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
            ${(() => {
              // §9 (closeout 2026-07-23) — SPLIT the single "COMPLIES" verdict into
              // (a) the SELECTED interconnection METHOD and (b) INSTALLATION
              // COMPLIANCE gated on the tap-conductor 705.11(C) verification state.
              // A supply-side tap is never "COMPLIES" while the ≤10-ft tap-conductor
              // length is unmeasured — COMPLIES only with verified inputs + a passing
              // tap rule (consumes the canonical serviceTopology constraint state).
              const _tap5 = _svc('tap-conductors');
              const _tapRule5 = _tap5?.constraints.find(c => c.code === 'NEC-705.11(C)-TAP-10FT');
              const _instState = evaluateCompliance({
                requiredValues: [
                  { label: 'tap-conductor length', value: _tap5?.lengthFt, numeric: true },
                ],
                checks: [
                  { label: 'tap conductors ≤ 10 ft (NEC 705.11(C))',
                    pass: _tapRule5 ? (_tapRule5.state === 'pass' ? true : _tapRule5.state === 'fail' ? false : null) : null },
                ],
              });
              const _instTxt = _instState.state === 'PASS' ? 'INSTALL: COMPLIES'
                : _instState.state === 'FAIL' ? 'INSTALL: FAIL — TAP > 10 FT'
                : 'INSTALL: PENDING — TAP-CONDUCTOR LENGTH NOT VERIFIED';
              const _instColor = _instState.state === 'PASS' ? '#127a3e' : _instState.state === 'FAIL' ? '#cc0000' : '#cc6600';
              // §9 — method SELECTED and installation compliance are SEPARATE facts
              // in ONE row: the supply-side tap is the selected method, but it is
              // never "COMPLIES" until the ≤10-ft tap-conductor rule is verified.
              return `
            <tr style="background:#fff;border:2px solid #000;"><td class="fw9 mono">5</td><td style="font-weight:900;">Supply-Side Connection — NEC 705.11 (method + install)</td><td>Method: supply-side (line-side) tap ahead of the ${mainA}A service disconnect; 120% busbar rule (705.12(B)) N/A. Install compliance: gated on the tap-conductor ≤10-ft rule (705.11(C)/240.21(B)).</td><td style="font-weight:900;text-align:right;font-size:8px;"><div>SUPPLY-SIDE TAP — SELECTED</div><div style="color:${_instColor};margin-top:1px;">${_instTxt}</div></td></tr>`;
            })()}
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
        <div style="padding:2px 6px;font-size:7px;line-height:1.35;border:var(--border);border-top:none;background:#fafafa;">
          <strong>SUPPLY-SIDE INTERCONNECTION — NEC 705.11:</strong>
          PV output connects to the supply (line) side of the ${_svcA}A service disconnect. Distinct objects, each with its OWN length: the <em>tap conductors</em> (tap point → ${_fusedA}A fused AC disconnect, ≥125% of PV output = ${continuousA.toFixed(1)}A) carry the 705.11(C)/240.21(B) ≤10-ft rule (<strong>${_ruleStateTxt}</strong>; run = ${_tapLenTxt}) — a SEPARATE segment from the <em>PV AC feeder</em> (combiner → disconnect, ${_feedLenTxt}${_feed.lengthSource === 'cad-derived-estimate' ? ' CAD est' : ''}, ${_feedVdTxt} drop). The 10-ft rule does not govern the feeder; the 120% busbar rule (705.12(B)) applies only load-side. Service/metering adequacy field-verified with the utility.
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
            <!-- ECD §7 — SCHEMATIC bond path from module frame to rail. The node
                 symbols are schematic bond POINTS; the bonding METHOD (integrated
                 listing vs discrete components) is stated by the canonical bonding
                 authority below, never implied by this figure. -->
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
            <!-- ECD §7 — this label asserted 'UL 2703' with no authority. It now
                 states the REQUIREMENT (code) and, on the line below, the METHOD the
                 canonical bonding authority establishes (PENDING while no verified
                 exact racking assembly exists). -->
            <text x="150" y="69" text-anchor="middle" font-size="6.5" fill="#1a2230" font-weight="bold">MODULE RAIL — BONDED PER ${_bondE.requirementCodeBasis}</text>
            <text x="18" y="79" font-size="5" font-weight="bold" fill="${_bondE.verificationState === 'verified' ? '#0f5c30' : '#b45309'}" data-bonding-result="${_bondE.result}">BONDING METHOD: ${_bondE.methodCompactLabel}</text>
            <!-- EGC rail -> inverter / combiner. PPC §1 — this is the IN-RACEWAY
                 home-run EGC domain and it is labelled with ITS OWN object's gauge.
                 It used to print the FEEDER EGC gauge, collapsing two of the six
                 distinct grounding objects into one detail label. -->
            <line x1="150" y1="71" x2="150" y2="94" stroke="#127a3e" stroke-width="1.8"/>
            <text x="156" y="86" font-size="7" fill="#0f5c30" font-weight="bold">RACEWAY EGC</text>
            <text x="156" y="94" font-size="6" fill="#0f5c30">${projectSharedBranchRaceway(_snap).egcGauge ?? _feed.egcGauge ?? 'PENDING'} Cu · 250.118/250.122</text>
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
        <!-- PPC §1b — 6.5px/1.15 (was var(--f-sm)/1.2): the canonical
             GroundingSegment object list now renders on this sheet too, and PV-4B's
             page-content flex child cannot shrink, so this note column gives back
             the ~10px it needs. Still at the 6.5px note floor used sheet-wide. -->
        <div style="font-size:6.5px;line-height:1.15;">
          <div style="font-weight:900;font-size:8.5px;margin-bottom:1px;letter-spacing:0.5px;">GROUNDING & BONDING REQUIREMENTS</div>
          <div style="margin-bottom:1px;">1. All module frames bonded to mounting rail via ${(() => {
            // §11/§12 (closeout 2026-07-23): the bonding hardware is ASSEMBLY-
            // DEPENDENT — it cannot be pinned as authority until the rail assembly
            // is selected. While the rail SKU is pending (railSku == null) the
            // named part (e.g. "RT-MINI Bond Clip") is an unselected candidate, NOT
            // an orderable specification, so the note renders PENDING RACKING
            // ASSEMBLY SELECTION rather than the residual RT-MINI part string.
            // ECD §7 — this note used to name "the racking manufacturer's listed
            // UL 2703 bonding hardware" as the METHOD (with a PENDING tail), which
            // still asserts a UL 2703 integrated/hardware method for an unselected
            // assembly. The METHOD now comes from the canonical bonding authority;
            // the frames-must-be-bonded REQUIREMENT is unchanged.
            const _ra = _snap.structural.rackingAssembly;
            const _bondPart = _ra?.groundingBonding;
            return _bondE.verificationState === 'verified'
              ? `${_bondE.methodShortLabel}${_bondPart ? ` (${_bondPart})` : ''}`
              : `the bonding method established by the verified racking assembly &mdash; `
                + `<strong>${escapeH(_bondE.methodCompactLabel)}</strong> `
                + '(bonding is assembly-dependent; the method is specified once the exact assembly is verified)';
          })()}.</div>
          ${(() => {
            // ── PPC §1b — notes 2 + 3 are AUTHORITY-GATED and DOMAIN-SCOPED ────
            // The retired notes were:
            //   2. "Equipment grounding conductor (EGC): <feederEgcGauge> bare Cu
            //       min. per NEC 250.122 and 690.45."  ← the FEEDER object's gauge
            //       presented as a PROJECT-WIDE EGC minimum, collapsing two of the
            //       six distinct grounding objects into one claim.
            //   3. "EGC routed with circuit conductors in same raceway per NEC
            //       690.43(A)."  ← asserts a RACEWAY method for the FREE-AIR branch
            //       section, and asserts an installed EGC while the open-air
            //       grounding authority is PENDING.
            // Now: the IN-RACEWAY sections state their own independent NEC basis,
            // and the OPEN-AIR branch section states the canonical authority's
            // outcome — never an installed conductor while PENDING.
            const _gN = projectOpenAirBranchGrounding(_snap);
            const _hrN = projectSharedBranchRaceway(_snap);
            const _rwEgcs = [
              _hrN.present && _hrN.egcGauge ? `shared branch home-run ${_hrN.egcGauge}` : null,
              _feed.egcGauge ? `combiner feeder ${_feed.egcGauge}` : null,
            ].filter(Boolean).join('; ');
            const note2 = _rwEgcs
              ? `2. IN-RACEWAY EGCs (NEC 250.118/250.122, per-run OCPD): ${_rwEgcs} &mdash; not a project-wide minimum.`
              : `2. IN-RACEWAY EGCs: NEC 250.118/250.122 on each run&rsquo;s own OCPD &mdash; PENDING (no canonical object).`;
            const note3 = !_gN.present
              ? `3. EGCs run with the circuit conductors of the SAME raceway (NEC 250.102) &mdash; in-raceway only.`
              : _gN.outcome === 'PENDING_MANUFACTURER_AUTHORITY'
                ? `3. Open-air branch, 690.31(C): <strong style="color:#b45309">${GROUNDING_PENDING_BONDING_CELL_LABEL}</strong> (${GROUNDING_AUTHORITY_BLOCKER_CODE} &mdash; RS-1); note 2 is in-raceway only.`
                : _gN.outcome === 'NO_SEPARATE_EGC_REQUIRED'
                  ? `3. Open-air branch, 690.31(C): LISTED INTEGRATED METHOD per ${escapeH(_gN.sourceAuthority)} &mdash; no additional conductor; note 2 is in-raceway only.`
                  : `3. Open-air branch, 690.31(C): ADDITIONAL ${_gN.conductorSize ?? 'NEC 250.122'} ${_gN.conductorMaterial ?? 'Cu'} EGC required by ${escapeH(_gN.sourceAuthority)}; note 2 is in-raceway only.`;
            return `<div style="margin-bottom:1px;">${note2}</div>`
              + `<div style="margin-bottom:1px;">${note3}</div>`;
          })()}
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
          <div style="margin-bottom:1px;">6. ${(() => {
            // ECD §7 — a FIFTH site for the same defect: this note prescribed
            // "Bonding jumpers installed at all mechanical joints" — a specific
            // METHOD, as an installation instruction, unconditionally, with no
            // selected bonding component anywhere in the design. The REQUIREMENT
            // (mechanical joints in the racking system must be bonded, NEC 250.96)
            // is code and stays; the METHOD projects the canonical authority.
            return _bondE.verificationState === 'verified'
              ? `Racking mechanical joints bonded per NEC 250.96 — ${escapeH(_bondE.methodShortLabel)}.`
              : 'Mechanical joints in the racking system shall be bonded per NEC 250.96. '
                + `BONDING METHOD: <strong style="color:#b45309;">${escapeH(_bondE.methodCompactLabel)}</strong> `
                + '&mdash; no bonding component is specified by this drawing.';
          })()}</div>
          <div style="color:#555;font-size:7px;margin-top:3px;font-style:italic;">Detail is typical &mdash; the bonding METHOD is established by the canonical racking bonding authority, not by this figure.</div>
        </div>
      </div>

      <div style="padding:2px 6px;margin-top:2px;font-size:var(--f-sm);line-height:1.25;border:2px solid #000;background:#fff;">
        <strong>PAGE CONCLUSION — CONDUCTOR & CONDUIT SCHEDULE:</strong>
        Conductors sized per NEC 690.8 (Isc × 1.25), OCPD per NEC 690.9, temperature/fill derating per NEC 310.15.
        ${_feed.voltageDropPct != null && _feed.voltageDropPct <= 3 ? 'AC feeder voltage drop is within NEC recommended limits.' : 'Voltage drop requires review.'}
        ${(() => {
          // §3 (BAR) — the retired sentence ("All conductors are sized appropriately
          // for the calculated load conditions") was a GLOBAL compliance claim
          // rendered while conduit-fill / tap-length blockers were open. The
          // conclusion now derives from the canonical registry.
          const _n = ((peekSnapshot(input)?.permitReadiness?.registry ?? [])
            .filter(r => !r.resolved && r.severity === 'blocking')).length;
          return _n > 0
            ? `<strong style="color:#b45309;">DESIGN BASIS ONLY &mdash; NOT A CERTIFIED SIZING CONCLUSION while ${_n} release blocker${_n === 1 ? '' : 's'} remain open (see RS-1).</strong>`
            : `Conductor sizing for this ${system.totalDcKw?.toFixed(2) || '—'} kW DC system is complete with no open release blockers.`;
        })()}
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
      // Post-AAC E-1 repair — deterministic drawing viewport. The old wrapper was
      // a plain block whose height came from nowhere: as flex siblings (schedule,
      // grounding note) grew, the wrapper flex-shrank to a ~267px strip while the
      // SVG kept its natural ~993px height, was vertically centered, and the
      // outer overflow:hidden severed most of the diagram. `.sld-wrap` is the
      // page's flex:1/min-height:0 drawing box (see the .sld-page CSS): the SVG
      // fills it via width/height:100% + viewBox + preserveAspectRatio meet — the
      // whole bounding box always inside the wrapper, aspect preserved, no crop.
      sldBodyHtml = `<div class="sld-wrap">${liveSvg}</div>`;
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

  // Post-AAC E-1 repair — E-1 is again the DEDICATED single-line-diagram sheet.
  // The canonical physical section schedule + shared-raceway ampacity chain +
  // open-air grounding note that used to stack under the diagram (and flex-shrank
  // it into a clipped strip) now render ONCE on PV-4B.1 (pageConductorScheduleCont).
  // The canonical sections are still computed here for the hidden machine-readable
  // evidence stamp — the harness reads the SAME objects the PV-4B.1 sheet renders.
  const _e1Sections = projectE1PhysicalSchedule(getSnapshot(input));

  return `
  <div class="page sld-page">
    ${titleBlock(input, 'E-1', 'SINGLE-LINE ELECTRICAL DIAGRAM', pageNum, totalPages)}
    ${_sldStamp}
    ${sldBodyHtml}
    ${_sldSubZone}
    ${/* the machine-readable evidence stamp goes LAST so its JSON payload never
         lands inside the diagram/schedule text ranges harnesses slice on. */
      renderBarElectricalEvidenceStamp(getSnapshot(input), _e1Sections)}
  </div>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// PV-4B.1 — CONDUCTOR & CONDUIT SCHEDULE, PHYSICAL SECTIONS (post-AAC E-1
// repair). The canonical section objects (Q-Cable branch trunks, shared home-run
// raceway with its full CCC inventory, feeder, tap conductors), the full
// shared-raceway ampacity chain and the open-air branch grounding note render
// HERE — once, on the conductor/conduit schedule family — instead of stacking
// under the E-1 diagram. Emitted only when canonical physical sections exist
// (micro topologies); string/optimizer jobs have no sectioned schedule and no
// PV-4B.1. Never duplicated on E-1.
// ═══════════════════════════════════════════════════════════════════════════
/** The ONE PV-4B.1 predicate, shared verbatim by the sheet manifest (which runs
 *  DURING snapshot construction, before `_snapshot` attaches — it may not read
 *  the snapshot) and the page assembly: the sectioned physical schedule exists
 *  for MICRO topologies (projectE1PhysicalSchedule is empty for string /
 *  optimizer jobs by construction). Topology resolves through the same accessor
 *  computePlansetManifest already uses, so the two sides cannot drift. */
export function hasPhysicalSectionSchedule(input: PermitInput, cad: CADModel): boolean {
  return topologyToLegacy(getInverterTopology(input, cad)) === 'MICRO';
}

export function pageConductorScheduleCont(input: PermitInput, cad: CADModel, pageNum: number, totalPages: number): string {
  void cad;
  const _snap = getSnapshot(input);
  const _sections = projectE1PhysicalSchedule(_snap);
  return `
  <div class="page">
    ${titleBlock(input, 'PV-4B.1', 'CONDUCTOR SCHEDULE — PHYSICAL SECTIONS', pageNum, totalPages)}
    <div class="page-content">
      <div class="section-title">Physical Conductor / Raceway Schedule — Canonical Section Objects (continued from PV-4B)</div>
      ${_sections.length
        ? `${renderE1PhysicalSchedule(_sections)}
      ${renderOpenAirBranchGroundingNote(_snap)}`
        : `<div style="padding:var(--xs);font-size:var(--f-sm);border:var(--border);background:#fafafa;color:#b45309;">
        No canonical physical section objects are projected for this system — the sectioned schedule is empty.
        See PV-4B for the circuit conductor schedule and RS-1 / the project review record for open requirements.
      </div>`}
    </div>
  </div>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// BAR §4/§5/§7/§8 EVIDENCE EXPORT (closeout 2026-07-25) — the canonical
// electrical authority objects emitted as a MACHINE-EXTRACTABLE stamp on E-1, so
// the evidence harness reads the SAME objects the sheets render instead of
// re-deriving them (a second derivation is exactly the drift class this campaign
// kills). Hidden from print; JSON-escaped into a data attribute.
//   §4 ampacityAdjustments — one full AmpacityAdjustmentResult per section
//   §5 openAirBranchGrounding — the ONE grounding result + route + BOM footage
//   §8 openAirWiringMethod — the listed wiring-method identity the legend uses
// ═══════════════════════════════════════════════════════════════════════════
export function renderBarElectricalEvidenceStamp(
  snap: import('../snapshot/types').PermitDesignSnapshot | null | undefined,
  sections: E1PhysicalSection[],
): string {
  if (!snap) return '';
  const asm = projectListedCableAssembly(snap);
  const payload = {
    snapshotId: snap.meta?.snapshotId ?? null,
    // §4 — every section's FULL itemized chain (never a lone scalar).
    ampacityAdjustments: sections
      .filter(s => s.ampacity != null)
      .map(s => ({ sectionId: s.sectionId, fillApplicable: s.fillApplicable, ...s.ampacity })),
    // §5 — the ONE grounding result, its route objects and its BOM quantity.
    openAirBranchGrounding: projectOpenAirBranchGrounding(snap),
    // §8 — the wiring-method identity the legend must name (topology-derived).
    openAirWiringMethod: asm.present
      ? {
          assemblyId: asm.assembly!.assemblyId,
          wiringMethodLabel: asm.assembly!.wiringMethodLabel,
          sku: asm.assembly!.sku,
          conductorCount: asm.assembly!.conductorCount,
          insulationListing: asm.assembly!.insulationListing,
        }
      : null,
    // §7 — the occupied-drop topology the cap/terminator quantities derive from.
    connectorTopology: {
      branchCount: (snap.electrical?.branches ?? []).length,
      occupiedDrops: asm.totalDrops,
      perBranch: asm.branchPaths.map(p => ({
        branchId: p.branchId, branchLabel: p.branchLabel,
        dropCount: p.dropCount, cableEndObjectId: `${p.branchLabel}-END`,
      })),
    },
  };
  const json = JSON.stringify(payload)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<div class="bar-electrical-evidence" data-bar-wse="${json}" style="display:none"></div>`;
}




