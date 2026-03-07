#!/usr/bin/env python3
"""Fix electrical-calc.ts to add battery/generator NEC awareness."""

with open('lib/electrical-calc.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Find and replace the interconnection section to add battery bus impact
old = """  const isMicroSystem = input.inverters.every(inv => inv.type === 'micro');
  const solarBreakerRequired = isMicroSystem
    ? nextStandardOCPD(totalAcOutputAmps * 1.25)
    : nextStandardOCPD((totalAcOutputAmps / Math.max(input.inverters.length, 1)) * 1.25);

  // Resolve interconnection config \u2014 default to LOAD_SIDE with mainPanelAmps as bus
  const icMethod: InterconnectionMethod = input.interconnection?.method ?? 'LOAD_SIDE';
  const icBusRating   = input.interconnection?.busRating   ?? input.mainPanelAmps;
  const icMainBreaker = input.interconnection?.mainBreaker ?? input.mainPanelAmps;
  const icSolarBreaker = input.interconnection?.solarBreaker ?? solarBreakerRequired;"""

new = """  const isMicroSystem = input.inverters.every(inv => inv.type === 'micro');
  const solarBreakerRequired = isMicroSystem
    ? nextStandardOCPD(totalAcOutputAmps * 1.25)
    : nextStandardOCPD((totalAcOutputAmps / Math.max(input.inverters.length, 1)) * 1.25);

  // Battery NEC 705.12(B) bus impact \u2014 AC-coupled battery backfeed breakers add to bus loading
  // NEC 705.12(B): ALL backfeed breakers (solar + battery) count toward 120% rule
  const batteryBackfeedA = input.batteryBackfeedA ?? 0;
  const totalBackfeedWithBattery = solarBreakerRequired + batteryBackfeedA;

  // Resolve interconnection config \u2014 default to LOAD_SIDE with mainPanelAmps as bus
  const icMethod: InterconnectionMethod = input.interconnection?.method ?? 'LOAD_SIDE';
  const icBusRating   = input.interconnection?.busRating   ?? input.mainPanelAmps;
  const icMainBreaker = input.interconnection?.mainBreaker ?? input.mainPanelAmps;
  // Use combined solar + battery backfeed for 120% rule check (NEC 705.12(B))
  const icSolarBreaker = input.interconnection?.solarBreaker ?? totalBackfeedWithBattery;"""

if old in content:
    content = content.replace(old, new)
    print("✅ Battery bus impact section added")
else:
    print("❌ Could not find target section")
    # Try to find partial match
    idx = content.find("const isMicroSystem = input.inverters.every")
    if idx >= 0:
        print(f"Found isMicroSystem at index {idx}")
        print(repr(content[idx:idx+500]))

with open('lib/electrical-calc.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print("Done.")