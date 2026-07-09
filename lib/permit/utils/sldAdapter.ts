// ═══════════════════════════════════════════════════════════════
// SLD Adapter — Maps PermitInput → SLDProfessionalInput
// DATA BINDING ONLY — no logic changes, no new calculations
// ═══════════════════════════════════════════════════════════════

import type { PermitInput } from '../types';
import type { CADModel } from '@/lib/cad/types';
import { renderSLDProfessional, type SLDProfessionalInput } from '@/lib/sld-professional-renderer';
import { utilityDisplayName, interconnectionLabel, necNextStandardOcpd, hasRealBattery } from './helpers';
import { getEquipmentContext, getInverterTopology, topologyToLegacy } from '@/lib/system';
import { calcDcAcRatio } from '@/lib/system/calcDcAcRatio';
import { buildConductorAuthority } from './conductorAuthority';

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

  // ── Equipment resolution (same 4-source priority as all planset pages) ──
  const eq = getEquipmentContext(input, cad);
  const topology = topologyToLegacy(getInverterTopology(input, cad));
  const isMicro = topology === 'MICRO';

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
  const inverterModel = eq.inverterModel !== '—' ? eq.inverterModel : 'Inverter';
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
  const microBranches = isMicro ? _auth.microBranches.map((b) => ({
    branchIndex: b.index,
    deviceCount: b.deviceCount,
    branchCurrentA: b.branchCurrentA,
    ocpdAmps: b.ocpdAmps,
    conductorCallout: `${b.wireGauge} THWN-2`,
    necReference: 'NEC 690.8(B)',
  })) : undefined;

  // ── DC OCPD (string topology only) ──
  // Error 5b fix: ocpd IS declared on string type — no need for `as any`
  const dcOCPD = isMicro ? 0 : strings[0]?.ocpd ?? 20;

  return {
    projectName:             project.projectName ?? 'Solar PV System',
    clientName:              project.clientName ?? 'Homeowner',
    address:                 project.address ?? '',
    designer:                project.designer ?? '',
    drawingDate:             project.date ?? new Date().toLocaleDateString(),
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
    acConduitType:           project.conduitType ?? 'EMT',
    acOCPD,
    mainPanelAmps:           mainAmps,
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
    acWireLength,
    // Real engine results — without these the renderer's fallback schedule
    // fabricated 32% fill / canned voltage drops.
    acConduitFillPct:        compliance.electrical?.conduitFill?.fillPercent ?? undefined,
    acVoltageDropPct:        compliance.electrical?.acVoltageDrop ?? undefined,
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
    combinerLabel:           isMicro ? 'AC Trunk Cable' : undefined,
    ocpdPerString:           isMicro ? 0 : dcOCPD,
    dcAcRatio:               totalAcKw > 0 ? calcDcAcRatio(totalDcKw, totalAcKw) : undefined,

    // Design temperature (if available from AHJ data)
    designTempMin:           project.designTempMin ?? -10,
  };
}

/**
 * Generate a live professional SLD SVG from PermitInput.
 * Pure data binding: PermitInput → SLDProfessionalInput → renderSLDProfessional()
 * `embedded` = rendering inside a planset sheet that has its own title block —
 * suppresses the SLD's internal SOLARPRO title panel (pure duplication on E-1).
 */
export function generateLiveSLD(input: PermitInput, cad?: CADModel | null, opts?: { embedded?: boolean }): string {
  const sldInput = buildSLDInputFromPermit(input, cad);
  if (opts?.embedded) sldInput.suppressTitleBlock = true;
  return renderSLDProfessional(sldInput);
}