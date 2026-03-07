#!/usr/bin/env python3
"""
Apply all mounting database integration fixes to app/engineering/page.tsx
in a single clean pass to avoid cascading issues.

Changes:
1. Add 3 useState hooks to top-level component (after intelligencePanelOpen)
2. Add useEffect to sync selectedMountingId with config.mountingId
3. Add useEffect for DB load verification console.log
4. Remove 3 React.useState calls from IIFE (lines 5067-5069)
"""

with open('app/engineering/page.tsx', 'r') as f:
    lines = f.readlines()

print(f"Original file: {len(lines)} lines")

# ─── CHANGE 1: Add 3 useState hooks after intelligencePanelOpen ───────────────
target_1 = "  const [intelligencePanelOpen, setIntelligencePanelOpen] = useState(true);\n"
idx_1 = None
for i, line in enumerate(lines):
    if line == target_1:
        idx_1 = i
        break

assert idx_1 is not None, "Could not find intelligencePanelOpen useState"
print(f"✓ Found intelligencePanelOpen at line {idx_1+1}")

insert_1 = [
    "  // ── Mounting Details Tab state (moved to top-level to fix React hooks violation) ──\n",
    "  const [mountingInstallType, setMountingInstallType] = useState<'residential' | 'commercial' | 'ground'>('residential');\n",
    "  const [selectedMountingId, setSelectedMountingId] = useState<string>('ironridge-xr100');\n",
    "  const [showAllSystems, setShowAllSystems] = useState(false);\n",
]

lines = lines[:idx_1+1] + insert_1 + lines[idx_1+1:]
print(f"✓ Inserted 4 lines after intelligencePanelOpen")

# ─── CHANGE 2+3: Add useEffects after handlePrint ──────────────────────────────
target_2 = "  const handlePrint = () => window.print();\n"
idx_2 = None
for i, line in enumerate(lines):
    if line == target_2:
        idx_2 = i
        break

assert idx_2 is not None, "Could not find handlePrint"
print(f"✓ Found handlePrint at line {idx_2+1}")

insert_2 = [
    "\n",
    "  // ── Sync selectedMountingId with config.mountingId when config changes ──────────\n",
    "  useEffect(() => {\n",
    "    if (config.mountingId && config.mountingId !== selectedMountingId) {\n",
    "      setSelectedMountingId(config.mountingId);\n",
    "    }\n",
    "  // eslint-disable-next-line react-hooks/exhaustive-deps\n",
    "  }, [config.mountingId]);\n",
    "\n",
    "  // ── DB load verification (console log on mount) ──────────────────────────────────\n",
    "  useEffect(() => {\n",
    "    const systems = getAllMountingSystems();\n",
    "    console.log('[MountingDB] mounting-hardware-db loaded:', systems.length, 'systems');\n",
    "    console.log('[MountingDB] System IDs:', systems.map((s: any) => `${s.manufacturer} ${s.model} (${s.id})`));\n",
    "  }, []);\n",
]

lines = lines[:idx_2+1] + insert_2 + lines[idx_2+1:]
print(f"✓ Inserted {len(insert_2)} lines after handlePrint")

# ─── CHANGE 4: Remove 3 React.useState calls from IIFE ───────────────────────
lines_to_remove = []
for i, line in enumerate(lines):
    if (
        "React.useState" in line and
        ("mountingInstallType" in line or "selectedMountingId" in line or "showAllSystems" in line)
    ):
        lines_to_remove.append(i)
        print(f"✓ Found React.useState to remove at line {i+1}: {line.strip()[:80]}")

assert len(lines_to_remove) == 3, f"Expected 3 React.useState lines, found {len(lines_to_remove)}"

for idx in reversed(lines_to_remove):
    del lines[idx]

print(f"✓ Removed {len(lines_to_remove)} React.useState calls from IIFE")

# ─── WRITE FILE ───────────────────────────────────────────────────────────────
with open('app/engineering/page.tsx', 'w') as f:
    f.writelines(lines)

print(f"\n✅ All changes applied. File now has {len(lines)} lines")

# ─── VERIFY ───────────────────────────────────────────────────────────────────
print("\n=== VERIFICATION ===")

with open('app/engineering/page.tsx', 'r') as f:
    content = f.read()

iife_start = content.find("{activeTab === 'mounting' && (() => {")
iife_end = content.find("})()}", iife_start)
iife_content = content[iife_start:iife_end]

checks = [
    ("No React.useState in IIFE", 'React.useState' not in iife_content),
    ("mountingInstallType useState exactly once", content.count("const [mountingInstallType") == 1),
    ("selectedMountingId useState exactly once", content.count("const [selectedMountingId") == 1),
    ("showAllSystems useState exactly once", content.count("const [showAllSystems") == 1),
    ("logDecision still present", "const logDecision = " in content),
    ("handleAutoFill still present", "const handleAutoFill = async () => {" in content),
    ("categoryMap still in IIFE", "const categoryMap: Record<string, MountingCategory[]>" in iife_content),
    ("filteredSystems still in IIFE", "const filteredSystems = allSystems.filter" in iife_content),
    ("DB load verification present", "[MountingDB] mounting-hardware-db loaded:" in content),
    ("config.mountingId sync useEffect present", "}, [config.mountingId]);" in content),
]

all_pass = True
for name, result in checks:
    status = "✅ PASS" if result else "❌ FAIL"
    print(f"{status}: {name}")
    if not result:
        all_pass = False

print(f"\nFile has {content.count(chr(10))} lines")
if all_pass:
    print("✅ All checks passed!")
else:
    print("❌ Some checks failed!")