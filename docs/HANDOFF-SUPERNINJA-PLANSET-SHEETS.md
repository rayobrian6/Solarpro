# SuperNinja Task — Planset sheets → match the PE-sealed reference (all sheets EXCEPT PV-1/PV-2)

**Date:** 2026-07-01 · **Owner:** Ray (rayobrian6@gmail.com) · **Branch:** `dev` (never master)
**Repo:** `C:\Users\Ray\Solarpro Claude\repo` — Next.js (App Router) + TypeScript.

## 0. Mission
Make SolarPro's permit planset match the quality of Ray's PE-sealed reference set,
**sheet by sheet**. The main agent is actively working **PV-1 (site plan)** and
**PV-2 (roof plan)** — DO NOT touch `lib/permit/sections/sitePlan.ts` or
`lib/drafting/templates/roof.ts` (merge-conflict risk). **You own every OTHER sheet:**
PV-0 cover, PV-2B circuit, PV-3 attachment, PV-4A/B/C structural/NEC, PV-5 placards,
SCHED equipment schedule, E-1 one-line, CERT, PE-1, VAL-1.

## 1. The reference (gold standard)
`C:\Users\Ray\Downloads\Jaffree Athman 08-12-25 V2 Sealed (1).pdf` — Wyssling
Consulting PE, 26 pages (plan sheets = pp 3-10, rest are equipment datasheets).
Render it to compare: **PyMuPDF/fitz is installed** —
```python
import fitz
doc = fitz.open(PDF)
for i in range(10):
    doc[i].get_pixmap(matrix=fitz.Matrix(1.6,1.6)).save(f'ref_p{i+1}.png')
    print(i+1, doc[i].get_text()[:400])   # exact tables/notes text
```
Reference sheet map: p3=PV-0 COVER (big title + system summary + dense CONSTRUCTION
NOTES column + small aerial vicinity map + GOVERNING CODES + SHEET INDEX); p6=PV-3
ATTACHMENT DETAIL (cross-section, layer stack, callout schedule); p7-9=PV-4 structural;
p10=PV-5 placards/labels. Extract the exact wording/tables — match structure, not
verbatim project data.

## 2. The engine
Active planset engine: `app/api/engineering/permit/route.ts` → `generatePermitHTML()`
in `lib/permit/generatePermit.ts` (sheets built by `lib/permit/sections/*.ts`). Each
sheet = a server-built HTML/SVG string. Sheet builders you may edit:
- PV-0 cover: `lib/permit/sections/coverSheet.ts`
- PV-3/PV-4 structural/attachment: `lib/permit/sections/structuralPages.ts`
- equipment schedule / one-line / others: grep the section files by sheet id.
Shared primitives: `lib/drafting/primitives/index.ts` (drawText/escapeXml/etc. — note
`escapeXml` was just fixed to actually escape `&<>"`).

## 3. VERIFY METHOD (mandatory — render real output, don't eyeball code)
This is how the main agent verifies; reuse it exactly:
1. **Pull REAL geometry from the DB** (so you test real data, not a toy fixture).
   Conn string at `C:\Users\Ray\Solarpro Claude\.db_url` (repo PARENT, strip UTF-8 BOM
   `^﻿`). Client = `pg` in the repo's node_modules — **run scripts FROM the repo dir**
   so it resolves. Test project (Melvin, 4 facets / 54 panels):
   `4030b664-bebe-433b-a11c-cda05ead2f7d`, layout `9d4d9ff5-...`; pull
   `roof_planes` + `panels` from `layouts`.
2. **Generate the planset** in a Vitest test (resolves the `@/` alias): build a
   `PermitInput` from `test-fixtures/roofProject.ts`, swap in the DB `roofPlanes`/`panels`
   + `system.totalPanels`, call `generatePermitHTML(input)`, write the full HTML.
3. **Rasterize a sheet** to actually SEE it: extract the `<div class="page">` whose
   `.tb-sheet-id` matches your target, then screenshot via **puppeteer-core** (installed)
   + Chrome at `C:/Program Files/Google/Chrome/Application/chrome.exe` (headless, viewport
   ~1700×1100). Screenshot the `.page` element. Compare side-by-side with the `ref_pN.png`.
4. Iterate the section builder until it matches; re-render to confirm.

## 4. Per-sheet gaps to close (start here, prioritise by visual impact)
- **PV-0 cover**: match the reference layout — prominent title + system summary (modules/
  kW DC+AC, inverter, disconnects, battery), DESIGN CRITERIA block (roof type/layers/truss/
  story/snow/wind/exposure/climate zone), CONSTRUCTION NOTES column, small aerial VICINITY
  map, GOVERNING CODES, SHEET INDEX. Honest `—` for missing data (no fake values).
- **PV-3 attachment**: cross-section + layer stack + numbered callout schedule + fastener/
  embed/spacing specs table (the reference is detailed and clean).
- **PV-4A/B/C structural/NEC**: this is where the numbers must be right (see
  [[planset-finishing]] for the known PV-4C structural-calc bugs — bending moment/deflection/
  safety-factor). Verify against the engine, not just layout.
- **SCHED / E-1 / placards**: match the reference's schedules + label sheets.

## 5. Rules
- tsc + `npm run build` stay clean. Bump `PLANSET_ENGINE_VERSION` in
  `lib/permit/constants.ts` on any planset-output change (else cached HTML is served).
- DO NOT touch `sitePlan.ts` or `roof.ts` (main agent's). Commit on `dev`, clear messages.
- Never fabricate engineering values — real calc or honest `—`.
- Don't push throwaway diagnostic endpoints (Ray is firm on this).
