#!/usr/bin/env python3
with open('lib/sld-professional-renderer.ts', 'r', encoding='utf-8') as f:
    src = f.read()

print(f"File size: {len(src)} chars")

anchors = [
    ("SLDProfessionalInput tail", "  backupInterfaceId?:      string;\n  backupInterfaceBrand?:   string;\n  backupInterfaceModel?:   string;\n  backupInterfaceIsATS?:   boolean;\n  scale:                   string;"),
    ("branchRun findRun", "  const branchRun     = findRun('BRANCH_RUN');"),
    ("battery wire label", "    const batWireGauge = bfA <= 20 ? '#12 AWG THWN-2' : bfA <= 30 ? '#10 AWG THWN-2' : '#8 AWG THWN-2';"),
    ("backup panel wire", "      parts.push(tspan(bpCX - 40 + 6, bpCY - 10, ['#6 AWG THWN-2', 'CRITICAL LOADS'], {sz: F.tiny, anc: 'start', fill: '#6A1B9A'}));"),
    ("NODE 9 comment", "  // \u2500\u2500\u2500 NODE 9: GENERATOR + GENERATOR ATS (if configured) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500"),
    ("120% rule load-side", "    ...(isLoadSide ? [\n      ['Interconnection','Load Side Tap'] as [string,string],\n      ['NEC Reference','NEC 705.12(B)'] as [string,string],\n      ['PV Breaker',`${pvBreakerAmps} A`] as [string,string],\n      ['120% Rule',`${input.mainPanelAmps*1.2 >= input.mainPanelAmps+pvBreakerAmps ? 'PASS \u2713':'FAIL \u2717'}`] as [string,string],\n    ] : isSupplySide ? ["),
]

all_ok = True
for name, anchor in anchors:
    found = anchor in src
    if not found:
        all_ok = False
    print(f"  [{'OK' if found else 'MISSING'}] {name}")

if not all_ok:
    # Show the actual text around the missing anchors for debugging
    for name, anchor in anchors:
        if anchor not in src:
            # Find partial match
            first_line = anchor.split('\n')[0][:50]
            idx = src.find(first_line)
            if idx >= 0:
                print(f"\n  Partial match for '{name}' at {idx}:")
                print(repr(src[idx:idx+200]))
            else:
                print(f"\n  No partial match for '{name}' (first 50: {repr(first_line)})")