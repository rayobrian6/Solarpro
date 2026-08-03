// ═══════════════════════════════════════════════════════════════
// SLD Adapter — Maps PermitInput → SLDProfessionalInput
// DATA BINDING ONLY — no logic changes, no new calculations
// ═══════════════════════════════════════════════════════════════

import type { PermitInput } from '../types';
import type { CADModel } from '@/lib/cad/types';
import { renderSLDProfessional, normalizeSourceBranches, acCollectionFromLanes, type SLDProfessionalInput, type SLDSourceBranch } from '@/lib/sld-professional-renderer';
import type { HybridAcCollectionPlan } from '@/lib/equipment/integratedBos';
import { utilityDisplayName, interconnectionLabel, necNextStandardOcpd, hasRealBattery, unselectedInverterLabel, isInverterUnselectedMarker } from './helpers';
import { getEquipmentContext, getInverterTopology, topologyToLegacy } from '@/lib/system';
import { calcDcAcRatio } from '@/lib/system/calcDcAcRatio';
import { buildConductorAuthority, type ConductorAuthority, type SubSystemConductorAuthority } from './conductorAuthority';
import { buildIntegratedEquipment } from './integratedEquipment';
import { isSubSystemKey, type SubSystemKey } from './subSystems';
import { getInverterById, getMicroinverterById, SOLAR_PANELS } from '@/lib/equipment-db';
import { getEGCSize } from '@/lib/manufacturer-specs';
import type { ComputedSystem, RunSegment } from '@/lib/computed-system';
import { getDesignTemps } from './designTemps';
import { peekSnapshot } from '../snapshot/read';
import { projectCanonicalFeeder, projectCanonicalBranch, projectSharedBranchRaceway, projectListedCableAssembly, projectOpenAirBranchGrounding } from '../snapshot/electricalProjection';

/** Resolve a panel's Voc temp coefficient (%/°C) from the equipment DB by
 *  model string — the SAME records the equipment pages read. Undefined when
 *  the model can't be matched (the sheet then prints a MARKED conservative
 *  assumption instead of a silently fabricated datasheet value). */
function panelTempCoeffByModel(model?: string): number | undefined {
  const m = (model ?? '').trim().toLowerCase();
  if (!m) return undefined;
  const hit = SOLAR_PANELS.find(p =>
    m === p.model.toLowerCase()
    || m === `${p.manufacturer} ${p.model}`.toLowerCase()
    || m.includes(p.model.toLowerCase()));
  return typeof hit?.tempCoeffVoc === 'number' ? hit.tempCoeffVoc : undefined;
}

/** 2-letter state for the design-temp lookup: explicit field first, then the
 *  ", ST 12345" tail of the address string. */
function stateFromProject(project: { state?: string; address?: string }): string | undefined {
  if (project.state && /^[A-Za-z]{2}$/.test(project.state.trim())) return project.state.trim().toUpperCase();
  const m = (project.address ?? '').match(/,\s*([A-Za-z]{2})[\s,]+\d{5}(?:-\d{4})?\b/);
  return m ? m[1].toUpperCase() : undefined;
}

/**
 * Build a live SLDProfessionalInput from PermitInput canonical data.
 * Uses systemAccessors (prefers SystemDefinition, falls back to legacy resolvers).
 * Does NOT call computeSystem() — all values sourced from PermitInput fields.
 */
export function buildSLDInputFromPermit(input: PermitInput, cad?: CADModel | null): SLDProfessionalInput {
  const { project, system, compliance } = input;

  // Shared conductor authority — E-1's branch conductors and system EGC MUST
  // match PV-4A/PV-4B/BOM; they all read this same function.
  const _auth = buildConductorAuthority(input, cad);
  // Brand-integrated combiner/gateway — same device PV-6/SCHED/PV-0 print.
  const _bos = buildIntegratedEquipment(input, cad);
  const _bosBrains = _bos.brains ?? _bos.devices[0];

  // ── Equipment resolution (same 4-source priority as all planset pages) ──
  const eq = getEquipmentContext(input, cad);
  const topology = topologyToLegacy(getInverterTopology(input, cad));
  const isMicro = topology === 'MICRO';

  // §3 (07-22) — canonical feeder projection: E-1's conduit type/size, feeder
  // voltage drop and run length come from the ONE feeder segment the snapshot
  // carries (the SAME source PV-4A/PV-4B/SCHED read), so the SLD can never print
  // '3/4" EMT' while the schedule prints '1-1/4" 3/4" EMT' at 1.11%-vs-0.37%.
  const _snapFeed = projectCanonicalFeeder(peekSnapshot(input));
  // W1b — the micro AC branch home-run raceway PROJECTS the canonical BRANCH_RUN
  // segment so E-1 stops printing the '3/4" EMT' literal while PV-4B / SCHED /
  // BOM project the real branch conduit (one segment authority, gate 3).
  const _snapBranch = projectCanonicalBranch(peekSnapshot(input));
  // §3/§4 — the SHARED jbox→combiner home-run raceway (all branches bundled).
  // E-1's SEGMENT_2A conduit label reads THIS; the branch CONDUCTORS ride the
  // open-air Q-Cable trunk (_snapBranch). Two physical sections, never merged.
  const _snapHomerun = projectSharedBranchRaceway(peekSnapshot(input));
  // §8 — the LISTED open-air branch wiring-method identity the legend must name.
  // Micro topology draws the Q-Cable assembly (SEGMENT 1, 'ENPHASE Q CABLE
  // (TC-ER)'); the legend derives from THIS, never the hardcoded 'PV Wire/THWN-2'.
  const _snapAsm = projectListedCableAssembly(peekSnapshot(input));
  // §5 — the canonical BRANCH EGC (NEC 250.122 on the BRANCH OCPD), read from the
  // per-purpose grounding object — the SAME record the E-1 schedule, PV-1B/PV-4B
  // notes and the BOM open-air EGC footage row project (one source, gate 7).
  const _snapBranchEgc = (peekSnapshot(input)?.electrical?.groundingObjects ?? [])
    .find(g => g.purpose === 'branch-egc')?.conductorSize
    ?? projectCanonicalBranch(peekSnapshot(input)).egcGauge
    ?? null;

  // ── Mount type — drives the PV-array glyph/labels in the renderer ──
  // (cad.systemType is canonical, e.g. 'solar_fence'; project.systemType is the
  // legacy fallback.) Normalize to roof | ground | fence.
  const rawSysType = (cad?.systemType || project.systemType || '').toLowerCase();
  const systemType: 'roof' | 'ground' | 'fence' =
    rawSysType.includes('fence') ? 'fence' : rawSysType.includes('ground') ? 'ground' : 'roof';

  // ── Core system values ──
  const totalPanels  = system?.totalPanels ?? 0;
  const totalDcKw    = system?.totalDcKw ?? 0;
  const totalAcKw    = system?.totalAcKw ?? 0;
  // Use system total AC kW when available (correct for microinverters: panels × per-micro AcKw).
  // Fall back to eq.inverterAcOutputKw (per-inverter for string systems) only when totalAcKw is 0.
  const acOutputKw   = totalAcKw || eq.inverterAcOutputKw;
  const acOutputAmps = acOutputKw > 0 ? Math.round(acOutputKw * 1000 / 240) : 0;

  // ── Panel specs ──
  const panelWatts = eq.panelWatts || (totalDcKw && totalPanels ? Math.round(totalDcKw * 1000 / totalPanels) : 400);
  const panelModel = eq.panelModel !== '—' ? eq.panelModel : (totalPanels ? `${panelWatts}W Module` : 'PV Module');
  const panelVoc   = eq.panelVoc || project.panelVoc || 0;
  const panelIsc   = eq.panelIsc || project.panelIsc || 0;

  // ── Inverter specs ──
  // FAIL-LOUD (permit integrity): a genuinely unselected inverter shows a red
  // '⚠ INVERTER NOT SELECTED — PV-<KEY>' marker, never a fabricated 'Inverter'.
  const inverterModel = eq.inverterModel !== '—' ? eq.inverterModel : unselectedInverterLabel(systemType);
  const inverterMfr   = eq.inverterManufacturer !== '—' ? eq.inverterManufacturer : '';

  // ── Electrical values from compliance/project ──
  // acWireGauge must be a PLAIN gauge ('#8 AWG') — feeding the full conductor
  // callout string ('3#8 THWN-2 + …') here made the renderer re-format it into
  // garbage like '3#32 THWN-2' on every E-1 schedule row.
  const _plainGauge = (callout?: string | null, fallback = '#10 AWG'): string => {
    if (!callout) return fallback;
    const t = callout.trim();
    if (/^#\d+(\/0)?\s*AWG$/i.test(t)) return t;
    const m = t.match(/#(\d+(?:\/0)?)/);
    return m ? `#${m[1]} AWG` : fallback;
  };
  const acWireGauge  = compliance.electrical?.acWireGauge
    ?? _plainGauge(compliance.electrical?.acConductorCallout, project.wireGauge ?? '#10 AWG');
  const dcWireGauge  = _plainGauge(compliance.electrical?.dcConductorCallout);
  const acOCPD       = project.backfeedBreakerA ?? project.pvBackfeedA ?? (necNextStandardOcpd(acOutputAmps * 1.25) || 40);
  const backfeedAmps = project.backfeedBreakerA ?? acOCPD;
  const mainAmps     = project.mainPanelAmps ?? 200;
  const acWireLength = project.wireLength || 60;

  // ── String configuration (from system.inverters if available) ──
  const inv0 = system?.inverters?.[0];
  const strings = inv0?.strings ?? [];
  const totalStrings = isMicro ? 0 : strings.length || 1;
  const panelsPerString = isMicro ? 1 : (strings[0]?.panelCount ?? Math.ceil(totalPanels / Math.max(totalStrings, 1)));
  const lastStringPanels = isMicro ? 1 : (strings[strings.length - 1]?.panelCount ?? panelsPerString);

  // ── Topology type label for renderer ──
  const topologyType = isMicro ? 'MICROINVERTER'
    : topology === 'OPTIMIZER' ? 'OPTIMIZER'
    : 'STRING_INVERTER';

  // ── Interconnection ──
  const rawInterconnection = project.interconnectionMethod ?? 'LOAD_SIDE';
  const interconnection = rawInterconnection === 'LOAD_SIDE' || rawInterconnection.toLowerCase().includes('load') ? 'Load Side Tap'
    : rawInterconnection === 'SUPPLY_SIDE_TAP' || rawInterconnection.toLowerCase().includes('supply') ? 'Supply Side Tap'
    : rawInterconnection.toLowerCase().includes('line') ? 'Line Side Tap'
    : rawInterconnection;

  // ── Battery / Generator / ATS ──
  const hasBattery = hasRealBattery(project);
  // Total battery kWh (system total). For multi-unit systems the per-unit kWh
  // appears in the PV-1 equipment legend; the SLD label includes the breakdown
  // for clarity: e.g. "15 kWh (3 × 5.0)" instead of just "15 kWh".
  const batteryUnits    = project.batteryCount || 1;
  const batteryKwhPer   = project.batteryKwh ?? 5.0;
  const batteryKwhTotal = hasBattery ? batteryUnits * batteryKwhPer : 0;
  const batteryKwhLabel = hasBattery && batteryUnits > 1
    ? `${batteryKwhTotal} kWh (${batteryUnits} × ${batteryKwhPer})`
    : `${batteryKwhTotal} kWh`;

  // ── Micro-specific ──
  const deviceCount = isMicro ? totalPanels : undefined;
  // Branch rows come from the shared authority (same planner, same OCPD math)
  // so the SLD's conductor gauge tracks PV-4A/PV-4B instead of a hardcoded #10.
  // §1 (closeout 2026-07-23) — the SVG branch/home-run gauge is the CANONICAL
  // BRANCH_RUN conductor gauge (#10), NEVER the legacy microBranchRow wireGauge
  // (wireGaugeForOcpd(20A) = #12 — the fictitious THWN branch this campaign kills).
  // The listed trunk is drawn as 'ENPHASE Q CABLE (TC-ER)' open-air (SEGMENT 1);
  // the shared jbox→combiner home-run (SEGMENT_2A) prints the physicalRaceway's
  // full current-carrying inventory (6×#10 for a 3-branch design), not #12.
  const _canonBranchGauge = _snapBranch.gauge ?? '#10 AWG';
  const microBranches = isMicro ? _auth.microBranches.map((b) => ({
    branchIndex: b.index,
    deviceCount: b.deviceCount,
    branchCurrentA: b.branchCurrentA,
    ocpdAmps: b.ocpdAmps,
    conductorCallout: `${_canonBranchGauge} THWN-2`,
    necReference: 'NEC 690.8(B)',
  })) : undefined;

  // ── DC OCPD (string topology only) ──
  // Error 5b fix: ocpd IS declared on string type — no need for `as any`
  const dcOCPD = isMicro ? 0 : strings[0]?.ocpd ?? 20;

  // ── ASHRAE design temperatures (state envelope, lat-refined) ──
  const _temps = getDesignTemps(project.lat, project.lng, stateFromProject(project));

  const sldInput: SLDProfessionalInput = {
    projectName:             project.projectName ?? 'Solar PV System',
    clientName:              project.clientName ?? 'Homeowner',
    address:                 project.address ?? '',
    designer:                project.designer ?? '',
    // D6 — the E-1 drawing date is the SAME document issue date every title
    // block prints. The old `?? new Date().toLocaleDateString()` fallback was a
    // second, HOST-LOCAL date producer: on a UTC host it could put a different
    // calendar day on the SLD than on the sheet the SLD is drawn inside. There is
    // one document date; a missing one prints PENDING, never a fresh clock read.
    drawingDate:             project.date ?? 'PENDING',
    drawingNumber:           'SLD-001',
    revision:                'A',
    topologyType,
    systemType,
    totalModules:            totalPanels,
    totalStrings:            isMicro ? 0 : totalStrings,
    panelModel,
    panelWatts,
    panelVoc,
    panelIsc,
    dcWireGauge,
    dcConduitType:           project.conduitType ?? 'EMT',
    dcOCPD,
    inverterModel,
    inverterManufacturer:    inverterMfr,
    acOutputKw,
    acOutputAmps,
    acWireGauge,
    // §3 — canonical feeder raceway/size first (single source); project.conduitType
    // is only the standalone-preview fallback (no snapshot).
    acConduitType:           _snapFeed.raceway ?? project.conduitType ?? 'EMT',
    acConduitSize:           _snapFeed.tradeSizeIn ?? project.conduitSize ?? undefined,
    // W1b — canonical branch home-run raceway (single source for E-1's SEGMENT_2A).
    branchConduitType:       _snapBranch.raceway ?? undefined,
    branchConduitSize:       _snapBranch.tradeSizeIn ?? undefined,
    branchIsOpenAir:         _snapBranch.raceway === 'FREE_AIR',
    // §3/§4 — the shared home-run conduit (jbox→combiner). SEGMENT_2A prints this
    // as the in-conduit section while the branch conductors are open-air Q-Cable.
    homerunConduitType:      _snapHomerun.present ? (_snapHomerun.racewayType ?? undefined) : undefined,
    homerunConduitSize:      _snapHomerun.present ? (_snapHomerun.tradeSizeIn ?? undefined) : undefined,
    homerunSharedCircuits:   _snapHomerun.present ? (_snapHomerun.sharedCircuitCount ?? undefined) : undefined,
    // §1 — the shared home-run's FULL current-carrying-conductor inventory (2×#10
    // per branch × N) from the canonical physicalRaceway object, so E-1's SEGMENT_2A
    // graphic prints '6×#10 THWN-2' (gate 2), never the fictitious single #12.
    homerunCurrentCarryingCount: _snapHomerun.present ? (_snapHomerun.currentCarryingCount ?? undefined) : undefined,
    homerunConductorGauge:   _snapHomerun.present ? (_snapHomerun.conductorGauge ?? undefined) : undefined,
    // §8 — legend open-air identity = the listed Q-Cable assembly the sheet draws
    // (micro only). The renderer's SEGMENT-1 label is the SAME assembly string.
    openAirBranchWiringLabel: isMicro
      ? (_snapAsm.present ? _snapAsm.assembly!.wiringMethodLabel
          : /enphase/i.test(inverterMfr) ? 'ENPHASE Q CABLE (TC-ER)' : 'LISTED AC TRUNK CABLE (TC-ER)')
      : undefined,
    // §5 — the BRANCH-side EGCs come from their OWN canonical objects: the
    // `branch-egc` grounding record (NEC 250.122 on the 20 A BRANCH OCPD → #12)
    // and the shared home-run segment's own egcGauge. Previously both printed the
    // FEEDER EGC (#10), so E-1 asserted a separate open-air EGC in a gauge no
    // grounding object or BOM row carried (gate 7).
    branchEgcGauge:          _snapBranchEgc ?? undefined,
    // GROUNDING AUTHORITY (2026-07-25) — SEGMENT-1's open-air grounding line is the
    // OUTCOME of the document-based grounding authority, not an unconditional EGC
    // assertion. PENDING (the live state) prints a pending label; the E-1 note and
    // RS-1 carry the full authority + the blocker.
    openAirBranchEgcLabel: (() => {
      if (!isMicro) return undefined;
      const _g = projectOpenAirBranchGrounding(peekSnapshot(input));
      if (!_g.present) return undefined;
      if (_g.outcome === 'PENDING_MANUFACTURER_AUTHORITY') return 'EGC: PENDING MFR AUTHORITY';
      if (_g.outcome === 'NO_SEPARATE_EGC_REQUIRED') return "NO ADD'L EGC — LISTED METHOD";
      return `1×${(_g.conductorSize ?? '#12 AWG').replace(' AWG', '')} GRN EGC`;
    })(),
    homerunEgcGauge:         (_snapHomerun.present ? (_snapHomerun.egcGauge ?? undefined) : undefined)
                               ?? _snapBranchEgc ?? undefined,
    acOCPD,
    mainPanelAmps:           mainAmps,
    // W2: busbar base + the ENGINE's 120% verdict projected from the snapshot
    // when this adapter runs inside permit generation — the renderer prints,
    // never re-decides. Standalone routes (no snapshot) leave these unset.
    panelBusRating:          (project as { panelBusRating?: number }).panelBusRating ?? mainAmps,
    poiRulePasses:           ((input as unknown as { _snapshot?: { electrical?: { poi?: { rulePasses?: boolean | null } } } })
                               ._snapshot?.electrical?.poi?.rulePasses) ?? undefined,
    backfeedAmps,
    utilityName:             utilityDisplayName(project.utilityName ?? '') || 'Utility',
    interconnection,
    rapidShutdownIntegrated: !!(project.rapidShutdown),
    hasProductionMeter:      project.productionMeter !== false,
    hasBattery,
    batteryModel:            project.batteryModel ?? '',
    batteryKwh:              batteryKwhTotal,
    batteryKwhLabel,
    // Error 5ba fix: compute battery backfeed fallback (20A per unit typical residential)
    batteryBackfeedA:        project.batteryBackfeedA ?? (hasBattery ? (project.batteryCount ?? 1) * 20 : undefined),
    generatorBrand:          project.generatorBrand ?? undefined,
    generatorKw:             project.generatorKw ?? undefined,
    atsBrand:                project.atsBrand ?? undefined,
    atsAmpRating:            project.atsAmpRating ?? undefined,
    scale:                   'NOT TO SCALE',
    // §3 — feeder run length from the canonical segment (same value PV-4B prints).
    acWireLength:            _snapFeed.oneWayFt ?? acWireLength,
    // Real engine results — without these the renderer's fallback schedule
    // fabricated 32% fill / canned voltage drops. §3: voltage drop is the
    // canonical ROUTED value (0.37%), never the legacy flat-length 1.11%.
    acConduitFillPct:        _snapFeed.fillPct ?? compliance.electrical?.conduitFill?.fillPercent ?? undefined,
    acVoltageDropPct:        _snapFeed.voltageDropPct ?? compliance.electrical?.acVoltageDrop ?? undefined,
    // EGC from the shared authority — same value PV-4B prints (prefers the
    // engine groundingConductor, falls back to NEC 250.122 on the governing
    // OCPD). Never re-derive here.
    egcGauge:                _auth.egc.gauge,

    // String-specific
    panelsPerString:         isMicro ? 1 : panelsPerString,
    lastStringPanels:        isMicro ? 1 : lastStringPanels,

    // Micro-specific
    deviceCount,
    microBranches,

    // Topology / MPPT
    mpptChannels:            isMicro ? totalPanels : inv0?.mpptChannels ?? 2,
    mpptAllocation:          isMicro ? `${totalPanels} microinverters` : undefined,
    combinerType:            isMicro ? 'DIRECT' : undefined,
    // Real brand-integrated combiner ("the brains") — same device PV-6/SCHED
    // print — not the old hardcoded 'AC Trunk Cable' label.
    combinerLabel:           isMicro ? (_bosBrains ? `${_bosBrains.brand} ${_bosBrains.model}` : 'IQ Combiner') : undefined,
    combinerModel:           _bosBrains ? `${_bosBrains.brand} ${_bosBrains.model}` : undefined,
    combinerHasIntegratedGateway: _bos.hasIntegratedGateway,
    combinerProvidesAcDisconnect: _bos.providesAcDisconnect,
    ocpdPerString:           isMicro ? 0 : dcOCPD,
    // P1-10 (data-authority register): system.dcAcRatio is the ONE owner —
    // read it, never a third re-derivation. Fallback recompute only when the
    // payload carries no ratio (kept for degraded inputs, same calc the
    // system owner uses).
    dcAcRatio:               system?.dcAcRatio || (totalAcKw > 0 ? calcDcAcRatio(totalDcKw, totalAcKw) : undefined),

    // Design temperatures — ASHRAE state-envelope lookup (designTemps.ts).
    // An explicit project.designTempMin (AHJ override) wins; otherwise the
    // ASHRAE extreme low drives the NEC 690.7(A) Voc correction (the old
    // flat -10 default understated corrected Voc for the Midwest).
    designTempMin:           project.designTempMin ?? _temps.ashraeExtremeLowC,
    designTemps:             _temps,
  };

  // ── Wave 5 Lane A — hybrid source lanes (I-8: E-1 at N>1 renders the REAL
  // multi-lane diagram, never the single-lane fallback). SOURCE OF TRUTH:
  // conductorAuthority.subSystems (see buildSourceBranchesFromAuthority).
  const _sources = buildSourceBranchesFromAuthority(_auth, input);
  if (_sources && _sources.length > 1) {
    sldInput.sources = _sources;
    // On the hybrid multi-lane path the TOP-LEVEL inverter fields are a title-
    // block summary only — each lane renders (and fail-louds) its OWN inverter.
    // getEquipmentContext has no single project-wide winner for a hybrid, so it
    // returns '—' and line ~62 turned that into a per-ROOF "not selected" marker.
    // That is a FALSE alarm at the summary level (the lanes are the authority),
    // so neutralize it — but keep any REAL resolved summary model as-is.
    if (isInverterUnselectedMarker(sldInput.inverterModel)) {
      sldInput.inverterModel = 'PER ARRAY — SEE SCHEDULE';
      sldInput.inverterManufacturer = '';
    }
    // Multi-lane contract: backfeedAmps = authoritative TOTAL = Σ per-lane
    // per-physical-inverter rounded OCPDs + battery bus impact (§1.7). The
    // stored project.backfeedBreakerA is a single-system figure and must not
    // undercount a hybrid's summed 120% panel.
    sldInput.backfeedAmps =
      _sources.reduce((s, b) => s + (b.backfeedAmps ?? 0), 0) +
      (sldInput.hasBattery ? (sldInput.batteryBackfeedA ?? 0) : 0);
  }
  return sldInput;
}

// ═════════════════════════════════════════════════════════════════════════════
// Wave 5 Lane A — SLDSourceBranch builders
//
// PERMIT PATH — SOURCE OF TRUTH DECISION (contract deliverable): branches are
// built from `buildConductorAuthority(input, cad).subSystems`, NOT re-derived
// from tagged inverters or cad.hybrid.sections directly. Rationale: the
// authority is already the ONE shared derivation PV-4A/PV-4B/SCHED/BOM/E-1
// read (its own inputs are the panel stamps, tagged inverters and CAD hybrid
// sections, §1.1 hierarchy) — a second independent derivation here would
// reintroduce the EL-2/EL-4 divergence class this campaign exists to kill.
// The only value the authority does not carry is the §1.7 per-physical-
// inverter backfeed sum for string/optimizer subs; that is computed from the
// SAME tagged inverter list the authority consumed (identical tag rule).
// ═════════════════════════════════════════════════════════════════════════════

const _AUTH_TOPO_TO_SLD: Record<string, string> = {
  MICRO: 'MICROINVERTER',
  OPTIMIZER: 'STRING_WITH_OPTIMIZER',
  STRING: 'STRING_INVERTER',
};

/** §1.7 breaker-granularity rule — one sub's backfeed contribution equals its
 *  PHYSICAL breaker schedule: Σ nextStandardOCPD(perInverterAmps × 1.25) over
 *  the sub's own tagged inverters (micro subs: the combiner feeder OCPD). */
function subBackfeedFromInverters(
  sub: SubSystemConductorAuthority,
  inverters: Array<{ subSystemKey?: string; acOutputKw?: number; type?: string }>,
  primaryKey: SubSystemKey,
): number | undefined {
  if (sub.isMicro) return sub.acSubFeeder.ocpdAmps ?? undefined;
  const own = inverters.filter(inv =>
    (isSubSystemKey(inv?.subSystemKey) ? inv.subSystemKey : primaryKey) === sub.key
    && String(inv?.type ?? '').toLowerCase() !== 'micro');
  let sum = 0;
  for (const inv of own) {
    const kw = Number(inv.acOutputKw) || 0;
    if (kw <= 0) continue;
    sum += necNextStandardOcpd(((kw * 1000) / 240) * 1.25) || 0;
  }
  return sum > 0 ? sum : (sub.acSubFeeder.ocpdAmps ?? undefined);
}

/**
 * Permit-path builder: ConductorAuthority.subSystems → SLDSourceBranch[].
 * Returns undefined for single-system inputs (legacy renderer path, I-1).
 */
export function buildSourceBranchesFromAuthority(
  auth: ConductorAuthority,
  input: PermitInput,
): SLDSourceBranch[] | undefined {
  if (!auth.isHybrid || auth.subSystems.length < 2) return undefined;
  const inverters = ((input.system?.inverters ?? []) as Array<{ subSystemKey?: string; acOutputKw?: number; type?: string }>);
  const primaryKey = auth.subSystems[0].key;

  return auth.subSystems.map((sub): SLDSourceBranch => {
    const eq = sub.equipment;
    const panelModel = eq.panelModel && eq.panelModel !== '—'
      ? eq.panelModel
      : (eq.panelWatts ? `${eq.panelWatts}W Module` : 'PV Module');
    const acKw = (sub.acSubFeeder.currentA * 240) / 1000;
    const dcOcpds = sub.dcStrings.map(s => s.ocpdAmps ?? 0).filter(n => n > 0);
    // P1-2: per-lane EGC values carried FROM the authority so the renderer
    // consumes instead of re-deriving. Branch EGC = the governing (max-OCPD)
    // micro branch's own NEC 250.122 result; DC EGC = 250.122 on the lane's
    // governing DC string OCPD — derived HERE (adapter boundary), never in
    // the renderer.
    const _govBranch = sub.microBranches.length
      ? sub.microBranches.reduce((a, b) => (b.ocpdAmps > a.ocpdAmps ? b : a))
      : undefined;
    return {
      key: sub.key,
      label: `${sub.key.toUpperCase()} — ${sub.panelCount} × ${panelModel}`,
      topologyType: _AUTH_TOPO_TO_SLD[sub.topology] ?? 'STRING_INVERTER',
      systemType: sub.key,
      totalModules: sub.panelCount,
      totalStrings: sub.isMicro ? 0 : (sub.dcStrings.length || 1),
      panelModel,
      panelWatts: eq.panelWatts || undefined,
      panelVoc: eq.panelVoc || undefined,
      panelIsc: eq.panelIsc || undefined,
      inverterManufacturer: eq.inverterManufacturer !== '—' ? eq.inverterManufacturer : '',
      // FAIL-LOUD: per-sub unselected inverter → red '⚠ INVERTER NOT SELECTED —
      // PV-<KEY>' marker instead of a fabricated 'Inverter' default.
      inverterModel: eq.inverterModel !== '—' ? eq.inverterModel : unselectedInverterLabel(sub.key),
      inverterCount: sub.isMicro ? undefined : Math.max(1,
        inverters.filter(inv => (isSubSystemKey(inv?.subSystemKey) ? inv.subSystemKey : primaryKey) === sub.key).length),
      acKwPerDevice: eq.inverterAcOutputKw || undefined,
      acOutputKw: acKw > 0 ? Math.round(acKw * 100) / 100 : undefined,
      acOutputAmps: sub.acSubFeeder.currentA > 0 ? Math.round(sub.acSubFeeder.currentA * 100) / 100 : undefined,
      acWireGauge: sub.acSubFeeder.wireGauge,
      acOCPD: sub.acSubFeeder.ocpdAmps ?? undefined,
      // Per-sub EGC — the authority's own NEC 250.122 result (governed by the
      // sub's AC feeder OCPD), same value the E-1 SOURCE SUMMARY prints.
      egcGauge: sub.egc.gauge,
      branchEgcGauge: _govBranch?.egcGauge,
      dcEgcGauge: dcOcpds.length ? getEGCSize(Math.max(...dcOcpds)) : undefined,
      // Voc temp coefficient from the equipment DB (for the NEC 690.7(A)
      // corrected-voltage table); absent ⇒ marked assumption on the sheet.
      panelTempCoeffVoc: panelTempCoeffByModel(eq.panelModel),
      backfeedAmps: subBackfeedFromInverters(sub, inverters, primaryKey),
      dcOCPD: dcOcpds.length ? Math.max(...dcOcpds) : undefined,
      // No external DC disconnect when the inverter integrates one (per its
      // datasheet — Solis/EcoFlow/most modern string+hybrid units) OR for
      // optimizer topology (the inverter carries the DC means). Data-driven
      // from the resolved equipment, not a per-brand special case.
      integratedDcDisconnect:
        (sub.topology === 'OPTIMIZER' || eq.inverterIntegratedDcDisconnect === true) || undefined,
      optimizerQty: sub.topology === 'OPTIMIZER' ? sub.panelCount : undefined,
      rapidShutdownIntegrated: sub.key === 'roof' ? !!(input.project as { rapidShutdown?: boolean })?.rapidShutdown : false,
      deviceCount: sub.isMicro ? sub.deviceCount : undefined,
      microBranches: sub.isMicro
        ? sub.microBranches.map(b => ({
            branchIndex: b.index,
            deviceCount: b.deviceCount,
            branchCurrentA: b.branchCurrentA,
            ocpdAmps: b.ocpdAmps,
            conductorCallout: b.conductorCallout,
            necReference: 'NEC 690.8(B)',
          }))
        : undefined,
    };
  });
}

/**
 * Wave 6 (Stage D) — resolve the hybrid AC-collection plan for the permit BOM /
 * Equipment Schedule from the SAME lanes E-1 draws. Returns the per-source
 * combiners, the ONE shared AC combiner panel every source lands on, and the
 * ONE system disconnect — so the BOM lists exactly what the SLD shows.
 * Returns null for single-system inputs (no shared panel; the legacy per-system
 * combiner/disconnect lines already cover them, byte-identical).
 */
export function buildHybridAcCollection(
  input: PermitInput,
  cad?: CADModel | null,
): HybridAcCollectionPlan | null {
  const auth = buildConductorAuthority(input, cad ?? undefined);
  const lanes = buildSourceBranchesFromAuthority(auth, input);
  if (!lanes || lanes.length < 2) return null;
  return acCollectionFromLanes(lanes);
}

// ─── PAGE PATH — computedMulti.subSystems → SLDSourceBranch[] ────────────────

/** Structural slice of ComputedMultiSystem the page-path builder needs
 *  (lib/computed-multi-system.ts is owned by Wave 2a — import types only). */
export interface ComputedMultiSourceView {
  subSystemKeys: SubSystemKey[];
  subSystems: Partial<Record<SubSystemKey, ComputedSystem>>;
}

/**
 * Page-path builder: one branch per computed sub-system. Subs with no
 * ComputedSystem or zero panels are SKIPPED (a present-but-empty sub must
 * never become a phantom lane); <2 usable lanes ⇒ undefined, and the page
 * keeps the hybrid banner as the fallback (I-8).
 */
export function buildSourceBranchesFromComputedMulti(
  multi: ComputedMultiSourceView,
  // §1.1 equipment-authority map (config.subSystems). When the computed
  // per-sub `inverterSpec` is null (the compute engine didn't resolve the
  // sub's inverter), fall back to the sub's OWN map inverterId — the SAME
  // authority the permit E-1 resolves through — so a hybrid lane never
  // renders "INVERTER NOT SELECTED" while the map holds a real inverter.
  subMap?: Partial<Record<SubSystemKey, { inverterId?: string; topology?: string; panelId?: string }>>,
): SLDSourceBranch[] | undefined {
  const branches: SLDSourceBranch[] = [];
  for (const key of multi.subSystemKeys) {
    const cs = multi.subSystems[key];
    if (!cs || !(cs.totalPanels > 0)) continue;
    // Map-authority equipment fallback (used only when the computed spec is absent).
    const _mapId = subMap?.[key]?.inverterId;
    const _mapMicro = _mapId ? getMicroinverterById(_mapId) : undefined;
    const _mapStr = (!_mapMicro && _mapId) ? getInverterById(_mapId) : undefined;
    const _mapInv = (_mapMicro ?? _mapStr) as { manufacturer?: string; model?: string; integratedDcDisconnect?: boolean } | undefined;
    const _mapTopo = subMap?.[key]?.topology;
    const _isMicro   = cs.inverterSpec ? cs.isMicro     : (!!_mapMicro || _mapTopo === 'micro');
    const _isOpt     = cs.inverterSpec ? cs.isOptimizer : (_mapTopo === 'optimizer');
    const _invMfr    = cs.inverterSpec?.manufacturer ?? _mapInv?.manufacturer ?? '';
    const _invModel  = cs.inverterSpec?.model ?? _mapInv?.model ?? unselectedInverterLabel(key);
    const _integDc   = cs.inverterSpec ? (cs.isOptimizer || undefined)
                                       : (((_mapStr as any)?.integratedDcDisconnect === true) || _mapTopo === 'optimizer' || undefined);
    const feeder: RunSegment | undefined = cs.runs?.find(r =>
      String(r.id) === (cs.isMicro ? 'COMBINER_TO_DISCO_RUN' : 'INV_TO_DISCO_RUN'));
    const panelModel = cs.panelSpec
      ? `${cs.panelSpec.manufacturer} ${cs.panelSpec.model}`.trim()
      : (cs.panelSpec === null && cs.totalDcKw > 0 && cs.totalPanels > 0
          ? `${Math.round((cs.totalDcKw * 1000) / cs.totalPanels)}W Module`
          : 'PV Module');
    branches.push({
      key,
      label: `${key.toUpperCase()} — ${cs.totalPanels} × ${panelModel}`,
      topologyType: _isMicro ? 'MICROINVERTER' : _isOpt ? 'STRING_WITH_OPTIMIZER' : 'STRING_INVERTER',
      systemType: key,
      totalModules: cs.totalPanels,
      totalStrings: _isMicro ? 0 : cs.stringCount,
      panelsPerString: _isMicro ? undefined : cs.panelsPerString,
      panelModel,
      panelWatts: cs.panelSpec?.panelWatts
        ?? (cs.totalPanels > 0 ? Math.round((cs.totalDcKw * 1000) / cs.totalPanels) : undefined),
      panelVoc: cs.panelSpec?.panelVoc,
      panelIsc: cs.panelSpec?.panelIsc,
      inverterManufacturer: _invMfr,
      // Resolves through the §1.1 map authority before the fail-loud marker.
      inverterModel: _invModel,
      acKwPerDevice: _isMicro && cs.microDeviceCount > 0
        ? Math.round((cs.totalAcKw / cs.microDeviceCount) * 1000) / 1000
        : cs.inverterSpec?.acOutput?.ratedKw,
      acOutputKw: cs.totalAcKw,
      acOutputAmps: Math.round(cs.acOutputCurrentA * 100) / 100,
      acWireGauge: feeder?.wireGauge,
      acConduitType: feeder && !feeder.isOpenAir ? feeder.conduitType : undefined,
      acOCPD: cs.acOcpdAmps || undefined,
      panelTempCoeffVoc: cs.panelSpec?.tempCoeffVoc,
      // Per-sub engine backfeed (per-inverter OCPDs + the sub's own battery
      // impact). The POI total comes from the AGGREGATE via input.backfeedAmps
      // — lanes only display their contribution.
      backfeedAmps: cs.backfeedBreakerAmps || undefined,
      dcOCPD: _isMicro ? undefined : (cs.strings?.[0]?.ocpdAmps || undefined),
      integratedDcDisconnect: _integDc,
      optimizerQty: _isOpt ? cs.totalPanels : undefined,
      rapidShutdownIntegrated: key === 'roof' ? undefined : false,
      deviceCount: _isMicro ? cs.microDeviceCount : undefined,
      microBranches: _isMicro ? cs.microBranches : undefined,
      runs: cs.runs,
    });
  }
  return branches.length > 1 ? branches : undefined;
}

// ─── Route-side client-payload sanitation (sld + sld/pdf routes) ─────────────

/**
 * Wave 5A — validate an untrusted client `sources` payload. Coerces every
 * field the multi-lane renderer consumes; invalid/duplicate keys are dropped
 * and lanes come back in fixed roof > ground > fence order
 * (normalizeSourceBranches). Returns undefined below 2 usable lanes — the
 * caller then takes the legacy single-lane path.
 */
export function sanitizeClientSourceBranches(raw: unknown): SLDSourceBranch[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const num = (v: unknown): number | undefined => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim() ? String(v) : undefined;
  const coerced = raw.map((b: any): SLDSourceBranch => ({
    key: b?.key,
    label: str(b?.label),
    topologyType: str(b?.topologyType),
    systemType: b?.systemType === 'roof' || b?.systemType === 'ground' || b?.systemType === 'fence' ? b.systemType : undefined,
    totalModules: num(b?.totalModules),
    totalStrings: num(b?.totalStrings),
    panelsPerString: num(b?.panelsPerString),
    panelModel: str(b?.panelModel),
    panelWatts: num(b?.panelWatts),
    panelVoc: num(b?.panelVoc),
    panelIsc: num(b?.panelIsc),
    inverterManufacturer: str(b?.inverterManufacturer),
    inverterModel: str(b?.inverterModel),
    inverterCount: num(b?.inverterCount),
    acKwPerDevice: num(b?.acKwPerDevice),
    acOutputKw: num(b?.acOutputKw),
    acOutputAmps: num(b?.acOutputAmps),
    acWireGauge: str(b?.acWireGauge),
    acConduitType: str(b?.acConduitType),
    acOCPD: num(b?.acOCPD),
    backfeedAmps: num(b?.backfeedAmps),
    dcOCPD: num(b?.dcOCPD),
    integratedDcDisconnect: b?.integratedDcDisconnect === true || undefined,
    egcGauge: str(b?.egcGauge),
    branchEgcGauge: str(b?.branchEgcGauge),
    dcEgcGauge: str(b?.dcEgcGauge),
    // Signed: Voc temp coefficients are NEGATIVE — num() (≥0 only) would drop them.
    panelTempCoeffVoc: Number.isFinite(Number(b?.panelTempCoeffVoc)) ? Number(b?.panelTempCoeffVoc) : undefined,
    optimizerQty: num(b?.optimizerQty),
    optimizerModel: str(b?.optimizerModel),
    combinerLabel: str(b?.combinerLabel),
    disconnectLabel: str(b?.disconnectLabel),
    rapidShutdownIntegrated: typeof b?.rapidShutdownIntegrated === 'boolean' ? b.rapidShutdownIntegrated : undefined,
    deviceCount: num(b?.deviceCount),
    microBranches: Array.isArray(b?.microBranches) ? b.microBranches : undefined,
    runs: Array.isArray(b?.runs) ? b.runs.filter((r: any) => r && typeof r.id === 'string') : undefined,
  }));
  const lanes = normalizeSourceBranches(coerced);
  return lanes.length > 1 ? lanes : undefined;
}

// ─── W4B must-fix support (app/engineering/page.tsx) ─────────────────────────

/**
 * Synthesize a minimal one-inverter fleet for a PRESENT sub whose partitioned
 * fleet is EMPTY, from the sub's own SubSystemEquipment record — so the sub
 * computes with ITS OWN equipment instead of a phantom default (the Wave-4B.D
 * SE7600H class). Returns null when the record carries no inverterId (the
 * caller must then EXCLUDE the sub from aggregate numbers and surface a
 * visible per-sub hint — never compute a made-up inverter).
 */
export function synthesizeFleetFromSubEquipment(
  key: SubSystemKey,
  sub: { inverterId?: string; topology?: string; panelId?: string } | undefined,
  panelCount: number,
): Array<{
  id: string; inverterId: string; type: string; subSystemKey: SubSystemKey;
  strings: Array<{ id: string; label: string; panelCount: number; panelId: string; subSystemKey: SubSystemKey }>;
}> | null {
  if (!sub?.inverterId || !(panelCount > 0)) return null;
  const t = String(sub.topology ?? '').toLowerCase();
  const type = ['micro', 'string', 'optimizer', 'hybrid', 'ecoflow'].includes(t) ? t : 'string';
  return [{
    id: `synth-${key}`,
    inverterId: sub.inverterId,
    type,
    subSystemKey: key,
    strings: [{
      id: `synth-${key}-s1`,
      label: `${key} panels`,
      panelCount,
      panelId: sub.panelId ?? '',
      subSystemKey: key,
    }],
  }];
}

/**
 * Generate a live professional SLD SVG from PermitInput.
 * Pure data binding: PermitInput → SLDProfessionalInput → renderSLDProfessional()
 * `embedded` = rendering inside a planset sheet that has its own title block —
 * suppresses the SLD's internal SOLARPRO title panel (pure duplication on E-1).
 */
export function generateLiveSLD(input: PermitInput, cad?: CADModel | null, opts?: { embedded?: boolean }): string {
  const sldInput = buildSLDInputFromPermit(input, cad);
  if (opts?.embedded) {
    sldInput.suppressTitleBlock = true;
    // E-1 repair (post-AAC): the in-SVG conductor-schedule band re-derived the
    // canonical physical sections that render once on PV-4B.1 — suppress it and
    // crop the canvas so the schematic fills E-1's drawing wrapper.
    sldInput.suppressScheduleBand = true;
  }
  return renderSLDProfessional(sldInput);
}