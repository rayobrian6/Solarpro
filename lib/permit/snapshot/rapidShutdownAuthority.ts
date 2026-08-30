// ═══════════════════════════════════════════════════════════════════════════
// THE RAPID-SHUTDOWN AUTHORITY — one answer to "what does this design do about
// 690.12, and where is the initiation device".
//
// ── WHAT WAS WRONG ────────────────────────────────────────────────────────
// General note 12 was a literal:
//
//     "Rapid shutdown system required per NEC 690.12. Module-level rapid
//      shutdown (MLRS) shall reduce array conductors to ≤ 30V within 30
//      seconds. Initiator shall be located at utility meter per NEC 690.56(B)."
//
// Two facts in one sentence, and both were wrong.
//
// THE CITATION. 690.56(B) is the plaque/directory requirement — a LABEL. Where
// the initiation device goes is 690.12(C). A plan reviewer who checks 690.56(B)
// for a device location finds a labelling rule, and the set goes back.
//
// THE LOCATION. The design's OWN device model has always carried the answer:
// build.ts emits `svc-rsd-initiator`, "PV rapid-shutdown initiation device
// (NEC 690.12) at the service location", wired between the combiner load-break
// and the fused AC disconnect. Nothing outside build.ts read it. So the note
// asserted the utility meter — a different device, in a different place, that
// this design does not put an initiator on — while E-1's own device schedule
// printed the truth two sheets away.
//
// ── THE RULE ──────────────────────────────────────────────────────────────
// A note about a device states what the DESIGN contains. The requirement is
// cited from `lib/nec/citations.ts`, per adopted edition. Neither is typed at a
// call site.
// ═══════════════════════════════════════════════════════════════════════════
import type { PermitDesignSnapshot } from './types';
import { necSection, type NecEdition } from '@/lib/nec/citations';

export interface RapidShutdownAuthority {
  /** does this design carry the rapid-shutdown function at all? */
  required: boolean;
  // ══ 2026-08-29 — THE FIELDS PV-5 WAS DECIDING FOR ITSELF ════════════
  // The disconnect directory built its own row:
  //     name  'RAPID SHUTDOWN INITIATOR'
  //     type  isMicro ? 'MODULE-LEVEL (PVRSS)' : 'ARRAY-LEVEL'
  //     host  bos.brains ? `Hosted by the ${bos.brains.model}` : …
  // — a device identity derived from the inverter topology and the monitoring
  // gateway, with no reference to the initiation device this authority names. So
  // the cover said the initiation device is the fused AC disconnect and PV-5
  // said it was module-level PVRSS hosted by the IQ Combiner 5C, on one package.
  //
  // And the emergency procedure said "TURN RAPID SHUTDOWN SWITCH TO THE 'OFF'
  // POSITION" for a design that contains no such switch — an instruction a
  // firefighter cannot follow.
  /** how the shutdown is ACHIEVED: module-level electronics vs an array-level
   *  controlled-conductor scheme. A property of the equipment, not of a sheet. */
  systemType: 'MODULE-LEVEL' | 'ARRAY-LEVEL' | 'NONE';
  /** the equipment that HOSTS the initiation function, when it is hosted by a
   *  larger device (the fused AC disconnect here). Null when a dedicated
   *  initiator exists in its own right. */
  hostEquipmentId: string | null;
  /** the one-line instruction the emergency procedure and the directory print.
   *  It names the actual device; it never says "the rapid shutdown switch"
   *  unless the design contains one. */
  operatingInstruction: string | null;
  /** the section that governs the BUILDING PLACARD — a different requirement
   *  from the initiation device, and edition-dependent. */
  placardBasis: string;
  /** the design contains a discrete initiation device object. */
  initiatorPresent: boolean;
  /** where the DESIGN puts it, in the device object's own words. Null when the
   *  design carries no initiator object — never a guess. */
  initiatorLocation: string | null;
  /** the initiator's canonical object id, so a sheet can cross-reference the
   *  device schedule rather than describe it again. */
  initiatorObjectId: string | null;
  /** 690.12 — the rapid-shutdown requirement, per adopted edition. */
  requirementSection: string;
  /** 690.12(C) — the initiation device and where it goes. */
  initiationDeviceSection: string;
  /** 690.56(C) — the label/plaque. A DIFFERENT requirement; kept separate so the
   *  two can never be swapped again. */
  labelSection: string;
  /** the construction note, composed once. */
  noteText: string;
}

/** 690.12(C) in every edition this codebase can adopt (2017 reorganised 690.12
 *  into (A)–(D); the initiation device has been (C) since). Held here rather
 *  than in the citation table because it is a SUBDIVISION of one requirement,
 *  not a separate requirement. */
const INITIATION_DEVICE_SUBSECTION = '(C)';

export function projectRapidShutdownAuthority(
  snap: PermitDesignSnapshot | null | undefined,
  edition: NecEdition = '2020',
): RapidShutdownAuthority {
  const objs = snap?.electrical?.serviceTopology ?? [];
  // The ROLE first, the dedicated type second: on the common design the fused AC
  // disconnect carries `rsdRole: 'initiator'` and there is no separate device
  // (see build.ts). Asking for the type alone is what made a phantom node
  // necessary in the first place.
  const initiator = objs.find(o => o.rsdRole === 'initiator')
    ?? objs.find(o => o.type === 'rsd-initiator') ?? null;

  const requirementSection = necSection('pv-rapid-shutdown', edition);
  // Module-level ⇔ the array's own electronics perform the shutdown. Read from
  // the DESIGN (a microinverter or MLPE on every module), never from a sheet's
  // local `isMicro` flag.
  const _micro = (snap?.electrical as { topology?: string } | undefined)?.topology === 'MICRO'
    || (snap?.electrical as { microInverterUnits?: unknown[] } | undefined)?.microInverterUnits?.length ? true : false;
  const initiationDeviceSection = `${requirementSection}${INITIATION_DEVICE_SUBSECTION}`;
  const labelSection = necSection('pv-rapid-shutdown-plaque', edition);

  // The design's own description, minus the citation it already carries (the
  // note states the citation itself, and printing it twice in one sentence reads
  // as two separate references).
  // WHERE it is, in the device's own words. When the role rides an existing
  // device the note names that device; when a dedicated initiator exists it
  // names its stated location. Either way the words come from the object.
  const location = initiator
    ? (initiator.type === 'rsd-initiator'
        ? ((initiator.description ?? initiator.label ?? '')
            .replace(/\s*\(NEC[^)]*\)\s*/i, ' ')
            .replace(/^PV rapid-shutdown initiation device\s*/i, '')
            .replace(/\s+/g, ' ').trim() || null)
        : (() => {
            // the label with its parenthetical role note stripped, de-capitalised
            // only at the first character - "AC" is an acronym, not a word.
            const l = (initiator.label ?? initiator.type).replace(/\s*\([^)]*\)\s*/g, ' ').trim();
            return `at the ${l.charAt(0).toLowerCase()}${l.slice(1)}`;
          })())
    : null;

  const required = !!initiator || (snap?.project as { rapidShutdown?: boolean } | undefined)?.rapidShutdown === true;

  const noteText = !required
    ? `Rapid shutdown is not required for this design. Where a rapid-shutdown system is present it shall `
      + `comply with NEC ${requirementSection}.`
    : [
        `Rapid shutdown system required per NEC ${requirementSection}.`,
        `Module-level rapid shutdown shall reduce conductors outside the array boundary to ≤ 30V within 30 seconds.`,
        initiator && location
          // The DESIGN's placement, then the code requirement it answers. Never
          // the reverse: the code does not name a utility meter, and this design
          // does not put an initiator on one.
          ? `The rapid-shutdown initiation device is located ${location} (see the service-object schedule); `
            + `it shall be readily accessible and installed per NEC ${initiationDeviceSection}.`
          : `The rapid-shutdown initiation device shall be readily accessible and installed per `
            + `NEC ${initiationDeviceSection}.`,
        `Rapid-shutdown labelling per NEC ${labelSection}.`,
      ].join(' ');

  // The instruction names the device. When the role rides an existing
  // disconnect, opening THAT disconnect is the initiation; there is no separate
  // switch to turn and the procedure must not invent one.
  const _deviceName = initiator
    ? (initiator.label ?? initiator.type).replace(/\s*\([^)]*\)\s*/g, ' ').trim()
    : null;
  const operatingInstruction = !required ? null
    : initiator && initiator.type !== 'rsd-initiator'
      ? `OPEN THE ${_deviceName!.toUpperCase()} — IT IS THE RAPID-SHUTDOWN INITIATION DEVICE (NEC ${initiationDeviceSection})`
      : initiator
        ? `TURN THE RAPID SHUTDOWN INITIATION DEVICE TO THE "OFF" POSITION (NEC ${initiationDeviceSection})`
        : `INITIATE RAPID SHUTDOWN PER NEC ${initiationDeviceSection}`;

  return {
    required,
    systemType: !required ? 'NONE' : (_micro ? 'MODULE-LEVEL' : 'ARRAY-LEVEL'),
    hostEquipmentId: initiator && initiator.type !== 'rsd-initiator' ? initiator.objectId : null,
    operatingInstruction,
    placardBasis: labelSection,
    initiatorPresent: !!initiator,
    initiatorLocation: location,
    initiatorObjectId: initiator?.objectId ?? null,
    requirementSection,
    initiationDeviceSection,
    labelSection,
    noteText,
  };
}
