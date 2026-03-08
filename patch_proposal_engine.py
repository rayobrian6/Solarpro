#!/usr/bin/env python3
"""
Enhance proposal engine with:
1. Utility bill comparison section (before/after monthly bills with chart)
2. 25-year savings projection chart
3. Shareable client link functionality
"""

with open('/workspace/app/proposals/page.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# ─── 1. Add recharts import ───────────────────────────────────────────────────
if 'BarChart, Bar,' not in content and 'recharts' not in content:
    content = content.replace(
        "import Link from 'next/link';",
        """import Link from 'next/link';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';"""
    )
    print("✅ Added recharts import")
elif 'recharts' not in content:
    content = content.replace(
        "import Link from 'next/link';",
        """import Link from 'next/link';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';"""
    )
    print("✅ Added recharts import")
else:
    print("✅ recharts already imported")

# ─── 2. Add shareable link state + copy handler after existing state vars ─────
OLD_BRANDING_STATE = """  // Sales override state
  const [showOverrides, setShowOverrides] = useState(false);"""

NEW_BRANDING_STATE = """  // Shareable link state
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [shareLoading, setShareLoading] = useState(false);

  const handleShare = async () => {
    setShareLoading(true);
    try {
      // Generate a shareable token via API
      const res = await fetch(`/api/proposals/${proposal.id}/share`, { method: 'POST' });
      const data = await res.json();
      if (data.success && data.shareUrl) {
        setShareLink(data.shareUrl);
        await navigator.clipboard.writeText(data.shareUrl);
        setShareCopied(true);
        setTimeout(() => setShareCopied(false), 3000);
      } else {
        // Fallback: copy current URL
        const url = `${window.location.origin}/proposals/view/${proposal.id}`;
        setShareLink(url);
        await navigator.clipboard.writeText(url);
        setShareCopied(true);
        setTimeout(() => setShareCopied(false), 3000);
      }
    } catch {
      const url = `${window.location.origin}/proposals/view/${proposal.id}`;
      setShareLink(url);
    } finally {
      setShareLoading(false);
    }
  };

  // Sales override state
  const [showOverrides, setShowOverrides] = useState(false);"""

if OLD_BRANDING_STATE in content:
    content = content.replace(OLD_BRANDING_STATE, NEW_BRANDING_STATE, 1)
    print("✅ Shareable link state added")
else:
    print("❌ ANCHOR for branding state not found")

# ─── 3. Add financial chart data computation after existing savings vars ──────
OLD_SAVINGS = """  // ── Energy offset"""

NEW_SAVINGS = """  // ── Financial chart data ──────────────────────────────────────────────────
  const utilityRate = client?.utilityRate ?? 0.15;
  const utilityInflation = 0.03;
  const panelDegradation = 0.005;

  // Monthly bill before/after solar
  const monthlyBillData = MONTHS.map((month, i) => {
    const seasonal = [0.85, 0.80, 0.90, 0.95, 1.05, 1.15, 1.25, 1.20, 1.10, 1.00, 0.88, 0.87];
    const annualUsageKwh = client?.annualKwh ?? (annualSavings > 0 ? annualSavings / utilityRate : 12000);
    const monthlyUsage = (annualUsageKwh / 12) * seasonal[i];
    const monthlyProduced = production?.monthlyProductionKwh?.[i] ?? 0;
    const before = Math.round(monthlyUsage * utilityRate);
    const after = Math.max(0, Math.round((monthlyUsage - monthlyProduced) * utilityRate));
    return { month, before, after, savings: before - after };
  });

  // 25-year projection
  const projectionData = Array.from({ length: 25 }, (_, i) => {
    const year = i + 1;
    const rate = utilityRate * Math.pow(1 + utilityInflation, i);
    const annualProd = (production?.annualProductionKwh ?? 0) * Math.pow(1 - panelDegradation, i);
    const yearlySavings = Math.round(annualProd * rate);
    const cumulative = Array.from({ length: year }, (_, j) => {
      const r = utilityRate * Math.pow(1 + utilityInflation, j);
      const p = (production?.annualProductionKwh ?? 0) * Math.pow(1 - panelDegradation, j);
      return p * r;
    }).reduce((a, b) => a + b, 0);
    return { year: `Yr ${year}`, savings: yearlySavings, cumulative: Math.round(cumulative) };
  });

  const totalLifetimeSavings = projectionData[24]?.cumulative ?? lifetimeSavings;

  // ── Energy offset"""

if OLD_SAVINGS in content:
    content = content.replace(OLD_SAVINGS, NEW_SAVINGS, 1)
    print("✅ Financial chart data computation added")
else:
    print("❌ ANCHOR for energy offset not found")

# ─── 4. Update Share button in toolbar to use handleShare ────────────────────
OLD_SHARE_BTN = """          <button className="btn-secondary btn-sm"><Share2 size={13} /> Share</button>"""

NEW_SHARE_BTN = """          <button
            onClick={handleShare}
            disabled={shareLoading}
            className="btn-secondary btn-sm flex items-center gap-1.5"
          >
            {shareLoading ? <span className="spinner w-3 h-3" /> : <Share2 size={13} />}
            {shareCopied ? 'Link Copied!' : 'Share'}
          </button>
          {shareLink && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-xs text-emerald-300 max-w-xs">
              <span className="truncate">{shareLink}</span>
            </div>
          )}"""

if OLD_SHARE_BTN in content:
    content = content.replace(OLD_SHARE_BTN, NEW_SHARE_BTN, 1)
    print("✅ Share button updated")
else:
    print("❌ ANCHOR for share button not found")

# ─── 5. Add utility bill comparison + 25yr chart after Production Analysis ───
# Find the end of Production Analysis section
OLD_AFTER_PRODUCTION = """          {/* ── Sales Override Panel (no-print) ── */}"""

NEW_AFTER_PRODUCTION = """          {/* ── Utility Bill Comparison ── */}
          {production && monthlyBillData.some(m => m.before > 0) && (
            <div className="p-8 md:p-10 border-b border-slate-100 bg-gradient-to-br from-green-50/30 to-white">
              <div className="flex items-center gap-2 mb-6">
                <div className="w-8 h-8 rounded-lg bg-green-50 border border-green-100 flex items-center justify-center">
                  <DollarSign size={16} className="text-green-600" />
                </div>
                <h2 className="text-xl font-black text-slate-900">Utility Bill: Before vs After Solar</h2>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
                  <div className="text-xs font-bold text-red-600 uppercase tracking-wide mb-1">Current Annual Bill</div>
                  <div className="text-2xl font-black text-red-700">
                    ${monthlyBillData.reduce((s, m) => s + m.before, 0).toLocaleString()}
                  </div>
                  <div className="text-xs text-red-500 mt-1">Without solar</div>
                </div>
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
                  <div className="text-xs font-bold text-emerald-600 uppercase tracking-wide mb-1">After Solar Annual Bill</div>
                  <div className="text-2xl font-black text-emerald-700">
                    ${monthlyBillData.reduce((s, m) => s + m.after, 0).toLocaleString()}
                  </div>
                  <div className="text-xs text-emerald-500 mt-1">With solar system</div>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
                  <div className="text-xs font-bold text-amber-600 uppercase tracking-wide mb-1">Year 1 Savings</div>
                  <div className="text-2xl font-black text-amber-700">
                    ${monthlyBillData.reduce((s, m) => s + m.savings, 0).toLocaleString()}
                  </div>
                  <div className="text-xs text-amber-500 mt-1">First year reduction</div>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="text-sm font-semibold text-slate-700 mb-3">Monthly Bill Comparison</div>
                <div className="flex items-end gap-1 h-32 mb-2">
                  {monthlyBillData.map((m, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                      <div className="w-full flex flex-col justify-end gap-0.5" style={{ height: '112px' }}>
                        <div
                          className="w-full bg-red-400/60 rounded-t-sm"
                          style={{ height: `${(m.before / Math.max(...monthlyBillData.map(x => x.before), 1)) * 56}px` }}
                          title={`Before: $${m.before}`}
                        />
                        <div
                          className="w-full bg-emerald-500 rounded-t-sm"
                          style={{ height: `${(m.after / Math.max(...monthlyBillData.map(x => x.before), 1)) * 56}px` }}
                          title={`After: $${m.after}`}
                        />
                      </div>
                      <span className="text-slate-400" style={{ fontSize: '8px' }}>{MONTHS[i][0]}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-4 text-xs text-slate-500 justify-center">
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-red-400/60 inline-block" />Before Solar</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-emerald-500 inline-block" />After Solar</span>
                </div>
              </div>
            </div>
          )}

          {/* ── 25-Year Savings Projection ── */}
          {production && (production.annualProductionKwh ?? 0) > 0 && (
            <div className="p-8 md:p-10 border-b border-slate-100 bg-gradient-to-br from-blue-50/30 to-white">
              <div className="flex items-center gap-2 mb-6">
                <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center">
                  <TrendingUp size={16} className="text-blue-600" />
                </div>
                <h2 className="text-xl font-black text-slate-900">25-Year Savings Projection</h2>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                {[
                  { label: 'Year 1 Savings', value: `$${projectionData[0]?.savings.toLocaleString() ?? 0}`, color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200' },
                  { label: 'Year 10 Savings', value: `$${projectionData[9]?.savings.toLocaleString() ?? 0}`, color: 'text-indigo-700', bg: 'bg-indigo-50 border-indigo-200' },
                  { label: 'Year 25 Savings', value: `$${projectionData[24]?.savings.toLocaleString() ?? 0}`, color: 'text-purple-700', bg: 'bg-purple-50 border-purple-200' },
                  { label: '25-Year Total', value: `$${totalLifetimeSavings.toLocaleString()}`, color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200' },
                ].map(item => (
                  <div key={item.label} className={`${item.bg} border rounded-xl p-4 text-center`}>
                    <div className={`text-xl font-black ${item.color}`}>{item.value}</div>
                    <div className="text-xs text-slate-500 mt-1">{item.label}</div>
                  </div>
                ))}
              </div>

              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="text-sm font-semibold text-slate-700 mb-3">Cumulative Savings Over 25 Years</div>
                <div className="flex items-end gap-0.5 h-28 mb-2">
                  {projectionData.map((d, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                      <div
                        className="w-full rounded-t-sm transition-all"
                        style={{
                          height: `${(d.cumulative / (projectionData[24]?.cumulative || 1)) * 100}px`,
                          background: `linear-gradient(to top, #3b82f6, #6366f1)`
                        }}
                        title={`Year ${i + 1}: $${d.cumulative.toLocaleString()} cumulative`}
                      />
                      {(i + 1) % 5 === 0 && (
                        <span className="text-slate-400" style={{ fontSize: '8px' }}>Yr{i + 1}</span>
                      )}
                    </div>
                  ))}
                </div>
                <div className="text-xs text-slate-400 text-center">
                  Assumes 3% annual utility rate increase · 0.5% panel degradation per year
                </div>
              </div>
            </div>
          )}

          {/* ── Sales Override Panel (no-print) ── */}"""

if OLD_AFTER_PRODUCTION in content:
    content = content.replace(OLD_AFTER_PRODUCTION, NEW_AFTER_PRODUCTION, 1)
    print("✅ Utility bill comparison + 25yr projection added")
else:
    print("❌ ANCHOR for Sales Override Panel not found")
    # Debug
    idx = content.find('Sales Override Panel')
    if idx >= 0:
        print(f"  Found at char {idx}: {repr(content[idx-50:idx+100])}")

with open('/workspace/app/proposals/page.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("✅ Proposals page written successfully")