# W3 Directive — Canonical Structural, Roof-Layout and Racking Authority

Status: ACTIVE. W2.1 (`e3a54bf2`) APPROVED by Ray 2026-07-21. This document is Ray's W3
mandate, recorded verbatim as the execution contract. The evidence harness must be
extended so that any disagreement with this contract exits non-zero.

## W2.1 acceptance (context)

- computeSystem is the sole canonical electrical engine.
- runElectricalCalc is shadow-only; legacy-engine isolation proof accepted.
- Segment-scoped grounding objects accepted.
- Canonical route-length authority + ROUTE-LENGTH-ESTIMATE blocker accepted.
- V16, V17, V18 accepted as blocking invariants.
- Braidon EQUIPMENT-IDENTITY-CONFLICT remains unresolved and blocking.

Permit-release blockers that must NOT be downgraded to warnings:
1. ROUTE-LENGTH-ESTIMATE
2. Missing feeder raceway/conduit type + incomplete raceway-bonding authority
3. EQUIPMENT-IDENTITY-CONFLICT

## W3 scope

### 1. Snapshot-only structural projections

Refactor all structural and physical-layout content so these render only from
PermitDesignSnapshot:

- PV-1 roof/site layout
- PV-1B physical array geometry portions
- PV-3 attachment/racking detail
- PV-4C structural calculations
- Structural portions of SCHED
- Structural and racking BOM rows
- Structural statements on CERT and PE-1
- Any cover-sheet structural summaries

No renderer may independently: place modules; calculate module dimensions; place rails;
choose rail spans; place attachments; assume 48-inch spacing; choose wind speed; choose
exposure category; calculate loads; calculate reactions; select capacities; calculate
utilization or safety factor; create setback/pathway polygons; infer roof framing; create
structural BOM quantities.

### 2. Canonical module geometry

Every module instance must originate from the exact selected versioned equipment record.

Snapshot authority must include: module instance ID; selected equipment record ID and
revision; physical width, height and thickness; orientation; roof-plane ID;
polygon/coordinates; row and column placement; clamp zones; mounting-edge orientation;
electrical device/branch reference.

Required invariants:
- Every rendered module polygon uses exact catalog dimensions.
- The number of module instances equals the system module count.
- Calculated array area equals the sum of canonical module polygons.
- No renderer may use a generic module size.
- Equipment changes invalidate layout geometry and snapshot digest.

### 3. Canonical roof-plane and pathway geometry

Snapshot structural/site authority must include: roof-plane ID; polygon; pitch; azimuth;
framing direction; framing spacing; roof covering; eave/ridge/hip/valley edges; fire
setbacks; access pathways; obstructions; usable-area polygons; geometry provenance and
confidence.

Setbacks and pathways must be canonical polygons, not sheet-generated offsets.

If roof geometry or required setback authority is missing or contradictory, generation
must block permit-ready status.

### 4. Exact racking assembly authority

Create one versioned racking assembly record containing: mount manufacturer; exact mount
model/SKU; rail manufacturer; exact rail model/SKU; L-foot or adapter; T-bolt/fastener;
mid clamp; end clamp; splice; grounding/bonding components; compatible module thickness
range; installation condition; rafter/deck attachment method; screw/lag model and
quantity; embedment requirement; pilot-hole requirement; published capacity source;
datasheet/manual revision and source; UL 2703 or applicable listing basis.

Do not allow contradictory "rail-less" and rail-based descriptions.

If a mixed-manufacturer assembly is selected, compatibility and capacity authority must
explicitly cover the complete assembly.

### 5. Canonical rail objects

Snapshot must contain explicit rail objects: rail ID; roof-plane ID; start/end
coordinates; physical length; stock length; span configuration; cantilever lengths;
splice locations; supported module IDs; attachment IDs; manufacturer span limit;
governing wind/snow zone; utilization; source/provenance.

Rail quantities in the BOM must be derived from these rail objects.

Required reconciliation:
- Total drawn rail length equals scheduled rail length.
- Stock rail quantity covers total required length plus documented waste.
- Splice quantity derives from stock segmentation.
- Every module support relationship references a canonical rail ID.

### 6. Canonical attachment objects

Every attachment must be a real snapshot object: attachment ID; rail ID; roof-plane ID;
coordinate; roof zone; substrate/framing member; attachment method; fastener model;
fastener count; embedment; tributary area; uplift reaction; downward reaction; lateral
reaction where required; published allowable capacity; adjustment factors; governing
utilization; safety factor; calculation provenance.

The drawing must place attachments using these coordinates. The data table, structural
calculation, BOM and drawing must all reference the same attachment IDs. No visual-only
feet and no independently calculated quantities.

### 7. Structural environmental authority

Remove the hardcoded 90-mph value. Wind, snow, exposure, risk category and applicable
structural standard must come from canonical project authority.

Snapshot must include: ultimate wind speed; wind-speed source; exposure category; risk
category; ground snow load; roof snow load when calculated; applicable ASCE edition;
building height; roof geometry factors; component and cladding zones; uplift/downforce
pressures; calculation provenance.

The 115-versus-90 disagreement must be eliminated. Every sheet must print the same
structural environmental values. Do not independently hardcode ASCE editions in W3; use
the snapshot code-authority interface and leave final AHJ code-edition population to W4.

### 8. Structural calculations

The structural engine must calculate from canonical physical objects. At minimum: dead
load added by modules/racking; distributed roof load; rail loading; attachment tributary
areas; attachment reactions; mount/fastener capacity checks; rail span/cantilever
checks; framing-member load effects where adequate framing data exists; governing
utilization; governing failure mode.

Do not print unsupported conclusions about truss capacity. If framing, truss, species,
grade, span, bearing or design-document authority is insufficient, render an explicit
engineering-review requirement and block permit-ready status. Do not fabricate a generic
truss capacity table.

### 9. Safety-factor and capacity consistency

Create one canonical acceptance rule for each check. Do not print both "minimum safety
factor 1.0" and "minimum safety factor 2.0" without identifying different limit states
and their bases.

Each structural check must identify: demand; capacity; demand/capacity ratio; safety
factor when used; required threshold; pass/fail result; governing source. The same
result must appear identically anywhere it is projected.

### 10. BOM derived from physical objects

Structural BOM quantities must derive from: module instances; rail objects; attachment
objects; splice objects; clamp objects; bonding objects; fastener objects. No manually
entered or renderer-derived quantities. Each BOM row must contain source object IDs or
an auditable aggregation reference.

Required checks: rails vs total rail geometry; mounts vs attachment objects; splices vs
rail segmentation; mid/end clamps vs actual module adjacency; fastener quantity vs
attachment installation method; bonding hardware vs rail/equipment topology.

### 11. Activate V10

V10 becomes blocking and must validate: drawn module count equals snapshot module count;
drawn rails equal canonical rail objects; drawn attachments equal canonical attachment
objects; BOM quantities reconcile with structural objects; every attachment has a rail
and roof-plane reference; every rail has supported module and attachment references;
reactions do not exceed adjusted capacities; structural environmental values agree
across all projections; exact module dimensions are used everywhere; no sheet-local
structural calculations or literals remain.

Add additional invariants where required rather than forcing all structural checks into
one oversized validator.

### 12. Permit-readiness behavior

The following block permit-ready status: unverified roof framing; missing attachment
capacity source; missing exact fastener configuration; unsupported mixed-manufacturer
racking assembly; unresolved wind/snow authority; reactions not traceable to attachment
objects; rail quantities not traceable to rail objects; structural failure or
utilization above the accepted threshold; missing required site geometry; unresolved
equipment identity conflict.

The planset may still render for review, but it must visibly state:

PENDING STRUCTURAL ENGINEERING REVIEW
NOT FOR PERMIT SUBMISSION

### 13. W3 acceptance evidence

Deliver: before/after structural authority-flow report; PermitDesignSnapshot structural
schema additions; exact racking assembly record used for Braidon; canonical module, rail
and attachment object counts; map of attachment IDs to drawing coordinates; rail
segmentation and splice evidence; structural load/reaction/capacity report;
BOM-to-object reconciliation report; activated V10 and any related validators; grep/AST
proof that structural renderers contain no engineering literals or local calculations;
regenerated Braidon planset; updated `docs/evidence/braidon-w3.planset-evidence.json`;
cross-sheet truth matrix proving agreement for: module dimensions; module count; array
area; roof pitch; wind speed; exposure category; snow load; rail quantity and length;
attachment count; attachment spacing; fastener specification; reaction; capacity;
utilization/safety factor; structural BOM quantities.

The evidence harness must exit non-zero for any disagreement.

### 14. Carry-forward electrical blockers

Do not remove or weaken: ROUTE-LENGTH-ESTIMATE; missing feeder raceway/conduit
authority; incomplete raceway-bonding authority; EQUIPMENT-IDENTITY-CONFLICT. W3 does
not need to solve those unless a shared schema change is unavoidable, but all must
remain visible in the snapshot and planset evidence.

### 15. Boundaries

- Work on dev only. Commit W3 separately.
- Do not patch generated HTML.
- Do not modify MFA. Do not modify migration governance.
- Do not begin the W4 AHJ/code-authority sweep except for interfaces required by W3.
- Do not delete the dead buildSLD body during W3; keep that cleanup scoped to W4.
- Do not hide missing structural inputs to make the evidence green.

## Codebase anchors (for implementers)

- Snapshot core: `lib/permit/snapshot/{types,build,validate,digest,read,computeSystemProjection}.ts`
- Planset engine: `lib/permit/generatePermit.ts` (+ sheet renderers under `lib/permit/`)
- Evidence harness: `scripts/planset-evidence.mjs`; evidence outputs `docs/evidence/braidon-w*.planset-evidence.json`
- Prior audits: `docs/DATA-AUTHORITY-AUDIT.md`, `docs/AUTHORITY-FLOW-AUDIT-PLANSET.md`
- BRAIDON = the GreenLancer feedback-session planset (reference project for evidence)
