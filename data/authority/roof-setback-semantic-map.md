# `roofSetbackInches` / `ahjRoofSetbackIn` — semantic map

**§4 of the fire provenance campaign. Measurement only — the field is quarantined
from access-pathway geometry (N28) and otherwise left untouched.**

## The question

Does this field represent ONE concept, or several collapsed into one? The
pathway defect (502 jurisdictions printing 36" over a drawing dimensioned at 18")
happened because the geometry read it as a pathway width. That was wrong — but
"wrong for pathways" does not tell us what it IS.

## The answer: it means EAVE / RAKE EDGE SETBACK

Stated explicitly in the codebase, in the one place that writes it out as prose:

```
lib/jurisdictions/ahj.ts:205
  requirement: `Roof setback: ${ahj.roofSetbackInches}" from eave/rake edges;
                ${ahj.ridgeSetbackInches}" from ridge`
  category: 'Fire Access'
  necReference: 'IFC 605.11 / Local Fire Code'
```

And consumed consistently with that meaning by the CAD engine:

```
lib/cad/roof/roofCAD.ts:97
  const eaveSetIn  = input.project?.ahjRoofSetbackIn ?? DEFAULT_EAVE_SETBACK_IN;
  const rakeSetIn  = eaveSetIn;   // sides same as eave by default
```

So the field is an **edge setback**, and `roofCAD`'s use of it is the CORRECT
one. The pathway consumer was the outlier, and it is the one that was removed.

## Where the meanings had diverged

| consumer | read it as | status |
|---|---|---|
| `lib/cad/roof/roofCAD.ts:97` | eave / rake edge setback | **correct — unchanged** |
| `lib/jurisdictions/ahj.ts:205` | eave / rake edge setback (prose) | **correct — unchanged** |
| `lib/drafting/templates/roof.ts` (was `:248`) | ACCESS PATHWAY WIDTH | **wrong — removed in N28** |
| `lib/drafting/sheetComposition.ts:501` | ACCESS PATHWAY WIDTH | **wrong — removed in N28** |
| `lib/engineeringDecisionProvenance/evaluator.ts:246` | generic "setback", `?? 18` | ambiguous — see below |

`sheetComposition.ts:498` even carried a comment asserting the pathway reading
(*"ahjRoofSetbackIn = the ACCESS PATHWAY width"*), which is how the wrong meaning
survived review: the mistake was documented as if it were the definition.

## The remaining ambiguity

`evaluator.ts:246` resolves `project.ahjRoofSetbackIn ?? cad.roof.setbackIn ?? 18`
under the generic label "Setback value". Two problems, neither urgent:

- the **`?? 18` default contradicts the field's own data**: the AHJ table holds
  36 for 3,514 rows and 18 for 502, so the fallback is the minority value;
- the decision it feeds is registered at `decisionRegistry.ts:161` requiring
  `project.ahjRoofSetbackIn`, `project.ahjRidgeSetbackIn` and `cad.roof.setbackIn`
  together, so which edge it describes is not determinable from the call site.

Not changed here. Changing a default that feeds a provenance evaluator is a
behaviour change and needs its own measured root.

## Authority classification

`UNPROVENANCED_LEGACY`. The field varies (36 × 3,514 / 18 × 502, the 18s confined
to AZ · NM · NV · TX · UT) but **0 of 4,016 rows carry adoption evidence**, so the
variation is not governance. Per the campaign rule: per-jurisdiction variation is
not proof of jurisdiction-specific authority.

Deliberately NOT claimed: that 18" is wrong, invalid or illegal as an edge
setback. It was not governed evidence for pathway width and was read by the wrong
consumer. What it legitimately is — a state approximation, a legacy UI value, or
a real edge setback — remains unproven and the data is retained.

## Disposition

- **Keep the field.** It has two correct consumers.
- **Keep it out of pathway geometry.** Enforced by
  `tests/planset/fire-pathway-ssot.test.ts`, which asserts the column still
  varies while every jurisdiction resolves one pathway width.
- **Open:** the `evaluator.ts:246` generic-setback default, and eventually
  splitting the field into `eaveSetbackIn` / `rakeSetbackIn` once evidence
  distinguishes them.
