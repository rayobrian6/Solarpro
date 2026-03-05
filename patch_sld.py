# Patch sld-v3-renderer.ts for Phase 6:
# 1. Orthogonal routing: replace arrowLine inter-stage connections with elbowH
# 2. Update stage labels to: PV Array → Inverter → Disconnect → Meter → Service → Utility
# 3. Ensure conductor size, breaker size, inverter model are displayed prominently

with open('lib/sld-v3-renderer.ts', 'r') as f:
    content = f.read()

# ── Fix 1: Update stage labels to match spec order ──────────────────────────
old_labels = """  const stageLabels = [
    ['ARRAY', 'PV Modules + Optimizers'],
    ['DC RUN', 'DC Wiring + OCPD + Disconnect'],
    ['INVERTER', 'Inverter / Microinverter'],
    ['AC RUN', 'AC Wiring + Disconnect'],
    ['INTERCONNECT', 'Main Service Panel'],
    ['UTILITY', 'Meter + Grid + GES'],
  ];"""

new_labels = """  // PHASE 6: Stage labels — PV Array → Inverter → Disconnect → Meter → Service → Utility
  const stageLabels = [
    ['PV ARRAY', 'Modules + Optimizers (DC Source)'],
    ['INVERTER', 'String / Micro / Optimizer'],
    ['DISCONNECT', 'AC Disconnect + OCPD'],
    ['METER', 'Production Meter + AC Run'],
    ['SERVICE', 'Main Service Panel (120% Rule)'],
    ['UTILITY', 'Utility Meter + Grid + GES'],
  ];"""

if old_labels in content:
    content = content.replace(old_labels, new_labels)
    print("✓ Stage labels updated")
else:
    print("✗ Stage labels NOT found — checking...")
    idx = content.find("const stageLabels")
    print(f"  stageLabels found at char {idx}")

# ── Fix 2: Replace diagonal arrowLine inter-stage connections with elbowH ───
old_connections = """  // Stage 0 → Stage 1 (DC or AC branch)
  const connColor = isMicro ? C.ac : C.dc;
  parts.push(arrowLine(s0.x + s0.w, s0.cy, s1.x, s1.cy - 120, connColor, 2));

  // Stage 1 → Stage 2
  if (!isMicro) {
    parts.push(arrowLine(s1.x + s1.w, s1.cy + 60, s2.x, s2.cy - 80, C.dc, 2));
  } else {
    parts.push(arrowLine(s1.x + s1.w, s1.cy + 40, s2.x, s2.cy - 40, C.ac, 2));
  }

  // Stage 2 → Stage 3 (AC)
  parts.push(arrowLine(s2.x + s2.w, s2.cy + 120, s3.x, s3.cy - 120, C.ac, 2));

  // Stage 3 → Stage 4 (AC)
  parts.push(arrowLine(s3.x + s3.w, s3.cy + 60, s4.x, s4.cy - 70, C.ac, 2));

  // Stage 4 → Stage 5 (AC + GND)
  parts.push(arrowLine(s4.x + s4.w, s4.cy - 20, s5.x, s5.cy - 80, C.ac, 2));
  parts.push(line(s4.x + s4.w, s4.cy + 80, s5.x, s5.cy + 80, { stroke: C.gnd, sw: 1.5, dash: '4,3' }));"""

new_connections = """  // PHASE 6: Orthogonal routing — use elbowH (horizontal→vertical→horizontal)
  // No diagonal edges. All inter-stage connections are right-angle only.

  // Stage 0 → Stage 1 (DC or AC branch) — orthogonal elbow
  const connColor = isMicro ? C.ac : C.dc;
  parts.push(elbowH(s0.x + s0.w, s0.cy, s1.x, s1.cy, connColor, 2));

  // Stage 1 → Stage 2 — orthogonal elbow
  if (!isMicro) {
    parts.push(elbowH(s1.x + s1.w, s1.cy, s2.x, s2.cy, C.dc, 2));
  } else {
    parts.push(elbowH(s1.x + s1.w, s1.cy, s2.x, s2.cy, C.ac, 2));
  }

  // Stage 2 → Stage 3 (AC) — orthogonal elbow
  parts.push(elbowH(s2.x + s2.w, s2.cy, s3.x, s3.cy, C.ac, 2));

  // Stage 3 → Stage 4 (AC) — orthogonal elbow
  parts.push(elbowH(s3.x + s3.w, s3.cy, s4.x, s4.cy, C.ac, 2));

  // Stage 4 → Stage 5 (AC + GND) — orthogonal elbow
  parts.push(elbowH(s4.x + s4.w, s4.cy, s5.x, s5.cy, C.ac, 2));
  // Grounding run — straight horizontal (same Y level)
  parts.push(line(s4.x + s4.w, s4.cy + 80, s5.x, s5.cy + 80, { stroke: C.gnd, sw: 1.5, dash: '4,3' }));"""

if old_connections in content:
    content = content.replace(old_connections, new_connections)
    print("✓ Inter-stage connections updated to orthogonal elbowH")
else:
    print("✗ Inter-stage connections NOT found")
    idx = content.find("Stage 0 → Stage 1")
    print(f"  'Stage 0 → Stage 1' found at char {idx}")

# ── Fix 3: Add prominent conductor/breaker/model callouts in stage headers ───
# The stage 1 (now INVERTER) already shows invModel and invMfr.
# Add a conductor+breaker summary box at the top of stage 3 (DISCONNECT).
# This is additive — we insert after the existing AC conductor label.

old_ac_label = """  // AC conductor label
  parts.push(conductorLabel(s3.cx, s3.cy - 120, `${acWireGauge} THWN-2`, C.ac));
  parts.push(text(s3.cx, s3.cy - 100,
    `${conduitType} conduit, ${acWireLength}ft run`, { size: F.ref, fill: C.ac }));
  parts.push(text(s3.cx, s3.cy - 88,
    `240V / ${acOutputAmps}A`, { size: F.ref, fill: C.ac }));"""

new_ac_label = """  // PHASE 6: AC conductor label — prominent conductor size + breaker size display
  parts.push(conductorLabel(s3.cx, s3.cy - 120, `${acWireGauge} THWN-2`, C.ac));
  parts.push(text(s3.cx, s3.cy - 100,
    `${conduitType} conduit, ${acWireLength}ft run`, { size: F.ref, fill: C.ac }));
  parts.push(text(s3.cx, s3.cy - 88,
    `240V / ${acOutputAmps}A`, { size: F.ref, fill: C.ac }));
  // Conductor + breaker callout box (Phase 6 — prominent display)
  parts.push(rect(s3.x + 6, s3.y + 44, s3.w - 12, 36,
    { fill: '#F0F8FF', stroke: C.ac, sw: 1, rx: 3 }));
  parts.push(text(s3.cx, s3.y + 57, `Conductor: ${acWireGauge} THWN-2`,
    { size: F.label, fill: C.ac, weight: 'bold' }));
  parts.push(text(s3.cx, s3.y + 71, `Breaker: ${acOCPD}A / Inverter: ${invMfr} ${invModel}`,
    { size: F.ref, fill: C.textSub }));"""

if old_ac_label in content:
    content = content.replace(old_ac_label, new_ac_label)
    print("✓ Conductor/breaker/model callout box added")
else:
    print("✗ AC conductor label NOT found")

# ── Fix 4: Update version tag in legend ──────────────────────────────────────
content = content.replace(
    "Generated: SolarPro V4",
    "Generated: SolarPro V3.2"
)
print("✓ Version tag updated to V3.2")

with open('lib/sld-v3-renderer.ts', 'w') as f:
    f.write(content)

print("\nSUCCESS: sld-v3-renderer.ts patched for Phase 6")