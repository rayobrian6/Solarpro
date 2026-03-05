import re

with open('lib/structural-calc.ts', 'r') as f:
    content = f.read()

# Find section 5 start and end markers
start_marker = '  // \u2500\u2500 5. Attachment / Lag Bolt Analysis \u2500'
end_marker = '  // \u2500\u2500 6. Total system weight \u2500'

start_idx = content.find(start_marker)
end_idx = content.find(end_marker)

if start_idx == -1:
    print("ERROR: start marker not found")
    exit(1)
if end_idx == -1:
    print("ERROR: end marker not found")
    exit(1)

print(f"Found section 5 at lines {content[:start_idx].count(chr(10))+1} to {content[:end_idx].count(chr(10))+1}")

old_section = content[start_idx:end_idx]
print(f"Old section length: {len(old_section)} chars")

new_section = '''  // \u2500\u2500 5. Attachment / Lag Bolt Analysis \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  // PHASE 4: Branch on loadModel from mount registry entry.
  // 'distributed' (default / IronRidge): single lag bolt, tributary area from rail geometry
  // 'discrete' (Roof Tech Mini): multiple fasteners per attachment, ICC-ES rated capacity per fastener

  const mountLoadModel = input.mountSpecs?.loadModel ?? 'distributed';

  let lagBoltCapacity: number;
  let totalUpliftPerAttachment: number;
  let totalDownwardPerAttachment: number;
  let safetyFactor: number;
  let rackingMaxSpacing: number;
  let computedMaxSpacing: number;

  if (mountLoadModel === 'discrete') {
    // \u2500\u2500 Discrete load model (Roof Tech Mini and similar) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    // Each attachment point has N fasteners, each rated at upliftCapacity lbf (ICC-ES).
    // effectiveCapacity = upliftCapacity \u00d7 fastenersPerAttachment
    // upliftPerAttachment uses registry tributaryArea (not rail geometry)
    // safetyFactor = effectiveCapacity / upliftPerAttachment
    // FAIL only if safetyFactor < requiredMinimum (2.0)
    // DO NOT modify IronRidge (distributed) logic below.

    const fastenersPerAttachment = input.mountSpecs?.fastenersPerAttachment ?? 2;
    const upliftCapacityPerFastener = input.mountSpecs?.upliftCapacity ?? 450; // lbf (ICC-ES default)
    const registryTributaryArea = input.mountSpecs?.tributaryArea ?? tributaryAreaPerAttachment;

    // Effective capacity of this attachment point
    const effectiveCapacity = upliftCapacityPerFastener * fastenersPerAttachment;

    // Uplift demand at this attachment point using registry tributary area
    const discreteUpliftPerAttachment = netUpliftPressure * registryTributaryArea;

    lagBoltCapacity = effectiveCapacity;
    totalUpliftPerAttachment = discreteUpliftPerAttachment;
    totalDownwardPerAttachment = netDownwardPressure * registryTributaryArea
      + deadLoadPerAttachment
      + snowLoadPerAttachment;

    safetyFactor = effectiveCapacity / discreteUpliftPerAttachment;

    // Max spacing for discrete model: derived from ICC-ES capacity
    rackingMaxSpacing = input.mountSpecs?.attachmentSpacingMax ?? 48;
    computedMaxSpacing = Math.floor((effectiveCapacity / netUpliftPressure) * 12);

  } else {
    // \u2500\u2500 Distributed load model (IronRidge, Unirac \u2014 default) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    // Lag bolt withdrawal capacity per NEC/IBC (5/16" \u00d7 3" lag in Douglas Fir)
    // NDS Table 12.2A: Z_w = 305 lbs/inch embedment \u00d7 2.5" embedment = ~762 lbs
    // With CD=1.6 (wind/seismic), CM=1.0, Ct=1.0, Ci=1.0
    const lagBoltWithdrawalPerInch = 305; // lbs/inch (5/16" lag, Douglas Fir)
    const embedmentDepth = 2.5; // inches (minimum per most AHJs)
    const CD = 1.6; // load duration factor for wind
    lagBoltCapacity = lagBoltWithdrawalPerInch * embedmentDepth * CD;

    totalUpliftPerAttachment = upliftPerAttachment;
    totalDownwardPerAttachment = downwardPerAttachment + deadLoadPerAttachment + snowLoadPerAttachment;
    safetyFactor = lagBoltCapacity / totalUpliftPerAttachment;

    // Max allowed attachment spacing \u2014 computed dynamically from actual loads
    // Capped at racking manufacturer max (default 72"), but NOT hardcoded to 72"
    rackingMaxSpacing = input.mountSpecs?.attachmentSpacingMax ?? 72;
    computedMaxSpacing = Math.floor((lagBoltCapacity / netUpliftPressure) * 12);
  }

  // Max allowed spacing (shared logic for both models)
  const maxAllowedSpacing = Math.min(rackingMaxSpacing, computedMaxSpacing);

  // Margin: how much headroom the user has vs computed max
  const spacingMarginPct = ((maxAllowedSpacing - input.attachmentSpacing) / maxAllowedSpacing) * 100;
  const spacingCompliant = input.attachmentSpacing <= maxAllowedSpacing;

  const requiredMinimumSF = 2.0;
  const attachmentPasses = spacingCompliant && safetyFactor >= requiredMinimumSF;

  // Safety factor check \u2014 fail only if truly below minimum
  if (safetyFactor < requiredMinimumSF) {
    errors.push({
      code: 'E-ATTACHMENT-SF',
      severity: 'error',
      message: `Attachment safety factor (${safetyFactor.toFixed(2)}) is below minimum ${requiredMinimumSF.toFixed(1)}`,
      value: safetyFactor.toFixed(2),
      limit: String(requiredMinimumSF),
      reference: 'IBC 2021 / ASCE 7-22',
      suggestion: mountLoadModel === 'discrete'
        ? `Reduce attachment spacing or use mount with higher ICC-ES rated capacity`
        : `Reduce attachment spacing to ${Math.floor(maxAllowedSpacing / 6) * 6}" or use larger lag bolts`,
    });
  } else if (safetyFactor < 3.0) {
    warnings.push({
      code: 'W-ATTACHMENT-SF',
      severity: 'warning',
      message: `Attachment safety factor (${safetyFactor.toFixed(2)}) \u2014 below recommended 3.0 (margin: ${spacingMarginPct.toFixed(0)}%)`,
      value: safetyFactor.toFixed(2),
      limit: '3.0',
      reference: 'ASCE 7-22',
      suggestion: spacingMarginPct > 10
        ? `System is compliant. Safety factor is acceptable for permit. Margin: ${spacingMarginPct.toFixed(0)}%`
        : 'Consider reducing attachment spacing for additional safety margin',
    });
  }

  // Spacing check \u2014 fail ONLY if user spacing exceeds computed max
  // Do NOT recommend reducing spacing if user is already compliant
  if (!spacingCompliant) {
    errors.push({
      code: 'E-ATTACH-SPACING',
      severity: 'error',
      message: `Attachment spacing (${input.attachmentSpacing}") exceeds computed maximum (${maxAllowedSpacing}") for ${input.windSpeed} mph wind`,
      value: input.attachmentSpacing + '"',
      limit: maxAllowedSpacing + '"',
      reference: 'ASCE 7-22 / Racking manufacturer specs',
      suggestion: `Reduce attachment spacing to ${Math.floor(maxAllowedSpacing / 6) * 6}" or less. Computed max: ${computedMaxSpacing}", racking limit: ${rackingMaxSpacing}"`,
    });
  }

  const attachmentResult: AttachmentCalcResult = {
    attachmentSpacing: input.attachmentSpacing,
    maxAllowedSpacing,
    computedMaxSpacing,
    spacingMarginPct,
    spacingCompliant,
    tributaryArea: mountLoadModel === 'discrete'
      ? (input.mountSpecs?.tributaryArea ?? tributaryAreaPerAttachment)
      : tributaryAreaPerAttachment,
    totalUpliftPerAttachment,
    totalDownwardPerAttachment,
    lagBoltCapacity,
    safetyFactor,
    passes: attachmentPasses,
  };

'''

new_content = content[:start_idx] + new_section + content[end_idx:]
print(f"New content length: {len(new_content)} chars (was {len(content)})")

with open('lib/structural-calc.ts', 'w') as f:
    f.write(new_content)

print("SUCCESS: structural-calc.ts patched")