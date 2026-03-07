#!/usr/bin/env python3
"""Remove duplicate search bar from Mounting Details tab."""

with open('app/engineering/page.tsx', 'r') as f:
    content = f.read()

# Remove the duplicate search bar (the second one added by the earlier str-replace)
# The first one is in the header section (from fix_mounting_tab.py)
# The second one is the standalone one added by the earlier str-replace

duplicate_search = """
                  {/* Search Bar */}
                  <div className="relative mb-3">
                    <input
                      type="text"
                      placeholder="Search by brand, model, or type..."
                      value={mountingSearchQuery}
                      onChange={e => { setMountingSearchQuery(e.target.value); setShowAllSystems(true); }}
                      className="w-full bg-slate-800/60 border border-slate-700/50 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/60"
                    />
                    {mountingSearchQuery && (
                      <button onClick={() => setMountingSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white text-xs">✕</button>
                    )}
                  </div>

                  {/* Active system indicator */}
                  {config.mountingId && config.mountingId !== selectedMountingId && (
                    <div className="mb-3 flex items-center gap-2 text-xs text-slate-400 bg-slate-800/40 rounded-lg px-3 py-2">
                      <span className="text-amber-400">⚡</span>
                      <span>Active in Structural: <span className="text-amber-300 font-bold">{ALL_MOUNTING_SYSTEMS.find(s => s.id === config.mountingId)?.manufacturer} {ALL_MOUNTING_SYSTEMS.find(s => s.id === config.mountingId)?.model}</span></span>
                      <button onClick={() => setSelectedMountingId(config.mountingId)} className="ml-auto text-amber-400 hover:text-amber-300 font-bold">View →</button>
                    </div>
                  )}"""

if duplicate_search in content:
    content = content.replace(duplicate_search, '')
    print("✅ Removed duplicate search bar and old active indicator")
else:
    # Try to find it with unicode
    lines = content.split('\n')
    start_idx = None
    end_idx = None
    for i, line in enumerate(lines):
        if '/* Search Bar */' in line and start_idx is None:
            # Check if this is the second occurrence
            prev_content = '\n'.join(lines[:i])
            if '/* Search Bar */' in prev_content:
                start_idx = i - 1  # include blank line before
                print(f"Found duplicate search bar at line {i+1}")
        if start_idx is not None and 'View →' in line:
            end_idx = i + 2  # include closing div and blank line
            break
    
    if start_idx is not None and end_idx is not None:
        lines = lines[:start_idx] + lines[end_idx:]
        content = '\n'.join(lines)
        print(f"✅ Removed duplicate search bar (lines {start_idx+1}-{end_idx})")
    else:
        print("⚠️  Could not find duplicate search bar")

with open('app/engineering/page.tsx', 'w') as f:
    f.write(content)

# Verify
count = content.count('Search by brand')
print(f"Search bar count: {count} (should be 1)")