'use client';

import React, { useState, useCallback, useRef } from 'react';
import {
  Upload, FileText, Zap, MapPin, DollarSign, CheckCircle,
  AlertCircle, ArrowRight, RefreshCw, Building2, Loader2,
  TrendingUp, Sun, X, ChevronRight, Info,
} from 'lucide-react';

interface BillData {
  customerName?: string;
  serviceAddress?: string;
  utilityProvider?: string;
  accountNumber?: string;
  monthlyKwh?: number;
  annualKwh?: number;
  electricityRate?: number;
  totalAmount?: number;
  estimatedAnnualKwh?: number;
  estimatedMonthlyBill?: number;
  confidence: 'high' | 'medium' | 'low';
  extractedFields: string[];
}

interface LocationData {
  city: string;
  county: string;
  state: string;
  stateCode: string;
  zip: string;
  lat: number;
  lng: number;
}

interface UtilityData {
  utilityName: string;
  avgRatePerKwh: number;
  netMeteringEligible: boolean;
  netMeteringPolicy: string;
  netMeteringMaxKw: number;
}

interface SystemSizing {
  recommendedKw: number;
  annualKwh: number;
  offsetPercent: number;
}

interface UploadResult {
  billData: BillData;
  locationData?: LocationData;
  utilityData?: UtilityData;
  systemSizing?: SystemSizing;
  validation: { valid: boolean; warnings: string[]; errors: string[] };
}

interface BillUploadFlowProps {
  onComplete?: (result: UploadResult & { systemKw: number; offsetPercent: number }) => void;
  onClose?: () => void;
  className?: string;
}

type Step = 'upload' | 'review' | 'sizing' | 'complete';

export default function BillUploadFlow({ onComplete, onClose, className = '' }: BillUploadFlowProps) {
  const [step, setStep] = useState<Step>('upload');
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [systemKw, setSystemKw] = useState<number>(0);
  const [offsetPercent, setOffsetPercent] = useState(100);
  const [manualKwh, setManualKwh] = useState('');
  const [manualAddress, setManualAddress] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── File upload handler ───────────────────────────────────────────────────
  const handleFile = useCallback(async (file: File) => {
    setError(null);
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/bill-upload', { method: 'POST', body: formData });
      const data = await res.json();

      if (!data.success) {
        setError(data.error || 'Failed to process bill');
        setUploading(false);
        return;
      }

      setResult(data);
      setSystemKw(data.systemSizing?.recommendedKw || 0);
      setStep('review');
    } catch (err: any) {
      setError(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  }, []);

  // ── Manual entry handler ──────────────────────────────────────────────────
  const handleManualEntry = useCallback(async () => {
    if (!manualKwh || !manualAddress) {
      setError('Please enter your monthly kWh usage and service address');
      return;
    }
    setError(null);
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append('text', `
        Service Address: ${manualAddress}
        Monthly Usage: ${manualKwh} kWh
        Annual Usage: ${parseFloat(manualKwh) * 12} kWh
      `);

      const res = await fetch('/api/bill-upload', { method: 'POST', body: formData });
      const data = await res.json();

      if (data.success) {
        // Override with manual values
        if (data.billData) {
          data.billData.monthlyKwh = parseFloat(manualKwh);
          data.billData.estimatedAnnualKwh = parseFloat(manualKwh) * 12;
        }
        setResult(data);
        setSystemKw(data.systemSizing?.recommendedKw || 0);
        setStep('review');
      } else {
        setError(data.error || 'Could not process address');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }, [manualKwh, manualAddress]);

  // ── Drag & drop ───────────────────────────────────────────────────────────
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  // ── Recalculate system size ───────────────────────────────────────────────
  const recalcSize = useCallback(async () => {
    if (!result?.billData?.estimatedAnnualKwh || !result?.locationData) return;
    setUploading(true);
    try {
      const res = await fetch('/api/auto-size', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          annualKwh: result.billData.estimatedAnnualKwh,
          lat: result.locationData.lat,
          lng: result.locationData.lng,
          stateCode: result.locationData.stateCode,
          offsetPercent,
        }),
      });
      const data = await res.json();
      if (data.success) setSystemKw(data.recommendedKw);
    } catch {}
    setUploading(false);
  }, [result, offsetPercent]);

  const confidenceColor = (c: string) =>
    c === 'high' ? 'text-emerald-400' : c === 'medium' ? 'text-amber-400' : 'text-red-400';

  const confidenceBg = (c: string) =>
    c === 'high' ? 'bg-emerald-500/10 border-emerald-500/20' :
    c === 'medium' ? 'bg-amber-500/10 border-amber-500/20' :
    'bg-red-500/10 border-red-500/20';

  return (
    <div className={`bg-slate-900 rounded-2xl border border-slate-700/50 overflow-hidden ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/50 bg-slate-800/50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <Zap size={16} className="text-amber-400" />
          </div>
          <div>
            <h2 className="text-white font-bold text-sm">Smart Bill Upload</h2>
            <p className="text-slate-400 text-xs">Upload your electric bill to auto-generate a solar proposal</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Step indicators */}
          {(['upload', 'review', 'sizing', 'complete'] as Step[]).map((s, i) => (
            <div key={s} className="flex items-center gap-1">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                step === s ? 'bg-amber-500 text-black' :
                ['upload', 'review', 'sizing', 'complete'].indexOf(step) > i
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'bg-slate-700 text-slate-500'
              }`}>{i + 1}</div>
              {i < 3 && <div className={`w-4 h-px ${['upload', 'review', 'sizing', 'complete'].indexOf(step) > i ? 'bg-emerald-500/50' : 'bg-slate-700'}`} />}
            </div>
          ))}
          {onClose && (
            <button onClick={onClose} className="ml-2 text-slate-400 hover:text-white transition-colors">
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="p-6">
        {/* ── STEP 1: Upload ── */}
        {step === 'upload' && (
          <div className="space-y-4">
            {/* Drop zone */}
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                dragging
                  ? 'border-amber-400 bg-amber-500/5'
                  : 'border-slate-600 hover:border-slate-500 hover:bg-slate-800/50'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                className="hidden"
                onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
              {uploading ? (
                <div className="flex flex-col items-center gap-3">
                  <Loader2 size={32} className="text-amber-400 animate-spin" />
                  <p className="text-white font-medium">Processing your bill...</p>
                  <p className="text-slate-400 text-sm">Extracting usage data and detecting utility</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <div className="w-14 h-14 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center">
                    <Upload size={24} className="text-slate-400" />
                  </div>
                  <div>
                    <p className="text-white font-semibold">Drop your electric bill here</p>
                    <p className="text-slate-400 text-sm mt-1">PDF, JPG, or PNG — we'll extract everything automatically</p>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-slate-500">
                    <span className="flex items-center gap-1"><FileText size={12} /> PDF</span>
                    <span className="flex items-center gap-1"><FileText size={12} /> JPG</span>
                    <span className="flex items-center gap-1"><FileText size={12} /> PNG</span>
                  </div>
                </div>
              )}
            </div>

            {/* What we extract */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { icon: <Zap size={14} className="text-amber-400" />, label: 'kWh Usage', desc: 'Monthly & annual' },
                { icon: <Building2 size={14} className="text-blue-400" />, label: 'Utility Provider', desc: 'Auto-detected' },
                { icon: <MapPin size={14} className="text-emerald-400" />, label: 'Service Address', desc: 'Location data' },
              ].map(item => (
                <div key={item.label} className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
                  <div className="flex items-center gap-2 mb-1">{item.icon}<span className="text-white text-xs font-medium">{item.label}</span></div>
                  <p className="text-slate-400 text-xs">{item.desc}</p>
                </div>
              ))}
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-slate-700" />
              <span className="text-slate-500 text-xs">or enter manually</span>
              <div className="flex-1 h-px bg-slate-700" />
            </div>

            {/* Manual entry */}
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 text-xs mb-1 block">Monthly kWh Usage</label>
                  <input
                    type="number"
                    value={manualKwh}
                    onChange={e => setManualKwh(e.target.value)}
                    placeholder="e.g. 1200"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500/50"
                  />
                </div>
                <div>
                  <label className="text-slate-400 text-xs mb-1 block">Service Address</label>
                  <input
                    type="text"
                    value={manualAddress}
                    onChange={e => setManualAddress(e.target.value)}
                    placeholder="123 Main St, City, ST 12345"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500/50"
                  />
                </div>
              </div>
              <button
                onClick={handleManualEntry}
                disabled={uploading || !manualKwh || !manualAddress}
                className="w-full btn-secondary py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {uploading ? <Loader2 size={14} className="animate-spin inline mr-2" /> : null}
                Continue with Manual Entry
              </button>
            </div>

            {error && (
              <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                <AlertCircle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-red-300 text-sm">{error}</p>
              </div>
            )}
          </div>
        )}

        {/* ── STEP 2: Review extracted data ── */}
        {step === 'review' && result && (
          <div className="space-y-4">
            {/* Confidence badge */}
            <div className={`flex items-center gap-2 rounded-lg px-3 py-2 border text-sm ${confidenceBg(result.billData.confidence)}`}>
              <Info size={14} className={confidenceColor(result.billData.confidence)} />
              <span className={confidenceColor(result.billData.confidence)}>
                Extraction confidence: <strong>{result.billData.confidence}</strong>
                {' '}— {result.billData.extractedFields.length} fields extracted
              </span>
            </div>

            {/* Extracted data grid */}
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Customer Name', value: result.billData.customerName, icon: <Building2 size={13} className="text-slate-400" /> },
                { label: 'Service Address', value: result.billData.serviceAddress || result.locationData?.city + ', ' + result.locationData?.stateCode, icon: <MapPin size={13} className="text-slate-400" /> },
                { label: 'Utility Provider', value: result.billData.utilityProvider || result.utilityData?.utilityName, icon: <Zap size={13} className="text-amber-400" /> },
                { label: 'Monthly kWh', value: result.billData.monthlyKwh ? `${result.billData.monthlyKwh.toLocaleString()} kWh` : null, icon: <TrendingUp size={13} className="text-blue-400" /> },
                { label: 'Annual kWh', value: result.billData.estimatedAnnualKwh ? `${result.billData.estimatedAnnualKwh.toLocaleString()} kWh` : null, icon: <Sun size={13} className="text-amber-400" /> },
                { label: 'Electricity Rate', value: result.billData.electricityRate ? `$${result.billData.electricityRate.toFixed(3)}/kWh` : result.utilityData?.avgRatePerKwh ? `$${result.utilityData.avgRatePerKwh.toFixed(3)}/kWh (avg)` : null, icon: <DollarSign size={13} className="text-emerald-400" /> },
                { label: 'Monthly Bill', value: result.billData.estimatedMonthlyBill ? `$${result.billData.estimatedMonthlyBill.toFixed(0)}` : null, icon: <DollarSign size={13} className="text-red-400" /> },
                { label: 'Net Metering', value: result.utilityData?.netMeteringEligible ? '✓ Eligible' : result.utilityData ? '✗ Check utility' : null, icon: <CheckCircle size={13} className="text-emerald-400" /> },
              ].filter(f => f.value).map(field => (
                <div key={field.label} className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
                  <div className="flex items-center gap-1.5 mb-1">{field.icon}<span className="text-slate-400 text-xs">{field.label}</span></div>
                  <p className="text-white text-sm font-medium truncate">{field.value}</p>
                </div>
              ))}
            </div>

            {/* Location data */}
            {result.locationData && (
              <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <MapPin size={13} className="text-blue-400" />
                  <span className="text-blue-300 text-xs font-medium">Location Detected</span>
                </div>
                <p className="text-white text-sm">
                  {result.locationData.city}, {result.locationData.county ? `${result.locationData.county} County, ` : ''}{result.locationData.state} {result.locationData.zip}
                </p>
                <p className="text-slate-400 text-xs mt-1">
                  {result.locationData.lat.toFixed(4)}°N, {Math.abs(result.locationData.lng).toFixed(4)}°W
                </p>
              </div>
            )}

            {/* Warnings */}
            {result.validation.warnings.length > 0 && (
              <div className="space-y-1">
                {result.validation.warnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-2 bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2">
                    <AlertCircle size={12} className="text-amber-400 flex-shrink-0 mt-0.5" />
                    <p className="text-amber-300 text-xs">{w}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={() => setStep('upload')} className="btn-secondary flex-1 py-2 text-sm">
                ← Re-upload
              </button>
              <button onClick={() => setStep('sizing')} className="btn-primary flex-1 py-2 text-sm">
                Continue to Sizing <ArrowRight size={14} className="inline ml-1" />
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3: System Sizing ── */}
        {step === 'sizing' && result && (
          <div className="space-y-4">
            <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
              <h3 className="text-white font-semibold text-sm mb-3 flex items-center gap-2">
                <Sun size={15} className="text-amber-400" /> Recommended System Size
              </h3>

              {/* System size slider */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 text-xs">System Size</span>
                  <span className="text-amber-400 font-bold text-lg">{systemKw.toFixed(1)} kW</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={50}
                  step={0.1}
                  value={systemKw}
                  onChange={e => setSystemKw(parseFloat(e.target.value))}
                  className="w-full accent-amber-500"
                />
                <div className="flex justify-between text-xs text-slate-500">
                  <span>1 kW</span>
                  <span>50 kW</span>
                </div>
              </div>

              {/* Offset slider */}
              <div className="space-y-3 mt-4">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 text-xs">Offset Target</span>
                  <span className="text-emerald-400 font-bold">{offsetPercent}%</span>
                </div>
                <input
                  type="range"
                  min={50}
                  max={120}
                  step={5}
                  value={offsetPercent}
                  onChange={e => setOffsetPercent(parseInt(e.target.value))}
                  className="w-full accent-emerald-500"
                />
                <div className="flex justify-between text-xs text-slate-500">
                  <span>50%</span>
                  <span>120%</span>
                </div>
              </div>

              <button
                onClick={recalcSize}
                disabled={uploading}
                className="mt-3 w-full btn-secondary py-2 text-xs"
              >
                {uploading ? <Loader2 size={12} className="animate-spin inline mr-1" /> : <RefreshCw size={12} className="inline mr-1" />}
                Recalculate with PVWatts
              </button>
            </div>

            {/* Quick estimates */}
            <div className="grid grid-cols-3 gap-3">
              {[
                {
                  label: 'Panel Count',
                  value: `${Math.ceil(systemKw * 1000 / 430)}`,
                  sub: '430W panels',
                  color: 'text-blue-400',
                },
                {
                  label: 'Est. Annual kWh',
                  value: `${Math.round(systemKw * 1400).toLocaleString()}`,
                  sub: 'production',
                  color: 'text-amber-400',
                },
                {
                  label: 'Est. System Cost',
                  value: `$${Math.round(systemKw * 2850).toLocaleString()}`,
                  sub: 'before incentives',
                  color: 'text-emerald-400',
                },
              ].map(item => (
                <div key={item.label} className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50 text-center">
                  <p className={`text-lg font-bold ${item.color}`}>{item.value}</p>
                  <p className="text-white text-xs font-medium">{item.label}</p>
                  <p className="text-slate-500 text-xs">{item.sub}</p>
                </div>
              ))}
            </div>

            <div className="flex gap-3">
              <button onClick={() => setStep('review')} className="btn-secondary flex-1 py-2 text-sm">
                ← Back
              </button>
              <button
                onClick={() => {
                  setStep('complete');
                  onComplete?.({ ...result, systemKw, offsetPercent });
                }}
                className="btn-primary flex-1 py-2 text-sm"
              >
                Generate Proposal <ArrowRight size={14} className="inline ml-1" />
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 4: Complete ── */}
        {step === 'complete' && (
          <div className="text-center py-6 space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto">
              <CheckCircle size={32} className="text-emerald-400" />
            </div>
            <div>
              <h3 className="text-white font-bold text-lg">Ready to Design!</h3>
              <p className="text-slate-400 text-sm mt-1">
                Your {systemKw.toFixed(1)} kW system has been configured.
                Generating your solar design and proposal...
              </p>
            </div>
            <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50 text-left space-y-2">
              {[
                `✓ Utility detected: ${result?.utilityData?.utilityName || result?.billData?.utilityProvider || 'Auto-detected'}`,
                `✓ Location: ${result?.locationData?.city || 'Detected'}, ${result?.locationData?.stateCode || ''}`,
                `✓ System size: ${systemKw.toFixed(1)} kW (${Math.ceil(systemKw * 1000 / 430)} panels)`,
                `✓ Annual production: ~${Math.round(systemKw * 1400).toLocaleString()} kWh`,
                `✓ Incentives: Federal ITC + state incentives applied`,
              ].map((item, i) => (
                <p key={i} className="text-emerald-300 text-sm">{item}</p>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}