#!/usr/bin/env python3
"""
Engineering page overhaul v53.0b — mop up remaining input/select variants
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

print("=== Engineering Page Overhaul v53.0b — Mop Up ===\n")

# textarea with placeholder-slate-500 + resize-none
src = replace_all(src,
    ('className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 '
     'text-sm text-white placeholder-slate-500 focus:outline-none '
     'focus:border-amber-500/60 resize-none"'),
    'className="eng-input resize-none"',
    'textarea resize-none → eng-input resize-none'
)

# xs text variant (compact inline selects/inputs)
src = replace_all(src,
    ('className="w-full bg-slate-800 border border-slate-700 rounded-lg '
     'px-2 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500/60"'),
    'className="eng-input text-xs px-2 py-1.5"',
    'xs input variant → eng-input xs'
)

# xs with placeholder
src = replace_all(src,
    ('className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 '
     'text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/60"'),
    'className="eng-input text-xs"',
    'xs input with placeholder → eng-input xs'
)

# Dropdown search popup (autocomplete dropdown list)
src = replace_all(src,
    ('className="absolute top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-700 '
     'rounded-xl shadow-2xl z-50 overflow-hidden max-h-72 overflow-y-auto"'),
    ('className="absolute top-full left-0 right-0 mt-1 bg-slate-900/95 border border-amber-500/20 '
     'rounded-xl shadow-2xl shadow-black/50 z-50 overflow-hidden max-h-72 overflow-y-auto '
     'backdrop-blur-xl"'),
    'dropdown popup → premium glass dropdown'
)

with open(TARGET, 'w', encoding='utf-8') as f:
    f.write(src)

delta = len(src) - len(original)
print(f"\n✅ Done. Delta: {delta:+,} chars")