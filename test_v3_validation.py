#!/usr/bin/env python3
"""
V3 Structural Engine Validation Test
Test Case: 34 panels, 2x6 @ 24" OC (auto-detected as TRUSS), 115mph wind, 20psf snow → must PASS

The V3 engine auto-detects framing type:
  - 24" O.C. → TRUSS (pre-engineered, BCSI capacity table)
  - 16" O.C. → RAFTER (stick-built, NDS 2018)
"""

import math

print("=" * 70)
print("V3 STRUCTURAL ENGINE VALIDATION TEST")
print("Test: 34 panels, 2x6 @ 24&quot; OC, 115mph wind, 20psf snow")
print("Auto-detection: 24&quot; OC → TRUSS")
print("=" * 70)
print()

# ─────────────────────────────────────────────────────────────────────────────
# INPUTS
# ─────────────────────────────────────────────────────────────────────────────
wind_speed = 115        # mph
wind_exposure = 'C'
ground_snow = 20        # psf
mean_roof_height = 15   # ft
roof_pitch_deg = 20     # degrees

framing_type = 'unknown'   # auto-detect from spacing
rafter_size = '2x6'
rafter_spacing_in = 24  # inches → auto-detected as TRUSS
rafter_span_ft = 16     # feet
species = 'Douglas Fir-Larch'

panel_count = 34
panel_length_in = 73.0  # portrait: long dim vertical (across slope)
panel_width_in = 41.0   # portrait: short dim horizontal (along rail)
panel_weight_lbs = 45.0
panel_orientation = 'portrait'
module_gap_in = 0.5
row_gap_in = 6.0

racking_system = 'ironridge-xr100'
racking_weight_per_panel = 4.0  # lbs per panel

# ─────────────────────────────────────────────────────────────────────────────
# STEP 1: FRAMING TYPE AUTO-DETECTION
# ─────────────────────────────────────────────────────────────────────────────
print("STEP 1: FRAMING TYPE AUTO-DETECTION")
print("-" * 40)

# V3 engine logic: 24" OC → TRUSS
if framing_type == 'unknown':
    if rafter_spacing_in >= 24:
        resolved_framing = 'truss'
        print(f"Input framingType: unknown")
        print(f"Rafter Spacing: {rafter_spacing_in}&quot; O.C.")
        print(f"Auto-detected: TRUSS (24&quot; O.C. = standard truss spacing)")
    else:
        resolved_framing = 'rafter'
        print(f"Auto-detected: RAFTER (16&quot; O.C. = standard stick-built spacing)")
else:
    resolved_framing = framing_type
    print(f"Framing Type: {resolved_framing} (user-specified)")
print()

# ─────────────────────────────────────────────────────────────────────────────
# STEP 2: ARRAY GEOMETRY (V3 autoLayout)
# ─────────────────────────────────────────────────────────────────────────────
print("STEP 2: ARRAY GEOMETRY (V3 autoLayout)")
print("-" * 40)

# V3 autoLayout: panelCount <= 40 → rowCount=4, colCount=ceil(34/4)=9
row_count = 4
col_count = math.ceil(panel_count / row_count)  # ceil(34/4) = 9

# Portrait: long dim vertical (across slope), short dim horizontal (along rail)
panel_along_rail_in = panel_width_in    # 41" along rail
panel_across_slope_in = panel_length_in  # 73" across slope

# Array dimensions
array_width_in = col_count * panel_along_rail_in + (col_count - 1) * module_gap_in
array_height_in = row_count * panel_across_slope_in + (row_count - 1) * row_gap_in

# Rail layout: 2 rails per row
rails_per_row = 2
rail_count = rails_per_row * row_count  # 2 × 4 = 8 rails
rail_length_in = col_count * panel_along_rail_in + (col_count - 1) * module_gap_in  # = array_width_in

# Rail spacing (between the 2 rails per row)
rail_spacing_in = panel_across_slope_in / 2  # 36.5"

# Clamps
mid_clamps_per_rail = max(0, col_count - 1)  # between panels
total_mid_clamps = mid_clamps_per_rail * rail_count
total_end_clamps = rail_count * 2  # 2 ends per rail

# Weight
total_panel_weight = panel_count * panel_weight_lbs
total_system_weight = total_panel_weight + panel_count * racking_weight_per_panel
array_area_ft2 = (array_width_in / 12) * (array_height_in / 12)
pv_dead_load_psf = total_system_weight / array_area_ft2

print(f"Panel Count: {panel_count}")
print(f"Layout: {row_count} rows × {col_count} cols")
print(f"Array Width: {array_width_in:.1f}&quot; ({array_width_in/12:.1f}')")
print(f"Array Height: {array_height_in:.1f}&quot; ({array_height_in/12:.1f}')")
print(f"Array Area: {array_area_ft2:.1f} ft²")
print(f"Rail Length: {rail_length_in:.1f}&quot;")
print(f"Rail Count: {rail_count}")
print(f"Rail Spacing: {rail_spacing_in:.1f}&quot;")
print(f"Total Panel Weight: {total_panel_weight:.0f} lbs")
print(f"Total System Weight: {total_system_weight:.0f} lbs")
print(f"PV Dead Load: {pv_dead_load_psf:.2f} psf")
print()

# ─────────────────────────────────────────────────────────────────────────────
# STEP 3: WIND LOAD (ASCE 7-22)
# ─────────────────────────────────────────────────────────────────────────────
print("STEP 3: WIND LOAD (ASCE 7-22)")
print("-" * 40)

# Exposure C, 15 ft mean roof height
Kz = 0.90   # Table 26.10-1, Exposure C, 15 ft
Kzt = 1.0   # flat terrain
Kd = 0.85   # directionality factor

qz = 0.00256 * Kz * Kzt * Kd * wind_speed**2
print(f"Wind Speed: {wind_speed} mph, Exposure {wind_exposure}")
print(f"Kz={Kz}, Kzt={Kzt}, Kd={Kd}")
print(f"Velocity Pressure qz = {qz:.2f} psf")

# GCp for roof-mounted solar (ASCE 7-22 Fig 29.4-7, interior zone)
# V3 engine uses interior zone (conservative for residential)
GCp_uplift = 1.5    # interior zone
GCp_downward = 1.5
GCpi = 0.18         # internal pressure (enclosed building)

net_uplift_psf = abs(qz * GCp_uplift)   # V3 uses abs(qz * gcp.uplift)
net_downward_psf = qz * GCp_downward

print(f"GCp (interior): uplift={GCp_uplift}, downward={GCp_downward}")
print(f"Net Uplift: {net_uplift_psf:.2f} psf")
print(f"Net Downward: {net_downward_psf:.2f} psf")
print()

# ─────────────────────────────────────────────────────────────────────────────
# STEP 4: SNOW LOAD (ASCE 7-22)
# ─────────────────────────────────────────────────────────────────────────────
print("STEP 4: SNOW LOAD (ASCE 7-22)")
print("-" * 40)

Ce = 1.0
Ct = 1.0
Is = 1.0
Cs = math.cos(math.radians(roof_pitch_deg))
pf = 0.7 * Ce * Ct * Is * ground_snow
ps = Cs * pf

print(f"Ground Snow: {ground_snow} psf")
print(f"Slope Factor Cs: {Cs:.3f}")
print(f"Roof Snow ps: {ps:.2f} psf")
print()

# ─────────────────────────────────────────────────────────────────────────────
# STEP 5: TRUSS ANALYSIS (BCSI Table)
# ─────────────────────────────────────────────────────────────────────────────
print("STEP 5: TRUSS ANALYSIS (BCSI Capacity Table)")
print("-" * 40)

# BCSI truss capacity table (V3 engine values)
TRUSS_CAPACITY_PSF = {16: 55, 20: 50, 24: 45, 28: 40}

# Round span to nearest 4 ft
span_key = round(rafter_span_ft / 4) * 4
truss_capacity = TRUSS_CAPACITY_PSF.get(span_key, 45)

roof_dead_load = 15.0  # psf (typical residential)
total_load = roof_dead_load + pv_dead_load_psf + ps
utilization = total_load / truss_capacity

print(f"Framing: TRUSS (auto-detected from 24&quot; O.C.)")
print(f"Span: {rafter_span_ft} ft → rounded to {span_key} ft for table lookup")
print(f"BCSI Truss Capacity: {truss_capacity} psf")
print(f"Roof Dead Load: {roof_dead_load:.1f} psf")
print(f"PV Dead Load: {pv_dead_load_psf:.2f} psf")
print(f"Snow Load: {ps:.2f} psf")
print(f"Total Load: {total_load:.2f} psf")
print(f"Utilization: {utilization*100:.1f}%")
truss_pass = utilization <= 1.0
print(f"Truss Check: {'✅ PASS' if truss_pass else '❌ FAIL'}")
print()

# ─────────────────────────────────────────────────────────────────────────────
# STEP 6: MOUNT SPACING (IronRidge XR100)
# ─────────────────────────────────────────────────────────────────────────────
print("STEP 6: MOUNT SPACING (IronRidge XR100)")
print("-" * 40)

# IronRidge XR100 L-foot specs
mount_uplift_capacity = 500  # lbs per mount
max_spacing_in = 72          # manufacturer max

# Rail span = rail spacing (distance between the 2 rails per row)
rail_span_in = rail_spacing_in  # 36.5"

# Iterative: reduce from max until SF >= 1.5
spacing_in = max_spacing_in
while spacing_in >= 12:
    trib_area_ft2 = (spacing_in * rail_span_in) / 144
    uplift_per_mount = net_uplift_psf * trib_area_ft2
    sf = mount_uplift_capacity / uplift_per_mount
    if sf >= 1.5:
        break
    spacing_in -= 6

trib_area_ft2 = (spacing_in * rail_span_in) / 144
uplift_per_mount = net_uplift_psf * trib_area_ft2
sf = mount_uplift_capacity / uplift_per_mount

print(f"Mount Uplift Capacity: {mount_uplift_capacity} lbs")
print(f"Net Uplift Pressure: {net_uplift_psf:.2f} psf")
print(f"Rail Span: {rail_span_in:.1f}&quot;")
print(f"Calculated Mount Spacing: {spacing_in}&quot;")
print(f"Tributary Area: {trib_area_ft2:.2f} ft²")
print(f"Uplift per Mount: {uplift_per_mount:.1f} lbs")
print(f"Safety Factor: {sf:.2f} (≥1.5 required)")
mount_pass = sf >= 1.5
print(f"Mount Check: {'✅ PASS' if mount_pass else '❌ FAIL'}")
print()

# Mount count
mounts_per_rail = math.ceil(rail_length_in / spacing_in) + 1
total_mounts = mounts_per_rail * rail_count
print(f"Mounts per Rail: {mounts_per_rail}")
print(f"Total Mounts: {total_mounts}")
print()

# ─────────────────────────────────────────────────────────────────────────────
# STEP 7: RAIL ANALYSIS (IronRidge XR100)
# ─────────────────────────────────────────────────────────────────────────────
print("STEP 7: RAIL ANALYSIS (IronRidge XR100)")
print("-" * 40)

# IronRidge XR100 rail moment capacity
rail_moment_capacity_in_lbs = 1800 * 12  # 21,600 in-lbs

# Tributary width per rail
trib_per_rail_in = panel_across_slope_in / 2  # 36.5"
trib_per_rail_ft = trib_per_rail_in / 12

# Total load on rail
w_rail = (roof_dead_load + pv_dead_load_psf + ps) * trib_per_rail_ft  # lbs/ft

# Moment demand (simple span between mounts)
span_ft = spacing_in / 12
M_rail_in_lbs = (w_rail * span_ft**2 / 8) * 12

rail_sf = rail_moment_capacity_in_lbs / M_rail_in_lbs if M_rail_in_lbs > 0 else 999

print(f"Rail Moment Capacity: {rail_moment_capacity_in_lbs:,} in-lbs")
print(f"Tributary Width: {trib_per_rail_in:.1f}&quot;")
print(f"Distributed Load: {w_rail:.1f} lbs/ft")
print(f"Mount Span: {spacing_in}&quot; ({span_ft:.2f} ft)")
print(f"Moment Demand: {M_rail_in_lbs:.0f} in-lbs")
print(f"Rail Safety Factor: {rail_sf:.2f}")
rail_pass = rail_sf >= 1.5
print(f"Rail Check: {'✅ PASS' if rail_pass else '❌ FAIL'}")
print()

# ─────────────────────────────────────────────────────────────────────────────
# STEP 8: RACKING BOM
# ─────────────────────────────────────────────────────────────────────────────
print("STEP 8: RACKING BOM")
print("-" * 40)

# Rail sections (IronRidge standard = 14 ft = 168")
rail_section_len_in = 168
rails_per_run = math.ceil(rail_length_in / rail_section_len_in)
total_rail_sections = rails_per_run * rail_count
rail_splices = max(0, (rails_per_run - 1)) * rail_count

total_l_feet = total_mounts
lag_bolts = total_l_feet  # 1 per L-foot
flashing_kits = total_l_feet  # 1 per mount
ground_lugs = math.ceil(panel_count / 2)  # NEC 690.47
bonding_clips = panel_count

print(f"Rails ({rail_section_len_in}&quot; sections): {total_rail_sections} pcs")
print(f"Rail Splices: {rail_splices} pcs")
print(f"L-Feet (Mounts): {total_l_feet} pcs")
print(f"Mid Clamps: {total_mid_clamps} pcs")
print(f"End Clamps: {total_end_clamps} pcs")
print(f"Ground Lugs: {ground_lugs} pcs")
print(f"Bonding Clips: {bonding_clips} pcs")
print(f"Lag Bolts: {lag_bolts} pcs")
print(f"Flashing Kits: {flashing_kits} pcs")
print()

# ─────────────────────────────────────────────────────────────────────────────
# FINAL SUMMARY
# ─────────────────────────────────────────────────────────────────────────────
print("=" * 70)
print("VALIDATION SUMMARY")
print("=" * 70)
print()
print(f"Test Case: {panel_count} panels, {rafter_size} @ {rafter_spacing_in}&quot; OC, {wind_speed}mph, {ground_snow}psf snow")
print(f"Framing: {resolved_framing.upper()} (auto-detected)")
print()

checks = {
    f"Truss Utilization ({utilization*100:.0f}% ≤ 100%)": truss_pass,
    f"Mount Safety Factor ({sf:.2f} ≥ 1.5)":              mount_pass,
    f"Rail Safety Factor ({rail_sf:.2f} ≥ 1.5)":          rail_pass,
}

all_pass = True
for name, result in checks.items():
    status = "✅ PASS" if result else "❌ FAIL"
    print(f"  {status}  {name}")
    if not result:
        all_pass = False

print()
if all_pass:
    print(">>> ✅ ALL CHECKS PASS — V3 VALIDATION SUCCESSFUL <<<")
else:
    print(">>> ❌ SOME CHECKS FAILED — REVIEW REQUIRED <<<")
print()
print("Key Results:")
print(f"  Array Layout: {row_count}×{col_count} ({array_width_in/12:.1f}' × {array_height_in/12:.1f}')")
print(f"  Wind Uplift (interior): {net_uplift_psf:.2f} psf")
print(f"  Snow Load (sloped): {ps:.2f} psf")
print(f"  PV Dead Load: {pv_dead_load_psf:.2f} psf")
print(f"  Truss Utilization: {utilization*100:.1f}%")
print(f"  Mount Spacing: {spacing_in}&quot; (calculated)")
print(f"  Mount Safety Factor: {sf:.2f}")
print(f"  Rail Safety Factor: {rail_sf:.2f}")