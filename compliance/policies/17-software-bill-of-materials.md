# Software Bill of Materials (SBOM) Policy

| Field | Value |
|---|---|
| **Policy** | POL-IS-016 — Software Bill of Materials (SBOM) Policy |
| **Version** | 1.0 |
| **Effective date** | 2026-08-15 |
| **Owner (CISO)** | Raymond O'Brien |
| **Approver (Management)** | James Carpenter, Founder & CEO |
| **Last reviewed** | 2026-08-15 |
| **Next review** | 2027-08-15 (annual) or on material change (new framework, new format mandate, new audit requirement) |
| **Scope** | Every production build artifact produced by Solarpro — the Next.js application on Vercel, the SAM2 Python service on Render, and any future production service. Includes the application code, the runtime dependencies (npm + pip), the Docker base images, and the build toolchain. |

---

## 1. Purpose

This policy is the rule for **knowing what's inside every build we ship**. It's the **ISO 27001 A.5.9 (Inventory of information and other associated assets) + ISO 27001 A.8.9 (Configuration management) + ISO 27017 A.5.23 (cloud-specific inventory)** evidence: that Solarpro can produce, on demand, a machine-readable list of every third-party component in every production build, and that the list is correlated against known vulnerability feeds on every build.

The U.S. Executive Order 14028 ("Improving the Nation's Cybersecurity," May 2021) requires federal agencies to obtain SBOMs for software they procure, and the standard machine-readable formats are **CycloneDX** and **SPDX**. Federal contractors and any SaaS selling into the federal market are expected to provide SBOMs on request. This policy makes that obligation a repeatable, audited process at Solarpro — not a one-off scramble when a customer asks.

The auditor's question is not "do you have an SBOM?" — it's "can you produce an SBOM for the build I am auditing, correlated with the dependency vulnerability state at the time of that build, and archived in a way that survives the next build?" This policy answers that question.

The policy also calls out the current state honestly: **as of 2026-08-15, Solarpro does not yet auto-generate SBOMs on every build.** The CI integration is in scope for Sprint 1 (see §5). Until the CI integration lands, the SBOM production is a manual quarterly process using `npm sbom` (Node 18+) and `pip-licenses` for the Python service. The policy is in force; the automation is the open work.

## 2. Scope

This policy applies to every production build artifact:

- **The Next.js application** (the `app/` directory deployed to Vercel). Includes every `dependencies` and `devDependencies` entry in `package.json`, every transitive dependency, and the Node.js runtime itself.
- **The SAM2 Python service** (`sam2-service/` on Render). Includes every `requirements.txt` package, every transitive dependency, the ONNX runtime, the Python interpreter, and the Docker base image.
- **The worker** (the background worker at `worker/` on Render, if and when it ships to production). Same SBOM obligations as the SAM2 service.
- **Any future production service** (a new microservice, a new background job, a new CLI). The SBOM obligation applies from day one of production deployment.

**Out of scope:**

- **Developer tooling** that never ships to production — `node_modules` of developer-only scripts, `tools/`, `scripts/` that run on developer laptops, internal documentation tooling.
- **Customer data** — the SBOM is about what's in the build, not what the build processes. The Data Classification & Handling Policy (POL-IS-003) covers data.
- **Infrastructure dependencies** — Vercel, Neon, Render, Cloudflare, GitHub, Sentry. These are inventoried in the Vendor Risk Management Policy (POL-VEN-001) and the Third-Party Service Provider Policy (POL-VEN-002), not in the SBOM. The SBOM is the **build** inventory, not the **infrastructure** inventory.
- **Open-source license compliance** — while SBOMs include license information, the license-obligations workflow (attribution, copyleft handling) is a separate concern covered by the Engineering team's outbound licensing review, not by this policy.

## 3. The SBOM format

Solarpro produces SBOMs in **CycloneDX** as the primary format, with **SPDX** as the secondary format. The choice is documented:

- **CycloneDX** is the primary format because (a) it is the de-facto standard for application security and vulnerability correlation tooling (it natively maps to the OWASP Dependency-Check, Dependabot, Snyk, and GitHub Security Advisories data models), (b) it is the format most enterprise customers ask for first, and (c) it is the format with the lighter-weight tooling for Node.js (`@cyclonedx/cyclonedx-npm`) and Python (`cyclonedx-python-lib`).
- **SPDX** is the secondary format because (a) it is the Linux Foundation standard and the format some federal and regulated-industry customers specifically request, and (b) it is the format the Linux Foundation's `in-toto` and `TUF` supply-chain tooling natively consumes.

Both formats are produced for every production build. The two formats are not redundant — they cover different consumer ecosystems. The format choice is reviewed annually as part of the §7 review cadence.

### 3.1 CycloneDX format details

- **Version**: CycloneDX 1.5 (current as of 2026-08-15; updated to the current spec on every annual review).
- **JSON** is the canonical serialization. The CI uploads the CycloneDX JSON.
- **Minimum fields per component** (per CycloneDX 1.5 spec): `type`, `name`, `version`, `purl` (the package URL), and `licenses` (from the SPDX license list).
- **Recommended fields** (included when the tooling supports them): `hashes` (SHA-256 when the source is available), `copyright`, `supplier`, `externalReferences`.

### 3.2 SPDX format details

- **Version**: SPDX 2.3 (current as of 2026-08-15; updated to the current spec on every annual review).
- **JSON** is the canonical serialization. The CI uploads the SPDX JSON.
- **SPDX identifier**: `SPDXRef-DOCUMENT` for the SBOM document, `SPDXRef-Package` for each component, with the corresponding license expressions.

The two formats are produced from the same underlying dependency-resolution output to keep them in lockstep. The CI never produces one without the other.

## 4. Generation

Every production build is followed by an automated SBOM generation. The generation is part of the build pipeline, not a separate manual step.

### 4.1 When the SBOM is generated

- **On every commit to `master`** (the production branch). The build on Vercel and Render triggers the SBOM generation in the same CI run.
- **On every release tag** (e.g. `v1.2.3`). The release tag is the durable identifier the customer-facing SBOM URL is keyed off.
- **On every weekly scheduled build** (Sunday 06:00 UTC, alongside the existing weekly evidence-collection workflow). The weekly build ensures an SBOM is produced even if no commits land in a given week.

A failed SBOM generation **fails the build**. A build without an SBOM is not a production build. The principle: the SBOM is part of the artifact, not a follow-up.

### 4.2 How the SBOM is generated (Node.js — Next.js application)

The CI uses **`@cyclonedx/cyclonedx-npm`** to produce the CycloneDX SBOM and **`spdx-sbom-generator`** (or equivalent) to produce the SPDX SBOM. The generation runs after `npm ci` completes and before the build artifact is deployed. The commands:

```bash
# CycloneDX
npx @cyclonedx/cyclonedx-npm --output-format JSON --output-file sbom.cdx.json --spec-version 1.5

# SPDX
npx spdx-sbom-generator --output-format JSON.spdx.json --output-file sbom.spdx.json
```

Both outputs are uploaded to the evidence store (see §6) and the public URL (see §6.2).

### 4.3 How the SBOM is generated (Python — SAM2 service)

The CI uses **`cyclonedx-python-lib`** to produce the CycloneDX SBOM and **`spdx-tools`** (the Python implementation) to produce the SPDX SBOM. The commands:

```bash
# CycloneDX
cyclonedx-py -o sbom.cdx.json -F --spec-version 1.5

# SPDX
spdx-tools generate -o sbom.spdx.json
```

The Python SBOM generation runs inside the Docker build (so it sees the same dependency tree as the deployed image) before the image is pushed to Render.

### 4.4 Pre-Sprint-1 generation (the current state, 2026-08-15)

Until the Sprint 1 CI integration lands, the SBOM is produced manually on a quarterly cadence:

- **Node.js**: `npm sbom` (built into Node 18+) produces a CycloneDX-format SBOM from `package.json` and `package-lock.json`. The output is checked in to `compliance/sbom/nextjs-<YYYY-Q#>.cdx.json` by Raymond within 5 business days of quarter end.
- **Python**: `cyclonedx-py` is run by Cody against the locked `requirements.txt` and checked in to `compliance/sbom/sam2-<YYYY-Q#>.cdx.json`.
- **Both formats**: SPDX is produced on request only (federal-customer-driven) until the CI integration lands.

The manual process is documented at `compliance/sbom/MANUAL_GENERATION.md` (forthcoming). The first manual SBOMs are due by **2026-09-30** (end of Q3 2026).

## 5. The Sprint 1 CI integration (the open work)

The SBOM CI integration is in scope for Sprint 1 (per `PROGRAM.md` §2). The work is:

1. **Add `@cyclonedx/cyclonedx-npm`** as a dev dependency in `package.json`. Run `npm install`.
2. **Add `spdx-sbom-generator`** as a dev dependency. Run `npm install`.
3. **Create `.github/workflows/sbom.yml`** (or extend the existing `daily.yml` / `weekly.yml` workflows) to run the SBOM generation on every push to `master`, every release tag, and the weekly schedule. The workflow fails if the generation fails.
4. **Add `cyclonedx-python-lib` and `spdx-tools`** to the SAM2 service's `requirements.txt` (or as build-time-only dependencies in the Dockerfile).
5. **Add the SBOM generation step** to the Render Docker build. The step produces the SBOM and uploads it to the same evidence-store path the Node.js build uses.
6. **Add the manifest entries** to `compliance/manifest.json` for the new SBOM evidence sources (per the manifest's `evidence_sources` schema in `compliance/README.md`).
7. **Add a unit test** to `compliance/__tests__/` that asserts the SBOM file exists for the most recent `master` build and is parseable as CycloneDX 1.5 JSON.

The CI integration is owned by Cody (the technical lead) and reviewed by Raymond. The target completion is **end of Sprint 1** (per `PROGRAM.md` §2). Until the integration lands, the manual process in §4.4 is the operative procedure.

## 6. Storage and distribution

Every SBOM is stored in two places: the internal evidence store and the public SBOM endpoint.

### 6.1 Internal evidence store

The internal evidence store is the git repo at `compliance/sbom/`. The directory layout:

```
compliance/sbom/
├── nextjs/
│   ├── cdx/<release-tag>.cdx.json
│   ├── spdx/<release-tag>.spdx.json
│   └── index.json                 # latest SBOM pointer, updated on every build
├── sam2/
│   ├── cdx/<release-tag>.cdx.json
│   ├── spdx/<release-tag>.spdx.json
│   └── index.json
├── python-worker/                 # when applicable
│   └── ...
├── MANUAL_GENERATION.md           # the manual procedure for the pre-Sprint-1 window
└── README.md                      # the directory's operator guide
```

The directory is committed to the repo on every build (per the R2-to-git evidence-store decision in `compliance/README.md`). The commit message includes the release tag and a short summary. The commit author is the CI bot (with the `coder` identity per `AGENTS.md` R6).

Retention is **indefinite** for production builds. The audit-trail argument: the SBOM is needed to answer "what was in the build that was running on the day of the incident?" and the day of the incident may be years in the past. Storage growth is bounded by the build cadence (~1-2 builds per week × 2 services × 2 formats × ~500 KB per SBOM = ~100 MB per year, well within the repo's free tier).

### 6.2 Public distribution

Every SBOM is publicly available at **`https://solarpro.app/trust/sbom.json`** (the public CycloneDX JSON for the latest production build of the Next.js application) and **`https://solarpro.app/trust/sbom-sam2.json`** (the same for the SAM2 service). The two URLs are the customer-facing answer to "where is your SBOM?".

The public SBOM:

- **Includes no secrets.** The SBOM contains package names, versions, licenses, and hashes — nothing from the build's environment, source code, or runtime configuration. The build is reproducible from the SBOM (in principle) but the SBOM is not a build artifact, it's a manifest.
- **Is updated on every release tag.** The CI updates the public URL atomically on every release tag commit. The previous SBOM is archived in the internal store (the URL is version-keyed: `/trust/sbom-v1.2.3.json` for the historical view).
- **Is served with the standard security headers.** `Content-Type: application/json`, `Cache-Control: public, max-age=3600`, and the Solarpro standard CSP / HSTS headers (per the Security Headers configuration in the Vercel project).

The SAM2 service SBOM (`/trust/sbom-sam2.json`) is a "nice to have" and lands after the Next.js SBOM is live.

### 6.3 On-request distribution

For enterprise customers, federal procurement, or any other context where a versioned SBOM is needed (e.g. for a specific historical build), the on-request path is:

1. The requester emails `security@solarpro.app` (or the trust@solarpro.app public inbox) with the build identifier (release tag, deploy timestamp, or commit SHA).
2. Raymond verifies the requester's identity and the legitimacy of the request.
3. The SBOM is delivered as a signed attachment or via a time-limited signed URL, depending on the customer's preference.
4. The delivery is logged in the request register at `compliance/sbom/_requests/<year>.csv`.

For federal customers subject to EO 14028, the on-request path is the standard fulfillment mechanism (the public URL is the "self-service" view; the signed attachment is the "auditable" view).

## 7. Vulnerability correlation

The SBOM is most useful when it is **correlated against known vulnerability feeds** on every build. The correlation is the operational payoff: a build that ships with a known-CVE dependency is a build that should be caught before it ships, not after.

### 7.1 The feeds

The CI correlates every SBOM against:

- **GitHub Security Advisories** (the `github/advisories` GraphQL API, which Dependabot itself uses). This is the primary feed for npm and Python ecosystem CVEs.
- **The National Vulnerability Database (NVD)** via the `nvdtools` or `vuln-tool` libraries, as a secondary feed.
- **The CISA Known Exploited Vulnerabilities (KEV) catalog** (per `SECURITY_ADVISORY_DEPS.md` and `CONTROL_MATRIX.md` A.5.7) — any KEV-listed CVE in a Solarpro build is treated as a P0 finding regardless of CVSS score.

The feeds are queried on every build (the same CI run that produces the SBOM). The query result is stored as `compliance/sbom/<service>/vuln-scan/<release-tag>.json`.

### 7.2 The correlation output

The correlation produces a per-build report with:

- **Total components**: total number of distinct components in the SBOM.
- **Vulnerable components**: count of components with at least one known CVE.
- **Critical / High / Medium / Low**: count by severity, using CVSS v3.1 base scores.
- **KEV matches**: count of components matching the CISA KEV catalog.
- **Top vulnerable components**: the top 10 by severity, with the CVE IDs and the fixed version (when one exists).

The report is committed alongside the SBOM at `compliance/sbom/<service>/vuln-scan/<release-tag>.json` and is referenced from `compliance/monitoring/weekly-<YYYY-MM-DD>.md` (the existing weekly monitoring roll-up).

### 7.3 The build gate

A build with a **Critical** or **KEV** vulnerability **fails the deploy** until the dependency is updated or a documented exception is in place. The exception is a `compliance-exception` Linear issue with a 7-day maximum duration. The exception is approved by Raymond and disclosed to James.

A build with a **High** vulnerability deploys, but Raymond is notified within 1 business day and the dependency update is in the next sprint. A build with **Medium or Low** deploys and is rolled into the next dependency-update cycle.

The build gate is the **SOC 2 CC7.1 + ISO 27001 A.8.8** evidence: that Solarpro actively prevents the deployment of a build with a known critical vulnerability, not just that it produces an SBOM.

### 7.4 The pre-Sprint-1 correlation

Until the CI integration lands, the correlation is run manually on the same quarterly cadence as the SBOM generation:

- The manual correlation uses `npm audit --json` for the Next.js application and `pip-audit --json` for the SAM2 service.
- The output is checked in to `compliance/sbom/<service>/vuln-scan/<YYYY-Q#>.json`.
- A Critical or KEV finding in the quarterly scan triggers an immediate dependency update and a `compliance-exception` if the update cannot ship within 7 days.

## 8. Retention

The retention of SBOMs and vulnerability scan results is **indefinite for production builds**. The argument: the SBOM is the authoritative record of "what was in the build on the day of the incident," and the day of the incident may be years in the past. This aligns with the audit log retention in the Data Classification & Handling Policy (POL-IS-003 §6) and the Data Retention & Disposal Policy (POL-PRV-003 §4).

The retention of the **on-request delivery logs** is 7 years (matching the SOC 2 audit log retention). The retention of the **public SBOM** is "the latest" — the previous public SBOM is archived in the internal store but is no longer served at the public URL.

## 9. Roles and responsibilities

| Role | Person | Responsibilities |
|---|---|---|
| **CISO (Owner)** | **Raymond O'Brien** | Owns the policy. Reviews the quarterly manual SBOM and vulnerability scan (until the CI integration lands). Approves build-gate exceptions. Reviews the format and tooling choices annually. |
| **Technical lead** | **Cody** | Owns the Sprint 1 CI integration (§5). Owns the SBOM generation in the build pipeline. Owns the build gate (§7.3). |
| **Management sign-off** | **James Carpenter** | Approves the policy. Approves any decision to deviate from the standard formats or feeds. Approves the on-request delivery path for federal-customer requests. |

## 10. Exceptions

Exceptions to this policy follow the standard exception process in the Information Security Policy (POL-IS-001 §8):

1. **Documented** in a Linear issue tagged `compliance-exception` (and `sbom-exception` for filtering).
2. **Approved by Raymond** with a stated duration (max 90 days without re-approval for non-critical deviations; max 7 days for build-gate exceptions per §7.3).
3. **Disclosed to James** if the exception involves a Critical / KEV vulnerability or a customer commitment.

The most common exception in year 1 is "the CI integration has not landed; the manual quarterly process is in place." The exception is time-bounded to the Sprint 1 completion target.

## 11. Related documents

- `compliance/policies/01-information-security.md` §5 — risk management approach, exception process.
- `compliance/policies/07-vulnerability-management.md` — the broader vulnerability management program that this SBOM policy feeds into. The SBOM is the inventory side; the vulnerability management policy is the response side.
- `compliance/policies/10-vendor-risk-management.md` — the SaaS / infrastructure inventory. The SBOM is the build inventory; the vendor register is the infrastructure inventory.
- `compliance/policies/16-third-party-service-provider.md` (POL-VEN-002) — the people-side third-party policy. The SBOM is the build-side counterpart.
- `compliance/CONTROL_MATRIX.md` — A.5.9, A.8.9, A.8.8, CC7.1, CC8.1 current state and evidence.
- `compliance/manifest.json` — the manifest entries for the SBOM evidence (added in the Sprint 1 CI integration).
- `compliance/sbom/` — the SBOM storage directory.
- `compliance/sbom/MANUAL_GENERATION.md` — forthcoming manual procedure for the pre-Sprint-1 window.
- `compliance/sbom/_requests/<year>.csv` — the on-request delivery log.
- `compliance/monitoring/weekly-<YYYY-MM-DD>.md` — the weekly monitoring roll-up that references the SBOM vulnerability scan.
- `SECURITY_ADVISORY_DEPS.md` — the standing dependency-security advisory that predates this policy; this policy formalizes the SBOM and correlation side of the same workflow.
- `package.json`, `package-lock.json` — the Next.js dependency manifests.
- `sam2-service/requirements.txt` — the SAM2 dependency manifest.

---

## Approval signatures

| Role | Name | Signature | Date |
|---|---|---|---|
| **CISO (Owner)** | Raymond O'Brien | _________________________ | __________ |
| **CEO (Management sign-off)** | James Carpenter | _________________________ | __________ |

---

## Revision history

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0 | 2026-08-15 | compliance-lead (via legal-writer) | Initial issuance. Establishes CycloneDX (primary) and SPDX (secondary) as the SBOM formats; mandates automated generation on every production build with a failed-generation fails-the-build rule; commits to public distribution at `/trust/sbom.json`; defines the vulnerability correlation against GitHub Security Advisories, NVD, and the CISA KEV catalog; defines a build gate that blocks deployment on Critical or KEV findings. Calls out the current state honestly: as of 2026-08-15, the CI integration is not yet in place; the manual quarterly procedure (§4.4) is the operative process until Sprint 1 §5 lands. The first manual SBOMs are due 2026-09-30. |
