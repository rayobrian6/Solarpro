'use client';
import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import { Zap, DollarSign, Leaf, TrendingUp } from 'lucide-react';

interface Props {
  production: any;
  costEstimate: any;
  clientAnnualKwh: number;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function ProductionPanel({ production, costEstimate, clientAnnualKwh }: Props) {
  if (!production) return null;

  const chartData = MONTHS.map((month, i) => ({
    month,
    production: production.monthlyProductionKwh[i],
    usage: Math.round(clientAnnualKwh / 12),
  }));

  const savingsData = Array.from({ length: 25 }, (_, i) => ({
    year: `Y${i + 1}`,
    cumulative: Math.round(costEstimate?.annualSavings * (i + 1) * Math.pow(1.035, i)),
  }));

  return (
    <div className="space-y-4 p-4">
      {/* Key metrics */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { icon: <Zap size={14} />, label: 'Annual Production', value: `${production.annualProductionKwh.toLocaleString()} kWh`, color: 'text-amber-400', bg: 'bg-amber-500/10' },
          { icon: <TrendingUp size={14} />, label: 'Energy Offset', value: `${production.offsetPercentage}%`, color: 'text-blue-400', bg: 'bg-blue-500/10' },
          { icon: <DollarSign size={14} />, label: 'Annual Savings', value: costEstimate ? `$${costEstimate.annualSavings.toLocaleString()}` : '—', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
          { icon: <Leaf size={14} />, label: 'CO₂ Offset', value: `${production.co2OffsetTons} tons`, color: 'text-green-400', bg: 'bg-green-500/10' },
        ].map(item => (
          <div key={item.label} className={`${item.bg} rounded-xl p-3 flex items-center gap-2`}>
            <span className={item.color}>{item.icon}</span>
            <div>
              <div className={`text-sm font-bold ${item.color}`}>{item.value}</div>
              <div className="text-xs text-slate-400">{item.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Monthly production vs usage */}
      <div className="card p-4">
        <h4 className="text-xs font-semibold text-slate-300 mb-3">Monthly Production vs Usage</h4>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', fontSize: '11px' }} />
            <Bar dataKey="production" fill="#f59e0b" radius={[2, 2, 0, 0]} name="Production" />
            <Bar dataKey="usage" fill="#3b82f6" radius={[2, 2, 0, 0]} name="Usage" opacity={0.6} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Cumulative savings */}
      {costEstimate && (
        <div className="card p-4">
          <h4 className="text-xs font-semibold text-slate-300 mb-3">25-Year Cumulative Savings</h4>
          <ResponsiveContainer width="100%" height={120}>
            <LineChart data={savingsData} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="year" tick={{ fill: '#64748b', fontSize: 9 }} axisLine={false} tickLine={false} interval={4} />
              <YAxis tick={{ fill: '#64748b', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
              <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', fontSize: '11px' }} formatter={(v: number) => [`$${v.toLocaleString()}`, 'Savings']} />
              <Line type="monotone" dataKey="cumulative" stroke="#10b981" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}