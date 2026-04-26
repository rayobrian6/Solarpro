#!/usr/bin/env python3
"""
Debug BOM cost for 141-panel SolarEdge system.
Simulates what the BOM engine generates and prices for a 56.4 kW DC system.
"""

# System parameters (from user's screenshot)
MODULE_COUNT = 141
SYSTEM_KW = 56.4
STRING_COUNT = 6   # ~141/25 = 5.64, ceil = 6 strings
INVERTER_COUNT = 6  # 1 inverter per string for SE optimizer
DC_WIRE_LENGTH = 50
AC_WIRE_LENGTH = 60
ATTACHMENT_COUNT = 12
RAIL_SECTIONS = 4

# Category fallback prices
FALLBACK = {
    'solar_panel':       136.00,   # 0.34 * 400
    'microinverter':     160.00,
    'string_inverter':   1500.00,
    'hybrid_inverter':   2400.00,
    'optimizer':         52.00,
    'battery':           4200.00,
    'racking':           18.00,
    'wire':              0.85,     # per ft
    'trunk_cable':       2.40,
    'conduit':           0.75,
    'breaker':           24.00,
    'disconnect':        185.00,
    'rapid_shutdown':    95.00,
    'combiner':          145.00,
    'junction_box':      18.00,
    'meter':             320.00,
    'gateway':           175.00,
    'monitoring':        95.00,
    'post':              95.00,
    'rail':              55.00,
    'clamp':             8.50,
    'footer':            45.00,
    'hardware':          2.50,
    'panel_frame':       85.00,
    'label':             4.50,
    'terminator':        3.50,
}

# Catalog overrides (exact part matches)
CATALOG = {
    'SE7600H-US000BNU4':  1512.00,
    'SE10000H-US000BNU4': 1680.00,
    'P401-5R2MRM':        49.60,
    'P505-5R2MRM':        54.40,
    'Q.PEAK DUO BLK ML-G10+400': 136.00,  # 0.34 * 400
}

# SE11400H is NOT in catalog → uses fallback $1,500
SE11400H_PRICE = 1500.00

def price(category, part=None, qty=1, unit='ea'):
    if part and part in CATALOG:
        p = CATALOG[part]
    else:
        p = FALLBACK.get(category, 0)
    total = p * qty if unit != 'ft' else p * qty
    return p, total

items = []

def add(stage, category, desc, qty, unit='ea', part=None):
    p, t = price(category, part, qty, unit)
    items.append({
        'stage': stage,
        'category': category,
        'desc': desc,
        'qty': qty,
        'unit': unit,
        'unitCost': p,
        'totalCost': t,
    })

# ====================================================
# STAGE 1: ARRAY
# ====================================================
# 141 solar panels (fallback $136 each)
add('array', 'solar_panel', 'Solar Panel (141×)', MODULE_COUNT, 'ea', 'PANEL-TBD')

# 141 optimizers (SE P505 @ $54.40 each, or fallback $52)
# Assume P505-5R2MRM is sent
add('array', 'optimizer', 'SolarEdge P505 Optimizer (141×)', MODULE_COUNT, 'ea', 'P505-5R2MRM')

# ====================================================
# STAGE 2: DC WIRING
# ====================================================
dc_wire_qty = int(DC_WIRE_LENGTH * 2 * 1.15)  # 115ft
add('dc', 'wire', f'DC Wire #{DC_WIRE_LENGTH}ft × 2 × 1.15', dc_wire_qty, 'ft')

# ====================================================
# STAGE 3: INVERTER
# ====================================================
# SE11400H: 141/25 = 5.64 → ceil = 6 inverters
# But the bug says it's showing 36...
# With the safety guard: inverterCount=141 (moduleCount leaked) → triggers guard
# Guard: rawModules=141, rawInvCount=141, isOptimizer=True → 141>=141 TRUE
# cappedInvCount = max(1, ceil(max(stringCount,2)/2)) = max(1, ceil(max(6,2)/2)) = max(1,3) = 3
# So guard produces 3 inverters
# But if stringCount=0 sent: max(0,2)/2 = 1 inverter
# What if the frontend sends inverterCount=36 (wrong)?
print("=== INVERTER COUNT ANALYSIS ===")
print(f"moduleCount = {MODULE_COUNT}")
for rawInvCount in [36, 141, 5, 6]:
    rawModules = MODULE_COUNT
    rawStrings = STRING_COUNT
    isOptimizer = True
    if isOptimizer and rawModules > 0 and rawInvCount >= rawModules:
        capped = max(1, int((max(rawStrings, 2) + 1) // 2))
        print(f"  rawInvCount={rawInvCount}: OPTIMIZER GUARD fires → cappedInvCount={capped}")
    else:
        print(f"  rawInvCount={rawInvCount}: passes guard → inverterCount={rawInvCount}")

print()

# SE11400H inverters (fallback $1,500 each)
for inv_count in [3, 5, 6, 36]:
    cost = inv_count * SE11400H_PRICE
    print(f"  {inv_count} inverters × $1,500 = ${cost:,.0f}")

print()

# ====================================================
# COMPUTE FULL BOM for inv_count=6 scenario
# ====================================================
INV_COUNT = 6  # realistic for 141 panels with 25/string

add('inverter', 'string_inverter', f'SE11400H (fallback) ×{INV_COUNT}', INV_COUNT, 'ea', 'SE11400H-US000BNU4')

# DC disconnect: per inverter
add('dc', 'disconnect', f'DC Disconnect ×{INV_COUNT}', INV_COUNT, 'ea')

# Rapid shutdown: per module
add('inverter', 'rapid_shutdown', f'Rapid Shutdown ×{MODULE_COUNT}', MODULE_COUNT, 'ea')

# ====================================================
# STAGE 4: AC WIRING
# ====================================================
ac_wire_qty = int(AC_WIRE_LENGTH * 4 * 1.15)  # 4-wire, 1.15 fittings
add('ac', 'wire', f'AC Wire #{AC_WIRE_LENGTH}ft × 4 × 1.15', ac_wire_qty, 'ft')

# AC disconnect
add('ac', 'disconnect', 'AC Disconnect ×1', 1, 'ea')

# Backfeed breaker
add('ac', 'breaker', 'Backfeed Breaker ×1', 1, 'ea')

# Conduit
conduit_qty = int(AC_WIRE_LENGTH * 1.15)
add('ac', 'conduit', f'Conduit ×{conduit_qty}ft', conduit_qty, 'ft')

# ====================================================
# STAGE 5: STRUCTURAL / RACKING
# ====================================================
# Racking: 1 lot (if rackingId sent) — $18 fallback
add('structural', 'racking', 'Racking System (1 lot)', 1, 'lot')

# Ground wire
ground_wire_qty = int(AC_WIRE_LENGTH * 1.15)
add('structural', 'wire', f'Grounding Wire #{ground_wire_qty}ft', ground_wire_qty, 'ft')

# Racking accessories based on registry...
# If IronRidge or SnapNrack is selected, accessories are per module/attachment
# With 141 modules: could have 141 flashing mounts + 141 rail clamps...
# Let's estimate with a typical rooftop racking kit

# Typical accessories for 141 panels (IronRidge XR100):
# - L-feet/attachments: attachmentCount=12 but for 141 panels should be ~2*141=282 or more
# Let's check what attachment count the frontend sends for 141 panels
print("=== RACKING ACCESSORY ANALYSIS ===")
print(f"attachmentCount from BOM route default = {ATTACHMENT_COUNT}")
print(f"  This looks WRONG for 141 panels - should be ~2×141 = 282")
print()

# If XR-100 racking:
# - Rails: railSections (default 4?)
# - L-feet: attachmentCount
# - Mid clamps: moduleCount × 2
# - End clamps: stringCount × 2 (end of each row)

# ====================================================
# STAGE 6: MONITORING
# ====================================================
# Gateway: $175
add('monitoring', 'gateway', 'SE Monitoring Gateway', 1, 'ea')

# ====================================================
# STAGE 7: LABELS
# ====================================================
add('labels', 'label', f'DC Conductor Labels ×{STRING_COUNT*2}', STRING_COUNT*2, 'ea')
add('labels', 'label', 'PV System Warning Label', 1, 'ea')
add('labels', 'label', 'Rapid Shutdown Label', 1, 'ea')
add('labels', 'label', 'Backfeed Warning Label', 1, 'ea')

# ====================================================
# SUMMARY
# ====================================================
print("=== BOM LINE ITEMS (6-inverter scenario) ===")
total = 0
for item in items:
    t = item['totalCost']
    total += t
    print(f"  [{item['stage']:12s}] {item['desc']:<50s} qty={item['qty']:4d} unit=${item['unitCost']:8.2f} → ${t:10,.2f}")

print(f"\n  SUBTOTAL (6 inverters): ${total:,.2f}")

# Now check with rapid_shutdown counted differently
# rapid_shutdown at $95 × 141 = $13,395 — this is HUGE
print()
rs_cost = 95.00 * MODULE_COUNT
print(f"  *** Rapid Shutdown per module: $95 × {MODULE_COUNT} = ${rs_cost:,.0f}")
print(f"      This is a major cost driver. Should rapid shutdown be per-system, not per-module?")

# Check with 36 inverters
print()
print("=== BOM TOTAL WITH 36 INVERTERS ===")
total_36 = total - (INV_COUNT * SE11400H_PRICE) + (36 * SE11400H_PRICE)
print(f"  Total with 36 SE11400H @ $1,500 = ${total_36:,.0f}")

print()
print("=== EXPECTED COST BREAKDOWN ===")
print(f"  141 panels × $136          = ${141*136:,.0f}")
print(f"  141 optimizers × $54.40    = ${141*54.40:,.0f}")
print(f"  6 SE11400H × $1,500        = ${6*1500:,.0f}")
print(f"  141 rapid shutdown × $95   = ${141*95:,.0f}  ← suspect")
print(f"  DC disconnects × $185      = ${6*185:,.0f}")
print(f"  AC disconnect × $185       = ${185:,.0f}")
print(f"  Wire + conduit             = ~$500")
print(f"  Racking + monitoring       = ~$300")
print(f"  Labels                     = ~$50")
print()
print(f"  TOTAL WITH 6 INVERTERS: ~${141*136 + 141*54.40 + 6*1500 + 141*95 + 6*185 + 185 + 500 + 300 + 50:,.0f}")

# Without RS per-module issue:
print()
print("=== WITHOUT PER-MODULE RAPID SHUTDOWN ===")
no_rs_total = 141*136 + 141*54.40 + 6*1500 + 1*95 + 6*185 + 185 + 500 + 300 + 50
print(f"  141 panels × $136       = ${141*136:,.0f}")
print(f"  141 optimizers × $54.40 = ${141*54.40:,.0f}")
print(f"  6 inverters × $1,500    = ${6*1500:,.0f}")
print(f"  1 rapid shutdown × $95  = $95 (per-system)")
print(f"  6 DC disc × $185        = ${6*185:,.0f}")
print(f"  AC disc × $185          = $185")
print(f"  Other                   = ~$850")
print(f"  TOTAL: ~${no_rs_total:,.0f}")