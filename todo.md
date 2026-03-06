# BUILD v19 — NEC Calc Step Fix + AP Systems Microinverter Support

## Task 1: Investigate NEC Calculation Step data flow issue
- [ ] Find where NEC calc steps are rendered in engineering page
- [ ] Trace data flow from SLD/computeSystem to NEC calc step display
- [ ] Identify what data is missing or wrong
- [ ] Fix the data flow

## Task 2: Research AP Systems microinverter specs
- [ ] Research DS3, DS3-S, DS3-L specs (wattage, AC output current, voltage)
- [ ] Determine panels per micro (2 per device)
- [ ] Document AC output amps per model

## Task 3: Implement AP Systems inverter logic
- [ ] Add AP Systems models to inverter registry/constants
- [ ] Add inverterModulesPerDevice = 2 for AP Systems
- [ ] Add per-model AC output current values
- [ ] Ensure branch sizing uses correct per-device current
- [ ] Verify 20A breaker / #10 AWG sizing works for all AP models

## Task 4: Verify & test
- [ ] Run tsc --noEmit
- [ ] Run 27/27 test suite
- [ ] Verify branch sizing for each AP model
- [ ] Commit, push, create zip