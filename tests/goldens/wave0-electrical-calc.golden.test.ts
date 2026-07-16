// ============================================================================
// Wave 0 regression bar — see docs/ARCHITECTURE-per-subsystem-equipment.md
// (§3 Wave 0, Invariant I-1; Wave 2b touches lib/electrical-calc.ts).
//
// Pins runElectricalCalc on a legacy single-system string input: overall
// status, AC wire gauge, OCPD chain (Steps 1–7), and the 705.12(B) busbar /
// backfeed numbers. Wave 2b's AC-helper extraction and per-inverter-rounded
// summed backfeed must leave every one of these unchanged on the N=1 path.
// Snapshots live in tests/goldens/__snapshots__/ and are committed.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { runElectricalCalc } from '../../lib/electrical-calc';
import { ecStringInput, r6 } from './wave0-fixtures';

describe('Wave 0 golden — electrical-calc legacy STRING parity numbers', () => {
  const res = runElectricalCalc(ecStringInput());

  it('status / acWireGauge / OCPD / backfeed match the pre-contract snapshot', () => {
    expect({
      status: res.status,
      acWireGauge: res.acWireGauge,
      acWireAmpacity: res.acWireAmpacity,
      acConductorCallout: res.acConductorCallout,
      groundingConductor: res.groundingConductor,
      acSizing: {
        acCurrentAmps: r6(res.acSizing.acCurrentAmps),
        continuousCurrentAmps: r6(res.acSizing.continuousCurrentAmps),
        ocpdAmps: res.acSizing.ocpdAmps,
        disconnectAmps: res.acSizing.disconnectAmps,
        disconnectType: res.acSizing.disconnectType,
        fuseAmps: res.acSizing.fuseAmps,
        conductorGauge: res.acSizing.conductorGauge,
        conductorAmpacity: res.acSizing.conductorAmpacity,
        conduitSize: res.acSizing.conduitSize,
      },
      busbar: {
        mainPanelAmps: res.busbar.mainPanelAmps,
        totalAcOutputAmps: r6(res.busbar.totalAcOutputAmps),
        backfeedBreakerRequired: res.busbar.backfeedBreakerRequired,
        busbarRule: res.busbar.busbarRule,
        maxAllowedBackfeed: r6(res.busbar.maxAllowedBackfeed),
        passes: res.busbar.passes,
      },
      engineeringModel: {
        ocpd: res.acSizing.engineeringModel.ocpd,
        disconnectRating: res.acSizing.engineeringModel.disconnectRating,
        disconnectType: res.acSizing.engineeringModel.disconnectType,
        conductor: res.acSizing.engineeringModel.conductor,
        inverterCount: res.acSizing.engineeringModel.inverterCount,
        totalAcKw: r6(res.acSizing.engineeringModel.totalAcKw),
        perInverterAcKw: r6(res.acSizing.engineeringModel.perInverterAcKw),
        perInverterDisconnectAmps: res.acSizing.engineeringModel.perInverterDisconnectAmps,
      },
      summary: {
        totalDcKw: r6(res.summary.totalDcKw),
        totalAcKw: r6(res.summary.totalAcKw),
        totalPanels: res.summary.totalPanels,
      },
      errorCodes: res.errors.map(e => e.code),
      interconnectionMethod: res.interconnection?.method,
    }).toMatchSnapshot();
  });

  it('per-string DC numbers (690.7 Voc chain + OCPD) match the pre-contract snapshot', () => {
    expect(res.inverters.map(inv => ({
      type: inv.type,
      dcVoltageOk: inv.dcVoltageOk,
      mpptRangeOk: inv.mpptRangeOk,
      strings: inv.strings.map(s => ({
        panelCount: s.panelCount,
        vocWorstCase: r6(s.vocWorstCase),
        maxCurrentNEC: r6(s.maxCurrentNEC),
        ocpdRating: s.ocpdRating,
        wireGauge: s.wireGauge,
      })),
    }))).toMatchSnapshot();
  });
});
