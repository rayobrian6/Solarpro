#!/usr/bin/env python3
with open('lib/computed-system.ts', 'r', encoding='utf-8') as f:
    src = f.read()

checks = [
    'BATTERY_TO_BUI_RUN',
    'BUI_TO_MSP_RUN',
    'GENERATOR_TO_ATS_RUN',
    'ATS_TO_MSP_RUN',
    'batteryBackfeedA',
    'batteryContinuousOutputA',
    'generatorOutputBreakerA',
    'atsAmpRating',
    'backupInterfaceMaxA',
    'hasEnphaseIQSC3',
    'runLengthsBatteryGen',
    'batteryBusImpactFromIds',
    'BUILD v24',
    'NEC 705.12(B)',
    'NEC 702.5',
    'NEC 250.30',
    'IQ SC3 GEN PORT',
]
all_ok = True
for c in checks:
    ok = c in src
    if not ok:
        all_ok = False
    print(f'  [{"OK" if ok else "MISSING"}] {c}')
print(f'\nTotal size: {len(src)} chars')
print(f'\n{"ALL CHECKS PASSED" if all_ok else "SOME CHECKS FAILED"}')