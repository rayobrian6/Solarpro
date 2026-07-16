# MFA Phase 3 — Frozen Evidence Artifacts: Integrity Note & Superseding Statement

**Date:** 2026-07-09  
**Author:** Automated acceptance test agent  
**Branch:** dev  
**Status:** Informational evidence note. MFA Phase 3 is **CLOSED**.  
**Classification:** Internal — Redacted  

---

## 1. Purpose

This document accompanies two frozen evidence artifacts produced during MFA Phase 3 acceptance testing:

1. `MFA-PHASE3-ACCEPTANCE-TEST-SCRIPT.py` — the automated Python acceptance test suite (pyotp + requests) that was executed against `solarpro-dev.vercel.app`.
2. `MFA-PHASE3-ACCEPTANCE-TEST-RESULTS.json` — the JSON output recording all 37 test results, evidence, and notes.

Its purpose is to record (a) that these artifacts are **intentionally immutable** and must not be modified post-execution, (b) their **SHA-256 content hashes** for tamper-evidence, and (c) that certain **legacy wording inside the script is superseded** by the corrected acceptance record — the script was not edited to match the corrections, by design.

---

## 2. Immutability Statement

The acceptance test script (`MFA-PHASE3-ACCEPTANCE-TEST-SCRIPT.py`) is a **frozen execution artifact**. It represents the exact code that was run against the dev deployment on 2026-07-09. It must not be edited, "corrected," or back-dated after the fact, because doing so would falsify the evidence record — the script is the provenance for what was actually tested, how, and in what order. The output JSON is the result of that execution and is likewise preserved as-is (though it has received documentation-grade metadata corrections in scope_notes and per-test notes fields; see Section 4).

If the acceptance suite is ever re-run, a **new** script version and a **new** results file should be produced with new timestamps and hashes, rather than overwriting these artifacts.

---

## 3. SHA-256 Content Hashes

The following hashes were computed with `sha256sum` on the working-copy files at the time of this integrity check (2026-07-09, dev branch, after commit `1b40ddd5`).

| Artifact | SHA-256 | Size (bytes) | Last commit touching the file |
|----------|---------|--------------|-------------------------------|
| `MFA-PHASE3-ACCEPTANCE-TEST-SCRIPT.py` | `ed723db8b9ffe6dd6dfc8317e6b2f111c3ff75a46d9f7c70af3ecdfaaf6baa17` | 37,755 | `b9a2894a` — never modified by any documentation patch |
| `MFA-PHASE3-ACCEPTANCE-TEST-RESULTS.json` | `540dfa958d0d770590de7301cb1341cc288ee35d7dfcb80ed76be30b49b05c2b` | 15,174 | `1b40ddd5` — metadata/notes corrected (see Section 4) |

**Interpretation:** The script hash is stable and has not changed since its original commit (`b9a2894a`). It is a true frozen artifact. The JSON hash reflects the post-correction state — the JSON received evidence-precision corrections to `scope_notes`, `test_name`, and `notes` fields across commits `930fde1e` and `1b40ddd5`, but the underlying test status values (37 PASS, 0 FAIL) and evidence strings were not altered. A future auditor recomputing these hashes against the committed files should obtain the same values; any divergence indicates the files were modified outside the documented correction commits.

---

## 4. Legacy Wording Superseded by the Corrected Acceptance Record

The script contains wording that predates the evidence-precision corrections applied in commits `930fde1e` (documentation & gap cleanup) and `1b40ddd5` (final evidence precision patch). This legacy wording was **intentionally left in place** in the script because editing the executed script would falsify its provenance. Instead, the **corrected acceptance record** (`MFA-PHASE3-ACCEPTANCE-TEST-RECORD.md`) is the authoritative evidence document, and it supersedes the script's legacy labels where they conflict.

| Location in script | Legacy wording | Superseded by | Authoritative source |
|--------------------|----------------|---------------|----------------------|
| Line 9 | "Enrollment with a real authenticator (TOTP via pyotp)" | "Software TOTP simulation — no physical authenticator application was used" | Acceptance Record Section 1 (Scope) and `scope_notes.totp_method` in the JSON |
| Line 572 (T9.1 label) | "MFA audit events written (source-level + operational evidence)" | "MFA audit-event emission paths exercised (source + operational no-throw)" — database persistence remains unverified until `audit_log` is queried | Acceptance Record Section 3.10 (T9.1) and JSON `test_name` for T9.1 |
| Line 485 (T6.2 label) | "Remaining recovery-code count (2 used, 8 remaining)" | "8 remaining" is a **mathematical inference** (10 generated − 2 consumed = 8), not a value from a direct stored-count query or API response | Acceptance Record Section 3.7 (T6.2), Outstanding Item 4, and JSON `notes` for T6.2 |

**Rule for auditors:** Where the script's inline labels conflict with the acceptance record, the **acceptance record governs**. The script's labels describe the test author's original intent at write time; the acceptance record describes the verified evidence scope after the precision patch. The test logic itself (which HTTP requests were made, what assertions were checked) was not changed and remains accurate — only the descriptive labels carry legacy wording.

---

## 5. Integrity Check of Unrelated Commit (0d36d534)

During this integrity check, commit `0d36d534` ("Planset review fixes: cover index DS rows + stale PV-2 refs") was reviewed to confirm it did not affect MFA, authentication, compliance documentation, database, or security code.

**Files changed (4):**
- `lib/permit/sections/coverSheet.ts` — added `equipmentDatasheetIndexRows()` import and spliced DS-n rows into the cover SHEET INDEX so it mirrors the page assembly.
- `lib/permit/sections/datasheetAppendix.ts` — added `equipmentDatasheetIndexRows()` function (cover-index row generator for the datasheet appendix).
- `lib/permit/sections/structuralPages.ts` — fixed a stale cross-reference: "see array layout on PV-2" → "PV-1" (PV-2 was folded into PV-1 on 2026-07-08).
- `lib/permit/sections/compliancePages.ts` — fixed a stale cross-reference: "ridge setback shown on PV-2" → "PV-1".

**Conclusion:** All four files are **solar permit-document generation code** (PDF page assembly for permit sets — cover sheets, equipment datasheets, structural pages, and building/fire-code compliance pages citing IFC §1204.2.1 and NEC). The file named `compliancePages.ts` refers to **solar code compliance pages** (IFC fire-access pathways, NEC electrical notes) in the permit PDF — it is **not** MFA/SOC 2/ISO 27001 compliance documentation. **No MFA code, authentication code, compliance evidence documents, database migrations, or security code were touched by commit `0d36d534`.** The commit is unrelated to MFA Phase 3 and had no bearing on the integrity of the frozen evidence artifacts.

---

## 6. Summary

- The acceptance test script and results JSON are **intentionally immutable frozen artifacts**. Their SHA-256 hashes are recorded above for tamper-evidence.
- The script's **legacy wording** (line 9 "real authenticator," line 572 "audit events written," line 485 recovery-count label) is **superseded** by the corrected acceptance record — the script was not edited because doing so would falsify provenance.
- The JSON received **metadata/notes corrections** (scope_notes, test_name, notes fields) but its test status values and evidence strings are unchanged.
- Commit `0d36d534` is **unrelated to MFA Phase 3** — it touched only permit-document generation code and did not affect any MFA, auth, compliance, database, or security files.
- **MFA Phase 3 remains CLOSED.** This note is an integrity attestation, not a reopening.

---

*This document is an internal evidence-integrity note. SolarPro is in SOC 2 readiness — NOT certified. Security controls are aligned with ISO 27001:2022 principles. All mappings are internal readiness assessments and have not been validated by an external auditor.*
