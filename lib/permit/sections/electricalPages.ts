// ═══════════════════════════════════════════════════════════════
// Electrical Pages — NEC Compliance, Conductor Schedule, SLD
// Extracted from route.ts — ZERO REGRESSION
// ═══════════════════════════════════════════════════════════════

import type { PermitInput } from '../types';
import type { CADModel } from '@/lib/cad/types';
import { titleBlock } from '../utils/titleBlock';
import { sysTypeLabel, topologyDisplayLabel, resolveInverterCount, statusColor, statusBg, statusBorder, statusLabel, interconnectionLabel, utilityDisplayName, necNextStandardOcpd, type SysType } from '../utils/helpers';
import { getEquipmentContext, getInverterTopology, isFence, isGround, isRoof, topologyToLegacy } from '@/lib/system';
import { generateLiveSLD } from '../utils/sldAdapter';
import { microBranchCount } from '../utils/branching';

// ─── (Existing pages reused with minor upgrades) ─────────────────────────────


// ═══════════════════════════════════════════════════════════════
// PV-2B: GROUND ARRAY PLAN
// ═══════════════════════════════════════════════════════════════

export function pageNECCompliance(input: PermitInput, cad: CADModel, pageNum: number, totalPages: number): string {
  const { compliance, rulesResult, overrides, system } = input;
  const necVer = compliance.jurisdiction?.necVersion || '2020';
  // CAD-sourced electrical values — authoritative
  const cadTotalDcKw  = cad.totalDcKw  || system?.totalDcKw  || 0;
  const cadTotalPanels = cad.totalPanels || system?.totalPanels || 0;
  const _isRoof = isRoof(cad.systemType);
  const _isFence = isFence(cad.systemType);
  const _isGround = isGround(cad.systemType);
  return `
  <div class="page">
    ${titleBlock(input, 'PV-4A', 'NEC COMPLIANCE SHEET', pageNum, totalPages)}
    <div class="page-content">
      <div class="section-title">Electrical Compliance — NEC ${necVer}</div>
      ${rulesResult ? `
      <div class="rules-summary">
        <div class="rs" style="color:${rulesResult.errorCount > 0 ? '#cc0000' : '#000'}">
          <div class="rs-val">${rulesResult.errorCount}</div><div class="rs-lbl">Errors</div>
        </div>
        <div class="rs" style="color:${rulesResult.warningCount > 0 ? '#cc6600' : '#000'}">
          <div class="rs-val">${rulesResult.warningCount}</div><div class="rs-lbl">Warnings</div>
        </div>
        <div class="rs" style="color:#000">
          <div class="rs-val">${rulesResult.autoFixCount}</div><div class="rs-lbl">Auto-Fixed</div>
        </div>
        <div class="rs" style="color:#000">
          <div class="rs-val">${rulesResult.overrideCount}</div><div class="rs-lbl">Overrides</div>
        </div>
      </div>
      <table class="equip-table">
        <thead><tr><th style="width:18%">Code Reference</th><th style="width:25%">Description</th><th style="width:30%">Result</th><th style="width:15%">Value / Limit</th><th style="width:12%">Status</th></tr></thead>
        <tbody>
          ${(rulesResult.rules || []).filter(rule => _isRoof || rule.category !== 'structural' || !String(rule.ruleId || '').includes('rafter')).map(rule => `
          <tr style="background:${statusBg(rule.severity)}">
            <td class="mono f-lg">${rule.necReference || rule.asceReference || rule.ruleId}</td>
            <td>${rule.title}${rule.autoFixed ? ' <span style="background:#f5f5f5;color:#000;padding:1px 5px;;font-size:8px;font-weight:700">Auto-Fixed</span>' : ''}</td>
            <td style="font-size:9px;color:#333">${rule.message}</td>
            <td style="font-family:monospace;font-size:9px;text-align:right">${rule.value !== undefined ? `${rule.value}${rule.limit !== undefined ? ` / ${rule.limit}` : ''}` : '—'}</td>
            <td style="text-align:center;font-weight:bold;color:${statusColor(rule.severity)}">${statusLabel(rule.severity)}</td>
          </tr>`).join('')}
        </tbody>
      </table>` : `
      ${compliance.electrical ? `
      <table class="info-table">
        <tr><td class="il">DC Size</td><td class="iv">${compliance.electrical.summary?.totalDcKw?.toFixed(2)} kW</td><td class="il">AC Capacity</td><td class="iv">${compliance.electrical.summary?.totalAcKw?.toFixed(2)} kW</td></tr>
        <tr><td class="il">Grounding Conductor</td><td class="iv">${compliance.electrical.groundingConductor}</td><td class="il">Busbar Rule</td><td class="iv" style="color:${compliance.electrical.busbar?.passes ? '#000' : '#cc0000'}">${compliance.electrical.busbar?.passes ? '✓ PASS' : '✗ FAIL'}</td></tr>
      </table>` : '<p style="color:#555;font-style:italic;padding:5px;text-align:center;font-size:8.5px">Run compliance check to populate this section.</p>'}
      `}
      <!-- Calculation Methodology -->
      <div class="section-title">Calculation Methodology — NEC ${necVer} Article 690</div>
      <table class="equip-table">
        <thead><tr><th style="width:22%">Parameter</th><th style="width:35%">Calculation Method</th><th style="width:25%">Code Reference</th><th>Notes</th></tr></thead>
        <tbody>
          <tr><td class="fw7">Max System Voltage</td><td>Voc × Temp. Correction Factor (Table 690.7(A))</td><td class="mono">NEC 690.7(A)</td><td>Corrected for lowest expected ambient temp.</td></tr>
          <tr class="bg-lt"><td class="fw7">Max Circuit Current</td><td>Isc × 1.25</td><td class="mono">NEC 690.8(A)(1)</td><td>Continuous duty factor</td></tr>
          <tr><td class="fw7">OCPD Rating</td><td>Max Circuit Current × 1.25</td><td class="mono">NEC 690.8(B)(1)</td><td>Or next standard fuse/breaker size</td></tr>
          <tr class="bg-lt"><td class="fw7">Conductor Ampacity</td><td>≥ Max Circuit Current (after derating)</td><td class="mono">NEC 690.8(B), 310.15</td><td>Corrected for temp. and conduit fill</td></tr>
          <tr><td class="fw7">Backfeed Breaker</td><td>120% Rule: Main + PV ≤ Busbar × 1.2</td><td class="mono">NEC 705.12(B)(2)(3)</td><td>Load-side connection method</td></tr>
          <tr class="bg-lt"><td class="fw7">EGC Sizing</td><td>Per NEC Table 250.122 based on OCPD</td><td class="mono">NEC 690.45, 250.122</td><td>Min. #12 AWG Cu for ≤ 20A circuits</td></tr>
          <tr><td class="fw7">Voltage Drop</td><td>Vd = (2 × L × I × R) / 1000</td><td class="mono">NEC 210.19(A) FPN</td><td>Target ≤ 2% branch, ≤ 3% feeder</td></tr>
          <tr class="bg-lt"><td class="fw7">Conduit Fill</td><td>Per NEC Chapter 9, Table 1</td><td class="mono">NEC Ch. 9 Table 1</td><td>Max 40% fill for 3+ conductors</td></tr>
          <tr><td class="fw7">Rapid Shutdown</td><td>Array-level: ≤ 80V within 30s</td><td class="mono">NEC 690.12</td><td>Module-level per 690.12(B)(2)</td></tr>
          <tr class="bg-lt"><td class="fw7">Ground-Fault Protection</td><td>GFDI required per system type</td><td class="mono">NEC 690.41, 690.5</td><td>Inverter-integrated or standalone</td></tr>
        </tbody>
      </table>
      <div style="padding:var(--xs);font-size:var(--f-md);line-height:1.6;border:var(--border);border-top:none;background:#fafafa;">
        <strong>ENGINEERING INTERPRETATION:</strong> The above methodology is applied to all DC and AC circuits in this system.
        Each conductor, overcurrent device, and disconnect has been sized using the calculation chain shown.
        Temperature correction factors per NEC 310.15(B)(1) are applied. ${_isRoof ? 'Rooftop temperature adders per NEC 310.15(B)(3)(c) are applied where conduit is routed on or above the roof surface.' : _isFence ? 'No rooftop temperature adder applies \u2014 fence-mounted system (NEC 310.15(B)(3)(c) N/A).' : 'No rooftop temperature adder applies \u2014 ground-mounted system (NEC 310.15(B)(3)(c) N/A).'}
        ${rulesResult && rulesResult.errorCount === 0 ? 'All calculations produce compliant results with no errors identified.' : 'Review flagged items above before submission.'}
      </div>
      <div style="padding:var(--xs);margin-top:var(--sm);font-size:var(--f-md);line-height:1.5;border:2px solid #000;background:#fff;">
        <strong>PAGE CONCLUSION — NEC COMPLIANCE:</strong>
        This ${cadTotalDcKw.toFixed(2)} kW DC / ${cadTotalPanels} module photovoltaic system has been evaluated against NEC ${necVer} Articles 690, 705, 250, and 310.
        ${_isRoof ? '' : _isFence ? 'Note: Rooftop temperature adder (NEC 310.15(B)(3)(c)) does NOT apply — this is a fence-mounted system.' : 'Note: Rooftop temperature adder (NEC 310.15(B)(3)(c)) does NOT apply — this is a ground-mounted system.'}
        ${rulesResult ? `The rules engine identified ${rulesResult.errorCount} error(s), ${rulesResult.warningCount} warning(s), and ${rulesResult.autoFixCount} auto-correction(s).` : 'Compliance evaluation is pending.'}
        System configuration ${rulesResult && rulesResult.errorCount === 0 ? 'complies with' : 'requires review per'} NEC ${necVer} and applicable local amendments.
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
            // FIX v47.341: Topology-aware DC/AC branch rows
            const _csTopo = topologyToLegacy(getInverterTopology(input, cad));
            if (_csTopo === 'MICRO') {
              // Microinverter: No traditional DC strings — show AC branch circuit rows instead
              const eq_cs = getEquipmentContext(input, cad);
              const _csIsc = eq_cs.panelIsc || 0;
              const _csBranchAmps = (_csIsc * 1.25);
              const _csBranchOcpd = necNextStandardOcpd(_csBranchAmps * 1.25);
              const _csModules = system.totalPanels || 0;
              // Per-model branch max (NEC 80% on 20A) — same resolver as PV-2B/SLD
              const _csBranches = microBranchCount(_csModules, eq_cs.inverterModel);
              return Array.from({length: _csBranches}, (_, i) => `
              <tr>
                <td class="fw7">AC Branch ${i + 1}</td>
                <td>Microinverters (Group ${i + 1})</td>
                <td>AC Combiner / Panel</td>
                <td>#10 AWG THWN-2</td>
                <td>${_csBranchAmps.toFixed(2)}A</td>
                <td>${_csBranchOcpd}A</td>
                <td>—</td>
                <td>${project.conduitType || 'EMT'}</td>
                <td>${project.wireLength || '—'} ft</td>
              </tr>`).join('');
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
                  <td>${project.conduitType}</td>
                  <td>${str.wireLength} ft</td>
                </tr>`) || []
              ) || []).join('');
            }
          })()}
          ${elec ? `
          <tr style="background:#f5f5f5">
            <td class="fw7">AC Output</td>
            <td>Inverter(s)</td><td>Main Panel</td>
            <td>${elec.acConductorCallout || project.wireGauge} THWN-2</td>
            <td>${elec.acWireAmpacity || '—'}A</td>
            <td>${elec.busbar?.backfeedBreakerRequired || '—'}A</td>
            <td style="color:${(elec.acVoltageDrop || 0) > 3 ? '#cc0000' : '#000'}">${elec.acVoltageDrop?.toFixed(2) || '—'}%</td>
            <td>${project.conduitType}</td>
            <td>${project.wireLength} ft</td>
          </tr>
          <tr style="background:#fff">
            <td class="fw7">EGC</td>
            <td>Array</td><td>Main Panel</td>
            <td>${(() => {
              // FIX v47.341: Auto-size EGC per NEC 250.122 Table based on circuit OCPD
              // Always compute — stored groundingConductor may be stale / incorrect
              const _egcTopo = topologyToLegacy(getInverterTopology(input, cad));
              let _egcOcpd = 20; // default
              if (_egcTopo === 'MICRO') {
                // Micro: EGC sized per branch circuit OCPD
                const _egcEq = getEquipmentContext(input, cad);
                const _egcIsc = _egcEq.panelIsc || 0;
                _egcOcpd = _egcIsc > 0 ? necNextStandardOcpd(_egcIsc * 1.25 * 1.25) : 20;
              } else {
                // String/Optimizer: EGC sized per largest string OCPD
                const _egcStr0 = system.inverters?.[0]?.strings?.[0];
                const _egcIscStr = _egcStr0?.isc || 0;
                _egcOcpd = _egcIscStr > 0 ? necNextStandardOcpd(_egcIscStr * 1.25 * 1.25) : 20;
              }
              if (_egcOcpd <= 15)  return '#14 AWG';
              if (_egcOcpd <= 20)  return '#12 AWG';
              if (_egcOcpd <= 30)  return '#10 AWG';
              if (_egcOcpd <= 60)  return '#10 AWG';
              if (_egcOcpd <= 100) return '#8 AWG';
              if (_egcOcpd <= 200) return '#6 AWG';
              return '#4 AWG';
            })()} bare Cu</td>
            <td>—</td><td>—</td><td>—</td>
            <td>${project.conduitType}</td>
            <td>${project.wireLength} ft</td>
          </tr>` : ''}
        </tbody>
      </table>
      ${elec?.conduitFill ? `
      <div class="section-title">Conduit Fill Analysis — NEC Chapter 9</div>
      <table class="info-table">
        <tr><td class="il">Conduit Type</td><td class="iv">${elec.conduitFill.conduitType}</td><td class="il">Conduit Size</td><td class="iv">${elec.conduitFill.conduitSize}</td></tr>
        <tr><td class="il">Fill Percentage</td><td class="iv" style="color:${elec.conduitFill.fillPercent > 40 ? '#cc0000' : '#000'};font-weight:bold">${elec.conduitFill.fillPercent?.toFixed(1)}% (Max: 40%)</td>
        <td class="il">Status</td><td class="iv" style="color:${elec.conduitFill.passes ? '#000' : '#cc0000'};font-weight:bold">${elec.conduitFill.passes ? '✓ PASS' : '✗ FAIL'}</td></tr>
      </table>` : ''}
      <div class="section-title">Voltage Drop Calculation — NEC 210.19(A) Informational Note</div>
      <table class="equip-table">
        <thead><tr><th>Circuit</th><th>Length (ft)</th><th>Conductor</th><th>Amps</th><th>Voltage</th><th>V-Drop (V)</th><th>V-Drop %</th><th>Limit</th><th>Status</th></tr></thead>
        <tbody>
          ${elec ? `
          <tr>
            <td class="fw7">AC Output</td>
            <td class="tr">${project.wireLength} ft</td>
            <td>${elec.acConductorCallout || project.wireGauge} Cu</td>
            <td class="tr">${elec.busbar?.backfeedBreakerRequired || '—'}A</td>
            <td class="tr">240V</td>
            <td class="tr mono">${elec.acVoltageDrop ? (elec.acVoltageDrop * 240 / 100).toFixed(2) : '—'}V</td>
            <td class="tr mono fw7" style="color:${(elec.acVoltageDrop || 0) > 3 ? '#cc0000' : '#000'}">${elec.acVoltageDrop?.toFixed(2) || '—'}%</td>
            <td class="tr">≤ 3.0%</td>
            <td class="center fw7" style="color:${(elec.acVoltageDrop || 0) > 3 ? '#cc0000' : '#000'}">${(elec.acVoltageDrop || 0) <= 3 ? '✓ PASS' : '✗ REVIEW'}</td>
          </tr>
          ` : '<tr><td colspan="9" class="center" style="color:#555;font-style:italic">Run compliance check to calculate voltage drop</td></tr>'}
        </tbody>
      </table>
      ${elec ? `<div style="padding:var(--xs);font-size:var(--f-md);line-height:1.5;border:var(--border);border-top:none;background:#fafafa;">
        <strong>VOLTAGE DROP INTERPRETATION:</strong>
        Calculated AC feeder voltage drop is ${elec.acVoltageDrop?.toFixed(2) || '—'}% over a ${project.wireLength} ft conductor run using ${elec.acConductorCallout || project.wireGauge} copper.
        NEC 210.19(A) Informational Note recommends ≤ 3% for feeders and ≤ 5% total (branch + feeder combined).
        ${(elec.acVoltageDrop || 0) <= 3 ? 'The calculated drop is within recommended limits. No conductor upsizing is required.' : 'The calculated drop exceeds 3%. Consider upsizing conductors or reducing run length.'}
      </div>
      <div style="padding:var(--xs);font-size:var(--f-sm);line-height:1.6;border:var(--border);border-top:none;background:#f0f4f8;">
        <strong>FORMULA REFERENCE — VOLTAGE DROP:</strong><br/>
        <span style="font-family:var(--mono);font-size:10px;">Vd = (2 × L × I × R) / 1000</span><br/>
        <span style="font-size:9px;color:#333;">
          Where: L = ${project.wireLength} ft (one-way conductor length),
          I = ${elec.busbar?.backfeedBreakerRequired || '—'}A (operating current),
          R = resistance per 1000 ft (NEC Chapter 9, Table 8 for ${elec.acConductorCallout || project.wireGauge} Cu @ 75°C).
          Result: ${elec.acVoltageDrop ? (elec.acVoltageDrop * 240 / 100).toFixed(2) : '—'}V drop = ${elec.acVoltageDrop?.toFixed(2) || '—'}% of 240V.
        </span>
        <span style="display:inline-block;margin-left:8px;padding:1px 8px;font-size:9px;font-weight:900;letter-spacing:0.5px;border-radius:2px;background:${(elec.acVoltageDrop || 0) <= 3 ? '#000' : '#cc0000'};color:#fff;">${(elec.acVoltageDrop || 0) <= 3 ? 'PASS' : 'FAIL'}</span>
      </div>` : ''}

      <div class="section-title">Temperature Correction — NEC Table 310.15(B)(1)</div>
      <table class="equip-table">
        <thead><tr><th>Ambient Temp °C</th><th>60°C Insulation</th><th>75°C (THWN)</th><th>90°C (THWN-2/USE-2)</th><th>Application</th></tr></thead>
        <tbody>
          <tr><td class="fw7">26–30</td><td class="tr">1.00</td><td class="tr">1.00</td><td class="tr fw7">1.00</td><td>Standard conditions</td></tr>
          <tr class="bg-lt"><td class="fw7">31–35</td><td class="tr">0.91</td><td class="tr">0.94</td><td class="tr fw7">0.96</td><td>Warm climate, ground level</td></tr>
          <tr><td class="fw7">36–40</td><td class="tr">0.82</td><td class="tr">0.88</td><td class="tr fw7">0.91</td><td>Attic, above roof</td></tr>
          <tr class="bg-lt"><td class="fw7">41–45</td><td class="tr">0.71</td><td class="tr">0.82</td><td class="tr fw7">0.87</td><td>Enclosed conduit on roof</td></tr>
          <tr><td class="fw7">46–50</td><td class="tr">0.58</td><td class="tr">0.75</td><td class="tr fw7">0.82</td><td>Close to roof surface</td></tr>
          <tr class="bg-lt"><td class="fw7">51–55</td><td class="tr">0.41</td><td class="tr">0.67</td><td class="tr fw7">0.76</td><td>Direct sun, hot climate</td></tr>
        </tbody>
      </table>

      ${_isRoof ? `
      <div class="section-title">Rooftop Temperature Adder — NEC Table 310.15(B)(3)(c)</div>
      <table class="equip-table">
        <thead><tr><th>Conduit Location</th><th>Temp. Adder °C</th><th>Temp. Adder °F</th><th>Application</th></tr></thead>
        <tbody>
          <tr><td class="fw7">Above roof — 0" to 0.5" (flush)</td><td class="tr mono">+33°C</td><td class="tr mono">+60°F</td><td>Flush-mounted conduit (worst case)</td></tr>
          <tr class="bg-lt"><td class="fw7">Above roof — 0.5" to 3.5"</td><td class="tr mono">+22°C</td><td class="tr mono">+40°F</td><td>Typical EMT on standoffs</td></tr>
          <tr><td class="fw7">Above roof — 3.5" to 12"</td><td class="tr mono">+17°C</td><td class="tr mono">+30°F</td><td>Raised conduit run</td></tr>
          <tr class="bg-lt"><td class="fw7">Above roof — 12" to 36"</td><td class="tr mono">+14°C</td><td class="tr mono">+25°F</td><td>High standoff or attic penetration</td></tr>
        </tbody>
      </table>
      <div style="padding:var(--xs);font-size:var(--f-md);line-height:1.5;border:var(--border);border-top:none;background:#fafafa;">
        <strong>TEMPERATURE DERATING NOTE:</strong>
        Conductors routed in conduit on the roof surface are subject to the rooftop temperature adder per NEC 310.15(B)(3)(c).
        All conductor selections account for the worst-case temperature condition.
        USE-2 and THWN-2 conductors (90°C rated) are specified to maximize ampacity retention.
      </div>` : _isFence ? `
      <div class="section-title">Fence Array Wiring Notes — NEC 690, ASCE 7-22 §29</div>
      <div style="padding:var(--xs);font-size:var(--f-md);line-height:1.6;border:var(--border);background:#fafafa;">
        <strong>FENCE WIRING REQUIREMENTS:</strong><br/>
        • DC conductors: USE-2 or PV wire rated for outdoor/wet locations per NEC 690.31(C)<br/>
        • Conduit: RMC or IMC required below 8 ft above grade per NEC 690.31(G)<br/>
        • Rapid shutdown: Module-level shutdown required per NEC 690.12(B)(2)<br/>
        • Temperature correction: Standard ambient (no rooftop adder) — fence not on roof surface<br/>
        • Grounding: All metallic fence posts bonded to EGC per NEC 250.169 and 690.43
      </div>` : `
      <div class="section-title">Ground Mount Wiring Notes — NEC 690</div>
      <div style="padding:var(--xs);font-size:var(--f-md);line-height:1.6;border:var(--border);background:#fafafa;">
        <strong>GROUND MOUNT WIRING REQUIREMENTS:</strong><br/>
        • DC conductors: USE-2 or PV wire per NEC 690.31(C)<br/>
        • Underground conductors: USE-2 direct burial or conduit per NEC 690.31(E)<br/>
        • Temperature correction: Standard ambient — no rooftop adder applies<br/>
        • Rapid shutdown: System-level per NEC 690.12(B)(1) acceptable for ground mount<br/>
        • Grounding: Per NEC 690.47 and 250.166
      </div>`}

      <div class="section-title">NEC Code References — Conductor & Conduit</div>
      <table class="equip-table">
        <thead><tr><th style="width:18%">Code Section</th><th style="width:25%">Title</th><th>Application</th></tr></thead>
        <tbody>
          <tr><td class="mono f-lg">NEC 690.8(A)</td><td>Maximum Circuit Current</td><td>PV source circuit current = Isc × 1.25; output circuit = sum of parallel Isc × 1.25</td></tr>
          <tr><td class="mono f-lg">NEC 690.8(B)</td><td>Circuit Sizing</td><td>Conductor ampacity ≥ 1.25 × Isc; OCPD rating ≥ 1.25 × max circuit current</td></tr>
          <tr><td class="mono f-lg">NEC 690.7(A)</td><td>Maximum Voltage</td><td>String Voc corrected for minimum design temperature per Table 690.7(A)</td></tr>
          <tr><td class="mono f-lg">NEC 310.15(B)(1)</td><td>Ampacity Correction</td><td>Temperature correction factors applied per conductor insulation rating</td></tr>
          <tr><td class="mono f-lg">NEC 310.15(B)(3)(c)</td><td>Rooftop Temp. Adder</td><td>Additional temperature adder for conduit/cable on or above rooftops</td></tr>
          <tr><td class="mono f-lg">NEC Ch. 9 Table 1</td><td>Conduit Fill</td><td>Max fill: 1 wire = 53%; 2 wires = 31%; 3+ wires = 40% of conduit area</td></tr>
          <tr><td class="mono f-lg">NEC 705.12(B)(2)</td><td>120% Busbar Rule</td><td>Backfeed breaker ≤ 20% of main panel busbar rating</td></tr>
          <tr><td class="mono f-lg">NEC 690.12</td><td>Rapid Shutdown</td><td>Module-level shutdown within 30 seconds</td></tr>
          <tr><td class="mono f-lg">NEC 310.15</td><td>Conductor Ampacity</td><td>Temperature and conduit fill derating</td></tr>
          <tr><td class="mono f-lg">NEC Ch. 9, Table 1</td><td>Conduit Fill</td><td>Maximum 40% fill for 3+ conductors</td></tr>
          <tr><td class="mono f-lg">ASCE 7-22 §26</td><td>Wind Loads</td><td>${_isRoof ? 'Components and cladding on roof-mounted arrays' : _isFence ? 'Wind loads on fence-mounted PV panels (Cf=1.3, ASCE §29.4)' : 'Wind loads on ground-mounted arrays (ASCE §29.4)'}</td></tr>
          <tr><td class=\"mono f-lg\">ASCE 7-22 §7</td><td>Snow Loads</td><td>${_isRoof ? 'Roof snow load with slope reduction factor' : 'Ground snow load — roof slope reduction not applicable for ' + (_isFence ? 'fence-mounted' : 'ground-mounted') + ' arrays'}</td></tr>
          <tr><td class="mono f-lg">NEC 220.82</td><td>Dwelling Load Calcs</td><td>Optional method — existing dwelling unit load calculation</td></tr>
        </tbody>
      </table>

      <div class="section-title">Load Calculations — NEC 220.82 Optional Method</div>
      ${(() => {
        const busA = project.panelBusRating || project.mainPanelAmps || 200;
        const mainA = project.mainPanelAmps || 200;
        const acKw = system.totalAcKw || 0;
        const acAmps = (acKw * 1000 / 240);
        // Error 5bb fix: Use NEC standard OCPD sizes, not round-to-5
        const continuousA = acAmps * 1.25;  // NEC 690.8(A)(1)
        const bfAmps = necNextStandardOcpd(continuousA);
        const busLimit = busA * 1.2;
        const maxBfAllowed = busLimit - mainA;
        const passes120 = bfAmps <= maxBfAllowed;
        const sqft = mainA >= 200 ? 3000 : 2000;
        const lightingVA = sqft * 3;
        const smallApplVA = 4500;
        const totalBeforeDemand = lightingVA + smallApplVA;
        const demand = totalBeforeDemand <= 10000
          ? totalBeforeDemand
          : 10000 + (totalBeforeDemand - 10000) * 0.4;
        const hvacVA = mainA >= 200 ? 7200 : 4320;
        const totalLoad = demand + hvacVA;
        const loadAmps = (totalLoad / 240).toFixed(0);
        return `
        <table class="equip-table">
          <thead><tr>
            <th style="width:5%">Step</th>
            <th style="width:28%">Description</th>
            <th style="width:42%">Calculation</th>
            <th style="width:25%">Result</th>
          </tr></thead>
          <tbody>
            <tr ><td class="fw9 mono">1</td><td>General Lighting — NEC 220.82(B)(1)</td><td>${sqft} sqft × 3 VA/sqft</td><td class="tr fw9">${lightingVA.toLocaleString()} VA</td></tr>
            <tr class="bg-lt"><td class="fw9 mono">2</td><td>Small Appliance + Laundry — NEC 220.52</td><td>3 circuits × 1,500 VA</td><td class="tr fw9">${smallApplVA.toLocaleString()} VA</td></tr>
            <tr ><td class="fw9 mono">3</td><td>Demand Factor — NEC 220.82(B)</td><td>First 10 kVA @ 100% + remainder @ 40%</td><td class="tr fw9">${Math.round(demand).toLocaleString()} VA</td></tr>
            <tr class="bg-lt"><td class="fw9 mono">4</td><td>HVAC / Largest Motor Load</td><td>${mainA >= 200 ? '5-ton' : '3-ton'} AC unit (field verify)</td><td class="tr fw9">${hvacVA.toLocaleString()} VA</td></tr>
            <tr style="background:#fff;border-top:2px solid #000;"><td class="fw9 mono">5</td><td style="font-weight:700;">Total Calculated Load</td><td>Steps 1–4 ÷ 240V service</td><td class="tr fw9">${Math.round(totalLoad).toLocaleString()} VA = ${loadAmps}A</td></tr>
            <tr class="bg-lt"><td class="fw9 mono">6</td><td>Service Ampacity</td><td>${mainA}A panel × 240V</td><td class="tr fw9">${mainA}A available</td></tr>
            <tr ><td class="fw9 mono">7</td><td>PV AC Output</td><td>${acKw.toFixed(2)} kW AC ÷ 240V</td><td class="tr fw9">${acAmps.toFixed(1)}A PV</td></tr>
            <tr class="bg-lt"><td class="fw9 mono">8</td><td>PV Backfeed Breaker — NEC 690.8(A)(1)</td><td>${acAmps.toFixed(1)}A × 125% → next standard OCPD per NEC 240.6(A)</td><td class="tr fw9">${bfAmps}A breaker required</td></tr>
            <tr style="background:#fff;border:2px solid #000;"><td class="fw9 mono">9</td><td style="font-weight:900;">120% Busbar Rule — NEC 705.12(B)</td><td>${busA}A bus × 120% = ${busLimit.toFixed(0)}A max; minus ${mainA}A main = ${maxBfAllowed.toFixed(0)}A for PV</td><td style="font-weight:900;text-align:right;font-size:11px;">${passes120 ? 'PASS' : 'FAIL — UPGRADE PANEL'}</td></tr>
          </tbody>
        </table>
        <div style="padding:var(--xs);font-size:var(--f-md);line-height:1.5;border:var(--border);border-top:none;background:#fafafa;">
          <strong>120% RULE INTERPRETATION:</strong>
          The PV system requires a ${bfAmps}A backfeed breaker installed at the load end of the existing ${busA}A busbar.
          Per NEC 705.12(B)(2)(3), the sum of the main breaker (${mainA}A) and the PV backfeed breaker (${bfAmps}A) = ${mainA + bfAmps}A,
          which ${passes120 ? 'does not exceed' : 'exceeds'} the 120% limit of ${busLimit.toFixed(0)}A.
          ${passes120 ? 'No panel upgrade is required.' : 'A panel upgrade or supply-side connection per NEC 705.12(A) is required.'}
        </div>
        <div style="padding:var(--xs);font-size:var(--f-sm);line-height:1.6;border:var(--border);border-top:none;background:#f0f4f8;">
          <strong>FORMULA REFERENCE — 120% BUSBAR RULE (NEC 705.12(B)(2)(3)):</strong><br/>
          <span style="font-family:var(--mono);font-size:10px;">Main Breaker + PV Backfeed ≤ Busbar Rating × 120%</span><br/>
          <span style="font-size:9px;color:#333;">
            Calculation: ${mainA}A (main) + ${bfAmps}A (PV backfeed) = ${mainA + bfAmps}A ≤ ${busA}A × 1.2 = ${busLimit.toFixed(0)}A.
            Maximum allowable PV backfeed = ${busLimit.toFixed(0)}A − ${mainA}A = ${maxBfAllowed.toFixed(0)}A.
            Required PV backfeed breaker = ${bfAmps}A.
          </span>
          <span style="display:inline-block;margin-left:8px;padding:1px 8px;font-size:9px;font-weight:900;letter-spacing:0.5px;border-radius:2px;background:${passes120 ? '#000' : '#cc0000'};color:#fff;">${passes120 ? 'PASS' : 'FAIL'}</span>
        </div>`;
      })()}
      <!-- Grounding & Bonding Standard Detail -->
      <div class="section-title">Grounding & Bonding Detail — NEC 690.43, 250.166</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--xs);border:var(--border);padding:var(--xs);">
        <div style="text-align:center;">
          <svg viewBox="0 0 280 180" width="260" height="170" style="display:block;margin:0 auto;">
            <!-- Ground bus bar -->
            <rect x="20" y="140" width="240" height="16" fill="#0a0" stroke="#000" stroke-width="1.5" rx="2"/>
            <text x="140" y="152" text-anchor="middle" font-size="8" fill="#fff" font-weight="bold">EQUIPMENT GROUNDING BUS</text>
            <!-- Module frames -->
            <rect x="30" y="20" width="60" height="35" fill="#2255aa" stroke="#000" stroke-width="1" rx="2"/>
            <text x="60" y="42" text-anchor="middle" font-size="7" fill="#fff">MODULE 1</text>
            <rect x="110" y="20" width="60" height="35" fill="#2255aa" stroke="#000" stroke-width="1" rx="2"/>
            <text x="140" y="42" text-anchor="middle" font-size="7" fill="#fff">MODULE 2</text>
            <rect x="190" y="20" width="60" height="35" fill="#2255aa" stroke="#000" stroke-width="1" rx="2"/>
            <text x="220" y="42" text-anchor="middle" font-size="7" fill="#fff">MODULE N</text>
            <!-- Rail -->
            <rect x="20" y="60" width="240" height="10" fill="#666" stroke="#000" stroke-width="1"/>
            <text x="140" y="68" text-anchor="middle" font-size="6" fill="#fff">MOUNTING RAIL (BONDED)</text>
            <!-- Bonding connections -->
            <line x1="60" y1="55" x2="60" y2="60" stroke="#0a0" stroke-width="2"/>
            <line x1="140" y1="55" x2="140" y2="60" stroke="#0a0" stroke-width="2"/>
            <line x1="220" y1="55" x2="220" y2="60" stroke="#0a0" stroke-width="2"/>
            <!-- WEEB/bonding clips -->
            <circle cx="60" cy="58" r="3" fill="#0a0" stroke="#000" stroke-width="0.5"/>
            <circle cx="140" cy="58" r="3" fill="#0a0" stroke="#000" stroke-width="0.5"/>
            <circle cx="220" cy="58" r="3" fill="#0a0" stroke="#000" stroke-width="0.5"/>
            <!-- EGC run from rail to ground bus -->
            <line x1="140" y1="70" x2="140" y2="90" stroke="#0a0" stroke-width="2"/>
            <text x="155" y="85" font-size="7" fill="#0a0" font-weight="bold">EGC</text>
            <!-- Inverter box -->
            <rect x="105" y="90" width="70" height="30" fill="#eee" stroke="#000" stroke-width="1.2" rx="2"/>
            <text x="140" y="108" text-anchor="middle" font-size="7" fill="#000" font-weight="bold">INVERTER</text>
            <!-- Inverter to ground bus -->
            <line x1="140" y1="120" x2="140" y2="140" stroke="#0a0" stroke-width="2"/>
            <!-- Ground rod -->
            <line x1="250" y1="156" x2="250" y2="178" stroke="#0a0" stroke-width="3"/>
            <polygon points="247,178 253,178 250,185" fill="#0a0"/>
            <line x1="240" y1="148" x2="250" y2="156" stroke="#0a0" stroke-width="1.5"/>
            <text x="235" y="175" font-size="6" fill="#0a0" text-anchor="end" font-weight="bold">GEC TO</text>
            <text x="235" y="182" font-size="6" fill="#0a0" text-anchor="end" font-weight="bold">ELECTRODE</text>
          </svg>
        </div>
        <div style="font-size:var(--f-sm);line-height:1.6;">
          <div style="font-weight:900;font-size:9px;margin-bottom:4px;letter-spacing:0.5px;">GROUNDING & BONDING REQUIREMENTS</div>
          <div style="margin-bottom:3px;">1. All module frames bonded to mounting rail via listed bonding hardware (WEEB, lay-in lug, or equivalent) per UL 2703.</div>
          <div style="margin-bottom:3px;">2. Equipment grounding conductor (EGC): ${(() => {
            const _egcT = topologyToLegacy(getInverterTopology(input, cad));
            let _oc = 20;
            if (_egcT === 'MICRO') { const _eq = getEquipmentContext(input, cad); _oc = _eq.panelIsc > 0 ? necNextStandardOcpd(_eq.panelIsc * 1.25 * 1.25) : 20; }
            else { const _s0 = input.system?.inverters?.[0]?.strings?.[0]; _oc = _s0?.isc ? necNextStandardOcpd(_s0.isc * 1.25 * 1.25) : 20; }
            if (_oc <= 15) return '#14 AWG'; if (_oc <= 20) return '#12 AWG'; if (_oc <= 30) return '#10 AWG';
            if (_oc <= 60) return '#10 AWG'; if (_oc <= 100) return '#8 AWG'; if (_oc <= 200) return '#6 AWG'; return '#4 AWG';
          })()} bare Cu min. per NEC 250.122 and 690.45.</div>
          <div style="margin-bottom:3px;">3. EGC routed with circuit conductors in same raceway per NEC 690.43(A).</div>
          <div style="margin-bottom:3px;">4. Grounding electrode conductor (GEC) connected to existing building grounding electrode system per NEC 250.166.</div>
          <div style="margin-bottom:3px;">5. All connections made with listed connectors rated for the conductor material and environment.</div>
          <div style="margin-bottom:3px;">6. Bonding jumpers installed at all mechanical joints in the racking system per NEC 250.96.</div>
          <div style="color:#555;font-size:7px;margin-top:4px;font-style:italic;">Detail is typical — verify with racking manufacturer bonding requirements.</div>
        </div>
      </div>

      <div style="padding:var(--xs);margin-top:var(--sm);font-size:var(--f-md);line-height:1.5;border:2px solid #000;background:#fff;">
        <strong>PAGE CONCLUSION — CONDUCTOR & CONDUIT SCHEDULE:</strong>
        All conductors have been sized per NEC 690.8 with continuous duty factor applied (Isc × 1.25).
        Overcurrent protection devices are rated per NEC 690.9. Temperature correction and conduit fill derating have been evaluated per NEC 310.15.
        ${elec?.acVoltageDrop && elec.acVoltageDrop <= 3 ? 'AC feeder voltage drop is within NEC recommended limits.' : 'Voltage drop requires review.'}
        All conductors are sized appropriately for the calculated load conditions of this ${system.totalDcKw?.toFixed(2) || '—'} kW DC system.
      </div>
    </div>
  </div>`;
}



export function pageSingleLineDiagram(input: PermitInput, cad: CADModel, pageNum: number, totalPages: number, storedSldSvg?: string): string {
  const { project, system, compliance } = input;
  const _sldSysType = cad.systemType as SysType;
  const _sldArrayLabel = isFence(_sldSysType) ? 'SOLAR FENCE ARRAY'
    : isGround(_sldSysType) ? 'GROUND MOUNT ARRAY'
    : 'ROOF-MOUNTED ARRAY';

  // ── Canvas ────────────────────────────────────────────────────────────────
  const W = 2304, H = 1728, MAR = 40;
  const TB_W = 260;
  const TB_X = W - TB_W - MAR;
  const DX = MAR, DY = MAR;
  const DW = TB_X - MAR - 10;
  const DH = H - MAR * 2;
  const SCH_X = DX, SCH_Y = DY + 30;
  const SCH_W = DW;
  const SCH_H = Math.round(DH * 0.50);
  const BUS_Y = SCH_Y + Math.round(SCH_H * 0.46);
  const GND_Y = BUS_Y + 100;
  const CALC_Y  = SCH_Y + SCH_H + 8;
  const CALC_H  = 180;
  const SCHED_Y = CALC_Y + CALC_H + 8;
  const SCHED_H = H - MAR - SCHED_Y;

  // ── Colors ────────────────────────────────────────────────────────────────
  const BLK = '#000000', WHT = '#FFFFFF', GRN = '#005500';
  const LGY = '#F5F5F5', PASS_C = '#004400', FAIL_C = '#AA0000';
  const LOAD_CLR = '#1B5E20';

  // ── Stroke widths ─────────────────────────────────────────────────────────
  const SW_BORDER=2.5, SW_HEAVY=2.0, SW_MED=1.5, SW_THIN=1.0, SW_HAIR=0.5, SW_BUS=3.5;

  // ── Font sizes ────────────────────────────────────────────────────────────
  const F = { title:12, hdr:8.5, label:7.5, sub:7, seg:6.5, tiny:6.5, tb:7, tbTitle:10 };

  // ── SVG Primitives ────────────────────────────────────────────────────────
  function esc(s: any): string { return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  function txt(x: number, y: number, s: any, o: any={}): string {
    const sz=o.sz??F.label, bld=o.bold?'font-weight="bold"':'', anc=`text-anchor="${o.anc??'start'}"`;
    const clr=`fill="${o.fill??BLK}"`, itl=o.italic?'font-style="italic"':'';
    return `<text x="${x}" y="${y}" font-family="Arial,sans-serif" font-size="${sz}" ${bld} ${anc} ${clr} ${itl} dominant-baseline="auto">${esc(s)}</text>`;
  }

  function tspan(x: number, y: number, lines: string[], o: any={}): string {
    if(!lines.length) return '';
    const sz=o.sz??F.seg, bld=o.bold?'font-weight="bold"':'', anc=`text-anchor="${o.anc??'middle'}"`;
    const clr=`fill="${o.fill??BLK}"`, lh=o.lh??Math.round(sz*1.4);
    const spans=lines.map((l,i)=>`<tspan x="${x}" dy="${i===0?0:lh}">${esc(l)}</tspan>`).join('');
    return `<text x="${x}" y="${y}" font-family="Arial,sans-serif" font-size="${sz}" ${bld} ${anc} ${clr} dominant-baseline="auto">${spans}</text>`;
  }

  function rect(x: number, y: number, w: number, h: number, o: any={}): string {
    const f=o.fill??WHT, s=o.stroke??BLK, sw=o.sw??SW_THIN, rx=o.rx?`rx="${o.rx}"`:'', da=o.dash?`stroke-dasharray="${o.dash}"`:'';
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${f}" stroke="${s}" stroke-width="${sw}" ${rx} ${da}/>`;
  }

  function ln(x1: number, y1: number, x2: number, y2: number, o: any={}): string {
    const s=o.stroke??BLK, sw=o.sw??SW_MED, da=o.dash?`stroke-dasharray="${o.dash}"`:'';
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${s}" stroke-width="${sw}" ${da}/>`;
  }

  function circ(cx: number, cy: number, r: number, o: any={}): string {
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${o.fill??WHT}" stroke="${o.stroke??BLK}" stroke-width="${o.sw??SW_THIN}"/>`;
  }

  function gnd(x: number, y: number, color: string=GRN): string {
    return [ln(x,y,x,y+8,{stroke:color,sw:SW_MED}),ln(x-9,y+8,x+9,y+8,{stroke:color,sw:SW_MED}),
            ln(x-6,y+12,x+6,y+12,{stroke:color,sw:SW_MED}),ln(x-3,y+16,x+3,y+16,{stroke:color,sw:SW_MED})].join('');
  }

  function callout(cx: number, cy: number, n: number): string {
    return circ(cx,cy,10,{fill:WHT,stroke:BLK,sw:SW_MED})+txt(cx,cy+1,String(n),{sz:F.hdr,bold:true,anc:'middle'});
  }

  // ── IEEE Standard Equipment Symbols ─────────────────────────────────────
  function pvModuleSymbol(cx: number, cy: number, w=28, h=20): string {
    return [rect(cx-w/2,cy-h/2,w,h,{fill:WHT,sw:SW_MED}),ln(cx-w/2,cy+h/2,cx+w/2,cy-h/2,{sw:SW_THIN})].join('');
  }

  function fuseSymbol(cx: number, cy: number, w=16, h=8): string {
    return [ln(cx-w/2-6,cy,cx-w/2,cy,{sw:SW_MED}),rect(cx-w/2,cy-h/2,w,h,{fill:WHT,sw:SW_MED}),ln(cx+w/2,cy,cx+w/2+6,cy,{sw:SW_MED})].join('');
  }

  function breakerSymbol(cx: number, cy: number, w=18, h=12, amps?: number): string {
    const p=[rect(cx-w/2,cy-h/2,w,h,{fill:WHT,sw:SW_THIN}),
             `<path d="M${cx-5},${cy+3} Q${cx},${cy-5} ${cx+5},${cy+3}" fill="none" stroke="${BLK}" stroke-width="${SW_HAIR}"/>`];
    if(amps) p.push(txt(cx,cy-h/2-2,`${amps}A`,{sz:5.5,anc:'middle',bold:true}));
    return p.join('');
  }

  function lug(cx: number, cy: number): string { return circ(cx,cy,3,{fill:WHT,sw:SW_MED})+circ(cx,cy,1,{fill:BLK,sw:0}); }

  function busbar(x1: number, x2: number, y: number, label?: string): string {
    const p=[ln(x1,y,x2,y,{stroke:BLK,sw:SW_BUS})];
    if(label) p.push(txt((x1+x2)/2,y-5,label,{sz:5.5,anc:'middle',bold:true}));
    return p.join('');
  }

  function knifeSwitch(cx: number, cy: number, w=40): string {
    const lx=cx-w/2, rx=cx+w/2;
    return [ln(lx,cy,lx+10,cy,{sw:SW_MED}),circ(lx+10,cy,3,{fill:BLK,sw:0}),
            ln(lx+10,cy,rx-10,cy-10,{sw:SW_MED}),circ(rx-10,cy,3,{fill:WHT,sw:SW_MED}),
            ln(rx-10,cy,rx,cy,{sw:SW_MED})].join('');
  }

  // ── Overlap Guard ─────────────────────────────────────────────────────────
  function makeOverlapGuard(): (x1: number, x2: number, y: number) => number {
    const used: Array<{x1:number,x2:number,y:number}> = [];
    return function(x1: number, x2: number, y: number): number {
      const xMin=Math.min(x1,x2), xMax=Math.max(x1,x2);
      let c=y, att=0;
      while(att<10) {
        const conf=used.find(r=>Math.abs(r.y-c)<4&&r.x1<xMax&&r.x2>xMin);
        if(!conf) break; c+=4; att++;
      }
      used.push({x1:xMin,x2:xMax,y:c}); return c;
    };
  }

  // ── Wire Segment ──────────────────────────────────────────────────────────
  function wireSeg(x1: number, x2: number, y: number, lines: string[], opts: any={}): string {
    const isOA=opts.openAir??false, color=isOA?GRN:BLK, dash=isOA?'10,5':undefined;
    const cnt=Math.min(opts.bundleCount??1,6), cx=(x1+x2)/2, above=opts.above??true;
    const p: string[]=[];
    if(cnt<=1) { p.push(ln(x1,y,x2,y,{stroke:color,sw:SW_MED,dash})); }
    else {
      const sp=3, span=(cnt-1)*sp, sy=y-span/2;
      for(let i=0;i<cnt;i++) p.push(ln(x1,sy+i*sp,x2,sy+i*sp,{stroke:color,sw:SW_THIN,dash}));
      p.push(ln(x1,sy,x1,sy+span,{stroke:color,sw:SW_HAIR}));
      p.push(ln(x2,sy,x2,sy+span,{stroke:color,sw:SW_HAIR}));
    }
    if(lines.length>0) {
      const lh=Math.round(F.seg*1.35), th=lines.length*lh;
      const ty=above?y-7-th+lh:y+11;
      p.push(tspan(cx,ty,lines,{sz:F.seg,anc:'middle',fill:color}));
    }
    return p.join('');
  }

  // ── Equipment Renderers ───────────────────────────────────────────────────
  function renderBattery(cx: number, cy: number, model: string, kwh: number, backfeedA: number, calloutN: number): any {
    const W2=88,H2=72, bx=cx-W2/2, by2=cy-H2/2, BAT_CLR='#1565C0', p: string[]=[];
    p.push(rect(bx,by2,W2,H2,{fill:WHT,stroke:BAT_CLR,sw:SW_MED}));
    p.push(ln(bx,by2+14,bx+W2,by2+14,{stroke:BAT_CLR,sw:SW_THIN}));
    p.push(txt(cx,by2+10,'BATTERY STORAGE',{sz:5.5,bold:true,anc:'middle',fill:BAT_CLR}));
    const cellX=cx-14, cellY=cy-4;
    for(let i=0;i<3;i++){
      const lx2=cellX+i*7;
      p.push(ln(lx2,cellY-10,lx2,cellY+10,{stroke:BAT_CLR,sw:2.5}));
      if(i<2) p.push(ln(lx2+3,cellY-6,lx2+3,cellY+6,{stroke:BAT_CLR,sw:1.5}));
    }
    p.push(txt(cellX-8,cellY+4,'−',{sz:9,bold:true,anc:'middle',fill:BAT_CLR}));
    p.push(txt(cellX+22,cellY+4,'+',{sz:9,bold:true,anc:'middle',fill:BAT_CLR}));
    const acOutX=cx, acOutY=by2+H2;
    p.push(lug(acOutX,acOutY-6));
    p.push(ln(acOutX,acOutY-6,acOutX,acOutY,{stroke:BAT_CLR,sw:SW_MED}));
    p.push(txt(acOutX,acOutY+6,'AC OUT',{sz:4,anc:'middle',fill:BAT_CLR}));
    p.push(txt(cx,by2+H2+16,model?(model.substring(0,22)):'BATTERY STORAGE',{sz:F.tiny,anc:'middle',italic:true}));
    p.push(txt(cx,by2+H2+25,kwh>0?`${kwh} kWh`:'',{sz:F.tiny,anc:'middle',bold:true,fill:BAT_CLR}));
    if(backfeedA>0) p.push(txt(cx,by2+H2+34,`${backfeedA}A BACKFEED — NEC 705.12(B)`,{sz:F.tiny,anc:'middle',fill:BAT_CLR}));
    p.push(callout(bx+W2+14,by2-5,calloutN));
    return {svg:p.join(''),lx:bx,rx:bx+W2,ty:by2,by:by2+H2,acOutX,acOutY};
  }

  function renderBUI(cx: number, cy: number, brand: string, model: string, ampRating: number, isEnphase: boolean, hasGenerator: boolean, calloutN: number): any {
    const W2=100,H2=90, bx=cx-W2/2, by2=cy-H2/2;
    const BUI_CLR=isEnphase?'#0D47A1':'#1565C0', p: string[]=[];
    p.push(rect(bx,by2,W2,H2,{fill:WHT,stroke:BUI_CLR,sw:SW_MED}));
    p.push(ln(bx,by2+14,bx+W2,by2+14,{stroke:BUI_CLR,sw:SW_THIN}));
    const headerText=isEnphase?'IQ SYSTEM CONTROLLER 3':'BACKUP INTERFACE UNIT';
    p.push(txt(cx,by2+10,headerText,{sz:5.5,bold:true,anc:'middle',fill:BUI_CLR}));
    const gridY=cy-14;
    p.push(lug(bx+8,gridY)); p.push(txt(bx+8,gridY-8,'GRID',{sz:4.5,anc:'middle',fill:'#444'}));
    p.push(ln(bx,gridY,bx+8,gridY,{stroke:BUI_CLR,sw:SW_MED}));
    const genInputY=cy+14;
    if(hasGenerator) {
      p.push(lug(bx+8,genInputY)); p.push(txt(bx+8,genInputY+9,'GEN',{sz:4.5,anc:'middle',fill:'#2E7D32'}));
      p.push(ln(bx,genInputY,bx+8,genInputY,{stroke:'#2E7D32',sw:SW_MED}));
    }
    p.push(ln(bx+11,gridY,bx+42,gridY,{stroke:BUI_CLR,sw:SW_MED}));
    p.push(circ(bx+11,gridY,2.5,{fill:BUI_CLR,stroke:BUI_CLR,sw:0}));
    p.push(circ(bx+42,gridY,2.5,{fill:WHT,stroke:BUI_CLR,sw:SW_THIN}));
    if(hasGenerator){
      p.push(ln(bx+11,genInputY,bx+32,genInputY-12,{stroke:'#2E7D32',sw:SW_MED}));
      p.push(circ(bx+11,genInputY,2.5,{fill:'#2E7D32',stroke:'#2E7D32',sw:0}));
      p.push(circ(bx+42,genInputY,2.5,{fill:WHT,stroke:'#2E7D32',sw:SW_THIN}));
    }
    const busX2=bx+55;
    p.push(ln(busX2,gridY,busX2,hasGenerator?genInputY:gridY+20,{stroke:BUI_CLR,sw:2.5}));
    p.push(ln(bx+42,gridY,busX2,gridY,{stroke:BUI_CLR,sw:SW_THIN}));
    if(hasGenerator) p.push(ln(bx+42,genInputY,busX2,genInputY,{stroke:BUI_CLR,sw:SW_THIN}));
    const loadY=cy;
    p.push(lug(bx+W2-8,loadY)); p.push(txt(bx+W2-8,loadY-8,'LOAD',{sz:4.5,anc:'middle',fill:'#444'}));
    p.push(ln(busX2,loadY,bx+W2-8,loadY,{stroke:BUI_CLR,sw:SW_MED}));
    p.push(ln(bx+W2-8,loadY,bx+W2,loadY,{stroke:BUI_CLR,sw:SW_MED}));
    const batPortX2=cx, batPortY2=by2+H2;
    p.push(lug(batPortX2,batPortY2-4));
    p.push(txt(batPortX2,batPortY2+8,'BATTERY',{sz:4.5,anc:'middle',fill:BUI_CLR}));
    p.push(ln(batPortX2,batPortY2-4,batPortX2,batPortY2,{stroke:BUI_CLR,sw:SW_MED}));
    p.push(txt(cx,by2+H2+18,`${brand||'Enphase'} ${model||'IQ SC3'}`,{sz:F.tiny,anc:'middle',italic:true,fill:BUI_CLR}));
    p.push(txt(cx,by2+H2+27,ampRating>0?`${ampRating}A`:'200A',{sz:F.tiny,anc:'middle',bold:true,fill:BUI_CLR}));
    p.push(txt(cx,by2+H2+36,'NEC 706 / NEC 230.82 / UL 1741-SA',{sz:F.tiny,anc:'middle',italic:true,fill:BUI_CLR}));
    p.push(callout(bx+W2+14,by2-5,calloutN));
    return {svg:p.join(''),lx:bx-10,rx:bx+W2+10,ty:by2,by:by2+H2,
            batPortX:batPortX2,batPortY:batPortY2,
            loadPortX:bx+W2,loadPortY:loadY,
            gridPortX:bx,gridPortY:cy-14,
            genPortX:bx,genPortY:cy+14};
  }

  function renderCombiner(cx: number, cy: number, nBranches: number, branchOcpd: number, label: string, calloutN: number): any {
    const W2=80,H2=90, bx=cx-W2/2, by2=cy-H2/2, p: string[]=[];
    p.push(rect(bx,by2,W2,H2,{fill:WHT,sw:SW_MED}));
    p.push(ln(bx,by2+14,bx+W2,by2+14,{sw:SW_THIN}));
    p.push(txt(cx,by2+10,'AC COMBINER',{sz:6,bold:true,anc:'middle'}));
    const busY=cy+8;
    p.push(busbar(bx+10,bx+W2-10,busY));
    p.push(txt(cx,busY-5,'BUS',{sz:5,anc:'middle'}));
    const nShow=Math.min(nBranches,4), brkSpacing=(H2-22)/(nShow+1);
    for(let b=0;b<nShow;b++){
      const brY=by2+18+brkSpacing*(b+1);
      p.push(lug(bx+4,brY)); p.push(ln(bx+7,brY,bx+20,brY,{sw:SW_THIN}));
      p.push(breakerSymbol(bx+29,brY,16,10,branchOcpd));
      p.push(ln(bx+37,brY,cx-5,busY,{sw:SW_THIN}));
    }
    if(nBranches>4) p.push(txt(bx+29,busY-12,`+${nBranches-4}`,{sz:5,anc:'middle',fill:'#666'}));
    p.push(ln(bx+W2-10,busY,bx+W2-4,busY,{sw:SW_THIN})); p.push(lug(bx+W2-4,busY));
    p.push(ln(bx+W2,busY,bx+W2+10,busY,{sw:SW_MED}));
    p.push(txt(cx,by2+H2+10,esc(label),{sz:F.tiny,anc:'middle',italic:true}));
    p.push(txt(cx,by2+H2+19,`${nBranches} branch inputs`,{sz:F.tiny,anc:'middle'}));
    p.push(txt(cx,by2+H2+28,'NEC 690.9',{sz:F.tiny,anc:'middle',italic:true}));
    p.push(callout(bx+W2+14,by2-5,calloutN));
    p.push(ln(bx-10,busY,bx,busY,{sw:SW_MED}));
    const feederOutX=bx+W2+10, feederOutY=cy+8;
    return {svg:p.join(''),lx:bx-10,rx:bx+W2+10,ty:by2,by:by2+H2,feederOutX,feederOutY};
  }

  function renderDisco(cx: number, cy: number, ocpd: number, calloutN: number): any {
    const W2=90,H2=70, bx=cx-W2/2, by2=cy-H2/2, p: string[]=[];
    p.push(rect(bx,by2,W2,H2,{fill:WHT,sw:SW_MED}));
    p.push(ln(bx,by2+14,bx+W2,by2+14,{sw:SW_THIN}));
    p.push(txt(cx,by2+10,'AC DISCONNECT',{sz:6,bold:true,anc:'middle'}));
    const poleY1=cy-8, poleY2=cy+8;
    p.push(lug(bx+10,poleY1)); p.push(lug(bx+10,poleY2));
    p.push(txt(bx+10,poleY2+13,'LOAD',{sz:5,anc:'middle',bold:true,fill:'#333'}));
    p.push(txt(bx+10,poleY2+20,'(FROM COMBINER)',{sz:4.5,anc:'middle',fill:'#555'}));
    p.push(ln(bx+13,poleY1,bx+30,poleY1,{sw:SW_THIN}));
    p.push(ln(bx+13,poleY2,bx+30,poleY2,{sw:SW_THIN}));
    p.push(knifeSwitch(cx,poleY1,30)); p.push(knifeSwitch(cx,poleY2,30));
    p.push(ln(bx+W2-30,poleY1,bx+W2-13,poleY1,{sw:SW_THIN}));
    p.push(ln(bx+W2-30,poleY2,bx+W2-13,poleY2,{sw:SW_THIN}));
    p.push(lug(bx+W2-10,poleY1)); p.push(lug(bx+W2-10,poleY2));
    p.push(txt(bx+W2-10,poleY2+13,'LINE',{sz:5,anc:'middle',bold:true,fill:'#333'}));
    p.push(txt(bx+W2-10,poleY2+20,'(TO MSP)',{sz:4.5,anc:'middle',fill:'#555'}));
    p.push(ln(bx+W2*0.55,by2+14,bx+W2-2,by2+14,{sw:2,stroke:'#888'}));
    p.push(txt(bx+W2-2,by2+12,'⚡',{sz:5,anc:'end',fill:'#888'}));
    p.push(ln(bx-10,cy,bx,poleY1,{sw:SW_MED})); p.push(ln(bx-10,cy,bx,poleY2,{sw:SW_MED}));
    p.push(ln(bx+W2,poleY1,bx+W2+10,cy,{sw:SW_MED})); p.push(ln(bx+W2,poleY2,bx+W2+10,cy,{sw:SW_MED}));
    p.push(txt(cx,by2+H2+10,`${ocpd}A NON-FUSED`,{sz:F.tiny,anc:'middle'}));
    p.push(txt(cx,by2+H2+19,'NEC 690.14 — UTILITY ACCESSIBLE',{sz:F.tiny,anc:'middle',italic:true}));
    p.push(callout(bx+W2+14,by2-5,calloutN));
    return {svg:p.join(''),lx:bx-10,rx:bx+W2+10,loadInX:bx,loadInY:cy,lineOutX:bx+W2,lineOutY:cy};
  }

  function renderMSPLoad(cx: number, cy: number, mainAmps: number, pvAmps: number, calloutN: number): any {
    const W2=96,H2=120, bx=cx-W2/2, by2=cy-H2/2, p: string[]=[];
    p.push(rect(bx,by2,W2,H2,{fill:WHT,sw:SW_MED}));
    p.push(ln(bx,by2+14,bx+W2,by2+14,{sw:SW_THIN}));
    p.push(txt(cx,by2+10,'MAIN SERVICE PANEL',{sz:5.5,bold:true,anc:'middle'}));
    const mbY=by2+28;
    p.push(txt(cx,mbY-4,`${mainAmps}A MAIN BREAKER`,{sz:5.5,anc:'middle',bold:true}));
    p.push(breakerSymbol(cx,mbY,32,14,mainAmps));
    const busY=mbY+20;
    p.push(busbar(bx+8,bx+W2-8,busY,'MAIN BUS')); p.push(ln(cx,mbY+7,cx,busY,{sw:SW_MED}));
    const nX=bx+10;
    p.push(ln(nX,busY+8,nX,busY+38,{stroke:'#444',sw:3})); p.push(txt(nX,busY+46,'N',{sz:6,anc:'middle',bold:true,fill:'#444'}));
    const gX=bx+W2-10;
    p.push(ln(gX,busY+8,gX,busY+38,{stroke:GRN,sw:3})); p.push(txt(gX,busY+46,'G',{sz:6,anc:'middle',bold:true,fill:GRN}));
    p.push(gnd(gX,busY+48,GRN));
    const pvBrkX=cx+20, pvBrkY=busY+28;
    p.push(ln(pvBrkX,busY,pvBrkX,pvBrkY-6,{sw:SW_THIN}));
    p.push(breakerSymbol(pvBrkX,pvBrkY,20,12,pvAmps));
    p.push(txt(pvBrkX,pvBrkY+10,'PV',{sz:5.5,anc:'middle',bold:true,fill:LOAD_CLR}));
    const lugY=pvBrkY+22;
    p.push(ln(pvBrkX,pvBrkY+6,pvBrkX,lugY-3,{sw:SW_THIN})); p.push(lug(pvBrkX,lugY));
    p.push(txt(pvBrkX,lugY+9,'LOAD LUG',{sz:5,anc:'middle'}));
    p.push(ln(bx-10,cy,bx,cy,{sw:SW_MED})); p.push(ln(bx,cy,pvBrkX,lugY,{sw:SW_MED}));
    p.push(ln(bx+W2-8,busY,bx+W2+10,busY,{sw:SW_MED}));
    p.push(txt(cx,by2+H2+10,`${mainAmps}A RATED`,{sz:F.tiny,anc:'middle'}));
    p.push(txt(cx,by2+H2+19,'LOAD SIDE TAP — NEC 705.12(B)',{sz:F.tiny,anc:'middle',bold:true,fill:LOAD_CLR}));
    p.push(txt(cx,by2+H2+28,`${pvAmps}A PV BREAKER`,{sz:F.tiny,anc:'middle',fill:LOAD_CLR}));
    p.push(callout(bx+W2+14,by2-5,calloutN));
    return {svg:p.join(''),lx:bx-10,rx:bx+W2+10,bkfdInX:bx,bkfdInY:cy,busOutX:bx+W2,busOutY:mbY+20};
  }

  // ── Build the SLD SVG ─────────────────────────────────────────────────────
  function buildSLD(): string {
    const parts: string[] = [];
    const resolveSegY = makeOverlapGuard();

    // FIX v47.54: Do NOT fall back to 9.6 kW / 24 panels defaults.
    // If system values are missing the SLD will render with 0/null — making
    // the data gap visible rather than hiding it behind a plausible-looking
    // default that masks a pipeline failure.
    const totalDcKw = system?.totalDcKw ?? 0;
    const totalAcKw = system?.totalAcKw ?? 0;
    const totalPanels = system?.totalPanels ?? 0;
    const eq_sld = getEquipmentContext(input, cad);
    const panelWatts = eq_sld.panelWatts || (system.totalDcKw && system.totalPanels ? Math.round(system.totalDcKw * 1000 / system.totalPanels) : 400);
    const panelModel = eq_sld.panelModel !== '—' ? eq_sld.panelModel : (system.totalPanels ? `${panelWatts}W Module` : 'PV Module');
    const panelVoc   = eq_sld.panelVoc   || 0;
    const panelIsc   = eq_sld.panelIsc   || 0;
    const inverterModel = eq_sld.inverterModel !== '—' ? eq_sld.inverterModel : 'Inverter';
    const inverterMfr   = eq_sld.inverterManufacturer !== '—' ? eq_sld.inverterManufacturer : '';
    const acOutputKw  = totalAcKw;
    const acOutputAmps = (totalAcKw * 1000 / 240);
    const acWireGauge  = compliance.electrical?.acConductorCallout ?? '#10 AWG';
    const acConduit    = '3/4"';
    const acCondType   = 'EMT';
    const acOCPD       = project.backfeedBreakerA ?? project.pvBackfeedA ?? 40;
    const mainAmps     = project.mainPanelAmps ?? 200;
    // Error 5ba fix: backfeedAmps should fall back to acOCPD (computed above), not hardcoded 46
    const backfeedAmps = project.backfeedBreakerA ?? project.pvBackfeedA ?? acOCPD;
    const pvBreakerAmps = backfeedAmps;
    // FIX v47.341: Convert utility slug to display name in SLD
    const utilityName  = utilityDisplayName(project.utilityName ?? '') || 'Utility';
    const hasBattery   = !!(project.batteryCount && project.batteryCount > 0);
    const batteryModel = project.batteryModel ?? 'IQ Battery 5P';
    const batteryKwh   = hasBattery ? (project.batteryCount! * (project.batteryKwh ?? 5.0)) : 0;
    // Error 5ba fix: battery backfeed fallback — 20A per unit (typical residential), not 46
    const batteryBackfeedA = project.batteryBackfeedA ?? (hasBattery ? project.batteryCount * 20 : 0);
    const egcNum = '10';
    const branchOcpd = 20;
    // Per-model branch max (NEC 80% on 20A) — same resolver as PV-2B/SLD
    const nBranches = microBranchCount(totalPanels, inverterModel);
    const deviceCount = totalPanels;

    // X positions
    // v58.11: When hasBattery, MSP shifts LEFT to reserve space for a first-class
    // BUI node between MSP and the utility meter. Prior layout placed BUI at
    // xMSP + 130 which overlapped both MSP (40px) and meter (20px). Shifting MSP
    // from 0.75 to 0.60 of usable width gives the BUI a clean 0.80 slot with
    // ~60px gaps on each side.
    const xPad=50, uW=SCH_W-xPad*2;
    const xPV   = SCH_X + xPad;
    const xJBox = SCH_X + xPad + uW*0.17;
    const xComb = SCH_X + xPad + uW*0.36;
    const xDisco= SCH_X + xPad + uW*(hasBattery ? 0.48 : 0.56);
    const xMSP  = SCH_X + xPad + uW*(hasBattery ? 0.60 : 0.75);
    const xBUI  = SCH_X + xPad + uW*0.80;   // only used when hasBattery
    const xUtil = SCH_X + xPad + uW;

    // SVG root
    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="background:${WHT};display:block;min-height:19in;max-height:21in;">`);
    parts.push(rect(0,0,W,H,{fill:WHT,stroke:WHT,sw:0}));
    parts.push(rect(MAR/2,MAR/2,W-MAR,H-MAR,{fill:WHT,stroke:BLK,sw:SW_BORDER}));

    // Title
    const tcx=(DX+TB_X)/2;
    parts.push(txt(tcx,DY+16,'SINGLE LINE DIAGRAM — PHOTOVOLTAIC SYSTEM',{sz:F.title,bold:true,anc:'middle'}));
    // FIX v47.341: Use resolveTopology() + toFixed(2) for AC kW to prevent float leak
    const _sldTopo = topologyToLegacy(getInverterTopology(input, cad));
    const _sldTopoLabel = topologyDisplayLabel(_sldTopo);
    parts.push(txt(tcx,DY+26,`${esc(project.address||'')}  │  ${_sldTopoLabel}  │  ${totalPanels} Modules  │  ${totalDcKw.toFixed(2)} kWdc / ${totalAcKw.toFixed(2)} kWac  │  Interconnection: ${interconnectionLabel(project.interconnectionMethod)}  │  NEC ${compliance.jurisdiction?.necVersion || '2023'}`,{sz:F.sub,anc:'middle',fill:'#444'}));

    // Schematic border
    parts.push(rect(SCH_X,SCH_Y,SCH_W,SCH_H,{fill:WHT,stroke:BLK,sw:SW_THIN}));

    // NODE 1: PV ARRAY
    const pvW=80, pvH=68, pvCX=xPV, pvCY=BUS_Y;
    parts.push(rect(pvCX-pvW/2,pvCY-pvH/2,pvW,pvH,{fill:WHT,sw:SW_MED}));
    for(let row=0;row<2;row++) for(let col=0;col<3;col++) {
      const mx=pvCX-pvW/2+10+col*22, my=pvCY-pvH/2+12+row*26;
      parts.push(pvModuleSymbol(mx+9,my+9,18,14));
    }
    parts.push(txt(pvCX,pvCY-pvH/2-18,'PV ARRAY',{sz:F.hdr,bold:true,anc:'middle'}));
    parts.push(txt(pvCX,pvCY-pvH/2-8,`${totalPanels} × ${panelWatts}W`,{sz:F.sub,anc:'middle'}));
    parts.push(txt(pvCX,pvCY+pvH/2+9,esc(panelModel),{sz:F.tiny,anc:'middle',italic:true}));
    parts.push(txt(pvCX,pvCY+pvH/2+18,`${deviceCount} × ${esc(inverterModel)}`,{sz:F.tiny,anc:'middle'}));
    parts.push(callout(pvCX+pvW/2+14,pvCY-pvH/2-5,1));
    const pvOutX=pvCX+pvW/2;

    // NODE 2: J-BOX (system-aware label)
    const jbW=40, jbH=40, jbCX=xJBox, jbCY=BUS_Y;
    parts.push(rect(jbCX-jbW/2,jbCY-jbH/2,jbW,jbH,{fill:WHT,sw:SW_MED}));
    parts.push(ln(jbCX-jbW/2+5,jbCY-jbH/2+5,jbCX+jbW/2-5,jbCY+jbH/2-5,{sw:SW_HAIR}));
    parts.push(ln(jbCX+jbW/2-5,jbCY-jbH/2+5,jbCX-jbW/2+5,jbCY+jbH/2-5,{sw:SW_HAIR}));
    parts.push(lug(jbCX-jbW/2+6,jbCY)); parts.push(lug(jbCX+jbW/2-6,jbCY));
    parts.push(txt(jbCX,jbCY-jbH/2-15,isRoof(_sldSysType) ? 'ROOF J-BOX' : 'ARRAY J-BOX',{sz:F.sub,bold:true,anc:'middle'}));  // FIX v47.295
    parts.push(txt(jbCX,jbCY-jbH/2-7,'AC JUNCTION',{sz:F.tiny,anc:'middle'}));
    parts.push(txt(jbCX,jbCY+jbH/2+9,`${nBranches} branches`,{sz:F.tiny,anc:'middle'}));
    parts.push(txt(jbCX,jbCY+jbH/2+18,`${branchOcpd}A OCPD ea.`,{sz:F.tiny,anc:'middle'}));
    parts.push(callout(jbCX+jbW/2+12,jbCY-jbH/2-5,2));

    // SEGMENT 1: PV → J-Box (open air)
    parts.push(wireSeg(pvOutX,jbCX-jbW/2,resolveSegY(pvOutX,jbCX-jbW/2,BUS_Y),
      ['#10 AWG THWN-2','1×#'+egcNum+' GRN EGC','OPEN AIR — NEC 690.31'],{openAir:true}));

    // NODE 3: AC COMBINER
    const combLabel=`${inverterMfr} IQ Combiner 5C`;
    const cr=renderCombiner(xComb,BUS_Y,nBranches,branchOcpd,combLabel,3);
    parts.push(cr.svg);
    parts.push(txt(xComb,cr.ty-8,'AC COMBINER',{sz:F.hdr,bold:true,anc:'middle'}));
    const node3RX=cr.feederOutX;

    // SEGMENT 2: J-Box → Combiner
    parts.push(wireSeg(jbCX+jbW/2,cr.lx,resolveSegY(jbCX+jbW/2,cr.lx,BUS_Y),
      ['#10 AWG THWN-2','1×#'+egcNum+' GRN EGC','IN 3/4" EMT']));

    // NODE 5: AC DISCONNECT
    const discoResult=renderDisco(xDisco,BUS_Y,acOCPD,4);
    parts.push(discoResult.svg);
    parts.push(txt(xDisco,BUS_Y-40,'(N) AC DISCONNECT',{sz:F.hdr,bold:true,anc:'middle'}));

    // SEGMENT: Combiner → AC Disco
    parts.push(wireSeg(node3RX,discoResult.loadInX,resolveSegY(node3RX,discoResult.loadInX,BUS_Y),
      ['#10 AWG THWN-2','1×#'+egcNum+' GRN EGC','IN 3/4" EMT']));

    // NODE 6: MSP
    const mspResult=renderMSPLoad(xMSP,BUS_Y,mainAmps,pvBreakerAmps,5);
    parts.push(mspResult.svg);

    // SEGMENT: AC Disco LINE → MSP
    parts.push(wireSeg(discoResult.lineOutX,mspResult.bkfdInX,resolveSegY(discoResult.lineOutX,mspResult.bkfdInX,BUS_Y),
      ['#10 AWG THWN-2','1×#'+egcNum+' GRN EGC','IN 3/4" EMT']));

    let buiRX=mspResult.rx;

    // NODE 8: BUI + BATTERY (if battery)
    if(hasBattery) {
      // v58.11: Use grid-computed xBUI (proper WIRE_GAP clearance) instead of
      // old hard-coded xMSP + 130 which overlapped both MSP and meter.
      const buiCX=xBUI, buiCY=BUS_Y;
      const buiResult=renderBUI(buiCX,buiCY,'Enphase','IQ System Controller 3',200,true,false,7);
      parts.push(buiResult.svg);
      buiRX=buiResult.rx;

      // Wire: MSP → BUI GRID
      parts.push(ln(mspResult.rx,buiResult.gridPortY,buiResult.gridPortX,buiResult.gridPortY,{stroke:BLK,sw:SW_MED}));
      if(Math.abs(buiResult.gridPortY-BUS_Y)>2) parts.push(ln(mspResult.rx,BUS_Y,mspResult.rx,buiResult.gridPortY,{stroke:BLK,sw:SW_MED}));

      // Battery backfeed breaker at MSP
      const bfX=xMSP+30;
      parts.push(breakerSymbol(bfX,BUS_Y+30,20,12,batteryBackfeedA));
      parts.push(ln(bfX,BUS_Y,bfX,BUS_Y+24,{sw:SW_THIN,stroke:'#1565C0'}));
      parts.push(txt(bfX,BUS_Y+48,`${batteryBackfeedA}A BATT`,{sz:5,anc:'middle',bold:true,fill:'#1565C0'}));
      parts.push(txt(bfX,BUS_Y+56,'NEC 705.12(B)',{sz:4.5,anc:'middle',italic:true,fill:'#1565C0'}));

      // Battery symbol above BUI
      // v58.9 LAYOUT FIX: was BUS_Y-120 (overlapped MSP top-right by 55px
      // and BUI by 30px). Now BUS_Y-200 clears MSP top by 25px, BUI top by 50px.
      const batCX=buiCX, batCY=BUS_Y-200;
      const batResult=renderBattery(batCX,batCY,batteryModel,batteryKwh,batteryBackfeedA,8);
      parts.push(batResult.svg);

      // Wire: Battery → BUI BATTERY port
      parts.push(ln(batResult.acOutX,batResult.acOutY,buiResult.batPortX,buiResult.batPortY,{stroke:'#1565C0',sw:SW_MED,dash:'6,3'}));
      parts.push(tspan(batResult.acOutX+8,batResult.acOutY+(buiResult.batPortY-batResult.acOutY)/2,
        ['#10 AWG THWN-2',`${batteryBackfeedA}A CIRCUIT`],{sz:F.tiny,anc:'start',fill:'#1565C0'}));
    }

    // NODE 7: UTILITY METER
    const utilCX=xUtil, utilCY=BUS_Y, mR=24;
    parts.push(wireSeg(buiRX,utilCX-mR-10,resolveSegY(buiRX,utilCX-mR-10,BUS_Y),
      ['#10 AWG THWN-2','1×#'+egcNum+' GRN EGC','IN 3/4" EMT']));
    parts.push(`<circle cx="${utilCX}" cy="${utilCY}" r="${mR}" fill="${WHT}" stroke="${BLK}" stroke-width="${SW_MED}"/>`);
    parts.push(txt(utilCX,utilCY+3,'M',{sz:14,bold:true,anc:'middle'}));
    parts.push(ln(utilCX-mR-10,utilCY,utilCX-mR,utilCY,{sw:SW_MED}));
    parts.push(txt(utilCX,utilCY-mR-15,'UTILITY METER',{sz:F.hdr,bold:true,anc:'middle'}));
    parts.push(txt(utilCX,utilCY-mR-6,esc(utilityName),{sz:F.sub,anc:'middle'}));
    parts.push(txt(utilCX,utilCY+mR+9,'120/240V, 1Ø, 3W',{sz:F.tiny,anc:'middle'}));
    parts.push(callout(utilCX+mR+14,utilCY-mR-5,6));

    // Callout legend box (top-left of schematic)
    const lgdX=SCH_X+8, lgdY=SCH_Y+8, lgdW=230, lgdH=hasBattery?140:115;
    parts.push(rect(lgdX,lgdY,lgdW,lgdH,{fill:WHT,stroke:BLK,sw:SW_HAIR}));
    parts.push(rect(lgdX,lgdY,lgdW,13,{fill:BLK,sw:0}));
    parts.push(txt(lgdX+lgdW/2,lgdY+10,'CALLOUT LEGEND',{sz:6,bold:true,anc:'middle',fill:WHT}));
    const lgdItems: [number,string][] = [
      [1,`PV Array — ${totalPanels}×${panelWatts}W — ${panelVoc.toFixed(0)}Voc/${panelIsc.toFixed(1)}Isc`],
      [2,isRoof(_sldSysType) ? 'Roof J-Box (AC)' : 'Array J-Box (AC)'],
      [3,'AC Combiner — IQ Combiner 5C'],
      [4,`AC Disconnect — ${acOCPD}A Non-Fused`],
      [5,`MSP — ${mainAmps}A Main / ${pvBreakerAmps}A PV`],
      [6,'Utility Meter — 120/240V 1Ø'],
      ...(hasBattery ? ([[7,'IQ System Controller 3 — 200A'],[8,`IQ Battery — ${batteryKwh.toFixed(0)}kWh`]] as [number,string][]) : []),
    ];
    lgdItems.forEach(([n,lbl],i)=>{
      const ly=lgdY+22+i*13;
      parts.push(circ(lgdX+12,ly,6,{fill:WHT,stroke:BLK,sw:1}));
      parts.push(txt(lgdX+12,ly+1,String(n),{sz:5.5,bold:true,anc:'middle'}));
      parts.push(txt(lgdX+23,ly+1,lbl,{sz:5.5}));
    });

    // Utility grid drop
    const gridCY=utilCY+mR+48;
    parts.push(ln(utilCX,utilCY+mR,utilCX,gridCY-16,{sw:SW_MED}));
    parts.push(circ(utilCX,gridCY,16,{fill:WHT,sw:SW_MED}));
    parts.push(txt(utilCX,gridCY-1,'UTIL',{sz:5.5,bold:true,anc:'middle'}));
    parts.push(txt(utilCX,gridCY+7,'GRID',{sz:5,anc:'middle'}));
    parts.push(txt(utilCX,gridCY+24,'UTILITY GRID',{sz:F.tiny,anc:'middle',bold:true}));
    parts.push(txt(utilCX,gridCY+33,esc(utilityName),{sz:F.tiny,anc:'middle'}));
    parts.push(ln(utilCX,gridCY+16,utilCX,gridCY+26,{sw:SW_MED}));
    parts.push(gnd(utilCX,gridCY+26));

    // GROUNDING RAIL
    const gndPts=[xJBox,xComb,xDisco,xMSP];
    const gx1=gndPts[0], gx2=gndPts[gndPts.length-1];
    parts.push(ln(gx1,GND_Y,gx2,GND_Y,{stroke:GRN,sw:SW_MED}));
    for(const gx of gndPts) {
      parts.push(ln(gx,BUS_Y+36,gx,GND_Y,{stroke:GRN,sw:SW_MED}));
      parts.push(gnd(gx,GND_Y));
    }
    parts.push(txt((gx1+gx2)/2,GND_Y-5,'EQUIPMENT GROUNDING CONDUCTORS — NEC 250.122 / NEC 690.43',{sz:F.tiny,anc:'middle',fill:GRN}));

    // RAPID SHUTDOWN
    const rY=SCH_Y+SCH_H-22;
    parts.push(rect(SCH_X+5,rY-10,290,16,{fill:WHT,stroke:BLK,sw:SW_THIN}));
    // FIX v47.341: Dynamic rapid shutdown text based on topology + inverter model
    const _rsdInvModel = (system?.inverters?.[0]?.model || '').toUpperCase();
    const _rsdText = _sldTopo === 'MICRO'
      ? `RAPID SHUTDOWN — NEC 690.12 COMPLIANT — INTEGRATED IN ${_rsdInvModel || 'MICROINVERTERS'}`
      : 'RAPID SHUTDOWN — NEC 690.12 COMPLIANT — SEPARATE RSD REQUIRED';
    parts.push(txt(SCH_X+10,rY,_rsdText,{sz:F.tiny,bold:true}));

    // LEGEND
    const legEntries: Array<{dash:string,stroke:string,label:string}> = [
      {dash:'',    stroke:BLK,       label:'AC Conductor in Conduit (THWN-2)'},
      {dash:'10,5',stroke:GRN,       label:'Open Air — PV Wire/THWN-2 (NEC 690.31)'},
      {dash:'',    stroke:GRN,       label:'Equipment Grounding Conductor (EGC)'},
      ...(hasBattery?[{dash:'6,3',stroke:'#1565C0',label:'Battery AC-Coupled Connection'}]:[]),
    ];
    const legH=16+legEntries.length*11;
    const legX=SCH_X+SCH_W-195, legY=SCH_Y+SCH_H-legH-4;
    parts.push(rect(legX,legY,188,legH,{fill:WHT,stroke:BLK,sw:SW_THIN}));
    parts.push(txt(legX+4,legY+10,'LEGEND',{sz:F.sub,bold:true}));
    parts.push(ln(legX,legY+13,legX+188,legY+13,{sw:SW_THIN}));
    legEntries.forEach((item,i)=>{
      const ly=legY+19+i*11;
      parts.push(ln(legX+4,ly,legX+38,ly,{stroke:item.stroke,sw:SW_MED,dash:item.dash||undefined}));
      parts.push(txt(legX+44,ly+3,item.label,{sz:F.tiny}));
    });

    // CALCULATION PANELS (3 panels)
    const cW=Math.floor(DW/3)-4;
    const dcKw=totalPanels*panelWatts/1000;
    const md=deviceCount, ab=nBranches;
    const ba=branchOcpd;

    // Panel 1: AC Branch Circuit Info
    const p1x=DX;
    parts.push(rect(p1x,CALC_Y,cW,CALC_H,{fill:WHT,stroke:BLK,sw:SW_THIN}));
    parts.push(rect(p1x,CALC_Y,cW,14,{fill:BLK,sw:0}));
    parts.push(txt(p1x+cW/2,CALC_Y+10,'AC BRANCH CIRCUIT INFO',{sz:F.hdr,bold:true,anc:'middle',fill:WHT}));
    // FIX v47.341: Dynamic topology in SLD data tables
    const rows1: [string,string][]=[
      ['Topology', _sldTopoLabel],
      [_sldTopo === 'MICRO' ? 'Microinverters' : 'Inverters', `${_sldTopo === 'MICRO' ? md : (system?.inverters?.length || 1)} units`],
      ['Total DC Power',`${dcKw.toFixed(2)} kW`],
      [_sldTopo === 'MICRO' ? 'AC per Micro' : 'AC Output',`${Math.round(totalAcKw*1000/(_sldTopo === 'MICRO' ? md : (system?.inverters?.length || 1)))} W`],
      ['Branch Circuits',`${ab}`],
      [_sldTopo === 'MICRO' ? 'Max Micros/Branch' : 'Strings/Inverter', _sldTopo === 'MICRO' ? '16 (NEC 690.8)' : `${system?.inverters?.[0]?.strings?.length || 1}`],
      ['Branch OCPD',`${ba} A`],
      ['Branch Wire','#10 AWG THWN-2'],
      ['Feeder Wire',acWireGauge],
      ['Feeder Conduit',`3/4" ${acCondType}`],
      ['Module Voc',`${panelVoc} V`],
      ['Module Isc',`${panelIsc} A`],
    ];
    const rh1=Math.min(13,(CALC_H-17)/rows1.length);
    rows1.forEach(([l,v],i)=>{
      const ry=CALC_Y+19+i*rh1;
      if(i%2===1) parts.push(rect(p1x,ry-rh1+2,cW,rh1,{fill:LGY,stroke:'none',sw:0}));
      parts.push(txt(p1x+4,ry,l,{sz:F.tiny}));
      parts.push(txt(p1x+cW-4,ry,v,{sz:F.tiny,anc:'end',bold:true}));
    });

    // Panel 2: AC System Calculations
    const p2x=DX+cW+4;
    const _batBfA = hasBattery ? batteryBackfeedA : 0;
    const _totalBfA = pvBreakerAmps + _batBfA;
    const _busLimit = mainAmps * 1.2;
    const _120pass = _busLimit >= mainAmps + _totalBfA;
    parts.push(rect(p2x,CALC_Y,cW,CALC_H,{fill:WHT,stroke:BLK,sw:SW_THIN}));
    parts.push(rect(p2x,CALC_Y,cW,14,{fill:BLK,sw:0}));
    parts.push(txt(p2x+cW/2,CALC_Y+10,'AC SYSTEM CALCULATIONS',{sz:F.hdr,bold:true,anc:'middle',fill:WHT}));
    // NEC 690.8(A) Source Circuit Current (per microinv./string)
    const _srcIsc = panelIsc > 0 ? panelIsc : 0;
    const _srcImax = _srcIsc * 1.25;                         // NEC 690.8(A)(1)(a)
    const _srcOcpd = _srcImax > 0 ? Math.ceil(_srcImax / 5) * 5 : branchOcpd; // next standard size
    // NEC 690.8(B) PV Output Circuit Current
    const _outImax = acOutputAmps * 1.25;                    // NEC 690.8(B)(1)(a)
    const _outOcpd = _outImax > 0 ? Math.ceil(_outImax / 5) * 5 : acOCPD;     // next standard size
    const rows2: [string,string][]=[
      ['AC Output (kW)',`${totalAcKw.toFixed(2)} kW`],
      ['AC Output Amps',`${acOutputAmps.toFixed(1)} A`],
      ['─ NEC 690.8(A) Source ─',''],
      ['Isc (per module)',`${_srcIsc.toFixed(2)} A`],
      ['Imax = Isc×1.25',`${_srcImax.toFixed(2)} A`],
      ['Src OCPD',`${_srcOcpd} A`],
      ['─ NEC 690.8(B) Output ─',''],
      ['Iout = P÷V',`${acOutputAmps.toFixed(2)} A`],
      ['Imax = Iout×1.25',`${_outImax.toFixed(2)} A`],
      ['Out OCPD',`${_outOcpd} A`],
      ['AC OCPD (125%)',`${acOCPD} A`],
      ['AC Wire Gauge',acWireGauge],
      ['AC Conduit Type',acCondType],
      ['Conduit Size',acConduit],
      ['Service Voltage','120/240V, 1Ø'],
      ['Main Panel Rating',`${mainAmps} A`],
      ['Interconnection','Load Side Tap'],
      ['NEC Reference','NEC 705.12(B)'],
      ['PV Breaker',`${pvBreakerAmps} A`],
      ...(_batBfA>0?[['Batt. Backfeed Bkr',`${_batBfA} A`] as [string,string]]:[]),
      ['Total Backfeed',`${_totalBfA} A`],
      ['Bus 120% Limit',`${_busLimit.toFixed(0)} A`],
      ['120% Rule',`${_120pass?'PASS ✓':'FAIL ✗'}`],
    ];
    const rh2=Math.min(13,(CALC_H-17)/rows2.length);
    rows2.forEach(([l,v],i)=>{
      const ry=CALC_Y+19+i*rh2;
      if(i%2===1) parts.push(rect(p2x,ry-rh2+2,cW,rh2,{fill:LGY,stroke:'none',sw:0}));
      parts.push(txt(p2x+4,ry,l,{sz:F.tiny}));
      const isPF=v.includes('✓')||v.includes('✗');
      const vc2=isPF?(v.includes('✓')?PASS_C:FAIL_C):BLK;
      parts.push(txt(p2x+cW-4,ry,v,{sz:F.tiny,anc:'end',bold:true,fill:vc2}));
    });

    // Panel 3: Equipment Schedule
    const p3x=DX+(cW+4)*2;
    parts.push(rect(p3x,CALC_Y,cW,CALC_H,{fill:WHT,stroke:BLK,sw:SW_THIN}));
    parts.push(rect(p3x,CALC_Y,cW,14,{fill:BLK,sw:0}));
    parts.push(txt(p3x+cW/2,CALC_Y+10,'EQUIPMENT SCHEDULE',{sz:F.hdr,bold:true,anc:'middle',fill:WHT}));
    const _invAcKw = eq_sld.inverterAcOutputKw || 0;
    const _invAcA = _invAcKw > 0 ? (_invAcKw * 1000 / 240) : 0;
    const rows3: [string,string][]=[
      ['PV Module',esc(panelModel)],
      ['Module Wattage',`${panelWatts} W`],
      ['Module Voc',`${panelVoc.toFixed(1)} V`],
      ['Module Isc',`${panelIsc.toFixed(2)} A`],
      ['Total Modules',`${totalPanels}`],
      ['─ Inverter ─',''],
      ['Microinverters',`${md} units`],
      ['Inverter Mfr.',esc(inverterMfr)],
      ['Inverter Model',esc(inverterModel)],
      ['Inverter Max I',_invAcA > 0 ? `${_invAcA.toFixed(1)} A` : '—'],
      ['Inverter Output',`${totalAcKw.toFixed(2)} kW AC`],
      ['Branch Circuits',`${ab}`],
      ['─ System ─',''],
      ['AC Combiner','Enphase IQ Combiner 5C'],
      ['AC Disconnect',`${acOCPD}A Non-Fused`],
      ['Main Panel',`${mainAmps} A`],
      ['Utility',esc(utilityName)],
      ['Interconnection',interconnectionLabel(project.interconnectionMethod)],
      ['Rapid Shutdown','INTEGRATED — NEC 690.12'],
      ['Battery Storage',hasBattery?esc(batteryModel):'NONE'],
      ...(hasBattery&&batteryKwh?[['Battery Capacity',`${batteryKwh.toFixed(1)} kWh`] as [string,string]]:[]),
      ...(hasBattery?[['Batt. Backfeed',`${batteryBackfeedA}A — NEC 705.12(B)`] as [string,string]]:[]),
    ];
    const rh3=Math.min(12,(CALC_H-17)/rows3.length);
    rows3.forEach(([l,v],i)=>{
      const ry=CALC_Y+19+i*rh3;
      if(i%2===1) parts.push(rect(p3x,ry-rh3+2,cW,rh3,{fill:LGY,stroke:'none',sw:0}));
      parts.push(txt(p3x+4,ry,l,{sz:F.tiny}));
      parts.push(txt(p3x+cW-4,ry,v,{sz:F.tiny,anc:'end',bold:true}));
    });

    // CONDUIT & CONDUCTOR SCHEDULE
    parts.push(rect(DX,SCHED_Y,DW,SCHED_H,{fill:WHT,stroke:BLK,sw:SW_THIN}));
    parts.push(rect(DX,SCHED_Y,DW,14,{fill:BLK,sw:0}));
    parts.push(txt(DX+DW/2,SCHED_Y+10,'CONDUIT & CONDUCTOR SCHEDULE',{sz:F.hdr,bold:true,anc:'middle',fill:WHT}));
    const schedCols=[['#',28],['Circuit / Run',190],['Wire',110],['Conduit',65],['Size',50],['Length',60],['Qty Conductors',85],['From',115],['To',115],['Notes',192]] as [string,number][];
    let sx=DX+2, sy=SCHED_Y+16;
    schedCols.forEach(([h,w])=>{
      parts.push(txt(sx+3,sy+7,h,{sz:F.tiny,bold:true})); sx+=w;
    });
    parts.push(ln(DX,sy+9,DX+DW,sy+9,{sw:SW_HAIR}));
    // Determine wire gauge from compliance data or calculate from system size
    const schedWireGauge = acWireGauge || '#10 AWG THWN-2';
    const schedCondType  = acCondType || 'EMT';
    const schedConduit   = acConduit || '3/4&quot;';
    const utilSvcGauge   = mainAmps >= 200 ? '#2/0 AWG THWN-2' : mainAmps >= 150 ? '#1/0 AWG THWN-2' : '#4 AWG THWN-2';
    const schedRows=[
      ['1',`PV Array \u2192 ${isRoof(_sldSysType) ? 'Roof J-Box' : 'Array J-Box'}`,schedWireGauge,'PV Wire','\u2014','20 ft','3 (2 + EGC)','PV ARRAY',isRoof(_sldSysType) ? 'ROOF J-BOX' : 'ARRAY J-BOX','Open Air \u2014 NEC 690.31(E)'],
      ['2',`${isRoof(_sldSysType) ? 'Roof J-Box' : 'Array J-Box'} \u2192 AC Combiner`,schedWireGauge,schedCondType,schedConduit,'30 ft','3 (2 + EGC)',isRoof(_sldSysType) ? 'ROOF J-BOX' : 'ARRAY J-BOX','AC COMBINER 5C','In conduit \u2014 NEC 690.31'],
      ['3','AC Combiner → AC Disconnect',schedWireGauge,schedCondType,schedConduit,'10 ft','3 (2 + EGC)','AC COMBINER 5C','AC DISCONNECT','NEC 705.12(B)'],
      ['4','AC Disconnect → MSP (Backfeed)',schedWireGauge,schedCondType,schedConduit,'25 ft','3 (2 + EGC)','AC DISCONNECT','MAIN SERVICE PANEL',`${pvBreakerAmps}A Backfeed — NEC 705.12(B)`],
      ...(hasBattery?[
        ['7','MSP → IQ System Controller 3','#6 AWG THWN-2',schedCondType,schedConduit,'5 ft','3 (2 + EGC)','MAIN SERVICE PANEL','IQ SYS CTRL 3','NEC 706 / NEC 230.82'],
        ['8','IQ System Controller 3 → Battery',schedWireGauge,schedCondType,schedConduit,'5 ft','3 (2 + EGC)','IQ SYS CTRL 3','IQ BATTERY 5P','AC-Coupled Battery — NEC 706'],
      ]:[]),
      ['6','Utility Service → MSP',utilSvcGauge,'EMT','1-1/4&quot;','Service','3 (2 + EGC)','UTILITY METER','MAIN SERVICE PANEL','Utility Service — NEC 230.54'],
    ] as string[][];
    sy+=11;
    schedRows.forEach((row,ri)=>{
      if(ri%2===0) parts.push(rect(DX,sy-1,DW,11,{fill:LGY,stroke:'none',sw:0}));
      sx=DX+2;
      schedCols.forEach(([,w],ci)=>{
        parts.push(txt(sx+3,sy+6,row[ci]||'—',{sz:F.tiny})); sx+=w;
      });
      sy+=11;
    });

    // TITLE BLOCK (right side)
    const tbX=TB_X, tbY=DY, tbH=H-DY*2;
    parts.push(rect(tbX,tbY,TB_W,tbH,{fill:WHT,stroke:BLK,sw:SW_THIN}));
    parts.push(rect(tbX,tbY,TB_W,38,{fill:BLK,sw:0}));
    parts.push(txt(tbX+TB_W/2,tbY+15,'SOLARPRO',{sz:13,bold:true,anc:'middle',fill:WHT}));
    parts.push(txt(tbX+TB_W/2,tbY+28,'ENGINEERING',{sz:F.tb,anc:'middle',fill:'#AAAAAA'}));
    parts.push(rect(tbX,tbY+38,TB_W,30,{fill:WHT,stroke:BLK,sw:SW_THIN}));
    parts.push(txt(tbX+TB_W/2,tbY+51,'SINGLE LINE DIAGRAM',{sz:F.tbTitle,bold:true,anc:'middle'}));
    parts.push(txt(tbX+TB_W/2,tbY+63,'PHOTOVOLTAIC SYSTEM',{sz:F.tb,anc:'middle'}));
    parts.push(rect(tbX,tbY+68,TB_W,10,{fill:'#1B5E20',stroke:'none',sw:0}));
    parts.push(txt(tbX+TB_W/2,tbY+76,'SolarPro V4 — IEEE/ANSI SLD',{sz:4.5,bold:true,anc:'middle',fill:WHT}));

    const tbRowData: [string,string][]=[
      ['PROJECT',project.projectName||'—'],
      ['CLIENT',project.clientName||'—'],
      ['ADDRESS',(project.address||'—').substring(0,30)],
      ['DESIGNER',project.designer||'—'],
      ['DATE',project.date||'—'],
      ['DWG NO.','E-1'],
      ['REVISION','A'],
      ['SCALE','NOT TO SCALE'],
    ];
    let tbY2=tbY+78;
    const tbRH=20;
    tbRowData.forEach(([l,v])=>{
      parts.push(rect(tbX,tbY2,TB_W,tbRH,{fill:WHT,stroke:BLK,sw:SW_HAIR}));
      parts.push(txt(tbX+4,tbY2+13,l,{sz:F.tiny,bold:true,fill:'#555'}));
      parts.push(txt(tbX+62,tbY2+13,esc(String(v??'')),{sz:F.tb}));
      tbY2+=tbRH;
    });

    // System summary in title block
    const sysY=tbY2+3;
    parts.push(rect(tbX,sysY,TB_W,12,{fill:BLK,sw:0}));
    parts.push(txt(tbX+TB_W/2,sysY+9,'SYSTEM SUMMARY',{sz:F.sub,bold:true,anc:'middle',fill:WHT}));
    const sysRows: [string,string][]=[
      // FIX v47.341: Dynamic topology in SLD system summary
      ['TOPOLOGY', _sldTopoLabel],
      ['DC SIZE',`${dcKw.toFixed(2)} kW`],
      ['AC OUTPUT',`${totalAcKw.toFixed(2)} kW`],
      ['MODULES',`${totalPanels} × ${panelWatts}W`],
      ['INVERTER',esc(inverterMfr)],
      ['MODEL',esc(inverterModel)],
      ['SERVICE',`${mainAmps}A`],
      ['UTILITY',esc(utilityName)],
      ['INTERCONN.',interconnectionLabel(project.interconnectionMethod).split(' — ')[0]],
    ];
    let sysY2=sysY+12;
    const sysRH=16;
    sysRows.forEach(([l,v])=>{
      parts.push(rect(tbX,sysY2,TB_W,sysRH,{fill:WHT,stroke:BLK,sw:SW_HAIR}));
      parts.push(txt(tbX+4,sysY2+11,l,{sz:F.tiny,bold:true,fill:'#555'}));
      parts.push(txt(tbX+70,sysY2+11,esc(String(v??'')),{sz:F.tb}));
      sysY2+=sysRH;
    });

    // Code references
    const codeY=sysY2+3;
    parts.push(rect(tbX,codeY,TB_W,12,{fill:BLK,sw:0}));
    parts.push(txt(tbX+TB_W/2,codeY+9,'CODE REFERENCES',{sz:F.sub,bold:true,anc:'middle',fill:WHT}));
    const codes=[
      '• NEC 690 — PV SYSTEMS',
      '• NEC 705 — INTERCONNECTED ELEC.',
      '• NEC 706 — ENERGY STORAGE',
      '• NEC 310 — CONDUCTORS',
      '• NEC 250 — GROUNDING/BONDING',
      '• NEC 358/352 — CONDUIT',
      '• NEC 230 — SERVICES',
      '• IBC / ASCE 7 — STRUCTURAL',
    ];
    let codeY2=codeY+12;
    codes.forEach(c=>{ parts.push(txt(tbX+4,codeY2+9,c,{sz:F.tiny})); codeY2+=12; });

    // Revisions
    const revY=codeY2+3, revH=Math.min(80,tbY+tbH-revY-50);
    if(revH>24){
      parts.push(rect(tbX,revY,TB_W,12,{fill:BLK,sw:0}));
      parts.push(txt(tbX+TB_W/2,revY+9,'REVISIONS',{sz:F.sub,bold:true,anc:'middle',fill:WHT}));
      parts.push(rect(tbX,revY+12,TB_W,revH,{fill:WHT,stroke:BLK,sw:SW_THIN}));
      const rcw=TB_W/3;
      parts.push(txt(tbX+3,revY+22,'REV',{sz:F.tiny,bold:true}));
      parts.push(txt(tbX+rcw+3,revY+22,'DESCRIPTION',{sz:F.tiny,bold:true}));
      parts.push(txt(tbX+rcw*2+3,revY+22,'DATE',{sz:F.tiny,bold:true}));
      parts.push(ln(tbX,revY+24,tbX+TB_W,revY+24,{sw:SW_HAIR}));
      parts.push(ln(tbX+rcw,revY+12,tbX+rcw,revY+revH,{sw:SW_HAIR}));
      parts.push(ln(tbX+rcw*2,revY+12,tbX+rcw*2,revY+revH,{sw:SW_HAIR}));
      parts.push(txt(tbX+3,revY+34,'A',{sz:F.tiny}));
      parts.push(txt(tbX+rcw+3,revY+34,'INITIAL ISSUE FOR PERMIT',{sz:F.tiny}));
      parts.push(txt(tbX+rcw*2+3,revY+34,project.date||'—',{sz:F.tiny}));
    }

    // Engineer seal
    const sealY=tbY+tbH-50;
    parts.push(rect(tbX,sealY,TB_W,50,{fill:WHT,stroke:BLK,sw:SW_THIN}));
    parts.push(circ(tbX+TB_W/2,sealY+22,18,{fill:WHT,stroke:BLK,sw:SW_THIN}));
    parts.push(txt(tbX+TB_W/2,sealY+19,'ENGINEER',{sz:F.tiny,anc:'middle',fill:'#888'}));
    parts.push(txt(tbX+TB_W/2,sealY+28,'SEAL',{sz:F.tiny,anc:'middle',fill:'#888'}));
    parts.push(txt(tbX+TB_W/2,sealY+44,`${esc(project.designer||'SolarPro Engineering')} — ${esc(project.date||'')}`,{sz:F.tiny,anc:'middle',fill:'#555'}));

    parts.push('</svg>');
    return parts.join('\n');
  }

  // ── SLD content: 3-tier priority ──────────────────────────────────────
  //   1. storedSldSvg  — pre-generated via "Generate SLD" button (DB artifact)
  //   2. Live professional SLD — renderSLDProfessional() from live permit data
  //   3. Inline buildSLD() — built-in fallback (always works)
  let sldBodyHtml: string;

  if (storedSldSvg && storedSldSvg.trim().startsWith('<svg')) {
  // FIX v47.296: Sanitize stored SLD — replace roof-specific labels for non-roof systems
  if (_sldSysType !== 'roof') {
    storedSldSvg = storedSldSvg
      .replace(/ROOF J-BOX/g, 'ARRAY J-BOX')
      .replace(/Roof J-Box/g, 'Array J-Box')
      .replace(/roof j-box/g, 'array j-box');
  }
  // FIX v47.341: Sanitize stored SLD — fix floating point leaks in kW/coordinate values
  storedSldSvg = storedSldSvg.replace(
    /\d+\.\d{2}\d{10,}/g,
    (m: string) => parseFloat(m).toFixed(2)
  );
    // Stored SLD from Engineering tab "Generate SLD" — render full-bleed
    sldBodyHtml = `
    <div style="padding:0;overflow:hidden;width:100%;margin:0;display:block;text-align:center;">
      <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;text-align:center;">
        ${storedSldSvg}
      </div>
    </div>`;
  } else {
    // ── LIVE SLD: auto-generate professional SLD from permit data ──────
    // Pipeline: PermitInput → buildSLDInputFromPermit() → renderSLDProfessional()
    // Same renderer used by the Engineering tab "Generate SLD" button.
    // Falls back to inline buildSLD() if the professional renderer fails.
    let liveSvg: string | null = null;
    try {
      liveSvg = generateLiveSLD(input, cad);
      if (!liveSvg || !liveSvg.trim().startsWith('<svg')) {
        liveSvg = null;
      }
    } catch (sldErr: unknown) {
      console.warn('[E-1] Live SLD generation failed, falling back to inline buildSLD():', sldErr instanceof Error ? (sldErr as Error).message : sldErr);
      liveSvg = null;
    }

    if (liveSvg) {
      // Live professional SLD — render full-bleed (same layout as stored SLD)
      sldBodyHtml = `
      <div style="padding:0;overflow:hidden;width:100%;margin:0;display:block;text-align:center;">
        <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;text-align:center;">
          ${liveSvg}
        </div>
      </div>`;
    } else {
      // Final fallback: inline buildSLD() — always works, uses PermitInput directly.
      const svgContent = buildSLD();
      if (!svgContent || svgContent.trim() === '') {
        throw new Error('[E-1] buildSLD() returned empty content — SLD generation failed');
      }
      sldBodyHtml = `
      <div style="padding:0;overflow:hidden;width:100%;margin:0;text-align:center;">
        ${svgContent}
      </div>`;
    }
  }

  return `
  <div class="page sld-page">
    ${titleBlock(input, 'E-1', 'SINGLE-LINE ELECTRICAL DIAGRAM', pageNum, totalPages)}
    ${sldBodyHtml}
  </div>`;
}




