// ═══════════════════════════════════════════════════════════════
// Title Block & Construction Notes
// Extracted from route.ts — ZERO REGRESSION
// ═══════════════════════════════════════════════════════════════

import type { PermitInput } from '../types';
import { utilityDisplayName, resolveEquipment } from './helpers';
import { escapeH } from './drawing';
import type { ResolvedEquipment } from '../types';
import { projectCodeAuthorityFromInput } from '../snapshot/codeAuthorityProjection';
import { projectProjectAuthorityFromInput } from '../snapshot/projectAuthorityProjection';
import { projectRacewayDescriptor } from '../snapshot/electricalProjection';
import type { PermitDesignSnapshot } from '../snapshot/types';
import { getMountingSystemById } from '@/lib/mounting-hardware-db';

/** §10 — the ONE verified fastener installation spec for the SELECTED mounting
 *  system (single source = mounting-hardware-db hardware.lagBolt + embedment).
 *  Replaces the hardcoded "3/8" lag" note so every sheet prints the same spec
 *  the PV-3 detail, PE-1 and BOM print (RT-MINI: 2× 5/16" (8mm) wood screw,
 *  ~3.5" (90mm), no pilot hole). Falls back to the listed installation
 *  instructions when no mount is resolved — never a fabricated diameter. */
function roofAttachmentNote(mountingSystemId: string | undefined): string {
  const m = mountingSystemId ? getMountingSystemById(mountingSystemId) : undefined;
  if (!m) {
    return `Roof attachments shall be installed per manufacturer instructions and attachment detail on sheet PV-3. `
      + `Fasteners per the selected mounting system's listed installation instructions and PV-3 attachment detail; `
      + `use corrosion-resistant hardware throughout.`;
  }
  const fracIn = (v: number | undefined) =>
    v === 0.25 ? '1/4' : v === 0.3125 ? '5/16' : v === 0.375 ? '3/8' : v === 0.5 ? '1/2' : (v != null ? `${v}` : '');
  const spec = m.hardware.lagBolt
    ?? `${fracIn(m.mount.fastenerDiameterIn)}" dia structural fastener`;
  const embed = m.mount.fastenerEmbedmentIn ? `, minimum ${m.mount.fastenerEmbedmentIn}" embedment into rafter` : '';
  return `Roof attachments shall be installed per manufacturer instructions and attachment detail on sheet PV-3. `
    + `Fastener: ${spec}${embed}. Use corrosion-resistant hardware per the manufacturer's listed installation instructions.`;
}


// ─── Title Block (shared across all pages) ───────────────────────────────────

export function titleBlock(
  input: PermitInput,
  sheetId: string,
  pageTitle: string,
  pageNum: number,
  totalPages: number
): string {
  const { project, compliance, system } = input;
  // W4 §2: EVERY code edition on the title block projects from the ONE snapshot
  // codeAuthority record — no sheet-local literal, no NEC→IFC inference. Unknown
  // adoptions render PENDING. The editions are TAGGED (data-code-edition) so the
  // evidence harness can prove cross-sheet identity + literal-freedom.
  const cp = projectCodeAuthorityFromInput(input);
  // W4 §3: AHJ / utility / APN / module / inverter / issue status project from the
  // ONE snapshot projectAuthority record and are TAGGED (data-project-field) so
  // the truth matrix can prove cross-sheet identity + single-sourcing on EVERY
  // sheet's title block. (_snapshot propagates through subScopedInput's spread.)
  const pa = projectProjectAuthorityFromInput(input);
  const state   = compliance.jurisdiction?.state || '—';
  const ahj     = pa.ahj ?? compliance.jurisdiction?.ahj ?? project.ahj ?? '—';
  const utility = pa.utility ?? utilityDisplayName(project.utilityName || project.utilityMeter || '') ?? '—';
  const apn     = pa.apn ?? project.apn ?? '—';

  // Resolve module and inverter models for title block.
  // HYBRID (Ray 2026-07-16): inverters[0] leaked whichever subsystem sorted
  // first — the ROOF sheet's title block said "Philadelphia Solar Nexus 440W /
  // EcoFlow" (the FENCE equipment) while its own string legend said 54×405W.
  // With heterogeneous subsystems, list one short line per subsystem instead.
  const _invs = system?.inverters ?? [];
  const _subKeyOf = (o: { subSystemKey?: string } | undefined) => (o?.subSystemKey ?? '').toString();
  const _distinctSubs = new Set(_invs.map(i => _subKeyOf(i)).filter(Boolean));
  const _subPrefix = (k: string) =>
    k.startsWith('roof') ? 'R' : k.startsWith('ground') ? 'G' : k.startsWith('fence') ? 'F' : k.slice(0, 1).toUpperCase();
  let moduleDisplay: string;
  let inverterDisplay: string;
  if (_distinctSubs.size > 1) {
    const modLines: string[] = [];
    const invLines: string[] = [];
    const seenMod = new Set<string>(); const seenInv = new Set<string>();
    for (const inv of _invs) {
      const k = _subKeyOf(inv); if (!k) continue;
      const st = inv.strings?.[0];
      const mod = [st?.panelManufacturer, st?.panelModel].filter(Boolean).join(' ');
      const ivt = [inv.manufacturer, inv.model].filter(Boolean).join(' ');
      const mKey = `${_subPrefix(k)}:${mod}`, iKey = `${_subPrefix(k)}:${ivt}`;
      if (mod && !seenMod.has(mKey)) { seenMod.add(mKey); modLines.push(`${_subPrefix(k)}: ${mod}`); }
      if (ivt && !seenInv.has(iKey)) { seenInv.add(iKey); invLines.push(`${_subPrefix(k)}: ${ivt}`); }
    }
    moduleDisplay   = modLines.join('<br/>') || '—';
    inverterDisplay = invLines.join('<br/>') || '—';
  } else {
    const firstInv = _invs[0];
    const firstStr = firstInv?.strings?.[0];
    const moduleModel   = firstStr?.panelModel    || project.moduleModel    || project.panelModel    || '—';
    const moduleMfr     = firstStr?.panelManufacturer || project.moduleMfr  || '';
    const inverterModel = firstInv?.model          || project.inverterModel || '—';
    const inverterMfr   = firstInv?.manufacturer   || project.inverterMfr  || '';
    moduleDisplay   = [moduleMfr, moduleModel].filter(Boolean).join(' ') || '—';
    inverterDisplay = [inverterMfr, inverterModel].filter(Boolean).join(' ') || '—';
  }
  // HYBRID: sheet-scoped inputs (e.g. the roof site plan documenting only the
  // roof subset) stash the PROJECT totals — the title block is project-wide
  // chrome and must never show subset numbers (PV-1 printed "20.40 kW / 51
  // modules" on a 94-module hybrid while the cover said 37.60/94).
  const _sysAny = system as (typeof system & { _projectTotalDcKw?: number; _projectTotalPanels?: number }) | undefined;
  const _tbDcKw = _sysAny?._projectTotalDcKw ?? system?.totalDcKw;
  const _tbPanels = _sysAny?._projectTotalPanels ?? system?.totalPanels;
  const systemSizeKw    = _tbDcKw ? `${_tbDcKw.toFixed(2)} kW DC` : '—';
  const panelCount      = _tbPanels ? `${_tbPanels} modules` : '';

  // Industry-standard VERTICAL title-block strip on the right edge of every
  // sheet — firm block, project block, meta, revisions, PE seal, sheet name,
  // and the big sheet ID in the extreme lower-right where plan reviewers and
  // printers index a set. (The old full-width horizontal banner across the top
  // was the single biggest "generated, not drafted" tell vs the PE-sealed
  // reference.) Rendered position/size comes from .title-block CSS.
  return `
  <div class="title-block">
    <div class="tbs-firm">
      <div class="tb-company">SOLARPRO<br/>ENGINEERING</div>
      <div class="tbs-firm-sub">SOLAR PERMIT PLANSETS</div>
    </div>
    <div class="tbs-block">
      <div class="tb-project">${pa.present ? pa.tag('project-name') : escapeH(project.projectName || 'SOLAR PV SYSTEM')}</div>
      <div class="tb-address">${pa.present ? pa.tag('address') : escapeH(project.address || '—')}</div>
      <div class="tb-client">CLIENT: ${pa.present ? pa.tag('customer') : escapeH(project.clientName || '—')}</div>
      <div class="tb-meta">APN: ${pa.present ? pa.tag('apn') : escapeH(apn)}</div>
      <div class="tb-meta">UTILITY: ${pa.present ? pa.tag('utility') : escapeH(utility)}</div>
      <div class="tb-meta">AHJ: ${pa.present ? pa.tag('ahj') : escapeH(ahj)} | ${escapeH(state)}</div>
      <div class="tb-meta">ISSUE: ${pa.present ? pa.tag('issue-status') : 'PENDING'}</div>
    </div>
    <table class="tb-table">
      <tr><td class="tbl">DESIGNER</td><td class="tbv">${escapeH(project.designer || '—')}</td></tr>
      <tr><td class="tbl">DATE</td><td class="tbv">${escapeH(String(project.date ?? ''))}</td></tr>
      <tr><td class="tbl">SYSTEM</td><td class="tbv">${systemSizeKw}${panelCount ? ' / ' + panelCount : ''}</td></tr>
      <tr><td class="tbl">MODULE</td><td class="tbv">${_distinctSubs.size > 1 ? moduleDisplay : (pa.moduleDisplay ? pa.tag('module-model') : moduleDisplay)}</td></tr>
      <tr><td class="tbl">INVERTER</td><td class="tbv">${_distinctSubs.size > 1 ? inverterDisplay : (pa.inverterDisplay ? pa.tag('inverter-model') : inverterDisplay)}</td></tr>
      <tr><td class="tbl">SCALE</td><td class="tbv">${/^(PV-1|PV-1B|PV-3)$/.test(sheetId) ? 'AS NOTED' : 'NTS'}</td></tr>
    </table>
    <div class="tbs-rev-hdr">REVISIONS</div>
    <table class="tb-table">
      <tr><td class="tbl">REV A</td><td class="tbv">${pa.present ? escapeH(pa.display('issue-status')) : 'PENDING'} &mdash; ${escapeH(String(pa.issueDate ?? project.date ?? ''))}</td></tr>
    </table>${''/* W4 §1: REV A description = DERIVED issue state (projectAuthority) — never a hardcoded issued state while pending review. */}
    <div class="tbs-seal">
      <div class="tbs-seal-caption">PE SEAL</div>
      <div class="pe-seal-box">&nbsp;</div>
    </div>
    <div class="tbs-spacer"></div>
    <div class="tbs-sheetname">
      <div class="tbs-sn-label">SHEET NAME</div>
      <div class="tb-sheet-title">${pageTitle}</div>
      <div class="tb-codes">${cp.tag('nec')} &middot; ${cp.tag('ibc')} &middot; ${cp.tag('irc')} &middot; ${cp.tag('ifc')} &middot; ${cp.tag('asce')}</div>
      <div class="tb-size">ANSI B &mdash; 11&Prime; &times; 17&Prime; &nbsp;|&nbsp; SHEET ${pageNum} OF ${totalPages}</div>
    </div>
    <div class="tbs-id">
      <div class="tb-sheet-id">${sheetId}</div>
    </div>
    ${_snapshotStampHtml(input)}
  </div>`;
}

/** PermitDesignSnapshot stamp (V12 — Ray W1 req. 1): every rendered sheet
 *  carries the SAME snapshot id, schema version and SHA-256 digest. Absent
 *  snapshot ⇒ explicit UNSTAMPED marker (never silently blank); the post-
 *  render assertion in generatePermit fails closed on it. */
function _snapshotStampHtml(input: PermitInput): string {
  const s = (input as unknown as { _snapshot?: { meta?: { snapshotId?: string; schemaVersion?: string; digest?: string } } })._snapshot;
  const m = s?.meta;
  if (!m?.snapshotId || !m?.digest) {
    return `<div class="tb-snapshot" style="font-size:5.5px;color:#a00;padding:1px 4px;border-top:1px solid #000;">SNAPSHOT: UNSTAMPED — NOT AN AUTHORITY-VERIFIED SHEET</div>`;
  }
  // W4 §3: snapshot id + digest are TAGGED (data-project-field) so the truth
  // matrix extracts the identical snapshot identity printed on every sheet.
  return `<div class="tb-snapshot" style="font-size:5.5px;color:#333;padding:1px 4px;border-top:1px solid #000;line-height:1.35;">`
    + `SNAPSHOT <span data-project-field="snapshot-id">${escapeH(m.snapshotId)}</span> &middot; SCHEMA ${escapeH(m.schemaVersion ?? '')}<br/>`
    + `SHA-256 <span data-project-field="digest">${escapeH((m.digest ?? '').slice(0, 20))}</span>&hellip;</div>`;
}

// ─── Construction Notes (NEC-specific, system-config-aware) ──────────────────

export function buildConstructionNotes(input: PermitInput): string[] {
  const { project, compliance } = input;
  // W4 §2: code editions in the general notes project from the ONE snapshot
  // codeAuthority record (same source as the title block / cover). Unknown
  // adoptions read PENDING — never a sheet-local literal or NEC→IFC inference.
  const cp = projectCodeAuthorityFromInput(input);
  const necVer = cp.nec ?? 'PENDING';
  const ibcVer = cp.ibc ?? 'PENDING';
  const ircVer = cp.irc ?? 'PENDING';
  const ifcVer = cp.ifc ?? 'PENDING';
  const asceVer = cp.asce ?? 'PENDING';
  const notes: string[] = [
    `All work shall conform to NEC ${necVer}, ${ibcVer} IBC, ${ircVer} IRC, ${ifcVer} IFC, ASCE ${asceVer}, applicable state amendments, and AHJ requirements. All equipment shall be listed and labeled per NEC 110.3(B).`,
    `Solar PV wiring shall comply with NEC Article 690. DC wiring methods shall be per NEC 690.31. PV source and output circuit conductors shall be identified at all access points per NEC 690.31(B).`,
    // Interconnection note follows the ACTUAL method — the load-side backfeed
    // boilerplate on a supply-side-tap job re-introduced the exact set-wide
    // contradiction the teardown flagged.
    project.interconnectionMethod === 'SUPPLY_SIDE_TAP'
      ? `System shall interconnect via supply-side tap per NEC 705.11. Tap conductors shall be sized ≥ 125% of PV output current and terminate in a fused disconnect within 10 ft of the tap per NEC 705.11(C). The 120% busbar rule (NEC 705.12(B)) does not apply to supply-side connections.`
      : `System shall comply with NEC 705.12 for interconnected power production equipment. Backfeed breaker shall be sized per NEC 705.12(B)(2)(3)(b). Sum of all supply breakers shall not exceed 120% of bus rating.`,
    project.rapidShutdown
      ? `Rapid shutdown system required per NEC 690.12. Module-level rapid shutdown (MLRS) shall reduce array conductors to \u2264 30V within 30 seconds. Initiator shall be located at utility meter per NEC 690.56(B).`
      : `Rapid shutdown initiator shall be installed per NEC 690.12. Array boundary conductors shall be de-energized to \u2264 30V within 30 seconds of initiation.`,
    `All conductors shall be sized per NEC 310.15. Temperature correction (NEC 310.15(B)(1)) and conduit fill derating (NEC 310.15(C)(1)) shall be applied. PV conductor ampacity minimum 125% of maximum circuit current per NEC 690.8(B).`,
    // §2/§7 (closeout 2026-07-23): the conduit note DERIVES from the actual
    // physical raceway objects via the ONE canonical route-description accessor —
    // never `project.conduitType || 'EMT'` (which printed EMT beside a PVC run)
    // and never the mixed "358.30 (EMT) or 352.30 (PVC)" citation. A PVC run cites
    // the PVC article (352), an EMT run cites 358; absent raceways print PENDING.
    projectRacewayDescriptor(
      (input as unknown as { _snapshot?: PermitDesignSnapshot })._snapshot ?? null
    ).noteText,
    `Equipment grounding conductor (EGC) shall be sized per NEC 250.122. All metallic racking, module frames, and enclosures shall be bonded per NEC 690.43. DC EGC minimum: ${project.wireGauge || '#10 AWG'} per NEC 690.45.`,
    `${project.acDisconnect ? 'AC disconnect switch required and shown on SLD' : 'AC disconnect — see SLD for requirements'}. Disconnect shall be within sight of inverter, accessible, and rated for available fault current per NEC 690.15.`,
    `Inverter(s) shall be UL 1741-listed and comply with IEEE 1547 for grid interconnection. Anti-islanding protection required per NEC 705.40. Inverter output circuit rated per NEC 705.12 and manufacturer requirements.`,
    `Photovoltaic source circuit conductors shall be marked or tagged "PHOTOVOLTAIC POWER SOURCE" at all accessible locations per NEC 690.31(B). Markings shall be sunlight-resistant and moisture-resistant.`,
    `GFDI (Ground Fault Detection and Interruption) shall be provided as integrated in the listed inverter(s) per NEC 690.41. DC arc-fault circuit interrupter (AFCI) shall be provided per NEC 690.11.`,
    `Warning labels and placards shall be installed per NEC 690.54, NEC 690.56(C), NEC 705.12(B)(2)(3)(e), and IFC ${ifcVer} \u00a71204 (rooftop PV access/marking; \u00a7605.11 in pre-2018 editions). See sheet PV-5 for complete label schedule and placement diagram.`,
    // Statutory site/clearance notes \u2014 migrated from the retired PV-1 site sheet
    // (2026-07-08 fold) so they persist in the set's general notes.
    `All electrical equipment \u2014 inverters, disconnects, main service panel, and junction/combiner boxes \u2014 shall be located a minimum of 3 ft from the gas meter supply and demand piping.`,
    `Existing plumbing vents, skylights, and mechanical/roof vents shall not be covered, moved, re-routed, or relocated by the PV installation.`,
    `A visible, lockable, labeled, knife-blade AC disconnect shall be located within 10 ft of the utility meter and accessible to utility personnel per NEC 690.13 and AHJ requirements.`,
    // FIX v47.295: Only include roof attachment / flashing notes for roof systems
    ...((input.project)?.systemType === 'fence' || input.project?.systemType === 'solar_fence'
      ? [
          `Solar fence post foundations shall be installed per structural engineer specifications and attachment detail on sheet PV-3. Minimum embedment depth 3.5 ft below finish grade. Concrete footing min. 3,000 psi, 12" diameter min.`,
          `All metallic fence posts and frames shall be bonded to the equipment grounding conductor (EGC) per NEC 250.169 and NEC 690.43. Minimum #6 AWG copper bonding conductor required throughout fence structure.`,
        ]
      : input.project?.systemType === 'ground' || input.project?.systemType === 'ground_mount'
      ? [
          `Ground mount pile/pier foundations shall be installed per structural engineer specifications and attachment detail on sheet PV-3. Embedment depth per geotechnical requirements and ASCE ${asceVer}.`,
          `All metallic racking, module frames, and enclosures shall be bonded per NEC 690.43. DC EGC minimum: #10 AWG per NEC 690.45. Ground array grounding per NEC 690.47 and 250.166.`,
        ]
      : [
          roofAttachmentNote((project as { mountingSystemId?: string }).mountingSystemId),
          `Flashing shall be installed under all roof penetrations and sealed with approved sealant per manufacturer instructions. Verify roof framing at each attachment point. No attachments to sheathing only.`,
        ]),
    `Module-to-rail torque shall be per rail manufacturer specification. Rail splices installed per manufacturer details. All exposed hardware shall be stainless steel or corrosion-resistant equivalent per NEC 110.3(B).`,
    `All junction boxes, combiner boxes, and conduit bodies shall be accessible per NEC 314.29. Cover plates shall be secured and labeled. Box fill calculated per NEC 314.16.`,
    `Electrical contractor shall obtain all required permits prior to beginning work. Work shall be inspected by the AHJ before concealment per NEC 110.13. Maintain as-built drawings on-site during installation.`,
    `Installer shall verify utility interconnection requirements with ${utilityDisplayName(project.utilityName || '') || 'the serving utility'} prior to energization. Utility NEM/interconnection agreement required. Obtain AHJ final inspection and utility PTO before energizing.`,
    `All equipment shall be installed per manufacturer installation instructions. Field modifications to listed equipment are prohibited per NEC 110.3(B). Substitutions require engineer approval and AHJ re-submission.`,
    `System annual production estimate: ${(input.system.totalDcKw || 0) > 0 ? `${((input.system.totalDcKw || 0) * 1400).toFixed(0)} kWh/yr (estimated at 1,400 kWh/kW DC — site-specific irradiance not included)` : 'Per energy model — see engineering report'}. Production estimate does not constitute a performance guarantee.`,
  ];
  if (project.batteryCount && project.batteryCount > 0) {
    notes.push(`Battery energy storage system (BESS) shall comply with NEC Article 706 and NFPA 855. Installation location, clearances, and ventilation per manufacturer requirements and AHJ. BESS shall be UL 9540-listed.`);
    notes.push(`BESS automatic disconnect required for ground fault, overcurrent, or thermal runaway per NEC 706.20. Battery management system (BMS) shall be integrated. Thermal runaway protection per NFPA 855 \u00a74.3.3.`);
  }
  if (project.generatorKw && project.generatorKw > 0) {
    notes.push(`Generator interconnection shall comply with NEC Article 702 and NEC 705.12. Automatic transfer switch (ATS) shall prevent parallel operation with utility. ATS shall be UL 1008-listed.`);
  }
  return notes;
}



