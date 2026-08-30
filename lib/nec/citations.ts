// ═══════════════════════════════════════════════════════════════════════════
// NEC CITATIONS — ONE TABLE, KEYED BY THE REQUIREMENT
//
// ── THE DEFECT ────────────────────────────────────────────────────────────
// Every NEC section number in the repo was a bare string literal decided at its
// use site: 174 files under lib/ and app/ carry a hardcoded `NEC <n>.<n>`. The
// adopted EDITION is properly single-sourced (snapshot.codeAuthority, sixteen
// consumers); the SECTION was not. So the package stamped an authoritative year
// onto sections that do not exist in it.
//
//   · `690.<retired>` appeared in 13 files and printed on E-1 and the BOM as
//     the authority for the AC disconnect. Article 690 Part III was REORGANISED
//     in the 2017 NEC: that section, "Additional Provisions", was DELETED and its
//     content folded into 690.13 (PV System Disconnecting Means) and 690.15
//     (Disconnecting Means for Isolating PV Equipment). It does not exist in
//     2017, 2020 or 2023 — the only editions this codebase can adopt — and every
//     title block on the audited set says NEC 2020.
//   · `705.60` was cited for the 125% continuous-load multiplier. In NEC 2020,
//     705.60 is "Primary Power Source Connection" in the Microgrid article. The
//     continuous-load rule is 690.8(B) for PV and 215.2/210.19 generally.
//   · `690.56(B)` was cited on the cover for where a rapid-shutdown INITIATION
//     device goes. 690.56(B) is the plaque/directory requirement; the initiator
//     and its location are 690.12.
//
// A wrong citation is not cosmetic. A plan reviewer checks the section, finds it
// does not say what the sheet claims — or does not exist — and the set goes back.
//
// ── THE RULE ──────────────────────────────────────────────────────────────
// A requirement is named by what it REQUIRES. The section is looked up, per
// adopted edition, so a citation cannot be typed at a call site and cannot go
// stale when an edition renumbers.
// ═══════════════════════════════════════════════════════════════════════════

export type NecEdition = '2017' | '2020' | '2023';

/** The requirements this codebase cites. Named for what they require. */
export type NecRequirement =
  | 'pv-disconnecting-means'
  | 'pv-equipment-isolating-disconnect'
  | 'pv-rapid-shutdown'
  | 'pv-rapid-shutdown-plaque'
  | 'pv-circuit-sizing-continuous'
  | 'pv-overcurrent-protection'
  | 'pv-conductor-marking'
  | 'pv-ground-fault-protection'
  | 'pv-equipment-grounding'
  | 'supply-side-connection'
  | 'interconnection-ocpd'
  | 'egc-sizing'
  | 'conductor-ampacity'
  | 'conduit-fill';

interface CitationSpec {
  /** the section per edition; a single string when it does not change. */
  section: string | Partial<Record<NecEdition, string>>;
  /** what the section actually requires — so a wrong pairing is visible here. */
  requires: string;
}

const CITATIONS: Record<NecRequirement, CitationSpec> = {
  'pv-disconnecting-means': {
    // The pre-2017 "Additional Provisions" section was DELETED in the
    // reorganisation; 690.13 is where the disconnecting means now lives.
    section: { '2017': '690.13', '2020': '690.13', '2023': '690.13' },
    requires: 'a disconnecting means for the PV system',
  },
  'pv-equipment-isolating-disconnect': {
    section: '690.15',
    requires: 'a means to isolate PV equipment from all sources',
  },
  'pv-rapid-shutdown': {
    section: '690.12',
    requires: 'rapid shutdown of PV systems on buildings, and the initiation device',
  },
  'pv-rapid-shutdown-plaque': {
    section: '690.56(C)',
    requires: 'the rapid-shutdown label/plaque at the service equipment',
  },
  'pv-circuit-sizing-continuous': {
    section: '690.8(B)',
    requires: 'conductor ampacity of not less than 125% of the maximum circuit current',
  },
  'pv-overcurrent-protection': {
    section: '690.9',
    requires: 'overcurrent protection for PV circuits',
  },
  'pv-conductor-marking': {
    section: '690.31(B)',
    requires: 'identification of PV source and output circuits at all accessible points',
  },
  'pv-ground-fault-protection': {
    // 2026-08-29 - PV-4A printed "NEC 690.41, 690.5" under a NEC 2020 title
    // block. 690.5 ("Ground-Fault Protection") was DELETED in the 2017
    // reorganisation of Article 690 Part III; the requirement moved INTO
    // 690.41(B), which states that a PV system with dc circuits on or in a
    // building shall be provided with dc ground-fault protection, and the
    // function rides the listed inverter. So the sheet cited a section that does
    // not exist in any edition this codebase can adopt, beside the section that
    // replaced it.
    section: { '2017': '690.41(B)', '2020': '690.41(B)', '2023': '690.41(B)' },
    requires: 'dc ground-fault protection for a PV system with dc circuits on or in a building',
  },
  'pv-equipment-grounding': {
    section: '690.43',
    requires: 'equipment grounding of exposed non-current-carrying metal parts',
  },
  'supply-side-connection': {
    section: '705.11',
    requires: 'connection ahead of the service disconnecting means, and the tap rules',
  },
  'interconnection-ocpd': {
    section: '705.12',
    requires: 'load-side interconnection and the busbar allowance',
  },
  'egc-sizing': {
    section: '250.122',
    requires: 'the size of equipment grounding conductors from the OCPD rating',
  },
  'conductor-ampacity': {
    section: '310.15',
    requires: 'ampacity, with ambient correction and conductor-count adjustment',
  },
  'conduit-fill': {
    section: 'Chapter 9, Table 1',
    requires: 'the allowable raceway fill percentage',
  },
};

/** The section for a requirement under the adopted edition. */
export function necSection(req: NecRequirement, edition: NecEdition = '2020'): string {
  const spec = CITATIONS[req];
  if (!spec) return '';
  return typeof spec.section === 'string'
    ? spec.section
    : (spec.section[edition] ?? spec.section['2020'] ?? '');
}

/** A printable citation, e.g. `NEC 2020 690.13`. */
export function necCite(req: NecRequirement, edition: NecEdition = '2020'): string {
  const s = necSection(req, edition);
  return s ? `NEC ${edition} ${s}` : '';
}

/** What the cited section requires — for a reviewer, and for a test that a
 *  citation and its claim actually match. */
export function necRequires(req: NecRequirement): string {
  return CITATIONS[req]?.requires ?? '';
}

/**
 * Sections that DO NOT EXIST in the given edition, so a guard test can assert
 * nothing in the codebase cites them. The deleted Article 690 Part III section
 * is the one that shipped, on E-1 and the BOM, under a NEC 2020 title block.
 *
 * Built from parts so a repo-wide sweep for the literal cannot rewrite the very
 * list that forbids it — which is exactly what happened on the first pass.
 */
const _RETIRED_690 = ['690', '14'].join('.');
// 2026-08-29 - 690.5 (Ground-Fault Protection) went the same way in the same
// 2017 reorganisation: deleted, its requirement folded into 690.41(B). Built
// from parts for the same reason as the line above - a repo-wide sweep for the
// literal must not be able to rewrite the list that forbids it.
const _RETIRED_690_GFP = ['690', '5'].join('.');
export const RETIRED_SECTIONS: Partial<Record<NecEdition, string[]>> = {
  '2017': [_RETIRED_690, _RETIRED_690_GFP],
  '2020': [_RETIRED_690, _RETIRED_690_GFP],
  '2023': [_RETIRED_690, _RETIRED_690_GFP],
};
