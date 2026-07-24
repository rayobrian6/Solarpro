# Final Framing-Authority Gate — Directive

Status: ACTIVE 2026-07-23. `24f3483b` approved subject to this correction. Ray's ruling:
operator-entered or field-observed data may establish OBSERVED geometry/material
descriptions but may never independently prove framing CAPACITY.

1. Separate canonical records:
   A. FramingObservation — source (operator entry / site survey / field measurement /
      photo evidence), framing type, nominal member dims, spacing, apparent
      species/grade, measured span, roof covering, bearing observations, confidence,
      observer, timestamp, evidence references.
   B. FramingCapacityAuthority — archived truss design drawing / manufacturer
      calculation / stamped engineering analysis / other verified capacity source;
      document ID, document hash, issuer, revision/date, exact project/building
      applicability, member/truss identity, design loads, allowable capacities, bearing
      conditions, deflection limits, engineer/manufacturer verification, verified
      status, verification timestamp, reviewed snapshot digest where applicable.

2. Never auto-verified capacity: "truss", 2x6 @ 24" OC, DF-L, 12-ft span,
   operator-entered capacity, generic BCSI table, assumed species/grade — preliminary
   modeling only; none may clear structural permit-readiness by themselves.

3. Rendered behavior without verified capacity authority — PV-4C and PE-1 display:
   OBSERVED FRAMING: TRUSS / 2×6 @ 24 IN. O.C. / APPROX. 12 FT SPAN
   SOURCE: OPERATOR-ENTERED — NOT CAPACITY-VERIFIED
   EXISTING FRAMING CAPACITY NOT VERIFIED
   PROJECT-SPECIFIC STRUCTURAL REVIEW REQUIRED
   Never: numeric framing capacity, utilization %, PASS, adequate, confirmed capacity,
   structural certification.

4. Engine may still calculate added PV dead load, distributed roof load, estimated
   reactions, loads delivered to framing — any comparison against unverified capacity
   is labeled PRELIMINARY / NON-AUTHORITATIVE with no compliance verdict.

5. FRAMING-AUTHORITY-UNVERIFIED clears ONLY by: archived applicable truss design
   drawing; verified manufacturer capacity documentation; or a licensed engineer's
   calculation/review tied to the current snapshot digest. Generic BCSI is not
   project-specific authority.

6. Approval invalidation: changes to framing observations, roof geometry, module
   layout, racking, attachment layout, environmental loads, or snapshot digest
   invalidate prior framing approval unless the review explicitly covers the new digest.

7. Regression tests: operator-complete fields don't clear; operator data populates
   observation without PASS; generic BCSI cannot be capacity authority; archived
   applicable truss document clears; digest-bound engineer review clears; digest change
   invalidates; live and fixture follow the same rule.

8. Evidence: before/after framing authority flow; live + fixture blocker results;
   rendered PV-4C + PE-1 evidence; tests; typecheck; production build; full-suite
   baseline comparison.

Boundaries: dev only; separate commit; no MFA/migration-governance changes; never
fabricate framing documents or capacity values.
