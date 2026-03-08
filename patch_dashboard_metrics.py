#!/usr/bin/env python3
"""
Enhance dashboard with:
1. Additional stat cards: avg system size, conversion rate, annual production
2. Financial visualizations: before/after bill, cumulative savings, 25yr projection
"""

with open('/workspace/app/dashboard/page.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# ─── 1. Add new derived stats after existing ones ────────────────────────────
OLD_STATS = """  // System type breakdown"""

NEW_STATS = """  // Additional metrics
  const avgSystemKw = projects.length > 0
    ? projects.reduce((sum, p) => sum + (p.layout?.systemSizeKw || 0), 0) / projects.filter(p => p.layout?.systemSizeKw).length || 0
    : 0;
  const proposalCount = projects.filter(p => p.status === 'proposal' || p.status === 'approved' || p.status === 'installed').length;
  const approvedCount = projects.filter(p => p.status === 'approved' || p.status === 'installed').length;
  const conversionRate = proposalCount > 0 ? Math.round((approvedCount / proposalCount) * 100) : 0;
  const totalAnnualKwhAll = projects.reduce((sum, p) => sum + (p.production?.annualProductionKwh || 0), 0);

  // 25-year cumulative savings projection
  const avgUtilityRate = 0.15;
  const utilityInflation = 0.03;
  const yearlyProjection = Array.from({ length: 25 }, (_, i) => {
    const year = i + 1;
    const rate = avgUtilityRate * Math.pow(1 + utilityInflation, i);
    const production = totalAnnualKwhAll * Math.pow(0.995, i); // 0.5% degradation
    const savings = Math.round(production * rate);
    const cumulative = Array.from({ length: year }, (_, j) => {
      const r = avgUtilityRate * Math.pow(1 + utilityInflation, j);
      const p = totalAnnualKwhAll * Math.pow(0.995, j);
      return p * r;
    }).reduce((a, b) => a + b, 0);
    return { year, savings: Math.round(savings), cumulative: Math.round(cumulative) };
  });

  // Monthly bill before/after (using avg utility rate)
  const avgMonthlyKwh = totalAnnualKwhAll > 0 ? totalAnnualKwhAll / 12 : 0;
  const billBeforeAfter = MONTHS.map((month, i) => {
    const seasonal = [0.85, 0.80, 0.90, 0.95, 1.05, 1.15, 1.25, 1.20, 1.10, 1.00, 0.88, 0.87];
    const monthlyKwh = avgMonthlyKwh * seasonal[i];
    const before = Math.round(monthlyKwh * avgUtilityRate * 12); // rough monthly bill
    const production = projects.reduce((sum, p) => sum + (p.production?.monthlyProductionKwh?.[i] || 0), 0);
    const after = Math.max(0, Math.round((monthlyKwh - production) * avgUtilityRate * 12));
    return { month, before: Math.round(monthlyKwh * avgUtilityRate), after: Math.max(0, Math.round((monthlyKwh - production) * avgUtilityRate)) };
  });
  const hasBillData = billBeforeAfter.some(m => m.before > 0);

  // System type breakdown"""

if OLD_STATS in content:
    content = content.replace(OLD_STATS, NEW_STATS, 1)
    print("✅ New derived stats added")
else:
    print("❌ ANCHOR for stats not found")

# ─── 2. Expand the Stats Grid from 4 to 6 cards ──────────────────────────────
OLD_GRID = """        {/* Stats Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon={<FolderOpen size={18} className="text-amber-400" />}
            label="Total Projects"
            value={loading ? '\u2014' : projects.length.toString()}
            sub={`${projects.filter(p => p.status === 'design' || p.status === 'proposal').length} active`}
            color="bg-amber-500/10"
            href="/projects"
          />
          <StatCard
            icon={<Users size={18} className="text-blue-400" />}
            label="Total Clients"
            value={loading ? '\u2014' : clients.length.toString()}
            sub={`${clients.filter(c => projects.some(p => p.clientId === c.id)).length} with projects`}
            color="bg-blue-500/10"
            href="/clients"
          />
          <StatCard
            icon={<Zap size={18} className="text-emerald-400" />}
            label="Total Capacity"
            value={loading ? '\u2014' : totalKw >= 1000 ? `${(totalKw / 1000).toFixed(1)} MW` : `${totalKw.toFixed(1)} kW`}
            sub="Designed capacity"
            color="bg-emerald-500/10"
          />
          <StatCard
            icon={<DollarSign size={18} className="text-purple-400" />}
            label="Pipeline Value"
            value={loading ? '\u2014' : `$${(totalRevenue / 1000).toFixed(0)}k`}
            sub="Net after tax credit"
            color="bg-purple-500/10"
          />
        </div>"""

NEW_GRID = """        {/* Stats Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <StatCard
            icon={<FolderOpen size={18} className="text-amber-400" />}
            label="Total Projects"
            value={loading ? '\u2014' : projects.length.toString()}
            sub={`${projects.filter(p => p.status === 'design' || p.status === 'proposal').length} active`}
            color="bg-amber-500/10"
            href="/projects"
          />
          <StatCard
            icon={<Users size={18} className="text-blue-400" />}
            label="Total Clients"
            value={loading ? '\u2014' : clients.length.toString()}
            sub={`${clients.filter(c => projects.some(p => p.clientId === c.id)).length} with projects`}
            color="bg-blue-500/10"
            href="/clients"
          />
          <StatCard
            icon={<Zap size={18} className="text-emerald-400" />}
            label="Total Capacity"
            value={loading ? '\u2014' : totalKw >= 1000 ? `${(totalKw / 1000).toFixed(1)} MW` : `${totalKw.toFixed(1)} kW`}
            sub="Designed capacity"
            color="bg-emerald-500/10"
          />
          <StatCard
            icon={<DollarSign size={18} className="text-purple-400" />}
            label="Pipeline Value"
            value={loading ? '\u2014' : `$${(totalRevenue / 1000).toFixed(0)}k`}
            sub="Net after tax credit"
            color="bg-purple-500/10"
          />
          <StatCard
            icon={<BarChart2 size={18} className="text-sky-400" />}
            label="Avg System Size"
            value={loading ? '\u2014' : `${(isNaN(avgSystemKw) ? 0 : avgSystemKw).toFixed(1)} kW`}
            sub="Per designed project"
            color="bg-sky-500/10"
          />
          <StatCard
            icon={<TrendingUp size={18} className="text-rose-400" />}
            label="Conversion Rate"
            value={loading ? '\u2014' : `${conversionRate}%`}
            sub={`${approvedCount} of ${proposalCount} proposals`}
            color="bg-rose-500/10"
          />
        </div>"""

if OLD_GRID in content:
    content = content.replace(OLD_GRID, NEW_GRID, 1)
    print("✅ Stats grid expanded to 6 cards")
else:
    print("❌ ANCHOR for stats grid not found")

# ─── 3. Add financial visualizations section before Environmental Impact ──────
OLD_ENV = """        {/* Environmental Impact */}
        <div className="card p-5">"""

NEW_FINANCIAL_AND_ENV = """        {/* Financial Visualizations */}
        {totalAnnualKwhAll > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Before/After Monthly Bill */}
            <div className="card p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-white text-sm">Monthly Bill: Before vs After Solar</h3>
                  <p className="text-xs text-slate-400 mt-0.5">Estimated utility savings across all projects</p>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-red-500/70 inline-block" />Before</span>
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" />After</span>
                </div>
              </div>
              {mounted && (
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={billBeforeAfter} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                    <Tooltip
                      contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', fontSize: '12px' }}
                      formatter={(v: number, name: string) => [`$${v}`, name === 'before' ? 'Before Solar' : 'After Solar']}
                    />
                    <Bar dataKey="before" fill="#ef4444" opacity={0.6} radius={[2, 2, 0, 0]} />
                    <Bar dataKey="after" fill="#10b981" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* 25-Year Cumulative Savings */}
            <div className="card p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-white text-sm">25-Year Cumulative Savings</h3>
                  <p className="text-xs text-slate-400 mt-0.5">3% utility inflation · 0.5% panel degradation</p>
                </div>
                <div className="text-right">
                  <div className="text-lg font-black text-emerald-400">
                    ${(yearlyProjection[24]?.cumulative / 1000).toFixed(0)}k
                  </div>
                  <div className="text-xs text-slate-500">total savings</div>
                </div>
              </div>
              {mounted && (
                <ResponsiveContainer width="100%" height={180}>
                  <AreaChart data={yearlyProjection} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id="savingsGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="year" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false}
                      tickFormatter={v => `Yr ${v}`} interval={4} />
                    <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false}
                      tickFormatter={v => v >= 1000 ? `$${(v/1000).toFixed(0)}k` : `$${v}`} />
                    <Tooltip
                      contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', fontSize: '12px' }}
                      formatter={(v: number, name: string) => [
                        `$${v.toLocaleString()}`,
                        name === 'cumulative' ? 'Cumulative Savings' : 'Annual Savings'
                      ]}
                    />
                    <Area type="monotone" dataKey="cumulative" stroke="#10b981" fill="url(#savingsGrad)" strokeWidth={2} name="cumulative" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        )}

        {/* Environmental Impact */}
        <div className="card p-5">"""

if OLD_ENV in content:
    content = content.replace(OLD_ENV, NEW_FINANCIAL_AND_ENV, 1)
    print("✅ Financial visualizations section added")
else:
    print("❌ ANCHOR for Environmental Impact not found")

with open('/workspace/app/dashboard/page.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("✅ Dashboard file written successfully")