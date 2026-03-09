#!/usr/bin/env python3
"""
Patch app/projects/[id]/page.tsx to add Engineering tab.
Adds:
1. Import for EngineeringTab component
2. Tab state management
3. Engineering tab button in the header
4. Engineering tab content panel
"""

SRC = 'app/projects/[id]/page.tsx'

with open(SRC, 'r', encoding='utf-8') as f:
    content = f.read()

# ── Patch 1: Add import for EngineeringTab ────────────────────────────────────
old_import = "import {\n  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,\n  ResponsiveContainer, LineChart, Line\n} from 'recharts';"

new_import = """import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line
} from 'recharts';
import EngineeringTab from '@/components/engineering/EngineeringTab';"""

if old_import in content:
    content = content.replace(old_import, new_import)
    print("✅ Patch 1: Added EngineeringTab import")
else:
    print("⚠️  Patch 1: recharts import not found, trying alternative")
    # Try to add after last import
    last_import_idx = content.rfind("import ")
    line_end = content.find('\n', last_import_idx)
    content = content[:line_end+1] + "import EngineeringTab from '@/components/engineering/EngineeringTab';\n" + content[line_end+1:]
    print("✅ Patch 1: Added EngineeringTab import after last import")

# ── Patch 2: Add activeTab state ─────────────────────────────────────────────
old_state = "  const [project, setProject] = useState<Project | null>(null);\n  const [loading, setLoading] = useState(true);"
new_state = """  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'engineering'>('overview');"""

if old_state in content:
    content = content.replace(old_state, new_state)
    print("✅ Patch 2: Added activeTab state")
else:
    print("⚠️  Patch 2: state declaration not found")

# ── Patch 3: Add Engineering button to header actions ─────────────────────────
old_actions = """          <div className="flex gap-2">
            <Link href={`/design?projectId=${id}`} className="btn-secondary btn-sm"><Map size={14} /> Design Studio</Link>
            <Link href={`/proposals?projectId=${id}`} className="btn-primary btn-sm"><FileText size={14} /> Generate Proposal</Link>
          </div>"""

new_actions = """          <div className="flex gap-2 flex-wrap">
            <Link href={`/design?projectId=${id}`} className="btn-secondary btn-sm"><Map size={14} /> Design Studio</Link>
            <button
              onClick={() => setActiveTab(activeTab === 'engineering' ? 'overview' : 'engineering')}
              className={`btn-sm flex items-center gap-1.5 ${activeTab === 'engineering' ? 'btn-primary' : 'btn-secondary'}`}
            >
              <Zap size={14} /> Engineering
            </button>
            <Link href={`/proposals?projectId=${id}`} className="btn-primary btn-sm"><FileText size={14} /> Generate Proposal</Link>
          </div>"""

if old_actions in content:
    content = content.replace(old_actions, new_actions)
    print("✅ Patch 3: Added Engineering tab button")
else:
    print("⚠️  Patch 3: header actions not found")

# ── Patch 4: Add tab content wrapper ─────────────────────────────────────────
# Find the grid that starts the main content
old_grid = '        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">'
new_grid = """        {/* Tab Navigation */}
        <div className="flex gap-1 border-b border-slate-700/50 pb-0">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
              activeTab === 'overview'
                ? 'bg-slate-800 text-white border border-slate-700/50 border-b-slate-800'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveTab('engineering')}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors flex items-center gap-1.5 ${
              activeTab === 'engineering'
                ? 'bg-slate-800 text-white border border-slate-700/50 border-b-slate-800'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Zap size={13} className="text-amber-400" /> Engineering
          </button>
        </div>

        {/* Engineering Tab */}
        {activeTab === 'engineering' && (
          <div className="card p-0 overflow-hidden">
            <EngineeringTab projectId={id} projectName={project.name} />
          </div>
        )}

        {/* Overview Tab */}
        {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">"""

if old_grid in content:
    content = content.replace(old_grid, new_grid)
    print("✅ Patch 4: Added tab content wrapper")
else:
    print("⚠️  Patch 4: grid not found")

# ── Patch 5: Close the overview tab div ──────────────────────────────────────
# Find the last closing div before the AppShell closing
# We need to close the overview tab wrapper
# Find the end of the main content area
old_end = "      </div>\n    </AppShell>"
new_end = """      </div>
        )} {/* end overview tab */}
      </div>
    </AppShell>"""

# Count occurrences to find the right one
count = content.count(old_end)
print(f"  Found {count} occurrences of closing pattern")

if count >= 1:
    # Replace the last occurrence
    last_idx = content.rfind(old_end)
    content = content[:last_idx] + new_end + content[last_idx + len(old_end):]
    print("✅ Patch 5: Closed overview tab wrapper")
else:
    print("⚠️  Patch 5: closing pattern not found")

with open(SRC, 'w', encoding='utf-8') as f:
    f.write(content)
print(f"\n✅ Written {SRC}")