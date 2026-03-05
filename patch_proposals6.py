with open('app/proposals/page.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix energy offset to use computed energyOffset instead of raw offsetPercentage
old_offset = "{ label: 'Energy Offset', value: `${production.offsetPercentage}%` },"
new_offset = "{ label: 'Energy Offset', value: `${energyOffset}%` },"
if old_offset in content:
    content = content.replace(old_offset, new_offset, 1)
    print("✅ Energy offset fixed to use computed energyOffset")
else:
    print("❌ Energy offset line not found")

# Also fix the summary card that shows Net Cost → show Cash Price instead
old_net_cost = "{ label: 'Net Cost', value: cost ? `$${cost.netCost.toLocaleString()}` : '\u2014', icon: <DollarSign size={16} />, color: 'border-purple-500/30 bg-purple-500/10' },"
new_net_cost = "{ label: 'Cash Price', value: effectiveFinal > 0 ? `$${effectiveFinal.toLocaleString()}` : '\u2014', icon: <DollarSign size={16} />, color: 'border-purple-500/30 bg-purple-500/10' },"
if old_net_cost in content:
    content = content.replace(old_net_cost, new_net_cost, 1)
    print("✅ Summary card: Net Cost → Cash Price")
else:
    print("❌ Net Cost summary card not found — checking...")
    if "Net Cost" in content and "cost.netCost" in content:
        print("  Found 'Net Cost' and 'cost.netCost' in file")

with open('app/proposals/page.tsx', 'w', encoding='utf-8') as f:
    f.write(content)