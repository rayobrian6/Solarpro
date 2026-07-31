# Compliance — Self-Built Evidence Collection

This directory is the source of truth for Solarpro's compliance evidence
pipeline. It maps every control in
[`CONTROL_MATRIX.md`](./CONTROL_MATRIX.md) to the evidence artifacts that
prove we satisfy it, and is the first file imported by Vanta/Drata if
Solarpro ever migrates to a hosted compliance platform.

> **Status:** Sprint 1 (manifest + CI lint). Collector scripts
> (`compliance/collectors/*.mjs`) land in Sprint 1 alongside this work
> per [`SELF_BUILT_SETUP.md` §2](../.mavis/agents/compliance-lead/workspace/SELF_BUILT_SETUP.md).

---

## Files in this directory

| Path | Purpose |
|---|---|
| `manifest.json` | The evidence-to-control map. The canonical input to Vanta/Drata at migration time. |
| `CONTROL_MATRIX.md` | Snapshot of the canonical control matrix (84 controls). Updated from `~/.mavis/agents/compliance-lead/workspace/CONTROL_MATRIX.md` when the working copy changes. |
| `README.md` | This file. |
| `policies/` | The 30 Solarpro security/privacy policies (POL-IS-001 through POL-CM-003). 4 are in place; 26 are drafted in Sprint 1–2. |
| `vendors.csv` | Vendor risk register (15 criticality-rated vendors; signed DPAs and SOC 2 reports). |
| `vendors/<vendor>/` | Per-vendor subdirectories holding the SOC 2 report, DPA, and quarterly review notes. |
| `uar/<YYYY-Q#>/report.md` | Quarterly user access review (UAR) reports. |
| `monitoring/weekly-<YYYY-MM-DD>.md` | Weekly monitoring digests. |
| `trust.json` | Public posture data consumed by `app/trust/page.tsx`. |
| `AUDITOR_GUIDE.md` | How an auditor reads the evidence (token issuance, R2 layout, control walk). |

---

## The manifest

`manifest.json` is a JSON object with this shape:

```json
{
  "version": 1,
  "generated_at": "2026-07-30T22:00:00Z",
  "frameworks": ["SOC 2", "ISO 27001", "ISO 27701", "ISO 27017"],
  "controls": {
    "CC1.1": {
      "title": "Demonstrates commitment to integrity and ethical values",
      "framework": ["SOC 2 CC1.1", "ISO 27001 A.5.1", "ISO 27001 A.5.2"],
      "current_state": "Partial",
      "evidence_sources": [
        { "path_pattern": "compliance/policies/01-information-security.md", "collector": "manual", "cadence": "annual" }
      ]
    }
  }
}
```

### Current state values

- **`Implemented`** — the control is in place and the evidence is live
  (e.g. a code file or a published policy).
- **`Partial`** — the control is partly in place; some evidence exists
  but the gap is tracked. Manifest points to where evidence WILL live.
- **`Gap`** — the control is not in place; the evidence paths in the
  manifest are the **future-state contract** that the collector work
  must deliver. Auditors will read the manifest as the "where we're
  going" statement, not the "where we are."
- **`Not Applicable`** — the control does not apply to Solarpro. Set
  `not_applicable: true`, provide a `not_applicable_reason`, and leave
  `evidence_sources: []`. The CI lint enforces that N/A controls have
  no evidence sources.
- **`Not assessed`** — the control has not been audited yet. Set
  `not_assessed: true`, provide a `not_assessed_note` describing what
  additional gap assessment is required, and leave `evidence_sources: []`.

### Evidence source fields

Each entry in `evidence_sources[]` has three required fields:

- **`path_pattern`** — where the evidence lives. Use `{date}` as a
  placeholder for the collector's run date (e.g.
  `evidence/github/{date}/branch-protection.json`). For policies and
  human-maintained files, use the actual repo-relative path
  (e.g. `compliance/policies/01-information-security.md`).
- **`collector`** — who/what produces the evidence. One of:
  - `github.mjs`, `vercel.mjs`, `render.mjs`, `neon.mjs`,
    `google-workspace.mjs`, `db-internal.mjs` — the six integration
    collectors (live in `compliance/collectors/` per SELF_BUILT_SETUP.md)
  - `compliance-uar.mjs`, `compliance-monitoring.mjs`,
    `compliance-trust.mjs`, `compliance-vendor.mjs`,
    `compliance-policies.mjs`, `auditor-access.mjs` — the planned
    compliance-package helpers
  - `source-code` — the file IS the evidence (used for code-level
    controls that point at `lib/auth.ts`, `lib/migrations/runner.ts`,
    etc.)
  - `manual` — human-maintained (policies, vendor register, risk
    register, etc.)
  - Any new collector MUST be added to the
    `VALID_COLLECTORS` set in
    `scripts/validate-compliance-manifest.mjs` in the same PR. The
    CI lint fails the build if a manifest entry references an unknown
    collector — this is intentional friction.
- **`cadence`** — how often the evidence is refreshed. One of:
  `hourly`, `daily`, `weekly`, `monthly`, `quarterly`, `annual`,
  `on-demand`, `manual`. The cadence is what the auditor sees when
  they ask "how recent is this evidence?" — a stale daily snapshot
  is itself a finding.

---

## How to add a new control

When the compliance matrix grows (e.g. a new framework, or a control
moves from "Not assessed" to "Partial"):

1. **Add the row to `CONTROL_MATRIX.md`.** Use the same table format as
   the existing rows. The CI lint parses the first cell of every
   markdown table row to discover the control ID — so the row must
   start with `| <ID> |` where `<ID>` matches the regex in
   `extractControlIdsFromMatrix()` (e.g. `CC1.1`, `A.5.34`,
   `6.2.1 / A.5.34`).
2. **Add the control to `manifest.json`** with the same ID as the
   matrix row. Provide:
   - `title` — short human description (matches the matrix's
     Description column).
   - `framework` — array of canonical framework IDs, e.g.
     `["SOC 2 CC6.6", "ISO 27001 A.5.15"]`.
   - `current_state` — one of `Implemented`, `Partial`, `Gap`,
     `Not Applicable`, `Not assessed`.
   - `evidence_sources` — array, or `[]` if N/A / not assessed.
3. **Run the validator locally** to confirm:
   ```bash
   node scripts/validate-compliance-manifest.mjs
   ```
   Exit 0 = success. The CI workflow at
   `.github/workflows/compliance-manifest-lint.yml` runs the same
   check on every PR.

If you're adding a brand-new framework tag (e.g. ISO 42001 for AI
management), add it to the top-level `frameworks` array and update
the list above.

---

## How to add a new evidence source

For an existing control that needs more evidence:

1. **Edit the control's `evidence_sources` array** in `manifest.json`.
   Each entry must have `path_pattern`, `collector`, and `cadence`.
2. **If the source uses a new collector**, add the collector name to
   `VALID_COLLECTORS` in `scripts/validate-compliance-manifest.mjs`.
   The validator treats unknown collectors as errors (intentional
   friction).
3. **If the source needs a new cadence**, add it to `VALID_CADENCES`.
   Cadences are the second-most-common drift bug after missing
   collectors — keep the list small.
4. **If the source is a file path the repo doesn't have yet**, that's
   fine. The manifest is a future-state contract; the file lands in
   the same sprint or later. The CI lint does NOT verify file
   existence — that would couple the lint to the collector delivery
   schedule and make every "evidence not yet collected" look like a
   build failure. A separate weekly job will verify that the
   collector output exists; that's not in scope for this lint.

---

## How to add a new collector script

1. **Create `compliance/collectors/<name>.mjs`** (plain Node 20 ESM,
   no TypeScript build step). Use `compliance/collectors/common.mjs`
   for shared R2 upload, manifest update, and retry helpers.
2. **Add a schedule workflow** at
   `compliance/schedules/<cadence>.yml` referencing the collector.
3. **Reference the collector** by name in `manifest.json`. The first
   time you do, the CI lint will fail with
   `collector "<name>.mjs" is not in the known collector set` — that's
   the signal to add it to `VALID_COLLECTORS` in
   `scripts/validate-compliance-manifest.mjs`. Do that in the same PR
   that adds the script.

---

## Migration to Vanta/Drata

When James decides to migrate (program doc: year 2, after SOC 2 Type 1
ships), the work is a **2–4 week config-and-import project**, not a
rewrite. The migration plan (per
[`SELF_BUILT_SETUP.md` §10](../.mavis/agents/compliance-lead/workspace/SELF_BUILT_SETUP.md)):

1. Sign the platform contract and create the org (1 week).
2. Connect the platform's native integrations to GitHub, Vercel,
   Render, Neon, Google Workspace (1 day).
3. Create the platform's S3 integration pointing at the R2 bucket
   `solarpro-compliance-evidence` — the platform ingests the entire
   7-year history (1 day).
4. **Import `manifest.json`** into the platform's control-mapping
   wizard. The schema matches Vanta's "Build Integrations API" and
   Drata's "Compliance-as-Code" expected shape. The platform's wizard
   uses the control IDs as-is (`CC1.1`, `A.5.34`, `6.2.1`) and uses
   `path_pattern` as the evidence-URI template (1 day).
5. Upload `policies/` markdown into the platform's policy module;
   frontmatter maps to the platform's policy fields (2 days).
6. Upload `vendors.csv` (0.5 day).
7. Migrate the Trust Center from `app/trust/page.tsx` to the
   platform's hosted version (1 day).
8. Decommission the in-repo collectors and the `compliance-uar.mjs`
   script after the platform's modules are live. Keep the R2 bucket
   and the `manifest.json` in git as a 7-year historical archive
   (1 day).
9. Run platform in parallel for 7 days; cross-check; sign off
   (1 week).

The manifest is the load-bearing file in this migration. If it's
accurate, the migration is 2 weeks. If it's drifted from reality, the
migration is 2 months. The CI lint enforces "accurate" by blocking
PRs that introduce an unmappable control.

---

## Why we self-built (one-paragraph)

Per James's 2026-07-30 decision recorded in
[`PROGRAM.md`](../.mavis/agents/compliance-lead/workspace/PROGRAM.md),
we skipped Vanta/Drata and self-build the evidence collection layer
on three load-bearing pillars: **Cloudflare R2** as the S3-compatible
evidence store (chosen for Vanta/Drata portability and zero-egress
economics), a fleet of **GitHub Actions–scheduled collector scripts**
that hit the GitHub/Vercel/Render/Neon/Google Workspace/internal
Postgres APIs, and **this versioned `manifest.json`** that maps every
evidence artifact to a control. Total hosting stays under $10/mo. The
trade-off is operational burden: ~30 min/wk to review the weekly
monitoring email, and quarterly UAR runs. Migration to a platform
remains a 2–4 week config-and-import project whenever James
chooses.

---

## Open follow-ups (out of scope for this lint)

- A second CI job that verifies the collectors' output actually
  appears in R2 (so a silently-failing GitHub Actions schedule gets
  caught). Tracked as a Sprint 1 collector task.
- A Trust Center page at `app/trust/page.tsx` that consumes
  `trust.json` and shows posture. Tracked as a Sprint 1 design task.
- A pen test in Sprint 1–2 (per `PROGRAM.md` §6). The manifest will
  pick up `evidence/pen-test/<YYYY>/report.pdf` once the test
  completes.
