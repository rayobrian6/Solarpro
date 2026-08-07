// ═══════════════════════════════════════════════════════════════════════════
// APP-B: Utility Interconnection Application & PTO Roadmap
// v48.33 — Added to permit packages for every residential solar installation
// ═══════════════════════════════════════════════════════════════════════════
//
// PURPOSE:
//   Every solar installation requires two distinct utility approvals:
//     1. Interconnection Agreement (ICA) — before/during construction
//     2. Permission to Operate (PTO)    — after final inspection
//
//   This page is included in the permit package as a homeowner reference document.
//   It provides utility-specific application details, timelines, and a checklist
//   so the homeowner understands every step of the approval process.
//
//   When utility-specific data is NOT available (utility not in registry),
//   a generic PTO roadmap is shown covering universal requirements.
//
// PAGE ID: APP-B (after APP-A: Spec Sheet Reference)
// ═══════════════════════════════════════════════════════════════════════════

import type { PermitInput } from '../types';
import type { CADModel } from '@/lib/cad/types';
import { titleBlock } from '../utils/titleBlock';
import { PLANSET_ENGINE_VERSION } from '../constants';
import {
  getInterconnectionProfile,
  getTypicalTotalTimeline,
  type InterconnectionProfile,
} from '@/lib/utilityInterconnection';
import { PROPOSAL_UTILITY_PROFILES } from '@/lib/proposalTruthEngine';
import { projectProjectStateFromInput } from '../snapshot/projectAuthorityProjection';

// CMDA — the ONLY correct inline font-family spelling (single-quoted names
// nest safely inside a double-quoted style attribute).
import { CSS_FONT_SANS_UI_STACK } from '../fonts/fontPack';
// ─── HTML Escape Helper ──────────────────────────────────────────────────────
function esc(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Resolve Utility ID from PermitInput ────────────────────────────────────
// PermitInput has project.utilityName (string), not a utility_id.
// We match it against PROPOSAL_UTILITY_PROFILES using regex patterns (same
// bridge pattern used in the engineering panel).
function resolveUtilityId(input: PermitInput): string | null {
  const utilityName = input.project.utilityName ?? input.utility?.utilityName;
  if (!utilityName) return null;
  const nameLower = utilityName.toLowerCase();
  // THE canonical 2-LETTER CODE. This read compliance.jurisdiction.state and
  // uppercased it, so it compared 'ILLINOIS' (or 'UNKNOWN') against profiles keyed
  // 'IL' and silently matched nothing — every Illinois project fell to the generic
  // PTO roadmap.
  const state = projectProjectStateFromInput(input).code ?? '';
  // Match against PROPOSAL_UTILITY_PROFILES with state + name pattern
  const stateProfiles = state
    ? PROPOSAL_UTILITY_PROFILES.filter(p => p.state === state)
    : PROPOSAL_UTILITY_PROFILES;
  const matched = stateProfiles.find(p => {
    try { return new RegExp(p.utility_name_pattern, 'i').test(nameLower); } catch { return false; }
  });
  return matched?.utility_id ?? null;
}

// ─── Generic PTO Roadmap (fallback when no utility profile) ──────────────────
function genericPtoRoadmap(): string {
  return `
    <div class="sec" style="border:1.5px solid #e0e0e0; border-radius:3px; overflow:hidden; margin-bottom:10px;">
      <div class="sec-hdr" style="background:#444;color:#fff;padding:5px 8px;font-size:9px;font-weight:900;letter-spacing:0.8px;">GENERIC PTO ROADMAP — VERIFY WITH YOUR UTILITY</div>
      <div style="padding:8px;">
        <p style="font-size:8px;color:#555;margin:0 0 6px;">Utility-specific data is not yet in our database for this utility. The following is the standard process applicable to most US utilities for residential solar interconnection.</p>
        <table style="width:100%;border-collapse:collapse;font-size:8px;">
          <thead>
            <tr style="background:#f5f5f5;">
              <th style="padding:4px 6px;text-align:left;border-bottom:1px solid #ddd;font-weight:900;width:30px;">STEP</th>
              <th style="padding:4px 6px;text-align:left;border-bottom:1px solid #ddd;font-weight:900;">ACTION</th>
              <th style="padding:4px 6px;text-align:left;border-bottom:1px solid #ddd;font-weight:900;width:110px;">TIMELINE</th>
              <th style="padding:4px 6px;text-align:left;border-bottom:1px solid #ddd;font-weight:900;width:70px;">WHO</th>
            </tr>
          </thead>
          <tbody>
            <tr><td style="padding:3px 6px;border-bottom:1px solid #eee;">1</td><td style="padding:3px 6px;border-bottom:1px solid #eee;">Submit Interconnection Application to utility with Single-Line Diagram, equipment specs, and installer license</td><td style="padding:3px 6px;border-bottom:1px solid #eee;">Before construction starts</td><td style="padding:3px 6px;border-bottom:1px solid #eee;">Contractor</td></tr>
            <tr style="background:#fafafa;"><td style="padding:3px 6px;border-bottom:1px solid #eee;">2</td><td style="padding:3px 6px;border-bottom:1px solid #eee;">Sign Interconnection Agreement — utility sends after technical review</td><td style="padding:3px 6px;border-bottom:1px solid #eee;">10–30 business days</td><td style="padding:3px 6px;border-bottom:1px solid #eee;">Homeowner</td></tr>
            <tr><td style="padding:3px 6px;border-bottom:1px solid #eee;">3</td><td style="padding:3px 6px;border-bottom:1px solid #eee;">Pull building permit from AHJ (city/county). Construction begins.</td><td style="padding:3px 6px;border-bottom:1px solid #eee;">After ICA approval</td><td style="padding:3px 6px;border-bottom:1px solid #eee;">Contractor</td></tr>
            <tr style="background:#fafafa;"><td style="padding:3px 6px;border-bottom:1px solid #eee;">4</td><td style="padding:3px 6px;border-bottom:1px solid #eee;">Install solar system. Schedule AHJ final inspection.</td><td style="padding:3px 6px;border-bottom:1px solid #eee;">During installation</td><td style="padding:3px 6px;border-bottom:1px solid #eee;">Contractor</td></tr>
            <tr><td style="padding:3px 6px;border-bottom:1px solid #eee;">5</td><td style="padding:3px 6px;border-bottom:1px solid #eee;">Pass AHJ final electrical inspection. Inspector signs permit card.</td><td style="padding:3px 6px;border-bottom:1px solid #eee;">After installation</td><td style="padding:3px 6px;border-bottom:1px solid #eee;">AHJ Inspector</td></tr>
            <tr style="background:#fafafa;"><td style="padding:3px 6px;border-bottom:1px solid #eee;">6</td><td style="padding:3px 6px;border-bottom:1px solid #eee;">Submit PTO request to utility with signed inspection card</td><td style="padding:3px 6px;border-bottom:1px solid #eee;">After inspection passed</td><td style="padding:3px 6px;border-bottom:1px solid #eee;">Contractor</td></tr>
            <tr><td style="padding:3px 6px;border-bottom:1px solid #eee;">7</td><td style="padding:3px 6px;border-bottom:1px solid #eee;">Utility issues PTO (Permission to Operate) letter. Utility may swap meter.</td><td style="padding:3px 6px;border-bottom:1px solid #eee;">5–20 business days</td><td style="padding:3px 6px;border-bottom:1px solid #eee;">Utility</td></tr>
            <tr style="background:#fafafa;"><td style="padding:3px 6px;">8</td><td style="padding:3px 6px;"><strong>Receive PTO letter. DO NOT turn on system before this step.</strong> Energize system.</td><td style="padding:3px 6px;">Immediately after PTO</td><td style="padding:3px 6px;">Homeowner</td></tr>
          </tbody>
        </table>
        <div style="margin-top:8px;padding:6px 8px;background:#fff3cd;border:1px solid #e0b000;border-radius:2px;">
          <span style="font-size:8px;font-weight:900;color:#856404;">IMPORTANT:</span>
          <span style="font-size:8px;color:#856404;"> Contact your utility's distributed generation / net metering department directly for utility-specific forms, portals, and timelines. Do not energize the solar system until the PTO letter is received from the utility — energizing without PTO is a tariff violation that may result in disconnection.</span>
        </div>
      </div>
    </div>
  `;
}

// ─── Utility-Specific Interconnection Sections ────────────────────────────────
function icaApplicationSection(profile: InterconnectionProfile): string {
  const rows = profile.requirements.map((req, i) => `
    <tr style="${i % 2 === 0 ? '' : 'background:#fafafa;'}">
      <td style="padding:3px 6px;border-bottom:1px solid #eee;font-weight:700;font-size:8px;">${esc(req.label)}</td>
      <td style="padding:3px 6px;border-bottom:1px solid #eee;font-size:8px;">${esc(req.description)}</td>
      <td style="padding:3px 6px;border-bottom:1px solid #eee;font-size:8px;text-align:center;">${req.required_small_system ? '✓' : '—'}</td>
      <td style="padding:3px 6px;border-bottom:1px solid #eee;font-size:8px;text-align:center;">${req.required_large_system ? '✓' : '—'}</td>
      <td style="padding:3px 6px;border-bottom:1px solid #eee;font-size:8px;text-align:center;color:#0a5;">${esc(req.prepared_by === 'contractor' ? 'Contractor' : req.prepared_by === 'homeowner' ? 'Homeowner' : 'Both')}</td>
    </tr>
  `).join('');

  return `
    <div class="sec" style="border:1.5px solid #c8e0f4; border-radius:3px; overflow:hidden; margin-bottom:10px;">
      <div class="sec-hdr" style="background:#1565c0;color:#fff;padding:5px 8px;font-size:9px;font-weight:900;letter-spacing:0.8px;">STEP 1: INTERCONNECTION APPLICATION (ICA)</div>
      <div style="padding:8px;">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px;">
          <div style="padding:6px;background:#e8f0fe;border-radius:2px;">
            <div style="font-size:7px;font-weight:900;color:#1565c0;margin-bottom:2px;">APPLICATION FORM</div>
            <div style="font-size:8px;font-weight:700;">${esc(profile.application_form_name)}</div>
          </div>
          <div style="padding:6px;background:#e8f0fe;border-radius:2px;">
            <div style="font-size:7px;font-weight:900;color:#1565c0;margin-bottom:2px;">PORTAL TYPE</div>
            <div style="font-size:8px;font-weight:700;">${esc(profile.portal_type.replace(/_/g, ' ').toUpperCase())}</div>
          </div>
          <div style="padding:6px;background:#e8f0fe;border-radius:2px;">
            <div style="font-size:7px;font-weight:900;color:#1565c0;margin-bottom:2px;">APPROVAL TIMELINE</div>
            <div style="font-size:8px;font-weight:700;">${profile.ica_approval_days_min}–${profile.ica_approval_days_max} business days</div>
          </div>
        </div>
        <div style="margin-bottom:6px;padding:5px 7px;background:#f8f9fa;border-left:3px solid #1565c0;font-size:8px;">
          <strong>Application URL:</strong>
          <span style="color:#1565c0;"> ${esc(profile.application_url)}</span>
          ${profile.interconnection_phone ? `&nbsp;&nbsp;<strong>Phone:</strong> ${esc(profile.interconnection_phone)}` : ''}
          ${profile.interconnection_email ? `&nbsp;&nbsp;<strong>Email:</strong> ${esc(profile.interconnection_email)}` : ''}
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:8px;margin-bottom:8px;">
          <thead>
            <tr style="background:#1565c0;color:#fff;">
              <th style="padding:4px 6px;text-align:left;font-weight:900;width:160px;">REQUIREMENT</th>
              <th style="padding:4px 6px;text-align:left;font-weight:900;">DESCRIPTION</th>
              <th style="padding:4px 6px;text-align:center;font-weight:900;width:55px;">≤10 kW</th>
              <th style="padding:4px 6px;text-align:center;font-weight:900;width:55px;">&gt;10 kW</th>
              <th style="padding:4px 6px;text-align:center;font-weight:900;width:70px;">PREPARED BY</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
        <div style="padding:5px 7px;background:#e8f4fd;border:1px solid #90caf9;border-radius:2px;font-size:8px;">
          <strong>Timeline Note:</strong> ${esc(profile.timeline_note)}
        </div>
      </div>
    </div>
  `;
}

function ptoSection(profile: InterconnectionProfile): string {
  const steps = profile.pto_steps.map((step, i) => `
    <div style="display:flex;align-items:flex-start;gap:8px;padding:5px 0;border-bottom:${i < profile.pto_steps.length - 1 ? '1px solid #e8f0fe' : 'none'};">
      <div style="flex-shrink:0;width:22px;height:22px;border-radius:50%;background:#1b5e20;color:#fff;font-size:8px;font-weight:900;display:flex;align-items:center;justify-content:center;">${i + 1}</div>
      <div style="font-size:8px;line-height:1.4;padding-top:3px;">${esc(step)}</div>
    </div>
  `).join('');

  const checklistItems = profile.homeowner_pto_checklist.map(item => `
    <div style="display:flex;align-items:flex-start;gap:6px;padding:3px 0;border-bottom:1px solid #e8f5e9;">
      <div style="flex-shrink:0;width:14px;height:14px;border:2px solid #1b5e20;border-radius:2px;margin-top:1px;"></div>
      <div style="font-size:8px;line-height:1.4;">${esc(item)}</div>
    </div>
  `).join('');

  const rejections = profile.common_rejections.map((r, i) => `
    <tr style="${i % 2 === 0 ? '' : 'background:#fafafa;'}">
      <td style="padding:3px 6px;border-bottom:1px solid #eee;font-size:8px;color:#c62828;">${esc(r.reason)}</td>
      <td style="padding:3px 6px;border-bottom:1px solid #eee;font-size:8px;color:#1b5e20;">${esc(r.how_to_avoid)}</td>
    </tr>
  `).join('');

  return `
    <!-- PTO Process Steps -->
    <div class="sec" style="border:1.5px solid #c8e6c9; border-radius:3px; overflow:hidden; margin-bottom:10px;">
      <div class="sec-hdr" style="background:#1b5e20;color:#fff;padding:5px 8px;font-size:9px;font-weight:900;letter-spacing:0.8px;">STEP 2: PERMISSION TO OPERATE (PTO) — PROCESS &amp; TIMELINE</div>
      <div style="padding:8px;">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px;">
          <div style="padding:6px;background:#e8f5e9;border-radius:2px;">
            <div style="font-size:7px;font-weight:900;color:#1b5e20;margin-bottom:2px;">PTO TRIGGER</div>
            <div style="font-size:8px;font-weight:700;">${esc(profile.pto_trigger.replace(/_/g, ' ').toUpperCase())}</div>
          </div>
          <div style="padding:6px;background:#e8f5e9;border-radius:2px;">
            <div style="font-size:7px;font-weight:900;color:#1b5e20;margin-bottom:2px;">PTO WAIT TIME</div>
            <div style="font-size:8px;font-weight:700;">${profile.pto_days_min}–${profile.pto_days_max} business days after request</div>
          </div>
          <div style="padding:6px;background:#e8f5e9;border-radius:2px;">
            <div style="font-size:7px;font-weight:900;color:#1b5e20;margin-bottom:2px;">TOTAL TIMELINE EST.</div>
            <div style="font-size:8px;font-weight:700;">${getTypicalTotalTimeline(profile.utility_id) ?? `${profile.ica_approval_days_min + profile.pto_days_min}–${profile.ica_approval_days_max + profile.pto_days_max} days`}</div>
          </div>
        </div>
        <div style="margin-bottom:8px;">
          ${steps}
        </div>
        ${profile.pto_request_url ? `
        <div style="margin-bottom:8px;padding:5px 7px;background:#f1f8e9;border-left:3px solid #1b5e20;font-size:8px;">
          <strong>PTO Request URL:</strong>
          <span style="color:#1b5e20;"> ${esc(profile.pto_request_url)}</span>
        </div>
        ` : ''}
      </div>
    </div>

    <!-- Homeowner PTO Checklist -->
    <div class="sec" style="border:1.5px solid #fff8e1; border-radius:3px; overflow:hidden; margin-bottom:10px;">
      <div class="sec-hdr" style="background:#e65100;color:#fff;padding:5px 8px;font-size:9px;font-weight:900;letter-spacing:0.8px;">HOMEOWNER PTO CHECKLIST — VERIFY BEFORE REQUESTING PTO</div>
      <div style="padding:8px;">
        <div style="margin-bottom:6px;padding:4px 8px;background:#fff8e1;border:1px solid #f9a825;border-radius:2px;font-size:8px;font-weight:700;color:#e65100;">
          DO NOT turn on the solar system until your installer has received the official PTO letter from the utility. Energizing before PTO is a tariff violation.
        </div>
        ${checklistItems}
      </div>
    </div>

    <!-- Common Rejection Reasons -->
    ${profile.common_rejections.length > 0 ? `
    <div class="sec" style="border:1.5px solid #fce4ec; border-radius:3px; overflow:hidden; margin-bottom:10px;">
      <div class="sec-hdr" style="background:#880e4f;color:#fff;padding:5px 8px;font-size:9px;font-weight:900;letter-spacing:0.8px;">COMMON REJECTION REASONS &amp; HOW TO AVOID THEM</div>
      <div style="padding:8px;">
        <table style="width:100%;border-collapse:collapse;font-size:8px;">
          <thead>
            <tr style="background:#880e4f;color:#fff;">
              <th style="padding:4px 6px;text-align:left;font-weight:900;width:45%;">REJECTION REASON</th>
              <th style="padding:4px 6px;text-align:left;font-weight:900;">HOW TO AVOID</th>
            </tr>
          </thead>
          <tbody>${rejections}</tbody>
        </table>
      </div>
    </div>
    ` : ''}
  `;
}

// ─── Main Page Function ───────────────────────────────────────────────────────
export function pageInterconnection(
  input: PermitInput,
  cad: CADModel,
  pageNum: number,
  totalPages: number
): string {
  const { project, compliance } = input;
  const utilityNameRaw = project.utilityName ?? input.utility?.utilityName ?? 'Unknown Utility';
  const stateCode = projectProjectStateFromInput(input).code ?? '';

  // Resolve utility profile from registry
  const utilityId = resolveUtilityId(input);
  const profile: InterconnectionProfile | null = utilityId ? getInterconnectionProfile(utilityId) : null;

  const headerInfo = [
    project?.address ?? '',
    utilityNameRaw,
    stateCode,
  ].filter(Boolean).join(' | ');

  // Header stamp
  const header = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 8px;background:#0d47a1;color:#fff;margin-bottom:10px;border-radius:2px;">
      <div>
        <div style="font-size:11px;font-weight:900;letter-spacing:0.5px;">APP-B: UTILITY INTERCONNECTION &amp; PTO ROADMAP</div>
        <div style="font-size:8px;margin-top:2px;opacity:0.85;">${esc(headerInfo)}</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:8px;font-weight:700;">PAGE ${pageNum} OF ${totalPages}</div>
        <div style="font-size:7px;opacity:0.8;">${esc(String(PLANSET_ENGINE_VERSION))}</div>
      </div>
    </div>
  `;

  // Utility identification box
  const utilityBox = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
      <div style="padding:7px 9px;background:#e3f2fd;border:1px solid #90caf9;border-radius:3px;">
        <div style="font-size:7px;font-weight:900;color:#1565c0;margin-bottom:2px;">YOUR UTILITY (DISTRIBUTION / WIRES)</div>
        <div style="font-size:10px;font-weight:900;">${esc(utilityNameRaw)}</div>
        ${profile ? `<div style="font-size:8px;color:#555;margin-top:2px;">State: ${esc(profile.state)} &nbsp;|&nbsp; Data verified: ${esc(profile.last_verified)}</div>` : `<div style="font-size:8px;color:#e65100;margin-top:2px;">Utility-specific data not yet in database — see generic roadmap below</div>`}
      </div>
      <div style="padding:7px 9px;background:#f3e5f5;border:1px solid #ce93d8;border-radius:3px;">
        <div style="font-size:7px;font-weight:900;color:#6a1b9a;margin-bottom:2px;">WHY THIS PAGE MATTERS</div>
        <div style="font-size:8px;line-height:1.4;">Your solar system is legally NOT allowed to energize until the utility issues a <strong>Permission to Operate (PTO)</strong> letter. This page explains the exact process and your personal checklist so there are no surprises.</div>
      </div>
    </div>
  `;

  // Main content — utility-specific or generic
  const mainContent = profile
    ? icaApplicationSection(profile) + ptoSection(profile)
    : genericPtoRoadmap();

  // Solar Pro note (coaching box) — only if profile available
  const proNote = profile ? `
    <div style="margin-top:8px;padding:7px 9px;background:#fff9c4;border:1.5px solid #f9a825;border-radius:3px;">
      <div style="font-size:7px;font-weight:900;color:#e65100;margin-bottom:3px;">SOLAR PRO COACHING NOTE (INTERNAL — NOT FOR HOMEOWNER)</div>
      <div style="font-size:8px;color:#333;line-height:1.4;">${esc(profile.solar_pro_note)}</div>
    </div>
  ` : '';

  // Final disclaimer
  const disclaimer = `
    <div style="margin-top:10px;padding:5px 8px;background:#f5f5f5;border:1px solid #e0e0e0;border-radius:2px;font-size:7.5px;color:#777;line-height:1.4;">
      This interconnection and PTO roadmap is provided for informational purposes and represents typical utility processes as of the date noted above. Utility processes, timelines, and requirements change — always verify current requirements directly with the utility before submitting applications. SolarPro and its contractors assume no liability for changes to utility programs after the last verified date shown.
    </div>
  `;

  const body = `
    <div class="page" style="padding:12px;font-family:${CSS_FONT_SANS_UI_STACK};font-size:9px;line-height:1.4;max-width:770px;margin:0 auto;">
      ${header}
      ${utilityBox}
      ${mainContent}
      ${proNote}
      ${disclaimer}
    </div>
  `;

  return titleBlock(input, 'APP-B', 'UTILITY INTERCONNECTION & PTO ROADMAP', pageNum, totalPages) + body;
}
