# Systematic Audit & Fix Plan

## Issues Found:

### 1. SLD Renderer - Micro topology problems
- DC Disconnect always drawn (should be SKIPPED for micro)
- DC wire between PV and DC Disco always drawn (should be AC trunk cable for micro)
- DC wire label between DC Disco and Inverter always drawn (should be skipped for micro)
- Default inverterManufacturer fallback is 'Fronius' (should be 'Enphase' for micro)
- Layout: 7 positions hardcoded including DC Disco slot (micro needs 6 positions: PV, AC Trunk, Micro, AC Disco, Meter, MSP, Utility)

### 2. Data Flow Gaps
- Panel count → string count: needs to auto-calculate on config page
- String count → conductor sizing: not flowing to conduit/wire fields
- Conduit fill calculator: not auto-populated
- Wire sizes: not auto-flowing to BoM
- BoM: not receiving calculated wire/conduit quantities

### 3. Default fallbacks wrong
- SLD route: `if (!inverterManufacturer) inverterManufacturer = 'Fronius'` → should detect micro
- PDF route: same issue
- BoM route: defaults to `fronius-primo-8.2`
- Topology route: defaults to `fronius-primo-8.2`

## Fix Order:
1. Fix SLD renderer: skip DC disconnect + DC wiring for micro, fix layout
2. Fix default manufacturer fallback for micro
3. Build auto-string-count on config page (panel count → strings)
4. Build conductor/conduit auto-sizing engine
5. Wire everything to BoM