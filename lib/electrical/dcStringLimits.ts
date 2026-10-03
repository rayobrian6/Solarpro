// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE DC WINDOW THE STRINGS MUST FIT — read off the device they actually land on.
//
// This is the A-8 finding, extracted so there is ONE of it.
//
// A DC-coupled job has no separate PV inverter, so every consumer that wanted a DC limit reached for
// `firstInv.maxDcVoltage ?? 600`, `mpptVoltageMax ?? 600`, `maxInputCurrentPerMppt ?? 15`,
// `mpptChannels ?? 2` — a standalone inverter's specs, defaulted. On Ray's real project that produced,
// on a printed sheet:
//
//     Number of Strings 2 · Panels per String 19 · String Voc × 1.25 = 1345.8 V
//
// against a Powerwall 3 whose published PV input is 60–550 V DC. A string at more than twice the
// device maximum, drawn, scheduled and checked, with no failure reported anywhere — because the
// limits it was checked against belonged to equipment that is not in the design.
//
// 🚨 AND THE REASON THIS FILE EXISTS RATHER THAN A SECOND COPY OF THE FIX: the SLD route had this
// projection inline. Teaching the sizing route the same trick by writing it again would give two
// answers to "what is the DC window", which is the disease, not the cure. Ray's §11: "They must
// consume the same canonical composition… One project. Multiple projections."
//
// What this is NOT: arithmetic. It reports the manufacturer's published numbers for the device the
// strings terminate on. Ray: "Derived arithmetic stays in the sizing engine. Architecture does not."
// ═══════════════════════════════════════════════════════════════════════════

import type { ElectricalProjectModel } from '@/lib/electrical/projectModel';
import type { ServiceTopology } from '@/lib/electrical/serviceTopology';

export interface DcStringLimits {
  /** Absolute maximum DC input voltage of one unit. Voltage limits are PER UNIT, never summed. */
  maxDcVoltage: number;
  mpptVoltageMin: number;
  mpptVoltageMax: number;
  /** Maximum Imp per MPPT, per unit. */
  maxInputCurrentPerMppt: number;
  /** Maximum Isc per MPPT, per unit (the lowest any unit publishes). */
  maxIscPerMpptA?: number;
  /** 🚨 CHANNELS DO add up: every cabinet's MPPTs are available to the array. */
  mpptChannels: number;
  /** Aggregate PV the storage will accept, in kW STC. */
  maxStcKw: number;
  /** How many units published these limits. */
  unitCount: number;
  /** The manufacturer's own citation, carried through so a sheet can print where this came from. */
  basis: string;
}

/**
 * The DC window for a DC-coupled project, or null when this projection does not apply.
 *
 * Null for every job with a separate PV inverter and for any DC-coupled graph whose storage
 * publishes no PV input — in which case the caller keeps whatever it had. That scoping is deliberate:
 * Ray's standing constraint is "must not change the SLD logic for other brands and other scenarios",
 * and exactly one catalogue family publishes `pvInput` today.
 */
export function dcStringLimits(
  topology: ServiceTopology | null | undefined,
  solarCoupling: ElectricalProjectModel['solarCoupling'],
): DcStringLimits | null {
  if (solarCoupling !== 'dc-coupled-storage' || !topology) return null;
  const units = (topology.storage ?? []).filter(
    u => u.role === 'inverter-unit' && u.pvInputLimits);
  if (units.length === 0) return null;

  // 🚨 ONE SET OF LIMITS, OR NOTHING. Mixed storage models would have different windows, and the
  // array has to satisfy whichever unit it lands on — taking the first would make the answer depend
  // on node ordering, which is the defect class the branch-ordering fix closed. A real mixed-model
  // DC-coupled site is a design question, not something to average.
  const first = units[0].pvInputLimits!;
  const uniform = units.every(u => {
    const l = u.pvInputLimits!;
    return l.inputVdc[0] === first.inputVdc[0] && l.inputVdc[1] === first.inputVdc[1]
      && l.mpptVdc[0] === first.mpptVdc[0] && l.mpptVdc[1] === first.mpptVdc[1]
      && l.maxImpPerMpptA === first.maxImpPerMpptA && l.mppts === first.mppts;
  });
  if (!uniform) return null;

  return {
    maxDcVoltage: first.inputVdc[1],
    mpptVoltageMin: first.mpptVdc[0],
    mpptVoltageMax: first.mpptVdc[1],
    maxInputCurrentPerMppt: first.maxImpPerMpptA,
    ...(units.every(u => typeof u.pvInputLimits!.maxIscPerMpptA === 'number')
      ? { maxIscPerMpptA: Math.min(...units.map(u => u.pvInputLimits!.maxIscPerMpptA)) } : {}),
    mpptChannels: first.mppts * units.length,
    maxStcKw: first.maxStcKw * units.length,
    unitCount: units.length,
    basis: first.basis,
  };
}

/** One line for a log or a sheet note, so the numbers are always accompanied by their source. */
export const dcStringLimitsNote = (l: DcStringLimits): string =>
  `${l.mpptVoltageMin}–${l.mpptVoltageMax} V MPPT, ${l.maxDcVoltage} V max input, `
  + `${l.maxInputCurrentPerMppt} A Imp/MPPT, ${l.mpptChannels} MPPT channels across `
  + `${l.unitCount} unit(s), ${l.maxStcKw} kW STC accepted (${l.basis})`;
