# W4 §1/§2/§13 — AHJ / Code-Authority Before-and-After Report

Status: W4 closer, 2026-07-21. Companion evidence:
`docs/evidence/braidon-{original,live}-w4.planset-evidence.json` (the harness
`scripts/planset-evidence-w4.mjs` proves cross-sheet edition agreement + zero
renderer literals + zero authority bypass and exits non-zero on any violation).

This report records where every printed code edition (NEC / IBC / IRC / IFC /
ASCE) came from BEFORE W4, where it comes from now, and the HONEST verification
state (nothing in-repo is a verified adoption ordinance — so the planset renders
for review but blocks permit-ready with `CODE-AUTHORITY-INCOMPLETE`).

---

## Before — many literals, two NEC years, dropped registry editions

Source: `docs/AUTHORITY-FLOW-AUDIT-PLANSET.md`. Editions were sheet-local
literals with no single authority:

- **NEC printed two different years in one package**: `'2020'` at
  electricalPages:113, compliancePages:27, coverSheet:37, certPages:26,
  structuralPages:1456 — vs `'2023'` at titleBlock:24, electricalPages:1089,
  certPages:222/321/426. (The exact "2023-vs-2020" disagreement §2 names.)
- **IBC / IRC** literal `'2021'` at titleBlock:25-26, coverSheet:38,
  structuralPages:124/425/640, certPages:223, and buildPermitCoverSheet:35.
- **IFC** a hardcoded ternary off the NEC year, **×5 copies**; IFC 2021 §-numbers
  printed literally on arrayPages:507-508 even where the year would differ.
- **ASCE 7-22** ≈ **90 literals** across the renderers (incl. sheetManifest:87).
- `AhjRecord` had no IBC/IRC/IFC/ASCE fields; the live AHJ registry returned
  Building/Fire/Residential editions and the mapper **dropped** them
  (ahjRegistry.ts:83-85). No persisted, versioned AHJ record.
- The retired `lib/permit/buildPermitCoverSheet.ts` carried its own **3** hardcoded
  editions: `IBC 2021`, `ASCE 7-22`, and `IFC = NEC 2023 ? 2024 : 2021`.

**Removed literal sites: ≈ 110 across the sheet renderers + 3 in the deleted
`buildPermitCoverSheet`.** (≈90 ASCE, ~9 NEC-year, ~7 IBC/IRC, IFC ternary ×5.)

---

## After — one versioned record, one projection seam, zero renderer literals

```
buildCodeAuthority(...)  (lib/permit/snapshot/codeAuthority.ts)
  └─ snapshot.codeAuthority : CodeAuthorityRecord   ── THE single source
        editions.{nec,ibc,irc,ifc,asce} : { edition|null, source, provenance }
        verificationStatus : 'verified' | 'unverified' | 'incomplete'

Every renderer reads THROUGH the projection seam (holds no edition literal):
  projectCodeAuthority(snap)  (codeAuthorityProjection.ts)
    .tag('nec') → <span data-code-edition="nec">NEC 2020</span>
    .label('asce') → 'ASCE 7-22' | 'ASCE PENDING'
  consumed by titleBlock.ts (every sheet), coverSheet, compliancePages,
  certPages, structuralPages, arrayPages, validationPage, electricalPages.
```

### Where each edition now comes from (honesty contract)

| Kind | Source | Braidon value | Why |
|---|---|---|---|
| NEC | AHJ adoption record / enriched jurisdiction (`ahj-record`) | **2020** | Madison County IL adoption (best real authority) |
| ASCE | structural-engine computational basis (`structural-engine-basis`) | **7-22** | the edition the V4 engine ran under — a BASIS, not an adoption claim |
| IBC | AHJ DB does not carry it → `unknown` | **null → PENDING** | no inference (never IBC 2021 by default) |
| IRC | AHJ DB does not carry it → `unknown` | **null → PENDING** | no inference |
| IFC | AHJ DB does not carry it → `unknown` | **null → PENDING** | no NEC→IFC derivation |

### Honest verification state

- Nothing in-repo is a verified adoption ordinance. Every record is
  `unverified` (all editions present, unarchived) or `incomplete` (≥1 edition
  null). Braidon is **incomplete** (IBC/IRC/IFC null) ⇒ the
  **`CODE-AUTHORITY-INCOMPLETE`** blocker fires and permit-ready is blocked. The
  planset still renders for review (PENDING editions printed, never guessed).
- `sourceHash` / `verifiedBy` are shaped for the W4 document registry (SHA-256
  reference) and stay `null` until an operator archives + verifies the adoption
  document. **No verified code adoption exists today** — this is the honest
  state, not a gap to paper over.

### V11 activation (blocking)

- V11 is a BLOCKING snapshot validator: every displayed edition must equal the
  `codeAuthority` record; a sheet that adopts a divergent or fabricated edition
  is a blocking violation (tests/planset/code-authority-w4.test.ts).
- **Source scan (V11 proof)**: `scripts/planset-evidence-w4.mjs` and the test
  scan the 11 owned renderers (titleBlock, coverSheet, compliancePages,
  certPages, structuralPages, arrayPages, validationPage, electricalPages,
  drafting/templates/{roof,fence,ground}) for `NEC|IBC|IRC|IFC 20\d\d`,
  `ASCE 7-\d\d`, and `necVersion || '…'` defaults — **zero hits**.
- **Cross-sheet identity**: in both the frozen fixture and the live design, every
  `data-code-edition` value is IDENTICAL across every sheet that prints it
  (NEC 2020, ASCE 7-22, IBC/IRC/IFC PENDING) — the truth matrix rows
  `code.edition.*` all `agree:true`, `editions identical: true`. The
  2023-vs-2020 disagreement is eliminated.

### Sample record (frozen Braidon fixture)

```json
"codeAuthority": {
  "schemaVersion": "1.0.0",
  "ahjName": "Madison County Building & Zoning",
  "jurisdictionType": "county", "stateCode": "IL",
  "editions": {
    "nec":  { "edition": "2020", "source": "ahj-record" },
    "ibc":  { "edition": null,  "source": "unknown" },
    "irc":  { "edition": null,  "source": "unknown" },
    "ifc":  { "edition": null,  "source": "unknown" },
    "asce": { "edition": "7-22", "source": "structural-engine-basis" }
  },
  "verificationStatus": "incomplete",
  "incompleteEditions": ["ibc", "irc", "ifc"],
  "verifiedBy": null, "sourceHash": null
}
```

The AHJ name is single-sourced: `projectAuthority.ahjName === codeAuthority.ahjName`
(truth-matrix `authority.ahj.singleSource = true`). `projectAuthority.governingCodesRef`
is a REFERENCE to the code-authority record and carries **no** edition literal.

---

## Flagged for Ray (recorded, NOT changed — boundary: no production data edits)

`lib/mounting-hardware-db.ts` labels three RT-MINI variants `systemType: 'rail_less'`,
contradicting the RT-MINI = rail-paired ruling:

| id | model | systemType | ruling |
|---|---|---|---|
| `rooftech-mini` | RT-MINI | `rail_based` | correct |
| `rooftech-mini-s` | RT-MINI-S | `rail_less` | **contradicts rail-paired ruling** |
| `rooftech-mini-t` | RT-MINI-T | `rail_less` | **contradicts rail-paired ruling** |
| `rooftech-mini-m` | RT-MINI-M (Metal) | `rail_less` | **contradicts rail-paired ruling** |

Recorded in both W4 evidence artifacts (`mountingHardwareDbFlag`). Ray decision:
confirm whether these variants are truly rail-less or should be `rail_based`; the
closer did not alter the data.
