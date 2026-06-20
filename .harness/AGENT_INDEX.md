# Solarpro Agent Team — Roster

**Operator:** **JAMES** (every commit is attributed to JAMES)
**Mode:** **STRICT** — no autonomous push, no autonomous deploy, every
commit and every deploy needs JAMES's explicit sign-off in chat.

---

## Root orchestrator

**`Mavis`** (this Mavis instance) — coordinates the team, talks to JAMES,
holds the keys. Does not write code directly; routes work to the right
agent and surfaces deliverables for sign-off.

---

## Reins (workers)

| Agent | Role | Owned Domain | Writes Code? | Pushes? |
|-------|------|--------------|--------------|---------|
| `solarpro-implementer` | Main coder | `app/`, `components/`, `lib/`, `middleware.ts`, `db/`, `migrations/`, config files | YES (local only) | NO |
| `solarpro-vision` | Computer vision specialist | `sam2-service/`, `worker/`, `lib/.../workers/{depth,planeExtraction,photogrammetry,lineExtraction,segmentation}/`, `__tests__/`, `tests/` | YES (local only) | NO |
| `solarpro-reviewer` | Verifier | Reviews only — never writes | NO | NO |
| `solarpro-auditor` | Audit pass owner | Read-only scans, `AUDIT_*.md` reports | NO (writes audit docs only) | NO |

All workers must obey the root `AGENTS.md` and the per-agent `AGENT.md` in
their respective `.harness/reins/<name>/` directory.

---

## How a request flows

### Feature / bug fix flow

1. **JAMES** tells Mavis the goal in chat.
2. **Mavis** routes to `solarpro-implementer` (or `solarpro-vision` if the
   work is in the SAM2/MiDaS/photogrammetry domain).
3. **Implementer** reads the canonical docs, plans, edits files, runs the
   three-check suite, makes a local commit authored as JAMES.
4. **Mavis** surfaces the diff and the three-check result to JAMES.
5. **JAMES** says "push", "ship it", "deploy", or equivalent.
6. **Mavis** (or JAMES) runs the push with author/committer = JAMES.

### Audit flow

1. **JAMES** tells Mavis the audit scope.
2. **Mavis** routes to `solarpro-auditor`.
3. **Auditor** produces `AUDIT_<topic>_<YYYYMMDD>.md` in the existing style.
4. **Mavis** surfaces the report; no code changes flow from an audit
   without a separate feature request.

### Review flow

1. **Mavis** (or any implementer) calls `solarpro-reviewer` against a
   proposed diff.
2. **Reviewer** produces PASS / FAIL / NEEDS-DISCUSSION with citations
   to the canonical doc and the root `AGENTS.md`.
3. **Implementer** addresses the findings before surfacing to JAMES.

---

## Standing Rules (apply to every agent)

These are restated from the root `AGENTS.md`; see that file for full context.

- **R1** — Never push to `master`
- **R2** — Three-check suite before every push (`tsc` / `eslint` / `vitest`)
- **R3** — Terminology is enforced (see `AI-AGENT-README.md` §0)
- **R4** — Working branch is JAMES's call (only `master` is banned)
- **R5** — All geometry artifacts are REVIEW-ONLY
- **R6** — Commits attributed to JAMES

---

## How to add or remove a rein

JAMES's call. If a new role is needed (e.g., a "data engineer" for the
CAD pipeline), Mavis will draft a new `AGENT.md` under
`.harness/reins/<name>/`, add the row to the table above, and surface for
sign-off. Same for removals.

---

*Maintained by Mavis on JAMES's instruction. See `AGENTS.md` for the
standing rules.*
