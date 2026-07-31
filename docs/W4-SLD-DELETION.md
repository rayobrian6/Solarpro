# W4 §5 — Dead `buildSLD` Deletion Evidence

Status: DONE 2026-07-21 (W4 workstream F). Scope: `lib/permit/sections/electricalPages.ts`.

## What was removed

The retired inline single-line-diagram builder `buildSLD()` — a self-contained
~830-line SVG generator nested inside `pageSingleLineDiagram` — plus the SVG
primitive/equipment-symbol helper block that existed **solely** to serve it
(canvas constants; `esc/txt/tspan/rect/ln/circ/gnd/callout`; the IEEE symbol
helpers `pvModuleSymbol/fuseSymbol/breakerSymbol/lug/busbar/knifeSwitch`;
`makeOverlapGuard`, `wireSeg`; and the equipment renderers
`renderBattery/renderBUI/renderCombiner/renderDisco/renderMSPLoad`).

The two dead outer locals it left behind (`_sldSysType`, `_sldArrayLabel`) were
also removed.

### Line counts
- Removed block: **832 lines / 46,907 chars** (anchor-bounded: from the
  `// ── Canvas` comment through the `buildSLD` closing brace, i.e. everything
  before `// ── SLD content`).
- File: **1,638 → 826 lines** (net of the deletion plus the small §2/§5 edits
  that re-added the canonical-renderer comment, the code-authority projection,
  and the SLD snapshot stamp).

## Caller proof (verified no reachable path used it)

1. **Whole-repo grep** for `buildSLD` in the TypeScript permit path
   (`lib/permit/sections/electricalPages.ts`): after deletion, the only
   remaining occurrences are two explanatory comments (lines 718, 743). There is
   **no `function buildSLD`, no `buildSLD()` call, and no exported builder**.
2. **Reachability**: `pageSingleLineDiagram` (the only SLD-sheet emitter, and the
   only export of the module that renders an SLD) builds `sldBodyHtml` from
   exactly one source — `generateLiveSLD(input, cad, { embedded: true })` — and
   **throws (fails closed)** when the live diagram cannot be produced. The former
   3-tier fallback (live → stored SVG → inline `buildSLD`) is gone; tiers 2 and 3
   were already retired in W2 and `buildSLD` was already un-called (the pre-
   existing gate `tests/planset/sheet-local-prohibition.test.ts` asserts the
   `const svgContent = buildSLD()` call does not exist). This deletion removes the
   now-orphaned body.
3. **Module surface**: `Object.keys(import('electricalPages'))` =
   `resolveInterconnection, pageNECCompliance, pageConductorSchedule,
   pageSingleLineDiagram` — no legacy/alternate SLD builder is exported, so no
   API route, worker, or admin page can reach a non-canonical builder here.
4. **Note on `lib/permit_gen.mjs`**: a separate legacy `.mjs` monolith carries
   its own `buildSLD()` at line 1498 and is **not** part of the TypeScript permit
   generator (`generatePermit.ts`) path; it is out of scope for this workstream
   and untouched.

## Canonical SLD path (what all rendering now consumes)

`pageSingleLineDiagram` → `generateLiveSLD` (`lib/permit/utils/sldAdapter.ts`) →
`renderSLDProfessional` → (`renderSLDMultiLane` at N>1 lanes, **internal / not
exported**) in `lib/sld-professional-renderer.ts`. The adapter reads canonical
snapshot electrical topology + segment IDs via `buildConductorAuthority` /
`buildSourceBranchesFromAuthority`.

## Snapshot binding (every rendered SLD)

`pageSingleLineDiagram` now emits a machine-extractable stamp on the E-1 sheet,
sourced from `input._snapshot.meta` (never fabricated; empty when unstamped):

```
<div class="sld-snapshot-stamp"
     data-sld-snapshot-id="…" data-sld-schema-version="…" data-sld-digest="…"
     style="display:none"></div>
```

This is in addition to the title-block text stamp (V12), so the SLD is
harness-verifiable independently of title-block parsing, regardless of whether
the single-lane or the multi-lane renderer produced the diagram.

## Tests

`tests/planset/sld-canonical-only.test.ts` proves: no `buildSLD`
implementation/call survives; no legacy builder is exported (module-surface
assertion); `renderSLDMultiLane` stays internal; E-1 consumes `generateLiveSLD`
and fails closed with no stored/inline tier; and every SLD carries the
snapshot id + schema version + digest, degrading to empty (not a fabricated id)
when unstamped. The pre-existing `tests/planset/sheet-local-prohibition.test.ts`
gates continue to pass.
