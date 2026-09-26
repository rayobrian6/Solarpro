// ═══════════════════════════════════════════════════════════════════════════
// ONE COMPOSER FOR "WHAT DOES THIS DESIGN METER, AND WHERE ARE ITS CTs".
//
// Ray, 2026-09-25: "there is no ct logic whatsoever."
//
// The CT authority (currentTransformers.ts) could always tell a production CT
// from a consumption CT and Net from Total — but nothing ever told it where the
// consumption CTs clamp, so every Enphase job resolved INDETERMINATE and printed
// "CONS (MODE TBD)", and five call sites (the SLD route, the SLD PDF export, the
// permit E-1 adapter, the PV-4A note and the BOM) each composed that answer on
// their own. Nothing drew a CT.
//
// Every consumer now calls THIS, with the same inputs, and gets:
//   · the resolution (the BOM buys from it; PV-4A states it),
//   · the schedule cell and the "Consumption CTs" row,
//   · the placement — recorded by the designer, or the documented default for
//     the interconnection already chosen, and SAID to be a default,
//   · a drawing description the renderer draws verbatim and never re-derives.
//
// Pure: no DB, no network, safe on the client (the engineering page shows the
// same answer beside the control that changes it).
// ═══════════════════════════════════════════════════════════════════════════

import {
  resolveMeteringRequirement,
  meteringScheduleValue,
  ungroundedConductorsForService,
  pvConnectionSide,
  parseConsumptionCtLocation,
  defaultConsumptionCtLocation,
  consumptionCtBoundaryFor,
  type ConsumptionCtLocation,
  type ConsumptionMeteringMode,
  type DeviceMeteringCapability,
  type MeasurementBoundary,
  type MeteringRealisation,
  type MeteringResolution,
} from '@/lib/equipment/currentTransformers';

/** The slice of an IntegratedEquipmentPlan this needs (structural, so this
 *  module imports no catalogue and cannot form a cycle). */
export interface MeteringPlanLike {
  brains?: { brand?: string; model: string; metering?: DeviceMeteringCapability } | null;
  hasIntegratedGateway: boolean;
}

export interface DesignMeteringInput {
  plan: MeteringPlanLike | null | undefined;
  /** The design's interconnection, in whatever spelling it uses. */
  interconnectionRaw: string | null | undefined;
  /** The designer's recorded CT location ('' / absent ⇒ interconnection default). */
  consumptionCtLocation?: string | null;
  /** Service voltage at the measurement point (split-phase 240 V ⇒ 2 CTs). */
  systemVoltage?: number | null;
  /** When the caller already knows the ungrounded-conductor count (or knows it
   *  is UNRESOLVED — null), it wins over the voltage table. */
  ungroundedConductorCount?: number | null;
}

/** What the SLD draws. Read-only for the renderer: it decides nothing. */
export interface SldMeteringDrawing {
  production: {
    realisation: MeteringRealisation;
    /** integral to the combiner, or field-installed on the PV output circuit. */
    where: 'combiner-integral' | 'pv-output-circuit-field';
    label: string;
  } | null;
  consumption: {
    ctCount: number | null;
    location: ConsumptionCtLocation;
    mode: ConsumptionMeteringMode;
    supplied: 'in-box' | 'order-separately';
    /** e.g. "CT ×2 (L1, L2) — CONSUMPTION — LOAD ONLY (TOTAL)". */
    label: string;
    /** "DEFAULT PER INTERCONNECTION — FIELD VERIFY" | "RECORDED BY DESIGNER". */
    basisLabel: string;
  } | null;
  /** The CT secondary leads back to the gateway. */
  lead: { toDeviceLabel: string; label: string } | null;
  /** The equipment-schedule "Consumption CTs" value. */
  scheduleRow: string | null;
}

export interface DesignMetering {
  /** null ⇔ no metering device is modelled (nothing is asserted). */
  resolution: MeteringResolution | null;
  /** the schedule's "Metering" cell. undefined ⇔ nothing modelled. */
  scheduleValue: string | undefined;
  placement: {
    location: ConsumptionCtLocation | null;
    basis: 'designer-recorded' | 'interconnection-default' | 'unresolved';
    boundary: MeasurementBoundary;
  };
  drawing: SldMeteringDrawing | null;
  /** PV-4A prose, one sentence. '' when nothing is modelled. */
  placementNote: string;
  /** When a SKU blocker occupies the resolution's single blocker slot, the
   *  placement refusal it would hide — so PV-4A can state both. */
  topologyBlockerMessage: string | null;
}

const LOCATION_PROSE: Record<ConsumptionCtLocation, string> = {
  'sec-line-side-of-main': 'the service-entrance conductors, line side of the main breaker',
  'between-tap-and-main': 'the service conductors between the NEC 705.11 supply-side tap and the main breaker',
  'main-breaker-load-side': 'the main breaker load-side conductors (main → bus)',
};

const LOCATION_SHORT: Record<ConsumptionCtLocation, string> = {
  'sec-line-side-of-main': 'SVC, LINE SIDE OF MAIN',
  'between-tap-and-main': 'TAP → MAIN',
  'main-breaker-load-side': 'MAIN → BUS',
};

/** Human label for a location — the engineering page's dropdown uses it. */
export function consumptionCtLocationLabel(loc: ConsumptionCtLocation): string {
  return {
    'sec-line-side-of-main': 'Service conductors, line side of main (meter → main)',
    'between-tap-and-main': 'Between supply-side tap and main breaker',
    'main-breaker-load-side': 'Main breaker load side (main → bus)',
  }[loc];
}

const MODE_LABEL: Record<ConsumptionMeteringMode, string> = {
  LOAD_WITH_SOLAR: 'LOAD WITH SOLAR (NET)',
  LOAD_ONLY: 'LOAD ONLY (TOTAL)',
  INDETERMINATE: 'MODE INDETERMINATE — SEE NOTES',
};

const MODE_PROSE: Record<ConsumptionMeteringMode, string> = {
  LOAD_WITH_SOLAR: 'Net ("Load with Solar")',
  LOAD_ONLY: 'Total ("Load only")',
  INDETERMINATE: 'INDETERMINATE',
};

const EMPTY: DesignMetering = {
  resolution: null,
  scheduleValue: undefined,
  placement: { location: null, basis: 'unresolved', boundary: 'unresolved' },
  drawing: null,
  placementNote: '',
  topologyBlockerMessage: null,
};

export function resolveDesignMetering(input: DesignMeteringInput): DesignMetering {
  const plan = input.plan;
  const cap = plan?.brains?.metering;
  if (!plan || !cap) return EMPTY;

  const deviceLabel = plan.brains?.model ?? null;
  const side = pvConnectionSide(input.interconnectionRaw);
  const recorded = parseConsumptionCtLocation(input.consumptionCtLocation);
  const location = recorded ?? defaultConsumptionCtLocation(side);
  const basis: DesignMetering['placement']['basis'] =
    recorded ? 'designer-recorded' : location ? 'interconnection-default' : 'unresolved';
  const boundary = consumptionCtBoundaryFor(location, side);
  const ctCount = input.ungroundedConductorCount !== undefined
    ? input.ungroundedConductorCount
    : ungroundedConductorsForService(input.systemVoltage ?? 240, 1);

  const resolution = resolveMeteringRequirement({
    capability: cap,
    deviceLabel,
    interconnectionRaw: input.interconnectionRaw,
    consumptionCtBoundary: boundary,
    ungroundedConductorCount: ctCount,
    consumptionMeteringRequired: plan.hasIntegratedGateway,
  });

  // ── Production ───────────────────────────────────────────────────────────
  const pr = cap.production.realisation;
  const production: SldMeteringDrawing['production'] =
    pr === 'factory-integrated'
      ? { realisation: pr, where: 'combiner-integral', label: 'PCT (INTEGRAL) — PRODUCTION' }
      : pr === 'ships-with-device' || pr === 'separate-purchase-field-installed'
        ? { realisation: pr, where: 'pv-output-circuit-field',
            label: pr === 'ships-with-device' ? 'PCT (SHIPS W/ GATEWAY, FIELD-INSTALLED)' : 'PCT (ORDER SEPARATELY — SEE BOM)' }
        : null;

  // ── Consumption ──────────────────────────────────────────────────────────
  const supplied: 'in-box' | 'order-separately' =
    cap.consumption.realisation === 'ships-with-device' || cap.consumption.realisation === 'factory-integrated'
      ? 'in-box' : 'order-separately';
  const basisLabel = basis === 'designer-recorded'
    ? 'LOCATION RECORDED BY DESIGNER'
    : 'DEFAULT PER INTERCONNECTION — FIELD VERIFY';
  const consumption: SldMeteringDrawing['consumption'] =
    resolution.consumptionMeteringProvided && location && boundary !== 'unresolved'
      ? {
          ctCount,
          location,
          mode: resolution.consumptionMode,
          supplied,
          label: `CT ×${ctCount ?? '?'} (L1, L2) — CONSUMPTION — ${MODE_LABEL[resolution.consumptionMode]}`,
          basisLabel,
        }
      : null;

  const lead: SldMeteringDrawing['lead'] = consumption
    ? {
        toDeviceLabel: deviceLabel ?? 'GATEWAY',
        label: `CT SECONDARY LEADS → ${(deviceLabel ?? 'GATEWAY').toUpperCase()} CONSUMPTION INPUTS — `
          + 'MFR CT CABLE; EXTEND / RACEWAY PER MFR — FIELD VERIFY',
      }
    : null;

  const scheduleRow = consumption
    ? `${consumption.ctCount ?? '?'} × CLAMP (${supplied === 'in-box' ? 'IN BOX' : 'ORDER — SEE BOM'}) · L1/L2 · `
      + `${LOCATION_SHORT[consumption.location]} · ${resolution.consumptionMode === 'LOAD_WITH_SOLAR' ? 'NET'
        : resolution.consumptionMode === 'LOAD_ONLY' ? 'TOTAL' : 'MODE TBD'}`
      + (basis === 'interconnection-default' ? ' · DEFAULT — FIELD VERIFY' : '')
    : null;

  const drawing: SldMeteringDrawing | null = production || consumption
    ? { production, consumption, lead, scheduleRow }
    : null;

  // ── Prose ────────────────────────────────────────────────────────────────
  const placementNote = consumption
    ? `Consumption CTs (${consumption.ctCount ?? 'UNRESOLVED'}, `
      + `${supplied === 'in-box' ? `in the ${deviceLabel ?? 'device'} box` : 'order separately — see BOM'}) `
      + `clamp L1/L2 on ${LOCATION_PROSE[consumption.location]} — gateway meter type `
      + `${MODE_PROSE[consumption.mode]}; location ${basis === 'designer-recorded'
        ? 'recorded by the designer' : 'per the interconnection default — field verify'}; `
      + 'leads extend to the gateway and CT placement constraints are per the manufacturer.'
    : location && boundary === 'unresolved' && resolution.consumptionMeteringProvided
      ? `The recorded consumption-CT location (${LOCATION_PROSE[location]}) does not exist on this `
        + 'interconnection — record where the CTs clamp before release.'
      : '';

  const topologyBlockerMessage =
    resolution.blockerCode && resolution.blockerCode !== 'CT-TOPOLOGY-UNRESOLVED'
      && resolution.consumptionMode === 'INDETERMINATE' && resolution.consumptionMeteringProvided
      ? 'The consumption metering MODE is INDETERMINATE for the recorded CT location and this '
        + 'interconnection — record where the consumption CTs clamp before release.'
      : null;

  return {
    resolution,
    scheduleValue: meteringScheduleValue(resolution),
    placement: { location, basis, boundary },
    drawing,
    placementNote,
    topologyBlockerMessage,
  };
}
