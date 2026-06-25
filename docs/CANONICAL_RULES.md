# SolarPro — Canonical Rules Pointer

> **This file is a pointer, not a copy.** The single source of truth for the
> Solarpro system is `AI-AGENT-README.md` at the repo root. Every agent MUST
> read that file before doing any work. If the content of this pointer
> conflicts with `AI-AGENT-README.md`, the canonical doc wins.

---

## The one document every agent reads first

**[`AI-AGENT-README.md`](../AI-AGENT-README.md)** — version 1.1.0, 558 lines,
maintained by Ray. It defines:

- §0 — Mandatory terminology (website / app / website database / app database)
- §1 — Repos & local paths
- §2 — Access tokens (the redacted reference keys)
- §3 — Deployments & URLs (Vercel `solarpro-v31` vs `solarpro-dev`; Render
  `srv-d746gvshg0os739tqm70`)
- §4 — Databases (Neon vs Render Postgres; credential authority rule)
- §5 — Shared secrets that must match on both sides
- §6 — All env vars (the live state of Vercel + Render)
- §7 — Data flow (survey ingest, handoff, SSO)
- §8 — Key file map
- §9 — Commit & deployment rules (including the three-check suite)
- §10 — **Regression rules** — never break these
- §11 — Known open issues (F-13, F-18, GAP-3, GAP-4, GAP-K)
- §12 — How to test a webhook end-to-end
- §13 — Database sync (credential authority direction)
- §14 — How agents should pick up commit context
- §15 — Production readiness status

If `AI-AGENT-README.md` and the agent-team `AGENTS.md` ever disagree, the
canonical doc wins, and the agent should flag the disagreement to JAMES for
resolution.

---

## The agent-team overlay

For agent-team behavior on top of the canonical rules, see
[`AGENTS.md`](../AGENTS.md) at the repo root. That file is the standing
rules for the Mavis agent team: terminology, three-check suite, dev/master
gating, JAMES attribution, pre-flight / pre-push checklists, escalation
triggers, and the strict authority model.

---

## Other sacred docs (read when relevant)

- **`ENGINEERING_PIPELINE_DIRECTIVE.md`** — the engineering master prompt.
  Defines the field-to-CAD data pipeline philosophy. Read before any work
  that touches `project_physical_data`, surveys, or the engineering output.
- **Most recent `HANDOFF*.md`** — current state of the work.
- **`docs/STAGE7_CONSOLIDATION_ASSESSMENT.md`** and other `docs/stage*-todo.md`
  files — current stage work.
- **`docs/CAD_ENGINE_COMPLETION_ROADMAP.md`** — if the work is on the CAD
  permit plan set.
- **`docs/SITE_SURVEY_SSO_CONTRACT.md`** — if the work touches SSO or
  handoff.

---

## When in doubt

Stop, read the canonical doc, then read the relevant per-agent
`AGENT.md` in `.harness/reins/`, then ask JAMES.
