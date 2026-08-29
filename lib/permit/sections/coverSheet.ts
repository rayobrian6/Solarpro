// ═══════════════════════════════════════════════════════════════
// PV-0: Cover Sheet
// Extracted from route.ts — ZERO REGRESSION
// ═══════════════════════════════════════════════════════════════

import type { PermitInput } from '../types';
import type { CADModel } from '@/lib/cad/types';
import { titleBlock, buildConstructionNotes } from '../utils/titleBlock';
import { buildIntegratedEquipment } from '../utils/integratedEquipment';
import { escapeH } from '../utils/drawing';
import { sysTypeLabel, topologyDisplayLabel, resolveInverterCount, utilityDisplayName, interconnectionLabel, isSupplySideInterconnection, roofTypeLabel, pv2Title, pv3Title, necNextStandardOcpd, hasRealBattery, resolveEquipmentBySubSystem, type SysType } from '../utils/helpers';
import { hybridSheetSections, SUB_LABEL } from './subSystemSheets';
import { hybridSubmissionGate } from './hybridReadiness';
import { resolveInterconnection } from './electricalPages';
import { projectStructuralFromInput } from '../snapshot/structuralProjection';
import { projectCodeAuthorityFromInput } from '../snapshot/codeAuthorityProjection';
import { projectProjectAuthorityFromInput, projectProjectStateFromInput } from '../snapshot/projectAuthorityProjection';
import { computePlansetManifest } from '../plansetManifest';
import { releaseStatusBlockHtml } from '../utils/releaseStatusBlock';
// TAC WS-16 — the cover names the PE sheets in prose; the noun is state-derived
// (a "letter" only under a digest-bound approval), never a literal.
import { peLetterTitlesFromInput } from '../utils/peLetterIdentity';
import {  getSystemType, getInverterTopology, getEquipmentContext, topologyToLegacy, isFence, isGround, isRoof, displaySystemTypeShort } from '@/lib/system';
import type { CanonicalInput } from '../types';
import { BUILD_VERSION } from '@/lib/version';
import { PLANSET_ENGINE_VERSION } from '../constants';
import { formatPitchRatio } from '@/lib/structural/roofPitch';

// ═══════════════════════════════════════════════════════════════════
// PAGE GENERATORS
// ═══════════════════════════════════════════════════════════════════

// ─── PV-0: Cover Sheet ───────────────────────────────────────────────────────

export function pageCoverSheet(input: PermitInput, cad: CADModel, pageNum: number, totalPages: number): string {
  const { project, system, compliance } = input;

  // ── Jurisdiction / code versions — W4 §2 SINGLE SOURCE ────────────────────
  // Every edition projects from the ONE snapshot codeAuthority record; the cover
  // and title block can no longer disagree (the IFC 2021-vs-2024 fight is gone)
  // and no edition is inferred. Unknown adoptions render PENDING.
  const cp = projectCodeAuthorityFromInput(input);
  // ── Project / cover authority — W4 §3 SINGLE SOURCE ───────────────────────
  // Project identity, equipment summary, issue status and the SHEET INDEX all
  // project from the ONE snapshot projectAuthority record (no vendor default, no
  // stale equipment, no default engineer name, no independent sheet index).
  const pa = projectProjectAuthorityFromInput(input);
  // §16 — permit-issue language is gated on the DERIVED authority issue state.
  // Only a true ISSUED-FOR-PERMIT state prints "Issued for permit review"; every
  // pending/draft/revised state prints the honest DESIGN-REVIEW disposition.
  const _permitIssued = pa.issueStatus === 'ISSUED FOR PERMIT';
  const necVer  = cp.nec ?? 'PENDING';
  const ibcVer  = cp.ibc ?? 'PENDING';
  const ircVer  = cp.irc ?? 'PENDING';
  const ifcVer  = cp.ifc ?? 'PENDING';
  const asceVer = cp.asce ?? 'PENDING';
  // THE canonical state (both forms). The cover read compliance.jurisdiction.state,
  // so the CITY/STATE cell, the vicinity-map address chip and the state-amendments
  // code row all printed the 'Unknown' sentinel in Planset 14.
  const st      = projectProjectStateFromInput(input);
  const state   = st.name ?? '';
  const ahj     = pa.ahj ?? '';        // W4 §3: AHJ from projectAuthority
  const utility = pa.utility ?? '';    // W4 §3: utility from projectAuthority (already display-named)
  const apn     = pa.apn ?? '';

  // ── Equipment summary — W4 §3 from projectAuthority (single-source, versioned
  // records). The 4-source resolver is retained ONLY for hybrid per-sub rows +
  // watts. The single-system module/inverter identity now comes from the
  // authority, tagged for the truth matrix.
  const eq = getEquipmentContext(input, cad);
  const moduleDisplay   = pa.moduleDisplay ?? ([eq.panelManufacturer, eq.panelModel].filter(s => s && s !== '—').join(' ') || '');
  const inverterDisplay = pa.inverterDisplay ?? ([eq.inverterManufacturer, eq.inverterModel].filter(s => s && s !== '—').join(' ') || '');

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
  const pitch       = formatPitchRatio(_pitchDegCover) ?? '';

  // ── Derived electrical values — W2 SNAPSHOT PROJECTION ─────────────
  // The cover's former local 120% math + backfeed re-derivation (one of six
  // parallel implementations the audit flagged) is gone: bus/main/backfeed
  // and the rule verdict come from resolveInterconnection, which projects the
  // validated PermitDesignSnapshot.
  const _icTop = resolveInterconnection(input, cad);
  const busRating   = _icTop.busA || null;
  const mainBreaker = _icTop.mainA || null;
  const backfeedA   = _icTop.feederOcpd || null;
  const busLimit     = busRating ? Math.round(_icTop.busLimit) : null;
  const maxPvBreaker = busLimit !== null ? Math.round(_icTop.maxBackfeedA) : null;
  const rulePass     = _icTop.isSupplySide ? null : _icTop.passes120;

  // ── Interconnection ───────────────────────────────────────────────────────
  // Resolved ONCE (shared with PV-4A/PV-4B via resolveInterconnection): a
  // load-side design that fails the 120% busbar rule resolves to a supply-side
  // (line-side) tap. The cover's 705.x row, SCOPE step 5 and SYSTEM SUMMARY
  // backfeed line now read the SAME method every electrical sheet prints —
  // never "supply-side required" on the cover while PV-4A draws a load-side
  // breaker, and never a red FAIL/QA flag on an issued set.
  const _ic = _icTop;
  const isSupplySide = _ic.isSupplySide;

  // ── Battery ───────────────────────────────────────────────────────────────
  const hasBattery    = hasRealBattery(project);
  const batteryDisplay = hasBattery
    ? [project.batteryBrand, project.batteryModel].filter(Boolean).join(' ')
    : '';

  // ── Vicinity map ──────────────────────────────────────────────────────────
  const aerial = input.aerialData;
  let vicinityMapHtml = '';
  if (aerial?.imageBase64) {
    // Pin gets a LABEL ('PROJECT SITE' printed nothing before — empty div),
    // NTS moves to the corner (it sat ON the subject house), a north arrow
    // prints, and the address caption is normal document flow below the image
    // so it can never silently fail to render.
    vicinityMapHtml = `
        <div class=\"aerial-wrap\" style=\"position:relative;flex:1 1 auto;min-height:116px;overflow:hidden;\">
        <img src="${aerial.imageBase64}" style="position:absolute;inset:0;width:100%;height:100%;display:block;object-fit:cover;object-position:center;" alt="Vicinity Map"/>
          <div style=\"position:absolute;top:50%;left:50%;transform:translate(-50%,-58%);text-align:center;\">
          <svg viewBox="0 0 36 46" width="26" height="34" style="display:block;margin:0 auto;">
            <circle cx="18" cy="18" r="16" fill="#000" stroke="#fff" stroke-width="2"/>
            <circle cx="18" cy="18" r="7" fill="#fff"/>
            <polygon points="18,34 12,27 24,27" fill="#000"/>
          </svg>
          <div style="font-size:7px;font-weight:900;color:#fff;text-shadow:0 0 3px #000,0 0 3px #000;letter-spacing:0.8px;">PROJECT SITE</div>
        </div>
          <div style="position:absolute;bottom:3px;right:5px;font-size:7px;font-weight:900;color:#fff;text-shadow:0 0 3px #000,0 0 3px #000;">NTS</div>
          <div style="position:absolute;top:3px;right:5px;text-align:center;color:#fff;text-shadow:0 0 3px #000,0 0 3px #000;">
            <div style="font-size:9px;font-weight:900;line-height:1;">▲</div>
            <div style="font-size:7px;font-weight:900;line-height:1;">N</div>
          </div>
      </div>
        <div style="border:var(--border);border-top:none;padding:2px 5px;font-size:7px;font-weight:700;letter-spacing:0.4px;text-align:center;">${escapeH(project.address || '')}${project.city ? ' — ' + escapeH(String(project.city).toUpperCase()) : ''}</div>`;
  } else {
    vicinityMapHtml = `
      <div style="background:#e8e8e8;width:100%;height:160px;display:flex;align-items:center;justify-content:center;text-align:center;">
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

  // ── Sheet index — W4 §3 SINGLE SOURCE ─────────────────────────────────────
  // THE actual generated sheet manifest is carried on projectAuthority (computed
  // once at snapshot build via computePlansetManifest, the SAME builder
  // generatePermit's page assembly mirrors). The cover no longer computes an
  // independent index — the "cover said 15, set shipped 16" class of drift is
  // gone. Fallback to the SAME shared computation only when no snapshot is
  // present (standalone/preview) — never a separate hardcoded list.
  const sheets = pa.sheetIndex.length ? pa.sheetIndex : computePlansetManifest(input, cad);

  // ── Wave 5B: hybrid per-sub cover data ────────────────────────────────────
  // Present sub-systems (roof > ground > fence). >1 ⇒ hybrid cover: hybrid
  // headline, per-sub kW lines, and per-sub SYSTEM SUMMARY equipment rows.
  // Single-type covers take none of these branches — byte-identical.
  const _coverSubs = hybridSheetSections(cad);
  const _coverHybrid = _coverSubs.length > 1;
  const _subTopoLabel = (t?: string): string => {
    const s = (t || '').toLowerCase();
    if (s.includes('micro')) return 'MICROINVERTER';
    if (s.includes('optimizer')) return 'POWER OPTIMIZER';
    if (s.includes('string')) return 'STRING INVERTER';
    return 'INVERTER';
  };
  const _coverSubRows = _coverHybrid ? _coverSubs.map(sec => {
    const eq2 = resolveEquipmentBySubSystem(input, sec.key, cad);
    const panelDisp = [eq2.panelManufacturer, eq2.panelModel].filter(s => s && s !== '—').join(' ');
    const invDisp = [eq2.inverterManufacturer, eq2.inverterModel].filter(s => s && s !== '—').join(' ');
    return {
      key: sec.key,
      label: SUB_LABEL[sec.key],
      panels: sec.totalPanels,
      dcKw: sec.dcKw,
      panelDisp,
      panelWatts: eq2.panelWatts,
      invDisp,
      topoLabel: _subTopoLabel(eq2.inverterType),
      isMicro: (eq2.inverterType || '').toLowerCase().includes('micro'),
    };
  }) : [];

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

  

  // W4 §3 — row whose VALUE is pre-formatted HTML (a data-project-field tagged
  // span from the projectAuthority accessor). The label is escaped; the value is
  // injected raw (the accessor already escaped the underlying text). Hidden when
  // the underlying plain value is absent — never a fabricated default.
  function rawInfoRow(label: string, rawValueHtml: string, plain: string | null | undefined): string {
    if (plain === null || plain === undefined || plain === '' || plain === '—') return '';
    return `<tr>
      <td class="il">${escapeH(label)}</td>
      <td class="iv">${rawValueHtml}</td>
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
  // Wave 5B hybrid: one module line + one inverter line PER SUB-SYSTEM (three
  // module lines when they differ) — never one project-wide winner row
  // claiming every sub's modules. Single-type path unchanged.
  const _hybridEquipRows = _coverHybrid ? _coverSubRows.flatMap(r => {
    const invCount = r.isMicro
      ? r.panels
      : (input.system?.inverters ?? []).filter(inv =>
          ((inv as { subSystemKey?: string }).subSystemKey ?? _coverSubs[0].key) === r.key).length || 1;
    return [
      r.panels > 0 && r.panelDisp
        ? tagRow('N', `${r.panels} × ${r.panelDisp}${r.panelWatts > 0 && !/\b\d{3,4}\s?W\b/i.test(r.panelDisp) ? ` (${r.panelWatts}W)` : ''} — ${r.label}`)
        : '',
      r.invDisp
        ? tagRow('N', `${invCount} × ${r.invDisp} — ${r.topoLabel} — ${r.label}`)
        : '',
    ];
  }) : [];
  const summaryRows = [
    ...(_coverHybrid ? _hybridEquipRows : [
      totalPanels > 0 && moduleDisplay
        ? tagRow('N', `${totalPanels} × ${moduleDisplay}${eq.panelWatts > 0 && !/\b\d{3,4}\s?W\b/i.test(moduleDisplay) ? ` (${eq.panelWatts}W)` : ''}`)
        : '',
      // FIX v47.341: Use resolveInverterCount() — totalPanels for micro, inverters.length for string
      inverterDisplay
        ? tagRow('N', `${resolveInverterCount(input, _resolvedTopo)} × ${inverterDisplay} — ${topologyLabel}`)
        : '',
    ]),
    // Brand-integrated AC aggregation / monitoring device (the "brains").
    ...buildIntegratedEquipment(input, cad).devices.map(d =>
      tagRow('N', `${d.quantity} × ${d.brand.toUpperCase()} ${d.model.toUpperCase()} — ${d.roleSummary.toUpperCase()}`)),
    hasBattery && batteryDisplay
      ? tagRow('N', `${project.batteryCount} × ${batteryDisplay} — BATTERY STORAGE`)
      : '',
    svcAmps
      ? tagRow('E', `${svcAmps}A MAIN SERVICE PANEL${project.mainPanelBrand ? ' — ' + project.mainPanelBrand : ''}`)
      : '',
    backfeedA || _ic.feederOcpd
      ? (isSupplySide
          // Supply-side tap OCPD from the interconnection resolver → conductor
          // authority POI block (Σ per-sub backfeed OCPDs → next std rating) —
          // the SAME number E-1's system disconnect prints. project.backfeedBreakerA
          // is kW-basis and printed 110A here while E-1 said 200A (2026-07-18).
          ? tagRow('N', `${_ic.feederOcpd || backfeedA}A FUSED AC DISCONNECT — SUPPLY-SIDE TAP (NEC 705.11)`)
          : (backfeedA ? tagRow('N', `${backfeedA}A BACKFEED BREAKER (NEC 705.12(B))`) : ''))
      : '',
    mountSys
      ? tagRow('N', mountSys.toUpperCase() + ' RACKING SYSTEM' + (_coverHybrid ? ' — ROOF' : ''))
      : '',
  ].filter(Boolean).join('');

  // ── Design Criteria ───────────────────────────────────────────────────────
  const rafterSize    = project.rafterSize    || '';
  const rafterSpacing = project.rafterSpacing || '';
  const roofLayers    = project.roofLayers    || '';
  const stories       = project.stories       || '';
  const roofLoadPsf   = project.roofLoadPsf   || '';
  // W3 §7 — cover structural design criteria PROJECT from the single-sourced
  // snapshot env so the cover, PV-3, PV-4C, CERT and PE-1 all print the SAME
  // wind / exposure / snow (the 115-vs-90 fix reaches the cover too).
  const _spCover = projectStructuralFromInput(input);
  const windSpeedMph  = _spCover.windSpeedMph ?? project.ahjWindSpeedMph ?? project.windSpeedMph ?? '';
  const windExposure  = _spCover.exposure ?? project.windExposure ?? '';
  const snowPsf       = _spCover.groundSnowPsf ?? project.ahjGroundSnowPsf ?? project.groundSnowPsf ?? '';
  // Post-AAC seismic repair — the cover prints THE canonical resolved seismic
  // result (generatePermit stamps project.seismicCategory from
  // resolveSeismicAuthority: hazard retrieval, else the verified archived
  // climate-hazard document). The resolution rides the input for the evidence
  // tag; unresolved ⇒ an explicit PENDING, never a substituted category.
  const _seisAuth = (input as unknown as {
    _seismicAuthority?: { established: boolean; source: string | null; sourceRef: string | null };
  })._seismicAuthority ?? null;
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
    // System-type label row. A hybrid cover must NOT inherit the primary sub's
    // single label ("SYSTEM TYPE: SOLAR FENCE" on a roof+ground+fence set) — it
    // states the multi-system structure and suppresses the fence-only params.
    _coverHybrid ? infoRow('SYSTEM TYPE',        `HYBRID — ${_coverSubRows.map(r => r.label).join(' + ')}`)
      : (!_isRoofCover ? infoRow('SYSTEM TYPE',  displaySystemTypeShort(_coverSysTypeCheck)) : ''),
    infoRow('STORIES',            stories ? `${stories}` : ''),
    infoRow('ROOF LOAD',          _isRoofCover && roofLoadPsf ? `${roofLoadPsf} PSF` : ''),
    // BRAIDON PDF AUDIT 2026-08-27 (N11) — printed the raw hazard value ("107.533 MPH",
    // "23.284 PSF") while PV-4C/PE-1 rounded the SAME value to "108 mph". Round for display
    // with the same rule as everywhere else; the numeric value is untouched.
    infoRow('WIND SPEED',         windSpeedMph !== '' ? `${Math.round(Number(windSpeedMph))} MPH` : ''),
    infoRow('WIND EXPOSURE',      windExposure ? `CAT. ${windExposure}` : ''),
    infoRow('GROUND SNOW LOAD',   snowPsf !== '' ? `${Number(Number(snowPsf).toFixed(1))} PSF` : ''),
    // 2026-08-29 — the label already says "CAT.", so prefixing the value repeated
    // it: the cover read "SEISMIC DESIGN CAT.  CAT. D".
    infoRow('SEISMIC DESIGN CAT.',
      seismic && seismic !== 'PENDING' ? String(seismic) : 'PENDING — NOT ESTABLISHED'),
    // machine-readable seismic evidence stamp (infoRow escapes values, so the
    // tags ride their own hidden row-less element the harness reads).
    `<tr style="display:none"><td colspan="2"><span data-seismic-sdc="${escapeH(seismic && seismic !== 'PENDING' ? seismic : '')}" data-seismic-source="${escapeH(_seisAuth?.established ? (_seisAuth.source ?? '') : (seismic && seismic !== 'PENDING' ? 'input' : 'none'))}" data-seismic-source-ref="${escapeH(_seisAuth?.established ? (_seisAuth.sourceRef ?? '') : '')}"></span></td></tr>`,
    // Fence-specific design criteria — only on a PURE solar_fence cover, never
    // on a hybrid (the fence params belong on the per-sub PV-1F sheet there).
    (!_coverHybrid && isFence(_coverSysTypeCheck) && cad.fence?.postSpacingM)
      ? infoRow('POST SPACING', `${(cad.fence.postSpacingM * 3.28084).toFixed(1)}' O.C.`)
      : '',
    (!_coverHybrid && isFence(_coverSysTypeCheck) && cad.fence?.postEmbedM)
      ? infoRow('POST EMBEDMENT', `${(cad.fence.postEmbedM * 3.28084).toFixed(1)} ft MIN.`)
      : '',
    (!_coverHybrid && isFence(_coverSysTypeCheck) && cad.fence?.panelHeightM)
      ? infoRow('PANEL HEIGHT', `${(cad.fence.panelHeightM * 39.3701).toFixed(0)}" ABOVE GRADE`)
      : '',
    (!_coverHybrid && isFence(_coverSysTypeCheck))
      ? infoRow('FENCE TYPE', 'SOLAR FENCE ARRAY')
      : '',
  ].join('');

  // ── Governing Codes ───────────────────────────────────────────────────────
  const codesList: Array<[string, string]> = [
    [cp.tag('ibc'), 'INTERNATIONAL BUILDING CODE'],
    [cp.tag('irc'), 'INTERNATIONAL RESIDENTIAL CODE'],
    [cp.tag('ifc'), 'INTERNATIONAL FIRE CODE — §1204 SOLAR PV SYSTEMS'],
    [cp.tag('nec'), 'NATIONAL ELECTRICAL CODE (NFPA 70)'],
    [cp.tag('asce'), 'MINIMUM DESIGN LOADS & ASSOCIATED CRITERIA'],
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
  // AAC WS-10 — the manufacturer ATTACHMENT appendix is indexed under its own
  // heading, after the numbered drawing set: the DS-n manufacturer pages are
  // attachments to the submittal, not drawing sheets.
  const _idxDrawings = sheets.filter(s => s.section !== 'appendix');
  const _idxAppendix = sheets.filter(s => s.section === 'appendix');
  const _idxHalf = Math.ceil(_idxDrawings.length / 2);
  const _apxHdr = `<tr>
      <td class="il" colspan="2" style="background:#333;color:#fff;font-weight:900;letter-spacing:0.6px;">MANUFACTURER ATTACHMENTS (APPENDIX — NOT DRAWING SHEETS)</td>
    </tr>`;
  const sheetIndexHtml = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--xs);align-items:start;">
      <table class="info-table">${_idxHdr}${_idxDrawings.slice(0, _idxHalf).map(_idxRow).join('')}</table>
      <table class="info-table">${_idxHdr}${_idxDrawings.slice(_idxHalf).map(_idxRow).join('')}${
        _idxAppendix.length ? `${_apxHdr}${_idxAppendix.map(_idxRow).join('')}` : ''}</table>
    </div>`;

  // ── Right strip: project info ─────────────────────────────────────────────
  // W4 §3: project identity projects from the ONE projectAuthority record and is
  // TAGGED (data-project-field) so the truth matrix can prove single-sourcing.
  const projInfoRows = [
    rawInfoRow('PROJECT',  pa.tag('project-name'), pa.projectName),
    rawInfoRow('CLIENT',   pa.tag('customer'),     pa.customer),
    rawInfoRow('ADDRESS',  pa.tag('address'),      pa.address),
    rawInfoRow('CITY/STATE',
      [project.city ? escapeH(project.city) : '', st.name ? st.tag('state-name') : ''].filter(Boolean).join(', '),
      [project.city || '', state].filter(Boolean).join(', ')),
    rawInfoRow('APN',      pa.tag('apn'),          pa.apn),
    rawInfoRow('AHJ',      pa.tag('ahj'),          pa.ahj),
    rawInfoRow('UTILITY',  pa.tag('utility'),      pa.utility),
    rawInfoRow('DESIGNER', pa.tag('designer'),     pa.designer),
    infoRow('DATE',        pa.issueDate || ''),
  ].join('');

  const sysInfoRows = [
    // W4 §3: system type + issue status project from projectAuthority, tagged for
    // the truth matrix (data-project-field="system-type" / "issue-status").
    // §15 page-fit: the DC/AC size + mounting + interconnection rows are dropped
    // from this section — each is already printed on the cover (headline, scope
    // note 5, engineering summary) — so the SYSTEM INFORMATION block carries the
    // tagged identity rows only and the vicinity map / address fits the page.
    rawInfoRow('SYSTEM TYPE',  pa.tag('system-type'), pa.systemType),
    // Hybrid: no single project-wide module/inverter/mount row — each sub has
    // its own equipment (SYSTEM SUMMARY carries the per-sub lines). Single-system
    // module/inverter identity is TAGGED from the authority (no stale equipment).
    _coverHybrid
      ? infoRow('MODULE', totalPanels > 0 ? `${totalPanels} MODULES — ${_coverSubRows.length} SUB-SYSTEMS (SEE SUMMARY)` : '')
      : rawInfoRow('MODULE', `${totalPanels} × ${pa.tag('module-model')}`, totalPanels > 0 ? pa.moduleDisplay : null),
    _coverHybrid
      ? infoRow('INVERTER', `${_coverSubRows.length} SUB-SYSTEM FLEETS (SEE SUMMARY)`)
      : rawInfoRow('INVERTER', `${pa.tag('inverter-model')} — ${escapeH(topologyLabel)}`, pa.inverterDisplay),
    // §12 — the derived project issue status prints here (tagged) and drives the
    // REVISIONS description below; never a hardcoded "ISSUED FOR PERMIT".
    rawInfoRow('ISSUE STATUS', pa.tag('issue-status'), pa.issueStatus),
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
  <div class="page cover-compact">

    ${titleBlock(input, 'PV-0', 'COVER SHEET', pageNum, totalPages)}

    <!-- RGM §6 — the cover leads with the RELEASE-STATUS BLOCK (root gates +
         counts + one pointer to the full registry), NOT the blocker list. The
         retired banner printed 8 verbatim blocker messages + "+N more active
         release blockers", which presented 19 children of 7 root gates as 19
         independent failures. The PENDING ENGINEERING REVIEW / NOT FOR PERMIT
         SUBMISSION identity is unchanged and nothing is hidden: every
         requirement stays in the release registry, and the pointer resolves to
         the sheet or record THIS package carries it on (TAC WS-18). -->
    ${releaseStatusBlockHtml(input, { compact: true })}

    <!-- ═══ MAIN BODY: 2fr left | 1fr right ═══ -->
    <div class="page-body" style="grid-template-columns:2fr 1fr;">

      <!-- ═══ LEFT COLUMN (2fr): system + design data ═══ -->
      <div class="col-stack">

        <!-- PROJECT HEADLINE — reference covers lead with a LARGE system
             title (the set's biggest text was a 13px strip, and it branded
             the racking vendor instead of the system type). -->
        ${(dcKw !== null || totalPanels > 0) ? `
        <div class="sec">
          <div class="sec-body" style="padding:7px 10px 6px;">
            ${_coverHybrid ? `
            <div style="font-size:21px;font-weight:900;letter-spacing:1.2px;line-height:1.05;">HYBRID: ${_coverSubRows.map(r => r.label).join(' + ')} PHOTOVOLTAIC SYSTEM</div>
            <div style="font-size:10.5px;font-weight:900;letter-spacing:0.4px;margin-top:4px;">
            ${[dcKw !== null ? `${dcKw.toFixed(2)} kW DC TOTAL` : '', acKw !== null ? `${acKw.toFixed(2)} kW AC` : '', totalPanels > 0 ? `${totalPanels} MODULES` : '', `${_coverSubRows.length} SUB-SYSTEMS`].filter(Boolean).join(' &nbsp;·&nbsp; ')}
            </div>
            ${_coverSubRows.map(r => `
            <div style="font-size:9px;font-weight:700;letter-spacing:0.3px;margin-top:3px;">
              ${r.label} — ${r.dcKw > 0 ? `${r.dcKw.toFixed(2)} kW DC · ` : ''}${r.panels} MODULES${r.panelDisp ? ` · ${escapeH(r.panelDisp.toUpperCase())}` : ''}${r.invDisp ? ` · ${escapeH(r.invDisp.toUpperCase())} (${r.topoLabel})` : ''}
            </div>`).join('')}` : `
            <div style="font-size:23px;font-weight:900;letter-spacing:1.4px;line-height:1.05;">PHOTOVOLTAIC ${isFence(_coverSysType) ? 'SOLAR FENCE' : isGround(_coverSysType) ? 'GROUND MOUNT' : 'ROOF MOUNT'} SYSTEM</div>
            <div style="font-size:10.5px;font-weight:900;letter-spacing:0.4px;margin-top:4px;">
            ${[dcKw !== null ? `${dcKw.toFixed(2)} kW DC` : '', acKw !== null ? `${acKw.toFixed(2)} kW AC` : '', totalPanels > 0 ? `${totalPanels} MODULES` : '', topologyLabel || '', mountLabel ? `${mountLabel}` : ''].filter(Boolean).join(' &nbsp;·&nbsp; ')}
            </div>`}
          </div>
        </div>` : ''}

        ${_c?.hybridSystemTypes ? (() => {
          // ── Wave 6.3 — banner retirement GATE (computed, never a blind removal).
          // ready ⇔ per-sub structural authority ∧ per-sub conductor authority
          //         ∧ golden hybrid fixture green (hybridReadiness.ts).
          // Phase-0 loud console.warn stays in canonical.ts regardless.
          const _gate = _coverHybrid ? hybridSubmissionGate(input, cad) : null;
          if (_gate && _gate.ready) {
            // Gate PASSED: the DO-NOT-SUBMIT banner is retired. A compact
            // neutral note documents the multi-system structure for the AHJ.
            return `
        <div class="sec">
          <div class="sec-hdr">HYBRID MULTI-SYSTEM SET — PER-SUB-SYSTEM DOCUMENTATION</div>
          <div class="sec-body" style="line-height:1.5;">
            This design contains ${_coverSubRows.length} sub-systems (${escapeH(_coverSubRows.map(r => r.label.toLowerCase()).join(', '))}), each documented on its own
            plan/elevation, circuit-layout, structural and PE-letter sheets (suffixed G/F). Electrical sources combine at ONE point of
            interconnection — see E-1 (multi-source single line) and the summed NEC 705.12(B) analysis on PV-4A/PV-4B.
            PER-SUB-SYSTEM STRUCTURAL &amp; ELECTRICAL AUTHORITY VERIFIED.
          </div>
        </div>`;
          }
          return `
        <!-- HYBRID DESIGN — NOT PERMIT-READY (Phase 0 guard; see canonical.ts).
             Wave 6.3: gate computed in hybridReadiness.ts; this banner renders
             only while a sub's authority is missing (list below) or the golden
             fixture is not green. -->
        <div class="sec" style="border:3px solid #cc0000;">
          <div class="sec-hdr" style="background:#cc0000;color:#fff;">&#9888; HYBRID DESIGN — THIS SET IS NOT PERMIT-READY</div>
          ${_coverHybrid ? `
          <div class="sec-body" style="line-height:1.5;">
            <div style="font-weight:bold;color:#cc0000;">
              This design contains ${_coverSubRows.length} sub-systems (${escapeH(_coverSubRows.map(r => r.label.toLowerCase()).join(', '))}). DO NOT SUBMIT until this banner is removed.
            </div>
            <div style="margin-top:4px;">
              <strong>NOW DOCUMENTED PER SUB-SYSTEM:</strong> dedicated plan/elevation sheets (${_coverSubRows.slice(1).map(r => `PV-1${r.label === 'GROUND' ? 'G' : r.label === 'FENCE' ? 'F' : 'R'}`).join(', ') || '—'}),
              per-sub circuit layouts (PV-1B set), per-sub NEC &amp; conductor schedules (PV-4A / PV-4B), per-sub structural details
              (${_coverSubRows.slice(1).map(r => `PV-3${r.label === 'GROUND' ? 'G' : 'F'}`).join(', ') || '—'}), per-sub equipment schedule rows (SCHED),
              and per-sub ${peLetterTitlesFromInput(input).noun}s (PE-1${_coverSubRows.slice(1).map(r => `, PE-1${r.label === 'GROUND' ? 'G' : 'F'}`).join('')}).
            </div>
            <div style="margin-top:4px;color:#cc0000;">
              <strong>MISSING BEFORE SUBMISSION (WAVE 6 GATE):</strong>
              ${(_gate?.missing ?? []).map(m => `<div style="margin-left:8px;">&bull; ${escapeH(m)}</div>`).join('') || '<div style="margin-left:8px;">&bull; gate evaluation unavailable</div>'}
            </div>
          </div>` : `
          <div class="sec-body" style="font-weight:bold;color:#cc0000;line-height:1.5;">
            This design contains panels of ${_c.hybridSystemTypes.length} system types
            (${escapeH(_c.hybridSystemTypes.join(', '))}). The current engineering pipeline documents ONLY the
            "${escapeH(String(_c.systemType))}" portion &mdash; structural, racking, wiring and rapid-shutdown items for the
            other sub-systems are MISSING from this set and its bill of materials. DO NOT SUBMIT. Split the design
            into single-system projects, or wait for multi-system support.
          </div>`}
        </div>`;
        })() : ''}

        <!-- SCOPE OF WORK -->
        <div class="sec">
          <div class="sec-hdr">SCOPE OF WORK</div>
          <div class="sec-body">
            <div class="note-row"><div class="note-num">1.</div><div class="note-txt">FURNISH AND INSTALL ${totalPanels > 0 ? totalPanels + ' ' : ''}PHOTOVOLTAIC SOLAR MODULES ON ${_coverHybrid ? _coverSubRows.map(r => r.label).join(' + ') + ' MOUNTING SYSTEMS (SEE PER-SUB SHEETS)' : mountLabel + ' SYSTEM'}.</div></div>
            <div class="note-row"><div class="note-num">2.</div><div class="note-txt">INSTALL ${_coverHybrid ? 'PER-SUB-SYSTEM' : topologyLabel} POWER CONVERSION EQUIPMENT PER NEC ${necVer} ARTICLE 690${_coverHybrid ? ' (SEE SYSTEM SUMMARY)' : ''}.</div></div>
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
             sheet index and construction notes off the fixed page).
             §16: the issue disposition is DERIVED from the project-authority
             issue state (pa.issueStatus) — never a hard-coded "Issued for permit
             review". While the set is pending review it prints the honest
             DESIGN-REVIEW disposition; only an ISSUED-FOR-PERMIT / PERMIT-READY
             authority state prints permit-issue language. -->
        <div class="sec" style="margin-bottom:var(--xs);">
          <div class="sec-hdr">ENGINEERING SUMMARY</div>
          <div class="sec-body" style="font-size:var(--f-md);line-height:1.22;padding:var(--xs);">
            ${(() => {
              // §17 (closeout 2026-07-23) — separate the COMPUTATIONAL/analysis basis
              // (the editions the engine actually ran under — NEC/ASCE) from the
              // ADOPTED JURISDICTIONAL AUTHORITY (IBC/IRC/IFC, unknown ⇒ PENDING).
              // Never "designed per IBC PENDING" — that reads as compliance with a
              // pending edition. Adopted editions are an authority status, not a
              // design basis. Kept tight so the cover left column still fits (§19).
              const adoptedParts = [`IBC ${ibcVer}`, `IRC ${ircVer}`, `IFC ${ifcVer}`];
              const allAdoptedPending = [ibcVer, ircVer, ifcVer].every(v => v === 'PENDING');
              const adopted = allAdoptedPending ? 'PENDING VERIFICATION' : adoptedParts.join(' / ');
              return `${system.totalDcKw?.toFixed(2) || '—'} kW DC grid-tied PV system at ${escapeH(project.address || '—')}. `
                + `<strong>CALC BASIS:</strong> NEC ${necVer} / ASCE ${asceVer}. `
                + `<strong>AHJ-ADOPTED IBC / IRC / IFC:</strong> ${adopted}. `
                + (_permitIssued
                    ? 'Issued for permit review — requires PE review and wet stamp before AHJ submission.'
                    : `DESIGN REVIEW PACKAGE — NOT FOR PERMIT SUBMISSION (${escapeH(pa.issueStatus ?? 'DESIGN DRAFT')}); requires PE review and wet stamp before AHJ submission.`);
            })()}
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
                // Battery/ESS packages carry 22+ notes — at 6.2px they ran
                // 31px past the page bottom (clipped rows). Scale with count.
                // §19 (closeout 2026-07-23): tightened line-height + zero row
                // margin so CONSTRUCTION NOTES clears the fixed left-column box
                // even as the SHEET INDEX grows with the sheet set (was clipping
                // ~5–6px at the bottom under .page-body's hidden overflow).
                const _fs = totalNotes > 20 ? 5.6 : 6.2;
                const _lh = totalNotes > 20 ? 1.1 : 1.14;
                let num = 0;
                const renderCol = (c: typeof flat) => `<div>${c.map(x => {
                  num++;
                  return `<div style="display:flex;gap:3px;font-size:${_fs}px;line-height:${_lh};margin-bottom:0;">`
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
                <td class="iv" style="border-right:var(--border);">${escapeH(pa.issueStatus ?? 'DESIGN DRAFT')}</td>
                <td class="iv">${pa.issueDate || ''}</td>
              </tr>
              <tr><td colspan="3" class="iv">&nbsp;</td></tr>
            </table>
          </div>
        </div>

        <!-- ENGINEER OF RECORD -->
        <div class="sec">
          <div class="sec-hdr">ENGINEER OF RECORD</div>
          <div class="sec-body">
          <div class=\"stamp-box\" style=\"min-height:58px;\">
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
              ${infoRow('SCALE',        'NTS')}
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
          <!-- Flex column so the aerial FILLS the space the column actually has
               left — the fixed 150px image pushed this section 27px past the
               page bottom (clipped caption) whenever the column ran long. -->
          <div class="sec-body sec-body-table" style="overflow:hidden;position:relative;display:flex;flex-direction:column;">
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
                <text x="20" y="3.5" text-anchor="middle" font-size="7" font-weight="900" fill="#000" font-family="SolarPro Sans, SolarPro Symbols">N</text>
              </svg>
            </div>
          </div>
        </div>

      </div><!-- end right column -->

    </div><!-- end page-body -->

  </div>`;
}



