'use client';
import React from 'react';
import { Upload, FileText, Zap, DollarSign, TrendingUp, AlertTriangle, CheckCircle, BarChart2 } from 'lucide-react';
import type { Project } from '@/types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface BillTabProps {
  project: Project;
  onUploadBill: () => void;
}

export default function BillTab({ project, onUploadBill }: BillTabProps) {
  const bill = project.billAnalysis;
  const hasBill = !!bill;

  if (!hasBill) {
    return (
      <div className="space-y-4">
        {/* Empty state */}
        <div className="card p-10 text-center border-2 border-dashed border-slate-700 hover:border-amber-500/40 transition-colors">
          <div className="w-16 h-16 rounded-2xl bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
            <Upload size={28} className="text-amber-400" />
          </div>
          <h3 className="text-white font-semibold text-lg mb-2">No Utility Bill Uploaded</h3>
          <p className="text-slate-400 text-sm mb-6 max-w-sm mx-auto">
            Upload a utility bill to automatically extract usage data, detect the utility provider, and calculate the recommended system size.
          </p>
          <button onClick={onUploadBill} className="btn-primary inline-flex items-center gap-2">
            <Upload size={15} /> Upload Utility Bill
          </button>
          <p className="text-slate-600 text-xs mt-4">Supports PDF, JPG, PNG — AI-powered extraction</p>
        </div>

        {/* What happens next */}
        <div className="card p-5">
          <h4 className="text-sm font-semibold text-white mb-3">What happens after upload?</h4>
          <div className="space-y-2">
            {[
              { icon: '📄', label: 'Bill Parsed', desc: 'AI extracts monthly kWh usage and utility rate' },
              { icon: '📍', label: 'Utility Detected', desc: 'Address geocoded → utility provider identified' },
              { icon: '⚡', label: 'System Sized', desc: 'Recommended kW calculated from usage + location' },
              { icon: '📋', label: 'Rules Loaded', desc: 'Net metering limits and interconnection rules applied' },
            ].map(step => (
              <div key={step.label} className="flex items-start gap-3 p-2.5 rounded-lg bg-slate-800/40">
                <span className="text-lg leading-none mt-0.5">{step.icon}</span>
                <div>
                  <div className="text-sm font-medium text-white">{step.label}</div>
                  <div className="text-xs text-slate-400">{step.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Bill data present
  const peakMonth = bill.peakMonth ?? bill.monthlyKwh.indexOf(Math.max(...bill.monthlyKwh));
  const maxKwh = Math.max(...bill.monthlyKwh);

  return (
    <div className="space-y-5">
      {/* Status banner */}
      <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
        <CheckCircle size={16} className="text-emerald-400 flex-shrink-0" />
        <span className="text-sm text-emerald-300 font-medium">Utility bill analyzed successfully</span>
        <button onClick={onUploadBill} className="ml-auto text-xs text-slate-400 hover:text-white flex items-center gap-1 transition-colors">
          <Upload size={11} /> Re-upload
        </button>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          {
            icon: <Zap size={14} className="text-amber-400" />,
            label: 'Annual Usage',
            value: `${bill.annualKwh.toLocaleString()} kWh`,
            sub: `${bill.averageMonthlyKwh.toLocaleString()} kWh/mo avg`,
            color: 'text-amber-400',
          },
          {
            icon: <DollarSign size={14} className="text-emerald-400" />,
            label: 'Annual Bill',
            value: `$${bill.annualBill.toLocaleString()}`,
            sub: `$${bill.averageMonthlyBill.toLocaleString()}/mo avg`,
            color: 'text-emerald-400',
          },
          {
            icon: <TrendingUp size={14} className="text-blue-400" />,
            label: 'Utility Rate',
            value: `$${bill.utilityRate.toFixed(3)}/kWh`,
            sub: project.utilityName || 'Utility detected',
            color: 'text-blue-400',
          },
          {
            icon: <BarChart2 size={14} className="text-purple-400" />,
            label: 'Peak Month',
            value: MONTHS[peakMonth],
            sub: `${maxKwh.toLocaleString()} kWh`,
            color: 'text-purple-400',
          },
        ].map(m => (
          <div key={m.label} className="card p-4 space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              {m.icon} {m.label}
            </div>
            <div className={`text-lg font-bold ${m.color}`}>{m.value}</div>
            <div className="text-xs text-slate-500">{m.sub}</div>
          </div>
        ))}
      </div>

      {/* Monthly usage chart */}
      <div className="card p-5">
        <h4 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <BarChart2 size={14} className="text-amber-400" /> Monthly Usage (kWh)
        </h4>
        <div className="flex items-end gap-1.5 h-28">
          {bill.monthlyKwh.map((kwh, i) => {
            const pct = maxKwh > 0 ? (kwh / maxKwh) * 100 : 0;
            const isPeak = i === peakMonth;
            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full relative group" style={{ height: '88px' }}>
                  <div
                    className={`absolute bottom-0 w-full rounded-t transition-all ${isPeak ? 'bg-amber-400' : 'bg-amber-500/40 group-hover:bg-amber-500/60'}`}
                    style={{ height: `${pct}%` }}
                  />
                  {/* Tooltip */}
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block z-10">
                    <div className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white whitespace-nowrap shadow-lg">
                      {kwh.toLocaleString()} kWh
                    </div>
                  </div>
                </div>
                <span className="text-xs text-slate-500">{MONTHS[i].slice(0, 1)}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Utility info */}
      {project.utilityName && (
        <div className="card p-4">
          <h4 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <FileText size={14} className="text-blue-400" /> Utility Provider
          </h4>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs text-slate-500 mb-0.5">Provider</div>
              <div className="text-white font-medium">{project.utilityName}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500 mb-0.5">Rate</div>
              <div className="text-white font-medium">${(project.utilityRatePerKwh || bill.utilityRate).toFixed(3)}/kWh</div>
            </div>
            {project.stateCode && (
              <div>
                <div className="text-xs text-slate-500 mb-0.5">State</div>
                <div className="text-white font-medium">{project.stateCode}</div>
              </div>
            )}
            <div>
              <div className="text-xs text-slate-500 mb-0.5">Offset Target</div>
              <div className="text-white font-medium">{bill.offsetTarget || 100}%</div>
            </div>
          </div>
        </div>
      )}

      {/* Re-upload CTA */}
      <div className="flex justify-end">
        <button onClick={onUploadBill} className="btn-secondary btn-sm flex items-center gap-1.5">
          <Upload size={13} /> Upload New Bill
        </button>
      </div>
    </div>
  );
}