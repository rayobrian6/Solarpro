# Security Claim Verification

Independent verification of six reported findings, plus a sweep for other
under-authenticated routes. Read-only audit. Every claim was treated as
unverified and judged from the code on disk.

**Date:** 2026-09-25
**Repo:** `C:\Users\Ray\Solarpro Claude\repo`
**Scope:** 302 `route.ts` files under `app/api/`, `middleware.ts`, supporting libs.

> **Note on a moving target.** Two of the audited files changed on disk *during*
> this audit: `app/api/proposals/[id]/route.ts` (a repair landed) and
> `middleware.ts` (a comment documenting a known defect was added). Both the
> pre-change state I read directly and the current state are recorded below.

---

## Verdict summary

| # | Claim | Verdict | Real blast radius |
|---|---|---|---|
| C1 | Proposal GET has no auth / no share-token check | **CONFIRMED** (repaired on disk mid-audit) | Was: anonymous full proposal read + token theft |
| C2 | `'/'` + `startsWith` makes every path public | **CONFIRMED — still live** | Middleware auth/CSRF/timeout branch unreachable |
| C3 | `location_city` leaks pre-payment | **PARTIAL** — routes *are* authenticated; the real leak is `lat`/`lng` | Exact parcel coordinates pre-claim |
| C4 | `window.prompt` for `MIGRATE_SECRET` | **REFUTED** as a vulnerability | Server-side gate is sound |
| C5 | Governed state machine has zero callers | **PARTIAL** — caller count confirmed, "no validation" overstated | Self-owned data only |
| C6 | `refresh_snapshot` rewrites signed snapshots | **CONFIRMED** | Owner-only; integrity, not authz |

---

## C1 — Proposal GET had no read authorization

**Verdict: CONFIRMED** (as read at session start). **Repaired on disk during this audit.**

### Evidence (pre-repair, read directly)

`app/api/proposals/[id]/route.ts` GET, lines 15–93 as they stood:

- Line 18: validates the UUID format — the *only* check.
- Line 23: `SELECT * FROM proposals WHERE id = ${id}` — no ownership join.
- Line 35: `const user = getUserFromRequest(req)` — the result was used **solely**
  to decide whether to increment a view counter (`shouldTrack`, line 38). It was
  never used to deny.
- Line 89: `return NextResponse.json({ success: true, data: { ...proposal, ... } })`.

This is exactly the dangerous pattern named in the brief: the guard is called and
its answer is discarded. A grep for `getUserFromRequest` showed the route as
"protected".

The claim that the token check lived only in the client is **confirmed**, and the
client component said so itself — `app/proposals/view/[id]/page.tsx:92`:

> "The share token must go to the SERVER — it is the API that enforces access"

The server did not enforce it.

### Blast radius (pre-repair)

Worse than reported. `SELECT *` returned the whole row, which includes
**`share_token`**. So an attacker with a proposal UUID got:

1. `data_json` — client name, site address, pricing, production, signature block.
2. The `share_token` itself.

Holding the token escalates read into **write**: the same file's PATCH accepts an
unauthenticated token-bearing caller and will set `status='accepted'`, write a
signature blob, and advance the project to `installation`
(lines 189–321 pre-repair). Anonymous proposal read therefore chained into
**forging a homeowner's contract signature**.

Mitigation check: none. `/api/proposals/` is not in `PUBLIC_PATHS`, so middleware
would nominally have 401'd anonymous callers — but see **C2**: the middleware auth
branch is unreachable, so nothing stopped this.

### Current state on disk

`app/api/proposals/[id]/route.ts:41–52` now calls `authorizeProposalRead()` from
the new `lib/proposalAccess.ts`. I reviewed the new guard and it is sound:

- `lib/proposalAccess.ts:111–124` — owner path via the `projects` join.
- `:128–131` — share-token path: missing token, never-shared row, mismatch and
  expiry each denied separately.
- `:37–44` — `safeStrEqual` uses `timingSafeEqual` with a length pre-check and
  refuses null/empty on either side (the old inline copy threw on a NULL
  `share_token`).
- `:83–89` — one single refusal message for every reason, so the response does not
  distinguish "wrong token" from "no such proposal".
- `app/api/proposals/[id]/pdf/route.ts:47–55` now routes through the same
  authority, closing the PDF variant of the same hole.

Residual: the view counter now follows the access path rather than the caller's
`?track=` claim (`route.ts:59`), which also fixes an inflation bug.

---

## C2 — `PUBLIC_PATHS` matches every path

**Verdict: CONFIRMED. Still live on disk.** One operator, and it is the permissive one.

### Evidence

- `middleware.ts:46` — `'/'` is the first entry of `PUBLIC_PATHS`.
- `middleware.ts:203` — `if (PUBLIC_PATHS.some(p => pathname.startsWith(p)))`.

`pathname.startsWith('/')` is true for **every** URL Next.js routes. The predicate
short-circuits on the first entry, returns `NextResponse.next()`, and everything
below line 203 is unreachable:

- the session-cookie check and the 401/redirect branch,
- the CSRF Origin-vs-Host check,
- the POL-SEC-009 session-timeout enforcement (8h admin / 24h user),
- the dev-auth bypass block.

A second, independent bypass sits at `middleware.ts:213` (`pathname.includes('.')`),
which would let any path containing a dot through — moot while line 203 already
matches everything, but it should be fixed in the same pass.

### Mitigations that are real

This is why C2 is severe but not catastrophic:

1. **Route handlers are the actual auth authority.** Of 302 `route.ts` files, only
   38 contain no guard identifier at all, and I inspected every one: they are
   login/logout/register, public-by-design intake, HMAC/CRON-secret endpoints,
   `410 Gone` tombstones (`app/api/engineering/plan-set/route.ts`,
   `app/api/projects/[id]/survey-handoff/route.ts`,
   `app/api/survey/lookup-data/route.ts`), or production-guarded dev routes.
2. **Tenant scoping is at the data layer.** `app/api/clients/[id]/route.ts:22` and
   `app/api/projects/[id]/route.ts:24` pass `user.id` *into* the accessor
   (`getClientById(id, user.id)`), so an IDOR requires the accessor itself to be
   wrong, not just the route.
3. **CSRF is covered by the cookie, not the middleware.** The unreachable Origin
   check would otherwise be alarming — no route handler re-implements it
   (0 of 302 read the `origin` header for CSRF). But `lib/auth.ts:392` sets the
   session cookie `SameSite=Lax`, which blocks cross-site POST/PUT/PATCH/DELETE at
   the browser. The dead CSRF branch is defence-in-depth that is currently absent,
   not an open door.

### Why it cannot be fixed in passing

A comment added to `middleware.ts:26–43` during this audit reaches the same
conclusion I did independently, and is correct: closing the gate today would 401
three live unauthenticated flows that are **not** in the list — the homeowner
portal (own cookie via `getPortalSession`), the homeowner proposal view (share
token), and `/api/settings/branding?proposalId=`. The app has come to depend on the
middleware being dead. Fixing it requires enumerating every unauthenticated entry
point first, then making `'/'` an exact match.

---

## C3 — `location_city` in a pre-payment response

**Verdict: PARTIAL.** The stated paths do not exist, both real routes *are*
authenticated, and `city` is not treated as a secret elsewhere in the product. But
the investigation surfaced a **worse** leak on the same responses.

### Path correction

The claimed files do not exist. The real ones are under `network/`, not
`marketplace/` — the line numbers match exactly, so these are the intended targets:

- `app/api/network/territory/[state]/route.ts:303`
- `app/api/network/opportunities/[id]/preview/route.ts:47`

### What is true

- `city` does cross the wire: `preview/route.ts:140` (`city: s(r.city)`) and
  `territory/[state]/route.ts:389` in `toLeadDto`.
- The two lead-card surfaces declare `city` in their TS types
  (`app/network/territory/[state]/page.tsx:51`, `app/network/lead/[id]/page.tsx:30`)
  and never render it. So "the UI drops it, the wire does not" is accurate *there*.

### What refutes the claim as framed

- **Both routes are authenticated and act on the answer.**
  `preview/route.ts:35–37` and `territory/[state]/route.ts:88–90` both call
  `getUserFromRequest` and return 401. This is not an unauthenticated leak.
- **City is displayed openly elsewhere in the same product.**
  `app/network/page.tsx:328` renders `` `${opp.city}, ${opp.state_code}` `` on the
  marketplace list, and `app/network/UsLeadMap.tsx:376` puts the city in the map
  pin label. City is a deliberate pre-purchase discovery signal, not a secret.
- Both routes' header comments state the intended boundary as "NO contact and NO
  exact address" (`preview/route.ts:17–18`), which city-level does not violate.

### The real finding underneath: `lat`/`lng` at 7 decimal places

`app/api/network/opportunities/route.ts` — the contractor discovery feed:

- Line 78, in the legacy query, states the rule:
  `-- DO NOT expose: address, lat, lng, project_id, created_by_user_id (pre-claim)`
- Lines 172–173, in the **canonical** query immediately below it, select
  `no.lat, no.lng` anyway.
- Lines 355–363 destructure six `marketplace_*` fields out of the response —
  including `marketplace_raw_payload` and `marketplace_intake_metadata`, which is a
  **genuine and effective mitigation** for the raw homeowner blobs. `lat` and `lng`
  are *not* in that list and survive into the returned `...row`.

The schema says these are address-grade secrets —
`lib/migrations/047_network_opportunities.sql:93–99`:

```
-- Full address only accessible to assigned contractor post-claim
address                   TEXT,
...
lat                       NUMERIC(10,7),
lng                       NUMERIC(10,7),
```

`NUMERIC(10,7)` is roughly centimetre precision. It reverse-geocodes to the exact
house. The sibling single-item route agrees and enforces it —
`app/api/network/opportunities/[id]/route.ts:56–61` deletes `address`, `lat` and
`lng` unless the caller is the claimer or creator. The list route does not.

The UI jitters the map pins client-side (`UsLeadMap.tsx:374`, `jitter(lead.id)`),
so the product *looks* like it only shows an approximate position while the wire
carries the precise one — which is the shape C3 described, applied to the field
that actually matters.

**Blast radius:** any contractor with a marketplace account can pull the exact
coordinates of every live lead in their feed without paying, defeating the
product's core paywall. Bounded by the eligibility filter
(`route.ts:269–291`, `evaluateContractorEligibility`) and a 200-row scan cap.

---

## C4 — `window.prompt` for `MIGRATE_SECRET`

**Verdict: REFUTED as a vulnerability.** Both halves check out, and the server half
is strong. This is precisely the "weak-looking client control in front of a strong
server control" case the brief warned about.

### Does the prompt path reach a privileged endpoint?

Yes. `app/admin/database/page.tsx:27` collects the secret and
`:32–36` POSTs it to `/api/migrate` in the **JSON body**, not the query string or a
header.

### Is that endpoint protected server-side?

Yes, independently of the client:

- `app/api/migrate/route.ts:24` — rate limited (`checkRateLimit('migrate', ...)`).
- `:32` — explicit comment and behaviour: an authenticated session alone is **not**
  sufficient; the secret is required.
- `:31` — "Read secret from body ONLY — never from query string (URL params appear
  in logs)". The prompt value therefore does not reach access logs.
- `:34` — missing `MIGRATE_SECRET` env fails closed with a 500.
- `:37–41` — `timingSafeEqual` with a length pre-check.

The `prompt()` is cosmetically poor (no masking, shoulder-surfing, browser history
of the dialog is not persisted but the value is typed in the clear) but it grants
nothing. Anyone who can reach `/api/migrate` with the secret can do so with `curl`
regardless of the page.

### Residual issues worth noting (not the reported claim)

- `/api/migrate` is listed in `PUBLIC_PATHS` (`middleware.ts:88`), so it requires
  **no session at all** — possession of the secret is the entire authorization.
  There is no user identity on the request and therefore no meaningful audit of who
  ran a migration.
- The route documents itself as **deprecated** (`:44–50`): the canonical path is
  `/api/admin/migrations` (`lib/migrations/runner.ts`) with a `schema_migrations`
  ledger and mandatory SHA-256 checksums. The right fix is to retire this runner,
  not to improve its prompt.

---

## C5 — Governed state machine has zero callers

**Verdict: PARTIAL.** The dead-code half is confirmed exactly. The
"no validation" half is overstated.

### Confirmed: the governed path is dead

- `lib/deals/transitions.ts:4` declares itself
  "The ONLY authorised path for changing a project's pipeline stage."
- It has exactly **one** importer in the entire repo:
  `app/api/projects/transition/route.ts:38`.
- `/api/projects/transition` has **zero** HTTP callers. Every match for that string
  in `app/`, `lib/` and `components/` is either inside the route file itself or a
  doc comment (`lib/homeownerStageSync.ts:14`).
- That route is the one that writes the audit trail —
  `app/api/projects/transition/route.ts:205`, `INSERT INTO project_activity`.

### Confirmed: `update-status` is what actually runs, with no audit

`app/api/projects/update-status/route.ts` has **5** live callers:
`app/dashboard/page.tsx:940`, `components/commands/EngineeringReviewModal.tsx:29`,
`components/commands/ScheduleInstallModal.tsx:75`,
`components/deals/DealDecisionModal.tsx:160`,
`components/project/OperationsTab.tsx:121`.

It contains **zero** audit or `INSERT` statements — confirmed by count.

### Refuted: "no validation"

`update-status` is not a free-for-all. It enforces:

- `:25–28` rate limiting,
- `:30–33` authentication, 401 on failure,
- `:54–56` UUID format validation,
- `:65–70` `isValidStage(status)` — the stage must be a member of the pipeline enum,
- `:81–83` **ownership** — `existing[0].user_id !== user.id` returns 403.

What it does *not* enforce is **transition legality**: `lead → complete` in one hop
is accepted, because no source stage is consulted. That is the true defect, and it
is a business-process integrity gap, not an authorization boundary.

**Blast radius:** an authenticated user can move **their own** projects to any valid
stage in any order, untracked. No cross-tenant reach. Side effects are real but
bounded: `contract_signed` stamps `contract_signed_at = NOW()` (`:109–117`),
`complete` stamps `actual_completion` (`:118–126`), and each transition fires
`generateTasksForStage`. The compliance cost (no audit trail on the path that is
actually used) outweighs the security cost.

---

## C6 — `refresh_snapshot` has no status guard

**Verdict: CONFIRMED.** No status check exists anywhere on that path.

### Evidence

`app/api/proposals/[id]/route.ts`, PATCH:

- `:356` requires a session.
- `:359–360` ownership check against `proposals.user_id`.
- `:365` `if (body.action === 'refresh_snapshot') {` — and from here to the UPDATE
  the only guards are "row exists" (`:367`) and "live project exists" (`:388`).
- The `UPDATE proposals SET data_json = ...` that follows runs unconditionally.

I grepped the whole block for `status`, `signed`, `accepted`, `locked` and `frozen`:
the only hits are the two 404 messages. There is no check on `proposals.status`, no
check on `signed_at`, and no check on the `data_json.signature` block that the
signing path writes at `:248–263`.

So an owner can rebuild the frozen snapshot of a proposal that a homeowner has
already e-signed. The signature block itself survives (the spread at `:395–401`
preserves `currentData2`), but the `project` object it was signed against — pricing,
production, client record — is replaced, and `snapshotRefreshedAt` is stamped. The
artifact then misrepresents what was signed.

### Blast radius

Lower than the framing suggests, and it is not an authorization defect: it requires
an authenticated session that **owns** the proposal. There is no anonymous or
cross-tenant path to it. The exposure is contract integrity and evidentiary value —
an installer can, deliberately or by clicking "refresh" on a stale-looking proposal,
silently alter what a homeowner agreed to. Given this repo's standing rule that
issued packages are immutable, this is the same class of defect as the WS-A
issued-package re-dating bug.

### Related, same file

The public token path has the mirror-image gap: `:207` `PUBLIC_STATUSES` permits
`'viewed'` on a proposal already at `'accepted'`, and the signature branch at
`:225+` will overwrite an existing signature with a new one — neither checks the
current status first.

---

## Sweep: other under-authenticated routes

**Method.** Enumerated all 302 `route.ts` files under `app/api/`. Two passes:
(1) files containing no recognised guard identifier; (2) files that call
`getUserFromRequest` but never test the result — the pattern that looks protected
in a grep.

**Pass 2 produced only false positives.** All seven hits
(`admin/free-pass`, `admin/me-debug`, `admin/me-exact-debug`, `admin/me-ultra-debug`,
`auth/tour-complete`, `settings/onboarding-complete`, `proposals/[id]/pdf`) test the
result via `session?.id`, a separate `adminCheck`, or `productionGuard()`. The admin
debug routes are additionally production-guarded. C1 was the one genuine instance of
this pattern and it is now repaired.

**Pass 1 similarly resolved.** Routes that looked unguarded use guard functions my
first grep did not name: `requireDeskApi` (`app/api/lead-desk/route.ts:15`),
`resolveMobileUser` (`app/api/mobile/clients/route.ts:27`), `getPortalSession`
(`app/api/portal/dashboard/route.ts:21`), `CRON_SECRET` with `safeStrEqual`
(`app/api/cron/proposal-expiry/route.ts:47`). **Anyone auditing this codebase by
grepping for `getUserFromRequest` alone will report a large number of false
positives.**

### Worst 5 genuine findings

**1. Exact `lat`/`lng` in the pre-claim discovery feed.**
`app/api/network/opportunities/route.ts:172–173` vs. its own rule at `:78` and the
schema's at `lib/migrations/047_network_opportunities.sql:93–99`. The sibling route
`app/api/network/opportunities/[id]/route.ts:56–61` scrubs exactly these fields for
non-entitled callers. Centimetre-precision coordinates for every live lead,
available to any marketplace contractor before payment. *Mitigation present:* the
raw intake blobs are correctly stripped at `:355–363`; eligibility filtering and a
200-row cap bound the volume. Fix is two lines — add `lat`/`lng` to the existing
destructure.

**2. The middleware gate is open for every request (C2).** Consequence beyond C2
itself: the CSRF Origin check is unreachable and **nothing** re-implements it
(0 of 302 routes read the `origin` header for CSRF). *Mitigation present and load-
bearing:* `lib/auth.ts:392` sets `SameSite=Lax`, which is what is actually blocking
cross-site state change today. The app is one cookie-attribute change away from
being broadly CSRF-exposed.

**3. `/api/settings/branding?proposalId=<uuid>` is unauthenticated by design.**
`app/api/settings/branding/route.ts:77–117`. Supplying any valid proposal UUID
returns that installer's `company`, `company_address`, `company_phone`,
`company_website` and logo, with no token check — only UUID format validation
(`:78`). It joins `proposals → projects → users`. The data is installer business
contact information (largely public) rather than homeowner PII, so severity is
moderate; but it is a UUID-only oracle that confirms a proposal exists and maps it
to a company. It should take the share token like its sibling routes now do.

**4. `/api/migrate` requires no session at all.** `middleware.ts:88` lists it in
`PUBLIC_PATHS`; `app/api/migrate/route.ts:32–41` authorizes on the shared secret
alone. Schema-changing capability with no user identity and therefore no attributable
audit. *Mitigation present:* timing-safe comparison, body-only transport, rate
limiting, and a documented successor at `/api/admin/migrations` with a checksum
ledger. Retire the legacy runner rather than harden it.

**5. Proposal lifecycle has no terminal state.** `app/api/proposals/[id]/route.ts`
— C6's `refresh_snapshot` (`:365`), the public `'viewed'` regression (`:207`), and
signature overwrite (`:225+`) are three instances of one missing invariant: nothing
in this file asks whether the proposal is already signed. An `accepted`/signed
proposal should be immutable except through an explicit, audited amendment path.

---

## Ranked: what genuinely needs fixing first

Ranked by real-world blast radius, not by how alarming the claim sounded.

1. **`lat`/`lng` in the discovery feed** — `app/api/network/opportunities/route.ts:172–173`.
   Live, unmitigated, defeats the marketplace paywall, exposes homeowners' exact
   addresses to contractors who have not paid, and contradicts both the schema and
   the sibling route. Two-line fix. *Highest ratio of damage to effort.*
2. **Keep the C1 repair and extend it** — `lib/proposalAccess.ts` is sound; confirm
   it is applied to every endpoint returning a proposal row (GET and PDF are done).
   Also stop returning `share_token` in the GET payload at all — the homeowner
   already has it, and no other caller needs it.
3. **Proposal terminal state (C6 + siblings)** — one status guard shared by
   `refresh_snapshot`, the public status path and the signature path. Contract
   integrity; directly relevant to this project's issued-package immutability rule.
4. **Close the middleware gate (C2)** — high severity in principle, but currently
   backstopped by 266 route-level guards and `SameSite=Lax`. Requires the entry-point
   audit described in the file's own comment. Schedule it; do not rush it, and do not
   let anyone "fix" it in a one-line PR — that breaks the portal and every share link.
5. **`/api/settings/branding?proposalId=`** — add the share-token check.
6. **Audit trail on `update-status` (C5)** — either make the five callers use
   `/api/projects/transition`, or port the `project_activity` insert and the
   transition-legality check into `update-status`. Compliance debt, not a breach.
7. **Retire the legacy `/api/migrate` runner (C4)** in favour of
   `/api/admin/migrations`. No action needed on the `window.prompt`.

### Claims that did not survive contact with the code

- **C4 is not a vulnerability.** The server-side gate is correct and thorough. Acting
  on this would have been wasted effort.
- **C3 is misdirected.** Both named routes are authenticated, and `city` is
  deliberately public discovery data shown on the marketplace list. The claim's
  reasoning was sound but pointed one field away from the real problem.
- **C5's "no validation"** is wrong — `update-status` enforces auth, ownership, UUID
  format, stage-enum membership and rate limiting. Only transition legality and the
  audit trail are missing.
- **C1's severity was understated,** not overstated: the response also leaked the
  `share_token`, escalating anonymous read into signature forgery.
