'use client';
import React, { useState } from 'react';
import { Upload, FileText, Zap, DollarSign, TrendingUp, AlertTriangle, CheckCircle, BarChart2, Pencil, Save, X, RefreshCw } from 'lucide-react';
import type { Project } from '@/types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface BillTabProps {
  project: Project;
  onUploadBill: () => void;
  /** Called after user saves manual edits to bill data — parent should refresh project state */
  onBillUpdate?: (updated: Partial<Project>) => void;
}

export default function BillTab({ project, onUploadBill, onBillUpdate }: BillTabProps) {
  const bill = project.billAnalysis;
  const hasBill = !!bill;

  // ── Edit mode state ────────────────────────────────────────────────────────
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Editable fields — initialised from bill data when edit mode opens
  const [editAnnualKwh, setEditAnnualKwh] = useState('');
  const [editUtilityRate, setEditUtilityRate] = useState('');
  const [editUtilityName, setEditUtilityName] = useState('');

  const openEdit = () => {
    setEditAnnualKwh(String(bill?.annualKwh ?? ''));
    setEditUtilityRate(String(bill?.utilityRate ?? project.utilityRatePerKwh ?? ''));
    setEditUtilityName(project.utilityName ?? '');
    setSaveError(null);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setSaveError(null);
  };

  const handleSave = async () => {
    if (!bill) return;
    const annualKwh = parseFloat(editAnnualKwh);
    const utilityRate = parseFloat(editUtilityRate);
    if (isNaN(annualKwh) || annualKwh <= 0) { setSaveError('Annual kWh must be a positive number.'); return; }
    if (isNaN(utilityRate) || utilityRate <= 0) { setSaveError('Utility rate must be a positive number (e.g. 0.14).'); return; }

    setSaving(true);
    setSaveError(null);
    try {
      // Build updated billAnalysis by merging edits over existing data
      const updatedBillAnalysis = {
        ...bill,
        annualKwh,
        utilityRate,
        averageMonthlyKwh: Math.round(annualKwh / 12),
        annualBill: Math.round(annualKwh * utilityRate),
        averageMonthlyBill: Math.round((annualKwh * utilityRate) / 12),
      };

      const res = await fetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          billAnalysis: updatedBillAnalysis,
          utilityRatePerKwh: utilityRate,
          utilityName: editUtilityName.trim() || project.utilityName,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setSaveError(data.error || 'Failed to save changes.');
        return;
      }

      // Notify parent to refresh project state
      onBillUpdate?.({
        billAnalysis: updatedBillAnalysis,
        utilityRatePerKwh: utilityRate,
        utilityName: editUtilityName.trim() || project.utilityName,
      });

      setEditing(false);
    } catch {
      setSaveError('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  };

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
  const effectiveRate = (bill.utilityRate && bill.utilityRate > 0)
    ? bill.utilityRate
    : (project.utilityRatePerKwh && project.utilityRatePerKwh > 0)
      ? project.utilityRatePerKwh
      : 0;
  const effectiveAnnualBill = (bill.annualBill && bill.annualBill > 0)
    ? bill.annualBill
    : (effectiveRate > 0 && bill.annualKwh && bill.annualKwh > 0)
      ? Math.round(bill.annualKwh * effectiveRate)
      : 0;
  const effectiveMonthlyBill = (bill.averageMonthlyBill && bill.averageMonthlyBill > 0)
    ? bill.averageMonthlyBill
    : Math.round(effectiveAnnualBill / 12);

  const monthlyKwh = Array.isArray(bill.monthlyKwh) && bill.monthlyKwh.length > 0
    ? bill.monthlyKwh
    : Array(12).fill(bill.averageMonthlyKwh || Math.round((bill.annualKwh || 0) / 12));
  const maxKwh = monthlyKwh.length > 0 ? Math.max(...monthlyKwh) : 0;
  const peakMonth = (bill.peakMonth != null && bill.peakMonth >= 0 && bill.peakMonth < 12)
    ? bill.peakMonth
    : (maxKwh > 0 ? monthlyKwh.indexOf(maxKwh) : 0);

  return (
    <div className="space-y-5">
      {/* Status banner */}
      <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
        <CheckCircle size={16} className="text-emerald-400 flex-shrink-0" />
        <span className="text-sm text-emerald-300 font-medium">Utility bill analyzed successfully</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={editing ? cancelEdit : openEdit}
            className="text-xs text-slate-400 hover:text-white flex items-center gap-1 transition-colors"
            title={editing ? 'Cancel editing' : 'Edit extracted values'}
          >
            {editing ? <><X size={11} /> Cancel</> : <><Pencil size={11} /> Edit</>}
          </button>
          {!editing && (
            <button onClick={onUploadBill} className="text-xs text-slate-400 hover:text-white flex items-center gap-1 transition-colors">
              <Upload size={11} /> Re-upload
            </button>
          )}
        </div>
      </div>

      {/* ── Inline Edit Form ── */}
      {editing && (
        <div className="card p-5 border border-amber-500/30 bg-amber-500/5">
          <h4 className="text-sm font-semibold text-amber-300 mb-4 flex items-center gap-2">
            <Pencil size={14} /> Correct Bill Data
          </h4>
          <p className="text-xs text-slate-400 mb-4">
            If the AI extracted incorrect values, you can fix them here. Changes will update system sizing and financial calculations.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">Annual Usage (kWh)</label>
              <input
                type="number"
                value={editAnnualKwh}
                onChange={e => setEditAnnualKwh(e.target.value)}
                className="input w-full"
                placeholder="e.g. 12000"
                min="1"
                step="100"
              />
              <p className="text-xs text-slate-600 mt-1">Total kWh used per year</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">Utility Rate ($/kWh)</label>
              <input
                type="number"
                value={editUtilityRate}
                onChange={e => setEditUtilityRate(e.target.value)}
                className="input w-full"
                placeholder="e.g. 0.14"
                min="0.01"
                step="0.001"
              />
              <p className="text-xs text-slate-600 mt-1">Average cost per kWh</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">Utility Provider</label>
              <input
                type="text"
                value={editUtilityName}
                onChange={e => setEditUtilityName(e.target.value)}
                className="input w-full"
                placeholder="e.g. Pacific Gas & Electric"
              />
              <p className="text-xs text-slate-600 mt-1">Electric utility company name</p>
            </div>
          </div>

          {/* Live preview of computed values */}
          {editAnnualKwh && editUtilityRate && !isNaN(parseFloat(editAnnualKwh)) && !isNaN(parseFloat(editUtilityRate)) && (
            <div className="grid grid-cols-3 gap-2 text-xs mb-4 p-3 bg-slate-800/60 rounded-xl">
              <div className="text-center">
                <div className="text-slate-400">Monthly Avg</div>
                <div className="text-white font-bold">{Math.round(parseFloat(editAnnualKwh) / 12).toLocaleString()} kWh</div>
              </div>
              <div className="text-center">
                <div className="text-slate-400">Annual Bill</div>
                <div className="text-emerald-400 font-bold">${Math.round(parseFloat(editAnnualKwh) * parseFloat(editUtilityRate)).toLocaleString()}</div>
              </div>
              <div className="text-center">
                <div className="text-slate-400">Monthly Bill</div>
                <div className="text-emerald-400 font-bold">${Math.round((parseFloat(editAnnualKwh) * parseFloat(editUtilityRate)) / 12).toLocaleString()}/mo</div>
              </div>
            </div>
          )}

          {saveError && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs mb-3">
              <AlertTriangle size={13} /> {saveError}
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <button onClick={cancelEdit} disabled={saving} className="btn-secondary btn-sm flex items-center gap-1.5">
              <X size={13} /> Cancel
            </button>
            <button onClick={handleSave} disabled={saving} className="btn-primary btn-sm flex items-center gap-1.5">
              {saving ? <><RefreshCw size={13} className="animate-spin" /> Saving…</> : <><Save size={13} /> Save Changes</>}
            </button>
          </div>
        </div>
      )}

      {/* Key metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          {
            icon: <Zap size={14} className="text-amber-400" />,
            label: 'Annual Usage',
            value: `${(bill.annualKwh ?? 0).toLocaleString()} kWh`,
            sub: `${(bill.averageMonthlyKwh ?? Math.round((bill.annualKwh ?? 0) / 12)).toLocaleString()} kWh/mo avg`,
            color: 'text-amber-400',
          },
          {
            icon: <DollarSign size={14} className="text-emerald-400" />,
            label: 'Annual Bill',
            value: `$${effectiveAnnualBill.toLocaleString()}`,
            sub: `$${effectiveMonthlyBill.toLocaleString()}/mo avg`,
            color: 'text-emerald-400',
          },
          {
            icon: <TrendingUp size={14} className="text-blue-400" />,
            label: 'Utility Rate',
            value: `$${effectiveRate.toFixed(3)}/kWh`,
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
          {monthlyKwh.map((kwh, i) => {
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
              <div className="text-white font-medium">${effectiveRate.toFixed(3)}/kWh</div>
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