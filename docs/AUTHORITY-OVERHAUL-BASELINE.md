# PermitDesignSnapshot Authority-Overhaul — Final Baseline

**Baseline commit:** `c1dd42a7` (branch `dev`) — tagged `authority-overhaul-baseline`.
**Campaign:** W1 → W4.1, closed **2026-07-21**.

This records the closing baseline of the PermitDesignSnapshot authority overhaul:
the campaign that made the planset/permit engine derive every drawn and scheduled
value from a single canonical `PermitDesignSnapshot` (the reality engine), with
blocking permit-readiness validators wherever a value could not be sourced with
provenance.

## Campaign wave commits

| Wave  | Commit      | Summary |
|-------|-------------|---------|
| W1    | `2e2d5737`  | Snapshot foundation + structural projection; drawings read the snapshot. |
| W2    | `4bfbcfcc`  | Structural BOM from snapshot objects; V10 + BOM reconciliation validators. |
| W2.1  | `e3a54bf2`  | Evidence harness + truth matrix. |
| W3    | `b1506bd6`  | Structural engine wiring across sheets; permit-readiness blockers + digest. |
| W3.1  | `ab4bc180`  | Frozen acceptance fixture, coordinate-transform authority, parallel-path containment, racking provenance. |
| W4    | `a043f139`  | AHJ/code authority, project/cover authority, legacy-path removal, document + reconciliation authority. |
| W4.1  | `c1dd42a7`  | Roof Tech mounting topology correction (RT-MINI rail-paired). **← baseline** |

## Permanent regression gates

The following are permanent regression gates and MUST stay green (or, for the
fixture, byte-stable) on `dev`:

- **Immutable Braidon acceptance fixture** — the frozen original-audit fixture
  captured in W3.1. It is a fixed input; a drift in the snapshot/engine that
  changes its derived output is a regression, not an update.
- **Both evidence harnesses** — the dual-evidence wrappers that emit the
  snapshot + evidence artifacts and the truth matrix. They prove each drawn/
  scheduled value is snapshot-sourced with provenance.

Neither may be weakened or bypassed to make an unrelated change pass. Permit-
readiness blockers established across the campaign remain in force.

## Post-campaign migration console (2026-07-21)

After closure, the admin migration console (`app/admin/system-tools/migrations`)
retired the targeted **108** (Nearmap-index) and **109–112** (data-authority
backfill) cards and added a single governed **"Deploy authority registries —
migrations 113 + 114"** card with two independent, identifier-scoped one-click
buttons:

- **113** → `manufacturer_document_registry` (versioned authority-document store).
- **114** → `equipment_reconciliation_audit` + `snapshot_digest_invalidations`
  (immutable reconciliation-audit tables).

Both run through the same fail-closed targeted machinery as the 108 precedent
(exact-identifier hard allowlist `{'113','114'}`, capped TTL, super_admin + fresh
TOTP + reason + typed production confirmation, canonical runner, ledger + run-
history + actual-table verification, automatic relock, never advances the
historical baseline). Migrations 113/114 are idempotent `CREATE TABLE IF NOT
EXISTS` DDL; Ray runs 113 first (verify), then 114 (verify) from the deployed
console. The historical baseline remains **incomplete** — this deployment does
not complete or advance it.
