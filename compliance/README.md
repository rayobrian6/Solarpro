# Compliance — Self-Built Evidence Collection

This directory is the source of truth for Solarpro's compliance evidence
pipeline. It maps every control in
[`CONTROL_MATRIX.md`](./CONTROL_MATRIX.md) to the evidence artifacts that
prove we satisfy it, and is the first file imported by Vanta/Drata if
Solarpro ever migrates to a hosted compliance platform.

> **Status:** Sprint 1 — manifest + 6 collectors + 3 GitHub Actions
> workflows + 2 unit tests. All live on `feat/compliance-collectors`,
> awaiting James's review and push. See `HANDOFF_COMPLIANCE_COLLECTORS.md`.

---

## Storage decision (2026-07-30): git, not R2

**The design doc (`SELF_BUILT_SETUP.md` §1) assumed Cloudflare R2 as the
evidence store. As of 2026-07-30 (James's "no money yet" call) the store
is the git repo itself.** Specifically:

- Evidence is written to `compliance/evidence/<integration>/<YYYY-MM-DD>/<filename>`
  by the collector scripts.
- The 3 GitHub Actions workflows (hourly / daily / weekly) commit the
  evidence to the repo on schedule.
- The `manifest.json` `path_pattern` field is now templated as
  `compliance/evidence/<integration>/{date}/<filename>` (the old R2
  `evidence/<integration>/{date}/...` paths were migrated in this
  commit).
- The Terraform / R2 setup at `compliance/infra/r2-setup/` is now
  reference-only — the design remains valid for a year-2 migration if
  James wants to switch back to R2, but no R2 bucket is created.

### Why git, not R2

- **Zero hosting cost.** GitHub Actions free tier (2,000 min/mo) covers
  ~5 hourly + 5 daily + 1 weekly workflow with ~300 min/mo of usage.
  Evidence lives in the repo we already pay for.
- **Auditor access is just `git clone`.** No HMAC tokens, no
  Next.js proxy, no time-bounded subpath. The auditor's read access is
  the same as James's read access to the repo.
- **Free audit trail.** Every evidence write is a git commit. The
  author + commit SHA + message are the audit metadata. No extra
  log-and-archive step.
- **No data loss on a botched overwrite.** Git's own history replaces
  R2 versioning. Recovery is `git checkout <sha>`.

### Cost

- GitHub Actions: ~300 min/mo (well under the 2,000 min free tier).
- Repo storage: ~50 MB/yr of evidence (negligible).
- R2: $0 (no bucket; Terraform retained as design doc, not active).
- **Total: $0/mo** for the lifetime of the program. R2 was already
  under $5/mo at scale; the savings vs. R2 are $0–$60/yr.

### Trade-offs accepted

- **No R2 lifecycle (IA at 90d, expire at 7y).** Git history grows.
  Mitigated by `compliance/workflows/weekly.yml` rotating the
  `weekly-report.md` (the human-readable roll-up) and by archiving the
  old evidence outside git if repo size becomes an issue in year 3+.
- **No auditor-scoped access token.** The auditor sees the full repo.
  Acceptable for a SOC 2 / ISO 27001 audit where the auditor is
  engaged under NDA; not acceptable for sharing with a third party
  without an NDA. The `compliance/AUDITOR_GUIDE.md` documents this.

### Migration back to R2 (if James changes his mind)

The Terraform at `compliance/infra/r2-setup/` is the recipe. Run it,
mint the two API tokens, set `COMPLIANCE_R2_TOKEN` and
`COMPLIANCE_R2_AUDITOR_TOKEN` as GitHub Actions secrets, and replace
the local `writeEvidence()` calls with R2 PUTs. The manifest's
`path_pattern` already lives in the `compliance/evidence/...` namespace
that maps 1:1 onto the R2 `evidence/...` bucket prefix (just strip the
`compliance/` prefix when uploading). Estimated effort: 1 day.

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
| `monitoring/weekly-<YYYY-MM-DD>.md` | Weekly monitoring digests (committed by the weekly workflow). |
| `trust.json` | Public posture data consumed by `app/trust/page.tsx`. |
| `AUDITOR_GUIDE.md` | How an auditor reads the evidence (token issuance, control walk, evidence layout). |
| `collectors/` | The 6 evidence collectors + `common.mjs` (shared helpers). |
| `workflows/` | The 3 GitHub Actions workflows (hourly, daily, weekly). |
| `evidence/<integration>/<YYYY-MM-DD>/` | The collected evidence. Created by the collectors at runtime. |
| `infra/r2-setup/` | R2 Terraform (reference-only; not active in 2026-07-30 git-based build). |
| `__tests__/` | 2 vitest unit tests for the collectors. |

---

## The manifest

`manifest.json` is a JSON object with this shape (current version 2,
post-2026-07-30 R2-to-git migration):

```json
{
  "version": 2,
  "generated_at": "2026-07-31T00:02:00Z",
  "frameworks": ["SOC 2", "ISO 27001", "ISO 27701", "ISO 27017"],
  "_meta": {
    "evidence_pipeline": "Git-based evidence store (compliance/evidence/<integration>/<YYYY-MM-DD>/). Collector scripts under compliance/collectors/*.mjs run on GitHub Actions schedules per compliance/workflows/{hourly,daily,weekly}.yml. R2 (the design-doc plan) was replaced per James 2026-07-30 'no money yet' call."
  },
  "controls": {
    "CC1.1": {
      "title": "Demonstrates commitment to integrity and ethical values",
      "framework": ["SOC 2 CC1.1", "ISO 27001 A.5.1", "ISO 27001 A.5.2"],
      "current_state": "Partial",
      "evidence_sources": [
        { "path_pattern": "compliance/policies/01-information-security.md", "collector": "manual", "cadence": "annual" }
      ]
    },
    "CC7.1": {
      "title": "Detects and responds to security events, vulnerabilities, and anomalies",
      "framework": ["SOC 2 CC7.1", "ISO 27001 A.5.7", "..."],
      "current_state": "Gap",
      "evidence_sources": [
        {
          "path_pattern": "compliance/evidence/github/{date}/dependabot-alerts.json",
          "collector": "github.mjs",
          "cadence": "hourly",
          "workflow": "compliance/workflows/hourly.yml"
        },
        {
          "path_pattern": "compliance/evidence/db/{date}/audit-log.ndjson",
          "collector": "db-internal.mjs",
          "cadence": "hourly",
          "workflow": "compliance/workflows/hourly.yml"
        }
      ]
    }
  }
}
```

The `workflow` field on each evidence_source entry is a self-documenting
pointer to which GitHub Actions workflow produces that cadence. It is
advisory (the CI lint does not enforce it) but it makes the auditor's
"how is this evidence generated?" question trivial to answer without
reading code.

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
   for shared write/retry/hash helpers.
2. **Add a workflow entry** to one of the 3 existing workflows
   at `compliance/workflows/{hourly,daily,weekly}.yml` (preferred)
   OR create a new cadence workflow there. The workflow passes the
   right env vars and runs `node compliance/collectors/<name>.mjs`.
3. **Reference the collector** by name in `manifest.json`. The first
   time you do, the CI lint will fail with
   `collector "<name>.mjs" is not in the known collector set` — that's
   the signal to add it to `VALID_COLLECTORS` in
   `scripts/validate-compliance-manifest.mjs`. Do that in the same PR
   that adds the script.
4. **Add a unit test** to `compliance/__tests__/validate-collector-output.test.mjs`
   that lists your new collector's expected (integration, filename) pairs.
   The test will fail until the manifest agrees with the collector's
   output paths.

---

## The 6 collectors (and the 3 workflows that run them)

| Collector | Cadence | Output (per day) | Env vars required |
|---|---|---|---|
| `github.mjs` | hourly (Dependabot + secret scanning), daily (+ branch protection + members + 2FA), weekly (+ commit-signing sample) | `compliance/evidence/github/<date>/{branch-protection,members,dependabot-alerts,secret-scanning,commit-signing-sample}.json` | `GITHUB_TOKEN` |
| `vercel.mjs` | hourly (deployments), daily (+ projects + env-vars + members), weekly (+ 7d deployment history) | `compliance/evidence/vercel/<date>/{projects,deployments,env-vars,members}.json` | `VERCEL_TOKEN` (+ optional `VERCEL_TEAM_ID`, `VERCEL_PROJECT`) |
| `render.mjs` | hourly (service events), daily (+ deploys + env-vars + members) | `compliance/evidence/render/<date>/{deploys,events,env-vars,members}.json` | `RENDER_API_KEY` (+ optional `RENDER_OWNER_ID`, `RENDER_SERVICE_IDS`) |
| `neon.mjs` | daily (project + branches + roles + PITR + consumption) | `compliance/evidence/neon/<date>/{project,branches,roles,pitr,consumption}.json` | `NEON_API_KEY`, `NEON_PROJECT_ID` |
| `google-workspace.mjs` | hourly (failed-login spike), daily (users + MFA + admin roles), weekly (+ login-audit + drive-sharing + token-audit) | `compliance/evidence/google-workspace/<date>/{users-mfa,admin-roles,failed-login-spike,login-audit,drive-sharing,token-audit}.json` | `GOOGLE_WORKSPACE_TOKEN` (OAuth 2.0 with admin scopes) |
| `db-internal.mjs` | hourly (audit-log + webhook-deliveries new rows), daily (full tables + users + orgs summary) | `compliance/evidence/db/<date>/{audit-log,webhook-deliveries}.ndjson` + `{users,organizations}-summary.json` | `DATABASE_URL` (read-only role `compliance_ro`) |

### Schedule

| Workflow | Cron (UTC) | What it does |
|---|---|---|
| `compliance/workflows/hourly.yml` | `7 * * * *` (every hour at :07) | Calls `github.mjs`, `google-workspace.mjs`, `db-internal.mjs` in `hourly` mode. Commits the evidence diff. |
| `compliance/workflows/daily.yml` | `0 6 * * *` (06:00 UTC daily) | Calls `github.mjs`, `vercel.mjs`, `render.mjs`, `neon.mjs`, `google-workspace.mjs` in `daily` mode. Commits the evidence diff. |
| `compliance/workflows/weekly.yml` | `0 6 * * 0` (06:00 UTC Sunday) | All 6 collectors in `weekly` mode. Composes `compliance/monitoring/weekly-<date>.md` (human-readable roll-up). Emails James via Resend. Commits evidence + report. |

### Local dry-run

Every collector can be run locally with `DRY_RUN=1` for a sanity check
without hitting real APIs. The dry-run mode emits valid JSON (or empty
NDJSON for the audit-log collector) but does NOT write any file to
disk. Useful for verifying the manifest's path_pattern matches what the
collector actually produces.

```bash
# From the repo root:
DRY_RUN=1 node compliance/collectors/github.mjs daily
DRY_RUN=1 node compliance/collectors/vercel.mjs daily
DRY_RUN=1 node compliance/collectors/render.mjs daily
DRY_RUN=1 node compliance/collectors/neon.mjs daily
DRY_RUN=1 node compliance/collectors/google-workspace.mjs daily
DRY_RUN=1 node compliance/collectors/db-internal.mjs hourly
```

In non-DRY_RUN mode (the default in the GitHub Actions workflows), the
collector writes the file to disk and returns the repo-relative path it
wrote. The workflow then commits the diff.

### Required GitHub Actions secrets

| Secret | Used by | Notes |
|---|---|---|
| `COMPLIANCE_GITHUB_TOKEN` | hourly, daily, weekly | Fine-grained PAT, scope: `repo`, `admin:org`, `security_events` |
| `COMPLIANCE_VERCEL_TOKEN` | daily, weekly | Vercel API token, project + team scope |
| `COMPLIANCE_VERCEL_TEAM_ID` | daily, weekly | Optional; the team id (read from Vercel dashboard) |
| `COMPLIANCE_RENDER_API_KEY` | hourly, daily, weekly | Render API key (read-only) |
| `COMPLIANCE_RENDER_OWNER_ID` | hourly, daily, weekly | Optional; the Render team / owner id |
| `COMPLIANCE_NEON_API_KEY` | daily, weekly | Neon API key |
| `COMPLIANCE_NEON_PROJECT_ID` | daily, weekly | The Neon project id |
| `COMPLIANCE_GOOGLE_WORKSPACE_TOKEN` | hourly, daily, weekly | OAuth 2.0 access token with admin.directory.* + admin.reports.audit.readonly scopes. Minted by a service account. |
| `COMPLIANCE_DATABASE_URL` | hourly, daily, weekly | The connection string for the read-only `compliance_ro` role. Created in Sprint 1. |
| `RESEND_API_KEY` | weekly (email) | Already in repo secrets; used for the weekly email |

The 2 unit tests in `compliance/__tests__/` are run by
`.github/workflows/compliance-manifest-lint.yml` (the existing CI lint
from `chore/compliance-manifest`). The new vitest include pattern in
`vitest.config.ts` covers `compliance/__tests__/**/*.test.mjs`.

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
