# SolarPro — Agent Operating Rules

> **Read `AI-AGENT-README.md` FIRST.** It is the canonical contract for the
> Solarpro system. This file is the **operating manual for the AI agent team**
> built on top of that contract. Where they conflict, the canonical doc wins.

---

## 0. Project

- **Project:** Solarpro (Next.js website at `solarpro.solutions` + site-survey
  mobile app + SAM2/MiDaS Python vision service on Render)
- **Maintainer of record:** Ray (`rayobrian6`)
- **Operator:** **JAMES** — owns this agent team. Every commit is attributed
  to JAMES. Every push needs his sign-off.
- **Status:** ~90% production-stable (per `AI-AGENT-README.md` §15, as of
  2026-05-18)

---

## 1. Read-First Order (every session, every agent)

1. **`AI-AGENT-README.md`** — system contract. Terminology, env vars, deploy
   topology, regression rules. Non-negotiable source of truth.
2. **`ENGINEERING_PIPELINE_DIRECTIVE.md`** — engineering master prompt.
   Defines the field-to-CAD data pipeline philosophy.
3. **Most recent `HANDOFF*.md`** in repo root — state of the work.
4. **`AI-AGENT-README.md` §11** — known open issues (F-13, F-18, GAP-3, GAP-4,
   GAP-K).
5. **This file** — agent rules.
6. **The per-agent `AGENT.md`** for whichever role you are.

If you skip any of the first four, you are guessing. Stop.

---

## 2. Standing Rules (8 hard)

### R1 — Never push to `master`
`master` deploys to production (`solarpro.solutions` / Vercel project
`solarpro-v31`). Every push to master needs explicit JAMES sign-off in chat.
Working branch is JAMES's call (see R4); `master` is the only hard ban.

### R2 — Three-check suite before every push
1. `npx tsc --noEmit --skipLibCheck` → 0 errors
2. `npx next lint` (or `npx eslint .`) → 0 errors
3. `npx vitest run` → all green, no skipped tests you introduced

This is per `AI-AGENT-README.md` §9 and `HANDOFF.md` standing rules.

### R3 — Terminology is enforced
Per `AI-AGENT-README.md` §0:
- **website** = the Next.js app (never "frontend", "app", "SolarPro app")
- **app** = the React Native / Expo site-survey mobile app (never "partner app")
- **website database** = Neon PostgreSQL (never `SOURCE_DATABASE_URL` in
  new code; that alias is allowed only when reading old references)
- **app database** = Render PostgreSQL (never `TARGET_DATABASE_URL` in new code)

Fix violations in your own output. Do not propagate them.

### R4 — Working branch is JAMES's call
JAMES picks the working branch per task. Any branch is fine —
`dev`, `feature/*`, `chore/*`, personal scratch, whatever — **except
`master`**. `master` is the production deploy branch and is the only
hard ban (see R1 and the no-go list).

**Note:** the canonical `AI-AGENT-README.md` §9 still says "always work
on `dev`." Per JAMES's 2026-06-19 standing instruction, that canonical
line is **overridden by this rule for this team's work**. We do not edit
the canonical doc to match — that drift is intentional and is itself
documented here. JAMES handles any canonical-doc update he wants.

### R5 — All geometry artifacts are REVIEW-ONLY
Every artifact from the depth / plane extraction / photogrammetry / mesh
pipeline carries the `REVIEW_ONLY_AUTHORITY` envelope. This includes:
- `DepthMap`
- `RoofPlaneCandidate`, `WallPlaneCandidate`
- `MeshArtifact`, `SfMPointCloud`
- Any future derived artifact

Never present as CAD. Never mark as authoritative. Never bypass the envelope.

### R6 — `feat:` commits are attributed to JAMES
**Feature commits (Conventional Commits `feat:`) must be authored and
committed as JAMES.** This is per JAMES's standing instruction — his name
goes on the user-facing work, not the plumbing.

| Commit type | Attribution |
|-------------|-------------|
| `feat:` | **JAMES** (author AND committer — mandatory) |
| `feat!:` (breaking) | **JAMES** (mandatory) |
| `fix:`, `refactor:`, `chore:`, `docs:`, `test:`, `build:`, `ci:`, `perf:` | whoever made the change |

The pre-push check (`.harness/scripts/prepush.ps1`) enforces this. It
extracts the commit type from the HEAD subject, and:
- **`feat:` / `feat!:`** → refuses to push unless `user.name` and the
  HEAD author/committer both start with `JAMES`
- **other types** → warns that attribution is non-JAMES, but does not
  block the push

**For `feat:` commits — set JAMES as the author/committer:**

```bash
# Set once per repo (persists in .git/config, not global)
git config --local user.name "JAMES"
git config --local user.email "<see .harness/secrets/james-git.env>"

# Verify before commit
git config --get user.name    # must print: JAMES
git config --get user.email   # must print: <james email>
```

For per-`feat:` commit override (e.g., when working on a `chore:` first
and only the next commit is `feat:`):
```bash
git -c user.name=JAMES -c user.email=<james-email> commit ...
```

Agents may add a `Co-authored-by:` trailer on any commit to credit their
work, including `feat:` commits.

### R7 — Only push to `james-dev` (Hard rule, JAMES 2026-07-13)
**`james-dev` is the only branch we push to in this repo.** This narrows
R4 (which leaves the working branch to JAMES per task) into a single,
fixed push target.

- ✅ `git push origin james-dev`
- ❌ `git push origin master` (also banned by R1)
- ❌ `git push origin dev`, `git push origin feature/*`, `git push origin chore/*`, `git push origin <anything-else>`
- ❌ force-push to any branch (also §3 hard no-go)
- ❌ `git push --all`, `git push --mirror`, or any bulk push

The single exception is if JAMES gives an explicit one-time green light
for a specific other ref (e.g., "push this to a feature branch for
review"). That exception is per-push and does not generalize.

Rationale: keeps all agent work on one reviewable branch, avoids
branch proliferation, makes revert/cherry-pick predictable.

### R8 — Branch hierarchy: work → `james-dev` → `dev` (Ray reviews) → `master` (JAMES approves)
**Added 2026-07-31 per JAMES's standing instruction. Amended 2026-08-01 by Ray to keep `dev` in the flow.**

The branch order of operations, top to bottom:

| Layer | Branch | Owner / review gate | Notes |
|---|---|---|---|
| Top | `master` | **JAMES** approves | Production deploy (`solarpro.solutions`). The only branch the website goes live from. Hard ban on autonomous push (R1). |
| Integration | `dev` | **Ray** (`rayobrian6`, maintainer of record per §0) reviews | The integration branch and Ray's default working branch. Auto-deploys to the Vercel `solarpro-dev` project (`solarpro-dev.vercel.app`), Ray's testing grounds. Everything reaches `master` through here. |
| Staging | `james-dev` | the implementer, then Ray | Where agent work lands and is reviewed before integration into `dev`. |
| Bottom | `feature/*`, `chore/*`, `fix/*` | the implementer | Short-lived. Land in `james-dev` when ready, delete the branch same task. Never accumulate 5+ stale branches. |

**Operating rules:**

1. **Working branch is `james-dev`** for all agent work, or a short-lived branch off it. If a task needs more than one commit, branch off `james-dev`, work, merge back, delete.
2. **Ray's "lgtm" / "ship" is what promotes `james-dev` into `dev`.** Ray is the technical/architectural review.
3. **`dev` → `master` is a deliberate promotion, not a fast-forward.** JAMES names the promotion in chat ("ship it to master", "deploy", or equivalent). This is the operator-level approval — Ray handles the technical side, JAMES handles the business/operational side. Nothing goes to `master` that has not first landed and been exercised on `dev`.
4. **No multiple feature branches accumulating.** A stale branch is one that has been merged (or should be) and not deleted. Goal: never more than 1-2 active feature branches at any time, and zero stale ones.
5. **Merging a feature branch into `james-dev` does NOT require JAMES's chat approval** — that's the working branch. Approval is needed for the `dev` → `master` promotion only.
6. **Legal push targets are `dev` and `james-dev`** (enforced by `.harness/scripts/prepush.ps1`). `master` is banned by R1.

**Rationale:** keeps the merge surface small and makes Ray's review surface predictable, while preserving `dev` as the integration branch that actually gets deployed and exercised before anything reaches production. Avoids the "12 stale feature branches" pattern that built up pre-2026-07-31.

---

## 3. Hard No-Go List (require explicit JAMES sign-off)

These actions are **never** autonomous. If a task seems to require any of
them, stop and surface to JAMES:

- Push to `master` (R1, also §3 of canonical doc)
- Rotate `SOLARPRO_HANDOFF_SECRET` or `SURVEY_WEBHOOK_SECRET` on either side
- Create, delete, or rename a Vercel project / Render service / database
- Modify any rule in `AI-AGENT-README.md` §10 (the regression rules)
- Create a new `sensitive`-type env var on Vercel production (causes the
  silent-override bug — see §5 and §10 R7 of canonical doc)
- Touch `app/api/auth/*`, `app/api/webhooks/*`, or `lib/survey/*` without
  reading §10 of the canonical doc first
- Run any schema migration against production databases
- Mark a geometry artifact as "CAD-ready", "authoritative", or
  "permit-grade"
- Bypass the `REVIEW_ONLY_AUTHORITY` envelope on any artifact
- Add an undocumented new env var
- Force-push, rebase pushed commits, or amend a pushed commit
- Trigger a Render or Vercel deploy (this is JAMES's action or requires
  his explicit "ship it" / "deploy" word in chat)

---

## 4. Pre-Flight Checklist (start of every task)

Run or manually verify these before any code change:

- [ ] `git status` — clean tree, or only your expected diff
- [ ] `git branch --show-current` — must NOT be `master` (R4)
- [ ] `git log --oneline -10` — no in-flight conflict
- [ ] `git config --get user.name` — must be `JAMES` (set if not)
- [ ] `git config --get user.email` — must be set to JAMES's email
- [ ] `pwd` (or `Get-Location` on Windows) — inside the Solarpro repo
- [ ] `Test-Path AI-AGENT-README.md` — canonical doc present
- [ ] Skim the canonical doc sections relevant to your task
- [ ] If the task touches §10 of the canonical doc — STOP and ask JAMES

`.harness/scripts/preflight.ps1` automates this.

---

## 5. Pre-Push Checklist (before `git push`)

In addition to the three-check suite (R2):

- [ ] Author and committer verified as JAMES (R6) — `.harness/scripts/prepush.ps1`
- [ ] No secrets in diff (`git diff` scan; `.env*` never committed)
- [ ] No new env var without a doc update in `AI-AGENT-README.md` §6
- [ ] No terminology violations in code, comments, or commit message
- [ ] No new dependency added without justification in commit body
- [ ] Commit message format: `type(scope): summary` per canonical doc §9
- [ ] HANDOFF doc updated if session produced a meaningful change
- [ ] JAMES has signed off in chat (strict mode, §7)

`.harness/scripts/prepush.ps1` automates the mechanical checks.

---

## 6. Handoff Convention

Every meaningful session ends with a handoff doc. Mirror the format of the
existing `HANDOFF.md` and `HANDOFF_v48_34.md`.

**Filename:** `HANDOFF_<topic>.md` (e.g., `HANDOFF_F13.md`,
`HANDOFF_gap3-step-c.md`).

**Sections:**
- **Standing Rules** — restate the relevant standing rules for the work
- **What Was Done** — bulleted list of changes
- **Current State** — branch, last commit, three-check status
- **Files Modified** — table of file:role
- **Pending Work** — what remains, in priority order
- **Architecture Notes** — anything future agents must know
- **Next Steps** — concrete, ordered

Commit the handoff doc in the same push as the work it describes.

---

## 7. Authority Model — STRICT

Per JAMES's standing instruction. There is **no autonomous push** in this team.

**Agents DO:**
- Read code, plan, propose
- Edit files locally
- Run the three-check suite
- Make local commits (authored as JAMES, per R6)
- Produce audit reports
- Surface work to JAMES for sign-off

**Agents DO NOT:**
- `git push` to any remote
- Call Vercel or Render deploy APIs
- Modify env vars
- Create / delete cloud resources
- Merge branches (JAMES's call — agents don't merge)

**The "ship it" word:** JAMES must say "push", "ship it", "deploy",
"merge", or equivalent in chat. If JAMES says "looks good" or "nice" without
that word, the agent pauses and confirms before acting.

---

## 8. Environment Detection

The repo supports both **sandbox** (`/workspace/solarpro-git/`, referenced
in the canonical doc) and **local Windows**
(`C:\Users\carpe\.minimax-agent\projects\Solarpro`). At session start, the
agent must:

1. Detect `pwd` / `Get-Location`
2. Confirm `package.json` is reachable
3. Confirm git remote is `https://github.com/rayobrian6/Solarpro.git`
4. Confirm `AI-AGENT-README.md` exists at repo root
5. Apply the JAMES git config (R6) if not already set
6. Report the detected environment to JAMES in chat

If any check fails, the agent stops and reports the environment mismatch.
Do not proceed in an unverified environment.

---

## 9. Escalation Triggers (stop and ask JAMES)

Stop and surface to JAMES if any of these occur during work:

- Touching any file under `app/api/auth/`, `app/api/webhooks/`,
  `lib/survey/`, `lib/auth/`, `db/`, `migrations/`
- Adding a new env var to Vercel or Render
- Any change to `AI-AGENT-README.md` (any section)
- Render or Vercel deploy failure (any cause)
- Three-check suite goes red after your change and you can't immediately
  fix it
- A test that was passing on the working branch now fails
- The user (JAMES) is silent for > 20 minutes on an open question
- A request that conflicts with the canonical doc
- A request to push to `master`

The default action on escalation is: **stop, summarize, wait.**

---

## 10. What This File Does Not Do

- It does not duplicate the canonical `AI-AGENT-README.md`. That doc is the
  spec. This file is the agent-team overlay.
- It does not define feature scope, product direction, or roadmap. That's
  JAMES's call.
- It does not override JAMES. If JAMES says "do X" and X conflicts with a
  rule here, JAMES wins. (R6 attribution and the no-go list still apply —
  flag the conflict, but proceed on his word.)

---

## 11. Ownership

- **Author of record:** JAMES (per R6)
- **Maintained by:** the agent team, on JAMES's instruction
- **Edit policy:** changes to this file require JAMES's sign-off in chat

---

*Last drafted 2026-06-19 by the agent team (Mavis / `mavis`) on JAMES's
instruction. See `.harness/AGENT_INDEX.md` for the team roster.*
