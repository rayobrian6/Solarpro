// ============================================================
// lib/plan-set/mounting-details-sheet.ts
// Plan Set Sheet M-1: Mounting Details (v44.0)
// Includes: rail profile, flashing detail, rail splice,
// bonding clip, grounding lug, lag bolt engagement,
// module clamp detail, wire management.
// ============================================================

import { wrapPage, escHtml, type TitleBlockData } from './title-block';

export interface MountingDetailsSheetInput {
  tb: TitleBlockData;

  // Project
  siteAddress:      string;
  city:             string;
  state:            string;

  // Mounting system
  mountingSystem:   string;   // e.g. "IronRidge XR-100 Rail"
  railType:         string;   // e.g. "IronRidge XR-100" or "Generic L-Foot Rail"
  flashingType:     string;   // e.g. "SnapNrack Flashing" or "Custom Sheet Metal"
  lagBoltSize:      string;   // e.g. "5/16&quot; × 3&quot;"
  lagBoltSpacingFt: number;
  attachmentType:   string;   // e.g. "L-Foot with Flashing"

  // Module
  panelModel:       string;
  panelLengthIn:    number;
  panelWidthIn:     number;
  panelThicknessIn: number;
  panelFrameHeight: number;  // frame depth in mm, e.g. 35

  // Roof
  roofType:         string;
  rafterSize:       string;
  sheathingType:    string;

  // Grounding
  groundWireGauge:  string;
  bondingHardware:  string;   // e.g. "WEEB Clips" or "UL 2703 bonding hardware"
}

export function buildMountingDetailsSheet(inp: MountingDetailsSheetInput): string {
  const content = `
    <!-- Sheet Header -->
    <div class="sheet-header">
      <div>
        <div class="sh-title">MOUNTING &amp; ATTACHMENT DETAILS</div>
        <div class="sh-sub">${escHtml(inp.siteAddress)}, ${escHtml(inp.city)}, ${escHtml(inp.state)} · ${escHtml(inp.mountingSystem)} · ${escHtml(inp.roofType)} Roof</div>
      </div>
      <div class="sh-badge">M-1 MOUNTING</div>
    </div>

    <!-- Top Row: 3 detail diagrams -->
    <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; margin-top:6px;">

      <!-- Detail 1: Rail Cross-Section -->
      <div>
        <div class="section-header">Detail 1 — Rail Cross-Section</div>
        ${buildRailCrossSectionDetail(inp)}
        <div style="font-size:5.5pt; line-height:1.5; margin-top:3px; padding:3px 5px; background:#f7f8fc; border:0.5px solid #ccd; border-radius:2px;">
          <strong>Rail:</strong> ${escHtml(inp.railType)}<br>
          Material: 6063-T6 Aluminum alloy<br>
          Finish: Mill / anodized<br>
          Listing: UL 2703 / ICC-ES<br>
          Note: Rail shall be continuous from end-to-end with splice per Detail 3.
        </div>
      </div>

      <!-- Detail 2: Flashing & L-Foot Detail -->
      <div>
        <div class="section-header">Detail 2 — Flashing &amp; L-Foot</div>
        ${buildFlashingLFootDetail(inp)}
        <div style="font-size:5.5pt; line-height:1.5; margin-top:3px; padding:3px 5px; background:#f7f8fc; border:0.5px solid #ccd; border-radius:2px;">
          <strong>Flashing:</strong> ${escHtml(inp.flashingType)}<br>
          <strong>Lag bolt:</strong> ${escHtml(inp.lagBoltSize)}, HDG or SS<br>
          Embedment: 2.5" min into rafter<br>
          Pilot hole: 7/32" dia. pre-drill<br>
          Sealant: Butyl tape under flashing
        </div>
      </div>

      <!-- Detail 3: Rail Splice -->
      <div>
        <div class="section-header">Detail 3 — Rail Splice</div>
        ${buildRailSpliceDetail(inp)}
        <div style="font-size:5.5pt; line-height:1.5; margin-top:3px; padding:3px 5px; background:#f7f8fc; border:0.5px solid #ccd; border-radius:2px;">
          Rail splice: stagger joints between adjacent rails.<br>
          Min 6" overlap at splice.<br>
          Splice shall not occur within 6" of module end clamp.<br>
          Splice hardware per rail manufacturer specification.
        </div>
      </div>

    </div>

    <!-- Bottom Row: 3 more details -->
    <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; margin-top:8px;">

      <!-- Detail 4: Module Clamp & Frame -->
      <div>
        <div class="section-header">Detail 4 — Module Clamp</div>
        ${buildModuleClampDetail(inp)}
        <div style="font-size:5.5pt; line-height:1.5; margin-top:3px; padding:3px 5px; background:#f7f8fc; border:0.5px solid #ccd; border-radius:2px;">
          Module frame: ${inp.panelFrameHeight}mm depth<br>
          End &amp; mid clamps: per mfr. table<br>
          Torque: per manufacturer spec (typically 8–10 ft·lbs)<br>
          Module: ${escHtml(inp.panelModel)}<br>
          Size: ${inp.panelLengthIn}" × ${inp.panelWidthIn}"
        </div>
      </div>

      <!-- Detail 5: Bonding Clip / WEEB -->
      <div>
        <div class="section-header">Detail 5 — Bonding &amp; Grounding</div>
        ${buildBondingGroundingDetail(inp)}
        <div style="font-size:5.5pt; line-height:1.5; margin-top:3px; padding:3px 5px; background:#f7f8fc; border:0.5px solid #ccd; border-radius:2px;">
          Bonding: ${escHtml(inp.bondingHardware)}<br>
          EGC: ${escHtml(inp.groundWireGauge)} bare Cu<br>
          Grounding lug at each rail section<br>
          NEC 690.43 / NEC 250.122<br>
          UL 2703 listed bonding hardware req'd
        </div>
      </div>

      <!-- Detail 6: Wire Management -->
      <div>
        <div class="section-header">Detail 6 — Wire Management</div>
        ${buildWireManagementDetail(inp)}
        <div style="font-size:5.5pt; line-height:1.5; margin-top:3px; padding:3px 5px; background:#f7f8fc; border:0.5px solid #ccd; border-radius:2px;">
          Module leads: USE-2 / PV Wire<br>
          Bundle and secure with UV-resistant ties<br>
          Min 3" clearance from roof surface<br>
          No sharp edges against wire jacket<br>
          NEC 690.31 — wiring methods
        </div>
      </div>

    </div>

    <!-- General Mounting Notes -->
    <div style="margin-top:8px; border-top:1px solid #ccd; padding-top:6px;">
      <div class="section-header">General Mounting Notes</div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
        <div style="font-size:6pt; line-height:1.65;">
          ${MOUNTING_NOTES_LEFT.map((n, i) => `<div style="margin-bottom:2px;"><strong>${i+1}.</strong> ${n}</div>`).join('')}
        </div>
        <div style="font-size:6pt; line-height:1.65;">
          ${MOUNTING_NOTES_RIGHT.map((n, i) => `<div style="margin-bottom:2px;"><strong>${i + MOUNTING_NOTES_LEFT.length + 1}.</strong> ${n}</div>`).join('')}
        </div>
      </div>
    </div>
  `;

  return wrapPage(content, inp.tb);
}

// ─── Detail 1: Rail Cross-Section ─────────────────────────────────────────────
function buildRailCrossSectionDetail(_inp: MountingDetailsSheetInput): string {
  return `
  <svg viewBox="0 0 180 140" xmlns="http://www.w3.org/2000/svg" style="width:100%; height:130px; border:0.5px solid #ccd; border-radius:2px; background:#fafbff;">

    <!-- Rail outer body (hat channel / C-channel profile) -->
    <!-- Bottom flange -->
    <rect x="30" y="85" width="120" height="10" fill="#b8c4d8" stroke="#1a3a6b" stroke-width="1.2"/>
    <!-- Left web -->
    <rect x="30" y="45" width="14" height="40" fill="#b8c4d8" stroke="#1a3a6b" stroke-width="1.2"/>
    <!-- Right web -->
    <rect x="136" y="45" width="14" height="40" fill="#b8c4d8" stroke="#1a3a6b" stroke-width="1.2"/>
    <!-- Top flanges (lips) -->
    <rect x="30" y="45" width="35" height="10" fill="#c8d4e8" stroke="#1a3a6b" stroke-width="1.2"/>
    <rect x="115" y="45" width="35" height="10" fill="#c8d4e8" stroke="#1a3a6b" stroke-width="1.2"/>

    <!-- T-bolt slot -->
    <rect x="65" y="45" width="50" height="8" fill="#1a3a6b" fill-opacity="0.15" stroke="#1a3a6b" stroke-width="0.8" stroke-dasharray="2,1"/>
    <text x="90" y="52" text-anchor="middle" font-size="5.5" fill="#1a3a6b" font-weight="bold">T-slot</text>

    <!-- Module frame sitting on rail -->
    <rect x="55" y="28" width="70" height="20" fill="#dde8ff" stroke="#5577aa" stroke-width="1" rx="1"/>
    <text x="90" y="41" text-anchor="middle" font-size="5.5" fill="#5577aa">Module Frame</text>

    <!-- Mid clamp -->
    <rect x="82" y="22" width="16" height="28" fill="none" stroke="#c00" stroke-width="1" stroke-dasharray="2,1"/>
    <text x="90" y="19" text-anchor="middle" font-size="5" fill="#c00">Mid clamp</text>

    <!-- Dimensions -->
    <!-- Rail width -->
    <line x1="30" y1="106" x2="150" y2="106" stroke="#555" stroke-width="0.6"/>
    <polygon points="30,104 35,106 30,108" fill="#555"/>
    <polygon points="150,104 145,106 150,108" fill="#555"/>
    <text x="90" y="114" text-anchor="middle" font-size="5.5" fill="#555">~1.66" wide</text>

    <!-- Rail height -->
    <line x1="158" y1="45" x2="158" y2="95" stroke="#555" stroke-width="0.6"/>
    <polygon points="156,45 158,50 160,45" fill="#555"/>
    <polygon points="156,95 158,90 160,95" fill="#555"/>
    <text x="165" y="73" font-size="5.5" fill="#555">~1.33"</text>

    <!-- Material label -->
    <text x="90" y="128" text-anchor="middle" font-size="5.5" fill="#555">6063-T6 Aluminum Extrusion</text>
    <text x="90" y="136" text-anchor="middle" font-size="5" fill="#777">UL 2703 Listed</text>

  </svg>`;
}

// ─── Detail 2: Flashing & L-Foot ──────────────────────────────────────────────
function buildFlashingLFootDetail(inp: MountingDetailsSheetInput): string {
  return `
  <svg viewBox="0 0 180 140" xmlns="http://www.w3.org/2000/svg" style="width:100%; height:130px; border:0.5px solid #ccd; border-radius:2px; background:#fafbff;">

    <!-- Roof sheathing -->
    <rect x="10" y="90" width="160" height="12" fill="#c8a870" stroke="#8b4513" stroke-width="1" rx="1"/>
    <text x="90" y="99" text-anchor="middle" font-size="5" fill="#8b4513">${escHtml(inp.sheathingType)}</text>

    <!-- Shingle layers -->
    <rect x="10" y="70" width="70" height="12" fill="#777" stroke="#555" stroke-width="0.8" rx="1"/>
    <rect x="50" y="60" width="110" height="12" fill="#888" stroke="#555" stroke-width="0.8" rx="1"/>
    <rect x="10" y="79" width="165" height="12" fill="#999" stroke="#555" stroke-width="0.8" rx="1"/>

    <!-- Flashing plate -->
    <rect x="62" y="52" width="56" height="28" fill="#aaa" stroke="#1a3a6b" stroke-width="1.2" rx="1"/>
    <text x="90" y="62" text-anchor="middle" font-size="5.5" fill="#1a3a6b" font-weight="bold">Flashing</text>
    <text x="90" y="70" text-anchor="middle" font-size="5" fill="#333">${escHtml(inp.flashingType)}</text>

    <!-- Butyl sealant indicator -->
    <line x1="62" y1="78" x2="118" y2="78" stroke="#e6a817" stroke-width="2" stroke-dasharray="2,1"/>
    <text x="90" y="87" text-anchor="middle" font-size="4.5" fill="#a06000">butyl sealant</text>

    <!-- L-Foot / standoff -->
    <rect x="82" y="38" width="16" height="16" fill="#c8d0e0" stroke="#1a3a6b" stroke-width="1.2"/>
    <text x="90" y="48" text-anchor="middle" font-size="5" fill="#1a3a6b">L-Foot</text>

    <!-- Lag bolt -->
    <line x1="90" y1="8" x2="90" y2="100" stroke="#c00" stroke-width="2"/>
    <polygon points="90,6 86,14 94,14" fill="#c00"/>
    <text x="106" y="20" font-size="5" fill="#c00">${escHtml(inp.lagBoltSize)}</text>
    <text x="106" y="27" font-size="5" fill="#c00">HDG lag bolt</text>

    <!-- Rafter -->
    <rect x="70" y="102" width="40" height="32" fill="#deb887" stroke="#8b4513" stroke-width="1.2" rx="1"/>
    <text x="90" y="120" text-anchor="middle" font-size="5.5" fill="#8b4513">${escHtml(inp.rafterSize)}</text>

    <!-- Embedment annotation -->
    <line x1="116" y1="102" x2="116" y2="134" stroke="#c00" stroke-width="0.8"/>
    <line x1="112" y1="102" x2="120" y2="102" stroke="#c00" stroke-width="0.8"/>
    <line x1="112" y1="134" x2="120" y2="134" stroke="#c00" stroke-width="0.8"/>
    <text x="122" y="120" font-size="5" fill="#c00" font-weight="bold">2.5"</text>
    <text x="122" y="127" font-size="4.5" fill="#c00">min emb.</text>

  </svg>`;
}

// ─── Detail 3: Rail Splice ─────────────────────────────────────────────────────
function buildRailSpliceDetail(_inp: MountingDetailsSheetInput): string {
  return `
  <svg viewBox="0 0 180 140" xmlns="http://www.w3.org/2000/svg" style="width:100%; height:130px; border:0.5px solid #ccd; border-radius:2px; background:#fafbff;">

    <!-- Rail 1 (left) -->
    <rect x="15" y="55" width="75" height="18" fill="#b8c4d8" stroke="#1a3a6b" stroke-width="1.2"/>
    <rect x="15" y="48" width="75" height="8" fill="#c8d4e8" stroke="#1a3a6b" stroke-width="1"/>
    <text x="52" y="67" text-anchor="middle" font-size="5.5" fill="#1a3a6b">Rail Section A</text>

    <!-- Rail 2 (right) -->
    <rect x="90" y="55" width="75" height="18" fill="#b8c4d8" stroke="#1a3a6b" stroke-width="1.2"/>
    <rect x="90" y="48" width="75" height="8" fill="#c8d4e8" stroke="#1a3a6b" stroke-width="1"/>
    <text x="127" y="67" text-anchor="middle" font-size="5.5" fill="#1a3a6b">Rail Section B</text>

    <!-- Splice bar -->
    <rect x="68" y="50" width="44" height="14" fill="#d4a820" stroke="#8b6000" stroke-width="1.5" rx="1"/>
    <text x="90" y="59" text-anchor="middle" font-size="5.5" fill="#8b6000" font-weight="bold">Splice</text>
    <text x="90" y="67" text-anchor="middle" font-size="4.5" fill="#8b6000">6" overlap min</text>

    <!-- Splice bolts -->
    <circle cx="78" cy="57" r="3" fill="#c00" stroke="white" stroke-width="0.5"/>
    <circle cx="102" cy="57" r="3" fill="#c00" stroke="white" stroke-width="0.5"/>

    <!-- Gap annotation -->
    <line x1="88" y1="80" x2="92" y2="80" stroke="#555" stroke-width="0.8"/>
    <polygon points="88,78 85,80 88,82" fill="#555"/>
    <polygon points="92,78 95,80 92,82" fill="#555"/>
    <text x="90" y="92" text-anchor="middle" font-size="5.5" fill="#555">Expansion gap</text>
    <text x="90" y="99" text-anchor="middle" font-size="5" fill="#555">(leave 1/8" for thermal)</text>

    <!-- Overlap dimension -->
    <line x1="68" y1="38" x2="112" y2="38" stroke="#1a3a6b" stroke-width="0.8"/>
    <polygon points="68,36 72,38 68,40" fill="#1a3a6b"/>
    <polygon points="112,36 108,38 112,40" fill="#1a3a6b"/>
    <text x="90" y="34" text-anchor="middle" font-size="5.5" fill="#1a3a6b">Min 6" overlap</text>

    <!-- Stagger note -->
    <rect x="15" y="108" width="150" height="25" fill="#f7f8fc" stroke="#ccd" stroke-width="0.5" rx="2"/>
    <text x="90" y="119" text-anchor="middle" font-size="5.5" fill="#555" font-weight="bold">Stagger rail splices:</text>
    <text x="90" y="128" text-anchor="middle" font-size="5" fill="#555">Offset adjacent rail splice joints by ≥ 24"</text>

  </svg>`;
}

// ─── Detail 4: Module Clamp ────────────────────────────────────────────────────
function buildModuleClampDetail(inp: MountingDetailsSheetInput): string {
  return `
  <svg viewBox="0 0 180 140" xmlns="http://www.w3.org/2000/svg" style="width:100%; height:130px; border:0.5px solid #ccd; border-radius:2px; background:#fafbff;">

    <!-- Rail -->
    <rect x="20" y="80" width="140" height="14" fill="#b8c4d8" stroke="#1a3a6b" stroke-width="1.2"/>
    <rect x="20" y="72" width="140" height="8" fill="#c8d4e8" stroke="#1a3a6b" stroke-width="1"/>

    <!-- Module 1 (left) -->
    <rect x="25" y="45" width="58" height="30" fill="#dde8ff" stroke="#5577aa" stroke-width="1.2" rx="1"/>
    <text x="54" y="62" text-anchor="middle" font-size="5" fill="#5577aa">Module</text>
    <text x="54" y="69" text-anchor="middle" font-size="5" fill="#5577aa">${inp.panelFrameHeight}mm frame</text>

    <!-- Module 2 (right) -->
    <rect x="97" y="45" width="58" height="30" fill="#dde8ff" stroke="#5577aa" stroke-width="1.2" rx="1"/>
    <text x="126" y="62" text-anchor="middle" font-size="5" fill="#5577aa">Module</text>

    <!-- End clamp (left) -->
    <rect x="18" y="42" width="14" height="38" fill="none" stroke="#c00" stroke-width="1.2" stroke-dasharray="3,2"/>
    <text x="12" y="38" font-size="5" fill="#c00" text-anchor="middle">End</text>
    <text x="12" y="44" font-size="5" fill="#c00" text-anchor="middle">clamp</text>

    <!-- Mid clamp (center) -->
    <rect x="79" y="40" width="22" height="44" fill="none" stroke="#1a7a1a" stroke-width="1.5" stroke-dasharray="3,2"/>
    <text x="90" y="36" text-anchor="middle" font-size="5" fill="#1a7a1a" font-weight="bold">Mid clamp</text>

    <!-- End clamp (right) -->
    <rect x="148" y="42" width="14" height="38" fill="none" stroke="#c00" stroke-width="1.2" stroke-dasharray="3,2"/>
    <text x="162" y="38" font-size="5" fill="#c00" text-anchor="middle">End</text>
    <text x="162" y="44" font-size="5" fill="#c00" text-anchor="middle">clamp</text>

    <!-- T-bolt in slot -->
    <line x1="90" y1="68" x2="90" y2="80" stroke="#555" stroke-width="1.5"/>
    <rect x="85" y="80" width="10" height="6" fill="#555" rx="1"/>
    <text x="90" y="100" text-anchor="middle" font-size="5" fill="#555">T-bolt in slot</text>

    <!-- Module spacing note -->
    <line x1="83" y1="55" x2="97" y2="55" stroke="#888" stroke-width="0.8"/>
    <text x="90" y="112" text-anchor="middle" font-size="5" fill="#555">Module gap: per mfr. (typ. 1/4")</text>

    <!-- Torque note -->
    <text x="90" y="124" text-anchor="middle" font-size="5.5" fill="#1a3a6b" font-weight="bold">Torque: per mfr. spec (typ. 8–10 ft·lbs)</text>
    <text x="90" y="132" text-anchor="middle" font-size="5" fill="#777">UL 2703 listed hardware required</text>

  </svg>`;
}

// ─── Detail 5: Bonding & Grounding ────────────────────────────────────────────
function buildBondingGroundingDetail(inp: MountingDetailsSheetInput): string {
  return `
  <svg viewBox="0 0 180 140" xmlns="http://www.w3.org/2000/svg" style="width:100%; height:130px; border:0.5px solid #ccd; border-radius:2px; background:#fafbff;">

    <!-- Rail -->
    <rect x="20" y="55" width="140" height="14" fill="#b8c4d8" stroke="#1a3a6b" stroke-width="1.2"/>

    <!-- Bonding clip on rail -->
    <rect x="72" y="48" width="36" height="22" fill="#d4a820" stroke="#8b6000" stroke-width="1.5" rx="2"/>
    <text x="90" y="58" text-anchor="middle" font-size="5.5" fill="#8b6000" font-weight="bold">Bonding</text>
    <text x="90" y="66" text-anchor="middle" font-size="5" fill="#8b6000">Clip / WEEB</text>

    <!-- Grounding lug on rail -->
    <rect x="130" y="50" width="22" height="18" fill="#c8a020" stroke="#8b6000" stroke-width="1.2" rx="2"/>
    <text x="141" y="61" text-anchor="middle" font-size="5" fill="#8b6000" font-weight="bold">GND</text>
    <text x="141" y="68" text-anchor="middle" font-size="4.5" fill="#8b6000">Lug</text>

    <!-- EGC wire from grounding lug -->
    <line x1="141" y1="68" x2="141" y2="100" stroke="#2a7a2a" stroke-width="2"/>
    <!-- Ground symbol -->
    <line x1="128" y1="100" x2="154" y2="100" stroke="#2a7a2a" stroke-width="2"/>
    <line x1="132" y1="105" x2="150" y2="105" stroke="#2a7a2a" stroke-width="1.5"/>
    <line x1="136" y1="110" x2="146" y2="110" stroke="#2a7a2a" stroke-width="1.2"/>
    <text x="141" y="122" text-anchor="middle" font-size="5.5" fill="#2a7a2a" font-weight="bold">EGC</text>
    <text x="141" y="129" text-anchor="middle" font-size="5" fill="#2a7a2a">${escHtml(inp.groundWireGauge)} bare Cu</text>

    <!-- Module with bonding clip piercing anodized coating -->
    <rect x="25" y="32" width="55" height="25" fill="#dde8ff" stroke="#5577aa" stroke-width="1"/>
    <text x="52" y="47" text-anchor="middle" font-size="5" fill="#5577aa">Module frame</text>
    <!-- Bonding teeth on clip -->
    <line x1="72" y1="48" x2="80" y2="38" stroke="#8b6000" stroke-width="1"/>
    <text x="60" y="26" font-size="4.5" fill="#8b6000">Teeth pierce</text>
    <text x="60" y="32" font-size="4.5" fill="#8b6000">anodize coat</text>

    <!-- NEC reference -->
    <text x="90" y="138" text-anchor="middle" font-size="5" fill="#555">${escHtml(inp.bondingHardware)} · NEC 690.43 · UL 2703</text>

  </svg>`;
}

// ─── Detail 6: Wire Management ─────────────────────────────────────────────────
function buildWireManagementDetail(_inp: MountingDetailsSheetInput): string {
  return `
  <svg viewBox="0 0 180 140" xmlns="http://www.w3.org/2000/svg" style="width:100%; height:130px; border:0.5px solid #ccd; border-radius:2px; background:#fafbff;">

    <!-- Roof surface -->
    <rect x="10" y="100" width="160" height="12" fill="#c8a870" stroke="#8b4513" stroke-width="1"/>
    <text x="90" y="109" text-anchor="middle" font-size="5" fill="#8b4513">Roof surface</text>

    <!-- Rail above roof -->
    <rect x="20" y="75" width="140" height="12" fill="#b8c4d8" stroke="#1a3a6b" stroke-width="1.2"/>

    <!-- 3" clearance annotation -->
    <line x1="18" y1="87" x2="18" y2="100" stroke="#c00" stroke-width="0.8"/>
    <line x1="14" y1="87" x2="22" y2="87" stroke="#c00" stroke-width="0.8"/>
    <line x1="14" y1="100" x2="22" y2="100" stroke="#c00" stroke-width="0.8"/>
    <text x="8" y="95" font-size="5" fill="#c00" text-anchor="middle">3"</text>
    <text x="8" y="101" font-size="4.5" fill="#c00" text-anchor="middle">min</text>

    <!-- Wire bundle under rail -->
    <ellipse cx="90" cy="93" rx="35" ry="5" fill="#555" fill-opacity="0.3" stroke="#555" stroke-width="1"/>
    <text x="90" y="96" text-anchor="middle" font-size="5" fill="#333">Wire bundle</text>

    <!-- Wire ties -->
    <line x1="70" y1="88" x2="70" y2="100" stroke="#888" stroke-width="1"/>
    <text x="67" y="85" font-size="4.5" fill="#888" text-anchor="middle">Tie</text>
    <line x1="110" y1="88" x2="110" y2="100" stroke="#888" stroke-width="1"/>
    <text x="113" y="85" font-size="4.5" fill="#888" text-anchor="middle">Tie</text>

    <!-- Module -->
    <rect x="30" y="45" width="120" height="30" fill="#dde8ff" stroke="#5577aa" stroke-width="1" rx="1"/>
    <text x="90" y="62" text-anchor="middle" font-size="5.5" fill="#5577aa">PV Module (bottom view)</text>

    <!-- Wire leads from module -->
    <line x1="75" y1="75" x2="75" y2="88" stroke="#c00" stroke-width="1.5"/>
    <line x1="105" y1="75" x2="105" y2="88" stroke="#c00" stroke-width="1.5"/>
    <text x="60" y="83" font-size="4.5" fill="#c00">+</text>
    <text x="112" y="83" font-size="4.5" fill="#c00">−</text>

    <!-- MC4 connector -->
    <ellipse cx="75" cy="93" rx="5" ry="4" fill="#333" stroke="#555" stroke-width="0.8"/>
    <ellipse cx="105" cy="93" rx="5" ry="4" fill="#333" stroke="#555" stroke-width="0.8"/>
    <text x="62" y="106" font-size="4.5" fill="#333">MC4</text>
    <text x="108" y="106" font-size="4.5" fill="#333">MC4</text>

    <!-- Notes -->
    <text x="90" y="122" text-anchor="middle" font-size="5.5" fill="#1a3a6b" font-weight="bold">Use UV-resistant cable ties every 18"</text>
    <text x="90" y="130" text-anchor="middle" font-size="5" fill="#555">Secure all leads — no contact with roof surface</text>
    <text x="90" y="138" text-anchor="middle" font-size="5" fill="#777">NEC 690.31 — USE-2/PV Wire on rooftop</text>

  </svg>`;
}

// ─── Notes ─────────────────────────────────────────────────────────────────────
const MOUNTING_NOTES_LEFT = [
  'All mounting hardware shall be compatible with module frame and roof assembly. Do not mix aluminum and steel hardware without corrosion barrier.',
  'Rail shall be installed with continuous runs where possible. Splice rails per Detail 3 — stagger splices on adjacent rows by minimum 24".',
  'L-foot and flashing assembly shall be installed into rafter/structural members only. Locate all attachment points with a stud finder before drilling.',
  'Pre-drill pilot hole (7/32" diameter for 5/16" lag bolt) to prevent rafter splitting. Apply anti-seize or sealant to lag bolt threads before installation.',
  'Butyl tape or equivalent sealant shall be applied under flashing base plate. Do not rely on caulk alone for waterproofing.',
  'Minimum 2.5" embedment of lag bolt into rafter required. Verify embedment depth after installation.',
];

const MOUNTING_NOTES_RIGHT = [
  'Module clamps shall be rated for module frame depth. End clamps at array perimeter; mid clamps between modules. Torque to manufacturer specification.',
  'All module frames, rail sections, and metal mounting hardware shall be bonded to equipment grounding conductor (EGC) using UL 2703 listed hardware.',
  'EGC (#10 AWG min or as calculated per NEC 250.122) shall be continuous from array grounding lug to inverter ground bus to grounding electrode system.',
  'All wiring under array shall be USE-2 or listed PV Wire. Bundle and secure with UV-resistant cable ties at maximum 18" intervals.',
  'Maintain minimum 3" clearance between wire bundle and roof surface to prevent abrasion and allow airflow.',
  'After installation, inspect all lag bolt flashings for proper sealing. Verify no standing water can accumulate at any roof penetration.',
];