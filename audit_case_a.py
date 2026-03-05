import subprocess, json

payload = json.dumps({
    "windSpeed": 115, "windExposure": "B", "groundSnowLoad": 20,
    "roofType": "shingle", "roofPitch": 20, "rafterSpacing": 24,
    "rafterSpan": 16, "rafterSize": "2x6", "rafterSpecies": "Douglas Fir-Larch",
    "panelLength": 70.9, "panelWidth": 41.7, "panelWeight": 44,
    "panelCount": 34, "rowCount": 2, "rackingWeight": 8,
    "attachmentSpacing": 48, "railSpan": 48, "rowSpacing": 12,
    "arrayTilt": 20, "systemType": "roof"
})

result = subprocess.run([
    "curl", "-s", "-X", "POST", "http://localhost:3008/api/engineering/structural",
    "-H", "Content-Type: application/json",
    "-H", "Cookie: solarpro_session=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6InRlc3QtdXNlci0xIiwiZW1haWwiOiJ0ZXN0QHNvbGFycHJvLmRldiIsIm5hbWUiOiJUZXN0IEVuZ2luZWVyIiwicm9sZSI6ImFkbWluIiwiZXhwIjoxNzcyNjc1ODU1fQ.Chyhi76MjRG8u1u100XifxeA_-8r6jyvwRoPHbGPcAM",
    "-d", payload
], capture_output=True, text=True)

d = json.loads(result.stdout)
w = d['wind']; dl = d['deadLoad']; sn = d['snow']; r = d['rafter']; a = d['attachment']

print("=" * 65)
print("CASE A CURRENT ENGINE OUTPUT")
print("115mph, Exp B, 34 panels, 2x6@24&quot;OC, 16ft span, 20psf snow")
print("=" * 65)
print()
print("--- WIND ---")
print(f"  qz (0.00256*V^2)      = {w['velocityPressure']:.3f} psf")
print(f"  netUpliftPressure     = {w['netUpliftPressure']:.3f} psf")
print(f"  panelArea             = {w['panelArea']:.3f} ft2  ({70.9}x{41.7}/144)")
print(f"  arrayArea             = {w['arrayArea']:.2f} ft2  (panelArea x 34)")
print(f"  totalUpliftForce      = {w['totalUpliftForce']:.1f} lbs")
print(f"  totalAttachments      = {w['totalAttachments']}")
print(f"  upliftPerAttachment   = {w['upliftPerAttachment']:.1f} lbs  ← KEY")
print()
print("--- DEAD LOAD ---")
print(f"  panelWeightPsf        = {dl['panelWeightPsf']:.3f} psf  (44lbs / {70.9*41.7/144:.3f}ft2)")
print(f"  rackingWeightPsf      = {dl['rackingWeightPsf']:.3f} psf  (8lbs / panelArea)")
print(f"  totalPvDeadLoad       = {dl['totalDeadLoadPsf']:.3f} psf  ← should be 2-6 psf")
print(f"  existingRoofDeadLoad  = {dl['existingRoofDeadLoad']} psf  (shingle)")
print(f"  totalRoofDeadLoad     = {dl['totalRoofDeadLoad']:.3f} psf")
print(f"  deadLoadPerAttachment = {dl['deadLoadPerAttachment']:.1f} lbs")
print()
print("--- SNOW ---")
print(f"  groundSnowLoad (Pg)   = {sn['groundSnowLoad']} psf")
print(f"  roofSnowLoad (Cs*Pg)  = {sn['roofSnowLoad']:.2f} psf")
print(f"  snowLoadPerAttachment = {sn['snowLoadPerAttachment']:.1f} lbs")
print()
print("--- TRIBUTARY AREA ---")
print(f"  attachmentSpacing     = 48&quot; = 4.0 ft")
print(f"  railSpan (input)      = 48&quot; = 4.0 ft  ← NOTE: railSpan = attachmentSpacing (WRONG)")
print(f"  tributaryArea         = {a['tributaryArea']:.2f} ft2  (4.0 x 4.0)")
print(f"  EXPECTED range        = 16-24 ft2 (4ft x 4-6ft)")
print()
print("--- RAFTER ---")
print(f"  rafterSize            = {r['rafterSize']}")
print(f"  rafterSpacing         = {r['rafterSpacing']}&quot; OC  → tributaryWidth = {r['tributaryWidth']:.3f} ft")
print(f"  rafterSpan            = {r['rafterSpan']} ft")
print(f"  totalLoadPsf          = {r['totalLoadPsf']:.3f} psf  (roofDL + snow = {dl['totalRoofDeadLoad']:.1f} + {sn['roofSnowLoad']:.1f})")
print(f"  lineLoad (w)          = {r['totalLoadPsf']*r['tributaryWidth']:.3f} plf  (psf x tributaryWidth)")
print(f"  bendingMoment (M=wL2/8) = {r['bendingMoment']:.1f} ft-lbs")
print(f"  allowableMoment       = {r['allowableBendingMoment']:.1f} ft-lbs")
print(f"  utilizationRatio      = {r['utilizationRatio']*100:.1f}%  ← CRITICAL")
print(f"  deflection            = {r['deflection']:.4f}&quot;  (limit: {r['allowableDeflection']:.4f}&quot;)")
print(f"  pointLoadPerAttach    = {r['pointLoadPerAttachment']:.1f} lbs  (uplift x spacingFt)")
print()
print("--- ATTACHMENT ---")
print(f"  lagBoltCapacity       = {a['lagBoltCapacity']:.0f} lbs")
print(f"  upliftPerAttachment   = {a['totalUpliftPerAttachment']:.1f} lbs")
print(f"  safetyFactor          = {a['safetyFactor']:.2f}")
print(f"  maxAllowedSpacing     = {a['maxAllowedSpacing']}&quot;")
print()
print(f"STATUS: {d['status']}")
for e in d.get('errors', []): print(f"  ❌ ERROR: {e['message']}")
for w2 in d.get('warnings', []): print(f"  ⚠️  WARN: {w2['message']}")
print()
print("=" * 65)
print("AUDIT FINDINGS:")
print("=" * 65)

# Check 1: PV dead load range
pv_dl = dl['totalDeadLoadPsf']
if pv_dl < 2 or pv_dl > 6:
    print(f"  ⚠️  PV dead load {pv_dl:.2f} psf outside normal 2-6 psf range")
else:
    print(f"  ✅ PV dead load {pv_dl:.2f} psf within 2-6 psf range")

# Check 2: Tributary area
trib = a['tributaryArea']
if trib > 50:
    print(f"  ❌ Tributary area {trib:.1f} ft2 > 50 ft2 — CALCULATION ERROR")
elif trib < 8:
    print(f"  ⚠️  Tributary area {trib:.1f} ft2 seems low (expected 16-24 ft2)")
else:
    print(f"  ✅ Tributary area {trib:.1f} ft2 within expected range")

# Check 3: Uplift per attachment
uplift = a['totalUpliftPerAttachment']
if uplift > 1000:
    print(f"  ❌ Uplift {uplift:.0f} lbs > 1000 — check tributary area or wind zone")
elif uplift < 100:
    print(f"  ⚠️  Uplift {uplift:.0f} lbs seems very low")
else:
    print(f"  ✅ Uplift {uplift:.0f} lbs within 300-700 lbs typical range")

# Check 4: Rafter utilization
util = r['utilizationRatio'] * 100
if util > 100:
    print(f"  ❌ Rafter utilization {util:.0f}% > 100% — OVERSTRESSED")
elif util > 85:
    print(f"  ⚠️  Rafter utilization {util:.0f}% high (>85%)")
else:
    print(f"  ✅ Rafter utilization {util:.0f}% acceptable")

# Check 5: railSpan issue
print()
print("  ⚠️  CRITICAL FINDING: railSpan is set equal to attachmentSpacing in page.tsx")
print(f"     railSpan: config.attachmentSpacing  (line 511)")
print(f"     This means tributary area = attachSpacing x attachSpacing = 4x4 = 16 ft2")
print(f"     Correct: railSpan should be the DISTANCE BETWEEN RAILS (row spacing)")
print(f"     Typical rail spacing = 4-6 ft (48-72 inches)")
print(f"     Current value: {48}&quot; x {48}&quot; / 144 = {48*48/144:.1f} ft2 (happens to be correct by accident)")