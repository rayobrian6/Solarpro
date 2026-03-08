#!/usr/bin/env python3
"""
Add per-tab subscription gating to engineering page:
1. Import useSubscription hook
2. Add can() checks for diagram/permit/bom tabs
3. Add lock icons on gated tabs in tab bar
4. Wrap tab content with upgrade prompts
"""

with open('/workspace/app/engineering/page.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# ─── 1. Add useSubscription import ───────────────────────────────────────────
if 'useSubscription' not in content:
    content = content.replace(
        "import PlanGate from '@/components/ui/PlanGate';",
        "import PlanGate from '@/components/ui/PlanGate';\nimport { useSubscription } from '@/hooks/useSubscription';"
    )
    print("✅ Added useSubscription import")
else:
    print("✅ useSubscription already imported")

# ─── 2. Add can() calls after existing state declarations ────────────────────
OLD_TABS_DECL = """  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = ["""

NEW_TABS_DECL = """  // Per-tab feature gating
  const { can } = useSubscription();
  const canSLD    = can('engineering');      // Professional+
  const canPermit = can('permitPackets');    // Professional+
  const canBOM    = can('bom');              // Professional+

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = ["""

if OLD_TABS_DECL in content:
    content = content.replace(OLD_TABS_DECL, NEW_TABS_DECL, 1)
    print("✅ Added can() feature checks")
else:
    print("❌ ANCHOR for tabs declaration not found")

# ─── 3. Add lock icons on gated tabs ─────────────────────────────────────────
OLD_TAB_RENDER = """          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-t-lg text-sm font-medium transition-all border-b-2 whitespace-nowrap ${
                activeTab === tab.id ? 'text-amber-400 border-amber-400 bg-amber-500/5' : 'text-slate-400 border-transparent hover:text-white'
              }`}>
              {tab.icon} {tab.label}
              {tab.id === 'compliance' && (rulesResult?.overallStatus || compliance.overallStatus) === 'FAIL' && <span className="w-2 h-2 rounded-full bg-red-500 ml-0.5" />}
              {tab.id === 'compliance' && (rulesResult?.overallStatus || compliance.overallStatus) === 'WARNING' && <span className="w-2 h-2 rounded-full bg-amber-500 ml-0.5" />}
              {tab.id === 'compliance' && configDirty && !calculating && <span className="w-2 h-2 rounded-full bg-amber-400/50 ml-0.5 animate-pulse" />}
            </button>
          ))}"""

NEW_TAB_RENDER = """          {tabs.map(tab => {
            const isLocked =
              (tab.id === 'diagram' && !canSLD) ||
              (tab.id === 'permit'  && !canPermit) ||
              (tab.id === 'bom'     && !canBOM);
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-t-lg text-sm font-medium transition-all border-b-2 whitespace-nowrap ${
                  activeTab === tab.id ? 'text-amber-400 border-amber-400 bg-amber-500/5' : 'text-slate-400 border-transparent hover:text-white'
                } ${isLocked ? 'opacity-60' : ''}`}>
                {tab.icon} {tab.label}
                {isLocked && <Lock size={10} className="text-slate-500 ml-0.5" />}
                {tab.id === 'compliance' && (rulesResult?.overallStatus || compliance.overallStatus) === 'FAIL' && <span className="w-2 h-2 rounded-full bg-red-500 ml-0.5" />}
                {tab.id === 'compliance' && (rulesResult?.overallStatus || compliance.overallStatus) === 'WARNING' && <span className="w-2 h-2 rounded-full bg-amber-500 ml-0.5" />}
                {tab.id === 'compliance' && configDirty && !calculating && <span className="w-2 h-2 rounded-full bg-amber-400/50 ml-0.5 animate-pulse" />}
              </button>
            );
          })}"""

if OLD_TAB_RENDER in content:
    content = content.replace(OLD_TAB_RENDER, NEW_TAB_RENDER, 1)
    print("✅ Lock icons added to gated tabs")
else:
    print("❌ ANCHOR for tab render not found")

# ─── 4. Gate SLD tab content ─────────────────────────────────────────────────
OLD_SLD_TAB = """          {activeTab === 'diagram' && ("""

NEW_SLD_TAB = """          {activeTab === 'diagram' && (!canSLD ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-4">
                <Lock size={28} className="text-amber-400" />
              </div>
              <h3 className="text-white font-bold text-lg mb-1">Single-Line Diagram</h3>
              <p className="text-slate-400 text-sm mb-4 max-w-sm">
                Professional permit-grade SLD generation requires Professional plan or above.
              </p>
              <a href="/account/billing" className="btn-primary inline-flex gap-2">
                Upgrade to Professional
              </a>
            </div>
          ) : ("""

# Find the closing of the SLD tab block
# We need to add a closing paren after the SLD content
# First let's find the SLD tab end
sld_start = content.find("          {activeTab === 'diagram' && (")
if sld_start >= 0:
    content = content.replace("          {activeTab === 'diagram' && (", NEW_SLD_TAB, 1)
    # Now find the matching closing and add extra )
    # Find the position after replacement
    sld_new_start = content.find("          {activeTab === 'diagram' && (!canSLD ? (")
    if sld_new_start >= 0:
        # Find the next top-level tab check after SLD
        next_tab = content.find("\n          {activeTab === 'schedule'", sld_new_start)
        if next_tab < 0:
            next_tab = content.find("\n          {activeTab === 'structural'", sld_new_start)
        if next_tab >= 0:
            # Find the last )} before next_tab
            chunk = content[sld_new_start:next_tab]
            # Count to find the closing of the original SLD block
            # The original ends with "          )}" - add extra ")" before it
            last_close = chunk.rfind('\n          )}')
            if last_close >= 0:
                insert_pos = sld_new_start + last_close + len('\n          )}')
                content = content[:insert_pos] + ')' + content[insert_pos:]
                print("✅ SLD tab gated")
            else:
                print("⚠️  Could not find SLD closing bracket")
        else:
            print("⚠️  Could not find next tab after SLD")
    else:
        print("❌ SLD replacement not found after insert")
else:
    print("❌ SLD tab anchor not found")

# ─── 5. Gate Permit tab content ──────────────────────────────────────────────
OLD_PERMIT_TAB = """          {activeTab === 'permit' && ("""

NEW_PERMIT_TAB = """          {activeTab === 'permit' && (!canPermit ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <div className="w-16 h-16 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mx-auto mb-4">
                <Lock size={28} className="text-blue-400" />
              </div>
              <h3 className="text-white font-bold text-lg mb-1">Permit Package</h3>
              <p className="text-slate-400 text-sm mb-4 max-w-sm">
                Permit-ready documentation packages require Professional plan or above.
              </p>
              <a href="/account/billing" className="btn-primary inline-flex gap-2">
                Upgrade to Professional
              </a>
            </div>
          ) : ("""

permit_start = content.find("          {activeTab === 'permit' && (")
if permit_start >= 0:
    content = content.replace("          {activeTab === 'permit' && (", NEW_PERMIT_TAB, 1)
    permit_new_start = content.find("          {activeTab === 'permit' && (!canPermit ? (")
    if permit_new_start >= 0:
        next_tab = content.find("\n          {activeTab === 'bom'", permit_new_start)
        if next_tab >= 0:
            chunk = content[permit_new_start:next_tab]
            last_close = chunk.rfind('\n          )}')
            if last_close >= 0:
                insert_pos = permit_new_start + last_close + len('\n          )}')
                content = content[:insert_pos] + ')' + content[insert_pos:]
                print("✅ Permit tab gated")
            else:
                print("⚠️  Could not find Permit closing bracket")
        else:
            print("⚠️  Could not find next tab after Permit")
    else:
        print("❌ Permit replacement not found after insert")
else:
    print("❌ Permit tab anchor not found")

# ─── 6. Gate BOM tab content ─────────────────────────────────────────────────
OLD_BOM_TAB = """          {activeTab === 'bom' && ("""

NEW_BOM_TAB = """          {activeTab === 'bom' && (!canBOM ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <div className="w-16 h-16 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mx-auto mb-4">
                <Lock size={28} className="text-purple-400" />
              </div>
              <h3 className="text-white font-bold text-lg mb-1">Bill of Materials</h3>
              <p className="text-slate-400 text-sm mb-4 max-w-sm">
                BOM export and detailed material lists require Professional plan or above.
              </p>
              <a href="/account/billing" className="btn-primary inline-flex gap-2">
                Upgrade to Professional
              </a>
            </div>
          ) : ("""

bom_start = content.find("          {activeTab === 'bom' && (")
if bom_start >= 0:
    content = content.replace("          {activeTab === 'bom' && (", NEW_BOM_TAB, 1)
    bom_new_start = content.find("          {activeTab === 'bom' && (!canBOM ? (")
    if bom_new_start >= 0:
        # BOM is the last tab - find the closing of the main content div
        next_close = content.find('\n        </div>', bom_new_start)
        if next_close >= 0:
            chunk = content[bom_new_start:next_close]
            last_close = chunk.rfind('\n          )}')
            if last_close >= 0:
                insert_pos = bom_new_start + last_close + len('\n          )}')
                content = content[:insert_pos] + ')' + content[insert_pos:]
                print("✅ BOM tab gated")
            else:
                print("⚠️  Could not find BOM closing bracket")
        else:
            print("⚠️  Could not find closing div after BOM")
    else:
        print("❌ BOM replacement not found after insert")
else:
    print("❌ BOM tab anchor not found")

with open('/workspace/app/engineering/page.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("✅ Engineering page written successfully")