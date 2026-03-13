'use client';

import React, { useState, useCallback, useRef } from 'react';
import {
  Upload, FileText, Zap, MapPin, DollarSign, CheckCircle,
  AlertCircle, ArrowRight, RefreshCw, Building2, Loader2,
  TrendingUp, Sun, X, Info, BarChart2, Flame,
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
  billType?: 'electric' | 'gas' | 'combined' | 'unknown';
  monthlyUsageHistory?: number[];
  tier1Kwh?: number;
  tier2Kwh?: number;
  tier1Rate?: number;
  tier2Rate?: number;
  demandCharge?: number;
  demandKw?: number;
  gasUsageTherm?: number;
  fixedCharges?: number;
  usedLlmFallback?: boolean;
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

// Processing stages shown during upload
type ProcessingStage = 'uploading' | 'extracting' | 'parsing' | 'geocoding' | 'sizing' | 'done';

const STAGE_LABELS: Record<ProcessingStage, string> = {
  uploading:  'Uploading file...',
  extracting: 'Extracting text from bill...',
  parsing:    'Parsing usage data...',
  geocoding:  'Detecting location...',
  sizing:     'Calculating system size...',
  done:       'Complete!',
};

const STAGE_ORDER: ProcessingStage[] = ['uploading', 'extracting', 'parsing', 'geocoding', 'sizing', 'done'];

const MAX_FILE_SIZE_MB = 10;
const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
const ACCEPTED_EXTS = ['.pdf', '.jpg', '.jpeg', '.png'];

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function validateFile(file: File): string | null {
  if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    return `File is too large (${formatFileSize(file.size)}). Maximum size is ${MAX_FILE_SIZE_MB} MB.`;
  }
  const ext = '.' + file.name.split('.').pop()?.toLowerCase();
  const typeOk = ACCEPTED_TYPES.includes(file.type) || ACCEPTED_EXTS.includes(ext);
  if (!typeOk) {
    return `Unsupported file type. Please upload a PDF, JPG, or PNG.`;
  }
  return null;
}

export default function BillUploadFlow({ onComplete, onClose, className = '' }: BillUploadFlowProps) {
  const [step, setStep] = useState<Step>('upload');
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [processingStage, setProcessingStage] = useState<ProcessingStage>('uploading');
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [systemKw, setSystemKw] = useState<number>(0);
  const [offsetPercent, setOffsetPercent] = useState(100);
  const [manualKwh, setManualKwh] = useState('');
  const [manualAddress, setManualAddress] = useState('');
  const [selectedFile, setSelectedFile] = useState<{ name: string; size: number; type: string } | null>(null);
  const [lastFile, setLastFile] = useState<File | null>(null); // for retry
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Simulate stage progression during upload ──────────────────────────────
  // Phase 1 (bill-upload): uploading → extracting → parsing  (~0-5s)
  // Phase 2 (system-size): geocoding → sizing                (~5-10s)
  const runUploadStageSimulation = useCallback(() => {
    const delays: [ProcessingStage, number][] = [
      ['uploading',  300],
      ['extracting', 800],
      ['parsing',    2500],
    ];
    const timers: ReturnType<typeof setTimeout>[] = [];
    delays.forEach(([stage, ms]) => {
      timers.push(setTimeout(() => setProcessingStage(stage), ms));
    });
    return () => timers.forEach(clearTimeout);
  }, []);

  const runSystemSizing = useCallback(async (billData: any, uploadResult: any) => {
    setProcessingStage('geocoding');
    try {
      const sizingRes = await fetch('/api/system-size', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          annual_kwh: billData.estimatedAnnualKwh || billData.annualKwh || null,
          monthly_kwh: billData.monthlyKwh || null,
          monthly_usage: billData.monthlyUsageHistory || [],
          address: billData.serviceAddress || null,
          utility: billData.utilityProvider || null,
          rate: billData.electricityRate || null,
          offset_target: 100,
        }),
      });
      setProcessingStage('sizing');
      let sizingData: any;
      try {
        sizingData = await sizingRes.json();
      } catch {
        sizingData = { success: false };
      }
      if (sizingData.success) {
        const merged = {
          ...uploadResult,
          locationData: sizingData.locationData,
          utilityData: sizingData.utilityData,
          matchedUtility: sizingData.matchedUtility,
          rateValidation: sizingData.rateValidation,
          systemSizing: sizingData.systemSizing,
          billData: {
            ...uploadResult.billData,
            electricityRate: sizingData.rateValidation?.correctedRate ?? uploadResult.billData?.electricityRate,
            utilityProvider: sizingData.matchedUtility?.utilityName ?? uploadResult.billData?.utilityProvider,
          },
        };
        setResult(merged);
        setSystemKw(sizingData.systemSizing?.recommendedKw || 0);
      } else {
        console.warn('[BillUploadFlow] /api/system-size failed:', sizingData.error);
        setResult(uploadResult);
        setSystemKw(0);
      }
    } catch (sizingErr: unknown) {
      console.warn('[BillUploadFlow] /api/system-size threw:', sizingErr instanceof Error ? sizingErr.message : sizingErr);
      setResult(uploadResult);
      setSystemKw(0);
    }
    setProcessingStage('done');
    setTimeout(() => setStep('review'), 400);
  }, []);

  // ── File upload handler ────────────────────────────────────────────────────
  const handleFile = useCallback(async (file: File) => {
    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setUploading(true);
    setProcessingStage('uploading');
    setSelectedFile({ name: file.name, size: file.size, type: file.type });
    setLastFile(file);

    const cancelSimulation = runUploadStageSimulation();

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/bill-upload', { method: 'POST', body: formData });
      cancelSimulation();

      let data: any;
      try {
        data = await res.json();
      } catch {
        throw new Error('Server returned an invalid response. Please try again.');
      }

      if (!data.success) {
        let msg = data.error || 'Failed to process bill';
        if (res.status === 413) msg = `File too large. Please upload a file under ${MAX_FILE_SIZE_MB} MB.`;
        if (res.status === 415) msg = 'Unsupported file type. Please upload a PDF, JPG, or PNG.';
        if (res.status === 422) {
          if (data.parseEmpty) {
            msg = 'Bill text could not be extracted. Please re-upload a clearer image or enter manually.';
          } else {
            msg = data.error || 'Could not extract data from this bill. Try a clearer image or enter manually.';
          }
        }
        setError(msg);
        setUploading(false);
        setProcessingStage('uploading');
        return;
      }

      // Phase 1 complete — call /api/system-size for geocoding + sizing
      await runSystemSizing(data.billData, data);
    } catch (err: unknown) {
      cancelSimulation();
      const msg = err instanceof Error ? err.message : 'Upload failed. Please check your connection and try again.';
      setError(msg);
      setProcessingStage('uploading');
    } finally {
      setUploading(false);
    }
  }, [runUploadStageSimulation, runSystemSizing]);

  // ── Retry handler ─────────────────────────────────────────────────────────
  const handleRetry = useCallback(() => {
    setError(null);
    if (lastFile) {
      handleFile(lastFile);
    } else {
      fileInputRef.current?.click();
    }
  }, [lastFile, handleFile]);

  // ── Manual entry handler ───────────────────────────────────────────────────
  const handleManualEntry = useCallback(async () => {
    if (!manualKwh || !manualAddress) {
      setError('Please enter your monthly kWh usage and service address');
      return;
    }
    setError(null);
    setUploading(true);
    setProcessingStage('parsing');

    try {
      const formData = new FormData();
      formData.append('text', `Service Address: ${manualAddress}\nMonthly Usage: ${manualKwh} kWh\nAnnual Usage: ${parseFloat(manualKwh) * 12} kWh`);

      const res = await fetch('/api/bill-upload', { method: 'POST', body: formData });
      let data: any;
      try {
        data = await res.json();
      } catch {
        throw new Error('Server returned an invalid response. Please try again.');
      }

      if (data.success) {
        if (data.billData) {
          data.billData.monthlyKwh = parseFloat(manualKwh);
          data.billData.estimatedAnnualKwh = parseFloat(manualKwh) * 12;
          data.billData.serviceAddress = manualAddress;
        }
        await runSystemSizing(data.billData || {
          monthlyKwh: parseFloat(manualKwh),
          estimatedAnnualKwh: parseFloat(manualKwh) * 12,
          serviceAddress: manualAddress,
        }, data);
      } else {
        setError(data.error || 'Could not process address');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setUploading(false);
    }
  }, [manualKwh, manualAddress, runSystemSizing]);

  // ── Drag & drop ────────────────────────────────────────────────────────────
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  // ── Recalculate system size ────────────────────────────────────────────────
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

  // ── Processing stage indicator ─────────────────────────────────────────────
  const ProcessingIndicator = () => {
    const currentIdx = STAGE_ORDER.indexOf(processingStage);
    return (
      <div className="flex flex-col items-center gap-4 py-2">
        <Loader2 size={36} className="text-amber-400 animate-spin" />
        <div className="w-full space-y-2">
          {STAGE_ORDER.filter(s => s !== 'done').map((stage, i) => {
            const isActive = i === currentIdx;
            const isDone = i < currentIdx;
            return (
              <div key={stage} className="flex items-center gap-3">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 transition-all ${
                  isDone ? 'bg-emerald-500/20 border border-emerald-500/40' :
                  isActive ? 'bg-amber-500/20 border border-amber-500/40' :
                  'bg-slate-700/50 border border-slate-600/40'
                }`}>
                  {isDone
                    ? <CheckCircle size={11} className="text-emerald-400" />
                    : isActive
                      ? <Loader2 size={11} className="text-amber-400 animate-spin" />
                      : <div className="w-1.5 h-1.5 rounded-full bg-slate-600" />
                  }
                </div>
                <span className={`text-xs transition-all ${
                  isDone ? 'text-emerald-400' :
                  isActive ? 'text-amber-300 font-medium' :
                  'text-slate-600'
                }`}>
                  {STAGE_LABELS[stage]}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

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
              onClick={() => !uploading && fileInputRef.current?.click()}
              className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-all ${
                uploading
                  ? 'border-amber-500/40 bg-amber-500/5 cursor-default'
                  : dragging
                    ? 'border-amber-400 bg-amber-500/5 cursor-copy'
                    : 'border-slate-600 hover:border-slate-500 hover:bg-slate-800/50 cursor-pointer'
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
                <ProcessingIndicator />
              ) : selectedFile && !error ? (
                /* File preview after selection (while not uploading) */
                <div className="flex flex-col items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                    <FileText size={22} className="text-amber-400" />
                  </div>
                  <div>
                    <p className="text-white font-semibold text-sm truncate max-w-xs">{selectedFile.name}</p>
                    <p className="text-slate-400 text-xs mt-0.5">{formatFileSize(selectedFile.size)}</p>
                  </div>
                  <p className="text-slate-500 text-xs">Click to choose a different file</p>
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
                    <span className="flex items-center gap-1 text-slate-600">max {MAX_FILE_SIZE_MB} MB</span>
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

            {/* Error with retry */}
            {error && (
              <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                <AlertCircle size={15} className="text-red-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-red-300 text-sm">{error}</p>
                  {lastFile && (
                    <button
                      onClick={e => { e.stopPropagation(); handleRetry(); }}
                      className="mt-2 flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 transition-colors"
                    >
                      <RefreshCw size={11} /> Try again
                    </button>
                  )}
                </div>
              </div>
            )}

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
          </div>
        )}

        {/* ── STEP 2: Review extracted data ── */}
        {step === 'review' && result && (
          <div className="space-y-4">
            {/* File info banner */}
            {selectedFile && (
              <div className="flex items-center gap-2 bg-slate-800/50 rounded-lg px-3 py-2 border border-slate-700/50">
                <FileText size={13} className="text-slate-400 flex-shrink-0" />
                <span className="text-slate-300 text-xs truncate flex-1">{selectedFile.name}</span>
                <span className="text-slate-500 text-xs flex-shrink-0">{formatFileSize(selectedFile.size)}</span>
              </div>
            )}

            {/* Confidence badge */}
            <div className={`flex items-center gap-2 rounded-lg px-3 py-2 border text-sm ${confidenceBg(result.billData.confidence)}`}>
              <Info size={14} className={confidenceColor(result.billData.confidence)} />
              <span className={confidenceColor(result.billData.confidence)}>
                Extraction confidence: <strong>{result.billData.confidence}</strong>
                {' '}— {result.billData.extractedFields.length} fields extracted
                {result.billData.usedLlmFallback && (
                  <span className="ml-1 text-xs opacity-75">(AI-assisted)</span>
                )}
              </span>
            </div>

            {/* Bill type badge */}
            {result.billData.billType && result.billData.billType !== 'unknown' && (
              <div className="flex items-center gap-2">
                {result.billData.billType === 'gas' || result.billData.billType === 'combined' ? (
                  <span className="flex items-center gap-1.5 bg-orange-500/10 border border-orange-500/20 rounded-full px-3 py-1 text-xs text-orange-300">
                    <Flame size={11} /> {result.billData.billType === 'combined' ? 'Combined Electric + Gas Bill' : 'Gas Bill'}
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/20 rounded-full px-3 py-1 text-xs text-amber-300">
                    <Zap size={11} /> Electric Bill
                  </span>
                )}
              </div>
            )}

            {/* Extracted data grid */}
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Customer Name', value: result.billData.customerName, icon: <Building2 size={13} className="text-slate-400" /> },
                { label: 'Service Address', value: result.billData.serviceAddress || (result.locationData ? `${result.locationData.city}, ${result.locationData.stateCode}` : null), icon: <MapPin size={13} className="text-slate-400" /> },
                { label: 'Utility Provider', value: result.billData.utilityProvider || result.utilityData?.utilityName, icon: <Zap size={13} className="text-amber-400" /> },
                { label: 'Monthly kWh', value: result.billData.monthlyKwh ? `${result.billData.monthlyKwh.toLocaleString()} kWh` : null, icon: <TrendingUp size={13} className="text-blue-400" /> },
                { label: 'Annual kWh', value: result.billData.estimatedAnnualKwh ? `${result.billData.estimatedAnnualKwh.toLocaleString()} kWh` : null, icon: <Sun size={13} className="text-amber-400" /> },
                { label: 'Electricity Rate', value: result.billData.electricityRate ? `$${result.billData.electricityRate.toFixed(3)}/kWh` : result.utilityData?.avgRatePerKwh ? `$${result.utilityData.avgRatePerKwh.toFixed(3)}/kWh (avg)` : null, icon: <DollarSign size={13} className="text-emerald-400" /> },
                { label: 'Monthly Bill', value: result.billData.estimatedMonthlyBill ? `$${result.billData.estimatedMonthlyBill.toFixed(0)}` : result.billData.totalAmount ? `$${result.billData.totalAmount.toFixed(0)}` : null, icon: <DollarSign size={13} className="text-red-400" /> },
                { label: 'Net Metering', value: result.utilityData?.netMeteringEligible ? '✓ Eligible' : result.utilityData ? '✗ Check utility' : null, icon: <CheckCircle size={13} className="text-emerald-400" /> },
                // Advanced fields
                { label: 'Demand Charge', value: result.billData.demandCharge ? `$${result.billData.demandCharge.toFixed(2)}${result.billData.demandKw ? ` (${result.billData.demandKw} kW)` : ''}` : null, icon: <BarChart2 size={13} className="text-purple-400" /> },
                { label: 'Gas Usage', value: result.billData.gasUsageTherm ? `${result.billData.gasUsageTherm.toLocaleString()} therms` : null, icon: <Flame size={13} className="text-orange-400" /> },
              ].filter(f => f.value).map(field => (
                <div key={field.label} className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
                  <div className="flex items-center gap-1.5 mb-1">{field.icon}<span className="text-slate-400 text-xs">{field.label}</span></div>
                  <p className="text-white text-sm font-medium truncate">{field.value}</p>
                </div>
              ))}
            </div>

            {/* Tiered usage (if present) */}
            {(result.billData.tier1Kwh || result.billData.tier2Kwh) && (
              <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
                <p className="text-slate-400 text-xs mb-2 font-medium">Tiered Usage Breakdown</p>
                <div className="grid grid-cols-2 gap-2">
                  {result.billData.tier1Kwh && (
                    <div>
                      <p className="text-white text-sm font-medium">{result.billData.tier1Kwh.toLocaleString()} kWh</p>
                      <p className="text-slate-500 text-xs">Tier 1{result.billData.tier1Rate ? ` @ $${result.billData.tier1Rate.toFixed(4)}/kWh` : ''}</p>
                    </div>
                  )}
                  {result.billData.tier2Kwh && (
                    <div>
                      <p className="text-white text-sm font-medium">{result.billData.tier2Kwh.toLocaleString()} kWh</p>
                      <p className="text-slate-500 text-xs">Tier 2{result.billData.tier2Rate ? ` @ $${result.billData.tier2Rate.toFixed(4)}/kWh` : ''}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Monthly usage history sparkline */}
            {result.billData.monthlyUsageHistory && result.billData.monthlyUsageHistory.length >= 3 && (
              <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
                <p className="text-slate-400 text-xs mb-2 font-medium flex items-center gap-1.5">
                  <BarChart2 size={12} /> Monthly Usage History ({result.billData.monthlyUsageHistory.length} months)
                </p>
                <div className="flex items-end gap-1 h-10">
                  {result.billData.monthlyUsageHistory.map((kwh, i) => {
                    const max = Math.max(...result.billData.monthlyUsageHistory!);
                    const pct = max > 0 ? (kwh / max) * 100 : 0;
                    return (
                      <div
                        key={i}
                        title={`${kwh.toLocaleString()} kWh`}
                        className="flex-1 bg-amber-500/40 hover:bg-amber-500/60 rounded-sm transition-colors cursor-default"
                        style={{ height: `${Math.max(pct, 8)}%` }}
                      />
                    );
                  })}
                </div>
                <div className="flex justify-between text-xs text-slate-600 mt-1">
                  <span>min: {Math.min(...result.billData.monthlyUsageHistory).toLocaleString()} kWh</span>
                  <span>max: {Math.max(...result.billData.monthlyUsageHistory).toLocaleString()} kWh</span>
                </div>
              </div>
            )}

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

            {/* Errors */}
            {result.validation.errors.length > 0 && (
              <div className="space-y-1">
                {result.validation.errors.map((e, i) => (
                  <div key={i} className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                    <AlertCircle size={12} className="text-red-400 flex-shrink-0 mt-0.5" />
                    <p className="text-red-300 text-xs">{e}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => { setStep('upload'); setSelectedFile(null); setError(null); }}
                className="btn-secondary flex-1 py-2 text-sm"
              >
                ← Re-upload
              </button>
              <button
                onClick={() => setStep('sizing')}
                disabled={result.validation.errors.length > 0}
                className="btn-primary flex-1 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
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