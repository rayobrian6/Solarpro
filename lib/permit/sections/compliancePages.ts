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
import { getMountingSystemById } from '@/lib/mounting-hardware-db';
import { SOLAR_PANELS, MICROINVERTERS, STRING_INVERTERS, BATTERIES } from '@/lib/equipment-db';
import { getManufacturerAsset } from '@/lib/manufacturer-assets-db';

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

  // Label current must describe the CIRCUIT the label is on. For a micro/AC
  // system the point-of-interconnection current is the aggregate rated AC
  // output — printing one module's DC Isc×1.25 (8.2A) on a ~77A system was a
  // plan-check red flag. String systems keep the DC source-circuit value.
  const _acOutA = ((system.totalAcKw || 0) * 1000) / 240;
  const maxCircuitCurrent = (isMicro && _acOutA > 0 ? _acOutA : panelIsc * 1.25).toFixed(1);
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
      placement: isMicro
        ? 'At the point of interconnection / AC disconnect'
        : 'On combiner box and at DC disconnect',
      lines: isMicro ? [
        // NEC 690.54 point-of-interconnection label — rated AC values
        'SOLAR ELECTRIC SYSTEM CONNECTED',
        `RATED AC OUTPUT CURRENT: ${maxCircuitCurrent}A`,
        'NOMINAL OPERATING AC VOLTAGE: 240V',
      ] : [
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
      // Code-mandated placard text per NEC 690.56(C) \u2014 the previous
      // checkbox-style wording was invented and matched no code language.
      necRef: necVer === '2023' ? 'NEC 690.12(D) / 690.56(C)' : 'NEC 690.56(C)',
      placement: 'At rapid shutdown initiation device (service entrance)',
      lines: [
        'SOLAR PV SYSTEM IS EQUIPPED WITH',
        'RAPID SHUTDOWN',
        'TURN RAPID SHUTDOWN SWITCH TO THE "OFF" POSITION',
        'TO SHUT DOWN PV SYSTEM AND REDUCE',
        'SHOCK HAZARD IN THE ARRAY',
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
      necRef: 'NEC 705.12 / 705.10',
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
      necRef: 'IFC \u00a71204 / NEC 690.56(A)',
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
        `Capacity: ${hasBattery ? ((project.batteryCount || 1) * (project.batteryKwh ?? 5.0)).toFixed(1) : '0.0'} kWh TOTAL`,
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
      // NEC 705.10 has required a power-source directory plaque since well
      // before the 2023 cycle — gating it to 2023 left it off most sets.
      required: true,
    },
    {
      id: 'L-12',
      necRef: 'NEC 690.13(B)',
      placement: 'On each PV system disconnecting means',
      lines: [
        'PHOTOVOLTAIC SYSTEM DISCONNECT',
        'LINE AND LOAD TERMINALS',
        'MAY BE ENERGIZED IN THE OPEN POSITION',
      ],
      bg: '#cc0000',
      fg: '#ffffff',
      required: true,
    },
    {
      id: 'L-13',
      necRef: necVer === '2023' ? 'NEC 690.12(D)' : 'NEC 690.56(C)(3)',
      placement: 'At the rapid shutdown switch',
      lines: [
        'RAPID SHUTDOWN SWITCH',
        'FOR SOLAR PV SYSTEM',
      ],
      bg: '#cc0000',
      fg: '#ffffff',
      required: project.rapidShutdown,
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
      <div class="sec-hdr-dark" style="margin-bottom:4px;\\">
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
            <div style="margin-bottom:2px;">5. Maintain fire access per IFC \u00a71204.2.1: 36" access pathways and the ridge setback shown on PV-2 (18" permitted only where array \u2264 33% of roof area).</div>
          </div>
        </div>
      </div>

      <!-- Inspection Hold Points -->
      <div class="sec-hdr-dark" style="margin-bottom:4px;\\">
        INSPECTION HOLD POINTS
      </div>
      <table class="equip-table">
        <thead><tr><th style="width:6%;">#</th><th style="width:22%;">Inspection Point</th><th style="width:42%;">Verification Requirements</th><th style="width:15%;">Code Reference</th><th style="width:15%;text-align:center;">Inspector</th></tr></thead>
        <tbody>
          <tr><td class="fw9 mono">1</td><td class="fw7">Rough Electrical</td><td>Verify conductor sizing, conduit routing, grounding connections, junction box accessibility</td><td class="mono" style="font-size:8px;">NEC 690, 250</td><td class="center">\u25a1</td></tr>
          <tr class=\"bg-lt\"><td class=\"fw9 mono\">2</td><td class=\"fw7\">${_isRoof ? 'Structural / Roof' : _isFence ? 'Structural / Fence' : 'Structural / Ground Mount'}</td><td>${_isRoof ? 'Verify attachment to structural members, lag bolt embedment, flashing installation, rail alignment' : _isFence ? 'Verify fence post embedment depth, concrete footing pour, post plumb/alignment, and module mounting' : 'Verify pile embedment, ground clearance, tilt angle, and module mounting'}</td><td class=\"mono\" style=\"font-size:8px;\">IBC Ch. 16, IRC R301</td><td class=\"center\">\u25a1</td></tr>\n
          <tr><td class="fw9 mono">3</td><td class="fw7">Module Installation</td><td>Verify module mounting, clamp torque, bonding connections, setback compliance</td><td class="mono" style="font-size:8px;">UL 2703, IFC §1204</td><td class="center">\u25a1</td></tr>
          <tr class="bg-lt"><td class="fw9 mono">4</td><td class="fw7">Final Electrical</td><td>Verify labeling, rapid shutdown, disconnect operation, grounding continuity, Voc/Isc verification</td><td class="mono" style="font-size:8px;">NEC 690.12, 690.54</td><td class="center">\u25a1</td></tr>
          <tr><td class="fw9 mono">5</td><td class="fw7">Utility Interconnection</td><td>Verify meter configuration, net metering enrollment, anti-islanding test (if required by AHJ)</td><td class="mono" style="font-size:8px;">IEEE 1547, NEC 705</td><td class="center">\u25a1</td></tr>
        </tbody>
      </table>

      <div class=\"sec-hdr-dark\" style=\"margin-bottom:4px;\">
        LABEL SCHEDULE &mdash; ALL LABELS
      </div>
      ${(() => {
        // Two side-by-side half tables — the single full-width table ran 81px
        // past the page bottom once a battery made all 13 labels applicable.
        const _row = (lbl: typeof labels[number], idx: number) =>
          `<tr style="${!lbl.required ? 'opacity:0.45;' : ''}background:${idx % 2 === 0 ? '#fff' : '#f5f5f5'};">` +
          `<td class="fw9 mono">${lbl.id}</td>` +
          `<td style="font-family:monospace;font-size:7px;">${lbl.necRef}</td>` +
          `<td style="text-align:center;font-weight:900;font-family:monospace;">${lbl.required ? 'YES' : 'N/A'}</td>` +
          `<td style="font-size:8px;">${lbl.placement}</td>` +
          `</tr>`;
        const _head = `<thead><tr>` +
          `<th style="width:10%;">LABEL</th>` +
          `<th style="width:24%;">CODE REF</th>` +
          `<th style="width:9%;text-align:center;">REQ'D</th>` +
          `<th>PLACEMENT LOCATION</th>` +
          `</tr></thead>`;
        const _half = Math.ceil(labels.length / 2);
        const _tbl = (ls: typeof labels) =>
          `<table class="equip-table" style="margin:0;">${_head}<tbody>${ls.map(_row).join('')}</tbody></table>`;
        return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--xs);align-items:start;">` +
          `${_tbl(labels.slice(0, _half))}${_tbl(labels.slice(_half))}</div>`;
      })()}

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

  // REAL datasheet records from equipment-db (fuzzy model match) — the sheet
  // previously ESTIMATED Vmp (Voc×0.83), derived Imp, and hardcoded the temp
  // coefficients + NOCT while the DB carries the manufacturer values.
  const _dbFind = <T extends { model: string }>(list: T[], model?: string): T | undefined => {
    const m = (model || '').toLowerCase().trim();
    if (!m) return undefined;
    return list.find(e => e.model.toLowerCase() === m)
      ?? list.find(e => e.model.toLowerCase().includes(m) || m.includes(e.model.toLowerCase()));
  };
  const _dbPanel = _dbFind(SOLAR_PANELS, panels?.panelModel);
  const _dbMicro = system.inverters?.[0]?.type === 'micro'
    ? _dbFind(MICROINVERTERS, system.inverters?.[0]?.model) : undefined;

  // Get specs from the spec sheet DB
  const voc = panels?.panelVoc || project.panelVoc || _dbPanel?.voc || 41.6;
  const isc = panels?.panelIsc || project.panelIsc || _dbPanel?.isc || 12.26;
  const pmax = modWatts;
  // Vmp/Imp: manufacturer values when the DB record resolves; otherwise the
  // nameplate-consistent estimate (Vmp≈Voc×0.83, Imp=Pmax/Vmp).
  const vmp = _dbPanel?.vmp ?? parseFloat((voc * 0.83).toFixed(1));
  const imp = _dbPanel?.imp ?? parseFloat((pmax / vmp).toFixed(2));
  const tempCoeff = _dbPanel?.tempCoeffPmax ?? -0.35;
  // Physical dims: project override → resolved equipment-db record → generic
  // default. Falling straight to the 66"×40" default made a 440W module read
  // 25.8% efficiency (physically impossible for silicon; the DB carries the real
  // 67.8"×44.6"). The real datasheet dims also match what PV-1 draws (module
  // width is derived from design pitch ~44.5"), so this tightens cross-sheet
  // consistency rather than loosening it.
  const panelLen = project.panelLengthIn || _dbPanel?.length || 66;
  const panelWid = project.panelWidthIn || _dbPanel?.width  || 40;
  const panelWt  = project.panelWeightLbs || _dbPanel?.weight || 44;
  // Module efficiency = manufacturer/CEC datasheet value when the DB record
  // resolves; only fall back to the geometric estimate (Pmax ÷ area) when it
  // doesn't. Back-computing from the drawn footprint is what produced the
  // impossible 25.8% (real 22.57%).
  const moduleEff = _dbPanel?.efficiency ?? (pmax / (panelLen / 39.37 * panelWid / 39.37)) / 10;

  // NEC 690.7/690.8 calculations — cold Voc uses the exact NEC 690.7(A)
  // formula with the project design-low temp (same input the SLD/engines
  // use), matching the compatibility gate. The old blanket ×1.25 printed a
  // 62.3 V "max" beside a 60 V inverter DC limit on the same sheet.
  const VOC_TEMP_COEFF = _dbPanel?.tempCoeffVoc ?? -0.27;  // %/°C — manufacturer value when resolved; matches the printed spec row
  const designTempMinC = project.designTempMin ?? -10;
  const vocColdFactor = 1 + (VOC_TEMP_COEFF / 100) * (designTempMinC - 25);
  const NEC_SAFETY = 1.25;
  const vocMax = parseFloat((voc * vocColdFactor).toFixed(1));
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
            <tr><td class="il">Temp. Coeff. Voc</td><td class="iv">${VOC_TEMP_COEFF}%/°C</td></tr>
            <tr><td class="il">NOCT</td><td class="iv">${_dbPanel?.nominalOperatingTemp ?? 45}°C ±2°C</td></tr>
            <tr><td class="il">Module Efficiency</td><td class="iv">${moduleEff.toFixed(1)}%</td></tr>
          </table>
          <div style="font-size:7px;color:#555;margin:-2px 0 4px 0;">Vmp/Imp and temperature coefficients are typical values — verify against the manufacturer's certified datasheet before construction.</div>

          <div class="section-title">PV Module — Physical Specifications</div>
          <table class="info-table" style="margin-bottom:6px;">
            <tr><td class="il">Length</td><td class="iv">${panelLen}" (${(panelLen*25.4).toFixed(0)}mm)</td></tr>
            <tr><td class="il">Width</td><td class="iv">${panelWid}" (${(panelWid*25.4).toFixed(0)}mm)</td></tr>
            <tr><td class="il">Weight</td><td class="iv">${panelWt} lbs (${(panelWt*0.453592).toFixed(1)} kg)</td></tr>
            <tr><td class="il">Front Load</td><td class="iv">5400 Pa (Wind/Snow)</td></tr>
            <tr><td class="il">Rear Load</td><td class="iv">2400 Pa</td></tr>
            <tr><td class="il">Cell Type</td><td class="iv">${_dbPanel ? `${_dbPanel.cellType}${_dbPanel.bifacial ? ' — Bifacial' : ''}` : 'Monocrystalline PERC / TOPCon'}</td></tr>
            <tr><td class="il">Frame</td><td class="iv">Anodized Aluminum Alloy</td></tr>
            <tr><td class="il">Connector</td><td class="iv">MC4 Compatible</td></tr>
            <tr><td class="il">UL Listing</td><td class="iv">${_dbPanel?.ulListing || 'UL 61730 / IEC 61215'}</td></tr>
          </table>

          ${_dbPanel ? `
          <div class="section-title">PV Module — Datasheet Reference</div>
          <table class="info-table" style="margin-bottom:6px;">
            <tr><td class="il">Max System Voltage</td><td class="iv">${_dbPanel.maxSystemVoltage} V DC</td></tr>
            <tr><td class="il">Max Series Fuse Rating</td><td class="iv">${_dbPanel.maxSeriesFuseRating} A</td></tr>
            <tr><td class="il">Temp. Coeff. Isc</td><td class="iv">+${_dbPanel.tempCoeffIsc}%/°C</td></tr>
            <tr><td class="il">Module Thickness</td><td class="iv">${_dbPanel.thickness}" (${(_dbPanel.thickness * 25.4).toFixed(0)}mm)</td></tr>
            <tr><td class="il">Product Warranty</td><td class="iv">${_dbPanel.warranty}</td></tr>
            <tr><td class="il">Source</td><td class="iv">Manufacturer datasheet — copies available upon AHJ request</td></tr>
          </table>` : ''}

          <!-- NEC 690.8 Calculations from module specs -->
          <div class="section-title">NEC 690.8 — Module Electrical Calculations</div>
          <table class="equip-table">
            <thead><tr><th>Parameter</th><th>Nameplate</th><th>NEC Factor</th><th>Result</th></tr></thead>
            <tbody>
              <tr><td>Voc (Open Circuit)</td><td>${voc} V</td><td>×${vocColdFactor.toFixed(3)} (NEC 690.7 @ ${designTempMinC}°C)</td><td><strong>${vocMax} V max</strong></td></tr>
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
              <tr><td class="il">MPPT Channels</td><td class="iv">${topologyToLegacy(getInverterTopology(input, cad)) === 'MICRO' ? 'Per-module MPPT (microinverter)' : (inv.strings?.length || 1)}</td></tr>
            </table>
            ${(() => {
              // NEC 690.7 sanity at the DATA level — this sheet used to print
              // a module Voc ABOVE the inverter's max DC input on the same
              // page with no flag (electrically impossible pairing shipping
              // silently). Micro topologies skipped every upstream Voc check.
              const _mVoc = Number(vocMax); // cold-corrected per NEC 690.7 — raw Voc can pass while the corrected value exceeds the limit
              const _mMax = Number(inv.maxDcVoltage);
              const _warns: string[] = [];
              if (isFinite(_mVoc) && isFinite(_mMax) && _mMax > 0 && _mVoc > _mMax) {
                _warns.push(`cold-corrected module Voc (${_mVoc} V per NEC 690.7 @ ${designTempMinC}°C) exceeds this inverter's maximum DC input voltage (${_mMax} V)`);
              }
              // Per-module overpower on micros — a 600 W module on a ~350 W-AC
              // micro (DC/AC 1.7) is beyond every manufacturer pairing range
              // and shipped silently as "31 kW DC / 18 kW AC".
              const _mAcW = Number(inv.acOutputKw) * 1000;
              if (inv.type === 'micro' && isFinite(_mAcW) && _mAcW > 0 && pmax / _mAcW > 1.55) {
                _warns.push(`module STC power (${pmax} W) is ${(pmax / _mAcW).toFixed(2)}× this microinverter's AC rating (${Math.round(_mAcW)} W) — beyond the manufacturer's pairing range (≤1.55×); expect sustained clipping`);
              }
              return _warns.length ? `
            <div style="border:2px solid #cc0000;background:#fff5f5;padding:4px 6px;margin-top:3px;font-size:8px;line-height:1.4;color:#cc0000;font-weight:700;">
              ⚠ EQUIPMENT COMPATIBILITY — VERIFY BEFORE CONSTRUCTION: ${_warns.join('; ')}.
              Confirm the module/inverter pairing per NEC 690.7 and both manufacturers' compatibility lists;
              correct the equipment selection if this reflects the actual design.
            </div>` : '';
            })()}
          </div>
          `).join('') || '<p style="font-size:9px;color:#999">No inverter data</p>'}

          ${_dbMicro ? `
          <div class="section-title">Microinverter — Datasheet Reference</div>
          <table class="info-table" style="margin-bottom:6px;">
            <tr><td class="il">Peak AC Output</td><td class="iv">${_dbMicro.acOutputW} VA</td></tr>
            <tr><td class="il">Max Continuous Output Current</td><td class="iv">${_dbMicro.acOutputCurrentMax} A @ ${_dbMicro.acOutputVoltage} V</td></tr>
            <tr><td class="il">DC Input Power (Module STC Max)</td><td class="iv">${_dbMicro.dcInputWMax} W</td></tr>
            <tr><td class="il">MPPT Voltage Range</td><td class="iv">${_dbMicro.mpptVoltageMin}–${_dbMicro.mpptVoltageMax} V</td></tr>
            <tr><td class="il">Max DC Input Current</td><td class="iv">${_dbMicro.maxInputCurrent} A</td></tr>
            ${_dbMicro.maxPerBranch20A ? `<tr><td class="il">Max Units / 20A Branch</td><td class="iv">${_dbMicro.maxPerBranch20A}</td></tr>` : ''}
            <tr><td class="il">CEC Weighted Efficiency</td><td class="iv">${_dbMicro.cec_efficiency}%</td></tr>
            <tr><td class="il">Rapid Shutdown</td><td class="iv">${_dbMicro.rapidShutdownCompliant ? 'Integrated — NEC 690.12 MLRS' : 'External MLRS required'}</td></tr>
            <tr><td class="il">Unit Weight</td><td class="iv">${_dbMicro.weight} lbs</td></tr>
            <tr><td class="il">Product Warranty</td><td class="iv">${_dbMicro.warranty}</td></tr>
          </table>` : ''}

          <!-- Racking System Summary — from the SELECTED mounting system.
               The old static table printed IronRidge FlashFoot2 / 5/16" lag
               specs on every package regardless of the racking actually
               specified on PV-3 (two racking systems in one permit). -->
          ${(() => {
            const _mSel = project.mountingSystemId ? getMountingSystemById(project.mountingSystemId) : undefined;
            const _sysName = project._canonical?.mountSystem || project.mountingSystem
              || (_mSel ? `${_mSel.manufacturer} ${_mSel.model}` : '')
              || MOUNT_SYSTEM_MAP[cad.systemType as CanonicalSysType] || 'IronRidge XR100';
            const _fr = (v: number) =>
              v === 0.25 ? '1/4' : v === 0.3125 ? '5/16' : v === 0.375 ? '3/8' : v === 0.5 ? '1/2' : `${v}`;
            const _lagDia = _mSel?.mount?.fastenerDiameterIn ?? 0.375;
            const _embed  = _mSel?.mount?.fastenerEmbedmentIn ?? 2.5;
            const _lagLen = Math.ceil((_embed + 1.5) * 2) / 2;
            return `
          <div class="section-title">Racking System</div>
          <table class="info-table">
            <tr><td class="il">System</td><td class="iv">${_sysName}</td></tr>
            <tr><td class="il">Material</td><td class="iv">${_mSel?.rail?.materialAlloy || 'Aluminum — per manufacturer listing'}</td></tr>
            <tr><td class="il">Rail Profile</td><td class="iv">${_mSel?.rail ? `${_mSel.rail.model} (${_mSel.rail.heightIn}" × ${_mSel.rail.widthIn}")` : (_mSel ? 'Rail-less / direct-attach' : 'Per manufacturer')}</td></tr>
            <tr><td class="il">Max Attach Spacing</td><td class="iv">${(() => {
              // Engineering-resolved spacing first (same chain as PV-3/PE-1) —
              // the racking's rated 48" printed here beside PV-3's resolved 24".
              const _spc = input.compliance?.structural?.attachment?.maxAllowedSpacing
                || (project.attachmentSpacing as number | undefined)
                || _mSel?.mount?.maxSpacingIn;
              return _spc ? `${_spc}" O.C.` : 'Per PV-3 / structural calc';
            })()}</td></tr>
            ${_isRoof ? `<tr><td class="il">Attachment</td><td class="iv">${_mSel?.mount?.model || 'Per PV-3 attachment detail'}</td></tr>` : ''}
            ${_isRoof ? `<tr><td class="il">Lag Bolt</td><td class="iv">${_fr(_lagDia)}" DIA × ${_lagLen}" Min. Stainless Steel</td></tr>` : ''}
            ${_isRoof ? `<tr><td class="il">Embedment</td><td class="iv">Min. ${_embed}" thread embedment into rafter</td></tr>` : _isFence ? '<tr><td class="il">Post Type</td><td class="iv">Steel Pipe / HSS</td></tr>' : '<tr><td class="il">Pile Type</td><td class="iv">Driven Pile / Helical Pier</td></tr>'}
            <tr><td class="il">UL Listing</td><td class="iv">${_mSel?.mount?.ul2703Listed === false ? 'See manufacturer listing' : 'UL 2703'}${_mSel?.mount?.iccEsReport ? ` / ${_mSel.mount.iccEsReport}` : ''}</td></tr>
            <tr><td class="il">Wind Rating</td><td class="iv">Per ASCE 7-22 (see PV-4C)</td></tr>
          </table>`;
          })()}

          <!-- Spec Sheet Links Note — real manufacturer documents on file (manufacturer_assets library) -->
          ${(() => {
            // Resolve the actual sourced manufacturer datasheet/detail per selected
            // equipment id, and cite the real document (title · page · source). Falls
            // back to a generic "see manufacturer website" line when none on file.
            const _fuzz = <T extends { model: string; id: string }>(list: T[], model?: string): T | undefined => {
              const m = (model || '').toLowerCase().trim(); if (!m) return undefined;
              return list.find(e => e.model.toLowerCase() === m)
                ?? list.find(e => e.model.toLowerCase().includes(m) || m.includes(e.model.toLowerCase()));
            };
            const _inv0 = system.inverters?.[0];
            const _invId = _dbMicro?.id
              ?? _fuzz(STRING_INVERTERS, _inv0?.model)?.id
              ?? _fuzz(MICROINVERTERS, _inv0?.model)?.id;
            const _batId = _fuzz(BATTERIES, (project._canonical as { battery?: { model?: string } })?.battery?.model
              || (project as { batteryModel?: string }).batteryModel)?.id;
            const _cite = (label: string, a: ReturnType<typeof getManufacturerAsset>): string => {
              if (!a || (!a.sourceUrl && !a.imageUrl)) return '';
              const host = a.sourceUrl ? (() => { try { return new URL(a.sourceUrl!).hostname.replace(/^www\./, ''); } catch { return ''; } })() : '';
              const bits = [a.docTitle, a.pageRef, host].filter(Boolean).join(' · ');
              const mark = a.verified ? '✓ on file' : 'on file';
              return `<li><strong>${label}:</strong> ${a.brand} ${a.model} — ${bits || 'manufacturer datasheet'} <span style="color:#0a7a2f;font-weight:700;">(${mark})</span></li>`;
            };
            const rows = [
              _cite('Module', getManufacturerAsset(_dbPanel?.id, 'module_spec')),
              _cite('Inverter', getManufacturerAsset(_invId, 'inverter_spec') || getManufacturerAsset(_invId, 'microinverter_spec') || getManufacturerAsset(_invId, 'optimizer_spec')),
              _cite('Battery', getManufacturerAsset(_batId, 'battery_spec')),
              _cite('Racking', getManufacturerAsset(project.mountingSystemId, 'racking_detail')),
            ].filter(Boolean);
            const fallback = `• <strong>Module:</strong> ${modMfr} — see manufacturer website<br>• <strong>Inverter:</strong> ${invMfr} — see manufacturer website<br>`;
            return `
          <div style="background:#fff;border:1px solid #000;padding:6px;margin-top:6px;font-size:8.5px;color:#000;line-height:1.5;">
            <strong>Manufacturer Data Sheets — On File</strong><br>
            The following manufacturer specification sheets / installation details are on file for this project and available upon AHJ request:
            ${rows.length ? `<ul style="margin:3px 0 4px 0;padding-left:16px;">${rows.join('')}</ul>` : `<br>${fallback}`}
            <strong>Racking structural calculations — SEE PV-4C.</strong><br>
            All equipment is CEC Listed, UL Listed, and approved for grid interconnection.
          </div>`;
          })()}
        </div>
      </div>
    </div>
  </div>`;
}




