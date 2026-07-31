# Solarpro — Shared Responsibility Matrix (cloud/)

> **Canonical policy:** `compliance/policies/25-shared-responsibility-matrix.md` (the source of truth — reviewed and signed off by James and Raymond).
>
> **This file** is the versioned, table-only copy. It is the file the team updates when a provider changes. The change here is a PR; the change to the canonical policy is a re-sign by James and Raymond. The two are kept in sync.

**Generated:** 2026-08-15
**Owner (CISO):** Raymond O'Brien
**Approver (Management):** James Carpenter
**Maps to:** SOC 2 CC6.6 · ISO 27017 A.5.23

---

## Legend (RACI, cloud-adapted)

| Symbol | Meaning |
|---|---|
| **R** | **Responsible** — the party that does the work. |
| **S** | **Shared** — both parties contribute; the boundary is documented in Policy #25 §4. |
| **A** | **Accountable** — the party that owns the outcome. **For Solarpro, A is always Solarpro** (we own the outcome for any control that affects our data, our customers, or our compliance posture). For the vendor, A is the vendor (the vendor owns the vendor-side controls). |
| **I** | **Informed** — the party that is notified but does not perform the control. |

A dash (`—`) means the control area does not apply to that vendor (the vendor is stateless for that area, or the control is not relevant to the integration).

## The matrix

8 control areas × 12 vendors + Solarpro = 13 columns × 8 rows = 104 cells.

| Control area | Vercel | Neon | Render | Cloudflare | GitHub | GCP | OpenAI | Anthropic | Stripe | Resend | Sentry | R2 | **Solarpro** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Data at rest encryption** | — (stateless) | R, A | R, A (ephemeral) | S, A (R2 IAM is Solarpro's) | I, A | — (read-only) | — (stateless; see Policy #25 §4.7) | — (stateless; see Policy #25 §4.8) | — (tokenized) | — (stateless) | — (Sentry's) | R, A | **A** (app-level bcrypt / AES-256-GCM / HMAC) |
| **Data in transit encryption** | R, A (TLS 1.2+; HSTS) | R, A (TLS; `sslmode=require`) | R, A (TLS 1.2+ in/out) | R, A (TLS 1.2+; "Full" SSL) | R, A (TLS 1.2+) | R, A (TLS 1.2+) | R, A (TLS 1.2+) | R, A (TLS 1.2+) | R, A (TLS 1.3) | R, A (TLS 1.2+; MTA-STS) | R, A (TLS 1.2+) | R, A (TLS 1.2+) | **A** (app-level HMAC + JWT) |
| **Application code security** | I, A (Vercel scans deps) | I, A | I, A (Render scans image) | I, A | R, S (Dependabot + CodeQL) | I, A | I, A | I, A | I, A | I, A | I, A | I, A | **R, A** (Policy #01, #17, #23) |
| **Runtime / OS patching** | R, A (Node + host OS) | R, A (Postgres + compute) | S, A (Render: host; Solarpro: Docker + Python) | R, A | R, A (Actions runtime; Solarpro: `.nvmrc`) | R, A | R, A | R, A | R, A | R, A | R, A | R, A | **A** (Docker base image per Policy #23) |
| **Network security** | S, A (edge FW; WAF via Cloudflare) | R, A (network isolation; IP allowlist) | R, A (network isolation) | R, A (DNS + WAF + DDoS) | R, A (network isolation) | R, A (API gateway) | R, A (API gateway) | R, A (API gateway) | R, A (API gateway) | R, A (API gateway) | R, A (API gateway) | R, A (gateway) | **A** (app-level rate limit; WAF rules) |
| **Physical security** | R, A (SOC 2) | R, A (SOC 2) | R, A (SOC 2) | R, A (SOC 2) | R, A (SOC 2) | R, A (SOC 2) | R, A (SOC 2) | R, A (SOC 2) | R, A (SOC 2) | R, A (SOC 2) | R, A (SOC 2) | R, A (SOC 2) | **I, A** (informed via vendor SOC 2) |
| **Identity & access management (IAM)** | S, A | S, A (DB users) | S, A | S, A | S, A | S, A | — (API key is the IAM) | — (API key is the IAM) | S, A | S, A (API key) | S, A | S, A (API token) | **R, A** (Policy #03, #15) |
| **Audit logging & monitoring** | S, A (deploy logs; Solarpro: app audit) | S, A (query logs; app audit) | S, A (service logs; app audit) | S, A (edge logs; export to R2) | S, A (Actions + audit log; digest) | S, A (API logs; export) | S, A (usage logs; cost alert) | S, A (usage logs; cost alert) | S, A (webhook logs; app audit) | S, A (email logs; app audit) | S, A (error logs; alert routing) | S, A (access logs; export) | **R, A** (Policy #08) |

## The vendor roster (12)

| # | Vendor | Service | Role | Tier | SOC 2 report on file | DPA on file |
|---|---|---|---|---|---|---|
| 1 | Vercel | Compute + edge | App hosting | 1 | Yes (Policy #10 §4) | Yes (Policy #16 §5) |
| 2 | Neon | Postgres | Database | 1 | Yes | Yes |
| 3 | Render | Docker | SAM2 + worker | 1 | Yes | Yes |
| 4 | Cloudflare | DNS + CDN | Network | 1 | Yes | Yes |
| 5 | GitHub | Source + CI/CD | Source control | 1 | Yes | Yes |
| 6 | Google Cloud Platform | Solar API + Maps | Data enrichment | 1 | Yes (GCP's) | Yes (GCP's) |
| 7 | OpenAI | Vision API | AI inference | 1 | Yes (Tier 1) | **Pending** (P0 in control matrix) |
| 8 | Anthropic | Vision API | AI inference | 1 | Yes (Tier 1) | **Pending** (P0 in control matrix) |
| 9 | Stripe | Payments | Billing | 1 | Yes | Yes (Stripe's standard DPA) |
| 10 | Resend | Email | Transactional | 2 | Yes | Yes |
| 11 | Sentry | Error monitoring | Observability | 2 | Yes | Yes |
| 12 | Cloudflare R2 | Object storage | Evidence | 2 | Yes (Cloudflare's) | Yes (Cloudflare's) |

The full vendor row (with the SOC 2 report date, the DPA status, the data classification, the contract renewal date) is in `compliance/vendors.csv`. The DPA-status column is the open-work tracker; the OpenAI + Anthropic + GCP rows are the 3 open Tier 1 DPAs that the Vendor Risk Management Policy (#10) §5.2 tracks.

## How to update this file

When a vendor is added, removed, or re-scoped:

1. Update the §"The matrix" table (add a row, remove a column, or change a cell).
2. Update the §"The vendor roster" table (add or remove the vendor).
3. Update the per-vendor notes in Policy #25 §4 (the canonical policy).
4. Open a PR with the changes. Tag Raymond for CISO review. Tag James for management sign-off.
5. The merge commit becomes the audit artifact of the change.
6. The `compliance/vendors.csv` and Policy #24 §2 are updated in the same PR (or a follow-up PR).

A change to this file without a corresponding change to Policy #25 is a documentation drift; a change to Policy #25 without a corresponding change to this file is the same. The two are kept in sync by the PR review.

## Change log

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0 | 2026-08-15 | compliance-lead (via legal-writer) | Initial issuance. 8 control areas × 12 vendors + Solarpro. The matrix is the per-vendor deep-dive for ISO 27017 A.5.23. The canonical policy is `compliance/policies/25-shared-responsibility-matrix.md`. |
