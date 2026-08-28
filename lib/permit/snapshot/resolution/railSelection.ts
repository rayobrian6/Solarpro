// ═══════════════════════════════════════════════════════════════════════════
// AAC WS-8 — RAIL SELECTION: THE HONEST TRACE.
//
// THE QUESTION (audit §2.8): PENDING-RACKING-ASSEMBLY-SELECTION is declared
// AUTO_DERIVED. Is a rail actually SELECTABLE from existing design data, or is
// it genuinely unselected?
//
// THE TRACE, performed over the whole repo:
//   • `projects.selected_equipment` (lib/system/selectedEquipment.ts) carries
//     panel / inverter / mounting / battery — there is NO rail field.
//   • `engineering_config.subSystems` carries panelId / inverterId / mountingId
//     — no rail.
//   • `PermitInput.project` carries `mountingSystemId` — no rail.
//   • `MountingSystemSpec.rail` is the mount's OWN rail, present only for
//     single-manufacturer systems. `rooftech-mini` has none.
//   • `RailSpec` (mounting-hardware-db) has model / alloy / moment / shear /
//     maxSpan / cantilever / spliceInterval / iccEsReport and NO part number.
//   • the mount record names an ACCEPTABLE SET in free text
//     (`hardware.railSplice`), not a selection.
//
// THE VERDICT: for a mixed-manufacturer mount the rail is GENUINELY UNSELECTED.
// It is a design decision with real commercial consequences (brand, cost,
// availability, splice hardware, warranty), and per the no-fabricated-selection
// boundary the engine may NOT pick one. PENDING-RACKING-ASSEMBLY-SELECTION
// therefore legitimately remains PENDING_SELECTION.
//
// WHAT AUTOMATION STILL OWES — and this module delivers it: the operator must
// not be asked to RESEARCH. The engine derives, deterministically:
//   1. the required span (the mount's maximum attachment spacing);
//   2. every CANDIDATE rail the mount's own compatibility statement admits,
//      resolved to REAL catalog RailSpec records (not names in prose);
//   3. per candidate, whether its published maxSpan and moment capacity cover
//      the required span, and its splice interval;
//   4. which candidates are ELIGIBLE and which are refused, with the reason.
// The residual is then ONE pick from a scored list — a bounded selection, not
// an open question.
//
// When the mount DOES carry its own rail, the selection is inherent and the
// requirement resolves with a real audit reference.
// ═══════════════════════════════════════════════════════════════════════════

import {
  getAllMountingSystems, getMountingSystemById,
  type MountingSystemSpec, type RailSpec,
} from '@/lib/mounting-hardware-db';
import { readRailSelection } from '@/lib/railSelection/service';

/** Where a rail selection could have come from, and whether it did. */
export interface RailSelectionSourceProbe {
  path: string;
  present: boolean;
  value: string | null;
  note: string;
}

export interface RailCandidate {
  /** the catalog system the rail belongs to. */
  systemId: string;
  manufacturer: string;
  railModel: string;
  maxSpanIn: number;
  maxCantileverIn: number;
  momentCapacityInLbs: number;
  spliceIntervalIn: number;
  ul2703Listed: boolean;
  iccEsReport: string | null;
  /** true ⇔ published maxSpan ≥ the required attachment spacing. */
  spanCovers: boolean;
  /** null ⇒ the mount states no required spacing, so span cannot be screened. */
  requiredSpanIn: number | null;
  /** the reason a candidate is refused, or null when eligible. */
  refusedReason: string | null;
  /** the catalog has no part number for any rail — stated, never invented. */
  partNumber: null;
}

export interface RailSelectionVerdict {
  /** 'inherent' — the mount carries its own rail; 'selected' — an operator pinned
   *  one (D12); 'unselected' — genuinely open; 'no-rail-required' — a rail-less /
   *  non-rail-based mount. */
  state: 'inherent' | 'selected' | 'unselected' | 'no-rail-required';
  selectedRailModel: string | null;
  selectedRailSystemId: string | null;
  /** D12 — the stored selection in force, when one is. Null for every other
   *  state, including `inherent`: a rail that comes with the product was not
   *  chosen by anybody and has no actor, instant or basis to report. */
  pinned: {
    railSystemId: string;
    manufacturer: string;
    railModel: string;
    railSku: string | null;
    selectedBy: string;
    selectedAtIso: string;
    basis: string;
    coversSpan: boolean;
    spanOverrideAuthority: string | null;
  } | null;
  /** every place a selection could have lived, and whether it did. */
  probes: RailSelectionSourceProbe[];
  /** the mount's own documented compatibility statement (free text). */
  compatibilityStatement: string | null;
  requiredSpanIn: number | null;
  candidates: RailCandidate[];
  eligibleCandidateCount: number;
  /** why the verdict is what it is. */
  basis: string;
  /** the bounded operator action, or null when nothing is owed. */
  operatorAction: string | null;
  /** the honest statement that no rail SKU/part number exists in the catalog. */
  partNumberAvailability: 'none-in-catalog';
}

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase();

/** Names the mount's compatibility statement admits, matched against real
 *  catalog rail models. Word-ish matching only — never a guess from a brand. */
function matchesCompatibility(statement: string, sys: MountingSystemSpec, rail: RailSpec): boolean {
  const s = norm(statement).replace(/[^a-z0-9]+/g, ' ');
  const railKey = norm(rail.model).replace(/[^a-z0-9]+/g, '');
  const mfrKey = norm(sys.manufacturer).replace(/[^a-z0-9]+/g, '');
  const compact = s.replace(/ /g, '');
  // The rail model itself (XR100, XR1000, SME Rail → "sme")
  if (railKey && compact.includes(railKey)) return true;
  // A manufacturer named alongside a rail-family token the catalog also carries
  // (e.g. "UniRac SFM" ↔ unirac-sme / unirac-solarmount).
  if (mfrKey && compact.includes(mfrKey)) {
    const family = norm(sys.productLine).replace(/[^a-z0-9]+/g, '');
    if (family && compact.includes(family)) return true;
    // manufacturer named with an explicit rail abbreviation the catalog maps to
    if (/\bsfm\b/.test(s) && /solarmount|sme/.test(norm(sys.id))) return true;
  }
  return false;
}

/** Every real catalog rail the mount's documented compatibility statement admits. */
export function railCandidatesFor(mount: MountingSystemSpec): RailCandidate[] {
  const statement = mount.hardware?.railSplice ?? '';
  if (!statement.trim()) return [];
  const requiredSpanIn = mount.mount?.maxSpacingIn ?? null;
  const out: RailCandidate[] = [];
  const seen = new Set<string>();
  for (const sys of getAllMountingSystems()) {
    const rail = sys.rail;
    if (!rail) continue;
    if (!matchesCompatibility(statement, sys, rail)) continue;
    const key = `${sys.manufacturer}|${rail.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const spanCovers = requiredSpanIn == null ? false : rail.maxSpanIn >= requiredSpanIn;
    out.push({
      systemId: sys.id,
      manufacturer: sys.manufacturer,
      railModel: rail.model,
      maxSpanIn: rail.maxSpanIn,
      maxCantileverIn: rail.maxCantileverIn,
      momentCapacityInLbs: rail.momentCapacityInLbs,
      spliceIntervalIn: rail.spliceIntervalIn,
      ul2703Listed: rail.ul2703Listed,
      iccEsReport: rail.iccEsReport ?? null,
      spanCovers,
      requiredSpanIn,
      refusedReason: requiredSpanIn == null
        ? 'the mount record states no maximum attachment spacing, so the rail span cannot be screened'
        : (spanCovers ? null
          : `published maximum span ${rail.maxSpanIn}" is below the mount's ${requiredSpanIn}" attachment spacing`),
      partNumber: null,
    });
  }
  // deterministic order: eligible first, then by span descending, then by model.
  out.sort((a, b) =>
    Number(b.refusedReason == null) - Number(a.refusedReason == null)
    || b.maxSpanIn - a.maxSpanIn
    || a.railModel.localeCompare(b.railModel));
  return out;
}

export interface RailSelectionInput {
  /** the selected mounting system catalog id. */
  mountingSystemId: string | null;
  /** the posted project record (probed for any rail field, and none exists). */
  project: Record<string, unknown>;
  /** the canonical selected-equipment record, when the store was readable. */
  selectedEquipment: Record<string, unknown> | null;
}

/**
 * THE derivation. Pure and deterministic — no DB, no network, no side effects.
 */
export function deriveRailSelection(input: RailSelectionInput): RailSelectionVerdict {
  const mount = input.mountingSystemId ? getMountingSystemById(input.mountingSystemId) ?? null : null;
  const p = input.project ?? {};
  const se = input.selectedEquipment ?? null;
  // D12 — the stored selection, read through the ONE reader.
  const stored = readRailSelection(se);
  const active = stored?.active ?? null;

  // ── every place a rail selection COULD live, probed by name ───────────────
  const probes: RailSelectionSourceProbe[] = [
    {
      path: 'project.railId | project.railModel | project.railSku',
      present: !!(p.railId || p.railModel || p.railSku),
      value: (p.railId ?? p.railModel ?? p.railSku ?? null) as string | null,
      note: 'PermitInput.project carries mountingSystemId only — no rail field is defined on the type.',
    },
    {
      // D12 — this probe used to be fed `null` unconditionally: its caller read
      // `(canonical as unknown as { storedRecord?: … })?.storedRecord`, and
      // CanonicalEquipmentAuthority has no such property — the `as unknown` cast
      // hid that from the compiler. It reported "absent" whatever the store held.
      path: 'projects.selected_equipment.railSelection',
      present: !!active,
      value: active?.railModel ?? null,
      note: active
        ? `pinned by ${active.selectedBy} at ${active.selectedAtIso} — ${active.basis}`
        : 'SelectedEquipment carries the rail selection (D12). No selection is recorded for this project.',
    },
    {
      path: 'mounting-hardware-db[mountingSystemId].rail',
      present: !!mount?.rail,
      value: mount?.rail?.model ?? null,
      note: 'The mount\'s OWN rail spec. Present for single-manufacturer systems; absent for a mixed-manufacturer mount.',
    },
  ];

  if (!mount) {
    return {
      state: 'unselected', selectedRailModel: null, selectedRailSystemId: null, pinned: null, probes,
      compatibilityStatement: null, requiredSpanIn: null, candidates: [], eligibleCandidateCount: 0,
      basis: 'no mounting system is resolved for this project, so no rail question can be posed',
      operatorAction: 'Select the roof mounting system in the design.',
      partNumberAvailability: 'none-in-catalog',
    };
  }

  const isRailBased = mount.systemType === 'rail_based' || mount.systemType === 'standing_seam'
    || mount.mountTopology === 'rail_paired';
  if (!isRailBased) {
    return {
      state: 'no-rail-required', selectedRailModel: null, selectedRailSystemId: null, pinned: null, probes,
      compatibilityStatement: mount.hardware?.railSplice ?? null, requiredSpanIn: mount.mount?.maxSpacingIn ?? null,
      candidates: [], eligibleCandidateCount: 0,
      basis: `${mount.manufacturer} ${mount.model} routes the rail-less direct-mount load path — no rail is part of the assembly`,
      operatorAction: null,
      partNumberAvailability: 'none-in-catalog',
    };
  }

  if (mount.rail) {
    return {
      state: 'inherent', selectedRailModel: mount.rail.model, selectedRailSystemId: mount.id, pinned: null, probes,
      compatibilityStatement: mount.hardware?.railSplice ?? null,
      requiredSpanIn: mount.mount?.maxSpacingIn ?? null,
      candidates: [], eligibleCandidateCount: 0,
      basis: `${mount.manufacturer} ${mount.model} is a single-manufacturer railed system: the rail (${mount.rail.model}) `
        + 'is part of the selected product, so the rail selection is INHERENT in the mount selection',
      operatorAction: null,
      partNumberAvailability: 'none-in-catalog',
    };
  }

  const candidates = railCandidatesFor(mount);
  const eligible = candidates.filter(c => c.refusedReason == null);

  // ── D12 — AN OPERATOR PINNED ONE ─────────────────────────────────────────
  // A selection is only valid for the assembly it was made for: the
  // compatibility statement that admitted the rail belongs to THAT mount. A
  // selection made against a different mount is reported, and does not answer
  // this assembly's question.
  if (active) {
    // 2026-08-28 — compare through the SUPERSESSION. A pin is stored against the
    // id the operator selected; `mount` is that id resolved to the generation
    // that ships. Comparing the raw strings made a pin made against a superseded
    // id look like a pin for "a different mount", so a real selection silently
    // read as unselected. They are the same assembly, and the compatibility
    // statement that admitted the rail carries across a generation change the
    // manufacturer itself declares. A pin for a genuinely different mount still
    // fails, which is what this branch is for.
    const _activeResolvedId = getMountingSystemById(active.mountingSystemId)?.id ?? active.mountingSystemId;
    if (_activeResolvedId !== mount.id) {
      return {
        state: 'unselected', selectedRailModel: null, selectedRailSystemId: null, pinned: null, probes,
        compatibilityStatement: mount.hardware?.railSplice ?? null,
        requiredSpanIn: mount.mount?.maxSpacingIn ?? null,
        candidates, eligibleCandidateCount: eligible.length,
        basis: `a rail selection exists (${active.manufacturer} ${active.railModel}) but it was pinned to a different mount `
          + `(${active.mountingSystemId}${_activeResolvedId !== active.mountingSystemId ? ` → ${_activeResolvedId}` : ''}), `
          + `not the selected ${mount.id}. The compatibility statement that admitted it `
          + 'belongs to that assembly, so it does not carry over — the rail must be pinned again for this mount',
        operatorAction: `Re-pin the rail for the ${mount.model} assembly; the previous selection was made for `
          + `${active.mountingSystemId}.`,
        partNumberAvailability: 'none-in-catalog',
      };
    }
    return {
      state: 'selected',
      selectedRailModel: active.railModel,
      selectedRailSystemId: active.railSystemId,
      pinned: {
        railSystemId: active.railSystemId,
        manufacturer: active.manufacturer,
        railModel: active.railModel,
        railSku: active.railSku ?? null,
        selectedBy: active.selectedBy,
        selectedAtIso: active.selectedAtIso,
        basis: active.basis,
        coversSpan: active.spanAuthority?.coversSpan ?? false,
        spanOverrideAuthority: active.spanOverride?.authority ?? null,
      },
      probes,
      compatibilityStatement: mount.hardware?.railSplice ?? null,
      requiredSpanIn: mount.mount?.maxSpacingIn ?? null,
      candidates, eligibleCandidateCount: eligible.length,
      basis: `${active.manufacturer} ${active.railModel} is pinned to the ${mount.model} assembly by ${active.selectedBy} `
        + `at ${active.selectedAtIso} — ${active.basis}. `
        + (active.spanAuthority?.coversSpan
          ? `Its published ${active.spanAuthority.publishedMaxSpanIn}" span covers the mount's `
            + `${active.spanAuthority.requiredSpanIn}" attachment spacing.`
          : `Its published span does NOT cover the mount's attachment spacing; pinned under stated authority: `
            + `${active.spanOverride?.authority ?? 'UNRECORDED'}.`),
      operatorAction: null,
      partNumberAvailability: 'none-in-catalog',
    };
  }

  return {
    state: 'unselected', selectedRailModel: null, selectedRailSystemId: null, pinned: null, probes,
    compatibilityStatement: mount.hardware?.railSplice ?? null,
    requiredSpanIn: mount.mount?.maxSpacingIn ?? null,
    candidates,
    eligibleCandidateCount: eligible.length,
    basis: `${mount.manufacturer} ${mount.model} is a mixed-manufacturer mount that carries no rail of its own, and no rail `
      + 'is recorded in any project, design or equipment store (all three probed). The rail is GENUINELY UNSELECTED: '
      + 'choosing between compatible manufacturers is a design + procurement decision, not a derivation, so the engine '
      + `does not make it. ${candidates.length} catalog rail(s) satisfy the mount's documented compatibility statement`
      + (candidates.length
        ? `, of which ${eligible.length} cover the ${mount.mount?.maxSpacingIn ?? '?'}" attachment spacing`
        : ''),
    operatorAction: eligible.length
      ? `Pin the rail/splice for the ${mount.model} assembly. Eligible listed rails (span-screened against the `
        + `${mount.mount?.maxSpacingIn}" attachment spacing): ${eligible.map(c => `${c.manufacturer} ${c.railModel}`).join(', ')}. `
        + 'The catalog holds no rail part numbers, so the orderable SKU comes from the distributor line item.'
      : 'Pin the rail/splice for this assembly — no catalog rail both matches the mount\'s documented compatibility '
        + 'statement and covers its attachment spacing, so the rail must be selected and its span authority supplied.',
    partNumberAvailability: 'none-in-catalog',
  };
}
