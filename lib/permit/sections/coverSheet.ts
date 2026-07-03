// ═══════════════════════════════════════════════════════════════
// PV-0: Cover Sheet
// Extracted from route.ts — ZERO REGRESSION
// ═══════════════════════════════════════════════════════════════

import type { PermitInput } from '../types';
import type { CADModel } from '@/lib/cad/types';
import { titleBlock, buildConstructionNotes } from '../utils/titleBlock';
import { escapeH } from '../utils/drawing';
import { sysTypeLabel, topologyDisplayLabel, resolveInverterCount, utilityDisplayName, interconnectionLabel, isSupplySideInterconnection, roofTypeLabel, pv2Title, pv3Title, necNextStandardOcpd, type SysType } from '../utils/helpers';
import { schedBomRowCount, SCHED_BOM_ROWS_FIRST } from './structuralPages';
import {  getSystemType, getInverterTopology, getEquipmentContext, topologyToLegacy, isFence, isGround, isRoof, displaySystemTypeShort } from '@/lib/system';
import type { CanonicalInput } from '../types';
import { BUILD_VERSION } from '@/lib/version';
import { PLANSET_ENGINE_VERSION } from '../constants';

// ═══════════════════════════════════════════════════════════════════
// PAGE GENERATORS
// ═══════════════════════════════════════════════════════════════════

// ─── PV-0: Cover Sheet ───────────────────────────────────────────────────────

export function pageCoverSheet(input: PermitInput, cad: CADModel, pageNum: number, totalPages: number): string {
  const { project, system, compliance } = input;

  // ── Jurisdiction / code versions ──────────────────────────────────────────
  const necVer  = compliance.jurisdiction?.necVersion || '2020';
  const ibcVer  = '2021';
  const ifcVer  = necVer === '2023' ? '2024' : '2021';
  const state   = compliance.jurisdiction?.state || '';
  const ahj     = compliance.jurisdiction?.ahj   || '';
  // FIX v47.341: Convert utility slug to display name
  const utility = utilityDisplayName(project.utilityName || project.utilityMeter || '');
  const apn     = project.apn || '';

  // ── Equipment (4-source resolver) ─────────────────────────────────────────
  const eq = getEquipmentContext(input, cad);
  const moduleDisplay   = [eq.panelManufacturer, eq.panelModel].filter(s => s && s !== '—').join(' ') || '';
  const inverterDisplay = [eq.inverterManufacturer, eq.inverterModel].filter(s => s && s !== '—').join(' ') || '';

  // ── System values ─────────────────────────────────────────────────────────
  const totalPanels = system.totalPanels  || 0;
  const dcKw        = system.totalDcKw    ?? null;
  const acKw        = system.totalAcKw    ?? null;
  // v47.350: Use accessor layer (prefers SystemDefinition, falls back to legacy)
  const _topoCanonical = getInverterTopology(input, cad);
  const _resolvedTopo = topologyToLegacy(_topoCanonical);
  const topology    = _resolvedTopo;
  const svcAmps     = project.mainPanelAmps || null;
  const _c          = project._canonical as CanonicalInput | undefined;
  const mountSys    = _c?.mountSystem || project.mountingSystem || '';
  const roofType    = roofTypeLabel(project.roofType);
  // Prefer the CAD plane pitch (what PV-2's table prints) over the project
  // default, and keep 1 decimal — integer rounding made PV-0 say "4:12" while
  // PV-2 said "3.6:12" and PE-1 said "4/12 (20.0°)" on one package.
  const _pitchDegCover = cad.roof?.planes?.[0]?.pitch ?? project.roofPitch;
  const pitch       = _pitchDegCover
    ? `${(Math.tan(_pitchDegCover * Math.PI / 180) * 12).toFixed(1)}:12`
    : '';

  // ── Derived electrical values ──────────────────────────────────────
  // Error 6d fix: Prefer project.backfeedBreakerA (already NEC-computed by generatePermit.ts)
  // over recomputing from acKw. Also fix 120% rule to use separate bus rating and main breaker.
  const busRating   = project.panelBusRating || project.mainPanelAmps || 200;
  const mainBreaker = project.mainPanelAmps || 200;
  const backfeedA = project.backfeedBreakerA ?? project.pvBackfeedA
    ?? ((acKw !== null && acKw > 0) ? necNextStandardOcpd(acKw * 1000 / 240 * 1.25) : null);
  const busLimit     = busRating ? Math.round(busRating * 1.2) : null;
  const maxPvBreaker = busLimit !== null ? busLimit - mainBreaker : null;
  const rulePass     = (backfeedA !== null && maxPvBreaker !== null)
    ? backfeedA <= maxPvBreaker
    : null;

  // ── Interconnection ───────────────────────────────────────────────────────
  const interconn = project.interconnectionMethod
    ? interconnectionLabel(project.interconnectionMethod)
    : '';
  // Single-sourced supply-side flag (resolved compliance first, project field
  // second). The 120% math above ONLY applies to load-side connections.
  const isSupplySide = isSupplySideInterconnection(input);

  // ── Battery ───────────────────────────────────────────────────────────────
  const hasBattery    = (project.batteryCount ?? 0) > 0;
  const batteryDisplay = hasBattery
    ? [project.batteryBrand, project.batteryModel].filter(Boolean).join(' ')
    : '';

  // ── Vicinity map ──────────────────────────────────────────────────────────
  const aerial = input.aerialData;
  let vicinityMapHtml = '';
  if (aerial?.imageBase64) {
    vicinityMapHtml = `
        <div class=\"aerial-wrap\" style=\"height:150px;\">
        <img src="${aerial.imageBase64}" style="width:100%;height:150px;display:block;object-fit:cover;object-position:center;" alt="Vicinity Map"/>
          <div style=\"position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;\">
          <svg viewBox="0 0 36 46" width="32" height="42" style="display:block;margin:0 auto;">
            <circle cx="18" cy="18" r="16" fill="#000" stroke="#fff" stroke-width="2"/>
            <circle cx="18" cy="18" r="7" fill="#fff"/>
            <polygon points="18,34 12,27 24,27" fill="#000"/>
          </svg>
          <div class=\"f-xs fw9 aerial-pin-label\">
        </div>
          <div class=\"f-xs fw7 aerial-nts\">NTS</div>
      </div>
        </div>`;
  } else {
    vicinityMapHtml = `
      <div style="background:#e8e8e8;width:100%;height:120px;display:flex;align-items:center;justify-content:center;text-align:center;">
        <div class="f-sm fw7" style="letter-spacing:0.5px;">
          VICINITY MAP — ATTACH SITE PHOTOGRAPH OR SATELLITE IMAGE<br/>
          <span class="f-xs muted">${escapeH(project.address || '')}</span>
        </div>
      </div>`;
  }

  // ── Construction notes (bucketed) ─────────────────────────────────────────
  const rawNotes = buildConstructionNotes(input);
  interface NoteBucket { title: string; notes: string[]; }
  const buckets: NoteBucket[] = [
    { title: 'ELECTRICAL',              notes: [] },
    { title: 'STRUCTURAL / ATTACHMENT', notes: [] },
    { title: 'INSTALLATION',            notes: [] },
    { title: 'CODE COMPLIANCE',         notes: [] },
  ];
  const elecKw   = ['NEC 690','NEC 705','NEC 310','NEC 250','conduit','conductor','wire','ampacity','inverter','backfeed','disconnect','GFDI','AFCI','rapid shutdown','grounding','bonding','EGC'];
  const structKw = ['attachment','lag bolt','flashing','rafter','roof','torque','rail','racking','mounting','sheathing','penetration'];
  const instKw   = ['installer','manufacturer','permit','inspection','utility','energi','as-built','AHJ','NEM','PTO','substitut'];
  const compKw   = ['warning label','placard','NEC 690.54','IFC','listed','labeled','UL ','NFPA','IEEE','anti-island','production estimate','battery','BESS','generator','ATS'];

  for (const note of rawNotes) {
    if (compKw.some(k => note.toLowerCase().includes(k.toLowerCase()))) {
      buckets[3].notes.push(note);
    } else if (structKw.some(k => note.toLowerCase().includes(k.toLowerCase()))) {
      buckets[1].notes.push(note);
    } else if (instKw.some(k => note.toLowerCase().includes(k.toLowerCase()))) {
      buckets[2].notes.push(note);
    } else {
      buckets[0].notes.push(note);
    }
  }

  // ── Sheet index ───────────────────────────────────────────────────────────
  const includeCADAppendixPreview = input.cadAppendixPreviewV1 === true
    || input.planSetOptions?.cadAppendixPreviewV1 === true
    || input.permitOptions?.cadAppendixPreviewV1 === true;
  // Mirror generatePermit's dynamic page assembly EXACTLY — a hardcoded list
  // here shipped a 16-sheet set whose cover index listed only 15.
  const includeInternalValidation = input.permitOptions?.includeInternalValidation === true
    || input.planSetOptions?.includeInternalValidation === true;
  const includeSchedCont = schedBomRowCount(input.bom) > SCHED_BOM_ROWS_FIRST;
  const sheets = [
    { id: 'PV-0',  title: 'COVER SHEET — PROJECT OVERVIEW & GENERAL NOTES' },
    { id: 'PV-1',  title: 'SITE PLAN — EQUIPMENT LAYOUT & VICINITY' },
    { id: 'PV-2',  title: pv2Title(cad.systemType as SysType) },
    { id: 'PV-2B', title: 'ARRAY GEOMETRY — STRING LAYOUT & CONFIGURATION' },
    { id: 'PV-3',  title: pv3Title(cad.systemType as SysType) },
    { id: 'PV-4A', title: 'NEC COMPLIANCE — ELECTRICAL CODE ANALYSIS' },
    { id: 'PV-4B', title: 'CONDUCTOR SCHEDULE — WIRE SIZING & VOLTAGE DROP' },
    { id: 'PV-4C', title: 'STRUCTURAL CALCULATIONS — ASCE 7-22 ANALYSIS' },
    { id: 'PV-5',  title: 'WARNING LABELS & PLACARDS — NEC REQUIRED SIGNAGE' },
    { id: 'SCHED', title: 'EQUIPMENT SCHEDULE — MODULES, INVERTERS & BOM' },
    ...(includeSchedCont ? [{ id: 'SCHED-2', title: 'EQUIPMENT SCHEDULE — BILL OF MATERIALS (CONTINUED)' }] : []),
    { id: 'APP-A', title: 'SPECIFICATION REFERENCE — EQUIPMENT DATA SHEETS' },
    { id: 'CERT',  title: 'ENGINEER CERTIFICATION — PROFESSIONAL REVIEW' },
    { id: 'PE-1',  title: 'PE STRUCTURAL LETTER — LETTER OF COMPLIANCE' },
    { id: 'E-1',   title: 'SINGLE-LINE DIAGRAM — ELECTRICAL SCHEMATIC' },
    ...(includeInternalValidation ? [{ id: 'VAL-1', title: 'VALIDATION SUMMARY — INTERNAL QA (NOT FOR CONSTRUCTION)' }] : []),
    ...(includeCADAppendixPreview ? [{ id: 'APP-CAD', title: 'CAD PREVIEW APPENDIX — NON-AUTHORITATIVE' }] : []),
  ];

  // ── Topology label ────────────────────────────────────────────────────────
  const _coverSysType = cad.systemType as SysType;
  const mountLabel = isFence(_coverSysType) ? 'SOLAR FENCE'
    : isGround(_coverSysType) ? 'GROUND MOUNT'
    : mountSys
    ? mountSys.toUpperCase()
    : ((topology as string) === 'GROUND' ? 'GROUND MOUNT' : 'ROOF MOUNT');

  // FIX v47.341: Use topologyDisplayLabel() for consistent labelling
  const topologyLabel = topologyDisplayLabel(_resolvedTopo);

  // ── Helpers ───────────────────────────────────────────────────────────────
  // Only renders row if value is present (data authority enforcement)
  function infoRow(label: string, value: string | number | null | undefined): string {
    if (value === null || value === undefined || value === '' || value === '—') return '';
    // XSS FIX (audit P0): escape user-controlled values (projectName, clientName, address,
    // designer, etc.) — the permit HTML is served to the browser for preview, so raw
    // interpolation was a stored-XSS vector.
    return `<tr>
      <td class="il">${escapeH(label)}</td>
      <td class="iv">${escapeH(String(value))}</td>
    </tr>`;
  }

  

  // (N)/(E) tag rows — only shown when value is confirmed
  function tagRow(tag: string, value: string): string {
    if (!value || value === '—') return '';
    return `<tr>
      <td class="il" style="width:28px;border-right:var(--border);font-family:var(--mono);font-weight:900;white-space:nowrap;">(${tag})</td>
      <td class="iv">${value}</td>
    </tr>`;
  }

  // ── System Summary ────────────────────────────────────────────────────────
  const summaryRows = [
    totalPanels > 0 && moduleDisplay
      ? tagRow('N', `${totalPanels} × ${moduleDisplay}${eq.panelWatts > 0 ? ` (${eq.panelWatts}W)` : ''}`)
      : '',
    // FIX v47.341: Use resolveInverterCount() — totalPanels for micro, inverters.length for string
    inverterDisplay
      ? tagRow('N', `${resolveInverterCount(input, _resolvedTopo)} × ${inverterDisplay} — ${topologyLabel}`)
      : '',
    hasBattery && batteryDisplay
      ? tagRow('N', `${project.batteryCount} × ${batteryDisplay} — BATTERY STORAGE`)
      : '',
    svcAmps
      ? tagRow('E', `${svcAmps}A MAIN SERVICE PANEL${project.mainPanelBrand ? ' — ' + project.mainPanelBrand : ''}`)
      : '',
    backfeedA
      ? (isSupplySide
          ? tagRow('N', `${backfeedA}A FUSED AC DISCONNECT — SUPPLY-SIDE TAP (NEC 705.11)`)
          : tagRow('N', `${backfeedA}A BACKFEED BREAKER (NEC 705.12(B))`))
      : '',
    mountSys
      ? tagRow('N', mountSys.toUpperCase() + ' RACKING SYSTEM')
      : '',
  ].filter(Boolean).join('');

  // ── Design Criteria ───────────────────────────────────────────────────────
  const rafterSize    = project.rafterSize    || '';
  const rafterSpacing = project.rafterSpacing || '';
  const roofLayers    = project.roofLayers    || '';
  const stories       = project.stories       || '';
  const roofLoadPsf   = project.roofLoadPsf   || '';
  const windSpeedMph  = project.ahjWindSpeedMph || project.windSpeedMph || '';
  const windExposure  = project.windExposure   || '';
  const snowPsf       = project.ahjGroundSnowPsf ?? project.groundSnowPsf ?? '';
  const seismic       = project.seismicCategory || '';

  // FIX v47.295: Roof-specific design criteria only shown for roof systems
  const _coverSysTypeCheck = (cad.systemType as string);
  const _isRoofCover = isRoof(_coverSysTypeCheck);
  const designRows = [
    // Roof-only fields — hidden for fence and ground mount
    _isRoofCover ? infoRow('ROOF TYPE',          roofType) : '',
    _isRoofCover ? infoRow('ROOF PITCH',         pitch) : '',
    _isRoofCover ? infoRow('NO. OF LAYERS',      roofLayers ? `${roofLayers}` : '') : '',
    _isRoofCover ? infoRow('ROOF FRAMING',       rafterSize && rafterSpacing ? `${rafterSize} @ ${rafterSpacing}" O.C.` : rafterSize || '') : '',
    // System-type label row (fence / ground / roof)
    !_isRoofCover ? infoRow('SYSTEM TYPE',       displaySystemTypeShort(_coverSysTypeCheck)) : '',
    infoRow('STORIES',            stories ? `${stories}` : ''),
    infoRow('ROOF LOAD',          _isRoofCover && roofLoadPsf ? `${roofLoadPsf} PSF` : ''),
    infoRow('WIND SPEED',         windSpeedMph ? `${windSpeedMph} MPH` : ''),
    infoRow('WIND EXPOSURE',      windExposure ? `CAT. ${windExposure}` : ''),
    infoRow('GROUND SNOW LOAD',   snowPsf !== '' ? `${snowPsf} PSF` : ''),
    infoRow('SEISMIC DESIGN CAT.',seismic ? `CAT. ${seismic}` : ''),
    // Fence-specific design criteria (only shown for solar_fence)
    (isFence(_coverSysTypeCheck) && cad.fence?.postSpacingM)
      ? infoRow('POST SPACING', `${(cad.fence.postSpacingM * 3.28084).toFixed(1)}' O.C.`)
      : '',
    (isFence(_coverSysTypeCheck) && cad.fence?.postEmbedM)
      ? infoRow('POST EMBEDMENT', `${(cad.fence.postEmbedM * 3.28084).toFixed(1)} ft MIN.`)
      : '',
    (isFence(_coverSysTypeCheck) && cad.fence?.panelHeightM)
      ? infoRow('PANEL HEIGHT', `${(cad.fence.panelHeightM * 39.3701).toFixed(0)}" ABOVE GRADE`)
      : '',
    isFence(_coverSysTypeCheck)
      ? infoRow('FENCE TYPE', 'SOLAR FENCE ARRAY')
      : '',
  ].join('');

  // ── Governing Codes ───────────────────────────────────────────────────────
  const codesList: Array<[string, string]> = [
    [`IBC ${ibcVer}`, 'INTERNATIONAL BUILDING CODE'],
    [`IRC ${ibcVer}`, 'INTERNATIONAL RESIDENTIAL CODE'],
    [`IFC ${ifcVer}`, 'INTERNATIONAL FIRE CODE — §1204 SOLAR PV SYSTEMS'],
    [`NEC ${necVer}`, 'NATIONAL ELECTRICAL CODE (NFPA 70)'],
    ['ASCE 7-22', 'MINIMUM DESIGN LOADS & ASSOCIATED CRITERIA'],
    ['IEEE 1547', 'INTERCONNECTION & INTEROPERABILITY OF DER'],
    ['UL 1741 SA', 'INVERTERS, CONVERTERS, CONTROLLERS (SMART INVERTER)'],
    ['UL 2703', 'MOUNTING SYSTEMS, RACKING — BONDING & GROUNDING'],
    ['UL 61730', 'PV MODULE SAFETY QUALIFICATION'],
    ...(state ? [[`${state} AMENDMENTS`, 'STATE-ADOPTED LOCAL CODE AMENDMENTS'] as [string, string]] : []),
  ];
  // Two-column codes block — the 10-row single column was a major contributor
  // to the left column overrunning the fixed page height.
  const _codeRow = ([code, desc]: [string, string]) =>
    `<tr><td class="il" style="width:78px;white-space:nowrap;">${code}</td><td class="iv" style="font-size:7px;">${desc}</td></tr>`;
  const _codesHalf = Math.ceil(codesList.length / 2);
  const codesHtml = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--xs);align-items:start;">
      <table class="info-table">${codesList.slice(0, _codesHalf).map(_codeRow).join('')}</table>
      <table class="info-table">${codesList.slice(_codesHalf).map(_codeRow).join('')}</table>
    </div>`;

  // ── Sheet index — TWO columns so all 15+ sheets FIT on the fixed page.
  // The single-column table ran past the column bottom and overflow:hidden
  // silently ate everything after PV-5 (plus the construction notes below).
  const _idxRow = (s: { id: string; title: string }) => `<tr>
      <td class="il" style="width:44px;border-right:var(--border);font-family:var(--mono);font-weight:900;white-space:nowrap;">${s.id}</td>
      <td class="iv" style="font-size:7px;">${s.title}</td>
    </tr>`;
  const _idxHdr = `<tr>
      <td class="il" style="width:44px;border-right:var(--border);font-family:var(--mono);font-weight:900;background:#000;color:#fff;white-space:nowrap;">SHEET</td>
      <td class="iv" style="background:#000;color:#fff;">DESCRIPTION</td>
    </tr>`;
  const _idxHalf = Math.ceil(sheets.length / 2);
  const sheetIndexHtml = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--xs);align-items:start;">
      <table class="info-table">${_idxHdr}${sheets.slice(0, _idxHalf).map(_idxRow).join('')}</table>
      <table class="info-table">${_idxHdr}${sheets.slice(_idxHalf).map(_idxRow).join('')}</table>
    </div>`;

  // ── Right strip: project info ─────────────────────────────────────────────
  const projInfoRows = [
    infoRow('PROJECT',     project.projectName || ''),
    infoRow('CLIENT',      project.clientName  || ''),
    infoRow('ADDRESS',     project.address     || ''),
    infoRow('CITY/STATE',  [project.city || '', state].filter(Boolean).join(', ')),
    infoRow('APN',         apn),
    infoRow('AHJ',         ahj),
    infoRow('UTILITY',     utility),
    infoRow('DESIGNER',    project.designer || ''),
    infoRow('DATE',        project.date     || ''),
  ].join('');

  const sysInfoRows = [
    infoRow('DC SYSTEM SIZE',  dcKw  !== null ? `${dcKw.toFixed(3)} kW DC`  : ''),
    infoRow('AC SYSTEM SIZE',  acKw  !== null ? `${acKw.toFixed(3)} kW AC`  : ''),
    infoRow('MODULE',          totalPanels > 0 && moduleDisplay ? `${totalPanels} × ${moduleDisplay}` : ''),
    infoRow('INVERTER',        inverterDisplay ? `${inverterDisplay} — ${topologyLabel}` : ''),
    infoRow('MOUNTING',        mountLabel),
    infoRow('INTERCONNECTION', interconn),
    // Never print an unresolved QA flag on the AHJ deliverable. Supply-side:
    // the 120% busbar rule does not govern (NEC 705.11). Load-side fail:
    // state the remedy and point at the PV-4B analysis.
    isSupplySide
      ? infoRow('NEC 705.11', 'SUPPLY-SIDE TAP — 120% BUSBAR RULE N/A')
      : rulePass !== null
        ? infoRow('NEC 705.12(B)', rulePass
            ? 'PASS — 120% BUSBAR RULE'
            : 'EXCEEDS 120% — SUPPLY-SIDE TAP OR PANEL UPGRADE REQ’D (SEE PV-4B)')
        : '',
  ].join('');

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return `
  <div class="page">

    ${titleBlock(input, 'PV-0', 'COVER SHEET', pageNum, totalPages)}

    <!-- ═══ MAIN BODY: 2fr left | 1fr right ═══ -->
    <div class="page-body" style="grid-template-columns:2fr 1fr;">

      <!-- ═══ LEFT COLUMN (2fr): system + design data ═══ -->
      <div class="col-stack">

        <!-- PROJECT OVERVIEW — single headline strip. The old 6-row table
             triplicated the right column's SYSTEM INFORMATION and the SYSTEM
             SUMMARY below it, and pushed the construction notes off the page. -->
        ${(dcKw !== null || totalPanels > 0) ? `
        <div class="sec">
          <div class="sec-hdr">PHOTOVOLTAIC ${mountLabel} SYSTEM — PROJECT OVERVIEW</div>
          <div class="sec-body" style="padding:var(--xs);font-size:11px;font-weight:900;letter-spacing:0.4px;">
            ${[dcKw !== null ? `${dcKw.toFixed(2)} kW DC` : '', acKw !== null ? `${acKw.toFixed(2)} kW AC` : '', totalPanels > 0 ? `${totalPanels} MODULES` : '', topologyLabel || '', mountLabel ? `${mountLabel} MOUNT` : ''].filter(Boolean).join(' &nbsp;·&nbsp; ')}
          </div>
        </div>` : ''}

        <!-- SCOPE OF WORK -->
        <div class="sec">
          <div class="sec-hdr">SCOPE OF WORK</div>
          <div class="sec-body">
            <div class="note-row"><div class="note-num">1.</div><div class="note-txt">FURNISH AND INSTALL ${totalPanels > 0 ? totalPanels + ' ' : ''}PHOTOVOLTAIC SOLAR MODULES ON ${mountLabel} SYSTEM.</div></div>
            <div class="note-row"><div class="note-num">2.</div><div class="note-txt">INSTALL ${topologyLabel} POWER CONVERSION EQUIPMENT PER NEC ${necVer} ARTICLE 690.</div></div>
            <div class="note-row"><div class="note-num">3.</div><div class="note-txt">INSTALL ALL DC AND AC CONDUCTORS, CONDUIT, AND RACEWAYS PER NEC ${necVer}.</div></div>
            <div class="note-row"><div class="note-num">4.</div><div class="note-txt">INSTALL EQUIPMENT GROUNDING CONDUCTORS AND BONDING PER NEC 250 AND 690.43.</div></div>
            <div class="note-row"><div class="note-num">5.</div><div class="note-txt">${isSupplySide
              ? `INTERCONNECT PV SYSTEM VIA SUPPLY-SIDE TAP AHEAD OF THE EXISTING ${svcAmps ? svcAmps + 'A ' : ''}SERVICE DISCONNECT PER NEC 705.11.`
              : `INTERCONNECT PV SYSTEM TO EXISTING ${svcAmps ? svcAmps + 'A ' : ''}SERVICE PANEL PER NEC 705.12.`}</div></div>
            <div class="note-row"><div class="note-num">6.</div><div class="note-txt">INSTALL ALL NEC-REQUIRED WARNING LABELS, PLACARDS, AND RAPID SHUTDOWN SIGNAGE.</div></div>
            <div class="note-row"><div class="note-num">7.</div><div class="note-txt">COORDINATE UTILITY INTERCONNECTION AND NET METERING APPLICATION.</div></div>
            ${hasBattery ? '<div class="note-row"><div class="note-num">8.</div><div class="note-txt">INSTALL ENERGY STORAGE SYSTEM (ESS) PER NEC ' + necVer + ' ARTICLE 706 AND NFPA 855.</div></div>' : ''}
          </div>
        </div>

        <!-- SYSTEM SUMMARY -->
        ${summaryRows ? `
        <div class="sec">
          <div class="sec-hdr">SYSTEM SUMMARY</div>
          <div class="sec-body sec-body-table">
            <table class="info-table">
              ${summaryRows}
            </table>
          </div>
        </div>` : ''}

        <!-- DESIGN CRITERIA -->
        ${designRows ? `
        <div class="sec">
          <div class="sec-hdr">DESIGN CRITERIA</div>
          <div class="sec-body sec-body-table">
            <table class="info-table">
              ${designRows}
            </table>
          </div>
        </div>` : ''}

        <!-- GOVERNING CODES -->
        <div class="sec">
          <div class="sec-hdr">GOVERNING CODES</div>
          <div class="sec-body sec-body-table">
            ${codesHtml}
          </div>
        </div>

        <!-- ENGINEERING SUMMARY (condensed — the long paragraph pushed the
             sheet index and construction notes off the fixed page) -->
        <div class="sec" style="margin-bottom:var(--xs);">
          <div class="sec-hdr">ENGINEERING SUMMARY</div>
          <div class="sec-body" style="font-size:var(--f-md);line-height:1.45;padding:var(--xs);">
            ${system.totalDcKw?.toFixed(2) || '—'} kW DC grid-tied PV system at ${escapeH(project.address || '—')}, designed per
            NEC ${compliance?.jurisdiction?.necVersion || '2020'}, ASCE 7-22, IBC ${ibcVer}, and applicable local amendments.
            Issued for permit review — requires PE review and wet stamp before AHJ submission.
          </div>
        </div>
      <div class="sec">
          <div class="sec-hdr">SHEET INDEX</div>
          <div class="sec-body sec-body-table">
            ${sheetIndexHtml}
          </div>
        </div>

        <!-- CONSTRUCTION NOTES — 2-column grid -->
        <div class="sec f1">
          <div class="sec-hdr">CONSTRUCTION NOTES</div>
          <div class="sec-body" style="display:grid;grid-template-columns:1fr 1fr;gap:var(--xs);align-items:start;">
            ${(() => {
              const filled = buckets.filter(b => b.notes.length > 0);
              if (filled.length === 0) return '<span class="f-sm">SEE PROJECT SPECIFICATIONS</span>';
              // Dense packages: reference-style FLAT 3-column numbered list
              // (bold inline category prefixes) — the bucketed 2-column layout
              // physically could not fit 25+ notes on the fixed sheet, and
              // overflow:hidden silently ate the bottom rows.
              const totalNotes = filled.reduce((s, b) => s + b.notes.length, 0);
              if (totalNotes > 18) {
                const flat: Array<{ t?: string; n: string }> = [];
                for (const b of filled) b.notes.forEach((n, i) => flat.push({ t: i === 0 ? b.title : undefined, n }));
                const per = Math.ceil(flat.length / 3);
                const cols = [flat.slice(0, per), flat.slice(per, per * 2), flat.slice(per * 2)];
                let num = 0;
                const renderCol = (c: typeof flat) => `<div>${c.map(x => {
                  num++;
                  return `<div style="display:flex;gap:3px;font-size:6.2px;line-height:1.18;margin-bottom:0.5px;">`
                    + `<div style="font-weight:900;min-width:11px;">${num}.</div>`
                    + `<div>${x.t ? `<span style="font-weight:900;">${x.t}: </span>` : ''}${x.n}</div></div>`;
                }).join('')}</div>`;
                return `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:var(--xs);align-items:start;grid-column:1 / -1;">${cols.map(renderCol).join('')}</div>`;
              }
              const half  = Math.ceil(filled.length / 2);
              const left  = filled.slice(0, half);
              const right = filled.slice(half);
              const renderBucket = (b: NoteBucket) => `
                <div class="mb-xs">
                  <div class="blk-hdr" style="background:#444;">${b.title}</div>
                  <div class="blk-body">
                    ${b.notes.map((n, i) => `<div class="note-row"><div class="note-num">${i+1}.</div><div class="note-txt">${n}</div></div>`).join('')}
                  </div>
                </div>`;
              return `
                <div>${left.map(renderBucket).join('')}</div>
                <div>${right.length ? right.map(renderBucket).join('') : ''}</div>`;
            })()}
          </div>
        </div>

      </div><!-- end left column -->

      <!-- ═══ RIGHT COLUMN (1fr): project info + stamps ═══ -->
      <div class="col-stack">

        <!-- PROJECT INFORMATION -->
        ${projInfoRows ? `
        <div class="sec">
          <div class="sec-hdr">PROJECT INFORMATION</div>
          <div class="sec-body sec-body-table">
            <table class="info-table">
              ${projInfoRows}
            </table>
          </div>
        </div>` : ''}

        <!-- SYSTEM INFORMATION -->
        ${sysInfoRows ? `
        <div class="sec">
          <div class="sec-hdr">SYSTEM INFORMATION</div>
          <div class="sec-body sec-body-table">
            <table class="info-table">
              ${sysInfoRows}
            </table>
          </div>
        </div>` : ''}

        <!-- REVISIONS -->
        <div class="sec">
          <div class="sec-hdr">REVISIONS</div>
          <div class="sec-body sec-body-table">
            <table class="info-table">
              <tr>
                <td class="il" style="width:28px;border-right:var(--border);font-family:var(--mono);font-weight:900;">REV</td>
                <td class="iv" style="border-right:var(--border);">DESCRIPTION</td>
                <td class="iv" style="width:54px;">DATE</td>
              </tr>
              <tr>
                <td class="il" style="width:28px;border-right:var(--border);font-family:var(--mono);font-weight:900;">A</td>
                <td class="iv" style="border-right:var(--border);">ISSUED FOR PERMIT</td>
                <td class="iv">${project.date || ''}</td>
              </tr>
              <tr><td colspan="3" class="iv">&nbsp;</td></tr>
              <tr><td colspan="3" class="iv">&nbsp;</td></tr>
              <tr><td colspan="3" class="iv">&nbsp;</td></tr>
            </table>
          </div>
        </div>

        <!-- ENGINEER OF RECORD -->
        <div class="sec">
          <div class="sec-hdr">ENGINEER OF RECORD</div>
          <div class="sec-body">
          <div class=\"stamp-box\" style=\"min-height:88px;\">
              <span class="f-xs c555 fw7" style="line-height:1.8;">
                AFFIX PE STAMP HERE<br/>LICENSE NO. ____________<br/>STATE: ____________
              </span>
            </div>
          </div>
        </div>

        <!-- SHEET IDENTIFICATION -->
        <div class="sec">
          <div class="sec-hdr">SHEET IDENTIFICATION</div>
          <div class="sec-body sec-body-table">
            <table class="info-table">
              ${infoRow('SHEET NAME',   'COVER SHEET')}
              ${infoRow('SHEET NO.',    'PV-0')}
              ${infoRow('SHEET SIZE',   'ANSI B — 11″ × 17″')}
              ${infoRow('TOTAL SHEETS', `${totalPages}`)}
              ${infoRow('PAGE',         `${pageNum} OF ${totalPages}`)}
              ${infoRow('SCALE',        'NOT TO SCALE')}
            </table>
          </div>
        </div>

        <!-- GENERAL NOTES -->
        <div class="sec">
          <div class="sec-hdr">GENERAL NOTES</div>
          <div class="sec-body">
            <div class="note-row"><div class="note-num">1.</div><div class="note-txt">ALL DIMENSIONS ARE NOMINAL. FIELD VERIFY PRIOR TO INSTALLATION.</div></div>
            <div class="note-row"><div class="note-num">2.</div><div class="note-txt">DO NOT SCALE FROM DRAWINGS.</div></div>
            <div class="note-row"><div class="note-num">3.</div><div class="note-txt">CONTRACTOR RESPONSIBLE FOR VERIFICATION OF ALL SITE CONDITIONS.</div></div>
            <div class="note-row"><div class="note-num">4.</div><div class="note-txt">PE STAMP REQUIRED FOR PERMIT SUBMISSION PER AHJ.</div></div>
            <div class="note-row"><div class="note-num">5.</div><div class="note-txt">SUBSTITUTIONS REQUIRE WRITTEN ENGINEER APPROVAL.</div></div>
          </div>
        </div>

        <!-- VICINITY MAP -->
        <div class="sec f1">
          <div class="sec-hdr">VICINITY MAP &mdash; NTS &mdash; FIELD VERIFY ALL CONDITIONS</div>
          <div class="sec-body sec-body-table" style="overflow:hidden;position:relative;">
            ${vicinityMapHtml}
        <div class=\"df aic bt-1\" style=\"padding:2px var(--xs);gap:var(--xs);\">
              <span class="f-sm fw7 f1">
                ${escapeH(project.address || '')}${project.city ? ` — ${escapeH(project.city)}` : ''}${state ? `, ${state}` : ''}
              </span>
              <svg viewBox="0 0 40 40" width="28" height="28" xmlns="http://www.w3.org/2000/svg">
                <circle cx="20" cy="20" r="18" fill="#fff" stroke="#000" stroke-width="1.5"/>
                <polygon points="20,4 23,16 20,14 17,16" fill="#000"/>
                <polygon points="20,36 23,24 20,26 17,24" fill="#888"/>
                <polygon points="4,20 16,17 14,20 16,23" fill="#888"/>
                <polygon points="36,20 24,17 26,20 24,23" fill="#888"/>
                <text x="20" y="3.5" text-anchor="middle" font-size="7" font-weight="900" fill="#000" font-family="Arial">N</text>
              </svg>
            </div>
          </div>
        </div>

      </div><!-- end right column -->

    </div><!-- end page-body -->

  </div>`;
}



