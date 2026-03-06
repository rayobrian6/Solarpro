#!/usr/bin/env python3
"""
BUILD v24: Update page.tsx SLD fetch payload to send batteryId, generatorId,
generatorOutputBreakerA so route.ts can do equipment-db lookups for NEC-sized segments.
"""

with open('app/engineering/page.tsx', 'r', encoding='utf-8') as f:
    src = f.read()

print(f"Loaded: {len(src)} chars")

# Add batteryId, generatorId, generatorOutputBreakerA to the SLD fetch payload
# Anchor: the runs: cs.runs line in the SLD fetch
old_runs_line = """          // Pass ComputedSystem.runs as single source of truth for conduit schedule
          runs:           cs.runs,"""

new_runs_line = """          // BUILD v24: Pass equipment IDs so route.ts can look up specs for NEC-sized segments
          // batteryId → getBatteryById → backfeedBreakerA, maxContinuousOutputA
          // generatorId → getGeneratorById → outputBreakerA (was hardcoded #6 AWG — wrong for 100A)
          // backupInterfaceId already sent above
          batteryId:      config.batteryId || undefined,
          generatorId:    config.generatorId || undefined,
          // Also send generatorOutputBreakerA directly as fallback
          generatorOutputBreakerA: config.generatorId
            ? (() => { const g = getGeneratorById(config.generatorId); return g?.outputBreakerA ?? undefined; })()
            : undefined,
          // Pass ComputedSystem.runs as single source of truth for conduit schedule
          runs:           cs.runs,"""

assert old_runs_line in src, "runs: cs.runs anchor not found in SLD fetch"
src = src.replace(old_runs_line, new_runs_line, 1)
print("OK 1: batteryId, generatorId, generatorOutputBreakerA added to SLD fetch payload")

with open('app/engineering/page.tsx', 'w', encoding='utf-8') as f:
    f.write(src)

print(f"\nALL DONE — page.tsx updated: {len(src)} chars")