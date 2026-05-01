#!/usr/bin/env python3
"""
Engineering page power-move overhaul v53.0
Surgical string replacements on app/engineering/page.tsx
"""

TARGET = 'app/engineering/page.tsx'

with open(TARGET, 'r', encoding='utf-8') as f:
    src = f.read()

original = src

def replace_all(text, old, new, label):
    count = text.count(old)
    result = text.replace(old, new)
    print(f"  {label}: {count} replacements")
    return result

print("=== Engineering Page Overhaul v53.0 ===\n")

# ─── 1. card p-5 → eng-panel ───────────────────────────────────────────────
src = replace_all(src,
    'className="card p-5"',
    'className="eng-panel"',
    'card p-5 → eng-panel'
)

# ─── 2. Flat input → eng-input ─────────────────────────────────────────────
FLAT_INPUT = ('className="w-full bg-slate-800 border border-slate-700 '
              'rounded-lg px-3 py-2 text-sm text-white focus:outline-none '
              'focus:border-amber-500/60"')
src = replace_all(src, FLAT_INPUT, 'className="eng-input"', 'flat input → eng-input')

# ─── 3. Flat select with appearance-none ───────────────────────────────────
FLAT_SELECT2 = ('className="w-full bg-slate-800 border border-slate-700 '
                'rounded-lg px-3 py-2 text-sm text-white focus:outline-none '
                'focus:border-amber-500/60 appearance-none"')
src = replace_all(src, FLAT_SELECT2, 'className="eng-select"', 'flat select (appearance-none) → eng-select')

# ─── 4. Flat label → eng-label ─────────────────────────────────────────────
src = replace_all(src,
    'className="text-xs text-slate-400 mb-1 block"',
    'className="eng-label"',
    'flat label → eng-label'
)
src = replace_all(src,
    'className="text-xs text-slate-400 mb-1 block flex items-center gap-1"',
    'className="eng-label flex items-center gap-1"',
    'flat label flex-1 → eng-label'
)
src = replace_all(src,
    'className="text-xs text-slate-400 mb-1 block flex items-center gap-2"',
    'className="eng-label flex items-center gap-2"',
    'flat label flex-2 → eng-label'
)

# ─── 5. Auto-sized amber field ─────────────────────────────────────────────
src = replace_all(src,
    ('className="w-full bg-slate-800/50 border border-amber-500/30 rounded-lg '
     'px-3 py-2 text-sm text-amber-300 font-mono cursor-not-allowed"'),
    'className="eng-auto-field"',
    'auto-field → eng-auto-field'
)

# ─── 6. ComplianceSummaryBar outer div ─────────────────────────────────────
src = replace_all(src,
    ('className="flex items-center gap-3 px-6 py-2.5 bg-slate-800/60 '
     'border-b border-slate-700/50 flex-shrink-0 flex-wrap"'),
    'className="compliance-rail"',
    'compliance bar → compliance-rail'
)

# ─── 7. Section h3 headers ─────────────────────────────────────────────────
src = replace_all(src,
    'className="text-sm font-bold text-white mb-4 flex items-center gap-2"',
    'className="text-sm font-extrabold text-slate-100 mb-4 flex items-center gap-2 tracking-tight"',
    'h3 header upgrade'
)

# ─── 8. Write output ───────────────────────────────────────────────────────
with open(TARGET, 'w', encoding='utf-8') as f:
    f.write(src)

delta = len(src) - len(original)
print(f"\n✅ Done.")
print(f"   Original: {len(original):,} chars")
print(f"   New:      {len(src):,} chars")
print(f"   Delta:    {delta:+,} chars")