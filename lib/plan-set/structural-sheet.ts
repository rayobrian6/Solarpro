// ============================================================
// lib/plan-set/structural-sheet.ts
// Plan Set Sheet S-1: Structural Engineering
// Includes: roof loading calcs, wind/snow analysis (ASCE 7-22),
// attachment schedule, rafter analysis, fire setbacks diagram
// ============================================================

import { wrapPage, escHtml, type TitleBlockData } from './title-block';

export interface StructuralSheetInput {
  tb: TitleBlockData;

  // Site
  stateCode:          string;
  city:               string;
  county:             string;
  address:            string;

  // Roof
  roofType:           string;   // 'shingle' | 'tile' | 'metal_standing_seam' | etc.
  roofPitchDeg:       number;
  roofPitchRatio:     string;   // e.g. "4:12"
  rafterSize:         string;   // e.g. "2×6"
  rafterSpacingIn:    number;   // e.g. 24
  rafterSpanFt:       number;   // e.g. 16
  rafterSpecies:      string;   // e.g. "Douglas Fir-Larch #2"
  sheathingType:      string;   // e.g. "7/16&quot; OSB"
  stories:            number;

  // Loads (ASCE 7-22)
  windSpeedMph:       number;
  windExposureCategory: string; // 'B' | 'C' | 'D'
  groundSnowPsf:      number;
  flatRoofSnowPsf:    number;
  seismicCategory:    string;
  importance:         string;   // 'I' | 'II' | 'III' | 'IV'

  // Panel
  panelWeightLbs:     number;   // per panel
  panelCount:         number;
  panelLengthIn:      number;
  panelWidthIn:       number;
  panelThicknessIn:   number;

  // Mounting
  mountingSystem:     string;
  railWeightLbsPerFt: number;
  attachmentType:     string;   // e.g. "Lag Bolt to Rafter"
  lagBoltSize:        string;   // e.g. "5/16&quot; × 3&quot;"
  lagBoltSpacingFt:   number;
  flashingType:       string;

  // Calculated loads
  panelDeadLoadPsf:   number;
  mountingDeadLoadPsf:number;
  totalDeadLoadPsf:   number;
  existingDeadLoadPsf:number;
  liveLoadPsf:        number;
  snowLoadPsf:        number;
  windUpliftPsf:      number;
  windDownPsf:        number;
  governingLoadPsf:   number;
  rafterCapacityPsf:  number;
  structuralStatus:   string;   // 'PASS' | 'FAIL' | 'REVIEW'

  // Fire setbacks
  ridgeSetbackIn:     number;
  eaveSetbackIn:      number;
  valleySetbackIn:    number;
  pathwayWidthIn:     number;
  pathwayRequired:    boolean;
  setbackCodeRef:     string;
}

export function buildStructuralSheet(inp: StructuralSheetInput): string {
  const totalArrayWeight = inp.panelWeightLbs * inp.panelCount;
  const panelAreaSqFt = (inp.panelLengthIn * inp.panelWidthIn) / 144;
  const totalArrayAreaSqFt = panelAreaSqFt * inp.panelCount;
  const statusColor = inp.structuralStatus === 'PASS' ? '#1a7a1a' : inp.structuralStatus === 'FAIL' ? '#c00' : '#e6a817';

  const content = `
    <!-- Sheet Header -->
    <div class="sheet-header">
      <div>
        <div class="sh-title">STRUCTURAL ENGINEERING — ROOF LOADING &amp; ATTACHMENT ANALYSIS</div>
        <div class="sh-sub">${escHtml(inp.roofType)} · ${escHtml(inp.roofPitchRatio)} Pitch · ${escHtml(inp.rafterSize)} @ ${inp.rafterSpacingIn}" O.C. · ASCE 7-22</div>
      </div>
      <div class="sh-badge">S-1 STRUCTURAL</div>
    </div>

    <div class="three-col" style="gap:10px; margin-top:4px;">

      <!-- COLUMN 1: Site & Roof Data -->
      <div>
        <div class="section-header">Site &amp; Roof Parameters</div>
        <table>
          <tr><td style="color:#555; width:50%;">State / City</td><td>${escHtml(inp.stateCode)} / ${escHtml(inp.city)}</td></tr>
          <tr><td style="color:#555;">Roof Type</td><td>${escHtml(inp.roofType)}</td></tr>
          <tr><td style="color:#555;">Roof Pitch</td><td>${escHtml(inp.roofPitchRatio)} (${inp.roofPitchDeg.toFixed(1)}°)</td></tr>
          <tr><td style="color:#555;">Stories</td><td>${inp.stories}</td></tr>
          <tr><td style="color:#555;">Rafter Size</td><td>${escHtml(inp.rafterSize)}</td></tr>
          <tr><td style="color:#555;">Rafter Spacing</td><td>${inp.rafterSpacingIn}" O.C.</td></tr>
          <tr><td style="color:#555;">Rafter Span</td><td>${inp.rafterSpanFt.toFixed(1)} ft</td></tr>
          <tr><td style="color:#555;">Rafter Species</td><td>${escHtml(inp.rafterSpecies)}</td></tr>
          <tr><td style="color:#555;">Sheathing</td><td>${escHtml(inp.sheathingType)}</td></tr>
        </table>

        <div class="section-header" style="margin-top:8px;">Environmental Loads (ASCE 7-22)</div>
        <table>
          <tr><td style="color:#555; width:50%;">Wind Speed</td><td><strong>${inp.windSpeedMph} mph</strong> (3-sec gust)</td></tr>
          <tr><td style="color:#555;">Exposure Category</td><td>${escHtml(inp.windExposureCategory)}</td></tr>
          <tr><td style="color:#555;">Ground Snow Load</td><td>${inp.groundSnowPsf} psf</td></tr>
          <tr><td style="color:#555;">Flat Roof Snow Load</td><td>${inp.flatRoofSnowPsf.toFixed(1)} psf</td></tr>
          <tr><td style="color:#555;">Seismic Design Cat.</td><td>${escHtml(inp.seismicCategory)}</td></tr>
          <tr><td style="color:#555;">Risk Category</td><td>${escHtml(inp.importance)}</td></tr>
        </table>

        <div class="section-header" style="margin-top:8px;">Panel &amp; Array Data</div>
        <table>
          <tr><td style="color:#555; width:50%;">Panel Count</td><td>${inp.panelCount}</td></tr>
          <tr><td style="color:#555;">Panel Weight</td><td>${inp.panelWeightLbs} lbs each</td></tr>
          <tr><td style="color:#555;">Panel Size</td><td>${inp.panelLengthIn}" × ${inp.panelWidthIn}"</td></tr>
          <tr><td style="color:#555;">Panel Area</td><td>${panelAreaSqFt.toFixed(1)} ft² each</td></tr>
          <tr><td style="color:#555;">Total Array Area</td><td>${totalArrayAreaSqFt.toFixed(1)} ft²</td></tr>
          <tr><td style="color:#555;">Total Array Weight</td><td><strong>${totalArrayWeight.toFixed(0)} lbs</strong></td></tr>
        </table>
      </div>

      <!-- COLUMN 2: Load Analysis -->
      <div>
        <div class="section-header">Load Analysis Summary</div>
        <table>
          <thead>
            <tr>
              <th>Load Type</th>
              <th style="text-align:right;">Value (psf)</th>
              <th style="text-align:right;">Reference</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Existing Roof Dead Load</td>
              <td style="text-align:right;">${inp.existingDeadLoadPsf.toFixed(1)}</td>
              <td style="text-align:right; font-size:5.5pt;">ASCE 7-22 §3.1</td>
            </tr>
            <tr>
              <td>PV Panel Dead Load</td>
              <td style="text-align:right;">${inp.panelDeadLoadPsf.toFixed(2)}</td>
              <td style="text-align:right; font-size:5.5pt;">Mfr. Spec</td>
            </tr>
            <tr>
              <td>Mounting System Dead Load</td>
              <td style="text-align:right;">${inp.mountingDeadLoadPsf.toFixed(2)}</td>
              <td style="text-align:right; font-size:5.5pt;">Mfr. Spec</td>
            </tr>
            <tr style="background:#e8f5e8;">
              <td><strong>Total Dead Load (D)</strong></td>
              <td style="text-align:right;"><strong>${inp.totalDeadLoadPsf.toFixed(2)}</strong></td>
              <td style="text-align:right; font-size:5.5pt;">D = DL + SDL</td>
            </tr>
            <tr>
              <td>Roof Live Load (Lr)</td>
              <td style="text-align:right;">${inp.liveLoadPsf.toFixed(1)}</td>
              <td style="text-align:right; font-size:5.5pt;">ASCE 7-22 §4.3</td>
            </tr>
            <tr>
              <td>Snow Load (S)</td>
              <td style="text-align:right;">${inp.snowLoadPsf.toFixed(1)}</td>
              <td style="text-align:right; font-size:5.5pt;">ASCE 7-22 §7</td>
            </tr>
            <tr>
              <td>Wind Uplift (W↑)</td>
              <td style="text-align:right;">${inp.windUpliftPsf.toFixed(1)}</td>
              <td style="text-align:right; font-size:5.5pt;">ASCE 7-22 §26-30</td>
            </tr>
            <tr>
              <td>Wind Downward (W↓)</td>
              <td style="text-align:right;">${inp.windDownPsf.toFixed(1)}</td>
              <td style="text-align:right; font-size:5.5pt;">ASCE 7-22 §26-30</td>
            </tr>
            <tr style="background:#e8edf5;">
              <td><strong>Governing Load Combination</strong></td>
              <td style="text-align:right;"><strong>${inp.governingLoadPsf.toFixed(2)}</strong></td>
              <td style="text-align:right; font-size:5.5pt;">ASCE 7-22 §2.3</td>
            </tr>
            <tr style="background:#e8f5e8;">
              <td><strong>Rafter Capacity</strong></td>
              <td style="text-align:right;"><strong>${inp.rafterCapacityPsf.toFixed(2)}</strong></td>
              <td style="text-align:right; font-size:5.5pt;">NDS 2018</td>
            </tr>
          </tbody>
        </table>

        <!-- Status Box -->
        <div style="margin-top:8px; padding:8px; border:2px solid ${statusColor}; border-radius:4px; background:${inp.structuralStatus === 'PASS' ? '#f0fff0' : inp.structuralStatus === 'FAIL' ? '#fff0f0' : '#fffbf0'}; text-align:center;">
          <div style="font-size:14pt; font-weight:bold; color:${statusColor};">
            ${inp.structuralStatus === 'PASS' ? '✓ STRUCTURAL PASS' : inp.structuralStatus === 'FAIL' ? '✗ STRUCTURAL FAIL' : '⚠ REVIEW REQUIRED'}
          </div>
          <div style="font-size:7pt; color:#555; margin-top:3px;">
            Governing Load: ${inp.governingLoadPsf.toFixed(2)} psf ≤ Rafter Capacity: ${inp.rafterCapacityPsf.toFixed(2)} psf
            ${inp.structuralStatus === 'PASS' ? `(DCR = ${(inp.governingLoadPsf / inp.rafterCapacityPsf).toFixed(2)})` : '— EXCEEDS CAPACITY'}
          </div>
        </div>

        <!-- Load Combinations -->
        <div class="section-header" style="margin-top:8px;">ASCE 7-22 Load Combinations</div>
        <div style="font-size:6pt; line-height:1.7; padding:4px 6px; background:#f7f8fc; border:0.5px solid #ccd;">
          <div>1.4D = ${(inp.totalDeadLoadPsf * 1.4).toFixed(2)} psf</div>
          <div>1.2D + 1.6L + 0.5(Lr or S) = ${(inp.totalDeadLoadPsf * 1.2 + inp.liveLoadPsf * 1.6 + inp.snowLoadPsf * 0.5).toFixed(2)} psf</div>
          <div>1.2D + 1.6(Lr or S) + L = ${(inp.totalDeadLoadPsf * 1.2 + inp.snowLoadPsf * 1.6 + inp.liveLoadPsf).toFixed(2)} psf</div>
          <div>1.2D + 1.0W + L + 0.5(Lr or S) = ${(inp.totalDeadLoadPsf * 1.2 + inp.windDownPsf + inp.liveLoadPsf + inp.snowLoadPsf * 0.5).toFixed(2)} psf</div>
          <div>0.9D + 1.0W (uplift) = ${(inp.totalDeadLoadPsf * 0.9 - inp.windUpliftPsf).toFixed(2)} psf</div>
          <div style="font-weight:bold; color:#1a3a6b;">Governing: ${inp.governingLoadPsf.toFixed(2)} psf</div>
        </div>
      </div>

      <!-- COLUMN 3: Attachment + Fire Setbacks -->
      <div>
        <div class="section-header">Attachment Schedule</div>
        <table>
          <tr><td style="color:#555; width:50%;">Mounting System</td><td>${escHtml(inp.mountingSystem)}</td></tr>
          <tr><td style="color:#555;">Attachment Type</td><td>${escHtml(inp.attachmentType)}</td></tr>
          <tr><td style="color:#555;">Lag Bolt Size</td><td>${escHtml(inp.lagBoltSize)}</td></tr>
          <tr><td style="color:#555;">Lag Bolt Spacing</td><td>${inp.lagBoltSpacingFt.toFixed(1)} ft O.C.</td></tr>
          <tr><td style="color:#555;">Flashing Type</td><td>${escHtml(inp.flashingType)}</td></tr>
          <tr><td style="color:#555;">Rail Spacing</td><td>Per mfr. layout</td></tr>
        </table>

        <div class="note-box" style="margin-top:6px;">
          All lag bolts shall be installed into rafter/structural members only. Minimum embedment: 2.5" into rafter. Pre-drill pilot hole to prevent splitting. Apply sealant per flashing manufacturer requirements.
        </div>

        <!-- Fire Setbacks -->
        <div class="section-header" style="margin-top:8px;">Fire Access Setbacks (IRC R324.4)</div>
        <table>
          <tr><td style="color:#555; width:55%;">Ridge Setback</td><td><strong>${inp.ridgeSetbackIn}"</strong></td></tr>
          <tr><td style="color:#555;">Eave Setback</td><td><strong>${inp.eaveSetbackIn}"</strong></td></tr>
          <tr><td style="color:#555;">Valley Setback</td><td><strong>${inp.valleySetbackIn}"</strong></td></tr>
          <tr><td style="color:#555;">Pathway Width</td><td><strong>${inp.pathwayWidthIn}"</strong></td></tr>
          <tr><td style="color:#555;">Pathway Required</td><td>${inp.pathwayRequired ? '✓ Yes' : '✗ No'}</td></tr>
          <tr><td style="color:#555;">Code Reference</td><td>${escHtml(inp.setbackCodeRef)}</td></tr>
        </table>

        <!-- Setback Diagram -->
        <div class="section-header" style="margin-top:8px;">Setback Diagram (Schematic)</div>
        ${buildSetbackDiagram(inp)}

        <!-- Structural Notes -->
        <div class="section-header" style="margin-top:8px;">Structural Notes</div>
        <div style="font-size:6pt; line-height:1.6;">
          ${STRUCTURAL_NOTES.map((n, i) => `<div style="margin-bottom:2px;"><strong>${i+1}.</strong> ${n}</div>`).join('')}
        </div>
      </div>

    </div>
  `;

  return wrapPage(content, inp.tb);
}

// ─── Setback Diagram SVG ─────────────────────────────────────────────────────
function buildSetbackDiagram(inp: StructuralSheetInput): string {
  return `
  <svg viewBox="0 0 200 120" xmlns="http://www.w3.org/2000/svg" style="width:100%; height:100px; border:0.5px solid #ccd; border-radius:2px; background:#f7f8fc;">
    <!-- Roof outline -->
    <polygon points="100,10 180,80 20,80" fill="none" stroke="#555" stroke-width="1.5"/>
    <!-- Ridge label -->
    <text x="100" y="8" text-anchor="middle" font-size="6" fill="#555">Ridge</text>
    <!-- Eave label -->
    <text x="100" y="88" text-anchor="middle" font-size="6" fill="#555">Eave</text>
    <!-- Ridge setback line -->
    <line x1="60" y1="28" x2="140" y2="28" stroke="#c00" stroke-width="1" stroke-dasharray="3,2"/>
    <text x="145" y="31" font-size="5" fill="#c00">${inp.ridgeSetbackIn}"</text>
    <!-- Eave setback line -->
    <line x1="30" y1="70" x2="170" y2="70" stroke="#c00" stroke-width="1" stroke-dasharray="3,2"/>
    <text x="172" y="73" font-size="5" fill="#c00">${inp.eaveSetbackIn}"</text>
    <!-- Panel array area -->
    <rect x="62" y="30" width="76" height="38" fill="#ffd700" fill-opacity="0.4" stroke="#e6a817" stroke-width="1"/>
    <text x="100" y="52" text-anchor="middle" font-size="6" fill="#7a5000" font-weight="bold">PV Array</text>
    <!-- Pathway (if required) -->
    ${inp.pathwayRequired ? `
    <line x1="100" y1="10" x2="100" y2="80" stroke="#1a3a6b" stroke-width="2" stroke-dasharray="4,2"/>
    <text x="103" y="45" font-size="5" fill="#1a3a6b">${inp.pathwayWidthIn}" path</text>
    ` : ''}
    <!-- Dimension arrows -->
    <line x1="20" y1="85" x2="180" y2="85" stroke="#333" stroke-width="0.8"/>
    <text x="100" y="93" text-anchor="middle" font-size="5.5" fill="#333">Roof Width (schematic)</text>
    <!-- Code ref -->
    <text x="100" y="108" text-anchor="middle" font-size="5" fill="#555">${escHtml(inp.setbackCodeRef)}</text>
  </svg>`;
}

// ─── Structural Notes ─────────────────────────────────────────────────────────
const STRUCTURAL_NOTES = [
  'Structural analysis per ASCE 7-22 and NDS 2018. Rafter capacity based on species, grade, span, and spacing.',
  'Wind loads calculated per ASCE 7-22 Chapter 26-30 using component and cladding (C&C) method.',
  'Snow loads per ASCE 7-22 Chapter 7. Flat roof snow load: Pf = 0.7 × Ce × Ct × Is × Pg.',
  'Lag bolt withdrawal capacity per NDS 2018 Table 12.2A. Minimum 2.5" embedment into rafter required.',
  'Contractor shall verify rafter size, spacing, and span in field prior to installation.',
  'If field conditions differ from plan, contact engineer of record before proceeding.',
];