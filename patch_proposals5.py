with open('app/proposals/page.tsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Find the Financial Analysis section start
fa_start = None
fa_end = None
for i, line in enumerate(lines):
    if '\u2500\u2500 Financial Analysis \u2500\u2500' in line or ('Financial Analysis' in line and '\u2500' in line):
        fa_start = i
        break

if fa_start is None:
    # Try alternate search
    for i, line in enumerate(lines):
        if '{cost && (' in line:
            fa_start = i
            break

print(f"Financial Analysis start: line {fa_start+1 if fa_start else 'NOT FOUND'}")

# Find end: look for the ITC + SREC Incentives comment
for i in range(fa_start or 0, len(lines)):
    if 'ITC + SREC Incentives' in lines[i] or ('ITC' in lines[i] and 'SREC' in lines[i]):
        fa_end = i
        break

print(f"Financial Analysis end (before ITC section): line {fa_end+1 if fa_end else 'NOT FOUND'}")

if fa_start is None or fa_end is None:
    print("❌ Could not find section boundaries")
    exit(1)

new_financial = """          {/* \u2500\u2500 Sales Override Panel (no-print) \u2500\u2500 */}
          <div className="no-print p-4 md:p-6 border-b border-slate-200 bg-slate-50">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Settings size={15} className="text-slate-500" />
                <span className="text-sm font-bold text-slate-700">Sales Rep Pricing Controls</span>
                <span className="text-xs text-slate-400">(internal only — not shown on PDF)</span>
              </div>
              <button
                onClick={() => setShowOverrides(!showOverrides)}
                className="text-xs text-blue-600 hover:text-blue-800 font-medium"
              >
                {showOverrides ? 'Hide' : 'Show'} Overrides
              </button>
            </div>
            {showOverrides && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    <Tag size={11} className="inline mr-1" />Override Price Per Watt ($/W)
                  </label>
                  <input
                    type="number"
                    step="0.05"
                    min="1"
                    max="10"
                    placeholder={`Default: $${(cost?.pricePerWatt ?? 3.10).toFixed(2)}/W`}
                    value={overridePpw}
                    onChange={e => {
                      setOverridePpw(e.target.value);
                      if (e.target.value && systemSizeW > 0) {
                        setOverrideFinal(String(Math.round(parseFloat(e.target.value) * systemSizeW)));
                      }
                    }}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    <Percent size={11} className="inline mr-1" />Override Margin %
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    max="80"
                    placeholder="Default: 40%"
                    value={overrideMargin}
                    onChange={e => setOverrideMargin(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    <DollarSign size={11} className="inline mr-1" />Override Final Price ($)
                  </label>
                  <input
                    type="number"
                    step="100"
                    min="0"
                    placeholder={`Default: $${baseCashPrice.toLocaleString()}`}
                    value={overrideFinal}
                    onChange={e => {
                      setOverrideFinal(e.target.value);
                      if (e.target.value && systemSizeW > 0) {
                        setOverridePpw(String((parseFloat(e.target.value) / systemSizeW).toFixed(2)));
                      }
                    }}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                {/* Internal profit display */}
                {cost?.internalProfit !== undefined && (
                  <div className="md:col-span-3 bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-4 gap-4 text-center">
                    <div>
                      <div className="text-xs text-slate-400 mb-1">Revenue</div>
                      <div className="font-black text-slate-800">${effectiveFinal.toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-400 mb-1">Est. Cost</div>
                      <div className="font-black text-slate-800">${(cost?.internalCost ?? cost?.estimatedCost ?? 0).toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-400 mb-1">Gross Profit</div>
                      <div className={`font-black ${(effectiveFinal - (cost?.internalCost ?? 0)) > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        ${(effectiveFinal - (cost?.internalCost ?? cost?.estimatedCost ?? 0)).toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-400 mb-1">Margin %</div>
                      <div className={`font-black ${(effectiveFinal - (cost?.internalCost ?? 0)) / effectiveFinal * 100 > 20 ? 'text-emerald-600' : 'text-amber-600'}`}>
                        {effectiveFinal > 0 ? (((effectiveFinal - (cost?.internalCost ?? cost?.estimatedCost ?? 0)) / effectiveFinal) * 100).toFixed(1) : '0'}%
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* \u2500\u2500 Financial Analysis \u2500\u2500 */}
          {cost && (
            <div className="p-8 md:p-10 border-b border-slate-100 bg-gradient-to-br from-slate-50 to-white">
              <div className="flex items-center gap-2 mb-6">
                <div className="w-8 h-8 rounded-lg bg-green-50 border border-green-100 flex items-center justify-center">
                  <DollarSign size={16} className="text-green-600" />
                </div>
                <h2 className="text-xl font-black text-slate-900">Financial Analysis</h2>
              </div>

              {/* Pricing summary cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                <div className="bg-gradient-to-br from-amber-50 to-yellow-50 border-2 border-amber-300 rounded-2xl p-5 text-center">
                  <div className="text-xs font-bold text-amber-600 uppercase tracking-wide mb-1">Cash Price</div>
                  <div className="text-3xl font-black text-amber-700">${effectiveFinal.toLocaleString()}</div>
                  <div className="text-xs text-amber-500 mt-1">Before incentives</div>
                </div>
                <div className="bg-gradient-to-br from-emerald-50 to-green-50 border-2 border-emerald-300 rounded-2xl p-5 text-center">
                  <div className="text-xs font-bold text-emerald-600 uppercase tracking-wide mb-1">Cost After Incentives</div>
                  <div className="text-3xl font-black text-emerald-700">${effectiveNet.toLocaleString()}</div>
                  <div className="text-xs text-emerald-500 mt-1">After 30% ITC (${itcAmount.toLocaleString()} credit)</div>
                </div>
                <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-300 rounded-2xl p-5 text-center">
                  <div className="text-xs font-bold text-blue-600 uppercase tracking-wide mb-1">Price Per Watt</div>
                  <div className="text-3xl font-black text-blue-700">${effectivePpw.toFixed(2)}/W</div>
                  <div className="text-xs text-blue-500 mt-1">{systemSizeKw.toFixed(1)} kW system</div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Investment breakdown */}
                <div>
                  <h4 className="font-semibold text-slate-700 mb-4 text-sm">Investment Breakdown</h4>
                  <div className="space-y-2">
                    {[
                      { label: 'Equipment Cost', value: `$${cost.equipmentCost.toLocaleString()}` },
                      { label: 'Labor Cost', value: `$${cost.laborCost.toLocaleString()}` },
                      { label: 'Fixed Costs', value: `$${cost.fixedCosts.toLocaleString()}` },
                    ].map(item => (
                      <div key={item.label} className="flex justify-between text-sm py-2 border-b border-slate-100">
                        <span className="text-slate-600">{item.label}</span>
                        <span className="font-medium text-slate-900">{item.value}</span>
                      </div>
                    ))}
                    <div className="flex justify-between text-sm py-2 border-b border-slate-200 font-bold">
                      <span className="text-slate-700">Cash Price</span>
                      <span className="text-slate-900">${effectiveFinal.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-sm py-2 border-b border-slate-100">
                      <span className="text-slate-500 font-medium">Federal Tax Credit (30% ITC)</span>
                      <span className="text-emerald-600 font-bold">-${itcAmount.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-base font-black py-3 bg-amber-50 rounded-xl px-3 border border-amber-200 mt-2">
                      <span className="text-slate-900">Cost After Incentives</span>
                      <span className="text-amber-700">${effectiveNet.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-sm py-2 text-slate-500">
                      <span>Price Per Watt</span>
                      <span className="font-bold text-blue-700">${effectivePpw.toFixed(2)}/W</span>
                    </div>
                  </div>
                </div>

                {/* ROI */}
                <div>
                  <h4 className="font-semibold text-slate-700 mb-4 text-sm">Return on Investment</h4>
                  <div className="space-y-3">
                    <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
                      <div className="text-3xl font-black text-green-700">${cost.annualSavings.toLocaleString()}</div>
                      <div className="text-sm text-green-600 font-medium">Annual Savings</div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-center">
                        <div className="text-xl font-black text-blue-700">{cost.paybackYears}</div>
                        <div className="text-xs text-blue-600">Year Payback</div>
                      </div>
                      <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 text-center">
                        <div className="text-xl font-black text-purple-700">{cost.roi}%</div>
                        <div className="text-xs text-purple-600">Total ROI</div>
                      </div>
                    </div>
                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
                      <div className="text-2xl font-black text-emerald-700">${cost.lifetimeSavings.toLocaleString()}</div>
                      <div className="text-sm text-emerald-600 font-medium">25-Year Total Savings</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

"""

# Replace lines fa_start through fa_end (exclusive — keep ITC section)
new_lines = lines[:fa_start] + [new_financial] + lines[fa_end:]

with open('app/proposals/page.tsx', 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

print(f"✅ Replaced Financial Analysis section (lines {fa_start+1}–{fa_end})")
print("✅ Added: Cash Price, Cost After Incentives, Price Per Watt cards")
print("✅ Added: Sales Override panel with internal profit display")