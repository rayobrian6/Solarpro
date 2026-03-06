with open('lib/computed-system.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix: moduleCount should be microDeviceCount for micro topology
# segment-schedule.ts uses moduleCount as device count, not panel count
old = "  const segmentScheduleInput: SegmentScheduleInput = {\n    topology: input.topology,\n    moduleCount: input.totalPanels,"
new = "  const segmentScheduleInput: SegmentScheduleInput = {\n    topology: input.topology,\n    // NOTE: segment-schedule.ts uses moduleCount as DEVICE count (not panel count)\n    // For DS3-S (2 panels/device): 40 panels = 20 devices\n    // microDeviceCount = ceil(totalPanels / inverterModulesPerDevice)\n    moduleCount: isMicro ? microDeviceCount : input.totalPanels,"

if old in content:
    content = content.replace(old, new)
    print("Fix applied: moduleCount now uses microDeviceCount for micro topology")
else:
    print("ERROR: Pattern not found!")
    # Try to find it
    idx = content.find("moduleCount: input.totalPanels,")
    if idx >= 0:
        print(f"Found at index {idx}: {repr(content[idx-100:idx+60])}")

with open('lib/computed-system.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print("Done.")