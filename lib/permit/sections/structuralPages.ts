// ═══════════════════════════════════════════════════════════════
// Structural Pages — All structural detail pages and dispatchers
// Extracted from route.ts — ZERO REGRESSION
// ═══════════════════════════════════════════════════════════════

import type { PermitInput } from '../types';
import type { CADModel } from '@/lib/cad/types';
import type { RenderContext } from '@/lib/drafting/renderContext';
import {
  getSheetComposition, validateSheetComposition, validateSheet,
} from '@/lib/drafting/sheetComposition';
import { titleBlock } from '../utils/titleBlock';
import { MIN_ATTACHMENT_SF } from '@/lib/structural/attachmentCapacity';
import { analyzeFenceWind } from '@/lib/structural/fenceWindEngine';
import {
  projectStructuralFromInput, fmt, fmtStr, findCheck, checkResultLabel,
  checkThresholdLabel, projectFastenerAssembly, FASTENER_NON_ORDERABLE_LABEL,
  type StructuralProjection,
} from '../snapshot/structuralProjection';
import { structuralBannerHtml } from '../utils/structuralBanner';
import { resolvePlansetProfile, isCompactProfile } from '../plansetProfile';
import { projectCodeAuthorityFromInput } from '../snapshot/codeAuthorityProjection';
import { sysTypeLabel, pv3Title, statusBg, statusColor, statusLabel, necNextStandardOcpd } from '../utils/helpers';
import type { CanonicalInput } from '../types';
import { composeDrawPage, getPrimaryView, getSecondaryView, drawDimension, escapeH } from '../utils/drawing';
import {  isFence, isGround, isRoof, getInverterTopology, topologyToLegacy } from '@/lib/system';
import { buildConductorAuthority, type SubSystemConductorAuthority } from '../utils/conductorAuthority';
import { isHybridPlanset, primarySubKey, SUB_LABEL, inverterSubKey } from './subSystemSheets';
import { buildIntegratedEquipment } from '../utils/integratedEquipment';
import { getMountingSystemById } from '@/lib/mounting-hardware-db';
import { getManufacturerAsset, DOCUMENT_APPLICABILITY_CHIP } from '@/lib/manufacturer-assets-db';
// AAC WS-9 — the ONE document-applicability seam every sheet may use.
import { sheetDocumentApplicability } from '@/lib/permit/snapshot/documentAuthority';
import {
  extractStructuralInputFromCAD,
  deriveStructuralBOM,
} from '@/lib/bom-system-profiles';
// §2 (closeout 2026-07-23) — SCHED AC-branch Status projects the ONE shared
// tri-state compliance result, NEVER an unconditional "✓". A branch with a blank
// required rating or an over-limit OCPD can no longer print a green check.
import { complianceBadge, evaluateCompliance } from '../snapshot/complianceState';
import { microMaxPerBranch, microBranchMaxOcpdA } from '../utils/branching';
import { peekSnapshot } from '../snapshot/read';
// PPC §6 — the SCHED branch matrix projects the canonical route / grounding
// authorities (read-only) beside the per-branch procurement sufficiency. No sheet
// re-derives any of them, and none is invented per branch: route carries a GLOBAL
// verification state + a per-branch length PROVENANCE, grounding is ONE global
// outcome scoped by branchIds, only procurement genuinely varies per branch.
import { routeVerificationStatus, routeVerificationLabel, projectOpenAirBranchGrounding } from '../snapshot/electricalProjection';
import { projectListedCableAssembly } from '../snapshot/electricalProjection';
// PPC §5/§9 — the AUTHORITATIVE PROCUREMENT TOTAL / orderable-export subset. The
// schedule renders this COMPUTED object; it no longer asserts exclusions in prose.
import { buildProcurementApproval, type PermitBOMItem } from '../utils/bomForPermit';


export function pageRoofStructural(input: PermitInput, cad: CADModel, pageNum: number, totalPages: number, ctx?: RenderContext | null): string {
  const inputRec = input as unknown as Record<string, unknown>;
  const comp = getSheetComposition('roof', 'structural', cad, inputRec);
  validateSheet('roof', comp);

  const drawingSvg = getPrimaryView(comp.primaryView, cad, input, ctx);
  if (!drawingSvg || drawingSvg.length < 500) {
    throw new Error(`[pageRoofStructural] getPrimaryView(${comp.primaryView}) returned empty SVG`);
  }

  // ── PV-3 is a DRAWING sheet (Ray 2026-07-20) ────────────────────────────────
  // The primary view is ALWAYS the drawn CAD attachment cross-section. An
  // earlier pass replaced the whole draw zone with the manufacturer's manual
  // page as a full-bleed <img> — which made PV-3 read as a reprinted datasheet
  // sitting at sheet 4 while the OTHER manufacturer pages lived in the DS
  // appendix ("that looks more like a data sheet than a structure sheet").
  // The manufacturer's published document remains the engineering basis: it is
  // CITED here (provenance strip) and reproduced full-page in the DS appendix
  // alongside the other manufacturer datasheets.
  const mountId = (input.project as { mountingSystemId?: string }).mountingSystemId;
  const rackAsset = getManufacturerAsset(mountId, 'racking_detail');
  if (rackAsset) {
    const src = rackAsset.docTitle || (rackAsset.sourceUrl ? new URL(rackAsset.sourceUrl).hostname : '');
    // §12 — is the cited document APPLICABLE to the selected mount version?
    const _mountSys = mountId ? getMountingSystemById(mountId) : undefined;
    // AAC WS-9 RENDERER PURITY — projected, not re-decided (audit §7.12).
    const _appl = sheetDocumentApplicability({
      region: peekSnapshot(input)?.equipmentDocumentAuthority ?? null,
      category: 'racking_detail', equipmentId: mountId,
      selectedModel: _mountSys?.model ?? rackAsset.model, asset: rackAsset,
    });
    // Provenance as a GENERAL NOTE in the data rail — a one-line citation must
    // not consume a whole secondary-view band of the draw zone.
    comp.generalNotes = [
      ...(comp.generalNotes ?? []),
      `ATTACHMENT PER ${rackAsset.brand.toUpperCase()} ${rackAsset.model.toUpperCase()} MANUFACTURER DOCUMENTATION ON FILE: `
        + `${src}${rackAsset.pageRef ? ' — ' + rackAsset.pageRef : ''}`
        + `${rackAsset.imageUrl ? '. REPRODUCED FULL-PAGE IN THE DATASHEET APPENDIX (DS SERIES).' : '. FIELD-VERIFY AGAINST CURRENT REVISION.'}`
        + (!_appl.applicabilityVerified
            ? ` DOCUMENT APPLICABILITY ${DOCUMENT_APPLICABILITY_CHIP[_appl.state]} — the on-file ${_appl.documentProduct ?? 'document'} covers a different product version than the selected mount ${(_mountSys?.model ?? rackAsset.model)}; NOT AUTHORITATIVE until a version-exact document or verified alias evidence is provided (EQUIPMENT-DOCUMENT-APPLICABILITY).`
            : ''),
    ];
  }

  return `
  <div class="page">
    ${titleBlock(input, 'PV-3', 'ATTACHMENT DETAIL — MOUNTING & CROSS-SECTION', pageNum, totalPages)}
    ${structuralBannerHtml(projectStructuralFromInput(input).banner, { compact: true, input, sheetId: 'PV-3' })}
    ${composeDrawPage(comp, drawingSvg)}
  </div>`;
}



export function pageGroundStructural(input: PermitInput, cad: CADModel, pageNum: number, totalPages: number, ctx?: RenderContext | null, opts?: { sheetId?: string; title?: string }): string {
  const inputRec = input as unknown as Record<string, unknown>;
  const comp = getSheetComposition('ground_mount', 'structural', cad, inputRec);
  validateSheet('ground_mount', comp);

  const drawingSvg = getPrimaryView(comp.primaryView, cad, input, ctx);
  if (!drawingSvg || drawingSvg.length < 500) {
    throw new Error(`[pageGroundStructural] getPrimaryView(${comp.primaryView}) returned empty SVG`);
  }

  return `
  <div class="page">
    ${titleBlock(input, opts?.sheetId ?? 'PV-3', opts?.title ?? 'GROUND MOUNT STRUCTURAL DETAILS', pageNum, totalPages)}
    ${composeDrawPage(comp, drawingSvg)}
  </div>`;
}



export function pageFenceStructural(input: PermitInput, cad: CADModel, pageNum: number, totalPages: number, ctx?: RenderContext | null, opts?: { sheetId?: string; title?: string }): string {
  const inputRec = input as unknown as Record<string, unknown>;
  const comp = getSheetComposition('solar_fence', 'structural', cad, inputRec);
  validateSheet('solar_fence', comp);

  // ── Primary view: fence_structural → getStructuralFromCAD (Step 4)
  const drawingSvg = getPrimaryView(comp.primaryView, cad, input, ctx);
  if (!drawingSvg || drawingSvg.length < 500) {
    throw new Error(`[pageFenceStructural] getPrimaryView(${comp.primaryView}) returned empty SVG`);
  }

  return `
  <div class="page">
    ${titleBlock(input, opts?.sheetId ?? 'PV-3', opts?.title ?? 'FENCE STRUCTURAL DETAILS', pageNum, totalPages)}
    ${composeDrawPage(comp, drawingSvg)}
  </div>`;
}



// ══════════════════════════════════════════════════════════════════════════════
// PV-4C STRUCTURAL CALCULATION SHEET — THREE ISOLATED SYSTEM FAMILIES
// ══════════════════════════════════════════════════════════════════════════════
// pageStructuralFence  — ${asce} §29.4  fence post/foundation only
// pageStructuralGround — ${asce} §27    pile/pier only
// pageStructuralRoof   — ${asce} §26+27 rafter + attachment + snow
// pageStructural()     — dispatcher: reads cad.systemType → calls correct family
// NO shared structural narrative blocks. NO cross-family conditionals in bodies.
// ══════════════════════════════════════════════════════════════════════════════

// ─── FENCE STRUCTURAL ─────────────────────────────────────────────────────────
export function pageStructuralFence(input: PermitInput, cad: CADModel, pageNum: number, totalPages: number): string {
  const { compliance, rulesResult, project } = input;
  const structural = compliance.structural;
  const cp = projectCodeAuthorityFromInput(input); const asce = cp.asceLabel;  // W4 §2 single-source
  const ibcVer = cp.ibc ?? 'PENDING';
  const structuralRules = (rulesResult?.rules || []).filter(r => r.category === 'structural');

  // ── Read from canonical (authoritative) ───────────────────────────────────
  const _c = project._canonical as CanonicalInput | undefined;
  const cSite = _c?.site;
  const cStr  = _c?.structure;

  // ── W3 §1/§5/§6/§7 — PROJECT environmental + fence-overturning results from
  // the canonical snapshot. Wind/exposure/snow print the SINGLE-SOURCED env
  // (no `|| 115`, no `|| 'C'`); the load math is the RELOCATED fence engine
  // (lib/structural/fenceWindEngine), never inline here. Where a snapshot is
  // present its fence-overturning check is projected so PV-4C / PE-1 / CERT
  // print one acceptance rule.
  const _proj = projectStructuralFromInput(input);
  const windSpeed   = _proj.present ? fmt(_proj.windSpeedMph) : (cSite?.windSpeed ? String(cSite.windSpeed) : '—');
  const exposure    = _proj.present ? fmtStr(_proj.exposure) : (cSite?.exposureCategory || structural?.wind?.exposureCategory || '—');
  const groundSnow  = _proj.present && _proj.groundSnowPsf != null ? String(_proj.groundSnowPsf)
    : (cSite?.groundSnowLoad != null ? String(cSite.groundSnowLoad) : '—');

  // Structural geometry — canonical.structure is authoritative (CAD-patched)
  const postEmbedN  = cStr?.postEmbedFt    || 3.5;
  const postSpN     = cStr?.postSpacingFt  || 8.0;
  const panHN       = cStr?.panelHeightFt  || 6.0;
  const soilRes     = cStr?.soilResistance || 200;  // lbs/ft² passive soil resistance
  const postEmbed   = postEmbedN.toFixed(1);
  const postSpacing = postSpN.toFixed(1);
  const panelHFt    = panHN.toFixed(2);
  const railCount   = cad.fence?.railCount || 3;
  const fenceLenFt  = cad.fence?.totalLengthM ? (cad.fence.totalLengthM * 3.28084).toFixed(0) : '—';

  // ── RELOCATED FENCE WIND ENGINE (${asce} §29.4) — no inline load math ───
  // The renderer holds ZERO structural calculation; it calls the lib engine and
  // projects the numbers. Wind speed comes from the single-sourced env when the
  // snapshot is present, else canonical (honest: em-dash if neither).
  const windSpdN = _proj.windSpeedMph ?? cSite?.windSpeed ?? Number(structural?.wind?.windSpeed) ?? 0;
  const _fw = analyzeFenceWind({
    windSpeedMph: windSpdN,
    exposure: typeof exposure === 'string' ? exposure : 'C',
    panelHeightFt: panHN, postSpacingFt: postSpN,
    postEmbedFt: postEmbedN, soilResistancePsf: soilRes,
    groundSnowPsf: Number(groundSnow) || 0,
  });
  const Kz  = _fw.Kz, Kzt = _fw.Kzt, Kd = _fw.Kd, Cf = _fw.Cf;
  // Prefer the snapshot's canonical fence-overturning check when carried.
  const _fenceChk = findCheck(_proj, 'fence-overturning');
  const embedStatus  = _fenceChk ? checkResultLabel(_fenceChk) : (_fw.passes ? 'PASS' : 'FAIL');
  const embedColor   = embedStatus === 'PASS' ? '#006600' : embedStatus === 'FAIL' ? '#cc0000' : '#b45309';
  const safetyRatio  = _fenceChk?.safetyFactor ?? _fw.overturningSafetyFactor;
  const velPressure  = _fw.velocityPressurePsf.toFixed(2);
  const windPresDisp = _fw.netWindPressurePsf.toFixed(1);
  const windLoadPost = _fw.lateralForcePerPostLbs.toFixed(0);
  const overturnMoment = _fw.overturningMomentFtLbs.toFixed(0);
  const reqEmbedDisp = _fw.requiredEmbedmentFt.toFixed(2);
  const safetyFactor = safetyRatio.toFixed(2);

  const totalDL  = structural?.totalDeadLoadPsf?.toFixed(1) || '—';
  const moduleDL = structural?.moduleLoadPsf?.toFixed(1) || '—';
  const rackDL   = structural?.rackingLoadPsf?.toFixed(1) || '—';
  const upliftPsf = structural?.wind?.netUpliftPressure?.toFixed(2) || windPresDisp;
  const upliftPost = windLoadPost;

  return `
  <div class="page">
    ${titleBlock(input, 'PV-4C', 'STRUCTURAL CALCULATION SHEET — SOLAR FENCE', pageNum, totalPages)}
    <div class="page-content">
      ${structuralBannerHtml(_proj.banner, { input, sheetId: 'PV-4C' })}
      <div class="section-title">Structural Analysis — ${asce} §29.4 (Fence-Mounted PV)</div>

      <div class="struct-grid">
        <!-- Wind Analysis — COMPUTED FROM CANONICAL -->
        <div class="struct-card">
          <div class="sct">Wind Analysis — ${asce} §29.4</div>
          <table class="calc-table">
            <tr><td>Design Wind Speed (V)</td><td class="cv">${windSpeed} mph</td></tr>
            <tr><td>Exposure Category</td><td class="cv">Cat. ${exposure} (Kz = ${Kz})</td></tr>
            <tr><td>Directionality (Kd)</td><td class="cv">${Kd} (${asce} Table 26.6-1)</td></tr>
            <tr><td>Velocity Pressure (qz)</td><td class="cv">${velPressure} psf</td></tr>
            <tr><td>Force Coefficient (Cf)</td><td class="cv">${Cf} (solid panel, Fig. 29.4-1)</td></tr>
            <tr><td>Net Wind Pressure (p = qz·Cf)</td><td class="cv" style="font-weight:bold;">${windPresDisp} psf</td></tr>
          </table>
        </div>

        <!-- Foundation Analysis — EMBEDMENT CHECK -->
        <div class="struct-card">
          <div class="sct">Foundation Analysis — Embedment Check</div>
          <table class="calc-table">
            <tr><td>Lateral Force / Post</td><td class="cv">${windLoadPost} lbs</td></tr>
            <tr><td>Overturning Moment / Post</td><td class="cv">${overturnMoment} ft-lbs</td></tr>
            <tr><td>Required Embedment (calc.)</td><td class="cv" style="font-weight:bold;">${reqEmbedDisp} ft</td></tr>
            <tr><td>Provided Embedment</td><td class="cv">${postEmbed} ft</td></tr>
            <tr><td>Safety Ratio (prov/req)</td><td class="cv" style="font-weight:bold;color:${embedColor};">${safetyFactor} — ${embedStatus}</td></tr>
          </table>
        </div>

        <!-- Snow / Ground Load -->
        <div class="struct-card">
          <div class="sct">Snow Load — ${asce} §7</div>
          <table class="calc-table">
            <tr><td>Ground Snow Load (pg)</td><td class="cv">${groundSnow} psf</td></tr>
            <tr><td>Slope Reduction</td><td class="cv">N/A — vertical fence panels</td></tr>
            <tr><td>Controlling Load Case</td><td class="cv">0.9D + 1.0W (wind uplift governs)</td></tr>
            <tr><td>Snow Code Reference</td><td class="cv">${asce} §7 (ground snow)</td></tr>
          </table>
        </div>

        <!-- Geometry Summary -->
        <div class="struct-card">
          <div class="sct">Fence Geometry Summary</div>
          <table class="calc-table">
            <tr><td>Total Fence Length</td><td class="cv">${fenceLenFt} ft</td></tr>
            <tr><td>Panel Height</td><td class="cv">${panelHFt} ft</td></tr>
            <tr><td>Post Spacing</td><td class="cv">${postSpacing} ft O.C.</td></tr>
            <tr><td>Rail Count</td><td class="cv">${railCount} horizontal rails</td></tr>
          </table>
        </div>
      </div>

      <!-- Dead Load Analysis — Fence-Specific -->
      <div class="section-title">Dead Load Analysis — Load to Post Foundations</div>
      <table class="equip-table">
        <thead><tr><th>Component</th><th>Weight (PSF)</th><th>Notes</th></tr></thead>
        <tbody>
          <tr><td class="fw7">PV Modules</td><td class="tr mono">${moduleDL} PSF</td><td>Per manufacturer spec sheet, distributed over fence panel area</td></tr>
          <tr class="bg-lt"><td class="fw7">Fence Rail System</td><td class="tr mono">${rackDL} PSF</td><td>Horizontal rail + module clamp + post hardware</td></tr>
          <tr><td class="fw7">Electrical (Wiring, Conduit)</td><td class="tr mono">0.2 PSF</td><td>Estimate for home-run conduit + module leads</td></tr>
          <tr class="bg-lt" style="font-weight:bold;border-top:2px solid #000"><td class="fw7">TOTAL ADDED DEAD LOAD</td><td class="tr mono fw7">${totalDL} PSF</td><td>Transferred to fence post foundations via rail system</td></tr>
        </tbody>
      </table>
      <div style="padding:var(--xs);font-size:var(--f-md);line-height:1.5;border:var(--border);border-top:none;background:#fafafa;">
        <strong>DEAD LOAD INTERPRETATION:</strong>
        The total added dead load of ${totalDL} PSF is distributed uniformly over the fence panel area and transferred
        to the fence posts and driven post foundations via the horizontal rail system.
        Post foundations are evaluated to confirm adequate capacity per ${asce} §26 and §29.4.
        Dead load does not govern for vertical fence-mounted arrays — wind uplift and overturning are the controlling load cases.
      </div>

      <!-- Standard Detail: Fence Post Embedment -->
      <div class="section-title">Standard Detail — Fence Post Embedment (Typical)</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--xs);border:var(--border);padding:var(--xs);">
        <div style="text-align:center;">
          <svg viewBox="0 0 300 240" width="280" height="220" style="display:block;margin:0 auto;">
            <!-- Sky / above grade -->
            <rect x="0" y="0" width="300" height="140" fill="#e8f4f8" stroke="none"/>
            <!-- Grade line -->
            <rect x="0" y="140" width="300" height="18" fill="#8B7355" stroke="#000" stroke-width="1.2"/>
            <text x="150" y="152" text-anchor="middle" font-size="7.5" fill="#fff" font-weight="bold">FINISH GRADE</text>
            <!-- Below grade soil -->
            <rect x="0" y="158" width="300" height="82" fill="#c8a96e" stroke="#000" stroke-width="0.5"/>
            <!-- Driven inner steel post below grade (dashed = buried, no concrete) -->
            <rect x="142" y="158" width="16" height="72" fill="#fff" stroke="#000" stroke-width="1.2" stroke-dasharray="4,2"/>
            <polygon points="142,230 150,240 158,230" fill="#fff" stroke="#000" stroke-width="1.2" stroke-dasharray="4,2"/>
            <text x="196" y="210" text-anchor="middle" font-size="7" fill="#333" font-weight="bold">DRIVEN STEEL POST</text>
            <text x="196" y="220" text-anchor="middle" font-size="6.5" fill="#333">2-7/8" DIA — NO CONCRETE</text>
            <!-- Outer post (above grade) -->
            <rect x="138" y="20" width="24" height="140" fill="#444" stroke="#000" stroke-width="1.5"/>
            <text x="150" y="95" text-anchor="middle" font-size="7" fill="#fff" font-weight="bold" transform="rotate(-90,150,95)">4" DIA OUTER POST</text>
            <!-- PV Module on post -->
            <rect x="80" y="8" width="140" height="22" fill="#2255aa" stroke="#000" stroke-width="1" rx="1"/>
            <text x="150" y="22" text-anchor="middle" font-size="7.5" fill="#fff" font-weight="bold">PV MODULE</text>
            <!-- Horizontal rails -->
            <rect x="82" y="35" width="136" height="7" fill="#666" stroke="#000" stroke-width="0.8"/>
            <rect x="82" y="75" width="136" height="7" fill="#666" stroke="#000" stroke-width="0.8"/>
            <rect x="82" y="115" width="136" height="7" fill="#666" stroke="#000" stroke-width="0.8"/>
            <text x="228" y="41" font-size="6" fill="#333">RAIL 1</text>
            <text x="228" y="81" font-size="6" fill="#333">RAIL 2</text>
            <text x="228" y="121" font-size="6" fill="#333">RAIL 3</text>
            <!-- Embed dimension -->
            <line x1="170" y1="140" x2="215" y2="140" stroke="#c00" stroke-width="0.6" stroke-dasharray="2,1"/>
            <line x1="170" y1="238" x2="215" y2="238" stroke="#c00" stroke-width="0.6" stroke-dasharray="2,1"/>
            <line x1="210" y1="140" x2="210" y2="238" stroke="#c00" stroke-width="1"/>
            <polygon points="206,140 214,140 210,134" fill="#c00"/>
            <polygon points="206,238 214,238 210,244" fill="#c00"/>
            <text x="218" y="190" font-size="7" fill="#c00" font-weight="bold">${postEmbed} ft</text>
            <text x="218" y="199" font-size="6.5" fill="#c00">MIN EMBED</text>
            <!-- Wind arrow -->
            <line x1="30" y1="75" x2="75" y2="75" stroke="#0055cc" stroke-width="2"/>
            <polygon points="75,71 75,79 84,75" fill="#0055cc"/>
            <text x="15" y="68" font-size="7" fill="#0055cc" font-weight="bold">WIND</text>
            <text x="15" y="77" font-size="6.5" fill="#0055cc">Cf=1.3</text>
          </svg>
        </div>
        <div style="font-size:var(--f-sm);line-height:1.7;">
          <div style="font-weight:900;font-size:9px;margin-bottom:5px;letter-spacing:0.5px;border-bottom:1px solid #ccc;padding-bottom:3px;">FENCE POST FOUNDATION REQUIREMENTS</div>
          <div style="margin-bottom:3px;">1. Posts: 2-7/8" dia. hot-dip galvanized inner steel post (96" long) with 4" dia. outer post sleeve — per SolFence published section.</div>
          <div style="margin-bottom:3px;">2. Embedment: Min. <strong>${postEmbed} ft</strong> below finish grade per ${asce} §26 and overturning analysis.</div>
          <div style="margin-bottom:3px;">3. Foundation: DRIVEN with post pounder — NO concrete (manufacturer standard install); field-verify refusal.</div>
          <div style="margin-bottom:3px;">4. Post spacing: <strong>${postSpacing} ft O.C.</strong> maximum per wind load calculation — see segment table below.</div>
          <div style="margin-bottom:3px;">5. Wind design: ${asce} §29.4, Cf = 1.3, Exposure Category ${exposure}.</div>
          <div style="margin-bottom:3px;">6. Driving: advance post to full embedment or refusal; if refusal above min. embedment, contact engineer of record.</div>
          <div style="margin-bottom:3px;">7. Grounding: All posts bonded to EGC per NEC 250.169 — min. #6 AWG Cu bonding conductor.</div>
          <div style="color:#555;font-size:7px;margin-top:5px;font-style:italic;">Post diameter and wall thickness to be confirmed by engineer of record per final wind load analysis.</div>
        </div>
      </div>

      <!-- Fence Segment Wind Load Table -->
      ${cad.fence ? `
      <div class="section-title">Fence Segment Wind Load Analysis — ${asce} §29.4</div>
      <table class="equip-table">
        <thead><tr><th>Segment</th><th>Length (ft)</th><th>Panels</th><th>Posts</th><th>Panel Ht (ft)</th><th>qz (psf)</th><th>p = qz·Cf (psf)</th><th>Wind / Post (lbs)</th><th>Overturning (ft-lbs)</th></tr></thead>
        <tbody>
          ${(cad.fence.segments || []).map((seg: any, i: number) => {
            const lenFt   = seg.lengthM * 3.28084;
            const postSpF = cad.fence!.postSpacingM * 3.28084;
            const panH    = cad.fence!.panelHeightM * 3.28084;
            const posts   = seg.posts?.length || Math.ceil(lenFt / postSpF) + 1;
            // Relocated engine per segment — renderer holds no load math.
            const _seg = analyzeFenceWind({ windSpeedMph: windSpdN, exposure: typeof exposure === 'string' ? exposure : 'C',
              panelHeightFt: panH, postSpacingFt: postSpF, postEmbedFt: postEmbedN, soilResistancePsf: soilRes, groundSnowPsf: Number(groundSnow) || 0 });
            const qzSeg   = _seg.velocityPressurePsf;
            const pSeg    = _seg.netWindPressurePsf;
            const wPost   = _seg.lateralForcePerPostLbs;
            const oMoment = _seg.overturningMomentFtLbs;
            return `<tr>
              <td class="fw7">Seg ${i+1}${seg.hasGate ? ' (GATE)' : ''}</td>
              <td>${lenFt.toFixed(1)}</td>
              <td>${seg.panelCount}</td>
              <td>${posts}</td>
              <td>${panH.toFixed(2)}</td>
              <td>${qzSeg.toFixed(2)}</td>
              <td>${pSeg.toFixed(1)}</td>
              <td style="font-weight:bold;">${wPost.toFixed(0)}</td>
              <td>${oMoment.toFixed(0)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      <div style="padding:var(--xs);font-size:var(--f-sm);line-height:1.5;border:var(--border);border-top:none;background:#f0f4f8;">
        <strong>WIND LOAD FORMULA (${asce} §29.4) — ALL VALUES FROM CANONICAL:</strong><br/>
        <span style="font-family:monospace;">qz = 0.00256 × Kz(${Kz}) × Kzt(${Kzt}) × Kd(${Kd}) × V²(${windSpeed}²) = <strong>${velPressure} psf</strong></span><br/>
        <span style="font-family:monospace;">p = qz × Cf(${Cf}) = <strong>${windPresDisp} psf</strong> &nbsp;|&nbsp; Area/Post = H(${panelHFt} ft) × S(${postSpacing} ft) = ${(panHN*postSpN).toFixed(2)} ft²</span><br/>
        <span style="font-family:monospace;">F = p × Area = <strong>${windLoadPost} lbs</strong> &nbsp;|&nbsp; M = F × H/2 = <strong>${overturnMoment} ft-lbs</strong></span><br/>
        <span style="font-family:monospace;">D_req = 1.5 × ∛(M / (q_soil × b)) = <strong>${reqEmbedDisp} ft</strong> &nbsp;|&nbsp; D_prov = <strong>${postEmbed} ft</strong> → <strong style="color:${embedColor};">${embedStatus}</strong></span><br/>
        V = ${windSpeed} mph &nbsp;|&nbsp; Exposure ${exposure} &nbsp;|&nbsp; Soil resistance = ${soilRes} psf &nbsp;|&nbsp; Total fence: ${fenceLenFt} ft
      </div>` : ''}

      <!-- Governing Load Combination — Fence -->
      <div class="section-title">Governing Load Combination — ${asce} §2.3</div>
      <div style="padding:var(--xs);font-size:var(--f-md);line-height:1.6;border:var(--border);border-top:none;">
        <table class="info-table" style="margin-bottom:var(--xs);">
          <tr><td class="il" style="width:100px;">${asce}</td><td class="iv">Minimum Design Loads and Associated Criteria for Buildings and Other Structures</td></tr>
          <tr><td class="il">${ibcVer} IBC</td><td class="iv">International Building Code — Chapter 16: Structural Design</td></tr>
          <tr><td class="il">${ibcVer} IRC</td><td class="iv">International Residential Code — Section R301: Design Criteria</td></tr>
        </table>
        <div style="font-size:var(--f-sm);color:#000;">
          <strong>GOVERNING LOAD COMBINATION (${asce} §2.3) — FENCE-MOUNTED PV:</strong>
          The controlling load case for fence-mounted PV is <strong>0.9D + 1.0W</strong> (wind overturning governs).
          Post embedment depth and footing diameter are sized to resist the governing overturning moment with a
          minimum safety factor of 1.5 against overturning. Dead load combination <strong>1.2D + 1.6S</strong> is
          evaluated for gravity loading on post foundations; wind governs at all exposure categories.
          All post foundations shall develop the required capacity with a minimum safety factor of 1.5 (overturning)
          and 2.0 (sliding) per ${asce} §12.13.
        </div>
      </div>
      ${structural ? `<div style="padding:var(--xs);font-size:var(--f-md);line-height:1.5;border:var(--border);border-top:none;background:#fafafa;">
        <strong>STRUCTURAL ANALYSIS INTERPRETATION — FENCE:</strong>
        Wind analysis per ${asce} §29.4 indicates a net lateral wind load of <strong>${windLoadPost} lbs per post</strong>
        at the design wind speed of ${windSpeed} mph (Exposure Category ${exposure}).
        The overturning moment at the base of each post is ${overturnMoment} ft-lbs.
        Fence post embedment of ${postEmbed} ft (driven inner steel post — no concrete, per the manufacturer's
        published foundation) provides the required resistance to overturning and lateral loads.
        Ground snow load of ${groundSnow} psf applies to the site; roof slope reduction factors do not apply to
        vertical fence-mounted arrays — ground snow load per ${asce} §7 governs.
        Post foundation system confirmed adequate for the imposed wind and dead loads per ${asce} §29.4.
      </div>` : ''}
      <div style="padding:var(--xs);margin-top:var(--sm);font-size:var(--f-md);line-height:1.5;border:2px solid #000;background:#fff;">
        <strong>PAGE CONCLUSION — FENCE STRUCTURAL ANALYSIS:</strong>
        The proposed solar fence photovoltaic array and post foundation system have been analyzed for wind
        overturning, dead load, and post embedment capacity per ${asce} §29.4 and ${ibcVer} IBC.
        ${structural && structural.attachment?.safetyFactor != null && structural.attachment.safetyFactor >= 1.5
          ? `All structural parameters are within acceptable limits. The fence post foundation system is adequate
             to support the proposed solar fence PV array without modification. Post embedment and footing
             dimensions confirmed per ${asce} §29.4 wind overturning analysis.`
          : structural && structural.attachment?.safetyFactor == null
            ? 'Structural analysis data incomplete — verify all parameters per engineering analysis before installation.'
            : 'Review flagged structural items before proceeding with installation. Foundation sizing may require revision.'}
      </div>

      ${structuralRules.length > 0 ? `
      <div class="section-title">Structural Rules Check</div>
      <table class="equip-table">
        <thead><tr><th>Reference</th><th>Description</th><th>Result</th><th>Value / Limit</th><th>Status</th></tr></thead>
        <tbody>
          ${structuralRules.map(rule => `
          <tr style="background:${statusBg(rule.severity)}">
            <td class="mono f-lg">${rule.asceReference || rule.ruleId}</td>
            <td>${rule.title}</td>
            <td style="font-size:9px;color:#333">${rule.message}</td>
            <td style="font-family:monospace;font-size:9px;text-align:right">${rule.value !== undefined ? `${rule.value}${rule.limit !== undefined ? ` / ${rule.limit}` : ''}` : '—'}</td>
            <td style="text-align:center;font-weight:bold;color:${statusColor(rule.severity)}">${statusLabel(rule.severity)}</td>
          </tr>`).join('')}
        </tbody>
      </table>` : ''}
    </div>
  </div>`;
}



// ─── GROUND MOUNT STRUCTURAL ───────────────────────────────────────────────────
export function pageStructuralGround(input: PermitInput, cad: CADModel, pageNum: number, totalPages: number): string {
  const { compliance, rulesResult, project } = input;
  const structural = compliance.structural;
  const cp = projectCodeAuthorityFromInput(input); const asce = cp.asceLabel;  // W4 §2 single-source
  const ibcVer = cp.ibc ?? 'PENDING';
  const structuralRules = (rulesResult?.rules || []).filter(r => r.category === 'structural');
  // §9 — ground pile withdrawal is a DISTINCT named limit state whose bar
  // mirrors the engine of record (structural-engine-v4 ground pile ≥ 1.5,
  // ${asce} §12.13) — NOT the 1.0 roof-attachment ASD bar and NOT the old
  // self-contradicting "2.0" prose. One threshold, printed everywhere here.
  const GROUND_PILE_MIN_SF = 1.5;

  // W3 §7 — environmental values PROJECT from the single-sourced snapshot env
  // (no `|| 'C'` sheet default). Per-pile reactions remain on the ground
  // estimate path (compliance.structural) — documented in the AFTER report.
  const _proj = projectStructuralFromInput(input);
  const windSpeed   = _proj.present ? fmt(_proj.windSpeedMph) : (structural?.wind?.windSpeed || '—');
  const exposure    = _proj.present ? fmtStr(_proj.exposure) : (structural?.wind?.exposureCategory || project.exposureCategory || '—');
  const velPressure = structural?.wind?.velocityPressure?.toFixed(2) || '—';
  const upliftPsf   = structural?.wind?.netUpliftPressure?.toFixed(2) || '—';
  const upliftPile  = structural?.wind?.upliftPerAttachment?.toFixed(0) || '—';
  const groundSnow  = _proj.present && _proj.groundSnowPsf != null ? String(_proj.groundSnowPsf) : (structural?.snow?.groundSnowLoad ?? '—');
  const snowPile    = structural?.snow?.snowLoadPerAttachment?.toFixed(0) || '—';
  const totalDL     = structural?.totalDeadLoadPsf?.toFixed(1) || '—';
  const moduleDL    = structural?.moduleLoadPsf?.toFixed(1) || '—';
  const rackDL      = structural?.rackingLoadPsf?.toFixed(1) || '—';
  const safetyFact  = structural?.attachment?.safetyFactor?.toFixed(2) || '—';

  // CAD ground data
  const arr0       = cad.ground?.arrays?.[0];
  const pileDepth  = arr0 ? (arr0.pileDepthM * 3.28084).toFixed(1) : '5.0';
  const pileSp     = arr0 ? (arr0.pileSpacingM * 3.28084).toFixed(1) : '8.0';
  const groundClr  = arr0 ? (arr0.groundClearanceM * 39.3701).toFixed(0) : '12';
  const tiltDeg    = arr0?.tiltDeg || 20;
  const structType = arr0?.structureType || 'driven steel pipe pile';

  return `
  <div class="page">
    ${titleBlock(input, 'PV-4C', 'STRUCTURAL CALCULATION SHEET — GROUND MOUNT', pageNum, totalPages)}
    <div class="page-content">
      ${structuralBannerHtml(_proj.banner, { input, sheetId: 'PV-4C' })}
      <div class="section-title">Structural Analysis — ${asce} §27 (Ground-Mounted PV)</div>

      <div class="struct-grid">
        <!-- Wind Analysis -->
        <div class="struct-card">
          <div class="sct">Wind Analysis — ${asce} §27/29.4</div>
          <table class="calc-table">
            <tr><td>Design Wind Speed (Vult)</td><td class="cv">${windSpeed} mph</td></tr>
            <tr><td>Exposure Category</td><td class="cv">Cat. ${exposure}</td></tr>
            <tr><td>Velocity Pressure (qz)</td><td class="cv">${velPressure} psf</td></tr>
            <tr><td>Net Uplift Pressure</td><td class="cv">${upliftPsf} psf</td></tr>
            <tr><td>Uplift / Pile</td><td class="cv" style="font-weight:bold;">${upliftPile} lbs</td></tr>
            <tr><td>Wind Code Reference</td><td class="cv">${asce} §27 + §29.4</td></tr>
          </table>
        </div>

        <!-- Snow Analysis -->
        <div class="struct-card">
          <div class="sct">Snow Load — ${asce} §7</div>
          <table class="calc-table">
            <tr><td>Ground Snow Load (pg)</td><td class="cv">${groundSnow} psf</td></tr>
            <tr><td>Slope Reduction</td><td class="cv">Per array tilt (${tiltDeg}°)</td></tr>
            <tr><td>Snow Load / Pile</td><td class="cv">${snowPile} lbs</td></tr>
            <tr><td>Note</td><td class="cv">Roof slope reduction N/A — ground array</td></tr>
            <tr><td>Snow Code Reference</td><td class="cv">${asce} §7 (ground snow)</td></tr>
          </table>
        </div>

        <!-- Foundation Analysis -->
        <div class="struct-card">
          <div class="sct">Foundation Analysis — Pile/Pier</div>
          <table class="calc-table">
            <tr><td>Foundation Type</td><td class="cv">${structType}</td></tr>
            <tr><td>Pile Embedment Depth</td><td class="cv">${pileDepth} ft min. (below frost)</td></tr>
            <tr><td>Pile Spacing</td><td class="cv">${pileSp} ft O.C.</td></tr>
            <tr><td>Safety Factor</td><td class="cv" style="font-weight:bold;color:${Number(safetyFact) > 0 && Number(safetyFact) < GROUND_PILE_MIN_SF ? '#cc0000' : '#000'};">${safetyFact}${Number(safetyFact) > 0 ? ` (pile withdrawal — min. ${GROUND_PILE_MIN_SF.toFixed(1)})` : ''}</td></tr>
            <tr><td>Wind Code Reference</td><td class="cv">${asce} §27</td></tr>
          </table>
        </div>

        <!-- Array Geometry -->
        <div class="struct-card">
          <div class="sct">Array Geometry</div>
          <table class="calc-table">
            <tr><td>Tilt Angle</td><td class="cv">${tiltDeg}°</td></tr>
            <tr><td>Ground Clearance</td><td class="cv">${groundClr}" min.</td></tr>
            <tr><td>Arrays</td><td class="cv">${cad.ground?.arrays?.length || 1}</td></tr>
            <tr><td>Total Panels</td><td class="cv">${cad.totalPanels}</td></tr>
          </table>
        </div>
      </div>

      <!-- Dead Load Analysis — Ground Mount Specific -->
      <div class="section-title">Dead Load Analysis — Load to Pile/Pier Foundations</div>
      <table class="equip-table">
        <thead><tr><th>Component</th><th>Weight (PSF)</th><th>Notes</th></tr></thead>
        <tbody>
          <tr><td class="fw7">PV Modules</td><td class="tr mono">${moduleDL} PSF</td><td>Per manufacturer spec sheet, distributed over array footprint</td></tr>
          <tr class="bg-lt"><td class="fw7">Ground Mount Racking</td><td class="tr mono">${rackDL} PSF</td><td>Steel structure, purlins, module clamps, torque tubes</td></tr>
          <tr><td class="fw7">Electrical (Wiring, Conduit)</td><td class="tr mono">0.2 PSF</td><td>Estimate for home-run conduit + module leads</td></tr>
          <tr class="bg-lt" style="font-weight:bold;border-top:2px solid #000"><td class="fw7">TOTAL ADDED DEAD LOAD</td><td class="tr mono fw7">${totalDL} PSF</td><td>Transferred to ground mount pile/pier foundations</td></tr>
        </tbody>
      </table>
      <div style="padding:var(--xs);font-size:var(--f-md);line-height:1.5;border:var(--border);border-top:none;background:#fafafa;">
        <strong>DEAD LOAD INTERPRETATION:</strong>
        The total added dead load of ${totalDL} PSF is distributed uniformly over the array footprint.
        This load is transferred to the ground mount piles/piers and foundations via the racking structure.
        Foundations are evaluated to confirm adequate capacity for the combined loading condition per ${asce} §26 and §27.
        Dead load is combined with wind and snow per ${asce} §2.3 governing load combinations.
      </div>

      <!-- Standard Detail: Ground Mount Pile -->
      <div class="section-title">Standard Detail — Ground Mount Pile / Pier (Typical)</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--xs);border:var(--border);padding:var(--xs);">
        <div style="text-align:center;">
          <svg viewBox="0 0 300 240" width="280" height="220" style="display:block;margin:0 auto;">
            <!-- Sky -->
            <rect x="0" y="0" width="300" height="110" fill="#e8f4f8"/>
            <!-- Grade line -->
            <rect x="0" y="110" width="300" height="15" fill="#8B7355" stroke="#000" stroke-width="1.2"/>
            <text x="150" y="121" text-anchor="middle" font-size="7.5" fill="#fff" font-weight="bold">FINISH GRADE</text>
            <!-- Below grade -->
            <rect x="0" y="125" width="300" height="115" fill="#c8a96e" stroke="#000" stroke-width="0.5"/>
            <text x="150" y="180" text-anchor="middle" font-size="7" fill="#333">DRIVEN PILE / PIER</text>
            <!-- Pile -->
            <rect x="138" y="60" width="24" height="175" fill="#444" stroke="#000" stroke-width="1.5"/>
            <!-- Tilted module on rack -->
            <g transform="translate(150,60)">
              <line x1="-55" y1="0" x2="55" y2="-30" stroke="#888" stroke-width="2"/>
              <rect x="-55" y="-5" width="110" height="40" fill="#2255aa" stroke="#000" stroke-width="1" transform="rotate(-15,-55,0)"/>
            </g>
            <text x="150" y="48" text-anchor="middle" font-size="7" fill="#2255aa" font-weight="bold">PV MODULE (${tiltDeg}° TILT)</text>
            <!-- Ground clearance dimension -->
            <line x1="170" y1="95" x2="215" y2="95" stroke="#c00" stroke-width="0.6" stroke-dasharray="2,1"/>
            <line x1="170" y1="110" x2="215" y2="110" stroke="#c00" stroke-width="0.6" stroke-dasharray="2,1"/>
            <line x1="210" y1="95" x2="210" y2="110" stroke="#c00" stroke-width="1"/>
            <text x="218" y="105" font-size="6.5" fill="#c00" font-weight="bold">${groundClr}"</text>
            <text x="218" y="113" font-size="6" fill="#c00">CLR</text>
            <!-- Pile depth dimension -->
            <line x1="170" y1="110" x2="235" y2="110" stroke="#0055cc" stroke-width="0.6" stroke-dasharray="2,1"/>
            <line x1="170" y1="238" x2="235" y2="238" stroke="#0055cc" stroke-width="0.6" stroke-dasharray="2,1"/>
            <line x1="230" y1="110" x2="230" y2="238" stroke="#0055cc" stroke-width="1"/>
            <polygon points="226,110 234,110 230,104" fill="#0055cc"/>
            <polygon points="226,238 234,238 230,244" fill="#0055cc"/>
            <text x="238" y="176" font-size="7" fill="#0055cc" font-weight="bold">${pileDepth} ft</text>
            <text x="238" y="185" font-size="6" fill="#0055cc">EMBED</text>
            <!-- Wind arrow -->
            <line x1="20" y1="75" x2="60" y2="75" stroke="#0055cc" stroke-width="2"/>
            <polygon points="60,71 60,79 70,75" fill="#0055cc"/>
            <text x="5" y="68" font-size="7" fill="#0055cc" font-weight="bold">WIND</text>
          </svg>
        </div>
        <div style="font-size:var(--f-sm);line-height:1.7;">
          <div style="font-weight:900;font-size:9px;margin-bottom:5px;letter-spacing:0.5px;border-bottom:1px solid #ccc;padding-bottom:3px;">GROUND MOUNT PILE REQUIREMENTS</div>
          <div style="margin-bottom:3px;">1. Pile type: ${structType} — verify diameter and wall thickness with geotechnical report.</div>
          <div style="margin-bottom:3px;">2. Embedment: <strong>${pileDepth} ft min.</strong> below finish grade — must be below local frost depth.</div>
          <div style="margin-bottom:3px;">3. Pile spacing: <strong>${pileSp} ft O.C.</strong> per structural analysis — see array layout on PV-1.</div>
          <div style="margin-bottom:3px;">4. Ground clearance: <strong>${groundClr}" min.</strong> from lowest module edge to finish grade.</div>
          <div style="margin-bottom:3px;">5. Tilt angle: <strong>${tiltDeg}°</strong> from horizontal — verify per final array design.</div>
          <div style="margin-bottom:3px;">6. Grounding: Drive ground rod per NEC 690.47 — bond all metallic structure per NEC 250.97.</div>
          <div style="margin-bottom:3px;">7. Geotechnical: Pile capacity shall be confirmed by geotechnical engineer before final design.</div>
          <div style="color:#555;font-size:7px;margin-top:5px;font-style:italic;">Frost depth varies by location — verify with local building department and ${asce} §C3.3.</div>
        </div>
      </div>

      <!-- Governing Load Combination — Ground Mount -->
      <div class="section-title">Governing Load Combination — ${asce} §2.3</div>
      <div style="padding:var(--xs);font-size:var(--f-md);line-height:1.6;border:var(--border);border-top:none;">
        <table class="info-table" style="margin-bottom:var(--xs);">
          <tr><td class="il" style="width:100px;">${asce}</td><td class="iv">Minimum Design Loads and Associated Criteria for Buildings and Other Structures</td></tr>
          <tr><td class="il">${ibcVer} IBC</td><td class="iv">International Building Code — Chapter 16: Structural Design</td></tr>
          <tr><td class="il">${ibcVer} IRC</td><td class="iv">International Residential Code — Section R301: Design Criteria</td></tr>
        </table>
        <div style="font-size:var(--f-sm);color:#000;">
          <strong>GOVERNING LOAD COMBINATION (${asce} §2.3) — GROUND-MOUNTED PV:</strong>
          The controlling load case for ground-mounted PV is <strong>0.9D + 1.0W</strong> (net uplift on array).
          Pile lateral capacity and moment resistance are sized for the governing wind uplift condition.
          Snow loading combination <strong>1.2D + 1.6S + 0.5W</strong> is evaluated for gravity/snow; wind uplift governs
          at most exposure categories. All pile foundations shall develop the required capacity with a minimum
          safety factor of ${GROUND_PILE_MIN_SF.toFixed(1)} against pile withdrawal (distinct limit state; ${asce} §12.13).
        </div>
      </div>
      ${structural ? `<div style="padding:var(--xs);font-size:var(--f-md);line-height:1.5;border:var(--border);border-top:none;background:#fafafa;">
        <strong>STRUCTURAL ANALYSIS INTERPRETATION — GROUND MOUNT:</strong>
        Wind analysis per ${asce} §27 indicates a net uplift of ${upliftPile} lbs per pile at the design wind speed
        of ${windSpeed} mph (Exposure Category ${exposure}).
        ${Number(groundSnow) > 0 ? `Snow loading contributes ${snowPile} lbs per pile at the ${groundSnow} PSF ground snow load per ${asce} §7.` : 'Snow loading is not a controlling factor at this location.'}
        Roof slope reduction factors do not apply to ground-mounted arrays — ground snow load governs per ${asce} §7.
        Ground mount pile/pier capacity confirmed adequate for the imposed wind uplift and dead loads per ${asce} §27.
        ${Number(safetyFact) > 0 ? `Safety factor of ${safetyFact} confirmed ${Number(safetyFact) >= GROUND_PILE_MIN_SF ? 'above' : 'BELOW'} the required pile-withdrawal minimum of ${GROUND_PILE_MIN_SF.toFixed(1)} (demand 0.6W vs allowable capacity — ${asce} §2.4 / §12.13).` : 'Safety factor data not available — verify attachment capacity per engineering analysis.'}
      </div>` : ''}
      <div style="padding:var(--xs);margin-top:var(--sm);font-size:var(--f-md);line-height:1.5;border:2px solid #000;background:#fff;">
        <strong>PAGE CONCLUSION — GROUND MOUNT STRUCTURAL ANALYSIS:</strong>
        The proposed ground-mounted photovoltaic array and pile/pier foundation system have been analyzed for
        wind uplift, snow, dead load, and pile capacity per ${asce} §27 and ${ibcVer} IBC.
        ${structural && structural.attachment?.safetyFactor != null && structural.attachment.safetyFactor >= GROUND_PILE_MIN_SF
          ? `All structural parameters are within acceptable limits. The proposed ground mount pile/pier foundation
             system is adequate to support the proposed PV array without modification.`
          : structural && structural.attachment?.safetyFactor == null
            ? 'Structural analysis data incomplete — verify all parameters per engineering analysis before installation.'
            : 'Review flagged structural items before proceeding with installation. Pile sizing may require revision.'}
      </div>

      ${structuralRules.length > 0 ? `
      <div class="section-title">Structural Rules Check</div>
      <table class="equip-table">
        <thead><tr><th>Reference</th><th>Description</th><th>Result</th><th>Value / Limit</th><th>Status</th></tr></thead>
        <tbody>
          ${structuralRules.map(rule => `
          <tr style="background:${statusBg(rule.severity)}">
            <td class="mono f-lg">${rule.asceReference || rule.ruleId}</td>
            <td>${rule.title}</td>
            <td style="font-size:9px;color:#333">${rule.message}</td>
            <td style="font-family:monospace;font-size:9px;text-align:right">${rule.value !== undefined ? `${rule.value}${rule.limit !== undefined ? ` / ${rule.limit}` : ''}` : '—'}</td>
            <td style="text-align:center;font-weight:bold;color:${statusColor(rule.severity)}">${statusLabel(rule.severity)}</td>
          </tr>`).join('')}
        </tbody>
      </table>` : ''}
    </div>
  </div>`;
}



// ─── ROOF STRUCTURAL ──────────────────────────────────────────────────────────
export function pageStructuralRoof(input: PermitInput, cad: CADModel, pageNum: number, totalPages: number, part: 1 | 2 = 1): string {
  const { compliance, rulesResult, project } = input;
  const structural = compliance.structural;
  const cp = projectCodeAuthorityFromInput(input); const asce = cp.asceLabel;  // W4 §2 single-source
  const ibcVer = cp.ibc ?? 'PENDING';
  // Structural engine V4 (compliance.structural) is the engine of record on
  // this sheet — drop rules-engine rows that carry their OWN rafter/uplift
  // numbers, which contradicted the V4 tables printed right beside them
  // (73% PASS vs 89%/145%, 370/984 lbs vs 210/500 lbs on one package).
  const structuralRules = (rulesResult?.rules || []).filter(r =>
    r.category === 'structural' && !/rafter|uplift|attach/i.test(String(r.ruleId || '')));

  // W3 §5/§7/§9 — PROJECT from the canonical snapshot: environmental values are
  // single-sourced (env), the lag-bolt attachment result is the snapshot
  // attachment-uplift CHECK (demand/capacity/SF/threshold), and the framing
  // limit state is honest (review-required when framing unverified — no
  // fabricated truss pass). No sheet-local wind default, no `?? 2` multiplier.
  const _proj = projectStructuralFromInput(input);
  const _attChk = findCheck(_proj, 'attachment-uplift');
  const _framingChk = findCheck(_proj, 'framing-capacity');
  const _reviewRequired = _proj.engine?.engineeringReviewRequired ?? false;
  const _attThreshold = _attChk?.requiredThreshold ?? MIN_ATTACHMENT_SF;
  const windSpeed   = _proj.present ? fmt(_proj.windSpeedMph) : (structural?.wind?.windSpeed || '—');
  const exposure    = _proj.present ? fmtStr(_proj.exposure) : (structural?.wind?.exposureCategory || '—');
  const velPressure = structural?.wind?.velocityPressure?.toFixed(2) || '—';
  const upliftPsf   = structural?.wind?.netUpliftPressure?.toFixed(2) || '—';
  const upliftAtt   = _attChk?.demand != null ? _attChk.demand.toFixed(0) : (structural?.wind?.upliftPerAttachment?.toFixed(0) || '—');
  const groundSnow  = _proj.present && _proj.groundSnowPsf != null ? String(_proj.groundSnowPsf) : (structural?.snow?.groundSnowLoad ?? '—');
  const roofSnow    = _proj.present && _proj.roofSnowPsf != null ? _proj.roofSnowPsf.toFixed(1) : (structural?.snow?.roofSnowLoad?.toFixed(1) || '—');
  const snowAtt     = structural?.snow?.snowLoadPerAttachment?.toFixed(0) || '—';
  const totalDL     = structural?.totalDeadLoadPsf?.toFixed(1) || '—';
  const moduleDL    = structural?.moduleLoadPsf?.toFixed(1) || '—';
  const rackDL      = structural?.rackingLoadPsf?.toFixed(1) || '—';

  // Lag-bolt attachment = snapshot attachment-uplift check (capacity = allowable,
  // demand = ASD uplift, SF = capacity/demand). No `(safetyFactor||2)` derive.
  const lagCap      = _attChk?.capacity != null ? _attChk.capacity.toFixed(0) : (structural?.attachment?.lagBoltCapacity?.toFixed(0) || '—');
  const safetyFact  = _attChk?.safetyFactor != null ? _attChk.safetyFactor.toFixed(2) : (structural?.attachment?.safetyFactor?.toFixed(2) || '—');
  // §9 — the mount ALLOWABLE (RT-MINI 600 lb) is UNVERIFIED while a blocking
  // racking-capacity gap is active. No sheet may render a capacity PASS from it:
  // gate the capacity value, the safety factor and the verdict to PENDING. The
  // DEMAND numbers (uplift/snow per attachment) stay printed — they are canonical.
  const _capGated   = _proj.capacityGated === true;
  const lagCapDisp  = _capGated ? 'UNVERIFIED / PENDING STRUCTURAL SOURCE' : `${lagCap} lbs`;
  const sfCellHtml  = _capGated
    ? `<span style="font-weight:bold;color:#b45309;">PENDING — CAPACITY SOURCE UNVERIFIED</span>`
    : `<span style="font-weight:bold;color:${Number(safetyFact) > 0 && Number(safetyFact) < _attThreshold ? '#cc0000' : '#000'};">${safetyFact}${Number(safetyFact) > 0 ? ` (ASD — min. ${_attThreshold.toFixed(1)})` : ''}</span>`;
  const _attVerdict = _capGated ? 'PENDING — CAPACITY SOURCE UNVERIFIED' : (_attChk ? checkResultLabel(_attChk) : '—');
  const maxSpacing  = _proj.attachmentSpacingIn ?? structural?.attachment?.maxAllowedSpacing ?? '—';
  const _utilRatio = structural?.rafter?.utilizationRatio; // GOVERNING ratio (max of bending/deflection)
  const utilization = _utilRatio != null ? (_utilRatio * 100).toFixed(0) : '—';
  const rafterBM    = structural?.rafter?.bendingMoment?.toFixed(0) || '—';
  const rafterABM   = structural?.rafter?.allowableBendingMoment?.toFixed(0) || '—';
  const rafterDefl  = structural?.rafter?.deflection?.toFixed(3) || '—';
  const rafterAD    = structural?.rafter?.allowableDeflection?.toFixed(3) || '—';
  // Per-check ratios — printing the governing ratio beside the bending numbers
  // read as "1116 of 1246 allowable = 145%", an impossible line an AHJ rejects.
  const _bmRaw   = structural?.rafter?.bendingMoment;
  const _abmRaw  = structural?.rafter?.allowableBendingMoment;
  const _bendRatio = (_bmRaw != null && _abmRaw) ? _bmRaw / _abmRaw : null;
  const _deflRaw = structural?.rafter?.deflection;
  const _adRaw   = structural?.rafter?.allowableDeflection;
  const _deflRatio = (_deflRaw != null && _adRaw) ? _deflRaw / _adRaw : null;
  const bendUtil = _bendRatio != null ? (_bendRatio * 100).toFixed(0) : '—';
  const _governs = (_deflRatio ?? 0) > (_bendRatio ?? 0) ? 'deflection' : 'bending';
  // "TOTAL ADDED DEAD LOAD" must equal the sum of the component rows above it —
  // totalDeadLoadPsf is EXISTING roof + PV, a different (also useful) number.
  const _addedRaw = (structural?.moduleLoadPsf != null || structural?.rackingLoadPsf != null)
    ? (structural?.moduleLoadPsf ?? 0) + (structural?.rackingLoadPsf ?? 0) + 0.2
    : null;
  const addedDL = _addedRaw != null ? _addedRaw.toFixed(1) : '—';
  // Truss framing is analyzed by load capacity (PSF), not rafter bending (ft-lbs).
  // Rendering its 0-demand / capacity-in-PSF as "0 ft-lbs / 45 ft-lbs" read as broken.
  const _isTruss      = (structural?.rafter?.framingType === 'truss') || (structural?.rafter?.bendingMoment === 0 && (structural?.rafter?.allowableBendingMoment || 0) > 0);
  const trussCapPsf   = structural?.rafter?.allowableBendingMoment?.toFixed(0) || '—';
  const trussLoadPsf  = structural?.rafter?.totalLoadPsf?.toFixed(1) || '—';
  const totalUplift = structural?.attachment?.totalUpliftPerAttachment?.toFixed(0) || '—';

  const rafterSize  = project.rafterSize || '2×6';
  const rafterSpace = project.rafterSpacing || 24;
  // Same resolution chain as PV-3/PE-1 (engineering-resolved → user input →
  // racking rated max) and lag spec from the SELECTED mounting system — the
  // requirements block used to print "3/8" / 48" max" beside a lag analysis
  // that resolved 5/16" @ 24" for the same job.
  const _mountSel   = project.mountingSystemId ? getMountingSystemById(project.mountingSystemId) : undefined;
  // PPC §3 — DEAD + mis-modelled: this read `compliance.structural.attachment
  // .maxAllowedSpacing` (the same legacy field whose NAME was the §3 root cause)
  // and had NO consumer. The canonical spacing authority (`_spc`, below) is the
  // ONE source every PV-4C/PV-4C.1 spacing string projects.
  const _fracIn = (v: number) =>
    v === 0.25 ? '1/4' : v === 0.3125 ? '5/16' : v === 0.375 ? '3/8' : v === 0.5 ? '1/2' : `${v}`;
  // §12 — the ONE canonical fastener assembly (identical projection on PV-3 /
  // APP-A / PE-1 / SCHED). PV-4C's attachment detail reads its diameter, embedment
  // and TYPE from here — never a generic "5/16 stainless lag" literal (RT-MINI is
  // a structural wood screw). While unverified, the cert label reads PENDING.
  const _fa       = projectFastenerAssembly(input);
  const lagDia    = _fa.diameterLabel ?? _fracIn(_mountSel?.mount?.fastenerDiameterIn ?? 0.375);
  const lagEmbed  = _fa.embedmentIn ?? _mountSel?.mount?.fastenerEmbedmentIn ?? 2.5;
  const _faType   = _fa.fastenerType ?? 'structural fastener';
  // §14 — the ONE canonical spacing authority. "MAXIMUM ALLOWED" language renders
  // ONLY when a verified source establishes it; otherwise the sheet prints the
  // DESIGN spacing + PENDING STRUCTURAL VERIFICATION (never 48" as an allowable).
  const _spc      = _proj.spacingAuthority;
  const _spcVerified = _spc.verificationState === 'verified';
  // §2 (BAR) — every wind/snow design value on PV-4C carries the ENVIRONMENTAL
  // LOAD AUTHORITY's basis + verification state inline (gate 2). Rendered as a
  // compact tag in the value cell (no added rows — PV-4C is page-fit critical);
  // the full "SOURCE: … — NOT VERIFIED" line prints on the page conclusion below
  // and on PE-1's Site Loading Parameters.
  const _envTag      = _proj.environmentalStateTag;
  const _envTagColor = _proj.environmentalUnverified ? '#b45309' : '#000';

  // ── PV-4C is split into TWO physical sheets (W9/§15 page-fit): the combined
  // wind/snow/framing/attachment analysis + dead-load + reaction schedule ran
  // ~15in of content, ~5in past the fixed 11in page, silently clipping the page
  // conclusion under overflow:hidden. PV-4C carries the summary + governing
  // checks + canonical §8 reaction schedule; the attachment standard detail,
  // governing ASD load combination, interpretation and page conclusion move to
  // the FORMAL continuation sheet PV-4C.1 (own title block + manifest entry +
  // snapshot-bound sheet index + page number). The full per-attachment data
  // stays in the machine-readable canonical object model regardless. ──
  if (part !== 2) {
  return `
  <div class="page">
    ${titleBlock(input, 'PV-4C', 'STRUCTURAL CALCULATION SHEET — ROOF MOUNT', pageNum, totalPages)}
    <div class="page-content">
      ${structuralBannerHtml(_proj.banner, { input, sheetId: 'PV-4C' })}
      <div class="section-title">Structural Analysis — ${asce} §26/27 (Roof-Mounted PV)</div>

      <div class="struct-grid">
        <!-- Wind Analysis -->
        <div class="struct-card">
          <div class="sct">Wind Analysis — ${asce} §26/27</div>
          <table class="calc-table">
            <tr><td>Design Wind Speed (Vult)</td><td class="cv">${windSpeed} mph <span data-env-source="pv-4c-wind" style="font-size:5.4px;font-weight:bold;color:${_envTagColor};">[${escapeH(_envTag)}]</span></td></tr>
            <tr><td>Exposure Category</td><td class="cv">Cat. ${exposure}${_proj.riskCategory ? ` &middot; RISK ${escapeH(String(_proj.riskCategory))}` : ''}</td></tr>
            <tr><td>Velocity Pressure (qz)</td><td class="cv">${velPressure} psf</td></tr>
            <tr><td>Net Uplift Pressure</td><td class="cv">${upliftPsf} psf</td></tr>
            <tr><td>Uplift per Attachment</td><td class="cv" style="font-weight:bold;">${upliftAtt} lbs</td></tr>
          </table>
        </div>

        <!-- Snow Analysis -->
        <div class="struct-card">
          <div class="sct">Snow Analysis — ${asce} §7</div>
          <table class="calc-table">
            <tr><td>Ground Snow Load (pg)</td><td class="cv">${groundSnow} psf <span data-env-source="pv-4c-snow" style="font-size:5.4px;font-weight:bold;color:${_envTagColor};">[${escapeH(_envTag)}]</span></td></tr>
            <tr><td>Roof Snow Load (ps)</td><td class="cv">${roofSnow} psf</td></tr>
            <tr><td>Snow per Attachment</td><td class="cv" style="font-weight:bold;">${snowAtt} lbs</td></tr>
          </table>
        </div>

        <!-- Roof Framing Analysis -->
        <div class="struct-card">
          <div class="sct">${_isTruss ? 'Roof Framing Analysis — Pre-Engineered Truss' : 'Rafter Analysis — Existing Framing'}</div>
          <table class="calc-table">
            <tr><td>${_isTruss ? 'Truss @ Spacing' : 'Rafter Size'}</td><td class="cv">${rafterSize} @ ${rafterSpace}" O.C.</td></tr>
            ${_reviewRequired ? `
            <tr><td>Observed Framing</td><td class="cv" data-observed-framing="pv-4c">${escapeH(_proj.observedFramingLine)}</td></tr>
            <tr><td>Source</td><td class="cv" style="font-size:6.5px;color:#b45309;">${escapeH(_proj.observedFramingSource)}</td></tr>
            <tr><td>Framing Capacity</td><td class="cv" style="font-weight:bold;color:#b91c1c;">NOT VERIFIED</td></tr>
            <tr><td>Utilization</td><td class="cv" style="font-weight:bold;color:#b45309;">REVIEW REQ.</td></tr>
            ` : _isTruss ? `
            <tr><td>Truss Load Capacity</td><td class="cv">${trussCapPsf} PSF</td></tr>
            <tr><td>Total Roof Load</td><td class="cv">${trussLoadPsf} PSF</td></tr>
            <tr><td>Utilization Ratio</td><td class="cv" style="font-weight:bold;color:${_utilRatio != null && _utilRatio > 1.0 ? '#cc0000' : '#000'};">${utilization}${_utilRatio != null ? '%' : ''}</td></tr>
            <tr><td>Basis</td><td class="cv">BCSI pre-eng. truss capacity</td></tr>
            ` : `
            <tr><td>Bending Moment</td><td class="cv">${rafterBM} ft-lbs</td></tr>
            <tr><td>Allowable Moment</td><td class="cv">${rafterABM} ft-lbs</td></tr>
            <tr><td>Bending Utilization</td><td class="cv" style="font-weight:bold;color:${_bendRatio != null && _bendRatio > 1.0 ? '#cc0000' : '#000'};">${bendUtil}${_bendRatio != null ? '%' : ''}</td></tr>
            <tr><td>Deflection / Allowed</td><td class="cv" style="color:${_deflRatio != null && _deflRatio > 1.0 ? '#cc0000' : '#000'};">${rafterDefl}" / ${rafterAD}"</td></tr>
            <tr><td>Governing Check</td><td class="cv" style="font-weight:bold;color:${_utilRatio != null && _utilRatio > 1.0 ? '#cc0000' : '#000'};">${_utilRatio != null ? `${_governs} — ${utilization}%` : '—'}</td></tr>
            `}
          </table>
        </div>

        <!-- Attachment Analysis -->
        <div class="struct-card">
          <div class="sct">Lag Bolt Attachment Analysis</div>
          <table class="calc-table">
            <tr><td>Attachment Capacity (allowable)</td><td class="cv"${_capGated ? ' style="color:#b45309;font-weight:bold;"' : ''}>${lagCapDisp}</td></tr>
            <tr><td>Total Uplift / Attachment</td><td class="cv">${totalUplift} lbs</td></tr>
            <tr><td>Capacity Check (SF)</td><td class="cv">${sfCellHtml}</td></tr>
            <tr><td>Attach Spacing (design)</td><td class="cv">${_spc.designSpacingIn != null ? _spc.designSpacingIn + '&quot; O.C.' : (maxSpacing !== '—' ? maxSpacing + '&quot;' : '—')} <span style="font-weight:bold;color:${_spcVerified ? '#000' : '#b45309'};">${_spcVerified ? '&mdash; MAX ALLOWED (VERIFIED)' : '&mdash; PENDING VERIF.'}</span></td></tr>
          </table>
          ${_capGated ? `<div style="font-size:6.5px;line-height:1.3;color:#b45309;padding:2px 3px;">CAPACITY GATE (§9): the published allowable is UNVERIFIED (RT-MINI structural source not archived / applicability unconfirmed). Demand is canonical; the capacity comparison is INDETERMINATE pending a verified structural source — no PASS is asserted.</div>` : ''}
        </div>
      </div>

      <!-- Dead Load Analysis — Roof Specific -->
      <div class="section-title">Dead Load Analysis — Added Weight to Existing Roof Structure</div>
      <table class="equip-table">
        <thead><tr><th>Component</th><th>Weight (PSF)</th><th>Notes</th></tr></thead>
        <tbody>
          <tr><td class="fw7">PV Modules</td><td class="tr mono">${moduleDL} PSF</td><td>Per manufacturer spec sheet, distributed over array area</td></tr>
          <tr class="bg-lt"><td class="fw7">Racking / Rails</td><td class="tr mono">${rackDL} PSF</td><td>Aluminum rail + L-foot + clamp assembly</td></tr>
          <tr><td class="fw7">Electrical (Wiring, Conduit)</td><td class="tr mono">0.2 PSF</td><td>Estimate for home-run conduit + module leads</td></tr>
          <tr class="bg-lt" style="font-weight:bold;border-top:2px solid #000"><td class="fw7">TOTAL ADDED DEAD LOAD</td><td class="tr mono fw7">${addedDL} PSF</td><td>Sum of PV components above — added to the existing roof</td></tr>
          <tr style="font-weight:bold;"><td class="fw7">COMBINED ROOF DEAD LOAD</td><td class="tr mono fw7">${totalDL} PSF</td><td>Existing roof construction (typically 8–12 PSF) + PV system</td></tr>
        </tbody>
      </table>
      <div style="padding:var(--xs);font-size:var(--f-md);line-height:1.5;border:var(--border);border-top:none;background:#fafafa;">
        <strong>DEAD LOAD INTERPRETATION:</strong>
        The added PV dead load of ${addedDL} PSF is distributed uniformly over the array footprint, for a combined roof
        dead load of ${totalDL} PSF. This represents a minimal addition relative to the existing roof dead load (typically
        8–12 PSF for asphalt shingle on plywood sheathing).
        ${_reviewRequired
          ? `<strong style="color:#b91c1c;">OBSERVED FRAMING: ${escapeH(_proj.observedFramingLine)} — ${escapeH(_proj.observedFramingSource)}. EXISTING FRAMING CAPACITY NOT VERIFIED / PROJECT-SPECIFIC STRUCTURAL REVIEW REQUIRED.</strong>
             The observed framing geometry is OPERATOR-ENTERED OBSERVATION and does not verify capacity; the existing framing
             capacity is not established from a verified project authority (archived truss drawing, manufacturer calc, stamped
             analysis, or a digest-bound engineer review), so NO framing utilization, capacity or adequacy conclusion is
             asserted on this sheet — only the ADDED PV load is quantified above.`
          : _utilRatio != null
            ? `The existing roof structure is evaluated to confirm adequate capacity for the combined loading condition per
               IBC Section 1607. The governing ${_governs} check at ${utilization}%
               ${_utilRatio <= 1.0 ? 'confirms the existing framing has adequate capacity' : 'indicates the modeled framing requires field verification of actual framing type/span or reinforcement'}
               for the additional PV loading${_utilRatio > 1.0 ? ' (bending utilization ' + bendUtil + '%; deflection ' + rafterDefl + '" vs ' + rafterAD + '" allowable)' : ''}.`
            : 'Framing utilization data is not available — verify existing framing capacity per engineering analysis before installation.'}
      </div>

      <!-- §8 Attachment-ID Reaction Schedule (canonical objects). The §8
           reconciliation block renders on PV-4C.1 — post-AAC clip repair: it was
           the last data-dependent stack on this sheet, and one extra live
           load-case group pushed the continuation strip past the clip box. -->
      ${renderReactionSchedule(_proj)}
      <!-- page-fit: this continuation strip is the LAST block on PV-4C, so its box
           model is the sheet's fit margin. Tightened (BAR) after the §2 environmental
           provenance tags + the restored 20 psf snow row pushed the sheet 6px over. -->
      <div style="padding:1px 5px;margin-top:0;font-size:7px;line-height:1.18;border:var(--border);background:#f4f4f4;">
        <strong>CONTINUED ON PV-4C.1:</strong> the §8 reaction reconciliation (Σ reactions vs applied load), the roof-attachment
        standard detail, the governing ASD load combination (${asce} §2.4), the structural interpretation and the roof
        structural PAGE CONCLUSION continue on sheet <strong>PV-4C.1</strong>.
      </div>
    </div>
  </div>`;
  }

  // ── PV-4C.1 — FORMAL CONTINUATION SHEET ───────────────────────────────────
  return `
  <div class="page">
    ${titleBlock(input, 'PV-4C.1', 'STRUCTURAL CALCULATIONS (CONT.) — DETAIL · LOAD COMBINATION · CONCLUSION', pageNum, totalPages)}
    <div class="page-content">
      ${structuralBannerHtml(_proj.banner, { input, sheetId: 'PV-4C.1' })}
      <div class="section-title">Roof Structural Calculations (Continued from PV-4C) — ${asce} §26/27 (Roof-Mounted PV)</div>

      <!-- §8 Reaction Reconciliation — continued from the PV-4C reaction schedule
           (post-AAC clip repair: deterministic placement here, never a data-driven
           overflow off PV-4C's fixed page). -->
      ${renderReactionReconciliation(_proj)}

      <!-- Standard Detail: Roof Attachment -->
      <div class="section-title">Standard Detail — Roof Attachment (Fastener per Racking Assembly, Typical)</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--xs);border:var(--border);padding:var(--xs);">
        <div style="text-align:center;">
          <svg viewBox="0 0 300 240" width="212" height="170" style="display:block;margin:0 auto;font-family:Arial,Helvetica,sans-serif;">
            <defs><pattern id="rt-woodhatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" stroke="#c8a56f" stroke-width="0.6"/></pattern></defs>
            <!-- rafter (wood, hatched) -->
            <rect x="20" y="134" width="260" height="60" fill="#efe0c4" stroke="#7a5a2e" stroke-width="1.4"/>
            <rect x="20" y="134" width="260" height="60" fill="url(#rt-woodhatch)"/>
            <text x="40" y="178" font-size="8.5" font-weight="bold" fill="#5a4322">RAFTER (${rafterSize})</text>
            <!-- sheathing -->
            <rect x="20" y="119" width="260" height="15" fill="#f2ead8" stroke="#8a7a58" stroke-width="1"/>
            <text x="40" y="130" font-size="6.5" fill="#5a5340">ROOF SHEATHING (5/8" OSB)</text>
            <!-- roofing (asphalt shingle courses) -->
            <rect x="20" y="107" width="260" height="12" fill="#c4c9d2" stroke="#5b6472" stroke-width="0.8"/>
            <g stroke="#94a0af" stroke-width="0.5"><line x1="70" y1="107" x2="70" y2="119"/><line x1="120" y1="107" x2="120" y2="119"/><line x1="170" y1="107" x2="170" y2="119"/><line x1="220" y1="107" x2="220" y2="119"/></g>
            <text x="40" y="116" font-size="6.5" fill="#3b4250">ASPHALT SHINGLE</text>
            <!-- flashing (metal, under upslope course) -->
            <path d="M 98,86 L 98,109 L 202,109 L 202,86 L 190,86 L 190,101 L 110,101 L 110,86 Z" fill="#e4e7ec" stroke="#5b6472" stroke-width="1.1"/>
            <text x="150" y="96" text-anchor="middle" font-size="6.5" fill="#3b4250" font-weight="bold">FLASHING</text>
            <!-- L-foot (aluminum) -->
            <path d="M 138,68 L 138,88 L 162,88 L 162,80 L 148,80 L 148,68 Z" fill="#d4dae2" stroke="#3b4250" stroke-width="1.2"/>
            <line x1="163" y1="81" x2="174" y2="81" stroke="#3b4250" stroke-width="0.5"/>
            <text x="176" y="82" font-size="6.5" fill="#3b4250" font-weight="bold">L-FOOT</text>
            <!-- rail (top-hat, edge on) -->
            <rect x="112" y="54" width="76" height="14" fill="#d4dae2" stroke="#3b4250" stroke-width="1.1" rx="1"/>
            <rect x="140" y="57" width="20" height="8" fill="none" stroke="#8a94a6" stroke-width="0.6"/>
            <text x="150" y="64" text-anchor="middle" font-size="6.5" fill="#3b4250" font-weight="bold">RAIL</text>
            <!-- PV module (edge on) + clamp -->
            <rect x="70" y="40" width="160" height="13" fill="#2a3444" stroke="#1a2230" stroke-width="1"/>
            <rect x="70" y="40" width="160" height="4" fill="#4a5568"/>
            <rect x="145" y="49" width="10" height="6" fill="#8a94a6" stroke="#3b4250" stroke-width="0.6"/>
            <text x="120" y="35" text-anchor="middle" font-size="7" fill="#1a2230" font-weight="bold">PV MODULE</text>
            <!-- lag screw: hex head + shank + thread into rafter -->
            <rect x="146" y="86" width="8" height="6" fill="#6b7280" stroke="#3b4250" stroke-width="0.8"/>
            <line x1="150" y1="92" x2="150" y2="184" stroke="#6b7280" stroke-width="2.4"/>
            <g stroke="#3b4250" stroke-width="0.5"><line x1="146" y1="152" x2="154" y2="152"/><line x1="146" y1="158" x2="154" y2="158"/><line x1="146" y1="164" x2="154" y2="164"/><line x1="146" y1="170" x2="154" y2="170"/><line x1="146" y1="176" x2="154" y2="176"/></g>
            <text x="160" y="130" font-size="6.5" fill="#1a2230">FASTENER</text>
            <text x="160" y="138" font-size="6.5" fill="#1a2230">${_fa.nonOrderable ? 'PENDING' : lagDia + '&quot; DIA'}</text>
            <!-- embedment dimension -->
            <line x1="163" y1="134" x2="212" y2="134" stroke="#5b6472" stroke-width="0.5"/>
            <line x1="163" y1="184" x2="212" y2="184" stroke="#5b6472" stroke-width="0.5"/>
            <line x1="207" y1="134" x2="207" y2="184" stroke="#334155" stroke-width="0.9"/>
            <polygon points="204,139 210,139 207,134" fill="#334155"/>
            <polygon points="204,179 210,179 207,184" fill="#334155"/>
            <text x="214" y="160" font-size="7" fill="#334155" font-weight="bold">${_fa.nonOrderable ? 'PENDING' : lagEmbed + '&quot;'}</text>
            <text x="214" y="168" font-size="5.6" fill="#5b6472">MIN EMBED</text>
            <!-- uplift arrow -->
            <line x1="248" y1="38" x2="248" y2="20" stroke="#b23b2e" stroke-width="1.8"/>
            <polygon points="244,22 252,22 248,15" fill="#b23b2e"/>
            <text x="240" y="30" font-size="6.5" fill="#b23b2e" font-weight="bold" text-anchor="end">UPLIFT</text>
          </svg>
        </div>
        <div style="font-size:var(--f-sm);line-height:1.7;">
          <div style="font-weight:900;font-size:9px;margin-bottom:5px;letter-spacing:0.5px;border-bottom:1px solid #ccc;padding-bottom:3px;">ROOF ATTACHMENT REQUIREMENTS</div>
          <div style="margin-bottom:3px;">1. Fastener: ${_fa.nonOrderable
            ? `<strong style="color:#b45309;">${escapeH(FASTENER_NON_ORDERABLE_LABEL)}</strong> — manufacturer / diameter / length / embedment withheld until a verified fastener assembly is archived.`
            : `${escapeH(_faType)}, ${lagDia}" diameter, <strong>${lagEmbed}" minimum embedment into ${escapeH(_fa.substrate ?? 'rafter')}</strong> (${escapeH(_fa.pilotRuleLabel)}).`}</div>
          <div style="margin-bottom:3px;font-size:6.8px;color:${_fa.verification === 'verified' ? '#333' : '#b45309'};"><strong>FASTENER ASSEMBLY:</strong> ${escapeH(_fa.line)} — <strong>${escapeH(_fa.certLabel)}</strong>.</div>
          <div style="margin-bottom:3px;">2. Flashing: Aluminum or stainless steel base flashing installed under existing roofing material per manufacturer requirements.</div>
          <div style="margin-bottom:3px;">3. Sealant: Polyurethane or silicone roofing sealant at all roof penetrations per manufacturer requirements.</div>
          <div style="margin-bottom:3px;">4. Attachment to structural framing members only — <strong>no attachment to sheathing or decking alone.</strong></div>
          <div style="margin-bottom:3px;">5. Torque: ${_fa.nonOrderable
            ? '<strong style="color:#b45309;">NOT ESTABLISHED</strong> — no verified fastener assembly, so no drive torque may be stated (the diameter-keyed &ldquo;typical&rdquo; values previously printed here were not a manufacturer specification).'
            : 'Per the manufacturer’s listed installation instructions for the verified fastener assembly (no numeric torque is stated without a verified applicable document).'}</div>
          <div style="margin-bottom:3px;">6. ${escapeH(_spc.designLabel)} along rail — <strong style="color:${_spcVerified ? '#333' : '#b45309'};">${escapeH(_spc.statusLabel)}</strong>${_spcVerified ? '.' : ' (design value; an allowable-spacing limit requires a verified source and none is archived).'}</div>
          <div style="margin-bottom:3px;">7. Verify roof framing at each attachment point — no attachments at splices or unsupported sheathing.</div>
          <div style="color:#555;font-size:7px;margin-top:5px;font-style:italic;">Detail is typical — verify with mounting system manufacturer installation manual for project-specific requirements.</div>
        </div>
      </div>

      <!-- Governing Load Combination — Roof. ASD (§2.4) combos — the rafter/lag
           capacities on this sheet are allowable-stress values; quoting the
           LRFD §2.3 factored combos beside them contradicted PE-1/CERT. -->
      <div class="section-title">Governing Load Combination — ${asce} §2.4 (ASD)</div>
      <div style="padding:var(--xs);font-size:var(--f-md);line-height:1.6;border:var(--border);border-top:none;">
        <table class="info-table" style="margin-bottom:var(--xs);">
          <tr><td class="il" style="width:100px;">${asce}</td><td class="iv">Minimum Design Loads and Associated Criteria for Buildings and Other Structures</td></tr>
          <tr><td class="il">${ibcVer} IBC</td><td class="iv">International Building Code — Chapter 16: Structural Design</td></tr>
          <tr><td class="il">${ibcVer} IRC</td><td class="iv">International Residential Code — Section R301: Design Criteria</td></tr>
        </table>
        <div style="font-size:var(--f-sm);color:#000;">
          <strong>GOVERNING LOAD COMBINATION (${asce} §2.4 — ASD) — ROOF-MOUNTED PV:</strong>
          The controlling load case for roof-mounted PV is <strong>0.6D + 0.6W</strong> (net uplift) for lag bolt
          withdrawal capacity, and <strong>D + S</strong> for gravity/snow loading on existing framing.
          All lag bolt attachments shall develop the required withdrawal capacity with a minimum safety factor of
          ${_attThreshold.toFixed(1)} (${_attChk ? _attChk.limitState : 'attachment-uplift'} — demand and allowable both ASD,
          Ω-normalized capacity; ${asce} §2.4). ${_attChk ? (_capGated
            ? `As analyzed: demand ${fmt(_attChk.demand)} lbs (canonical); allowable capacity is UNVERIFIED / PENDING STRUCTURAL SOURCE (§9) — the safety-factor check is INDETERMINATE, no PASS asserted.`
            : `As analyzed: demand ${fmt(_attChk.demand)} lbs, allowable ${fmt(_attChk.capacity)} lbs, SF ${fmt(_attChk.safetyFactor, 2)} — ${_attVerdict}.`) : ''}
        </div>
      </div>
      ${structural ? `<div style="padding:3px 6px;font-size:7.5px;line-height:1.35;border:var(--border);border-top:none;background:#fafafa;">
        <strong>STRUCTURAL ANALYSIS INTERPRETATION — ROOF MOUNT:</strong>
        Wind analysis per ${asce} §26/27 indicates a net uplift of ${upliftAtt} lbs per attachment point at the
        design wind speed of ${windSpeed} mph (Exposure Category ${exposure}) &mdash; <span data-env-source="pv-4c-conclusion" style="font-weight:bold;color:${_envTagColor};">${escapeH(_proj.environmentalSourceLine)}</span>${_proj.environmentalUnverified ? ' (preliminary design criteria; a verified climate-hazard source is required before permit submission &mdash; ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED, see RS-1)' : ''}.
        ${Number(groundSnow) > 0 ? `Snow loading contributes ${snowAtt} lbs per attachment at the ${groundSnow} PSF ground snow load (roof snow load ${roofSnow} PSF after slope reduction per ${asce} §7).` : 'Snow loading is not a controlling factor at this location.'}
        ${_reviewRequired
          ? `<strong style="color:#b91c1c;">ROOF FRAMING UNVERIFIED — the rafter/truss capacity is computed from code defaults and is NOT engineering authority. A licensed structural review of the existing framing is required before permit submission; no framing pass is certified on this sheet.</strong>`
          : (_utilRatio != null ? `The rafter utilization ratio of ${utilization}% confirms the existing framing ${_utilRatio <= 1.0 ? 'has adequate capacity' : 'REQUIRES REINFORCEMENT'} for the additional PV loading per IBC Section 1607.` : 'Rafter utilization data not available — verify framing capacity per engineering analysis.')}
        ${_capGated
          ? `<strong style="color:#b45309;">ATTACHMENT CAPACITY UNVERIFIED (§9) — the published allowable capacity source is not archived / its applicability to the selected assembly is unconfirmed. The demand is canonical, but the safety-factor comparison is INDETERMINATE and no attachment PASS is asserted on this sheet until a verified structural source is supplied.</strong>`
          : (Number(safetyFact) > 0 ? `Lag bolt attachment safety factor of ${safetyFact} ${Number(safetyFact) >= _attThreshold ? 'meets' : 'DOES NOT MEET'} the required minimum of ${_attThreshold.toFixed(1)} (ASD demand vs allowable capacity per ${asce} §2.4).` : 'Lag bolt safety factor data not available — verify attachment capacity per engineering analysis.')}
      </div>` : ''}
      <div style="padding:3px 6px;margin-top:var(--xs);font-size:7.5px;line-height:1.35;border:2px solid #000;background:#fff;">
        <strong>PAGE CONCLUSION — ROOF STRUCTURAL ANALYSIS:</strong>
        The proposed roof-mounted photovoltaic array and lag bolt attachment system have been analyzed for
        wind uplift, snow, dead load, rafter capacity, and attachment withdrawal per ${asce} §26/27 and ${ibcVer} IBC/IRC.
        ${_reviewRequired && _capGated
          ? 'Roof framing authority is UNVERIFIED (member size / spacing / species / span defaulted) AND the attachment-capacity source is UNVERIFIED (§9 — structural source not archived / applicability unconfirmed). Demand analysis is complete, but NO framing pass and NO attachment pass are asserted; a licensed structural review of the existing framing and a verified attachment-capacity source are both required before this set is submitted for permit.'
          : _reviewRequired
          ? 'Roof framing authority is UNVERIFIED (member size / spacing / species / span defaulted). The rail checks pass on the analyzed inputs, but a licensed structural review of the existing framing is required before this set is submitted for permit — see the review notice above.'
          : (_capGated
            ? 'Attachment capacity is UNVERIFIED (§9 — structural source not archived / applicability unconfirmed). The demand analysis is complete, but a verified attachment-capacity source is required before this set is submitted for permit; no attachment PASS is asserted.'
            : _attChk?.passes === true && _framingChk?.passes === true
            ? `All structural parameters are within acceptable limits. The existing roof structure and lag bolt attachment
               system are adequate to support the proposed PV array without modification.`
            : (_attChk == null && _framingChk == null
              ? 'Structural analysis data incomplete — verify all parameters per engineering analysis before installation.'
              : 'Review flagged structural items before proceeding with installation. Reinforcement or attachment revision may be required.'))}
      </div>

      ${structuralRules.length > 0 ? `
      <div class="section-title">Structural Rules Check</div>
      <table class="equip-table">
        <thead><tr><th>Reference</th><th>Description</th><th>Result</th><th>Value / Limit</th><th>Status</th></tr></thead>
        <tbody>
          ${structuralRules.map(rule => `
          <tr style="background:${statusBg(rule.severity)}">
            <td class="mono f-lg">${rule.asceReference || rule.ruleId}</td>
            <td>${rule.title}</td>
            <td style="font-size:9px;color:#333">${rule.message}</td>
            <td style="font-family:monospace;font-size:9px;text-align:right">${rule.value !== undefined ? `${rule.value}${rule.limit !== undefined ? ` / ${rule.limit}` : ''}` : '—'}</td>
            <td style="text-align:center;font-weight:bold;color:${statusColor(rule.severity)}">${statusLabel(rule.severity)}</td>
          </tr>`).join('')}
        </tbody>
      </table>` : ''}
      ${(input.permitOptions as { includeInternalValidation?: boolean } | undefined)?.includeInternalValidation === true
        && rulesResult?.structuralAutoResolutions && rulesResult.structuralAutoResolutions.length > 0 ? `
      <!-- Engine-proposed resolutions are internal-review provenance only and are
           NOT printed on the issued construction sheet (Ray, 2026-07-09). The full
           record is retained in the engineering file. Shown only when internal
           validation is explicitly requested. -->
      <div style="padding:3px 6px;margin-top:2px;font-size:7px;line-height:1.4;border:var(--border);background:#fafafa;color:#333;">
        <strong>ENGINE-PROPOSED RESOLUTIONS (INTERNAL REVIEW — provenance only, NOT applied to this design):</strong>
        ${rulesResult.structuralAutoResolutions.slice(0, 4).map(r =>
          `${r.field}: ${r.originalValue} → <strong>${r.resolvedValue}</strong> (${r.reason}${r.necReference ? ` — ${r.necReference}` : ''})`,
        ).join(' &nbsp;·&nbsp; ')}${rulesResult.structuralAutoResolutions.length > 4 ? ` &nbsp;·&nbsp; + ${rulesResult.structuralAutoResolutions.length - 4} more — full record retained in the engineering file` : ''}
      </div>` : ''}
    </div>
  </div>`;
}



// ── §8 ATTACHMENT-ID REACTION SCHEDULE ────────────────────────────────────────
// Dense CAD table sourced from the CANONICAL attachment objects (id, roof zone,
// tributary area, dead / snow / down / uplift reactions, capacity + SF), plus a
// reconciliation footer that sums tributary areas and reactions back to the
// applied load × array footprint (per limit state). Capacity/SF are gated to
// PENDING when the §9 capacity gate is active. Uniform reactions are collapsed
// beyond a row cap with an explicit "+K identical" note (never silently clipped).
function renderReactionSchedule(proj: StructuralProjection): string {
  const atts = proj.attachments ?? [];
  const rr = proj.reactionReconciliation;
  if (atts.length === 0) {
    return `
      <div class="section-title">Attachment Reaction Schedule — Per-Attachment Reactions (${'ASCE 7'} §2.4)</div>
      <div style="padding:var(--xs);font-size:var(--f-sm);border:var(--border);border-top:none;background:#fafafa;color:#b45309;">
        No canonical attachment objects were derived for this system — per-attachment reactions are not traceable.
        A structural review must establish the attachment layout and reactions before permit submission.
      </div>`;
  }
  const gated = proj.capacityGated === true;
  const n2 = (v: number | null | undefined) => v == null || !isFinite(v) ? '—' : v.toFixed(0);
  const n1 = (v: number | null | undefined) => v == null || !isFinite(v) ? '—' : v.toFixed(1);
  const capCell = gated ? 'PENDING' : '';

  // ── W9 (RP-D) PAGE-FIT: GROUP-BY-LOAD-CASE compact schedule ────────────────
  // The former 40-row per-attachment table overflowed PV-4C onto an unnumbered
  // second physical page. Because this is a CONSERVATIVE SCREENING ENVELOPE
  // (governing corner zone + full interior tributary applied to EVERY mount),
  // the per-attachment reactions are identical — 1 row group covers all 64. The
  // schedule now collapses attachments with an identical rendered signature into
  // ONE row (ID range + count); the FULL per-attachment set stays in the
  // machine-readable canonical object model (proj.attachments). If a future
  // per-position zone/tributary model lands, distinct positions render as
  // distinct groups automatically.
  interface Grp { key: string; ids: string[]; a: (typeof atts)[number]; }
  const groups: Grp[] = [];
  const gIndex = new Map<string, Grp>();
  for (const a of atts) {
    const sfKey = gated ? 'PEND.' : (a.safetyFactor != null ? a.safetyFactor.toFixed(2) : '—');
    const capKey = gated ? 'PENDING' : n2(a.allowableCapacityLbs);
    const key = [a.roofZone ?? '—', n1(a.tributaryAreaFt2), n2(a.deadReactionLbs), n2(a.snowReactionLbs),
      n2(a.downwardReactionLbs), n2(a.upliftReactionLbs), capKey, sfKey].join('|');
    let g = gIndex.get(key);
    if (!g) { g = { key, ids: [], a }; gIndex.set(key, g); groups.push(g); }
    g.ids.push(a.attachmentId);
  }
  const GROUP_CAP = 24;
  const shownGroups = groups.slice(0, GROUP_CAP);
  const hiddenGroups = groups.length - shownGroups.length;
  const idRange = (ids: string[]): string => ids.length === 1
    ? escapeH(ids[0])
    : `${escapeH(ids[0])} &ndash; ${escapeH(ids[ids.length - 1])}`;

  const bodyRows = shownGroups.map((g, i) => {
    const a = g.a;
    const sf = gated ? 'PEND.' : (a.safetyFactor != null ? a.safetyFactor.toFixed(2) : '—');
    const cap = gated ? capCell : n2(a.allowableCapacityLbs);
    return `<tr${i % 2 ? ' class="bg-lt"' : ''}>
      <td class="mono">${idRange(g.ids)}</td>
      <td class="tr fw7">${g.ids.length}</td>
      <td>${escapeH(a.roofZone ?? '—')}</td>
      <td class="tr">${n1(a.tributaryAreaFt2)}</td>
      <td class="tr">${n2(a.deadReactionLbs)}</td>
      <td class="tr">${n2(a.snowReactionLbs)}</td>
      <td class="tr">${n2(a.downwardReactionLbs)}</td>
      <td class="tr fw7">${n2(a.upliftReactionLbs)}</td>
      <td class="tr"${gated ? ' style="color:#b45309;"' : ''}>${cap}</td>
      <td class="tr"${gated ? ' style="color:#b45309;"' : ''}>${sf}</td>
    </tr>`;
  }).join('');

  const extraNote = hiddenGroups > 0
    ? `<tr><td colspan="10" style="font-size:6.5px;color:#555;font-style:italic;padding:2px 3px;">+ ${hiddenGroups} additional distinct load-case group${hiddenGroups === 1 ? '' : 's'} (full per-attachment set carried in the canonical structural object model; abbreviated here for page fit).</td></tr>`
    : '';

  // ── Reconciliation — rendered on PV-4C.1 (renderReactionReconciliation) ──
  // Post-AAC clip repair: the reconciliation block was the LAST stack on PV-4C
  // and the live design renders one more distinct load-case group than the
  // frozen fixture, which pushed the continuation strip 26.4px past the
  // page-content clip box. The reconciliation belongs with the load-combination
  // / conclusion material that already continues on PV-4C.1, so it moved there
  // DETERMINISTICALLY (not conditionally on row counts) — the fit margin on
  // PV-4C no longer depends on the data-driven group count.

  // §14 — the CONSERVATIVE-ENVELOPE area ratio is a display ratio of two canonical
  // areas (Σ per-mount tributary ÷ array footprint), stated explicitly so the
  // screening basis is legible. Never an exact per-position tributary geometry.
  const _areaRatio = (rr && rr.present && rr.arrayAreaFt2 && rr.tributarySumFt2)
    ? (rr.tributarySumFt2 / rr.arrayAreaFt2)
    : null;
  const _areaRatioStr = _areaRatio != null ? `${_areaRatio.toFixed(3)}×` : '—';

  return `
      <div class="section-title">Attachment Reaction Schedule — Grouped by Load Case (${'ASCE 7'} §2.4 ASD) — ${atts.length} attachment${atts.length === 1 ? '' : 's'}, ${groups.length} distinct group${groups.length === 1 ? '' : 's'}</div>
      <table class="equip-table" style="width:100%;">
        <thead><tr>
          <th>Attach IDs</th><th style="text-align:right;">Qty</th><th>Zone</th><th style="text-align:right;">Trib (ft²)</th>
          <th style="text-align:right;">Dead (lb)</th><th style="text-align:right;">Snow (lb)</th>
          <th style="text-align:right;">Down D+S (lb)</th><th style="text-align:right;">Uplift 0.6W (lb)</th>
          <th style="text-align:right;">Cap (lb)</th><th style="text-align:right;">SF</th>
        </tr></thead>
        <tbody>${bodyRows}${extraNote}</tbody>
      </table>
      <div style="padding:2px 6px;font-size:6.5px;color:#555;line-height:1.3;border:var(--border);border-top:none;">
        Reactions sourced from the canonical attachment objects (structural-engine-v4 mount layout). Uplift = ASD 0.6·W net C&amp;C over the per-mount tributary; Down = Dead + Snow over the same tributary.
        <strong>CONSERVATIVE SCREENING ENVELOPE:</strong> ALL attachments use the GOVERNING corner (ASCE 7 Zone 3) C&amp;C pressure applied UNIFORMLY, on an <strong>ASD basis</strong> (0.6·W uplift; D+S gravity) — the capacity checks on this sheet declare the SAME ASD load basis. Each mount is charged a FULL interior tributary (end mounts included); the Σ per-mount tributary is <strong>${_areaRatioStr}</strong> the array footprint (Σ tributary ÷ array area = ${rr && rr.present ? `${rr.tributarySumFt2 ?? '—'} ÷ ${rr.arrayAreaFt2 ?? '—'} ft²` : 'per canonical reconciliation'}). This is an intentionally conservative screening basis, NOT an exact per-position zone or tributary geometry &mdash; a design that passes here passes at every position.
        ${gated ? 'Capacity + SF are gated to PENDING (§9 — allowable source unverified).' : ''}
        Σ-reaction closure checks continue on <strong>PV-4C.1</strong> (Reaction Reconciliation, §8).
      </div>`;
}

/** §8 Reaction Reconciliation — Σ reactions vs applied load × array area.
 *  Rendered on PV-4C.1 (see the page-fit note in renderReactionSchedule). */
function renderReactionReconciliation(proj: StructuralProjection): string {
  const rr = proj.reactionReconciliation;
  const reconRows: string[] = [];
  let footer = '';
  if (rr && rr.present) {
    const verdict = rr.ok ? 'RECONCILED (CONSERVATIVE SCREENING ENVELOPE)' : 'DOES NOT RECONCILE';
    const vColor = rr.ok ? '#006600' : '#cc0000';
    const chk = (name: string) => rr.checks.find(c => c.name === name);
    const cCount = chk('attachment-count-vs-reaction-model');
    const cFloor = chk('tributary-lost-load-floor');
    const cDup = chk('tributary-duplicate-area-guard');
    const cUp = chk('uplift-reactions-vs-applied');
    const cSnow = chk('snow-reactions-vs-applied');
    const cDead = chk('dead-reactions-vs-applied');
    const line = (label: string, c: ReturnType<typeof chk>) => c
      ? `<tr><td>${label}</td><td class="tr">${c.expected ?? '—'}</td><td class="tr">${c.actual ?? '—'}</td><td class="tr">${c.ratio ?? '—'}</td><td style="text-align:center;font-weight:bold;color:${c.ok ? '#006600' : '#cc0000'};">${c.ok ? 'OK' : 'FAIL'}</td></tr>`
      : '';
    reconRows.push(
      `<tr style="font-weight:bold;"><td>Object count vs reaction model</td><td class="tr">${cCount?.expected ?? '—'}</td><td class="tr">${cCount?.actual ?? '—'}</td><td class="tr">${cCount?.ratio ?? '—'}</td><td style="text-align:center;color:${cCount?.ok ? '#006600' : '#cc0000'};">${cCount?.ok ? 'OK' : 'FAIL'}</td></tr>`,
      line('Σ tributary &ge; array area — lost-load floor (ft²)', cFloor),
      line('Σ tributary &le; 2&times; area — duplicate-area guard (ft²)', cDup),
      line('Σ uplift envelopes 0.6·W × area (lb)', cUp),
      line('Σ snow envelopes snow psf × area (lb)', cSnow),
      line('Σ dead envelopes dead psf × area (lb)', cDead),
    );
    footer = `
      <div class="section-title">Reaction Reconciliation — Σ Reactions vs Applied Load × Array Area (§8)</div>
      <table class="calc-table" style="width:100%;">
        <thead><tr><th style="text-align:left;">Closure Check</th><th style="text-align:right;">Expected</th><th style="text-align:right;">Σ Objects</th><th style="text-align:right;">Ratio</th><th style="text-align:center;">Status</th></tr></thead>
        <tbody>${reconRows.join('')}</tbody>
      </table>
      <div style="padding:3px 6px;font-size:6.8px;line-height:1.35;border:var(--border);border-top:none;background:${rr.ok ? '#f6faf6' : '#fdf3f3'};">
        <strong style="color:${vColor};">${verdict}.</strong>
        ${escapeH(rr.note)} Tolerance band on closure ratios: [${rr.tolerance.lower}, ${rr.tolerance.upper}].
        Array footprint = Σ canonical module areas = ${rr.arrayAreaFt2 ?? '—'} ft²; Σ per-mount tributary = ${rr.tributarySumFt2 ?? '—'} ft²
        over ${rr.attachmentCount} attachments.
        ${!rr.ok ? '<strong style="color:#cc0000;"> Reactions do not reconcile with the applied load — see the permit-readiness blocker; the per-attachment reaction is not authoritative.</strong>' : ''}
      </div>`;
  }
  return footer;
}

// ─── DISPATCHER ───────────────────────────────────────────────────────────────
export function pageStructural(input: PermitInput, cad: CADModel, pageNum: number, totalPages: number): string {
  const sys = cad.systemType as string;
  if (isFence(sys))  return pageStructuralFence(input, cad, pageNum, totalPages);
  if (isGround(sys)) return pageStructuralGround(input, cad, pageNum, totalPages);
  return pageStructuralRoof(input, cad, pageNum, totalPages, 1);
}

/** PV-4C.1 — the formal continuation of the roof structural calculation sheet
 *  (W9/§15 page-fit). Rendered ONLY for roof systems that carry a PV-4C; the
 *  manifest gates it identically so the page set and sheet index never drift. */
export function pageStructuralRoofContinuation(input: PermitInput, cad: CADModel, pageNum: number, totalPages: number): string {
  return pageStructuralRoof(input, cad, pageNum, totalPages, 2);
}

/** Whether the roof structural sheet PV-4C spills to a PV-4C.1 continuation.
 *  Single source shared by the manifest (sheet index / snapshot digest) and the
 *  page assembly so both agree. Roof systems only (ground/fence have their own
 *  single-sheet structural pages). */
export function roofStructuralHasContinuation(systemType: unknown): boolean {
  return isRoof(systemType as string);
}




// ── Hardware Schedule Renderer (v48.x) ────────────────────────────────────────────
// Standalone helper — uses deriveStructuralBOM() to get real quantities
// for fence/ground system-specific hardware tables. Replaces TBD placeholders.
// Roof returns empty string (no additional hardware table needed).
function renderHardwareSchedule(input: PermitInput, cad: CADModel): string {
  const { system } = input;
  const totalPanels = cad.totalPanels || system.totalPanels || 0;

  if (isFence(cad.systemType)) {
    // Pull computed quantities from structural BOM engine
    const bomInput  = extractStructuralInputFromCAD('fence', totalPanels, cad);
    const bomResult = deriveStructuralBOM(bomInput);
    const items     = bomResult.items;

    const qty = (cat: string): string => {
      const item = items.find(i => i.category === cat);
      return item ? String(item.quantity) : '—';
    };
    const unitOf = (cat: string, fallback = 'EA'): string => {
      const item = items.find(i => i.category === cat);
      return item ? item.unit.toUpperCase() : fallback;
    };

    const embedFt       = input.layout?.fencePostEmbedmentFt ?? 2.5;
    const postSpacingFt = input.layout?.fencePostSpacingFt   ?? 8;
    const railCount     = input.layout?.fenceRailCount       ?? 2;
    const totalLenFt    = input.layout?.fenceTotalLengthFt   ?? 0;
    const conduitFt     = totalLenFt > 0 ? Math.ceil(totalLenFt)      : '—';
    const conduitStraps = totalLenFt > 0 ? Math.ceil(totalLenFt / 4)  : '—';

    let html = '<div class="section-title">Fence-Specific Hardware Schedule</div>';
    html += '<table class="equip-table">';
    html += '<thead><tr><th>Item</th><th>Description</th><th>Spec / Reference</th><th style="text-align:right">Qty</th><th>Unit</th><th style="font-size:7.5px">Derived From</th></tr></thead>';
    html += '<tbody>';
    html += '<tr><td class="fw7">Fence Posts</td><td>SolFence Post — clamp-mount, no drilling required</td>'
          + '<td>Min. ' + embedFt + 'ft embedment, ' + postSpacingFt + 'ft O.C.</td>'
          + '<td class="tr">' + qty('fence_post') + '</td><td>' + unitOf('fence_post') + '</td>'
          + '<td style="font-size:7px;color:#555">CAD segments × post spacing</td></tr>';
    html += '<tr class="bg-lt"><td class="fw7">Horizontal Rails</td><td>SolFence Vertical Rail — Extruded Aluminum 6061-T6, 10ft sections</td>'
          + '<td>' + railCount + ' rails × fence length</td>'
          + '<td class="tr">' + qty('fence_rail') + '</td><td>' + unitOf('fence_rail') + '</td>'
          + '<td style="font-size:7px;color:#555">railCount × fenceLen ÷ 10ft sections</td></tr>';
    html += '<tr><td class="fw7">Panel Clamps</td><td>SolFence Panel Clamp — 4 per module (2 top + 2 bottom)</td>'
          + '<td>Aluminum, SS Grade 316, UL 2703</td>'
          + '<td class="tr">' + qty('panel_clamp') + '</td><td>' + unitOf('panel_clamp') + '</td>'
          + '<td style="font-size:7px;color:#555">4 clamps/panel × modules</td></tr>';
    html += '<tr class="bg-lt"><td class="fw7">Rail Brackets</td><td>SolFence Rail-to-Post Bracket — SS Grade 316</td>'
          + '<td>2 per rail-post junction</td>'
          + '<td class="tr">' + qty('rail_bracket') + '</td><td>' + unitOf('rail_bracket') + '</td>'
          + '<td style="font-size:7px;color:#555">2 × posts × railCount</td></tr>';
    html += '<tr><td class="fw7">Post Caps</td><td>SolFence Post Cap — weather protection, Aluminum</td>'
          + '<td>1 per post, match post OD</td>'
          + '<td class="tr">' + qty('post_cap') + '</td><td>' + unitOf('post_cap') + '</td>'
          + '<td style="font-size:7px;color:#555">1 per post</td></tr>';
    html += '<tr class="bg-lt"><td class="fw7">Ground Rods</td><td>Southwire 8ft Ground Rod (5/8") — copper-clad steel</td>'
          + '<td>1 per 200ft of fence, NEC 250.52</td>'
          + '<td class="tr">' + qty('ground_rod') + '</td><td>' + unitOf('ground_rod') + '</td>'
          + '<td style="font-size:7px;color:#555">ceil(fenceLength / 200), NEC 250.52</td></tr>';
    html += '<tr><td class="fw7">Conduit (PV Wire)</td><td>EMT or PVC-C conduit along fence line</td>'
          + '<td>3/4\" min., NEC 358/352</td>'
          + '<td class="tr">' + conduitFt + '</td><td>FT</td>'
          + '<td style="font-size:7px;color:#555">fence total length</td></tr>';
    html += '<tr class="bg-lt"><td class="fw7">Conduit Straps</td><td>Corrosion-resistant conduit strap</td>'
          + '<td>4ft max spacing, NEC 358.30</td>'
          + '<td class="tr">' + conduitStraps + '</td><td>EA</td>'
          + '<td style="font-size:7px;color:#555">ceil(fenceLength / 4ft)</td></tr>';
    html += '</tbody></table>';
    return html;
  }

  if (isGround(cad.systemType)) {
    // Pull computed quantities from structural BOM engine
    const bomInput  = extractStructuralInputFromCAD('ground', totalPanels, cad);
    const bomResult = deriveStructuralBOM(bomInput);
    const items     = bomResult.items;

    const qty = (cat: string): string => {
      const item = items.find(i => i.category === cat);
      return item ? String(item.quantity) : '—';
    };
    const unitOf = (cat: string, fallback = 'EA'): string => {
      const item = items.find(i => i.category === cat);
      return item ? item.unit.toUpperCase() : fallback;
    };

    const arrays        = input.layout?.groundArrays || [];
    const firstArray    = arrays[0];
    const structType    = firstArray?.structureType || 'driven_pile';
    const pileSpacingFt = firstArray?.pileSpacingFt   ?? 8;
    const pileEmbedFt   = firstArray?.pileDepthFt ?? 4;
    // Error 5a fix: cad.arrayWidthFt doesn't exist on CADModel — read from
    // cad.ground.arrays[0].dimensions.arrayWidthM (meters → ft) instead.
    const cadArrWidthM  = cad.ground?.arrays?.[0]?.dimensions?.arrayWidthM;
    const arrayWidthFt  = cadArrWidthM ? cadArrWidthM * 3.28084 : Math.ceil(totalPanels * 1.1);
    const conduitFt     = Math.ceil(arrayWidthFt + 20); // array width + 20ft run to inverter

    const pileLabel = structType === 'concrete_pier' ? 'Concrete Piers' : 'Driven Pylons';
    const pileDesc  = structType === 'concrete_pier'
      ? 'Concrete form tube, rebar cage, 3000 psi min.'
      : 'Speck PLP POWER DRIVE™ Driven I-beam Pylon — Hot-Dip Galvanized Steel, driven to refusal';

    let html = '<div class="section-title">Ground Mount Hardware Schedule</div>';
    html += '<table class="equip-table">';
    html += '<thead><tr><th>Item</th><th>Description</th><th>Spec / Reference</th><th style="text-align:right">Qty</th><th>Unit</th><th style="font-size:7.5px">Derived From</th></tr></thead>';
    html += '<tbody>';
    html += '<tr><td class="fw7">' + pileLabel + '</td><td>' + pileDesc + '</td>'
          + '<td>' + pileSpacingFt + 'ft spacing, ' + pileEmbedFt + 'ft embed</td>'
          + '<td class="tr">' + qty('pile') + '</td><td>' + unitOf('pile') + '</td>'
          + '<td style="font-size:7px;color:#555">structural-engine: pilesPerRow × 2 rows</td></tr>';
    html += '<tr class="bg-lt"><td class="fw7">Strongbacks</td><td>Speck PLP POWER DRIVE™ Strongback — Hot-Dip Galvanized Steel</td>'
          + '<td>1 per pylon</td>'
          + '<td class="tr">' + qty('beam') + '</td><td>' + unitOf('beam') + '</td>'
          + '<td style="font-size:7px;color:#555">1 per pylon</td></tr>';
    html += '<tr><td class="fw7">PX Rails</td><td>Speck PLP POWER DRIVE™ PX Rail — Hot-Dip Galvanized Steel, 14ft sections</td>'
          + '<td>2 rails per row, span per pylon spacing</td>'
          + '<td class="tr">' + qty('rail') + '</td><td>' + unitOf('rail') + '</td>'
          + '<td style="font-size:7px;color:#555">railsPerRow × rowCount ÷ 14ft sections</td></tr>';
    html += '<tr class="bg-lt"><td class="fw7">Rail Splices</td><td>Speck PLP POWER DRIVE™ Rail Splice — SS Grade 316</td>'
          + '<td>1 per rail section junction</td>'
          + '<td class="tr">' + qty('rail_splice') + '</td><td>' + unitOf('rail_splice') + '</td>'
          + '<td style="font-size:7px;color:#555">structural-engine calc</td></tr>';
    html += '<tr><td class="fw7">Mid Clamps</td><td>Speck PLP POWER DRIVE™ Mid Clamp — Aluminum, SS Grade 316</td>'
          + '<td>1 per panel junction per rail, UL 2703</td>'
          + '<td class="tr">' + qty('mid_clamp') + '</td><td>' + unitOf('mid_clamp') + '</td>'
          + '<td style="font-size:7px;color:#555">array-geometry: (panelsPerRow-1) × rails</td></tr>';
    html += '<tr class="bg-lt"><td class="fw7">End Clamps</td><td>Speck PLP POWER DRIVE™ End Clamp — Aluminum, SS Grade 316</td>'
          + '<td>2 per rail end (row edge), UL 2703</td>'
          + '<td class="tr">' + qty('end_clamp') + '</td><td>' + unitOf('end_clamp') + '</td>'
          + '<td style="font-size:7px;color:#555">2 end clamps per rail</td></tr>';
    html += '<tr><td class="fw7">Ground Rods</td><td>Southwire 8ft Ground Rod (5/8") — copper-clad steel</td>'
          + '<td>1 per ground array, NEC 250.52</td>'
          + '<td class="tr">' + qty('ground_rod') + '</td><td>EA</td>'
          + '<td style="font-size:7px;color:#555">1 per ground array, NEC 250.52</td></tr>';
    html += '<tr class="bg-lt"><td class="fw7">Conduit (Underground)</td><td>Schedule 40 PVC or RMC for underground AC/DC run</td>'
          + '<td>NEC 358/344, 18\" min. cover</td>'
          + '<td class="tr">' + conduitFt + '</td><td>FT</td>'
          + '<td style="font-size:7px;color:#555">arrayWidth + 20ft run to inverter</td></tr>';
    html += '</tbody></table>';
    return html;
  }

  // §12 — roof jobs project the ONE canonical fastener assembly (identical to
  // PV-3 / APP-A / PE-1). Prior to this the roof case rendered no attachment line.
  const _faS = projectFastenerAssembly(input);
  if (!_faS.present) return '';
  // §6 (BAR) — while the fastener assembly is NON-ORDERABLE (not verified), the
  // row shows the calculated quantity as a DESIGN QUANTITY only and reveals NO
  // manufacturer/SKU/diameter/length/coating/embedment (the observed geometry is
  // retained in the projection for auto-regeneration on verification). The exact
  // orderable row re-emits verbatim once FastenerAssembly.verification === 'verified'.
  const _faNon = _faS.nonOrderable;
  let rhtml = '<div class="section-title">Roof Attachment Hardware</div>';
  rhtml += '<table class="equip-table">';
  rhtml += '<thead><tr><th>Item</th><th>Fastener Assembly</th><th style="text-align:right">Qty/Mount</th><th>Embedment</th><th>Verification</th></tr></thead>';
  rhtml += '<tbody>';
  rhtml += '<tr><td class="fw7">Structural Fastener</td>'
        + `<td data-sched-field="fastener" data-fastener-orderable="${_faNon ? 'false' : 'true'}">${escapeH(_faS.line)}</td>`
        + `<td class="tr">${_faNon ? (_faS.qtyPerMount != null ? _faS.qtyPerMount + ' <span style="color:#b45309;font-size:6px;">(DESIGN — NON-ORDERABLE)</span>' : 'DESIGN QTY') : (_faS.qtyPerMount ?? '—')}</td>`
        + `<td>${_faNon ? 'PENDING VERIF.' : (_faS.embedmentIn != null ? _faS.embedmentIn + '" min' : '—')}</td>`
        + `<td style="font-weight:bold;color:${_faS.verification === 'verified' ? '#000' : '#b45309'};">${escapeH(_faS.certLabel)}</td></tr>`;
  rhtml += '</tbody></table>';
  return rhtml;
}

// ── BOM Table Renderer (v48.x) ───────────────────────────────────────────────
// Standalone helper — lives outside the template literal to avoid escaping hell.
// Supports row slicing so long BOMs paginate onto a continuation sheet instead
// of silently clipping mid-row at the fixed page height (teardown P0).

const BOM_SKIP_CATEGORIES = new Set(['solar_panel', 'panels', 'inverters']);

/** Rows the SCHED BOM table will render (after panel/inverter dedup). */
export function schedBomRowCount(bom: PermitInput['bom']): number {
  return (bom ?? []).filter(i => !BOM_SKIP_CATEGORIES.has(i.category)).length;
}

/** Max BOM rows on the primary SCHED sheet (it also carries the module/
 *  inverter tables + wire-sizing + conclusion); the continuation sheets are
 *  all-table and fit more. W9/§15: reduced so the primary SCHED sheet's tables
 *  + conclusion fit the fixed page. */
export const SCHED_BOM_ROWS_FIRST = 10;

/** Max BOM rows PER continuation sheet (SCHED-2, SCHED-3, …). All-table pages,
 *  so a page holds more rows than the primary sheet. Chosen so a full
 *  continuation page + its summary block never overflows the fixed 11in page.
 *  22 → 21 (2026-07-25): a row whose description carries an authority state
 *  (non-orderable design quantity, pending manufacturer authority) wraps to
 *  several lines, and a full 22-row page then clipped by ~30px. 21 leaves the
 *  headroom those multi-line rows need (page-fit gate 13).
 *  21 → 14 (ECD W1-C, 2026-07-26): the ECD §2/§3 state model gives the
 *  route-estimated rows a SECOND line in the quantity cell ("EST — FIELD
 *  VERIFY"), which they had no representation for before. A full 21-row
 *  continuation page then clipped by 108px (≈3 rows); measured with the real
 *  package, 18 still clipped 39px and 16 still clipped 29px (row HEIGHT varies
 *  far more than row count — the structural rows carry multi-line authority
 *  prose). 15 is the first clean value; 14 is used so WS-2's PV-4B/SCHED
 *  authority wording has headroom too. Consequence: a 47-row schedule
 *  paginates onto three continuation sheets (SCHED-2/3/4) instead of two —
 *  pagination, not content loss. */
export const SCHED_BOM_ROWS_CONT = 14;

/** Number of SCHED continuation sheets required for a BOM of this size (0 when
 *  it fits on the primary SCHED sheet). Single source shared by the manifest
 *  (sheet index / snapshot digest) and the page assembly so both agree. */
export function schedContPageCount(bom: PermitInput['bom']): number {
  const rows = schedBomRowCount(bom);
  if (rows <= SCHED_BOM_ROWS_FIRST) return 0;
  return Math.ceil((rows - SCHED_BOM_ROWS_FIRST) / SCHED_BOM_ROWS_CONT);
}

/** Sub-system ordinal for BOM grouping (roof > ground > fence > unstamped). */
const BOM_SUB_ORDER: Record<string, number> = { roof: 0, ground: 1, fence: 2 };
const bomSubOrd = (s?: string) => (s && s in BOM_SUB_ORDER ? BOM_SUB_ORDER[s] : 3);
const bomSubLabel = (s?: string) =>
  s === 'roof' ? 'ROOF' : s === 'ground' ? 'GROUND' : s === 'fence' ? 'FENCE' : '—';

function renderBOMTable(bom: PermitInput['bom'], startRow = 0, maxRows = Number.POSITIVE_INFINITY, opts?: { bySub?: boolean; continuationLabel?: (from: number, to: number) => string }): string {
  if (!bom || bom.length === 0) {
    return '<!-- No BOM data — permit generated without BOM integration -->';
  }
  // Wave 5B hybrid: group stage rows by sub-system WHERE STAMPED (Wave 2c
  // stamps; unstamped/shared items sort last in each stage and print '—').
  const bySub = opts?.bySub === true;

  const bomItems = bom.filter(i => !BOM_SKIP_CATEGORIES.has(i.category));
  if (bomItems.length === 0) {
    return '<!-- BOM present but all items are panels/inverters (already rendered above) -->';
  }

  const stageOrder: string[] = ['array', 'dc', 'inverter', 'ac', 'structural', 'monitoring', 'labels'];
  const stageLabels: Record<string, string> = {
    array:      'Stage 1 — Array',
    dc:         'Stage 2 — DC Wiring',
    inverter:   'Stage 3 — Inverter & AC',
    ac:         'Stage 4 — AC Conductors & Devices',
    structural: 'Stage 5 — Structural',
    monitoring: 'Stage 6 — Monitoring',
    labels:     'Stage 7 — Labels & Signage',
  };

  const grouped: Record<string, typeof bomItems> = {};
  for (const item of bomItems) {
    const s = item.stageId ?? 'other';
    if (!grouped[s]) grouped[s] = [];
    grouped[s].push(item);
  }
  const stages = [...stageOrder, ...Object.keys(grouped).filter(s => !stageOrder.includes(s))];

  let html = `<div class="section-title">Bill of Materials — Full Equipment Schedule${startRow > 0 ? ' (CONTINUED)' : ''}</div>`;
  html += '<table class="bom-table" style="width:100%;font-size:var(--f-sm);">';
  html += '<thead><tr style="background:#000;color:#fff;">';
  html += '<th style="width:4%">#</th>';
  html += bySub
    ? '<th style="width:10%">Stage</th><th style="width:7%">System</th>'
    : '<th style="width:12%">Stage</th>';
  html += '<th style="width:12%">Category</th>';
  html += '<th style="width:13%">Manufacturer</th>';
  html += bySub ? '<th style="width:14%">Model / Description</th>' : '<th style="width:16%">Model / Description</th>';
  html += '<th style="width:10%">Part Number</th>';
  html += '<th style="width:5%;text-align:right">Qty</th>';
  html += '<th style="width:5%">Unit</th>';
  html += '<th style="width:12%">NEC Reference</th>';
  html += bySub ? '<th style="width:8%">Derived From</th>' : '<th style="width:11%">Derived From</th>';
  html += '</tr></thead><tbody>';
  const nCols = bySub ? 11 : 10;

  // Flatten in stage order so the table can be sliced across sheets.
  const flat: Array<{ item: (typeof bomItems)[number]; stageLabel: string }> = [];
  for (const stageKey of stages) {
    let items = grouped[stageKey];
    if (!items || items.length === 0) continue;
    // Hybrid: within each stage, stamped rows group roof → ground → fence,
    // unstamped (shared/POI) rows last. Stable — original order otherwise.
    if (bySub) items = [...items].sort((a, b) => bomSubOrd(a.subSystem) - bomSubOrd(b.subSystem));
    const stageLabel = items[0].stageLabel || stageLabels[stageKey] || stageKey;
    for (const item of items) flat.push({ item, stageLabel });
  }
  const endRow = Math.min(flat.length, startRow + maxRows);

  let rowNum = startRow;
  {
    for (const { item, stageLabel } of flat.slice(startRow, endRow)) {
      rowNum++;
      const bg = rowNum % 2 === 0 ? 'background:#f8f8f8;' : '';
      const reqBadge = item.required !== false
        ? ''
        : ' <span style="font-size:7px;background:#eee;padding:1px 3px;">OPT</span>';
      const descExtra = item.description && item.description !== item.model
        ? '<br/><span style="color:#555;font-size:7px;">' + item.description + '</span>'
        : '';
      // ECD §1/§2 — every rendered row carries its STABLE ROW ID and its ONE
      // authority state as machine-readable attributes, so the row-ID multiset
      // gate (rendered == evidence == export) is measurable on the artifact.
      const _pa = (item as PermitBOMItem).procurement;
      html += '<tr style="' + bg + '"'
        + ' data-bom-line-id="' + escapeH((item as PermitBOMItem).bomLineId ?? '') + '"'
        + ' data-bom-authority-state="' + escapeH(_pa?.authorityState ?? 'UNCLASSIFIED') + '"'
        + ' data-bom-quantity-source="' + escapeH(_pa?.quantitySource ?? '') + '"'
        + (_pa?.blockingRequirementCodes?.length
          ? ' data-bom-blocking-requirements="' + escapeH(_pa.blockingRequirementCodes.join(' ')) + '"' : '')
        + '>';
      html += '<td class="mono f-lg" style="color:#888;text-align:center">' + rowNum + '</td>';
      html += '<td style="font-size:7.5px;color:#555">' + (item.stageLabel || stageLabel) + '</td>';
      if (bySub) html += '<td style="font-size:7.5px;font-weight:700;">' + bomSubLabel(item.subSystem) + '</td>';
      html += '<td style="text-transform:capitalize;font-weight:600">' + item.category.replace(/_/g, ' ') + '</td>';
      html += '<td>' + (item.manufacturer || '—') + '</td>';
      html += '<td style="font-size:8px;">' + (item.model || '—') + descExtra + reqBadge + '</td>';
      html += '<td class="mono f-lg">' + (item.partNumber || '—') + '</td>';
      // §6 (BAR) — a NON-ORDERABLE row states its DESIGN-QUANTITY status on the
      // quantity cell itself and is machine-tagged, so the quantity can never be
      // read as an authoritative procurement total.
      // PPC §8 — a row whose QUANTITY IS NOT ESTABLISHED may never print a bare
      // number: the sealing-cap row said "QUANTITY PENDING" in its description while
      // the cell printed a certain `0`. The two states are distinct (non-orderable =
      // authority unverified; quantity-pending = the count is unknown) and both are
      // now read from DECLARED fields — no `as { nonOrderable?: boolean }` cast.
      // ECD §2/§3 — the cell prints the row's ONE authority state. Before, two
      // booleans produced two labels and everything else printed a bare number
      // that read as an approved order quantity; a route-estimated footage had
      // no representation at all. The state drives the label, the colour and the
      // machine tags, so no cell can disagree with the counter. `data-bom-
      // orderable` is retained (harnesses/tests read it) as a PROJECTION.
      const _st = _pa?.authorityState
        ?? (item.nonOrderable ? 'CANDIDATE_NON_ORDERABLE'
          : item.quantityState === 'pending' ? 'QUANTITY_PENDING' : 'UNCLASSIFIED');
      const _stTag = ' data-bom-orderable="' + (_st === 'VERIFIED_ORDERABLE' ? 'true' : 'false') + '"'
        + ' data-bom-quantity-state="' + (item.quantityState ?? 'established') + '"';
      html += _st === 'VERIFIED_ORDERABLE'
        ? '<td class="tr fw7"' + _stTag + '>' + item.quantity + '</td>'
        : _st === 'ESTIMATED_FIELD_VERIFY'
          // Keep the design quantity VISIBLE (it is the budgeting number) and
          // label it. No nowrap — the cell is ~5% wide.
          ? '<td class="tr fw7"' + _stTag + ' style="color:#1d4ed8;">' + item.quantity
            + '<br/><span style="font-size:6px;font-weight:900;line-height:1.1;">EST — FIELD VERIFY</span></td>'
          : _st === 'QUANTITY_PENDING'
            ? '<td class="tr fw7"' + _stTag + ' style="color:#b45309;">'
              + '<span style="font-size:6px;font-weight:900;line-height:1.15;">'
              + escapeH(item.quantityStateLabel ?? (item.quantity + ' MODELED / FIELD QUANTITY PENDING'))
              + '</span></td>'
            : _st === 'EXCLUDED_NOT_APPLICABLE'
              ? '<td class="tr fw7"' + _stTag + ' style="color:#6b7280;">' + item.quantity
                + '<br/><span style="font-size:6px;font-weight:900;line-height:1.1;">NOT APPLICABLE</span></td>'
              : '<td class="tr fw7"' + _stTag + ' style="color:#b45309;">' + item.quantity
                + ' <span style="font-size:6px;font-weight:900;white-space:nowrap;">(DESIGN QTY — NOT ORDERABLE)</span></td>';
      html += '<td>' + item.unit + '</td>';
      html += '<td class="mono f-lg" style="font-size:7px;color:#2255aa;">' + (item.necReference || '—') + '</td>';
      html += '<td style="font-size:7px;color:#666;">' + (item.derivedFrom || '—') + '</td>';
      html += '</tr>';
    }
  }

  if (endRow < flat.length) {
    // More rows follow on the next continuation sheet — say so instead of clipping.
    html += '<tr style="background:#000;color:#fff;font-weight:bold;">';
    // AAC WS-10 — the permit profile has no SCHED continuation sheets, so the
    // row says where the remaining procurement lines ACTUALLY are (the in-app,
    // snapshot-bound BOM) instead of pointing at a sheet that is not in the set.
    const _contLabel = opts?.continuationLabel
      ? opts.continuationLabel(endRow + 1, flat.length)
      : 'CONTINUED ON NEXT SHEET — ITEMS ' + (endRow + 1) + '–' + flat.length;
    html += '<td colspan="' + nCols + '" style="text-align:center;letter-spacing:1px;">' + _contLabel + '</td>';
    html += '</tr>';
    html += '</tbody></table>';
    return html;
  }

  // PPC §5/§9 — the AUTHORITATIVE PROCUREMENT TOTAL is a COMPUTED object, not
  // prose. `TOTAL LINE ITEMS` stays as a distinct count (it counts everything,
  // including pending rows — that is what it means), and beneath it the schedule
  // now prints the total that procurement may actually act on: the ORDERABLE
  // subset only, with the excluded rows named. Before this there was no orderable
  // total at all — only this all-inclusive count plus a sentence that named 2 of
  // the 9 excluded rows, telling the reader the other 7 were included.
  // Scope = the FULL BOM (every line the package orders), not the rows this table
  // happens to show: panels/inverters render in their own schedules above, and an
  // "authoritative procurement total" that silently omitted them would be a second,
  // narrower total — the exact class of defect this pass exists to kill.
  const _proc = buildProcurementApproval(bom as PermitBOMItem[]);
  // ECD §1 (W1-C) — ONE COUNTER, ONE SCOPE. The rows this table does not show
  // (modules / inverters, scheduled in their own tables above) are named with
  // their STABLE ROW IDs so the rendered id multiset still equals the counted
  // population — the previous sheet printed "36 of 48" beneath 47 rendered rows
  // with nothing reconciling the difference.
  const _elsewhere = (bom ?? []).filter(i => BOM_SKIP_CATEGORIES.has(i.category)) as PermitBOMItem[];
  html += '<tr style="background:#000;color:#fff;font-weight:bold;"'
    + ' data-bom-population-total="' + _proc.totalRowCount + '"'
    + ' data-bom-rows-shown-here="' + flat.length + '"'
    + ' data-bom-rows-scheduled-above="' + _elsewhere.length + '">';
  html += '<td colspan="' + (bySub ? 7 : 6) + '" style="text-align:right;padding-right:8px;">'
    + 'BOM POPULATION &mdash; ALL ROWS, ALL STATES (' + flat.length + ' shown here'
    + (_elsewhere.length
      ? ' + ' + _elsewhere.length + ' scheduled above: '
        + _elsewhere.map(r => escapeH(r.category.replace(/_/g, ' '))).join(', ')
      : '')
    + ')</td>';
  html += '<td class="tr">' + _proc.totalRowCount + '</td>';
  html += '<td colspan="3" style="font-size:6.5px;font-weight:400;">'
    + _elsewhere.map(r => '<span data-bom-line-id="' + escapeH(r.bomLineId ?? '')
      + '" data-bom-authority-state="' + escapeH(r.procurement?.authorityState ?? 'UNCLASSIFIED') + '">'
      + escapeH(r.bomLineId ?? '—') + '</span>').join(' ')
    + '</td>';
  html += '</tr>';
  html += '<tr style="background:' + (_proc.partial ? '#7c2d12' : '#166534') + ';color:#fff;font-weight:bold;"'
    + ' data-procurement-total="' + _proc.verifiedOrderableCount + '"'
    + ' data-procurement-excluded="' + _proc.excludedLineItems + '"'
    + ' data-procurement-partial="' + (_proc.partial ? 'true' : 'false') + '"'
    + ' data-procurement-ready="' + (_proc.procurementReady ? 'true' : 'false') + '">';
  html += '<td colspan="' + (bySub ? 7 : 6) + '" style="text-align:right;padding-right:8px;">'
    + 'AUTHORITATIVE PROCUREMENT EXPORT &mdash; VERIFIED ORDERABLE ROWS ONLY (FULL BOM)</td>';
  html += '<td class="tr">' + _proc.verifiedOrderableCount + '</td>';
  html += '<td colspan="3" style="font-size:7px;">'
    + (_proc.partial
      ? _proc.excludedLineItems + ' of ' + _proc.totalRowCount + ' rows NOT ORDERABLE'
      : 'no exclusions')
    + '</td>';
  html += '</tr>';
  html += '</tbody></table>';

  const stageCount = Object.keys(grouped).length;
  html += '<div style="padding:var(--xs);font-size:var(--f-md);line-height:1.5;border:var(--border);border-top:none;background:#fafafa;">';
  html += '<strong>BILL OF MATERIALS SUMMARY:</strong> ';
  // ECD §1/§10 — every count here is now the SAME approval object the table
  // totals and the exports read. RETIRED, and why:
  //   • "This system BOM contains {flat.length} line items"  — a RENDERER-LOCAL
  //     count of the slice this table happens to show, printed beside a
  //     full-BOM procurement total. Replaced by _proc.totalRowCount + the
  //     shown/scheduled-above split stated on the population row above.
  //   • "{N} items are required per NEC / manufacturer specification" — an
  //     ORTHOGONAL axis (required-vs-optional) that read as a procurement
  //     claim. Required-ness is already on each row's OPT badge; it is not a
  //     statement about what may be ordered, so it is not restated here.
  //   • "All quantities are derived from CAD geometry and equipment registry —
  //     no manual estimates." — FALSE: this design carries route-estimated
  //     rows whose own descriptions say "rough-in allowance; exact bend count
  //     pending field routing". The quantity BASIS is now stated per row
  //     (data-bom-quantity-source) and per state in the block below.
  html += 'This BOM population is ' + _proc.totalRowCount + ' rows across ' + stageCount + ' stages'
    + (_elsewhere.length ? ' (' + flat.length + ' listed in this table; '
      + _elsewhere.length + ' scheduled in the equipment tables above)' : '') + '. ';
  html += 'Each row states its own quantity BASIS and procurement state; the counts below are derived from those states. ';
  html += 'Structural items are computed from array layout per the governing structural code editions (see cover sheet GOVERNING CODES). ';
  // PPC §6 — the hardcoded `705.12` here is a LOAD-SIDE-only article and this
  // summary has no topology in scope; conductor sizing does not depend on the
  // interconnection article at all, so the inapplicable clause is DROPPED rather
  // than guessed. The design's governing interconnection article is stated once,
  // topology-driven, on PV-4B / E-1 / the AC branch schedule.
  html += 'Electrical items are sized per NEC 690.8 and 310.15 and equipment registry rules '
    + '(the governing NEC 705 interconnection article for this design is stated on the AC branch schedule and PV-4B).';
  // PPC §5/§9 — the exclusion statement is now DERIVED from the computed
  // procurement-approval object, so it can never again enumerate a subset of the
  // excluded rows (the old prose filtered on `nonOrderable` alone and named only
  // `wire, lag bolt` while 7 pending racking rows plus the pending-quantity cap row
  // were also excluded — the sentence itself asserted they were included).
  // ── ECD §10 — THE PROCUREMENT AUTHORITY SUMMARY ───────────────────────────
  // Every number is derived from the row states; nothing is enumerated twice.
  // The previous block enumerated every excluded row inline — at 12 exclusions
  // it already needed 6.3px to fit, and the honest state model produces ~37, so
  // a per-row enumeration here would clip the sheet AND duplicate what each row
  // already says in its own cell. Instead: the five state counts, the affected
  // categories per non-orderable state, and the OPEN procurement-impact
  // requirement codes — each row's own reason stays on the row, and the full
  // machine-readable list is in the evidence artifact.
  if (_proc.partial) {
    const _cats = (state: string): string => {
      const seen: string[] = [];
      for (const e of _proc.exclusions) {
        if (e.authorityState !== state) continue;
        const c = e.category.replace(/_/g, ' ');
        if (!seen.includes(c)) seen.push(c);
      }
      return seen.join(', ');
    };
    html += '<div style="margin-top:1px;font-size:6.3px;color:#7c2d12;line-height:1.15;"'
      + ' data-procurement-summary="state-derived">';
    html += '<strong>PROCUREMENT AUTHORITY SUMMARY &mdash; ' + _proc.totalRowCount + ' BOM ROWS:</strong> ';
    html += '<span data-procurement-state-count="VERIFIED_ORDERABLE">' + _proc.verifiedOrderableCount
      + ' VERIFIED ORDERABLE</span> &middot; ';
    html += '<span data-procurement-state-count="ESTIMATED_FIELD_VERIFY">' + _proc.estimatedFieldVerifyCount
      + ' ESTIMATED &mdash; FIELD VERIFY' + (_proc.estimatedFieldVerifyCount ? ' (' + escapeH(_cats('ESTIMATED_FIELD_VERIFY')) + ')' : '')
      + '</span> &middot; ';
    html += '<span data-procurement-state-count="CANDIDATE_NON_ORDERABLE">' + _proc.candidateNonOrderableCount
      + ' CANDIDATE &mdash; NOT SELECTED' + (_proc.candidateNonOrderableCount ? ' (' + escapeH(_cats('CANDIDATE_NON_ORDERABLE')) + ')' : '')
      + '</span> &middot; ';
    html += '<span data-procurement-state-count="QUANTITY_PENDING">' + _proc.quantityPendingCount
      + ' QUANTITY NOT ESTABLISHED' + (_proc.quantityPendingCount ? ' (' + escapeH(_cats('QUANTITY_PENDING')) + ')' : '')
      + '</span> &middot; ';
    html += '<span data-procurement-state-count="EXCLUDED_NOT_APPLICABLE">' + _proc.excludedCount
      + ' NOT APPLICABLE</span>. ';
    html += '<strong>AUTHORITATIVE PROCUREMENT EXPORT: ' + _proc.authoritativeExportCount
      + ' row' + (_proc.authoritativeExportCount === 1 ? '' : 's') + '</strong> &mdash; every other row is EXCLUDED '
      + 'from the authoritative total AND from every procurement export; each row states its own state and reason above. ';
    if (_proc.openProcurementRequirementCodes.length) {
      html += 'OPEN PROCUREMENT-IMPACT REQUIREMENTS (see RS-1): '
        + _proc.openProcurementRequirementCodes.map(c =>
          '<span data-procurement-open-requirement="' + escapeH(c) + '">' + escapeH(c) + '</span>').join(' &middot; ')
        + '. ';
    }
    html += '<strong>PROCUREMENT READY: NO.</strong> This package is NOT an approved procurement release.</div>';
  } else {
    html += ' <span style="font-weight:bold;" data-procurement-summary="state-derived">'
      + escapeH(_proc.statement) + '</span>';
  }
  html += '</div>';

  return html;
}

/** Continuation sheet(s) for long BOMs — rendered only when the BOM exceeds
 *  SCHED_BOM_ROWS_FIRST rows (generatePermit decides). W9/§15: paginates across
 *  as many sheets as the BOM needs (SCHED-2, SCHED-3, …), each capped at
 *  SCHED_BOM_ROWS_CONT rows so no continuation page clips. `contIndex` is
 *  0-based (0 = SCHED-2). */
export function pageEquipmentScheduleCont(input: PermitInput, cad: CADModel, pageNum: number, totalPages: number, contIndex = 0): string {
  const startRow = SCHED_BOM_ROWS_FIRST + contIndex * SCHED_BOM_ROWS_CONT;
  const sheetId = contIndex === 0 ? 'SCHED-2' : `SCHED-${contIndex + 2}`;
  return `
  <div class="page">
    ${titleBlock(input, sheetId, 'EQUIPMENT SCHEDULE (CONTINUED)', pageNum, totalPages)}
    <div class="page-content">
      ${renderBOMTable(input.bom, startRow, SCHED_BOM_ROWS_CONT, { bySub: isHybridPlanset(cad) })}
    </div>
  </div>`;
}

export function pageEquipmentSchedule(input: PermitInput, cad: CADModel, pageNum: number, totalPages: number): string {
  const { system, bom, project, compliance } = input;
  const _cpEq = projectCodeAuthorityFromInput(input);   // W4 §2 code editions
  // CAD-sourced equipment counts
  const cadTotalPanels = cad.totalPanels;
  const cadTotalDcKw   = cad.totalDcKw;
  // Topology-aware: a microinverter system has NO 52-module DC series string
  // and no DC source circuits — modules pair 1:1 with microinverters and the
  // field wiring is AC branch circuits (Q-Cable). Use the SAME branch planner
  // PV-4A/PV-4B/E-1 use so the schedule can't disagree with them.
  const _schedIsMicro = topologyToLegacy(getInverterTopology(input, cad)) === 'MICRO';
  const _schedPP      = (project.panelPositions ?? []) as Array<{ id: string }>;
  const _schedGroupLabel = _schedIsMicro ? 'Array' : 'String';
  // AC branch circuit schedule for micro — OCPD / conductor / ampacity come
  // from the shared conductor authority (same values PV-4A/PV-4B/E-1/BOM print),
  // not a hardcoded 20A/#10 row.
  const _schedAuth = buildConductorAuthority(input, cad);
  // §6 (closeout 2026-07-23) — the micro AC branch conductor is the LISTED Q-Cable
  // ASSEMBLY (manufacturer + model/SKU), never a generic "#12 AWG THWN-2 + EGC".
  // peekSnapshot (non-throwing) so standalone unit renders fall back to the callout.
  const _schedSnap = peekSnapshot(input);
  // §3 (BAR) — the SCHED compliance conclusion + the wire-sizing "VERIFIED" badge
  // are DERIVED from the permit-readiness registry, never hardcoded. While ANY
  // blocking release blocker is active the sheet renders a DESIGN REVIEW PACKAGE /
  // COMPLIANCE-NOT-YET-ESTABLISHED conclusion and suppresses positive/PASS/VERIFIED
  // language (gate 3). Positive language only when zero blocking items remain.
  const _schedBlocking = (_schedSnap?.permitReadiness?.registry ?? [])
    .filter(r => r.severity === 'blocking' && !r.resolved);
  const _schedHasBlockers = _schedSnap
    ? (_schedBlocking.length > 0 || _schedSnap.permitReadiness?.ready === false)
    : false;
  const _schedAsm = projectListedCableAssembly(_schedSnap);
  const _schedBranchConductorCell = (fallback: string): string =>
    _schedAsm.present ? _schedAsm.conductorCell : fallback;
  // §Q — the AC-trunk BOM quantity annotation. When the drop-based procurement
  // footage is short of the Σ designed-installed path, the base cable quantity is
  // NON-ORDERABLE / PENDING SOLUTION (like the racking pattern) with the deficit shown.
  const _schedPS = _schedSnap?.electrical?.procurementSufficiency ?? null;
  // Render the AC-trunk BOM annotation ONLY when the procurement is SHORT (the
  // meaningful, fail-closed case). When sufficient, SCHED stays unchanged (no extra
  // line ⇒ no page-fit regression); the base cable quantity + "sanity OK" note
  // already print on PV-4B's LISTED AC TRUNK CABLE ASSEMBLY block.
  // WS-2 — the AC-trunk note now states the RESOLVED PROCUREMENT when one exists.
  // A measured shortfall with a designed purchase is not "PENDING SOLUTION"; and
  // the installed requirement is never printed as a purchase quantity.
  const _schedQP = _schedSnap?.electrical?.qcableProcurement ?? null;
  const _schedTrunkBomNote = (() => {
    if (!_schedAsm.present) return '';
    if (_schedQP?.present && _schedQP.compatibilityStatus === 'VERIFIED') {
      const _alloc = _schedQP.branchAllocations.filter(a => a.allocatedSections > 0)
        .map(a => `${escapeH(a.branchLabel)} +${a.allocatedSections}×${_schedQP.stockUnitLengthFt && _schedQP.stockUnitConnectorSections
          ? (Math.round((_schedQP.stockUnitLengthFt / _schedQP.stockUnitConnectorSections) * 100) / 100) : '—'} ft`).join(', ');
      return `<div style="padding:1px 4px;font-size:6.4px;line-height:1.15;border:var(--border);border-top:none;background:#eef7ee;">
        <strong>AC TRUNK CABLE (PROCUREMENT):</strong> INSTALLED requirement <span class="mono">${_schedQP.topologyConstrainedInstalledDeficitFt} ft</span> additional on a per-branch basis (${_alloc || 'none'}) &mdash; an INSTALLED length, not an order quantity.
        ORDER: <span class="mono">${escapeH(String(_schedQP.stockUnitsRequired ?? '—'))} × ${escapeH(_schedQP.stockUnitDescription ?? _schedQP.selectedStockSku ?? '—')}</span>
        covering all ${_schedQP.totalSectionsRequired} connector section(s) (${_schedQP.baseSectionsOrdered} base + ${_schedQP.additionalSectionsRequired} allocated); ${_schedQP.additionalStockUnitsRequired === 0 ? 'no additional package beyond the base order' : `${_schedQP.additionalStockUnitsRequired} package(s) beyond the base order`}.
        Expected remaining stock <span class="mono">${_schedQP.expectedRemainingStockFt ?? '—'} ft</span>. Method: cut listed cable + IQ Field Wireable Connector pair per ${escapeH(_schedQP.evidenceIds[0] ?? 'the archived manual')}.</div>`;
    }
    if (!_schedPS?.insufficient) return '';
    return `<div style="padding:1px 4px;font-size:6.4px;line-height:1.15;border:var(--border);border-top:none;background:#fdecec;">
        <strong>AC TRUNK CABLE (BOM):</strong> base cable quantity <span class="mono">${_schedPS.procurementLengthFt ?? '—'} ft</span> = CURRENT BASE CABLE QUANTITY &mdash; <strong style="color:#b00">PROCUREMENT INSUFFICIENCY: short of the ${_schedPS.totalDesignedInstalledFt} ft designed-installed path by ${_schedPS.deficitFt} ft. NON-ORDERABLE / PENDING SOLUTION</strong> (verified listed cable-extension required; QCABLE-PROCUREMENT-INSUFFICIENT, see RS-1).</div>`;
  })();
  // GROUNDING AUTHORITY (2026-07-25) — SCHED renders the open-air branch grounding
  // OUTCOME through the BOM ROW ITSELF (the schedule's procurement surface): while
  // the outcome is PENDING the candidate EGC row carries the non-orderable design-
  // quantity label, the pending NEC basis and the blocker code, and the BOM summary
  // excludes it from the authoritative procurement totals. No extra note block is
  // emitted here — SCHED is the densest sheet in the set and an added block pushes
  // the page conclusion past the printable box (page-fit gate 13). The full
  // authority prose lives on E-1 / PV-4B / PV-1B / RS-1.
  // 75°C ampacity display keyed to conductor size (NEC 310.16).
  const _schedAmpacity = (gauge: string): string => ({
    '#12 AWG': '25A (#12)', '#10 AWG': '35A (#10)', '#8 AWG': '50A (#8)',
    '#6 AWG': '65A (#6)', '#4 AWG': '85A (#4)',
  } as Record<string, string>)[gauge] ?? gauge;
  // §2 — the AC-branch Status cell is the ONE shared tri-state result: a branch
  // only shows ✓ PASS when its rating values are present AND continuous ≤ OCPD ≤
  // mfr branch max AND devices ≤ mfr per-branch limit; a blank rating ⇒ PENDING,
  // an over-limit branch ⇒ FAIL. Replaces the unconditional "&check;".
  // PPC §6 — the tri-state logic is CORRECT; the COLUMN LABEL was the lie. This
  // result covers ampacity / device-rating ONLY (continuous ≤ OCPD, devices ≤ mfr
  // per-branch limit, OCPD ≤ mfr branch max). It says NOTHING about route
  // authority, grounding authority or procurement sufficiency — all three of which
  // are PENDING/BLOCKED on this design — so a bare "✓ PASS" under a generic
  // "Status" column read as a branch-wide release. The column is now
  // "AMPACITY / DEVICE-RATING RESULT" and a pass renders
  // "PASS — ELECTRICAL RATING ONLY", with the other authorities stated per branch
  // in the companion BRANCH RELEASE STATUS matrix below.
  const SCHED_RATING_COL = 'AMPACITY / DEVICE-RATING RESULT';
  const _ratingCell = (r: ReturnType<typeof evaluateCompliance>): string =>
    r.state === 'PASS'
      ? `<span class="mono fw7" style="color:#127a3e">PASS &mdash; ELECTRICAL RATING ONLY</span>`
      : complianceBadge(r);
  const _schedBranchResult = (
    b: { deviceCount: number; ocpdAmps: number; branchCurrentA: number; continuousA: number },
    model?: string | null, mfr?: string | null,
  ) => {
    const lim = microMaxPerBranch(model, mfr);
    const ocpdLim = microBranchMaxOcpdA(model, mfr);
    return evaluateCompliance({
      requiredValues: [
        { label: 'device count', value: b.deviceCount, numeric: true },
        { label: 'branch OCPD', value: b.ocpdAmps, numeric: true },
        { label: 'continuous current', value: b.continuousA, numeric: true },
      ],
      checks: [
        { label: 'continuous ≤ OCPD (NEC 240.4)', pass: Number.isFinite(b.continuousA) && Number.isFinite(b.ocpdAmps) ? b.continuousA <= b.ocpdAmps : null },
        { label: `devices ≤ mfr per-branch limit (${lim})`, pass: lim > 0 ? b.deviceCount <= lim : null },
        { label: `OCPD ≤ mfr branch max (${ocpdLim}A)`, pass: ocpdLim > 0 ? b.ocpdAmps <= ocpdLim : null },
      ],
    });
  };
  const _schedBranchStatus = (
    b: { deviceCount: number; ocpdAmps: number; branchCurrentA: number; continuousA: number },
    model?: string | null, mfr?: string | null,
  ): string => _ratingCell(_schedBranchResult(b, model, mfr));
  const _schedStringStatus = (s: { ampacityA: number | null; ocpdAmps: number | null }): string =>
    _ratingCell(evaluateCompliance({
      requiredValues: [
        { label: 'string ampacity', value: s.ampacityA, numeric: true },
        { label: 'string OCPD', value: s.ocpdAmps, numeric: true },
      ],
    }));
  const _schedTopEq = _schedAuth.subSystems[0]?.equipment;
  const _schedAcRows = (_schedIsMicro && _schedPP.length ? _schedAuth.microBranches : []).map((b) => {
    return `<tr><td class="fw7 mono">B${b.index}</td><td>${b.deviceCount} &times; microinverter</td>`
      + `<td class="tr mono">${b.branchCurrentA.toFixed(1)}A</td><td class="tr mono">${b.continuousA.toFixed(1)}A</td>`
      + `<td class="tr mono fw7">${b.ocpdAmps}A</td><td style="font-size:7.5px">${_schedBranchConductorCell(b.conductorCallout)}</td><td class="tr">${_schedAmpacity(b.wireGauge)}</td>`
      + `<td class="center">${_schedBranchStatus(b, _schedTopEq?.inverterModel, _schedTopEq?.inverterManufacturer)}</td></tr>`;
  }).join('');
  // ── Wave 5B hybrid chrome ──────────────────────────────────────────────
  const _schedHybrid = _schedAuth.isHybrid;
  const _schedPrimaryKey = primarySubKey(cad);
  const _schedSubOf = (inv: unknown): string =>
    SUB_LABEL[inverterSubKey(inv as { subSystemKey?: string }, _schedPrimaryKey)];
  // Per-sub wire-sizing blocks — each sub's OWN branch/string set from the
  // shared authority (same values PV-4A/PV-4B/E-1 print).
  const _schedSubWireBlock = (sub: SubSystemConductorAuthority): string => {
    const eq2 = sub.equipment;
    const inv = [eq2.inverterManufacturer, eq2.inverterModel].filter(s => s && s !== '—').join(' ');
    const hdr = `${SUB_LABEL[sub.key]} — ${sub.panelCount} MODULES${inv ? ` — ${inv}` : ''} (${sub.topology})`;
    if (sub.isMicro) {
      const rows = sub.microBranches.map(b =>
        `<tr><td class="fw7 mono">B${b.index}</td><td>${b.deviceCount} &times; microinverter</td>`
        + `<td class="tr mono">${b.branchCurrentA.toFixed(1)}A</td><td class="tr mono">${b.continuousA.toFixed(1)}A</td>`
        + `<td class="tr mono fw7">${b.ocpdAmps}A</td><td style="font-size:7.5px">${_schedBranchConductorCell(b.conductorCallout)}</td><td class="tr">${_schedAmpacity(b.wireGauge)}</td>`
        + `<td class="center">${_schedBranchStatus(b, eq2.inverterModel, eq2.inverterManufacturer)}</td></tr>`).join('');
      return `
      <div class="section-title">AC Branch Circuit Schedule &mdash; ${hdr} &mdash; NEC 690.8(A)</div>
      <table class="equip-table">
        <thead><tr><th>Branch</th><th>Devices</th><th>Output (A)</th><th>&times;1.25 Cont. (A)</th><th>OCPD (A)</th><th>Conductor</th><th>Ampacity (90&deg;C)</th><th>${SCHED_RATING_COL}</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8" class="center">AC branch layout pending module placement &mdash; see PV-4A</td></tr>'}</tbody>
      </table>`;
    }
    const rows = sub.dcStrings.map(s =>
      `<tr><td class="fw7">${s.label}</td>`
      + `<td class="tr mono">${s.ampacityA != null ? s.ampacityA.toFixed(2) + 'A' : '—'}</td>`
      + `<td class="tr mono fw7">${s.ocpdAmps != null ? s.ocpdAmps + 'A' : '—'}</td>`
      + `<td>${s.wireGauge} USE-2</td>`
      + `<td class="tr">${s.voltageDropPct != null ? s.voltageDropPct.toFixed(2) + '%' : '—'}</td>`
      + `<td class="tr">${s.lengthFt != null ? s.lengthFt + ' ft' : '—'}</td>`
      + `<td class="center">${_schedStringStatus(s)}</td></tr>`).join('');
    return `
      <div class="section-title">DC String Wire Sizing &mdash; ${hdr} &mdash; NEC 690.8</div>
      <table class="equip-table">
        <thead><tr><th>String</th><th>Isc&times;1.25 (A)</th><th>OCPD (A)</th><th>Wire</th><th>V-Drop</th><th>Length</th><th>${SCHED_RATING_COL}</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7" class="center">String plan pending &mdash; see PV-4B</td></tr>'}</tbody>
      </table>`;
  };
  // PPC §6 — TOPOLOGY-DRIVEN code reference. The section title hardcoded
  // "NEC 690.8(A) / 705.12" — a LOAD-SIDE-only article — on a design whose
  // canonical interconnection rule is 705.11 (supply side). The article now comes
  // from the snapshot's own interconnection rule.
  const _schedIsSupply = _schedSnap?.project?.interconnection?.rule === '705.11';
  const _sched705 = _schedIsSupply ? '705.11' : '705.12';
  // PPC §6 — BRANCH RELEASE STATUS. The rating column answers ampacity/device
  // rating only; these are the OTHER authorities, per branch, from the canonical
  // objects. Never fabricated: the route verification state is schedule-level
  // (there is ONE BRANCH_RUN segment) with a per-branch length PROVENANCE; the
  // grounding outcome is one global result scoped to branchIds; the Q-Cable deficit
  // is NOT apportioned per branch (AFFECTED / NOT AFFECTED only).
  const _schedBranchAuthorityBlock = (() => {
    if (!_schedIsMicro || !_schedSnap) return '';
    const _rows = _schedAuth.microBranches;
    if (!_rows.length) return '';
    const _routeSt = routeVerificationStatus(_schedSnap);
    const _routeVerified = _routeSt === 'field-measured' || _routeSt === 'field-verified' || _routeSt === 'as-built-verified';
    const _gnd = projectOpenAirBranchGrounding(_schedSnap);
    const _schedQPCell = _schedSnap.electrical?.qcableProcurement ?? null;
    const _schedQPResolved = _schedQPCell?.present === true && _schedQPCell.compatibilityStatus === 'VERIFIED';
    // WS-2 SCHED REPAIR. This tested `verificationState !== 'verified'`, but that
    // field is a PROSE SENTENCE ('verified manufacturer document (exact-SKU
    // applicability confirmed)'), so the test was true for EVERY outcome and SCHED
    // printed "GROUNDING AUTHORITY: PENDING MANUFACTURER AUTHORITY" even after the
    // IQ8A product-grounding question closed on the archived IOM. The predicate is
    // now the OUTCOME itself — a value, not a sentence.
    const _gndPending = _gnd.outcome === 'PENDING_MANUFACTURER_AUTHORITY';
    const _paths = _schedSnap.electrical?.branchCablePaths ?? [];
    const _affected = new Set(_schedPS?.insufficient ? (_schedPS.affectedBranchIds ?? []) : []);
    const _amber = (t: string) => `<strong style="color:#b45309">${t}</strong>`;
    const BRANCH_RUN_SEGMENT_LABEL = 'BRANCH_RUN';
    // A value that is IDENTICAL on every branch is stated ONCE (repeating it reads
    // as N independent determinations). The instant any branch differs, every branch
    // prints its own — the collapse is conditional, never assumed.
    const _provAll = _rows.map(b => (_paths.find(pp => pp.branchLabel === `B${b.index}`)
      ?? _paths[b.index - 1] ?? null)?.lengthProvenance ?? null);
    const _provUniform = _provAll.length > 0 && _provAll.every(v => v === _provAll[0]);
    // The two SCHEDULE-LEVEL authority statements (identical for every branch).
    const _routeCellShared = _routeVerified
      ? `ROUTE AUTHORITY: VERIFIED (${escapeH(routeVerificationLabel(_routeSt))})`
      : `ROUTE AUTHORITY: ${_amber('PENDING')} &mdash; ${escapeH(routeVerificationLabel(_routeSt))}`;
    // WS-2 SCHED REPAIR — the grounding line states the SEPARATED authorities.
    // "All pending" was false once the product question closed; "all verified"
    // would be equally false while racking bonding is unresolved. Each domain
    // states its own result, from its own object.
    const _bondPending = (_schedSnap.electrical?.groundingObjects ?? [])
      .some(g => g.groundingId === 'gnd-array-bond' && g.bondingMethod == null);
    const _gndCellShared = _gndPending
      ? `GROUNDING &mdash; IQ8A PRODUCT: ${_amber('PENDING MANUFACTURER AUTHORITY')}`
        + ` &middot; ARRAY/RACKING BONDING: ${_bondPending ? _amber('METHOD PENDING') : 'ESTABLISHED'} (separate authority)`
      : `GROUNDING &mdash; IQ8A PRODUCT: NO SEPARATE EGC REQUIRED (verified manufacturer document`
        + `${_gnd.authority?.documentId ? ` ${escapeH(_gnd.authority.documentId)}` : ''})`
        + ` &middot; ARRAY/RACKING BONDING: ${_bondPending ? _amber('METHOD PENDING') : 'ESTABLISHED'} (separate authority &mdash; UL 2703 assembly)`
        + ` &middot; RACEWAY BONDING: per route-segment material`;
    // Rendered as compact per-branch LINES inside the existing interpretation box —
    // SCHED is the densest sheet in the set and a separate titled table pushed the
    // page conclusion 115px past the printable box (page-fit gate 17).
    const _lines = _rows.map(b => {
      const _label = `B${b.index}`;
      const _path = _paths.find(pp => pp.branchLabel === _label) ?? _paths[b.index - 1] ?? null;
      const _prov = _path?.lengthProvenance ?? null;
      // WS-2 — a branch that WAS short is no longer "AFFECTED — <requirement
      // code>" once the procurement design answers it: the requirement is closed,
      // so naming it here would cite a requirement that is not open. A resolved
      // branch states its own ALLOCATION instead; an unanswered one keeps the
      // blocker citation exactly as before.
      const _qpAlloc = _schedQPCell?.branchAllocations
        .find(a => a.branchId === (_path?.branchId ?? '')) ?? null;
      const _procCell = 'PROCUREMENT SUFFICIENCY: ' + (
        _schedQPResolved
          ? (_qpAlloc && _qpAlloc.allocatedSections > 0
              ? `RESOLVED &mdash; +${_qpAlloc.allocatedSections} section(s) allocated (${_qpAlloc.allocatedNewUsableLengthFt} ft installed)`
              : (_qpAlloc && _qpAlloc.nonRedistributableSurplusFt > 0
                  ? `RESOLVED &mdash; ${_qpAlloc.nonRedistributableSurplusFt} ft surplus, NOT redistributable`
                  : 'RESOLVED &mdash; covered by the ordered cable'))
          : (!_schedPS?.insufficient
              ? 'NOT AFFECTED'
              : ((_affected.has(_path?.branchId ?? '') || _affected.size === 0)
                  ? _amber('AFFECTED &mdash; QCABLE-PROCUREMENT-INSUFFICIENT')
                  : 'NOT AFFECTED')));
      const _release = (_routeVerified && !_gndPending && !_bondPending
        && (_schedQPResolved || !_schedPS?.insufficient) && !_schedHasBlockers)
        ? 'RELEASED' : _amber('BLOCKED');
      // The two SCHEDULE-LEVEL authorities (route verification state, grounding
      // outcome) are stated ONCE in the header, not repeated verbatim on every
      // branch: they carry the SAME value for every branch by construction, and
      // repeating them read as three independent per-branch determinations — which
      // is precisely the fabrication §6 forbids. What is genuinely per-branch stays
      // per-branch: the length PROVENANCE and the procurement-sufficiency AFFECTED
      // state. (It is also what keeps this block inside SCHED's ~1 line of slack
      // when the deficit fires and the procurement cell grows — gate 17.)
      return `<div><strong class="mono">${_label}</strong> &mdash; `
        + `${_provUniform ? '' : `length provenance: ${_prov ? escapeH(_prov) : 'NOT ESTABLISHED'} &middot; `}`
        + `${_procCell} &middot; OVERALL RELEASE: ${_release}</div>`;
    }).join('');
    // Header line: scope + the two schedule-level authorities + the honesty caveats.
    const _b = _rows.map(r => `B${r.index}`).join(', ');
    // WS-2 — THE canonical apportionment sentence, projected from the procurement
    // resolution. Both deficits are stated (they answer different questions), the
    // governing one is named, and the non-redistributable surplus is stated as
    // such so nobody nets it against a short branch.
    const _qp = _schedSnap.electrical?.qcableProcurement ?? null;
    const _schedQCableApportionment = (() => {
      if (!_qp?.present) return 'the &Sigma; Q-Cable deficit is not apportioned on this design';
      const _short = _qp.branchAllocations.filter(a => a.shortageFt > 0);
      const _surp = _qp.branchAllocations.filter(a => a.nonRedistributableSurplusFt > 0);
      if (_short.length === 0 && _surp.length === 0) {
        return 'Q-Cable: every branch is covered by the ordered cable';
      }
      const _alloc = _short.map(a => `${escapeH(a.branchLabel)} ${a.shortageFt} ft`).join(' + ');
      const _surplusTxt = _surp.length
        ? ` The ${_qp.nonRedistributableSurplusFt} ft surplus on `
          + `${_surp.map(a => escapeH(a.branchLabel)).join(', ')} is NOT redistributable under the current `
          + 'branch topology (a Q-Cable branch is one continuous run).'
        : '';
      return `Q-Cable: aggregate installed-length deficit ${_qp.aggregateInstalledDeficitFt} ft; the GOVERNING `
        + `topology-constrained requirement is ${_qp.topologyConstrainedInstalledDeficitFt} ft, allocated as `
        + `${_alloc}.${_surplusTxt}`;
    })();
    return `<div style="margin-top:1px;font-size:6px;line-height:1.15;">`
      + `<div><strong>BRANCH RELEASE STATUS &mdash; authorities beyond the ${escapeH(SCHED_RATING_COL)} column</strong>`
      + ` &middot; ${_routeCellShared} (schedule-level: ONE ${escapeH(BRANCH_RUN_SEGMENT_LABEL)} segment for ${escapeH(_b)}`
      + `${_provUniform ? `; length provenance ${escapeH(String(_provAll[0] ?? 'NOT ESTABLISHED'))} on every branch` : '; per-branch length PROVENANCE below'})`
      + ` &middot; ${_gndCellShared} (ONE authority scoped to ${escapeH(_b)})`
      // TAC WS-18 — "blockers: RS-1" degraded to a bare noun phrase once the
      // reference pass rewrote the sheet id; state the pointer as a sentence so
      // it reads correctly whether it resolves to a sheet or to the record.
      // WS-2 SCHED REPAIR — this said "the Σ Q-Cable deficit is NOT apportioned per
      // branch", which stopped being true the moment the package began calculating
      // per-branch shortfalls. It now states the canonical allocation, from the
      // procurement resolution's own numbers; no literal is typed here.
      + `<span style="color:#555;"> &middot; ${_schedQCableApportionment} &middot; open blockers: see RS-1</span></div>`
      + _lines
      + `</div>`;
  })();
  const _schedHybridWireBlocks = _schedHybrid
    ? _schedAuth.subSystems.map(_schedSubWireBlock).join('') + `
      <div style="padding:var(--xs);font-size:var(--f-md);line-height:1.5;border:var(--border);border-top:none;background:#fafafa;">
        <strong>WIRE SIZING INTERPRETATION (HYBRID):</strong>
        Each sub-system's circuits are sized from ITS OWN equipment and module subset per NEC 690.8 — micro sub-systems
        as AC branch circuits (&times;1.25 continuous), string/optimizer sub-systems as DC source circuits (Isc &times; 1.25,
        OCPD per 690.8(B)). Values match PV-4A / PV-4B / E-1 (shared conductor authority). Rooftop temperature adder
        applies to ROOF sub-system circuits only.
        ${_schedBranchAuthorityBlock}
      </div>`
    : '';
  const _schedAcBranchBlock = `
      <div class="section-title">AC Branch Circuit Schedule &mdash; NEC 690.8(A) / ${_sched705}</div>
      <table class="equip-table">
        <thead><tr><th>Branch</th><th>Devices</th><th>Output (A)</th><th>&times;1.25 Cont. (A)</th><th>OCPD (A)</th><th>Conductor</th><th>Ampacity (90&deg;C)</th><th>${SCHED_RATING_COL}</th></tr></thead>
        <tbody>${_schedAcRows || '<tr><td colspan="8" class="center">AC branch layout pending module placement &mdash; see PV-4A</td></tr>'}</tbody>
      </table>
      ${/* PPC gate 17 — 7.4px/1.2 (was var(--f-md)/1.4). SCHED is the densest sheet
            in the set and this box now carries the BRANCH RELEASE STATUS matrix,
            whose procurement cell grows when the Q-Cable deficit fires. */''}
      <div style="padding:2px var(--xs);font-size:7.4px;line-height:1.2;border:var(--border);border-top:none;background:#fafafa;">
        <strong>WIRE SIZING INTERPRETATION (MICROINVERTER):</strong>
        Each module pairs 1:1 with a microinverter (no DC source circuits). AC branch trunks are sized per NEC 690.8(A) &times;1.25 continuous, each protected at its calculated OCPD (see table), terminating at the AC combiner.
        ${_schedBranchAuthorityBlock}
      </div>`;
  return `
  <div class="page">
    ${titleBlock(input, 'SCHED', 'EQUIPMENT SCHEDULE', pageNum, totalPages)}
    <div class="page-content">
      <div class="section-title">Solar Modules${_schedHybrid ? ' — per sub-system (hybrid)' : _schedIsMicro ? ' — each module paired 1:1 with a microinverter (no series DC string)' : ''}</div>
      <table class="equip-table">
        <thead><tr><th>${_schedGroupLabel}</th>${_schedHybrid ? '<th>System</th>' : ''}<th>Manufacturer</th><th>Model</th><th>Qty</th><th>Watts</th><th>Voc (V)</th><th>Isc (A)</th><th>Total kW</th><th>${_schedIsMicro ? 'Module DC Lead' : 'Wire'}</th><th>${_schedIsMicro ? 'Connector' : 'Run (ft)'}</th></tr></thead>
        <tbody>
          ${system.inverters?.flatMap((inv, invIdx) =>
            inv.strings?.map((str, strIdx) => {
              // §8 (closeout 2026-07-23) — on a 1:1 microinverter topology there is
              // NO field-installed DC string wire: each module connects to its
              // microinverter through the module's FACTORY-INTEGRATED DC leads
              // (MC4/EN4 connectors, NEC 690.31). There is no canonical DC route
              // segment, so we NEVER print a field-installed DC gauge/run (the old
              // `str.wireGauge` / `str.wireLength` row was an unbacked #10/22-ft
              // fabrication). We show the factory-lead fact from the module record.
              const _dcLeadCell = _schedIsMicro
                ? 'Factory-integrated leads'
                : `${str.wireGauge}`;
              const _dcRunCell = _schedIsMicro
                ? 'MC4 / EN4 (690.31)'
                : `${str.wireLength}`;
              return `
            <tr>
              <td class="fw7">${invIdx + 1}-${strIdx + 1}</td>
              ${_schedHybrid ? `<td class="fw7">${_schedSubOf(inv)}</td>` : ''}
              <td>${str.panelManufacturer || '—'}</td><td>${str.panelModel || '—'}</td>
              <td class="tr fw7">${str.panelCount}</td>
              <td class="tr">${str.panelWatts}W</td>
              <td class="tr">${str.panelVoc}V</td>
              <td class="tr">${str.panelIsc}A</td>
              <td class="tr fw7">${(str.panelCount * str.panelWatts / 1000).toFixed(2)}</td>
              <td${_schedIsMicro ? ' style="font-size:7.5px"' : ''}>${_dcLeadCell}</td>
              <td class="tr"${_schedIsMicro ? ' style="font-size:7.5px"' : ''}>${_dcRunCell}</td>
            </tr>`;
            }) || []
          ).join('')}
          <tr style="background:#f5f5f5;font-weight:bold">
            <td colspan="${_schedHybrid ? 4 : 3}">TOTAL</td><td class="tr">${system.totalPanels}</td>
            <td colspan="3"></td><td class="tr">${system.totalDcKw?.toFixed(2)}</td>
            <td colspan="2"></td>
          </tr>
        </tbody>
      </table>
      ${/* §8 — the DC-connection fact is carried by the "Module DC Lead" /
           "Connector" columns above (Factory-integrated leads · MC4/EN4, 690.31);
           no separate note needed (keeps SCHED page-content within its box). */''}
      <div class="section-title">Inverters${_schedHybrid ? ' — per sub-system (hybrid)' : ''}</div>
      <table class="equip-table">
        <thead><tr><th>#</th>${_schedHybrid ? '<th>System</th>' : ''}<th>Type</th><th>Manufacturer</th><th>Model</th><th>AC kW</th><th>Max DC V</th><th>Efficiency</th><th>UL Listing</th></tr></thead>
        <tbody>
          ${system.inverters?.map((inv, idx) => `
          <tr>
            <td class="fw7">${idx + 1}</td>
            ${_schedHybrid ? `<td class="fw7">${_schedSubOf(inv)}</td>` : ''}
            <td>${inv.type === 'micro' ? 'Microinverter' : inv.type === 'optimizer' ? 'String + Optimizer' : 'String'}</td>
            <td>${inv.manufacturer || '—'}</td><td>${inv.model || '—'}</td>
            <td class="tr">${Number(inv.acOutputKw).toFixed(2)}</td>
            <td class="tr">${inv.maxDcVoltage}V</td>
            <td class="tr">${inv.efficiency}%</td>
            <td>${inv.ulListing || 'UL 1741'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      ${(() => {
        // AC aggregation / monitoring device (the brand-integrated "brains" —
        // e.g. Enphase IQ Combiner 6C). Single-sourced with PV-6 / E-1 / BOM.
        const _bos = buildIntegratedEquipment(input, cad);
        if (!_bos.devices.length) return '';
        return `
      <div class="section-title">AC Aggregation &amp; Monitoring</div>
      <table class="equip-table">
        <thead><tr><th>Qty</th><th>Manufacturer</th><th>Model</th><th>Integrated Functions</th><th>Branches</th><th>Mounting</th></tr></thead>
        <tbody>
          ${_bos.devices.map(d => `
          <tr>
            <td class="tr fw7">${d.quantity}</td>
            <td>${d.brand}</td><td>${d.model}</td>
            <td style="font-size:8px;">${d.roleSummary}</td>
            <td class="tr">${d.branchSlots ? `${d.branchSlots}-pos` : '—'}</td>
            <td>${d.mounting === 'wall' ? 'Wall-mounted' : d.mounting || '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      ${_bos.branchSlotWarning ? `<div style="padding:var(--xs);font-size:var(--f-sm);border:var(--border);border-top:none;background:#fff8e1;"><strong>NOTE:</strong> ${_bos.branchSlotWarning}</div>` : ''}`;
      })()}
      <!-- Wire Sizing Justification (topology-aware: AC branches for micro, DC source circuits for string;
           hybrid: one block PER SUB from the shared conductor authority) -->
      ${/* PPC §9 / gate 17 — the standalone trunk-cable deficit note is RETIRED: the
            trunk BOM row itself now carries STATUS: NON-ORDERABLE / REASON /
            DESIGNED-INSTALLED / CURRENT BASE / DEFICIT / EXTENSION SOLUTION NOT
            SELECTED (that row is what an operator reading this schedule acts on), and
            PV-4B + RS-1 carry the full authority statement. Printing the same deficit
            twice on one sheet is the duplication this pass removes — and it is what
            pushed SCHED's page conclusion past the printable box. */''}
      ${_schedHybrid ? _schedHybridWireBlocks : _schedIsMicro ? _schedAcBranchBlock : `
      <div class="section-title">Wire Sizing Justification — NEC 690.8 & 310.15</div>
      <table class="equip-table">
        <thead><tr><th>Circuit</th><th>Isc (A)</th><th>Isc×1.25 (A)</th><th>OCPD ≥ Isc×1.56 (A)</th><th>Wire</th><th>Ampacity (90°C)</th><th>Derated</th><th>${SCHED_RATING_COL}</th></tr></thead>
        <tbody>
          ${system.inverters?.flatMap((inv, invIdx) =>
            inv.strings?.map((str, strIdx) => {
              const isc125 = (str.panelIsc * 1.25).toFixed(1);
              // P0-5b (data-authority register): the OCPD column prints the
              // conductor authority's STANDARD fuse (NEC 240.6 ladder) — the
              // raw Isc×1.25×1.25 product ("19.2A") is a nonexistent fuse.
              // The Isc×1.25 column stays precise (it is an ampacity basis,
              // not an OCPD). Fallback derives on the same canonical ladder.
              const _aStr = _schedAuth.dcStrings.find(d => d.invIdx === invIdx && d.strIdx === strIdx);
              const ocpd = _aStr?.ocpdAmps ?? necNextStandardOcpd(str.panelIsc * 1.56);
              return `
            <tr>
              <td class="fw7">DC ${invIdx + 1}-${strIdx + 1}</td>
              <td class="tr mono">${str.panelIsc}A</td>
              <td class="tr mono">${isc125}A</td>
              <td class="tr mono fw7">${ocpd}A</td>
              <td>${str.wireGauge} USE-2</td>
              <td class="tr">30A (#10), 40A (#8)</td>
              <td class="tr">≥ ${isc125}A</td>
              <td class="center">${_schedStringStatus({ ampacityA: _aStr?.ampacityA ?? null, ocpdAmps: ocpd })}</td>
            </tr>`;
            }) || []
          ).join('')}
        </tbody>
      </table>
      <div style="padding:var(--xs);font-size:var(--f-md);line-height:1.5;border:var(--border);border-top:none;background:#fafafa;">
        <strong>WIRE SIZING INTERPRETATION:</strong>
        All DC source circuit conductors are sized per NEC 690.8(A)(1) using Isc × 1.25 for continuous duty, with OCPD rated at Isc × 1.56 (1.25 × 1.25 per NEC 690.8(A)(1)×(B)(1)).
        USE-2 rated conductors (90\u00b0C) are specified for all PV source circuits to maximize ampacity margin under ${isRoof(cad.systemType) ? 'rooftop temperature' : isFence(cad.systemType) ? 'outdoor fence-mounted' : 'outdoor ground-mounted'} conditions.
        Conductor ampacity after derating exceeds the maximum circuit current for all circuits. No conductor upsizing is required.
      </div>
      <div style="padding:var(--xs);font-size:var(--f-sm);line-height:1.6;border:var(--border);border-top:none;background:#f0f4f8;">
        <strong>FORMULA REFERENCE — WIRE SIZING (NEC 690.8):</strong><br/>
        <span style="font-family:var(--mono);font-size:10px;">Max Circuit Current = Isc × 1.25 [690.8(A)(1)] &nbsp; | &nbsp; OCPD ≥ Isc × 1.56 [690.8(A)(1)×(B)(1)] &nbsp; | &nbsp; Conductor Ampacity ≥ Max Circuit Current (after derating)</span><br/>
        <span style="font-size:9px;color:#333;">
          The wire sizing chain ensures: (1) continuous duty factor accounts for sustained PV output under peak insolation,
          (2) OCPD rating provides 125% margin above continuous current for fuse/breaker coordination,
          (3) conductor ampacity (derated for temperature per NEC 310.15(B)(1) and conduit fill) exceeds the maximum circuit current.
          All PV source circuits use USE-2/THWN-2 rated at 90\u00b0C to maximize available ampacity under ${isRoof(cad.systemType) ? 'rooftop temperature' : 'outdoor'} conditions.
        </span>
        ${_schedHasBlockers
          ? `<span style="display:inline-block;margin-left:8px;padding:1px 8px;font-size:9px;font-weight:900;letter-spacing:0.5px;border-radius:2px;background:#b45309;color:#fff;">DESIGN REVIEW — NOT VERIFIED</span>`
          : `<span style="display:inline-block;margin-left:8px;padding:1px 8px;font-size:9px;font-weight:900;letter-spacing:0.5px;border-radius:2px;background:#000;color:#fff;">VERIFIED</span>`}
      </div>`}

      ${''/* D3 (Planset 17) — the compact profiles used to override the
           continuation label with "ITEMS n–m — FULL PROCUREMENT BILL OF
           MATERIALS IN THE PROJECT RECORD (SNAPSHOT-BOUND; NOT A PERMIT
           DOCUMENT)", because they carried no SCHED continuation sheet to point
           at. That sentence was true about where the rows lived and false about
           the schedule being complete: 38 of 48 lines were simply absent from
           the artifact a reviewer holds. Now that the continuations render on
           every profile the default label applies — it names the next SHEET,
           which is where the rows actually are. */}
      ${renderBOMTable(bom, 0, SCHED_BOM_ROWS_FIRST, { bySub: _schedHybrid })}


      <!-- System-Specific Hardware Schedule -->
         ${renderHardwareSchedule(input, cad)}

      <div style="padding:2px 6px;margin-top:2px;font-size:var(--f-sm);line-height:1.25;border:2px solid #000;background:#fff;">
        <strong>PAGE CONCLUSION — EQUIPMENT SCHEDULE:</strong>
        ${_schedAuth.isHybrid
          ? `This hybrid system utilizes ${system.totalPanels} modules across ${_schedAuth.subSystems.length} sub-systems (see the per-sub module tables above)`
          : `This system utilizes ${system.totalPanels} × ${system.inverters?.[0]?.strings?.[0]?.panelManufacturer || ''} ${system.inverters?.[0]?.strings?.[0]?.panelModel || ''} modules
        rated at ${system.inverters?.[0]?.strings?.[0]?.panelWatts || '—'}W each`} for a total DC capacity of ${system.totalDcKw?.toFixed(2) || '—'} kW.
        ${_schedHasBlockers
          ? `<strong style="color:#b45309;">DESIGN REVIEW PACKAGE &mdash; COMPLIANCE NOT YET ESTABLISHED. SEE RS-1 FOR ACTIVE RELEASE BLOCKERS (${_schedBlocking.length} OPEN).</strong> Equipment ratings and wire sizing shown are the design basis and are NOT a certified compliance conclusion while release blockers remain open.`
          : `All equipment is UL-listed; wire sizing verified per NEC 690.8 with derating; equipment complies with NEC ${_cpEq.nec ?? 'PENDING'} and UL 1741 / 61730 / 2703.`}
      </div>
    </div>
  </div>`;
}



export function pageStructuralPrimary(input: PermitInput, cad: CADModel, pageNum: number, totalPages: number, ctx?: RenderContext | null): string {
  // Use cad.systemType — single source of truth
  if (isFence(cad.systemType))  return pageFenceStructural(input, cad, pageNum, totalPages, ctx);
  if (isGround(cad.systemType)) return pageGroundStructural(input, cad, pageNum, totalPages, ctx);
  return pageRoofStructural(input, cad, pageNum, totalPages, ctx);
}




