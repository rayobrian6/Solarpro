// ============================================================
// lib/plan-set/equipment-schedule.ts
// Plan Set Sheet E-2: Equipment Schedule
// Full bill of materials with cut sheet references,
// UL listing numbers, and installation notes
// ============================================================

import { wrapPage, escHtml, type TitleBlockData } from './title-block';

export interface EquipmentItem {
  tag:          string;    // e.g. "PV-1"
  category:     string;    // e.g. "Solar Panel"
  description:  string;
  manufacturer: string;
  model:        string;
  quantity:     number;
  unit:         string;    // "EA", "FT", "LF", etc.
  specs:        string;    // key specs
  ulListing?:   string;    // UL listing number
  cutSheet?:    string;    // reference to cut sheet
  notes?:       string;
}

export interface EquipmentScheduleInput {
  tb: TitleBlockData;

  // System summary
  systemKw:     number;
  panelCount:   number;
  stateCode:    string;
  necVersion:   string;

  // Equipment items
  items:        EquipmentItem[];

  // Electrical summary (for reference)
  dcWireGauge:  string;
  acWireGauge:  string;
  groundWireGauge: string;
  dcConduitType: string;
  acConduitType: string;
  dcDisconnectAmps: number;
  acDisconnectAmps: number;
  acBreakerAmps: number;
  backfeedBreakerAmps: number;
  mainPanelBusAmps: number;
}

export function buildEquipmentSchedule(inp: EquipmentScheduleInput): string {
  // Group items by category
  const categories = Array.from(new Set(inp.items.map(i => i.category)));

  const content = `
    <!-- Sheet Header -->
    <div class="sheet-header">
      <div>
        <div class="sh-title">EQUIPMENT SCHEDULE &amp; BILL OF MATERIALS</div>
        <div class="sh-sub">${inp.systemKw.toFixed(2)} kW DC · ${inp.panelCount} Panels · ${escHtml(inp.necVersion)}</div>
      </div>
      <div class="sh-badge">E-2 EQUIPMENT</div>
    </div>

    <div class="two-col" style="gap:10px; margin-top:4px;">

      <!-- LEFT: Equipment Schedule -->
      <div style="grid-column: 1 / -1;">
        <div class="section-header">Equipment Schedule</div>
        <table>
          <thead>
            <tr>
              <th style="width:5%;">Tag</th>
              <th style="width:12%;">Category</th>
              <th style="width:20%;">Description</th>
              <th style="width:14%;">Manufacturer</th>
              <th style="width:14%;">Model</th>
              <th style="width:4%;">Qty</th>
              <th style="width:4%;">Unit</th>
              <th style="width:15%;">Key Specifications</th>
              <th style="width:8%;">UL Listing</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            ${categories.map(cat => {
              const catItems = inp.items.filter(i => i.category === cat);
              return `
              <tr>
                <td colspan="10" style="background:#1a3a6b; color:#fff; font-weight:bold; font-size:6.5pt; padding:2px 6px; text-transform:uppercase; letter-spacing:0.5px;">
                  ${escHtml(cat)}
                </td>
              </tr>
              ${catItems.map(item => `
              <tr>
                <td><strong>${escHtml(item.tag)}</strong></td>
                <td>${escHtml(item.category)}</td>
                <td>${escHtml(item.description)}</td>
                <td>${escHtml(item.manufacturer)}</td>
                <td style="font-size:6pt;">${escHtml(item.model)}</td>
                <td style="text-align:center;">${item.quantity}</td>
                <td style="text-align:center;">${escHtml(item.unit)}</td>
                <td style="font-size:6pt;">${escHtml(item.specs)}</td>
                <td style="font-size:6pt;">${escHtml(item.ulListing || '—')}</td>
                <td style="font-size:6pt;">${escHtml(item.notes || '')}</td>
              </tr>`).join('')}`;
            }).join('')}
          </tbody>
        </table>
      </div>

    </div>

    <!-- Bottom section: Electrical summary + Installation notes -->
    <div class="two-col" style="gap:10px; margin-top:8px;">

      <!-- Electrical Summary -->
      <div>
        <div class="section-header">Electrical Summary</div>
        <table>
          <thead>
            <tr>
              <th style="width:35%;">Component</th>
              <th style="width:30%;">Specification</th>
              <th>NEC Reference</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>DC Source Circuit Wire</td><td>${escHtml(inp.dcWireGauge)} THWN-2</td><td>NEC 690.8(B)</td></tr>
            <tr><td>DC Conduit</td><td>${escHtml(inp.dcConduitType)}</td><td>NEC 690.31</td></tr>
            <tr><td>DC Disconnect</td><td>${inp.dcDisconnectAmps}A / 600VDC</td><td>NEC 690.15</td></tr>
            <tr><td>AC Output Wire</td><td>${escHtml(inp.acWireGauge)} THWN-2</td><td>NEC 690.8(B)</td></tr>
            <tr><td>AC Conduit</td><td>${escHtml(inp.acConduitType)}</td><td>NEC 690.31</td></tr>
            <tr><td>AC Disconnect</td><td>${inp.acDisconnectAmps}A / 240VAC</td><td>NEC 690.14</td></tr>
            <tr><td>AC Breaker (at inverter)</td><td>${inp.acBreakerAmps}A</td><td>NEC 690.9</td></tr>
            <tr><td>Backfeed Breaker</td><td>${inp.backfeedBreakerAmps}A</td><td>NEC 705.12(B)</td></tr>
            <tr><td>Main Panel Bus</td><td>${inp.mainPanelBusAmps}A</td><td>NEC 705.12(B)</td></tr>
            <tr><td>Equipment Ground Wire</td><td>${escHtml(inp.groundWireGauge)} bare Cu</td><td>NEC 250.122</td></tr>
          </tbody>
        </table>
      </div>

      <!-- Installation Notes -->
      <div>
        <div class="section-header">Installation Notes</div>
        <div style="font-size:6.5pt; line-height:1.6;">
          ${INSTALLATION_NOTES.map((n, i) => `
          <div style="display:flex; gap:4px; margin-bottom:3px;">
            <span style="font-weight:bold; color:#1a3a6b; min-width:14px;">${i+1}.</span>
            <span>${n}</span>
          </div>`).join('')}
        </div>

        <div class="section-header" style="margin-top:8px;">Cut Sheet References</div>
        <div style="font-size:6.5pt; line-height:1.6; color:#555;">
          <div>All equipment cut sheets shall be submitted with permit application.</div>
          <div>Equipment substitutions require written approval from engineer of record.</div>
          <div>All equipment shall be listed and labeled per applicable UL standards.</div>
          <div style="margin-top:4px; font-style:italic;">
            Cut sheets available from manufacturer websites or upon request from contractor.
          </div>
        </div>
      </div>

    </div>
  `;

  return wrapPage(content, inp.tb);
}

// ─── Default equipment builder ────────────────────────────────────────────────
export function buildDefaultEquipmentItems(params: {
  panelCount:         number;
  panelModel:         string;
  panelWatts:         number;
  panelManufacturer:  string;
  inverterType:       string;
  inverterModel:      string;
  inverterManufacturer: string;
  inverterCount:      number;
  mountingSystem:     string;
  mountingManufacturer: string;
  hasBattery:         boolean;
  batteryModel?:      string;
  batteryManufacturer?: string;
  batteryCount?:      number;
  batteryKwh?:        number;
  dcWireGauge:        string;
  acWireGauge:        string;
  groundWireGauge:    string;
  dcConduitType:      string;
  acConduitType:      string;
  dcDisconnectAmps:   number;
  acDisconnectAmps:   number;
  acBreakerAmps:      number;
  backfeedBreakerAmps: number;
  rapidShutdownDevice?: string;
  stringCount:        number;
}): EquipmentItem[] {
  const items: EquipmentItem[] = [];

  // Solar Panels
  items.push({
    tag: 'PV-1',
    category: 'Solar Panels',
    description: `${params.panelWatts}W Monocrystalline PV Module`,
    manufacturer: params.panelManufacturer || 'See Cut Sheet',
    model: params.panelModel,
    quantity: params.panelCount,
    unit: 'EA',
    specs: `${params.panelWatts}W STC, Mono PERC, 25yr warranty`,
    ulListing: 'UL 61730',
    notes: 'Install per mfr. instructions',
  });

  // Inverter
  const invDesc = params.inverterType === 'micro'
    ? 'Microinverter'
    : params.inverterType === 'optimizer'
    ? 'Power Optimizer + String Inverter'
    : 'String Inverter';
  items.push({
    tag: 'INV-1',
    category: 'Inverter',
    description: invDesc,
    manufacturer: params.inverterManufacturer || 'See Cut Sheet',
    model: params.inverterModel,
    quantity: params.inverterCount,
    unit: 'EA',
    specs: 'Grid-tied, 240VAC output, CEC listed',
    ulListing: 'UL 1741',
    notes: 'Install per mfr. instructions. Rapid shutdown compliant.',
  });

  // Mounting
  items.push({
    tag: 'MNT-1',
    category: 'Mounting System',
    description: 'Roof Mount Racking System',
    manufacturer: params.mountingManufacturer || 'See Cut Sheet',
    model: params.mountingSystem,
    quantity: 1,
    unit: 'LOT',
    specs: 'Aluminum rails, stainless hardware, ICC-ES listed',
    ulListing: 'ICC-ES AC428',
    notes: 'Lag bolts to rafters @ spacing per S-1',
  });

  // DC Disconnect
  items.push({
    tag: 'DC-DISC',
    category: 'Electrical — DC',
    description: 'DC Disconnect Switch',
    manufacturer: 'Midnite Solar / Equivalent',
    model: `${params.dcDisconnectAmps}A / 600VDC`,
    quantity: 1,
    unit: 'EA',
    specs: `${params.dcDisconnectAmps}A, 600VDC, NEMA 3R`,
    ulListing: 'UL 98B',
    notes: 'NEC 690.15 — within sight of inverter',
  });

  // AC Disconnect
  items.push({
    tag: 'AC-DISC',
    category: 'Electrical — AC',
    description: 'AC Disconnect Switch',
    manufacturer: 'Square D / Equivalent',
    model: `${params.acDisconnectAmps}A / 240VAC`,
    quantity: 1,
    unit: 'EA',
    specs: `${params.acDisconnectAmps}A, 240VAC, NEMA 3R`,
    ulListing: 'UL 98',
    notes: 'NEC 690.14 — utility-accessible location',
  });

  // AC Breaker
  items.push({
    tag: 'BKR-1',
    category: 'Electrical — AC',
    description: 'AC Overcurrent Protection Breaker',
    manufacturer: 'Square D / Equivalent',
    model: `${params.acBreakerAmps}A 2-pole`,
    quantity: 1,
    unit: 'EA',
    specs: `${params.acBreakerAmps}A, 240VAC, 2-pole`,
    ulListing: 'UL 489',
    notes: 'NEC 690.9 — at inverter AC output',
  });

  // Backfeed Breaker
  items.push({
    tag: 'BKR-2',
    category: 'Electrical — AC',
    description: 'Backfeed Breaker (at Main Panel)',
    manufacturer: 'Square D / Equivalent',
    model: `${params.backfeedBreakerAmps}A 2-pole`,
    quantity: 1,
    unit: 'EA',
    specs: `${params.backfeedBreakerAmps}A, 240VAC, 2-pole`,
    ulListing: 'UL 489',
    notes: 'NEC 705.12(B) — labeled "Solar PV System"',
  });

  // DC Wire
  items.push({
    tag: 'WIRE-DC',
    category: 'Wiring & Conduit',
    description: `DC Source Circuit Wire — ${params.dcWireGauge} THWN-2`,
    manufacturer: 'Southwire / Equivalent',
    model: `${params.dcWireGauge} THWN-2 600V`,
    quantity: params.stringCount * 2,
    unit: 'RUNS',
    specs: '90°C, sunlight resistant, 600V',
    ulListing: 'UL 44',
    notes: 'NEC 690.31 — in conduit',
  });

  // AC Wire
  items.push({
    tag: 'WIRE-AC',
    category: 'Wiring & Conduit',
    description: `AC Output Wire — ${params.acWireGauge} THWN-2`,
    manufacturer: 'Southwire / Equivalent',
    model: `${params.acWireGauge} THWN-2 600V`,
    quantity: 1,
    unit: 'RUN',
    specs: '90°C, 600V',
    ulListing: 'UL 44',
    notes: 'NEC 690.8(B)',
  });

  // DC Conduit
  items.push({
    tag: 'COND-DC',
    category: 'Wiring & Conduit',
    description: `DC Conduit — ${params.dcConduitType}`,
    manufacturer: 'Allied / Equivalent',
    model: params.dcConduitType,
    quantity: 1,
    unit: 'LOT',
    specs: 'Sunlight resistant, UV rated',
    ulListing: 'UL 651',
    notes: 'NEC 690.31',
  });

  // AC Conduit
  items.push({
    tag: 'COND-AC',
    category: 'Wiring & Conduit',
    description: `AC Conduit — ${params.acConduitType}`,
    manufacturer: 'Allied / Equivalent',
    model: params.acConduitType,
    quantity: 1,
    unit: 'LOT',
    specs: 'EMT or PVC as noted',
    ulListing: 'UL 797',
    notes: 'NEC 690.31',
  });

  // Ground wire
  items.push({
    tag: 'GND-1',
    category: 'Wiring & Conduit',
    description: `Equipment Ground Wire — ${params.groundWireGauge} bare Cu`,
    manufacturer: 'Southwire / Equivalent',
    model: `${params.groundWireGauge} bare copper`,
    quantity: 1,
    unit: 'LOT',
    specs: 'Bare copper, 600V',
    ulListing: 'UL 44',
    notes: 'NEC 250.122, NEC 690.47',
  });

  // Rapid Shutdown
  if (params.rapidShutdownDevice) {
    items.push({
      tag: 'RSD-1',
      category: 'Safety',
      description: 'Rapid Shutdown Initiation Device',
      manufacturer: 'See Cut Sheet',
      model: params.rapidShutdownDevice,
      quantity: 1,
      unit: 'EA',
      specs: 'NEC 690.12 compliant, listed',
      ulListing: 'UL 1741',
      notes: 'Mount at utility meter per AHJ',
    });
  }

  // Battery
  if (params.hasBattery && params.batteryModel) {
    items.push({
      tag: 'BAT-1',
      category: 'Battery Storage',
      description: 'Battery Energy Storage System',
      manufacturer: params.batteryManufacturer || 'See Cut Sheet',
      model: params.batteryModel,
      quantity: params.batteryCount || 1,
      unit: 'EA',
      specs: `${params.batteryKwh?.toFixed(1) || '?'} kWh usable, AC-coupled`,
      ulListing: 'UL 9540',
      notes: 'NEC 705.12(B) — dedicated breaker required',
    });
  }

  return items;
}

// ─── Installation Notes ───────────────────────────────────────────────────────
const INSTALLATION_NOTES = [
  'All equipment shall be installed per manufacturer\'s installation instructions and applicable codes.',
  'All electrical equipment shall be listed and labeled by a nationally recognized testing laboratory (NRTL).',
  'Substitutions require written approval from the engineer of record prior to installation.',
  'All conductors shall be copper. Minimum temperature rating: 90°C (THWN-2 or USE-2).',
  'All outdoor equipment shall be rated NEMA 3R minimum. Equipment in wet locations: NEMA 4X.',
  'Conduit fill shall not exceed NEC Chapter 9 Table 1 limits.',
  'All equipment shall be labeled per NEC 690.54 (PV system) and NEC 705.10 (interactive system).',
  'Inverter shall be labeled with maximum AC output current and operating voltage.',
];