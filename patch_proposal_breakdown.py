with open('app/proposals/page.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

OLD = """                {/* Investment breakdown */}
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
                    <div className="flex justify-between text-sm py-2 text-slate-500">"""

NEW = """                {/* Investment breakdown — itemized by installation type */}
                <div>
                  <h4 className="font-semibold text-slate-700 mb-4 text-sm">Investment Breakdown</h4>
                  <div className="space-y-2">
                    {/* Itemized line items by installation type */}
                    {cost?.lineItems && cost.lineItems.length > 0 ? (
                      <>
                        {cost.lineItems.map((item: { type: string; label: string; panelCount: number; pricePerPanel: number; subtotal: number }) => (
                          <div key={item.type} className="py-2 border-b border-slate-100">
                            <div className="flex justify-between text-sm">
                              <span className="font-semibold text-slate-700">{item.label}</span>
                              <span className="font-bold text-slate-900">${item.subtotal.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between text-xs text-slate-400 mt-0.5">
                              <span>{item.panelCount} panels × ${item.pricePerPanel.toLocaleString()}/panel</span>
                              <span>${(item.pricePerPanel / (pricingCfg?.defaultPanelWattage ?? 440)).toFixed(2)}/W</span>
                            </div>
                          </div>
                        ))}
                        {cost.fixedCosts > 0 && (
                          <div className="flex justify-between text-sm py-2 border-b border-slate-100">
                            <span className="text-slate-500">Fixed Project Cost</span>
                            <span className="font-medium text-slate-700">${cost.fixedCosts.toLocaleString()}</span>
                          </div>
                        )}
                      </>
                    ) : (
                      /* Fallback: no line items — show simple total */
                      <div className="py-2 border-b border-slate-100">
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-600">System Installation</span>
                          <span className="font-medium text-slate-900">${effectiveFinal.toLocaleString()}</span>
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5">
                          {layout?.totalPanels ?? 0} panels · {systemSizeKw.toFixed(1)} kW
                        </div>
                      </div>
                    )}
                    <div className="flex justify-between text-sm py-2 border-b border-slate-200 font-bold">
                      <span className="text-slate-700">Cash Price</span>
                      <span className="text-slate-900">${effectiveFinal.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-sm py-2 border-b border-slate-100">
                      <span className="text-slate-500 font-medium">Federal Tax Credit ({itcRate}% ITC)</span>
                      <span className="text-emerald-600 font-bold">-${itcAmount.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-base font-black py-3 bg-amber-50 rounded-xl px-3 border border-amber-200 mt-2">
                      <span className="text-slate-900">Cost After Incentives</span>
                      <span className="text-amber-700">${effectiveNet.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-sm py-2 text-slate-500">"""

if OLD in content:
    content = content.replace(OLD, NEW)
    with open('app/proposals/page.tsx', 'w', encoding='utf-8') as f:
        f.write(content)
    print('✅ Replaced Investment Breakdown section')
else:
    # Try to find the section by searching for key parts
    idx = content.find("{ label: 'Equipment Cost'")
    if idx == -1:
        idx = content.find("Equipment Cost")
    print(f'OLD string not found. "Equipment Cost" at index: {idx}')
    # Show context around it
    if idx > 0:
        print(repr(content[idx-200:idx+200]))