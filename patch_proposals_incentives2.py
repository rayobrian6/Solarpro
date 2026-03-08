with open('app/proposals/page.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix the stateIncentives computation to match actual return type
old_computation = """  // State incentives — computed from project stateCode
  const projectStateCode = (proj as any)?.stateCode || client?.state || '';
  const stateIncentives = projectStateCode && systemSizeKw > 0
    ? calculateIncentives(projectStateCode, effectiveFinal, systemSizeKw, production?.annualProductionKwh ?? 0, !isCommercial)
    : null;"""

new_computation = """  // State incentives — computed from project stateCode
  const projectStateCode = (proj as any)?.stateCode || client?.state || '';
  const incentiveCalc = projectStateCode && systemSizeKw > 0
    ? calculateIncentives(projectStateCode, effectiveFinal, systemSizeKw, production?.annualProductionKwh ?? 0, !isCommercial)
    : null;
  // Normalize to a consistent shape for the UI
  const stateIncentives = incentiveCalc ? {
    stateIncentives: incentiveCalc.state.map((s: any) => ({
      ...s,
      name: s.incentiveName,
      type: s.type,
      description: s.notes || s.description,
      calculatedValue: s.calculatedValue,
      stackable: true,
    })),
    totalStateValue: incentiveCalc.state.reduce((sum: number, s: any) => sum + s.calculatedValue, 0),
    federalValue: incentiveCalc.federal.calculatedValue,
    totalCombinedValue: incentiveCalc.total,
    netSystemCost: incentiveCalc.netSystemCost,
    solarFriendlyRating: 3,
    notes: incentiveCalc.summary,
  } : null;"""

if old_computation in content:
    content = content.replace(old_computation, new_computation, 1)
    print("✓ Fixed stateIncentives computation")
else:
    print("✗ Could not find stateIncentives computation")
    idx = content.find('State incentives')
    if idx >= 0:
        print(repr(content[idx:idx+300]))

with open('app/proposals/page.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print(f"Done. Lines: {len(content.splitlines())}")