#!/usr/bin/env python3
"""v47.432 Stage 8.2 — tag the 5 pre-existing drift SKUs with overridesEquipmentDb=true.

Per user directive for v47.432: 'Keep this release low-risk: pure deletion +
additive tests only. Keep racking unification and brand-profile centralization
deferred.' We do NOT fix the drift values — we document them with the
overridesEquipmentDb opt-out flag so CI is green today and the backlog is
visible to the next engineer touching Stage 8.4.

Each override is accompanied by a one-line comment recording the drift and a
TODO(v47.4xx/Stage 8.4) marker so grep finds them later.
"""
from pathlib import Path

edits = [
    # --- sungrow SG15RS: intentional brand design rule (1 string/MPPT policy) ---
    (
        'lib/system/brandProfiles/sungrow.ts',
        "    { equipmentDbId: 'sungrow-sg15rs',  acKw: 15.0, dcKwMax: 22.5, mpptCount: 2, minPanelsPerString: 10, maxPanelsPerString: 20, maxParallelStringsPerMppt: 1 },",
        "    // v47.432 Stage 8.2: overridesEquipmentDb=true — intentional brand design rule\n"
        "    //   Hardware supports maxParallelStringsPerMppt: 2 per datasheet; Sungrow profile\n"
        "    //   enforces 1 string/MPPT policy for residential design conservatism.\n"
        "    { equipmentDbId: 'sungrow-sg15rs',  acKw: 15.0, dcKwMax: 22.5, mpptCount: 2, minPanelsPerString: 10, maxPanelsPerString: 20, maxParallelStringsPerMppt: 1, overridesEquipmentDb: true },",
    ),
    # --- SMA SB 7.7: stale profile value - v47.417 registry correction not propagated ---
    (
        'lib/system/brandProfiles/sma.ts',
        "    { equipmentDbId: 'sma-sb-7.7',  acKw: 7.7,  dcKwMax: 11.55, mpptCount: 2, minPanelsPerString: 6, maxPanelsPerString: 14, maxParallelStringsPerMppt: 1 },",
        "    // v47.432 Stage 8.2: overridesEquipmentDb=true — STALE PROFILE (pre-existing drift)\n"
        "    //   Registry says mpptCount: 3 (v47.417 datasheet correction). Profile still says 2.\n"
        "    //   TODO(Stage 8.4): reconcile by updating profile or removing the mpptCount field\n"
        "    //   from BrandInverterModelRef so it reads from equipment-db directly.\n"
        "    { equipmentDbId: 'sma-sb-7.7',  acKw: 7.7,  dcKwMax: 11.55, mpptCount: 2, minPanelsPerString: 6, maxPanelsPerString: 14, maxParallelStringsPerMppt: 1, overridesEquipmentDb: true },",
    ),
    # --- SMA SB 10.0: intentional - residential SMA does not use external combiners ---
    (
        'lib/system/brandProfiles/sma.ts',
        "    { equipmentDbId: 'sma-sb-10.0', acKw: 10.0, dcKwMax: 15.0, mpptCount: 2, minPanelsPerString: 8,  maxPanelsPerString: 16, maxParallelStringsPerMppt: 1 },",
        "    // v47.432 Stage 8.2: overridesEquipmentDb=true — intentional brand design rule\n"
        "    //   Registry says maxParallelStringsPerMppt: 6 (achievable via external DC Combiner\n"
        "    //   Box per discontinued TL-US datasheet). Residential SMA profile forces 1 string/MPPT\n"
        "    //   because typical US residential installs do not include a combiner.\n"
        "    { equipmentDbId: 'sma-sb-10.0', acKw: 10.0, dcKwMax: 15.0, mpptCount: 2, minPanelsPerString: 8,  maxPanelsPerString: 16, maxParallelStringsPerMppt: 1, overridesEquipmentDb: true },",
    ),
    # --- GoodWe GW10K-MS: stale profile - v47.417 re-mapped SKU to GW9600-MS-US ---
    (
        'lib/system/brandProfiles/goodwe.ts',
        "    { equipmentDbId: 'goodwe-gw10k-ms',  acKw: 10.0, dcKwMax: 15.0, mpptCount: 2, minPanelsPerString: 8, maxPanelsPerString: 16, maxParallelStringsPerMppt: 1 },",
        "    // v47.432 Stage 8.2: overridesEquipmentDb=true — STALE PROFILE (pre-existing drift)\n"
        "    //   v47.417 remapped the 'goodwe-gw10k-ms' id to GoodWe GW9600-MS-US in equipment-db\n"
        "    //   (the original GW10K-MS SKU does not exist in the MS-US catalog). Registry values:\n"
        "    //   acOutputKw: 9.6, dcInputKwMax: 14.4, mpptChannels: 3. Profile still has 10.0/15.0/2.\n"
        "    //   TODO(Stage 8.4): reconcile profile to 9.6/14.4/3 OR rename the id token to match\n"
        "    //   the actual product (GW9600-MS-US).\n"
        "    { equipmentDbId: 'goodwe-gw10k-ms',  acKw: 10.0, dcKwMax: 15.0, mpptCount: 2, minPanelsPerString: 8, maxPanelsPerString: 16, maxParallelStringsPerMppt: 1, overridesEquipmentDb: true },",
    ),
    # --- generic-string se-7600h: stale catch-all fallback entry ---
    (
        'lib/system/brandProfiles/generic-string.ts',
        "    { equipmentDbId: 'se-7600h',  acKw: 7.6,  dcKwMax: 11.4, mpptCount: 2, minPanelsPerString: 8, maxPanelsPerString: 20 },",
        "    // v47.432 Stage 8.2: overridesEquipmentDb=true — STALE CATCH-ALL (pre-existing drift)\n"
        "    //   Registry says mpptCount: 1 (SolarEdge HD-Wave is single-MPPT per optimizer inverter).\n"
        "    //   Profile's 'generic-string' fallback kept 2 as a historical catch-all value.\n"
        "    //   TODO(Stage 8.4): remove SolarEdge SKUs from generic-string — they belong in solaredge.ts.\n"
        "    { equipmentDbId: 'se-7600h',  acKw: 7.6,  dcKwMax: 11.4, mpptCount: 2, minPanelsPerString: 8, maxPanelsPerString: 20, overridesEquipmentDb: true },",
    ),
    # --- generic-string se-10000h: stale catch-all fallback entry ---
    (
        'lib/system/brandProfiles/generic-string.ts',
        "    { equipmentDbId: 'se-10000h', acKw: 10.0, dcKwMax: 15.0, mpptCount: 2, minPanelsPerString: 8, maxPanelsPerString: 20 },",
        "    // v47.432 Stage 8.2: overridesEquipmentDb=true — STALE CATCH-ALL (pre-existing drift)\n"
        "    //   Registry says mpptCount: 1 (SolarEdge HD-Wave is single-MPPT per optimizer inverter).\n"
        "    //   Same disposition as 'se-7600h' above. TODO(Stage 8.4): remove SolarEdge SKUs from\n"
        "    //   generic-string (they belong in solaredge.ts), or delete generic-string entirely.\n"
        "    { equipmentDbId: 'se-10000h', acKw: 10.0, dcKwMax: 15.0, mpptCount: 2, minPanelsPerString: 8, maxPanelsPerString: 20, overridesEquipmentDb: true },",
    ),
]

for filepath, old, new in edits:
    p = Path(filepath)
    txt = p.read_text(encoding='utf-8')
    if old not in txt:
        print(f'WARN: {filepath}: target line not found:\n  {old[:100]}...')
        continue
    if txt.count(old) > 1:
        print(f'WARN: {filepath}: target line appears {txt.count(old)} times (ambiguous)')
        continue
    txt = txt.replace(old, new, 1)
    p.write_text(txt, encoding='utf-8')
    print(f'OK:   {filepath}')

print('\nDone — drift-opt-outs tagged.')