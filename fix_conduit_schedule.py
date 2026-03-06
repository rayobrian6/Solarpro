with open('lib/computed-system.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix 1: conduitSchedule should exclude open-air runs (NONE conduit type)
old1 = "  const conduitSchedule: ConduitScheduleRow[] = runs.map((run, idx) => ({"
new1 = "  const conduitSchedule: ConduitScheduleRow[] = runs.filter(r => !r.isOpenAir && r.conduitType !== 'NONE' && r.conduitSize !== 'N/A').map((run, idx) => ({"

if old1 in content:
    content = content.replace(old1, new1)
    print("Fix 1 applied: conduitSchedule now excludes open-air runs")
else:
    print("Fix 1 NOT FOUND")

# Fix 2: runsWithConduit filter should match the conduitSchedule filter
old2 = "  const runsWithConduit = runs.filter(r => r.conduitType !== 'NONE' && r.conduitSize !== 'NONE');"
new2 = "  const runsWithConduit = runs.filter(r => !r.isOpenAir && r.conduitType !== 'NONE' && r.conduitSize !== 'N/A');"

if old2 in content:
    content = content.replace(old2, new2)
    print("Fix 2 applied: runsWithConduit filter now matches conduitSchedule filter")
else:
    print("Fix 2 NOT FOUND - checking variant...")
    idx = content.find("runsWithConduit = runs.filter")
    if idx >= 0:
        print(f"  Found at: {repr(content[idx:idx+100])}")

with open('lib/computed-system.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print("Done.")