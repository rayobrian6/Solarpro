// ═══════════════════════════════════════════════════════════════
// SLD Adapter — Maps PermitInput → SLDProfessionalInput
// DATA BINDING ONLY — no logic changes, no new calculations
// ═══════════════════════════════════════════════════════════════

import type { PermitInput } from '../types';
import type { CADModel } from '@/lib/cad/types';
import { renderSLDProfessional, type SLDProfessionalInput } from '@/lib/sld-professional-renderer';
import { utilityDisplayName, interconnectionLabel, necNextStandardOcpd } from './helpers';
import { getEquipmentContext, getInverterTopology, topologyToLegacy } from '@/lib/system';
import { calcDcAcRatio } from '@/lib/system/calcDcAcRatio';

/**
 * Build a live SLDProfessionalInput from PermitInput canonical data.
 * Uses systemAccessors (prefers SystemDefinition, falls back to legacy resolvers).
 * Does NOT call computeSystem() — all values sourced from PermitInput fields.
 */
export function buildSLDInputFromPermit(input: PermitInput, cad?: CADModel | null): SLDProfessionalInput {
  const { project, system, compliance } = input;

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
  const acOutputKw   = eq.inverterAcOutputKw || totalAcKw;
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
  const acWireGauge  = compliance.electrical?.acConductorCallout ?? project.wireGauge ?? '#10 AWG';
  const dcWireGauge  = compliance.electrical?.dcConductorCallout ?? '#10 AWG';
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
  const hasBattery = !!(project.batteryCount && project.batteryCount > 0) || !!(project.batteryModel);
  const batteryKwh = hasBattery ? ((project.batteryCount || 1) * (project.batteryKwh ?? 5.0)) : 0;

  // ── Micro-specific ──
  const deviceCount = isMicro ? totalPanels : undefined;
  const nBranches = isMicro ? Math.ceil(totalPanels / 16) : undefined;

  // ── DC OCPD (string topology only) ──
  // Error 5b fix: ocpd IS declared on string type — no need for `as any`
  const dcOCPD = isMicro ? 0 : strings[0]?.ocpd ?? 20;

  return {
    projectName:             project.projectName ?? 'Solar PV System',
    clientName:              project.clientName ?? 'Homeowner',
    address:                 project.address ?? '',
    designer:                project.designer ?? 'SolarPro Engineering',
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
    batteryKwh,
    // Error 5ba fix: compute battery backfeed fallback (20A per unit typical residential)
    batteryBackfeedA:        project.batteryBackfeedA ?? (hasBattery ? (project.batteryCount ?? 1) * 20 : undefined),
    generatorBrand:          project.generatorBrand ?? undefined,
    generatorKw:             project.generatorKw ?? undefined,
    atsBrand:                project.atsBrand ?? undefined,
    atsAmpRating:            project.atsAmpRating ?? undefined,
    scale:                   'NOT TO SCALE',
    acWireLength,

    // String-specific
    panelsPerString:         isMicro ? 1 : panelsPerString,
    lastStringPanels:        isMicro ? 1 : lastStringPanels,

    // Micro-specific
    deviceCount,

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
 */
export function generateLiveSLD(input: PermitInput, cad?: CADModel | null): string {
  const sldInput = buildSLDInputFromPermit(input, cad);
  return renderSLDProfessional(sldInput);
}