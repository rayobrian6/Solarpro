# System Config (Engineering page) — Finish Line

The north-star spec for `app/engineering/page.tsx`. Agreed with Ray 2026-07-13.

## North star
A contractor drops a hybrid design from Design Studio and, in under a minute, sees
ONE honest per-subsystem picture — every number matches the design, each subsystem
shows its own equipment, and the system recommends the right inverter/strings per
subsystem. No conflicting numbers, no "EcoFlow on a roof", no guessing which
strings go where.

## Pillars (✓ = shipped)
1. **Numbers never lie** ✓ — header/summary/pipeline read the design; fleets
   self-heal from the CAD layout (Stage 1-2, commits c7e7e8f6 / 0e080cfd).
2. **Organized BY subsystem** — STRING LAYOUT groups inverters under ROOF /
   GROUND / FENCE, each block labeled with its sub + model + count; each
   subsystem card is the complete edit surface.
3. **Per-sub recommendation engine** — size each present sub independently (its
   count, its brand) → per-sub recommendation (model, count, string split) with a
   per-sub "Recommended vs Current" diff + one-click apply PER SUB. Marginal /
   MPPT warnings attach to the sub they're about, not the whole system. Fixes
   "EcoFlow on roof" (roof recommends micros; ground/fence recommend hybrids).
4. **Multi-brand via per-sub** — the ecosystem picker is mono by nature; the real
   multi-brand mechanism = per-sub recommendations + per-sub inverter dropdowns
   (roof=Enphase, ground=EcoFlow, fence=SolFence, each independent). Mono picker
   stays a "quick apply one brand to all" convenience. (Decision: NO dedicated
   per-sub brand-picker UI.)
5. **Guided validity (idiot-proof)** — every present sub always has a valid fleet;
   empty/wrong subs get one obvious CTA; validation surfaces per sub where it
   originates.
6. **Downstream integrity** — computedMulti → SLD/BOM/permit already read per-sub;
   single-system path stays byte-identical (every hybrid branch is behind
   `subSystemCounts.isHybrid`).

## Workstreams
- **W1 — STRING LAYOUT sub labels**: group + label inverter blocks by
  ROOF/GROUND/FENCE (+ per-sub subtotal).
- **W2 — Per-sub recommendation engine**: per-sub sizing, per-sub Recommended vs
  Current diff + apply (routes through the per-sub builder — never a whole-project
  collapse), per-sub marginal/MPPT warnings. Replaces the whole-project banner
  (currently hidden for hybrids).
- **W3 — Idiot-proof pass**: empty-sub CTAs ("GROUND needs an inverter →
  recommend"), per-sub validation surfacing, mono picker's hybrid framing.

## Rollout
Stage each workstream → verify logic against the REAL Stowell Neon row
(`_tmp_heal_verify.ts`, project 4d720c49…) + `tsc --noEmit` → push to dev → Ray
verifies live on solarpro-dev. Single-system unaffected each time.

## Decisions locked (2026-07-13)
- Multi-brand = per-sub recs + per-sub dropdowns (no dedicated per-sub brand picker).
- Scope = W1 + W2 + W3 (full finish line).
- Rollout = stage + push to dev, Ray tests live.
