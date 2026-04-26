// ═══════════════════════════════════════════════════════════════
// Compliance Pages — Warning Labels, Spec Sheet Reference
// Extracted from route.ts — ZERO REGRESSION
// ═══════════════════════════════════════════════════════════════

import type { PermitInput } from '../types';
import type { CADModel } from '@/lib/cad/types';
import { titleBlock } from '../utils/titleBlock';
import { interconnectionLabel } from '../utils/helpers';
import { getEquipmentContext, getInverterTopology, isFence, isGround, isRoof, topologyToLegacy } from '@/lib/system';
import type { CanonicalSysType } from '../types';
import { MOUNT_SYSTEM_MAP } from '../utils/canonical';

export function pageWarningLabels(input: PermitInput, cad: CADModel, pageNum: number, totalPages: number): string {
  const { project, system, compliance } = input;
  const necVer = compliance.jurisdiction?.necVersion || '2020';
  const hasBattery = (project.batteryCount || 0) > 0;
  const hasGenerator = (project.generatorKw || 0) > 0;
  const _isRoof = isRoof(cad.systemType);   // FIX v47.295: system-aware warning labels
  const _isFence = isFence(cad.systemType);
  const _isGround = isGround(cad.systemType);

  const eq_labels = getEquipmentContext(input, cad);
  const panelIsc = eq_labels.panelIsc || 0;
  const panelVoc = eq_labels.panelVoc || 0;
  // v47.350: Use accessor layer (prefers SystemDefinition, falls back to legacy)
  const _labelTopo = topologyToLegacy(getInverterTopology(input, cad));
  const isMicro = _labelTopo === 'MICRO';

  const maxCircuitCurrent = (panelIsc * 1.25).toFixed(1);
  const maxSystemVoltage = isMicro ? '240V AC' : `${(panelVoc * 1.25).toFixed(0)}V DC`;

  interface LabelSpec {
    id: string;
    necRef: string;
    placement: string;
    lines: string[];
    bg: string;
    fg: string;
    required: boolean;
  }

  const labels: LabelSpec[] = [
    {
      id: 'L-1',
      necRef: `NEC 690.54 / NEC ${necVer}`,
      placement: 'On combiner box and at DC disconnect',
      lines: [
        'WARNING',
        'SOLAR ELECTRIC SYSTEM CONNECTED',
        `MAXIMUM SYSTEM VOLTAGE: ${maxSystemVoltage}`,
        `MAXIMUM CIRCUIT CURRENT: ${maxCircuitCurrent}A`,
      ],
      bg: '#cc0000',
      fg: '#ffffff',
      required: true,
    },
    {
      id: 'L-2',
      // NEC 2023 renumbered 690.56(B) → 690.12(D)(2)
      necRef: necVer === '2023' ? 'NEC 690.12(D)(2)' : 'NEC 690.56(B)',
      placement: 'At rapid shutdown initiator (service entrance)',
      lines: [
        'SOLAR RAPID SHUTDOWN',
        'STATUS:',
        '\u25a1 NORMAL OPERATION',
        '\u25a1 RAPID SHUTDOWN ACTIVATED',
      ],
      bg: '#cc0000',
      fg: '#ffffff',
      required: project.rapidShutdown,
    },
    {
      id: 'L-3',
      // NEC 2023 renumbered 690.56(C)(1) → 690.12(D)
      necRef: necVer === '2023' ? 'NEC 690.12(D)' : 'NEC 690.56(C)(1)',
      placement: `At the array \u2014 each ${_isRoof ? 'roof elevation' : _isFence ? 'fence section' : 'array section'} with PV`,
      lines: [
        'WARNING',
        'PHOTOVOLTAIC POWER SOURCE',
        'DO NOT REMOVE OR COVER THIS LABEL',
        necVer === '2023'
          ? 'RAPID SHUTDOWN SYSTEM INSTALLED \u2014 SEE NEC 690.12(D)'
          : 'INSTALLATION SHUTDOWN INFORMATION INSIDE',
      ],
      bg: '#cc0000',
      fg: '#ffffff',
      required: project.rapidShutdown,
    },
    {
      id: 'L-4',
      necRef: 'NEC 705.12 / 690.64',
      placement: 'On the main service panel — inside door',
      lines: [
        'WARNING',
        'DUAL POWER SOURCES',
        'PHOTOVOLTAIC SYSTEM CONNECTED',
        'SHUT OFF PV DISCONNECT BEFORE SERVICING',
      ],
      bg: '#cc0000',
      fg: '#ffffff',
      required: true,
    },
    {
      id: 'L-5',
      necRef: 'IFC \u00a7605.11 / NEC 690.56(A)',
      placement: 'Adjacent to or on the utility meter',
      lines: [
        'SOLAR PV SYSTEM CONNECTED',
        project.address || '—',
        `System Size: ${system.totalDcKw?.toFixed(2) || '—'} kW DC`,
        `Interconnection: ${interconnectionLabel(project.interconnectionMethod)}`,
      ],
      bg: '#000',
      fg: '#ffffff',
      required: true,
    },
    // FIX v47.341: Conditional L-6 placement text based on topology
    {
      id: 'L-6',
      necRef: 'NEC 690.53',
      placement: isMicro
        ? 'On AC disconnect or combiner panel (microinverter system)'
        : 'On PV system DC disconnect',
      lines: [
        'PHOTOVOLTAIC SYSTEM DISCONNECT',
        `MAXIMUM INPUT VOLTAGE: ${maxSystemVoltage}`,
        `MAXIMUM CIRCUIT CURRENT: ${maxCircuitCurrent}A`,
        'DO NOT TOUCH — LIVE CONDUCTORS',
      ],
      bg: '#cc0000',
      fg: '#ffffff',
      required: true,  // Always show — placement text adapts to topology
    },
    {
      id: 'L-7',
      necRef: 'NFPA 855 \u00a74.3 / NEC 706',
      placement: 'On battery storage enclosure — exterior',
      lines: [
        'WARNING',
        'ENERGY STORAGE SYSTEM',
        'LITHIUM-ION BATTERY',
        'FIRE AND EXPLOSION HAZARD',
        'DO NOT OPEN — CALL 911 IF DAMAGED',
      ],
      bg: '#cc4400',
      fg: '#ffffff',
      required: hasBattery,
    },
    {
      id: 'L-8',
      necRef: 'NFPA 855 \u00a74.3.3',
      placement: 'On battery storage enclosure — near electrical terminals',
      lines: [
        'BATTERY ENERGY STORAGE SYSTEM',
        `Manufacturer: ${project.batteryBrand || '—'}`,
        `Model: ${project.batteryModel || '—'}`,
        'Nominal Voltage: 48V DC',
        `Capacity: ${((project.batteryCount || 0) * (project.batteryKwh || 0)).toFixed(1)} kWh TOTAL`,
      ],
      bg: '#000',
      fg: '#ffffff',
      required: hasBattery,
    },
    {
      id: 'L-9',
      necRef: 'NEC 702 / NEC 705.12',
      placement: 'On ATS/transfer switch enclosure',
      lines: [
        'WARNING',
        'TRANSFER SWITCH',
        'BOTH UTILITY AND GENERATOR POWER PRESENT',
        'ISOLATE BEFORE SERVICING',
      ],
      bg: '#cc0000',
      fg: '#ffffff',
      required: hasGenerator,
    },
    // ── NEC 2023 additions ──────────────────────────────────────────────────
    {
      id: 'L-10',
      // NEC 2023 §690.7(D) — new max DC voltage label requirement
      necRef: 'NEC 690.7(D)',
      placement: 'On DC combiner box and at DC disconnect',
      lines: [
        'WARNING',
        'MAXIMUM DC SYSTEM VOLTAGE',
        `${isMicro ? '240V AC (MICROINVERTER)' : `${(panelVoc * 1.25).toFixed(0)}V DC`}`,
        'SHOCK HAZARD — CIRCUITS REMAIN ENERGIZED IN DAYLIGHT',
      ],
      bg: '#cc0000',
      fg: '#ffffff',
      required: necVer === '2023' && !isMicro,
    },
    {
      id: 'L-11',
      // NEC 2023 §705.10 — expanded multiple power source directory
      necRef: 'NEC 705.10',
      placement: 'On main service panel — inside cover, next to L-4',
      lines: [
        'MULTIPLE POWER SOURCES PRESENT',
        'SOLAR PV + ' + (hasBattery ? 'BATTERY STORAGE' : 'UTILITY GRID'),
        'SEE DIRECTORY FOR ALL DISCONNECT LOCATIONS',
        'ISOLATE ALL SOURCES BEFORE SERVICING',
      ],
      bg: '#000',
      fg: '#ffffff',
      required: necVer === '2023',
    },
  ];

  const requiredLabels = labels.filter(l => l.required);

  function renderLabel(lbl: LabelSpec): string {
    const lineHtml = lbl.lines.map((line, i) =>
      `<div style="font-size:${i === 0 ? '10.5px' : '8.5px'};font-weight:${i === 0 ? '900' : '700'};` +
      `letter-spacing:${i === 0 ? '0.8px' : '0.2px'};line-height:1.45;` +
      `white-space:normal;word-break:break-word;">${line}</div>`
    ).join('');
    return `<div class=\"lbl-card\">` +
      `<div class=\"lbl-hdr\">` +
      `<span class=\"lbl-hdr-id\">${lbl.id}</span>` +
      `<span class=\"lbl-hdr-ref\">${lbl.necRef}</span>` +
      `</div>` +
      `<div style=\"background:${lbl.bg};color:${lbl.fg};padding:6px 8px;min-height:58px;\">` +
      `${lineHtml}` +
      `</div>` +
      `<div class=\"lbl-footer\">` +
      `<strong>LOCATION:</strong> ${lbl.placement}` +
      `</div>` +
      `</div>`;
  }

  function buildLabelRows(lblList: LabelSpec[]): string {
    let html = '';
    for (let i = 0; i < lblList.length; i += 3) {
      const row = lblList.slice(i, i + 3);
      html += '<tr>';
      for (const lbl of row) {
        html += `<td style="width:33.33%;padding:3px 4px;vertical-align:top;">${renderLabel(lbl)}</td>`;
      }
      for (let p = row.length; p < 3; p++) {
        html += '<td style="width:33.33%;padding:3px 4px;"></td>';
      }
      html += '</tr>';
    }
    return html;
  }

  return `
  <div class="page">
    ${titleBlock(input, 'PV-5', 'WARNING LABELS & REQUIRED PLACARDS', pageNum, totalPages)}
    <div class=\"page-content\">

      <div class=\"note-bar\" style=\"margin-bottom:7px;\">
        ALL WARNING LABELS SHALL BE PERMANENTLY INSTALLED, WEATHER-RESISTANT, AND MEET MINIMUM CHARACTER HEIGHT REQUIREMENTS PER NEC ${necVer}.
        LETTERING SHALL BE MINIMUM 3/8" HEIGHT FOR FIELD-APPLIED LABELS, OR AS SPECIFIED BY MANUFACTURER FOR LISTED LABELS.
        COLOR: WHITE LETTERING ON RED BACKGROUND (${necVer === '2023' ? 'NEC 690.12(D)' : 'NEC 690.56'}) UNLESS OTHERWISE NOTED.
      </div>

      <div class=\"sec-hdr-dark\" style=\"margin-bottom:5px;\">
        REQUIRED LABELS &mdash; ${requiredLabels.length} OF ${labels.length} APPLICABLE TO THIS SYSTEM
      </div>

      <table style="width:100%;border-collapse:collapse;table-layout:fixed;margin-bottom:10px;">
        <tbody>
          ${buildLabelRows(requiredLabels)}
        </tbody>
      </table>

      <!-- General Notes -->
      <div class=\\\"sec-hdr-dark\\\" style=\\\"margin-bottom:4px;\\">
        GENERAL NOTES &mdash; INSTALLATION REQUIREMENTS
      </div>
      <div style="padding:var(--xs);font-size:var(--f-sm);line-height:1.55;border:var(--border);margin-bottom:8px;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div>
            <div style="font-weight:900;font-size:8px;letter-spacing:0.5px;margin-bottom:3px;border-bottom:1px solid #ccc;padding-bottom:2px;">ELECTRICAL</div>
            <div style="margin-bottom:2px;">1. All electrical work shall be performed by a licensed electrician in accordance with NEC ${necVer}.</div>
            <div style="margin-bottom:2px;">2. All equipment shall be UL-listed and labeled for the intended application.</div>
            <div style="margin-bottom:2px;">3. All conductor terminations shall be torqued to manufacturer specifications.</div>
            <div style="margin-bottom:2px;">4. Conduit penetrations through fire-rated assemblies shall be firestopped per IBC 714.</div>
            <div style="margin-bottom:2px;">5. Anti-islanding protection per IEEE 1547 and UL 1741 SA is integral to the inverter.</div>
          </div>
          <div>
            <div style="font-weight:900;font-size:8px;letter-spacing:0.5px;margin-bottom:3px;border-bottom:1px solid #ccc;padding-bottom:2px;">STRUCTURAL / INSTALLATION</div>
            <div style=\"margin-bottom:2px;\">1. Contractor shall verify ${_isRoof ? 'roof framing type, size, spacing, and condition prior to installation' : _isFence ? 'fence post layout, spacing, and foundation conditions prior to installation' : 'ground mount pile layout, soil conditions, and site grades prior to installation'}.</div>\n
            <div style="margin-bottom:2px;">2. Any deviation from the approved design shall be reported to the engineer of record.</div>
            <div style=\"margin-bottom:2px;\">3. ${_isRoof ? 'All roof penetrations shall be waterproofed per roofing manufacturer requirements.' : 'All below-grade conduit and conductors shall be rated for wet/direct burial locations per NEC 300.5.'}</div>\n
            <div style="margin-bottom:2px;">4. Module and racking installation per manufacturer instructions and UL 2703 listing.</div>
            <div style="margin-bottom:2px;">5. Maintain IFC \u00a7605.11 fire code setbacks: 3 ft from ridge, 18" from edges and valleys.</div>
          </div>
        </div>
      </div>

      <!-- Inspection Hold Points -->
      <div class=\\\"sec-hdr-dark\\\" style=\\\"margin-bottom:4px;\\">
        INSPECTION HOLD POINTS
      </div>
      <table class=\\\"equip-table\\\">
        <thead><tr><th style="width:6%;">#</th><th style="width:22%;">Inspection Point</th><th style="width:42%;">Verification Requirements</th><th style="width:15%;">Code Reference</th><th style="width:15%;text-align:center;">Inspector</th></tr></thead>
        <tbody>
          <tr><td class="fw9 mono">1</td><td class="fw7">Rough Electrical</td><td>Verify conductor sizing, conduit routing, grounding connections, junction box accessibility</td><td class="mono" style="font-size:8px;">NEC 690, 250</td><td class="center">\u25a1</td></tr>
          <tr class=\"bg-lt\"><td class=\"fw9 mono\">2</td><td class=\"fw7\">${_isRoof ? 'Structural / Roof' : _isFence ? 'Structural / Fence' : 'Structural / Ground Mount'}</td><td>${_isRoof ? 'Verify attachment to structural members, lag bolt embedment, flashing installation, rail alignment' : _isFence ? 'Verify fence post embedment depth, concrete footing pour, post plumb/alignment, and module mounting' : 'Verify pile embedment, ground clearance, tilt angle, and module mounting'}</td><td class=\"mono\" style=\"font-size:8px;\">IBC Ch. 16, IRC R301</td><td class=\"center\">\u25a1</td></tr>\n
          <tr><td class="fw9 mono">3</td><td class="fw7">Module Installation</td><td>Verify module mounting, clamp torque, bonding connections, setback compliance</td><td class="mono" style="font-size:8px;">UL 2703, IFC 605.11</td><td class="center">\u25a1</td></tr>
          <tr class="bg-lt"><td class="fw9 mono">4</td><td class="fw7">Final Electrical</td><td>Verify labeling, rapid shutdown, disconnect operation, grounding continuity, Voc/Isc verification</td><td class="mono" style="font-size:8px;">NEC 690.12, 690.54</td><td class="center">\u25a1</td></tr>
          <tr><td class="fw9 mono">5</td><td class="fw7">Utility Interconnection</td><td>Verify meter configuration, net metering enrollment, anti-islanding test (if required by AHJ)</td><td class="mono" style="font-size:8px;">IEEE 1547, NEC 705</td><td class="center">\u25a1</td></tr>
        </tbody>
      </table>

      <div class=\"sec-hdr-dark\" style=\"margin-bottom:4px;\">
        LABEL SCHEDULE &mdash; ALL LABELS
      </div>
      <table class=\"equip-table\">
        <thead>
          <tr>
            <th style="width:7%;">LABEL</th>
            <th style="width:22%;">CODE REFERENCE</th>
            <th style="width:8%;text-align:center;">REQ'D</th>
            <th>PLACEMENT LOCATION</th>
          </tr>
        </thead>
        <tbody>
          ${labels.map((lbl, idx) =>
            `<tr style="${!lbl.required ? 'opacity:0.45;' : ''}background:${idx % 2 === 0 ? '#fff' : '#f5f5f5'};">` +
            `<td class="fw9 mono">${lbl.id}</td>` +
            `<td style="font-family:monospace;font-size:8px;">${lbl.necRef}</td>` +
            `<td style="text-align:center;font-weight:900;font-family:monospace;">${lbl.required ? 'YES' : 'N/A'}</td>` +
            `<td style="font-size:9px;">${lbl.placement}</td>` +
            `</tr>`
          ).join('')}
        </tbody>
      </table>

    </div>
  </div>`;
}




// ─── Spec Sheet Reference Page ─────────────────────────────────────────────

export function pageSpecSheetReference(input: PermitInput, cad: CADModel, pageNum: number, totalPages: number): string {
  const { project, system } = input;
  const _isRoof = isRoof(cad.systemType);   // FIX v47.296
  const _isFence = isFence(cad.systemType);
  const _isGround = isGround(cad.systemType);
  const panels = system.inverters?.[0]?.strings?.[0];
  const modMfr = panels?.panelManufacturer || '—';
  const modModel = panels?.panelModel || '—';
  const modWatts = panels?.panelWatts || 400;
  const invMfr = system.inverters?.[0]?.manufacturer || '—';
  const invModel = system.inverters?.[0]?.model || '—';

  // Get specs from the spec sheet DB
  const voc = panels?.panelVoc || (project as any).panelVoc || 41.6;
  const isc = panels?.panelIsc || (project as any).panelIsc || 12.26;
  const pmax = modWatts;
  const vmp = parseFloat((voc * 0.83).toFixed(1));
  const imp = parseFloat((isc * 0.94).toFixed(2));
  const tempCoeff = -0.35;
  const panelLen = (project as any).panelLengthIn || 79.9;
  const panelWid = (project as any).panelWidthIn || 40.9;
  const panelWt = (project as any).panelWeightLbs || 44;

  // NEC 690.8 calculations
  const TEMP_CORR_FACTOR = 1.25; // for -13°F (worst case cold)
  const NEC_SAFETY = 1.25;
  const vocMax = parseFloat((voc * TEMP_CORR_FACTOR).toFixed(1));
  const iscMax = parseFloat((isc * NEC_SAFETY).toFixed(2));

  return `
  <div class="page">
    ${titleBlock(input, 'APP-A', 'EQUIPMENT SPECIFICATION REFERENCE', pageNum, totalPages)}
    <div class="page-content">
      <div class="two-col-layout">
        <div class="col-left">
          <!-- Module Datasheet Summary -->
          <div class="section-title">PV Module — Electrical Specifications</div>
          <table class="info-table" style="margin-bottom:6px;">
            <tr><td class="il">Manufacturer</td><td class="iv">${modMfr}</td></tr>
            <tr><td class="il">Model</td><td class="iv">${modModel}</td></tr>
            <tr><td class="il">STC Power (Pmax)</td><td class="iv">${pmax} Wp</td></tr>
            <tr><td class="il">Open Circuit Voltage (Voc)</td><td class="iv">${voc} V</td></tr>
            <tr><td class="il">Short Circuit Current (Isc)</td><td class="iv">${isc} A</td></tr>
            <tr><td class="il">Max Power Voltage (Vmp)</td><td class="iv">${vmp} V</td></tr>
            <tr><td class="il">Max Power Current (Imp)</td><td class="iv">${imp} A</td></tr>
            <tr><td class="il">Temp. Coeff. Pmax</td><td class="iv">${tempCoeff}%/°C</td></tr>
            <tr><td class="il">Temp. Coeff. Voc</td><td class="iv">-0.27%/°C</td></tr>
            <tr><td class="il">NOCT</td><td class="iv">45°C ±2°C</td></tr>
            <tr><td class="il">Module Efficiency</td><td class="iv">${((pmax / (panelLen/39.37 * panelWid/39.37)) / 10).toFixed(1)}%</td></tr>
          </table>

          <div class="section-title">PV Module — Physical Specifications</div>
          <table class="info-table" style="margin-bottom:6px;">
            <tr><td class="il">Length</td><td class="iv">${panelLen}" (${(panelLen*25.4).toFixed(0)}mm)</td></tr>
            <tr><td class="il">Width</td><td class="iv">${panelWid}" (${(panelWid*25.4).toFixed(0)}mm)</td></tr>
            <tr><td class="il">Weight</td><td class="iv">${panelWt} lbs (${(panelWt*0.453592).toFixed(1)} kg)</td></tr>
            <tr><td class="il">Front Load</td><td class="iv">5400 Pa (Wind/Snow)</td></tr>
            <tr><td class="il">Rear Load</td><td class="iv">2400 Pa</td></tr>
            <tr><td class="il">Cell Type</td><td class="iv">Monocrystalline PERC / TOPCon</td></tr>
            <tr><td class="il">Frame</td><td class="iv">Anodized Aluminum Alloy</td></tr>
            <tr><td class="il">Connector</td><td class="iv">MC4 Compatible</td></tr>
            <tr><td class="il">UL Listing</td><td class="iv">UL 61730 / IEC 61215</td></tr>
          </table>

          <!-- NEC 690.8 Calculations from module specs -->
          <div class="section-title">NEC 690.8 — Module Electrical Calculations</div>
          <table class="equip-table">
            <thead><tr><th>Parameter</th><th>Nameplate</th><th>×1.25 NEC Factor</th><th>Result</th></tr></thead>
            <tbody>
              <tr><td>Voc (Open Circuit)</td><td>${voc} V</td><td>×1.25 (temp. correction)</td><td><strong>${vocMax} V max</strong></td></tr>
              <tr><td>Isc (Short Circuit)</td><td>${isc} A</td><td>×1.25 (NEC 690.8(A))</td><td><strong>${iscMax} A max</strong></td></tr>
              <tr><td>Vmp (Operating)</td><td>${vmp} V</td><td>×1.0</td><td>${vmp} V</td></tr>
              <tr><td>Imp (Operating)</td><td>${imp} A</td><td>×1.0</td><td>${imp} A</td></tr>
            </tbody>
          </table>
        </div>

        <div class="col-right">
          <!-- Inverter Datasheet Summary -->
          <div class="section-title">Inverter — Specifications</div>
          ${system.inverters?.map((inv, i) => `
          <div style="border:1px solid #ccc;;overflow:hidden;margin-bottom:10px;">
            <div class=\"sec-hdr-dark\">
              Inverter #${i+1}: ${inv.manufacturer} ${inv.model}
            </div>
            <table class="info-table" style="margin:0;">
              <tr><td class="il">Type</td><td class="iv">${inv.type === 'micro' ? 'MICROINVERTER' : inv.type === 'optimizer' ? 'POWER OPTIMIZER' : inv.type?.toUpperCase() || 'STRING'}</td></tr>
              <tr><td class="il">AC Output</td><td class="iv">${Number(inv.acOutputKw).toFixed(2)} kW</td></tr>
              <tr><td class="il">Max DC Voltage</td><td class="iv">${inv.maxDcVoltage} V</td></tr>
              <tr><td class="il">Efficiency (CEC)</td><td class="iv">${inv.efficiency}%</td></tr>
              <tr><td class="il">UL Listing</td><td class="iv">${inv.ulListing || 'UL 1741'}</td></tr>
              <tr><td class="il">Grid Standards</td><td class="iv">IEEE 1547-2018, UL 1741 SA</td></tr>
              <tr><td class="il">Anti-Islanding</td><td class="iv">Yes — Per IEEE 1547</td></tr>
              <tr><td class="il">Rapid Shutdown</td><td class="iv">NEC 690.12 Compliant</td></tr>
              <tr><td class="il">MPPT Channels</td><td class="iv">${inv.strings?.length || 1}</td></tr>
            </table>
          </div>
          `).join('') || '<p style="font-size:9px;color:#999">No inverter data</p>'}

          <!-- Racking System Summary -->
          <div class=\"section-title\">Racking System</div>
          <table class="info-table">
            <tr><td class="il">System</td><td class="iv">${(project as any)._canonical?.mountSystem || project.mountingSystem || MOUNT_SYSTEM_MAP[cad.systemType as CanonicalSysType] || 'IronRidge XR100'}</td></tr>
            <tr><td class="il">Material</td><td class="iv">6105-T5 Anodized Aluminum</td></tr>
            <tr><td class="il">Rail Profile</td><td class="iv">2.25" × 1.50" Heavy Duty</td></tr>
            <tr><td class="il">Max Span</td><td class="iv">72" (1829mm)</td></tr>
            ${_isRoof ? '<tr><td class=\\\"il\\\">Attachment</td><td class=\\\"iv\\\">FlashFoot2 with L-Foot</td></tr>' : ''}
            ${_isRoof ? '<tr><td class=\\\"il\\\">Lag Bolt</td><td class=\\\"iv\\\">5/16\\\" × 3\\\" Stainless Steel</td></tr>' : ''}
            ${_isRoof ? '<tr><td class=\\\"il\\\">Embedment</td><td class=\\\"iv\\\">Min. 2.5\\\" into rafter</td></tr>' : _isFence ? '<tr><td class=\\\"il\\\">Post Type</td><td class=\\\"iv\\\">Steel Pipe / HSS</td></tr>' : '<tr><td class=\\\"il\\\">Pile Type</td><td class=\\\"iv\\\">Driven Pile / Helical Pier</td></tr>'}
            <tr><td class="il">UL Listing</td><td class="iv">UL 2703 / ICC-ES AC428</td></tr>
            <tr><td class="il">Wind Rating</td><td class="iv">Per ASCE 7-22 (see PV-4C)</td></tr>
          </table>

          <!-- Spec Sheet Links Note -->
          <div style="background:#fff;border:1px solid #000;padding:6px;margin-top:6px;font-size:8.5px;color:#000;line-height:1.5;">
            <strong>Manufacturer Data Sheets</strong><br>
            Full manufacturer specification sheets and installation manuals are available at:<br>
            • <strong>Module:</strong> ${modMfr} — see manufacturer website<br>
            • <strong>Inverter:</strong> ${invMfr} — see manufacturer website<br>
            • <strong>Racking:</strong> ${(project as any)._canonical?.mountSystem || MOUNT_SYSTEM_MAP[cad.systemType as CanonicalSysType] || 'IronRidge XR100'} — STRUCTURAL CALCULATIONS — SEE PV-4C<br><br>
            All equipment is CEC Listed, UL Listed, and approved for grid interconnection.
            Copies available upon AHJ request.
          </div>
        </div>
      </div>
    </div>
  </div>`;
}




