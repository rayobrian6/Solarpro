# PLANSET RENDERING ENVIRONMENT — THE CONTROLLED ENVIRONMENT CONTRACT

**Decision date:** 2026-07-31 (Ray) · **Status:** CI implemented · production rendering image **OPEN**

---

## THE PROBLEM THIS EXISTS TO PREVENT

The planset HTML embeds **no `@font-face`** (`document.fonts.size === 0`). It asks for:

```css
--sans: Arial, 'Helvetica Neue', sans-serif
--mono: 'Courier New', Courier, monospace
```

Those resolve against **host-installed fonts**. On a host without them the browser
substitutes a metrically different face, dense text rewraps taller, and page-fit reports
clipping **that describes the machine, not the sheet**.

This is not hypothetical. On 2026-07-31 a report of

```text
PV-0  +10.0 px   (CONSTRUCTION NOTES)
PV-4B +15.7 px   (CONDUCTOR & CONDUIT)
SCHED +31.9 px   (EQUIPMENT SCHEDULE)
```

was traced to exactly this. The accepted artifact `PDS-B00B57D6FD6A` and a fresh
regeneration both measure **0px internal / 0in page-box** on all three sheets. Forcing
font substitution on the **unmodified** accepted artifact reproduces the failure and names
the same elements (`PAGE CONCLUSION — CONDUCTOR & CONDUIT SCHEDULE`, `PAGE CONCLUSION —
EQUIPMENT SCHEDULE`). See `POST-SYNC-TEST-AND-PAGINATION-REPAIR.md`.

**Presence is not sufficient.** With neither the MS core fonts nor Liberation installed,
fontconfig resolves `Arial` to **DejaVu Sans** — present, non-generic, and ~12% wider.
Only a *metric* comparison catches that.

---

## DECISION (Ray, 2026-07-31)

> Do **not** embed fonts into every planset yet.

Standalone HTML font embedding would change every artifact's bytes and increase file size.
Treat it as a **separate, versioned rendering migration**, and only if pixel-identical
offline HTML is later required.

Instead, the canonical permit PDF is generated in a **controlled rendering environment**.

---

## THE CONTRACT

| # | Requirement | Status |
|---|---|---|
| 1 | Liberation Sans + Liberation Mono installed in CI and the production rendering image | CI ✅ · prod ❌ **OPEN** |
| 2 | Image / package versions locked | CI ✅ · prod ❌ **OPEN** |
| 3 | Page-fit runs only under print media | ✅ |
| 4 | Browser verified to resolve the expected families before measuring | ✅ |
| 5 | Missing fonts fail as an environment/setup error, never as sheet clipping | ✅ |
| 6 | Deliberately substituted-font negative control retained | ✅ |

Liberation Sans and Liberation Mono are **metric-compatible** with Arial and Courier New —
identical advance widths — so they reproduce the reference layout exactly.

---

## IMPLEMENTED — CI (`.github/workflows/ci.yml`, job `page-fit`)

Version-pinned end to end:

```text
runner image : ubuntu-24.04          (NOT ubuntu-latest)
node         : 20
npm deps     : npm ci                (package-lock.json pins playwright 1.61.1)
chromium     : npx playwright install --with-deps chromium   (the pinned playwright, not the system browser)
fonts        : fonts-liberation + fontconfig
```

The job records the resolved `fonts-liberation` / `fontconfig` / `playwright` versions and
`fc-match` output to the run summary, then **fails at setup** if `Arial` or `Courier New`
resolves to anything that is not a metric-compatible face. On failure it uploads
`test-output/pagination-w9/` — the measured HTML plus a PNG of every failing sheet.

> **One-time follow-up:** the exact `fonts-liberation` apt version is printed to the run
> summary but **not yet hard-pinned**, because it cannot be verified from a Windows
> workstation. After the first green run, replace `fonts-liberation` with
> `fonts-liberation=<reported version>`. The runner image is already pinned, so the version
> is stable in the meantime, and the metric guard below is the real gate regardless.

## IMPLEMENTED — the measurement itself

`scripts/lib/pagination-probe.mjs` is the single shared ruler, imported by both
`tests/planset/pagination-w9.test.ts` and `scripts/planset-pagination-compare.mjs`.

**Metric fingerprint** — measured at 16px on a reference host with genuine Arial and
Courier New (Chromium 149), tolerance ±1.5%:

```text
Arial, 'Helvetica Neue', sans-serif   → 571.73 px
'Courier New', Courier, monospace     → 672.11 px

for contrast, the bare generics on that host:
  serif      548.17 px
  monospace  615.78 px   (8.4% short of Courier New — a fallback IS detectable)
```

Before any geometry is trusted the suite asserts print media, `@page` = 17in × 11in, every
`.page` = 1632×1056px, `#sp-toolbar` hidden, `#sp-sheets` transform `none`, and the font
metric fingerprint. A fingerprint miss fails as **RENDERING ENVIRONMENT NOT SET UP**, names
the stack, the measured vs expected width and the deviation, and states explicitly:

> This is an ENVIRONMENT/SETUP failure, NOT sheet clipping. … Do not adjust any sheet
> layout on the strength of a measurement taken here.

**Negative control** (`W9 negative control — substituted fonts DO trip the page-fit gate`)
substitutes both stacks with a generic family, proves via canvas measurement that the
substitution actually widened text, then asserts the probe **does** detect clipping — so a
"clean" verdict can never be vacuous.

---

## OPEN — THE PRODUCTION RENDERING IMAGE

**There is no controlled rendering image today.** The canonical PDF path is
`lib/pdf/generatePdf.ts`, which is:

1. **Puppeteer + `@sparticuz/chromium-min`** on Vercel serverless. The Chromium pack URL is
   pinned (`v147.0.0`), but this build exposes no font-loading API (`graphicsMode` only),
   and the Lambda filesystem carries no Liberation faces. **No font guarantee.**
2. **wkhtmltopdf fallback** for sandbox / self-hosted. Uses whatever fonts that host has.
   **No font guarantee.**
3. Returns `null` if both fail; callers serve HTML.

Neither path satisfies requirement 1 or 2. Closing this needs an infrastructure decision
that is **Ray's to make**, because it changes where and how permit PDFs are produced:

- **Option A — dedicated render service.** A pinned Docker image (`node:20-slim` +
  `fonts-liberation` + Playwright chromium) deployed on Render alongside the existing
  `worker/`. Canonical PDFs route there. Strongest guarantee; new service to run.
- **Option B — font-bearing Lambda layer.** Ship Liberation TTFs with the serverless
  bundle and point fontconfig at them. Keeps the current topology; brittle, and
  `chromium-min` does not expose the font API this build would need.
- **Option C — accept HTML-only canonical output** and generate PDFs solely in the
  controlled CI environment. No new infra; changes the product flow.

Until one is chosen, **a PDF produced by the Vercel path is not guaranteed to match the
CI-verified geometry**, and page-fit conclusions should be drawn only from the CI job or a
workstation carrying Arial / Courier New.

---

## RULE OF THUMB

> A page-fit number is a statement about a *host* until you have checked the fonts.
> Check the fingerprint first. Never change a sheet layout on the strength of a
> measurement taken on an unverified machine.
