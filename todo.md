# BUILD v23 — SLD Implementation: Enphase BUI, Generator ATS Fix, Data Flow, Inverter Icon

## Tasks

- [ ] Phase 1: Fix data flow — add missing fields to SLD POST body in page.tsx
- [ ] Phase 2: Add renderBUI() function + Enphase IQ SC3 symbol to sld-professional-renderer.ts
- [ ] Phase 3: Move battery connection from MSP bus → BUI battery port
- [ ] Phase 4: Fix generator ATS placement (between utility meter and MSP)
- [ ] Phase 5: Upgrade inverter icon to professional rectangular box
- [ ] Phase 6: Update 120% rule to include battery backfeed amps
- [ ] Phase 7: Run tsc --noEmit — 0 errors
- [ ] Phase 8: Commit as BUILD v23, push, package ZIP