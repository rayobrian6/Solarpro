#!/usr/bin/env python3
"""
Trace exactly why 14.40 kW DC auto-selected 2×SE7600H (15.20 kW AC, DC/AC=0.95).
"""
import math

# SolarEdge brand profile
MODELS = [
    {'id': 'se-3800h',  'acKw': 3.8,  'dcKwMax': 5.7,  'mpptCount': 1, 'maxPPS': 25},
    {'id': 'se-6000h',  'acKw': 6.0,  'dcKwMax': 9.0,  'mpptCount': 1, 'maxPPS': 25},
    {'id': 'se-7600h',  'acKw': 7.6,  'dcKwMax': 11.4, 'mpptCount': 1, 'maxPPS': 25},
    {'id': 'se-10000h', 'acKw': 10.0, 'dcKwMax': 15.0, 'mpptCount': 1, 'maxPPS': 25},
    {'id': 'se-11400h', 'acKw': 11.4, 'dcKwMax': 17.1, 'mpptCount': 1, 'maxPPS': 25},
]
SIZING_TIERS = [
    {'minDcKw': 0,   'maxDcKw': 4.5,      'id': 'se-3800h'},
    {'minDcKw': 4.5, 'maxDcKw': 7,        'id': 'se-6000h'},
    {'minDcKw': 7,   'maxDcKw': 9,        'id': 'se-7600h'},
    {'minDcKw': 9,   'maxDcKw': 12,       'id': 'se-10000h'},
    {'minDcKw': 12,  'maxDcKw': float('inf'), 'id': 'se-11400h'},
]
DCAC_RANGE = {'min': 1.0, 'max': 1.55}
MIN_DC_AC_RATIO = 0.9    # current value — THE BUG
DEFAULT_PARALLEL = 2

def get_model(mid):
    return next(m for m in MODELS if m['id'] == mid)

def panels_per_unit(model):
    return model['mpptCount'] * DEFAULT_PARALLEL * model['maxPPS']

def units_required(model, panels, total_dc_kw):
    by_dc = math.ceil(total_dc_kw / model['dcKwMax'])
    by_panels = math.ceil(panels / panels_per_unit(model))
    return max(by_dc, by_panels)

def dc_ac_ratio(model, qty, total_dc_kw):
    return total_dc_kw / max(model['acKw'] * qty, 0.001)

def pick_tier(total_dc_kw):
    for tier in SIZING_TIERS:
        if tier['minDcKw'] <= total_dc_kw < tier['maxDcKw']:
            return tier['id']
    return SIZING_TIERS[-1]['id']

def attempt_downsize(model, qty, panels, total_dc_kw):
    """Downsize if ratio < MIN_DC_AC_RATIO."""
    ratio = dc_ac_ratio(model, qty, total_dc_kw)
    if ratio >= MIN_DC_AC_RATIO:
        return model, qty  # no downsize needed
    # Walk from largest to smallest
    candidates = sorted(
        [m for m in MODELS if m['acKw'] < model['acKw']],
        key=lambda m: -m['acKw']
    )
    for c in candidates:
        cqty = units_required(c, panels, total_dc_kw)
        cratio = dc_ac_ratio(c, cqty, total_dc_kw)
        if cratio >= MIN_DC_AC_RATIO:
            return c, cqty
    return model, qty  # no better option

# System: 36 panels, 14.40 kW DC, selectedInverterId = 'se-7600h' (user's stored selection)
panels = 36
total_dc_kw = 14.40
selected_id = 'se-7600h'

print("=" * 65)
print(f"SYSTEM: {panels} panels, {total_dc_kw} kW DC, selected={selected_id}")
print("=" * 65)

print("\n=== STEP 1: Auto-tier for 14.40 kW DC ===")
tier_id = pick_tier(total_dc_kw)
print(f"  pickInverterTier(14.40): '{tier_id}'")
print(f"  (tier minDcKw=12, maxDcKw=Inf -> se-11400h)")

print("\n=== STEP 2: selectedInverterId path ===")
print(f"  User has se-7600h selected (stored from prev session)")
ref = get_model(selected_id)
ppu = panels_per_unit(ref)
qty_selected = units_required(ref, panels, total_dc_kw)
ratio_selected = dc_ac_ratio(ref, qty_selected, total_dc_kw)
print(f"  panelsPerUnit(se-7600h) = 1×2×25 = {ppu}")
print(f"  unitsRequired = max(ceil({total_dc_kw}/{ref['dcKwMax']}), ceil({panels}/{ppu}))")
print(f"                = max({math.ceil(total_dc_kw/ref['dcKwMax'])}, {math.ceil(panels/ppu)}) = {qty_selected}")
print(f"  DC/AC ratio = {total_dc_kw} / ({ref['acKw']} × {qty_selected}) = {ratio_selected:.4f}")

print(f"\n=== STEP 3: qtySelected == 1? ===")
if qty_selected == 1:
    print("  YES → honor user selection, 1 unit")
else:
    print(f"  NO (qty={qty_selected}) → look for upsize candidate or scale to {qty_selected} units")
    
    # Check tier-recommended model
    tier_model = get_model(tier_id)  # se-11400h
    tier_qty = units_required(tier_model, panels, total_dc_kw)
    tier_ratio = dc_ac_ratio(tier_model, tier_qty, total_dc_kw)
    print(f"\n  Tier model: {tier_id}")
    print(f"  userIsUndersizedVsTier: {tier_model['dcKwMax'] > ref['dcKwMax']} (tier={tier_model['dcKwMax']} > sel={ref['dcKwMax']})")
    
    # Rule 1: fewer units?
    candidates = [m for m in MODELS
                  if m['id'] != ref['id'] and m['acKw'] > ref['acKw']]
    candidates_with_qty = [(m, units_required(m, panels, total_dc_kw)) for m in candidates]
    fewer_units = [(m, q) for m, q in candidates_with_qty if q < qty_selected]
    print(f"\n  Rule 1 candidates (fewer units than {qty_selected}):")
    for m, q in fewer_units:
        r = dc_ac_ratio(m, q, total_dc_kw)
        print(f"    {m['id']} × {q}: DC/AC = {r:.3f}, acKw={m['acKw']}×{q}={m['acKw']*q:.1f}")
    
    if fewer_units:
        best = min(fewer_units, key=lambda x: (x[1], -x[0]['acKw']))
        print(f"  → Rule 1 fires: upsize to {best[0]['id']} × {best[1]}")
        chosen_model, chosen_qty = best
    else:
        print(f"  Rule 1: no fewer-unit candidate")
        
        # Rule 2: tier undersized check
        sel_ratio = dc_ac_ratio(ref, qty_selected, total_dc_kw)
        print(f"\n  Rule 2: selectedRatio={sel_ratio:.3f}, MIN_DC_AC_RATIO={MIN_DC_AC_RATIO}")
        print(f"  userIsUndersizedVsTier={tier_model['dcKwMax'] > ref['dcKwMax']}")
        print(f"  sel_ratio < MIN_DC_AC_RATIO: {sel_ratio < MIN_DC_AC_RATIO}")
        
        if sel_ratio < MIN_DC_AC_RATIO:
            print(f"  → Rule 2 fires: upsize to tier {tier_id} × {tier_qty}")
            chosen_model, chosen_qty = tier_model, tier_qty
        else:
            # Rule 3: scale to qty_selected units of selected model
            print(f"  Rule 2: ratio {sel_ratio:.3f} >= {MIN_DC_AC_RATIO}, skip")
            print(f"  → Rule 3: fall back to {qty_selected}×{selected_id}")
            chosen_model, chosen_qty = ref, qty_selected

print(f"\n=== STEP 4: attemptDownsize ===")
final_model, final_qty = attempt_downsize(chosen_model, chosen_qty, panels, total_dc_kw)
final_ratio = dc_ac_ratio(final_model, final_qty, total_dc_kw)
if final_model['id'] != chosen_model['id']:
    print(f"  Downsize: {chosen_model['id']}×{chosen_qty} → {final_model['id']}×{final_qty}")
else:
    ratio_pre = dc_ac_ratio(chosen_model, chosen_qty, total_dc_kw)
    print(f"  No downsize (ratio={ratio_pre:.3f} >= {MIN_DC_AC_RATIO})")
    
print(f"\n=== FINAL SELECTION ===")
print(f"  Model:     {final_model['id']}")
print(f"  Qty:       {final_qty}")
print(f"  AC total:  {final_model['acKw'] * final_qty:.2f} kW")
print(f"  DC total:  {total_dc_kw:.2f} kW")
print(f"  DC/AC:     {final_ratio:.3f}")
print(f"  AC > DC:   {final_model['acKw'] * final_qty > total_dc_kw}")

print(f"\n=== VALIDATION ===")
print(f"  SE dcAcRatioRange: {DCAC_RANGE}")
in_range = DCAC_RANGE['min'] <= final_ratio <= DCAC_RANGE['max']
print(f"  ratio {final_ratio:.3f} in range [{DCAC_RANGE['min']}, {DCAC_RANGE['max']}]: {in_range}")

print(f"\n=== THE BUG ===")
print(f"  MIN_DC_AC_RATIO = {MIN_DC_AC_RATIO} (should be 1.00)")
print(f"  Rule 2 condition: selectedRatio < MIN_DC_AC_RATIO")
print(f"  selectedRatio({qty_selected}×{selected_id}) = {dc_ac_ratio(ref, qty_selected, total_dc_kw):.3f}")
print(f"  {dc_ac_ratio(ref, qty_selected, total_dc_kw):.3f} < {MIN_DC_AC_RATIO} = {dc_ac_ratio(ref, qty_selected, total_dc_kw) < MIN_DC_AC_RATIO}")
print(f"  → Rule 2 DOES NOT fire because 0.95 >= 0.9, so Rule 3 scales to {qty_selected}×{selected_id}")
print(f"  → Result: {qty_selected} × {ref['acKw']} kW = {qty_selected*ref['acKw']} kW AC for {total_dc_kw} kW DC")
print(f"  → DC/AC = {dc_ac_ratio(ref, qty_selected, total_dc_kw):.3f} — AC EXCEEDS DC!")

print(f"\n=== WITH MIN_DC_AC_RATIO = 1.00 ===")
MIN_FIX = 1.00
ratio_2x7600 = dc_ac_ratio(ref, qty_selected, total_dc_kw)
print(f"  Rule 2: selectedRatio={ratio_2x7600:.3f} < {MIN_FIX} → {ratio_2x7600 < MIN_FIX}")
print(f"  → Rule 2 fires → upsize to tier se-11400h")
tier_qty_fix = units_required(tier_model, panels, total_dc_kw)
ratio_fix = dc_ac_ratio(tier_model, tier_qty_fix, total_dc_kw)
print(f"  → {tier_qty_fix} × se-11400h ({tier_model['acKw']}kW AC each)")
print(f"  → DC/AC = {ratio_fix:.3f}")
print(f"  AC total = {tier_model['acKw'] * tier_qty_fix:.2f} kW")
print(f"  DC/AC in SE range [{DCAC_RANGE['min']}, {DCAC_RANGE['max']}]: {DCAC_RANGE['min'] <= ratio_fix <= DCAC_RANGE['max']}")

print(f"\n=== STRING CONTRADICTION ===")
print(f"  Displayed: 2 strings × 18 panels (from config.inverters = 2×se-7600h)")
print(f"  Recommended: 4×5 panels (???) — this is the auto-string layout for 2×se-7600h")
print(f"    For 2×se-7600h: chosenParallel=?")
for p in range(1, DEFAULT_PARALLEL + 1):
    slots = 2 * 1 * p  # qty×mpptCount×p
    avg = panels / slots
    fits = avg <= 25 and avg >= 8
    print(f"    p={p}: slots={slots}, avg={avg:.1f}/slot, fits={fits}")
print(f"    → chosenParallel=1, slots=2, avg=18.0/slot → 2×18 layout")
print(f"    So why does UI show '4×5'?")
print(f"    This suggests the string RECOMMENDATION is from sizingEngine")
print(f"    while the DISPLAY is from config.inverters (stale/unapplied)")

print(f"\n=== BOM IMPACT ===")
# 2×SE7600H BOM
bom_2x7600 = 2 * 1512  # catalog price
bom_36_opt = 36 * 54.40  # P505 optimizers
bom_panels = 36 * 136    # panels
bom_other = 1500         # wire/conduit/disconnects/labels
print(f"  2×SE7600H: {2}×$1,512 = ${bom_2x7600:,}")
print(f"  36 optimizers: {36}×$54.40 = ${bom_36_opt:,.0f}")
print(f"  36 panels: {36}×$136 = ${bom_panels:,}")
print(f"  Other BOS: ~${bom_other:,}")
print(f"  TOTAL 2×SE7600H: ~${bom_2x7600+bom_36_opt+bom_panels+bom_other:,.0f}")
print()
bom_1x11400 = 1 * 1880  # catalog price NEW
print(f"  1×SE11400H: 1×$1,880 = ${bom_1x11400:,}")
print(f"  36 optimizers: ${bom_36_opt:,.0f} (same)")
print(f"  36 panels: ${bom_panels:,} (same)")
print(f"  Other BOS: ~${bom_other:,}")
print(f"  TOTAL 1×SE11400H: ~${bom_1x11400+bom_36_opt+bom_panels+bom_other:,.0f}")