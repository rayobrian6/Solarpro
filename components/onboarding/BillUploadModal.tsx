'use client';

import React, { useState, useCallback, useRef } from 'react';
import {
  Upload, FileText, Zap, MapPin, DollarSign, CheckCircle,
  AlertCircle, ArrowRight, RefreshCw, Building2, Loader2,
  TrendingUp, Sun, X, Info, BarChart2, Flame, User, FolderOpen,
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
  extractionMethod?: string;
}

interface CreatedEntities {
  clientId: string;
  clientName: string;
  projectId: string;
  projectName: string;
  proposalId?: string;
}

interface BillUploadModalProps {
  onClose: () => void;
  onComplete?: (entities: CreatedEntities) => void;
}

type Step = 'upload' | 'review' | 'creating' | 'done';
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
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function validateFile(file: File): string | null {
  if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    return `File too large (${formatFileSize(file.size)}). Max ${MAX_FILE_SIZE_MB} MB.`;
  }
  const ext = '.' + file.name.split('.').pop()?.toLowerCase();
  if (!ACCEPTED_TYPES.includes(file.type) && !ACCEPTED_EXTS.includes(ext)) {
    return 'Unsupported file type. Please upload PDF, JPG, or PNG.';
  }
  return null;
}

export default function BillUploadModal({ onClose, onComplete }: BillUploadModalProps) {
  const [step, setStep] = useState<Step>('upload');
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [processingStage, setProcessingStage] = useState<ProcessingStage>('uploading');
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [systemKw, setSystemKw] = useState<number>(0);
  const [offsetPercent, setOffsetPercent] = useState(100);
  const [selectedFile, setSelectedFile] = useState<{ name: string; size: number } | null>(null);
  const [lastFile, setLastFile] = useState<File | null>(null);
  const [manualKwh, setManualKwh] = useState('');
  const [manualAddress, setManualAddress] = useState('');
  const [creatingStatus, setCreatingStatus] = useState<string[]>([]);
  const [created, setCreated] = useState<CreatedEntities | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Stage simulation ──────────────────────────────────────────────────────
  const runStageSimulation = useCallback(() => {
    const delays: [ProcessingStage, number][] = [
      ['uploading', 300], ['extracting', 1800], ['parsing', 3500],
      ['geocoding', 5200], ['sizing', 6800],
    ];
    const timers = delays.map(([stage, ms]) => setTimeout(() => setProcessingStage(stage), ms));
    return () => timers.forEach(clearTimeout);
  }, []);

  // ── File upload ───────────────────────────────────────────────────────────
  const handleFile = useCallback(async (file: File) => {
    const validErr = validateFile(file);
    if (validErr) { setError(validErr); return; }

    setError(null);
    setUploading(true);
    setProcessingStage('uploading');
    setSelectedFile({ name: file.name, size: file.size });
    setLastFile(file);

    const cancelSim = runStageSimulation();
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/bill-upload', { method: 'POST', body: formData });
      cancelSim();
      const data = await res.json();

      if (!data.success) {
        let msg = data.error || 'Failed to process bill';
        if (res.status === 413) msg = `File too large. Max ${MAX_FILE_SIZE_MB} MB.`;
        if (res.status === 415) msg = 'Unsupported file type.';
        if (res.status === 500) msg = `Server error: ${data.error || 'Unknown'}`;
        if (data.stage) msg += ` [stage: ${data.stage}]`;
        if (data.debug) {
          const d = data.debug;
          msg += ` | AI:${d.hasOpenAI ? 'yes' : 'NO'} PDF-parse:${d.pdfParseLoaded ? 'yes' : 'no'}`;
        }
        setError(msg);
        setProcessingStage('uploading');
        return;
      }

      setProcessingStage('done');
      setResult(data);
      setSystemKw(data.systemSizing?.recommendedKw || 0);
      setTimeout(() => setStep('review'), 400);
    } catch (err: unknown) {
      cancelSim();
      setError(err instanceof Error ? err.message : 'Upload failed. Check your connection.');
      setProcessingStage('uploading');
    } finally {
      setUploading(false);
    }
  }, [runStageSimulation]);

  // ── Manual entry ──────────────────────────────────────────────────────────
  const handleManualEntry = useCallback(async () => {
    if (!manualKwh || !manualAddress) {
      setError('Please enter monthly kWh usage and service address');
      return;
    }
    setError(null);
    setUploading(true);
    setProcessingStage('geocoding');
    try {
      const formData = new FormData();
      formData.append('text', `Service Address: ${manualAddress}\nMonthly Usage: ${manualKwh} kWh\nAnnual Usage: ${parseFloat(manualKwh) * 12} kWh`);
      const res = await fetch('/api/bill-upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setUploading(false);
      setProcessingStage('uploading');
    }
  }, [manualKwh, manualAddress]);

  // ── Auto-create client + project + proposal + engineering ─────────────────
  const handleCreateAll = useCallback(async () => {
    if (!result) return;
    setStep('creating');
    setCreatingStatus([]);

    const log = (msg: string) => setCreatingStatus(prev => [...prev, msg]);

    try {
      // 1. Create client
      log('Creating client...');
      const clientName = result.billData.customerName ||
        (result.locationData ? `${result.locationData.city} Customer` : 'New Customer');
      const clientAddress = result.billData.serviceAddress ||
        (result.locationData ? `${result.locationData.city}, ${result.locationData.stateCode}` : '');

      // Build placeholder email (API requires valid email format)
      const emailSlug = (clientName.toLowerCase()
        .replace(/[^a-z0-9]/g, '.')
        .replace(/\.+/g, '.')
        .replace(/^\.|\.$/, '')
        .substring(0, 30)) || 'customer';
      const placeholderEmail = `${emailSlug}@pending.solarpro`;

      // Address must be >= 5 chars for API validation
      const safeAddress = (clientAddress && clientAddress.trim().length >= 5)
        ? clientAddress.trim()
        : result.locationData
          ? `${result.locationData.city}, ${result.locationData.stateCode} ${result.locationData.zip || '00000'}`
          : 'Address Pending, USA';

      const clientRes = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: clientName,
          email: placeholderEmail,
          phone: '',
          address: safeAddress,
          city: result.locationData?.city || '',
          state: result.locationData?.stateCode || '',
          zip: result.locationData?.zip || '',
          lat: result.locationData?.lat,
          lng: result.locationData?.lng,
          utilityProvider: result.billData.utilityProvider || result.utilityData?.utilityName || '',
          averageMonthlyKwh: result.billData.monthlyKwh || Math.round((result.billData.estimatedAnnualKwh || 0) / 12),
          annualKwh: result.billData.estimatedAnnualKwh || 0,
          averageMonthlyBill: result.billData.estimatedMonthlyBill || result.billData.totalAmount || 0,
          utilityRate: result.billData.electricityRate || result.utilityData?.avgRatePerKwh || 0.13,
        }),
      });
      const clientData = await clientRes.json();
      if (!clientData.success) {
        throw new Error('Failed to create client: ' + (clientData.error || JSON.stringify(clientData.fields || {})));
      }
      // API returns { success: true, data: client }
      const clientId = clientData.data?.id;
      if (!clientId) throw new Error('Client created but no ID returned');
      log(`✓ Client created: ${clientName}`);

      // 2. Create project
      log('Creating project...');
      const annualKwh = result.billData.estimatedAnnualKwh || 0;
      const projectName = `${clientName} — Solar ${new Date().getFullYear()}`;

      const projectRes = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          name: projectName,
          status: 'lead',
          systemType: 'roof',
          address: safeAddress,
          lat: result.locationData?.lat,
          lng: result.locationData?.lng,
          systemSizeKw: systemKw || undefined,
          notes: [
            `Annual usage: ${annualKwh.toLocaleString()} kWh`,
            `Monthly usage: ${result.billData.monthlyKwh?.toLocaleString() || 'N/A'} kWh`,
            `Rate: $${(result.billData.electricityRate || result.utilityData?.avgRatePerKwh || 0).toFixed(3)}/kWh`,
            `Utility: ${result.billData.utilityProvider || result.utilityData?.utilityName || 'Unknown'}`,
            `System size: ${systemKw.toFixed(1)} kW (${offsetPercent}% offset)`,
          ].join('\n'),
          billData: result.billData,
        }),
      });
      const projectData = await projectRes.json();
      if (!projectData.success) {
        throw new Error('Failed to create project: ' + (projectData.error || 'Unknown error'));
      }
      // API returns { success: true, data: project }
      const projectId = projectData.data?.id;
      if (!projectId) throw new Error('Project created but no ID returned');
      log(`✓ Project created: ${projectName}`);

      // 3. Create proposal (API only needs projectId — fetches project data itself)
      log('Creating proposal...');
      const proposalRes = await fetch('/api/proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          title: `Solar Proposal — ${clientName}`,
          preparedBy: 'SolarPro Design Team',
        }),
      });
      const proposalData = await proposalRes.json();
      // API returns { success: true, data: proposal }
      const proposalId = proposalData.data?.id;
      if (proposalId) {
        log(`✓ Proposal created`);
      } else {
        log('⚠ Proposal will be created from the project page');
      }

      log('✓ All done! Redirecting to project...');

      const entities: CreatedEntities = {
        clientId,
        clientName,
        projectId,
        projectName,
        proposalId,
      };
      setCreated(entities);
      setStep('done');
      onComplete?.(entities);

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Creation failed';
      log(`❌ Error: ${msg}`);
      setError(msg);
    }
  }, [result, systemKw, offsetPercent, onComplete]);

  // ── Drag & drop ───────────────────────────────────────────────────────────
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const confidenceColor = (c: string) =>
    c === 'high' ? 'text-emerald-400' : c === 'medium' ? 'text-amber-400' : 'text-red-400';
  const confidenceBg = (c: string) =>
    c === 'high' ? 'bg-emerald-500/10 border-emerald-500/20' :
    c === 'medium' ? 'bg-amber-500/10 border-amber-500/20' :
    'bg-red-500/10 border-red-500/20';

  // ── Processing stages indicator ───────────────────────────────────────────
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
                  {isDone ? <CheckCircle size={11} className="text-emerald-400" /> :
                   isActive ? <Loader2 size={11} className="text-amber-400 animate-spin" /> :
                   <div className="w-1.5 h-1.5 rounded-full bg-slate-600" />}
                </div>
                <span className={`text-xs transition-all ${
                  isDone ? 'text-emerald-400' : isActive ? 'text-amber-300 font-medium' : 'text-slate-600'
                }`}>{STAGE_LABELS[stage]}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-slate-900 rounded-2xl border border-slate-700/50 w-full max-w-xl max-h-[90vh] overflow-y-auto shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/50 bg-slate-800/50 sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
              <Zap size={16} className="text-amber-400" />
            </div>
            <div>
              <h2 className="text-white font-bold text-sm">Upload Electric Bill</h2>
              <p className="text-slate-400 text-xs">Auto-create client, project & proposal</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Step indicators */}
            {(['upload', 'review', 'creating', 'done'] as Step[]).map((s, i) => (
              <div key={s} className="flex items-center gap-1">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                  step === s ? 'bg-amber-500 text-black' :
                  ['upload', 'review', 'creating', 'done'].indexOf(step) > i
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : 'bg-slate-700 text-slate-500'
                }`}>{i + 1}</div>
                {i < 3 && <div className={`w-4 h-px ${['upload', 'review', 'creating', 'done'].indexOf(step) > i ? 'bg-emerald-500/50' : 'bg-slate-700'}`} />}
              </div>
            ))}
            <button onClick={onClose} className="ml-2 text-slate-400 hover:text-white transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="p-6">

          {/* ── STEP 1: Upload ── */}
          {step === 'upload' && (
            <div className="space-y-4">
              <div
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => !uploading && fileInputRef.current?.click()}
                className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-all ${
                  uploading ? 'border-amber-500/40 bg-amber-500/5 cursor-default' :
                  dragging ? 'border-amber-400 bg-amber-500/5 cursor-copy' :
                  'border-slate-600 hover:border-slate-500 hover:bg-slate-800/50 cursor-pointer'
                }`}
              >
                <input ref={fileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden"
                  onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
                {uploading ? <ProcessingIndicator /> : selectedFile && !error ? (
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
                      <span className="text-slate-600">max {MAX_FILE_SIZE_MB} MB</span>
                    </div>
                  </div>
                )}
              </div>

              {/* What gets created */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { icon: <User size={14} className="text-blue-400" />, label: 'Client', desc: 'Auto-created' },
                  { icon: <FolderOpen size={14} className="text-amber-400" />, label: 'Project', desc: 'With sizing' },
                  { icon: <FileText size={14} className="text-emerald-400" />, label: 'Proposal', desc: 'Ready to send' },
                ].map(item => (
                  <div key={item.label} className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
                    <div className="flex items-center gap-2 mb-1">{item.icon}<span className="text-white text-xs font-medium">{item.label}</span></div>
                    <p className="text-slate-400 text-xs">{item.desc}</p>
                  </div>
                ))}
              </div>

              {error && (
                <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                  <AlertCircle size={15} className="text-red-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-red-300 text-sm">{error}</p>
                    {lastFile && (
                      <button onClick={e => { e.stopPropagation(); setError(null); handleFile(lastFile); }}
                        className="mt-2 flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 transition-colors">
                        <RefreshCw size={11} /> Try again
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-slate-700" />
                <span className="text-slate-500 text-xs">or enter manually</span>
                <div className="flex-1 h-px bg-slate-700" />
              </div>

              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-slate-400 text-xs mb-1 block">Monthly kWh Usage</label>
                    <input type="number" value={manualKwh} onChange={e => setManualKwh(e.target.value)}
                      placeholder="e.g. 1200"
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500/50" />
                  </div>
                  <div>
                    <label className="text-slate-400 text-xs mb-1 block">Service Address</label>
                    <input type="text" value={manualAddress} onChange={e => setManualAddress(e.target.value)}
                      placeholder="123 Main St, City, ST"
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500/50" />
                  </div>
                </div>
                <button onClick={handleManualEntry} disabled={uploading || !manualKwh || !manualAddress}
                  className="w-full btn-secondary py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed">
                  {uploading ? <Loader2 size={14} className="animate-spin inline mr-2" /> : null}
                  Continue with Manual Entry
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 2: Review ── */}
          {step === 'review' && result && (
            <div className="space-y-4">
              {selectedFile && (
                <div className="flex items-center gap-2 bg-slate-800/50 rounded-lg px-3 py-2 border border-slate-700/50">
                  <FileText size={13} className="text-slate-400 flex-shrink-0" />
                  <span className="text-slate-300 text-xs truncate flex-1">{selectedFile.name}</span>
                  <span className="text-slate-500 text-xs flex-shrink-0">{formatFileSize(selectedFile.size)}</span>
                </div>
              )}

              <div className={`flex items-center gap-2 rounded-lg px-3 py-2 border text-sm ${confidenceBg(result.billData.confidence)}`}>
                <Info size={14} className={confidenceColor(result.billData.confidence)} />
                <span className={confidenceColor(result.billData.confidence)}>
                  Extraction confidence: <strong>{result.billData.confidence}</strong>
                  {' '}— {result.billData.extractedFields.length} fields extracted
                  {result.billData.usedLlmFallback && <span className="ml-1 text-xs opacity-75">(AI-assisted)</span>}
                </span>
              </div>

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
                  { label: 'Demand Charge', value: result.billData.demandCharge ? `$${result.billData.demandCharge.toFixed(2)}${result.billData.demandKw ? ` (${result.billData.demandKw} kW)` : ''}` : null, icon: <BarChart2 size={13} className="text-purple-400" /> },
                  { label: 'Gas Usage', value: result.billData.gasUsageTherm ? `${result.billData.gasUsageTherm.toLocaleString()} therms` : null, icon: <Flame size={13} className="text-orange-400" /> },
                ].filter(f => f.value).map(field => (
                  <div key={field.label} className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
                    <div className="flex items-center gap-1.5 mb-1">{field.icon}<span className="text-slate-400 text-xs">{field.label}</span></div>
                    <p className="text-white text-sm font-medium truncate">{field.value}</p>
                  </div>
                ))}
              </div>

              {/* Monthly usage sparkline */}
              {result.billData.monthlyUsageHistory && result.billData.monthlyUsageHistory.length >= 3 && (
                <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
                  <p className="text-slate-400 text-xs mb-2 font-medium flex items-center gap-1.5">
                    <BarChart2 size={12} /> Monthly Usage ({result.billData.monthlyUsageHistory.length} months)
                  </p>
                  <div className="flex items-end gap-1 h-10">
                    {result.billData.monthlyUsageHistory.map((kwh, i) => {
                      const max = Math.max(...result.billData.monthlyUsageHistory!);
                      const pct = max > 0 ? (kwh / max) * 100 : 0;
                      return <div key={i} title={`${kwh.toLocaleString()} kWh`}
                        className="flex-1 bg-amber-500/40 hover:bg-amber-500/60 rounded-sm transition-colors cursor-default"
                        style={{ height: `${Math.max(pct, 8)}%` }} />;
                    })}
                  </div>
                </div>
              )}

              {/* Location */}
              {result.locationData && (
                <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <MapPin size={13} className="text-blue-400" />
                    <span className="text-blue-300 text-xs font-medium">Location Detected</span>
                  </div>
                  <p className="text-white text-sm">{result.locationData.city}, {result.locationData.county ? `${result.locationData.county} County, ` : ''}{result.locationData.state} {result.locationData.zip}</p>
                </div>
              )}

              {/* Warnings */}
              {result.validation.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2 bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2">
                  <AlertCircle size={12} className="text-amber-400 flex-shrink-0 mt-0.5" />
                  <p className="text-amber-300 text-xs">{w}</p>
                </div>
              ))}

              {/* System sizing */}
              <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
                <h3 className="text-white font-semibold text-sm mb-3 flex items-center gap-2">
                  <Sun size={15} className="text-amber-400" /> System Sizing
                </h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 text-xs">System Size</span>
                    <span className="text-amber-400 font-bold text-lg">{systemKw.toFixed(1)} kW</span>
                  </div>
                  <input type="range" min={1} max={50} step={0.1} value={systemKw}
                    onChange={e => setSystemKw(parseFloat(e.target.value))}
                    className="w-full accent-amber-500" />
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 text-xs">Offset Target</span>
                    <span className="text-emerald-400 font-bold">{offsetPercent}%</span>
                  </div>
                  <input type="range" min={50} max={120} step={5} value={offsetPercent}
                    onChange={e => setOffsetPercent(parseInt(e.target.value))}
                    className="w-full accent-emerald-500" />
                </div>
                <div className="grid grid-cols-3 gap-2 mt-3">
                  {[
                    { label: 'Panels', value: `${Math.ceil(systemKw * 1000 / 430)}`, color: 'text-blue-400' },
                    { label: 'Annual kWh', value: `${Math.round(systemKw * 1400).toLocaleString()}`, color: 'text-amber-400' },
                    { label: 'Est. Cost', value: `$${Math.round(systemKw * 2850).toLocaleString()}`, color: 'text-emerald-400' },
                  ].map(item => (
                    <div key={item.label} className="text-center bg-slate-700/30 rounded-lg p-2">
                      <p className={`text-sm font-bold ${item.color}`}>{item.value}</p>
                      <p className="text-slate-500 text-xs">{item.label}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-3">
                <button onClick={() => { setStep('upload'); setSelectedFile(null); setError(null); }}
                  className="btn-secondary flex-1 py-2 text-sm">← Re-upload</button>
                <button onClick={handleCreateAll}
                  className="btn-primary flex-1 py-2 text-sm">
                  Create Client + Project <ArrowRight size={14} className="inline ml-1" />
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 3: Creating ── */}
          {step === 'creating' && (
            <div className="space-y-4 py-4">
              <div className="flex flex-col items-center gap-3 mb-4">
                <Loader2 size={32} className="text-amber-400 animate-spin" />
                <p className="text-white font-semibold">Setting everything up...</p>
              </div>
              <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50 space-y-2">
                {creatingStatus.map((msg, i) => (
                  <div key={i} className="flex items-center gap-2">
                    {msg.startsWith('✓') ? <CheckCircle size={13} className="text-emerald-400 flex-shrink-0" /> :
                     msg.startsWith('❌') ? <AlertCircle size={13} className="text-red-400 flex-shrink-0" /> :
                     msg.startsWith('⚠') ? <AlertCircle size={13} className="text-amber-400 flex-shrink-0" /> :
                     <Loader2 size={13} className="text-amber-400 animate-spin flex-shrink-0" />}
                    <p className={`text-sm ${msg.startsWith('✓') ? 'text-emerald-300' : msg.startsWith('❌') ? 'text-red-300' : msg.startsWith('⚠') ? 'text-amber-300' : 'text-slate-300'}`}>{msg.replace(/^[✓❌⚠]\s/, '')}</p>
                  </div>
                ))}
              </div>
              {error && (
                <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                  <AlertCircle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-red-300 text-sm">{error}</p>
                </div>
              )}
            </div>
          )}

          {/* ── STEP 4: Done ── */}
          {step === 'done' && created && (
            <div className="space-y-4 py-4 text-center">
              <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto">
                <CheckCircle size={32} className="text-emerald-400" />
              </div>
              <div>
                <h3 className="text-white font-bold text-lg">All Set!</h3>
                <p className="text-slate-400 text-sm mt-1">Client, project, and proposal have been created.</p>
              </div>
              <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50 text-left space-y-2">
                <div className="flex items-center gap-2">
                  <User size={13} className="text-blue-400" />
                  <span className="text-slate-400 text-xs">Client:</span>
                  <span className="text-white text-sm font-medium">{created.clientName}</span>
                </div>
                <div className="flex items-center gap-2">
                  <FolderOpen size={13} className="text-amber-400" />
                  <span className="text-slate-400 text-xs">Project:</span>
                  <span className="text-white text-sm font-medium">{created.projectName}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Sun size={13} className="text-amber-400" />
                  <span className="text-slate-400 text-xs">System:</span>
                  <span className="text-white text-sm font-medium">{systemKw.toFixed(1)} kW · {Math.ceil(systemKw * 1000 / 430)} panels</span>
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={onClose} className="btn-secondary flex-1 py-2 text-sm">Close</button>
                <a href={`/projects/${created.projectId}`} className="btn-primary flex-1 py-2 text-sm text-center">
                  Open Project <ArrowRight size={14} className="inline ml-1" />
                </a>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}