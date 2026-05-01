#!/usr/bin/env python3
"""
Exact simulation of sizeInverters() for Sol-Ark 8K-2P selected + 36 panels @ 400W
"""

# Sol-Ark models
models = [
    {"id": "solark-8k-2p",       "acKw": 8.0,  "dcKwMax": 10.5, "mpptCount": 2, "maxPPS": 13, "maxPar": 2, "mPD": 0},
    {"id": "solark-12k-2p",      "acKw": 12.0, "dcKwMax": 19.5, "mpptCount": 2, "maxPPS": 13, "maxPar": 2, "mPD": 0},
    {"id": "solark-15k-2p",      "acKw": 15.0, "dcKwMax": 19.5, "mpptCount": 3, "maxPPS": 13, "maxPar": 2, "mPD": 0},
    {"id": "solark-30k-3p-208v", "acKw": 30.0, "dcKwMax": 45.0, "mpptCount": 4, "maxPPS": 20, "maxPar": 2, "mPD": 0},
]

sizing_tiers = [
    {"minDcKw": 0,    "maxDcKw": 9,        "id": "solark-8k-2p"},
    {"minDcKw": 9,    "maxDcKw": 14,       "id": "solark-12k-2p"},
    {"minDcKw": 14,   "maxDcKw": float('inf'), "id": "solark-15k-2p"},  # Note: 22 in real profile
    {"minDcKw": 22,   "maxDcKw": float('inf'), "id": "solark-30k-3p-208v"},
]

# Fix tiers
sizing_tiers = [
    {"minDcKw": 0,    "maxDcKw": 9,        "id": "solark-8k-2p"},
    {"minDcKw": 9,    "maxDcKw": 14,       "id": "solark-12k-2p"},
    {"minDcKw": 14,   "maxDcKw": 22,       "id": "solark-15k-2p"},
    {"minDcKw": 22,   "maxDcKw": float('inf'), "id": "solark-30k-3p-208v"},
]

MIN_DC_AC_RATIO = 1.00
PREFERRED_MIN = 1.20
PREFERRED_MAX = 1.40
PREFERRED_TARGET = 1.25

panel_count = 36
panel_watt = 400
total_dc_kw = panel_count * panel_watt / 1000
selected_id = "solark-8k-2p"

print(f"=== Sol-Ark trace: {panel_count} panels @ {panel_watt}W = {total_dc_kw:.1f} kW DC ===")
print(f"selectedInverterId: {selected_id}")
print()

def get_model(mid):
    return next(m for m in models if m["id"] == mid)

def vaPPU(m):
    """panelsPerUnit = mpptCount * maxParallelStringsPerMppt * maxPanelsPerString"""
    return m["mpptCount"] * m["maxPar"] * m["maxPPS"]

def units_required(m, panel_count, total_dc_kw, ppu=None):
    if ppu is None:
        ppu = vaPPU(m)
    by_dc = max(1, -(-int(total_dc_kw / m["dcKwMax"]) if total_dc_kw % m["dcKwMax"] == 0 else int(total_dc_kw / m["dcKwMax"]) + 1))
    import math
    by_dc = max(1, math.ceil(total_dc_kw / m["dcKwMax"]))
    by_panels = max(1, math.ceil(panel_count / ppu))
    return max(by_dc, by_panels)

def dc_ac_ratio(m, qty, total_dc_kw):
    total_ac = m["acKw"] * qty
    return total_dc_kw / max(total_ac, 0.001)

def pick_inverter_tier(total_dc_kw):
    for t in sizing_tiers:
        if t["minDcKw"] <= total_dc_kw < t["maxDcKw"]:
            return t
    return None

ref = get_model(selected_id)
panels_per_unit_selected = vaPPU(ref)
qty_selected = units_required(ref, panel_count, total_dc_kw, panels_per_unit_selected)

print(f"ref = {ref['id']} (acKw={ref['acKw']}, dcKwMax={ref['dcKwMax']})")
print(f"vaPPU(ref) = {ref['mpptCount']} × {ref['maxPar']} × {ref['maxPPS']} = {panels_per_unit_selected}")
print(f"qtySelected = max(ceil({total_dc_kw}/{ref['dcKwMax']}), ceil({panel_count}/{panels_per_unit_selected})) = {qty_selected}")
print()

# tierRec
tier_rec = pick_inverter_tier(total_dc_kw)
print(f"pickInverterTier({total_dc_kw}) => tier: {tier_rec}")
tier_rec_model = get_model(tier_rec["id"]) if tier_rec else None
user_is_undersized_vs_tier = (
    tier_rec_model is not None and
    tier_rec_model["id"] != ref["id"] and
    tier_rec_model["dcKwMax"] > ref["dcKwMax"]
)
print(f"tierRecModel = {tier_rec_model['id'] if tier_rec_model else None}")
print(f"userIsUndersizedVsTier = {user_is_undersized_vs_tier}")
print()

# Candidates filter
print("=== Candidates filter ===")
candidates = []
for m in models:
    if m["id"] == selected_id:
        print(f"  {m['id']}: SKIP (same as ref)")
        continue
    if m["mPD"] > 0:
        print(f"  {m['id']}: SKIP (micro)")
        continue
    bigger_dc = m["dcKwMax"] > ref["dcKwMax"]
    m_ppu = vaPPU(m)
    bigger_strings = m_ppu > panels_per_unit_selected
    if not bigger_dc and not bigger_strings:
        print(f"  {m['id']}: SKIP (not bigger: dcKwMax={m['dcKwMax']} vs {ref['dcKwMax']}, ppu={m_ppu} vs {panels_per_unit_selected})")
        continue
    qty = units_required(m, panel_count, total_dc_kw, m_ppu)
    ratio = dc_ac_ratio(m, qty, total_dc_kw)
    print(f"  {m['id']}: OK - biggerDc={bigger_dc}, biggerStrings={bigger_strings}, ppu={m_ppu}, qty={qty}, ratio={ratio:.2f}")
    candidates.append({"model": m, "qty": qty, "ratio": ratio})

# Sort: fewer units first, then larger AC, then alphabetical
candidates.sort(key=lambda c: (c["qty"], -c["model"]["acKw"], c["model"]["id"]))
print()
print("Candidates (sorted):")
for c in candidates:
    print(f"  {c['model']['id']} qty={c['qty']} ratio={c['ratio']:.2f}")

print()
# Rule 1
fewer_units_candidate = next((c for c in candidates if c["qty"] < qty_selected), None)
print(f"=== Rule 1: fewerUnitsCandidate = {fewer_units_candidate}")
if fewer_units_candidate:
    print(f"  -> RULE 1 FIRES: upsize to {fewer_units_candidate['model']['id']} x{fewer_units_candidate['qty']}")
    print(f"  -> ratio would be {dc_ac_ratio(fewer_units_candidate['model'], fewer_units_candidate['qty'], total_dc_kw):.2f}")
else:
    print("  -> Rule 1 does NOT fire (no fewer-unit candidate)")
    
    # Rule 2
    selected_ratio = dc_ac_ratio(ref, qty_selected, total_dc_kw)
    print(f"\n=== Rule 2: selectedRatio={selected_ratio:.2f}, userIsUndersizedVsTier={user_is_undersized_vs_tier}")
    if user_is_undersized_vs_tier and tier_rec_model and selected_ratio < MIN_DC_AC_RATIO:
        qty_tier = units_required(tier_rec_model, panel_count, total_dc_kw, vaPPU(tier_rec_model))
        print(f"  -> RULE 2 FIRES: upsize to {tier_rec_model['id']} x{qty_tier}")
        print(f"  -> ratio would be {dc_ac_ratio(tier_rec_model, qty_tier, total_dc_kw):.2f}")
    else:
        print(f"  -> Rule 2 does NOT fire")
        print(f"\n=== Rule 3: fall back to {ref['id']} x{qty_selected}")
        print(f"  -> ratio would be {dc_ac_ratio(ref, qty_selected, total_dc_kw):.2f}")
        
print()
print("=== DC/AC ratios for all Sol-Ark models at 14.4 kW DC ===")
for m in models:
    for qty in [1, 2]:
        ratio = dc_ac_ratio(m, qty, total_dc_kw)
        ppu_val = vaPPU(m)
        req_qty = units_required(m, panel_count, total_dc_kw, ppu_val)
        marker = " <-- selected" if m["id"] == selected_id and qty == qty_selected else ""
        print(f"  {m['id']} x{qty}: ratio={ratio:.2f}, reqQty={req_qty}{marker}")