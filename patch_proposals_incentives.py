with open('app/proposals/page.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add import for calculateIncentives after existing imports
old_import = "import { resolveEquipment, getSystemTypeLabel } from '@/lib/systemEquipmentResolver';"
new_import = """import { resolveEquipment, getSystemTypeLabel } from '@/lib/systemEquipmentResolver';
import { calculateIncentives } from '@/lib/incentives/stateIncentives';"""

if old_import in content:
    content = content.replace(old_import, new_import, 1)
    print("✓ Added calculateIncentives import")
else:
    print("✗ Could not find import anchor")

# 2. Add stateIncentives computed variable after the lifetimeSavings line
old_savings = "  const lifetimeSavings = cost?.lifetimeSavings ?? 0;"
new_savings = """  const lifetimeSavings = cost?.lifetimeSavings ?? 0;

  // State incentives — computed from project stateCode
  const projectStateCode = (proj as any)?.stateCode || client?.state || '';
  const stateIncentives = projectStateCode && systemSizeKw > 0
    ? calculateIncentives(projectStateCode, effectiveFinal, systemSizeKw, production?.annualProductionKwh ?? 0, !isCommercial)
    : null;"""

if old_savings in content:
    content = content.replace(old_savings, new_savings, 1)
    print("✓ Added stateIncentives computation")
else:
    print("✗ Could not find lifetimeSavings anchor")

# 3. Add state incentives section BEFORE the existing ITC section
# Find the ITC section header
old_itc_header = """          {/* ── ITC + SREC Incentives ── */}
          <div className="p-8 md:p-10 border-b border-slate-100 bg-gradient-to-br from-blue-50/50 to-white">
            <div className="flex items-center gap-2 mb-6">
              <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center">
                <TrendingUp size={16} className="text-blue-600" />
              </div>
              <h2 className="text-xl font-black text-slate-900">Available Incentives & Tax Credits</h2>
            </div>"""

new_itc_header = """          {/* ── State-Specific Incentives (dynamic by project location) ── */}
          {stateIncentives && stateIncentives.stateIncentives.length > 0 && (
            <div className="p-8 md:p-10 border-b border-slate-100 bg-gradient-to-br from-emerald-50/30 to-white">
              <div className="flex items-center gap-2 mb-6">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-100 flex items-center justify-center">
                  <MapPin size={16} className="text-emerald-600" />
                </div>
                <div>
                  <h2 className="text-xl font-black text-slate-900">
                    {projectStateCode} State Incentives
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Auto-detected for {projectStateCode} — Solar Friendliness Rating: {'⭐'.repeat(stateIncentives.solarFriendlyRating || 3)}
                  </p>
                </div>
              </div>

              {/* Total state savings summary */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
                  <div className="text-2xl font-black text-emerald-700">
                    ${(stateIncentives.totalStateValue || 0).toLocaleString()}
                  </div>
                  <div className="text-xs text-emerald-600 font-medium">Total State Value</div>
                </div>
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-center">
                  <div className="text-2xl font-black text-blue-700">
                    ${(stateIncentives.federalValue || 0).toLocaleString()}
                  </div>
                  <div className="text-xs text-blue-600 font-medium">Federal ITC Value</div>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
                  <div className="text-2xl font-black text-amber-700">
                    ${(stateIncentives.totalCombinedValue || 0).toLocaleString()}
                  </div>
                  <div className="text-xs text-amber-600 font-medium">Total Combined</div>
                </div>
                <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 text-center">
                  <div className="text-2xl font-black text-purple-700">
                    ${((effectiveFinal - (stateIncentives.totalCombinedValue || 0)) > 0
                      ? effectiveFinal - (stateIncentives.totalCombinedValue || 0)
                      : 0).toLocaleString()}
                  </div>
                  <div className="text-xs text-purple-600 font-medium">Net System Cost</div>
                </div>
              </div>

              {/* Individual incentives */}
              <div className="space-y-3">
                {stateIncentives.stateIncentives.map((inc: any, i: number) => (
                  <div key={i} className="bg-white border border-slate-200 rounded-xl p-4 flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${
                          inc.type === 'state_tax_credit' ? 'bg-blue-100 text-blue-700' :
                          inc.type === 'state_rebate' ? 'bg-emerald-100 text-emerald-700' :
                          inc.type === 'srec' ? 'bg-amber-100 text-amber-700' :
                          inc.type === 'property_tax_exemption' ? 'bg-purple-100 text-purple-700' :
                          inc.type === 'sales_tax_exemption' ? 'bg-teal-100 text-teal-700' :
                          'bg-slate-100 text-slate-700'
                        }`}>
                          {inc.type.replace(/_/g, ' ').toUpperCase()}
                        </span>
                        {inc.stackable && (
                          <span className="text-xs text-slate-400">Stackable</span>
                        )}
                      </div>
                      <div className="font-semibold text-slate-800 text-sm">{inc.name}</div>
                      <div className="text-xs text-slate-500 mt-0.5">{inc.description}</div>
                      {inc.expirationDate && (
                        <div className="text-xs text-amber-600 mt-1">⏰ Expires: {inc.expirationDate}</div>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-lg font-black text-emerald-700">
                        ${(inc.calculatedValue || 0).toLocaleString()}
                      </div>
                      <div className="text-xs text-slate-400">estimated value</div>
                    </div>
                  </div>
                ))}
              </div>

              {stateIncentives.notes && (
                <p className="text-xs text-slate-400 mt-4">{stateIncentives.notes}</p>
              )}
            </div>
          )}

          {/* ── ITC + SREC Incentives ── */}
          <div className="p-8 md:p-10 border-b border-slate-100 bg-gradient-to-br from-blue-50/50 to-white">
            <div className="flex items-center gap-2 mb-6">
              <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center">
                <TrendingUp size={16} className="text-blue-600" />
              </div>
              <h2 className="text-xl font-black text-slate-900">Available Incentives & Tax Credits</h2>
            </div>"""

if old_itc_header in content:
    content = content.replace(old_itc_header, new_itc_header, 1)
    print("✓ Added state incentives section before ITC section")
else:
    print("✗ Could not find ITC section anchor")
    # Debug: show what's around the ITC section
    idx = content.find('ITC + SREC Incentives')
    if idx >= 0:
        print("Found 'ITC + SREC Incentives' at index", idx)
        print(repr(content[max(0,idx-200):idx+200]))

with open('app/proposals/page.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print(f"Done. Lines: {len(content.splitlines())}")