'use client';
/**
 * MFA Enrollment Page — /auth/mfa/enroll
 *
 * Standalone enrollment page for admin/staff users who are required to
 * enroll MFA before they can access the application. This page is reached
 * when the login API returns MFA_ENROLLMENT_REQUIRED, which sets a
 * restricted enrollment pending cookie (solarpro_mfa_enroll_pending).
 *
 * Unlike the SecurityPanel in /settings, this page:
 *   - Works WITHOUT a full session (uses enrollment pending cookie)
 *   - Is a public route (no AppShell/UserContext dependency)
 *   - Redirects to /dashboard after successful enrollment (full session issued)
 *
 * SECURITY:
 *   - The enrollment pending cookie ONLY authorizes /api/auth/mfa/setup
 *   - After enrollment, the server issues a full session and clears the pending cookie
 *   - Recovery codes are shown ONCE after TOTP verification succeeds
 *   - No application data is accessible until enrollment completes
 */

import React, { useState, useCallback, useRef, useEffect, Suspense } from 'react';
import {
  Sun, Shield, ShieldCheck, ShieldAlert, Key, QrCode, Copy, Check,
  AlertTriangle, RefreshCw, Loader2, Eye, EyeOff, Download, ArrowRight,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────

type EnrollmentStep = 'loading' | 'qr_ready' | 'verifying' | 'success' | 'error' | 'idle';

interface MFASetupResponse {
  uri: string;
  secret: string;
  message: string;
  recovery_codes?: string[];
}

interface MFAVerifyResponse {
  success: boolean;
  message: string;
  error?: string;
  recovery_codes?: string[];
}

// ─── Enrollment Form ─────────────────────────────────────────────────

function MFAEnrollmentForm() {
  // Enrollment state
  const [step, setStep] = useState<EnrollmentStep>('loading');
  const [setupData, setSetupData] = useState<MFASetupResponse | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [verifyError, setVerifyError] = useState('');
  const [showManualSecret, setShowManualSecret] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [recoveryConfirmed, setRecoveryConfirmed] = useState(false);

  const verifyInputRef = useRef<HTMLInputElement>(null);
  const hasInitiated = useRef(false);

  // ─── Auto-initiate MFA setup on mount ────────────────────────────
  // The enrollment pending cookie was set by the login route.
  // POST /api/auth/mfa/setup reads it via getUserForMFASetup().
  useEffect(() => {
    if (hasInitiated.current) return;
    hasInitiated.current = true;
    initiateSetup();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Generate QR code from otpauth URI ───────────────────────────
  useEffect(() => {
    if (!setupData?.uri) return;

    let cancelled = false;
    import('qrcode').then(QRCode => {
      if (cancelled) return;
      QRCode.toDataURL(setupData!.uri, {
        width: 256,
        margin: 2,
        color: { dark: '#0f172a', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      }).then(url => {
        if (!cancelled) setQrDataUrl(url);
      }).catch(err => {
        console.error('[MFA_ENROLL_QR_ERROR]', err);
      });
    }).catch(err => {
      console.error('[MFA_ENROLL_QR_IMPORT_ERROR]', err);
    });

    return () => { cancelled = true; };
  }, [setupData?.uri]);

  // ─── Step 1: Initiate MFA setup (POST /api/auth/mfa/setup) ──────
  const initiateSetup = useCallback(async () => {
    setStep('loading');
    setVerifyError('');
    setVerifyCode('');
    setSetupData(null);
    setQrDataUrl(null);
    setShowManualSecret(false);
    setRecoveryConfirmed(false);
    setRecoveryCodes(null);

    try {
      const res = await fetch('/api/auth/mfa/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();

      if (!res.ok) {
        setStep('error');
        setVerifyError(data.error || 'Failed to initiate MFA setup. Your enrollment session may have expired — please try logging in again.');
        return;
      }

      setSetupData(data);
      setStep('qr_ready');

      // Auto-focus the verify input after a short delay
      setTimeout(() => verifyInputRef.current?.focus(), 500);
    } catch {
      setStep('error');
      setVerifyError('Network error. Please check your connection and try again.');
    }
  }, []);

  // ─── Step 2: Verify first TOTP code (PUT /api/auth/mfa/setup) ───
  const verifyAndEnable = useCallback(async () => {
    if (!verifyCode || verifyCode.length !== 6) {
      setVerifyError('Please enter the 6-digit code from your authenticator app.');
      return;
    }

    setStep('verifying');
    setVerifyError('');

    try {
      const res = await fetch('/api/auth/mfa/setup', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: verifyCode }),
      });
      const data: MFAVerifyResponse = await res.json();

      if (!res.ok) {
        setStep('qr_ready');
        setVerifyError(data.error || 'Invalid verification code. Try again.');
        setVerifyCode('');
        return;
      }

      // MFA enabled successfully — recovery codes come from the PUT response now
      setStep('success');
      if (data.recovery_codes && data.recovery_codes.length > 0) {
        setRecoveryCodes(data.recovery_codes);
      } else if (setupData?.recovery_codes) {
        // Fallback: if PUT didn't return codes (shouldn't happen after timing fix),
        // the codes from POST are still available — but this is the legacy path
        setRecoveryCodes(setupData.recovery_codes);
      }
    } catch {
      setStep('qr_ready');
      setVerifyError('Network error. Please try again.');
    }
  }, [verifyCode, setupData]);

  // ─── Copy to clipboard helper ────────────────────────────────────
  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    }
  };

  // ─── Download recovery codes as text file ────────────────────────
  const downloadRecoveryCodes = () => {
    if (!recoveryCodes) return;
    const content = [
      'SolarPro MFA Recovery Codes',
      '============================',
      'Generated: ' + new Date().toLocaleDateString(),
      '',
      'IMPORTANT: Store these codes in a safe place.',
      'Each code can only be used once.',
      'If you lose your authenticator device, use a code to regain access.',
      '',
      ...recoveryCodes.map((code, i) => `${i + 1}. ${code}`),
      '',
      '⚠️ This is the ONLY time these codes will be shown.',
    ].join('\n');

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'solarpro-mfa-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  // ─── Back to login ───────────────────────────────────────────────
  const handleBackToLogin = () => {
    window.location.href = '/auth/login';
  };

  // ─── Continue to app after enrollment ─────────────────────────────
  const handleContinueToApp = () => {
    window.location.href = '/dashboard';
  };

  // ─── Render ──────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 sm:p-6">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-amber-500/5 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-2xl solar-gradient flex items-center justify-center shadow-lg shadow-amber-500/30">
              <Sun size={24} className="text-slate-900" />
            </div>
            <div className="text-left">
              <div className="font-black text-white text-xl leading-tight">SolarPro</div>
              <div className="text-amber-400 text-xs font-medium">Design Platform</div>
            </div>
          </div>
          <h1 className="text-3xl font-black text-white mb-2">Set Up MFA</h1>
          <p className="text-slate-400 text-sm">
            Multi-factor authentication is required for your account
          </p>
        </div>

        <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-5 sm:p-8 backdrop-blur-sm">
          {/* Required enrollment notice */}
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 mb-6">
            <div className="flex items-start gap-2">
              <ShieldAlert size={16} className="text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-amber-400 text-sm font-medium">MFA enrollment required</p>
                <p className="text-amber-400/70 text-xs mt-0.5">
                  Your account role requires multi-factor authentication. Please complete
                  enrollment below to access the platform.
                </p>
              </div>
            </div>
          </div>

          {/* ─── Loading state ──────────────────────────────────────────── */}
          {step === 'loading' && (
            <div className="flex flex-col items-center justify-center py-8 gap-3">
              <Loader2 size={28} className="text-amber-400 animate-spin" />
              <span className="text-slate-300 text-sm">Generating MFA secret…</span>
            </div>
          )}

          {/* ─── QR Ready state ─────────────────────────────────────────── */}
          {(step === 'qr_ready' || step === 'verifying') && setupData && (
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center">
                  <QrCode size={18} className="text-blue-400" />
                </div>
                <div>
                  <h3 className="text-white font-bold text-sm">Set Up Authenticator</h3>
                  <p className="text-xs text-slate-400">Scan the QR code with your authenticator app</p>
                </div>
              </div>

              {/* QR Code */}
              <div className="flex justify-center py-2">
                {qrDataUrl ? (
                  <div className="bg-white p-3 rounded-xl">
                    <img src={qrDataUrl} alt="MFA QR Code" width={200} height={200} />
                  </div>
                ) : (
                  <div className="w-[200px] h-[200px] bg-slate-700/40 rounded-xl flex items-center justify-center">
                    <Loader2 size={32} className="text-slate-400 animate-spin" />
                  </div>
                )}
              </div>

              {/* Manual secret entry option */}
              <div className="text-center">
                <button
                  onClick={() => setShowManualSecret(!showManualSecret)}
                  className="text-xs text-slate-400 hover:text-slate-300 transition-colors underline underline-offset-2"
                >
                  {showManualSecret ? 'Hide manual entry key' : "Can't scan? Enter key manually"}
                </button>
              </div>

              {showManualSecret && setupData.secret && (
                <div className="bg-slate-900/60 border border-slate-700 rounded-xl p-3 space-y-2">
                  <p className="text-xs text-slate-500">Manual entry key (base32):</p>
                  <div className="flex items-center gap-2">
                    <code className="text-xs text-amber-400 font-mono break-all flex-1 select-all">
                      {setupData.secret}
                    </code>
                    <button
                      onClick={() => copyToClipboard(setupData.secret, 'secret')}
                      className="p-1.5 rounded-lg hover:bg-slate-700 transition-colors flex-shrink-0"
                      title="Copy secret"
                    >
                      {copied === 'secret' ? (
                        <Check size={14} className="text-emerald-400" />
                      ) : (
                        <Copy size={14} className="text-slate-400" />
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Verify code input */}
              <div className="space-y-3">
                <p className="text-sm text-slate-300 font-medium">
                  Enter the 6-digit code from your authenticator app:
                </p>
                <div className="flex gap-3">
                  <input
                    ref={verifyInputRef}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    value={verifyCode}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                      setVerifyCode(val);
                      if (verifyError) setVerifyError('');
                    }}
                    placeholder="000000"
                    className="w-36 bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-3 text-center text-lg tracking-[0.3em] font-mono text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/30 transition-all"
                    disabled={step === 'verifying'}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && verifyCode.length === 6) verifyAndEnable();
                    }}
                  />
                  <button
                    onClick={verifyAndEnable}
                    disabled={verifyCode.length !== 6 || step === 'verifying'}
                    className="btn-primary py-2.5 px-5 text-sm font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {step === 'verifying' ? (
                      <><span className="spinner w-4 h-4" /> Verifying…</>
                    ) : (
                      <>Verify & Enable</>
                    )}
                  </button>
                </div>

                {/* Verification error */}
                {verifyError && (
                  <p className="text-red-400 text-xs flex items-center gap-1.5">
                    <AlertTriangle size={12} />
                    {verifyError}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* ─── Verifying state (transitional) ─────────────────────────── */}
          {step === 'verifying' && (
            <div className="flex flex-col items-center justify-center py-8 gap-3">
              <Loader2 size={28} className="text-amber-400 animate-spin" />
              <span className="text-slate-300 text-sm">Verifying code and enabling MFA…</span>
            </div>
          )}

          {/* ─── Success + Recovery Codes ────────────────────────────────── */}
          {step === 'success' && (
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
                  <ShieldCheck size={18} className="text-emerald-400" />
                </div>
                <div>
                  <h3 className="text-white font-bold">MFA Enabled Successfully</h3>
                  <p className="text-sm text-slate-400">Your account is now protected with multi-factor authentication</p>
                </div>
              </div>

              {/* Recovery codes — one-time display */}
              {recoveryCodes && recoveryCodes.length > 0 && (
                <div className="space-y-3">
                  <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
                    <div className="flex items-start gap-2">
                      <AlertTriangle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-red-400 text-sm font-semibold">Save these recovery codes now</p>
                        <p className="text-red-400/70 text-xs mt-0.5">
                          This is the ONLY time these codes will be shown. If you lose your
                          authenticator device, you will need a recovery code to regain access.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-slate-900/60 border border-slate-700 rounded-xl p-4">
                    <div className="grid grid-cols-2 gap-2 font-mono text-sm">
                      {recoveryCodes.map((code, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="text-slate-500 text-xs w-4">{i + 1}.</span>
                          <span className="text-amber-400 select-all">{code}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={() => copyToClipboard(recoveryCodes.join('\n'), 'recovery')}
                      className="btn-secondary py-2 px-4 text-xs font-medium"
                    >
                      {copied === 'recovery' ? <><Check size={14} /> Copied!</> : <><Copy size={14} /> Copy All</>}
                    </button>
                    <button
                      onClick={downloadRecoveryCodes}
                      className="btn-secondary py-2 px-4 text-xs font-medium"
                    >
                      <Download size={14} />
                      Download .txt
                    </button>
                  </div>

                  {/* Confirmation checkbox */}
                  <label className="flex items-center gap-3 cursor-pointer group pt-2">
                    <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                      recoveryConfirmed
                        ? 'bg-emerald-500 border-emerald-500'
                        : 'border-slate-600 group-hover:border-slate-500'
                    }`}>
                      {recoveryConfirmed && <Check size={12} className="text-slate-900" />}
                    </div>
                    <input
                      type="checkbox"
                      checked={recoveryConfirmed}
                      onChange={(e) => setRecoveryConfirmed(e.target.checked)}
                      className="sr-only"
                    />
                    <span className="text-sm text-slate-400">
                      I have saved my recovery codes in a secure location
                    </span>
                  </label>

                  {recoveryConfirmed && (
                    <button
                      onClick={handleContinueToApp}
                      className="btn-primary py-3 text-base font-bold justify-center w-full"
                    >
                      Continue to SolarPro <ArrowRight size={16} />
                    </button>
                  )}
                </div>
              )}

              {/* No recovery codes (shouldn't happen after timing fix) */}
              {(!recoveryCodes || recoveryCodes.length === 0) && recoveryConfirmed === false && (
                <button
                  onClick={handleContinueToApp}
                  className="btn-primary py-3 text-base font-bold justify-center w-full"
                >
                  Continue to SolarPro <ArrowRight size={16} />
                </button>
              )}
            </div>
          )}

          {/* ─── Error state ─────────────────────────────────────────────── */}
          {step === 'error' && (
            <div className="space-y-4">
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-red-400 text-sm">{verifyError}</p>
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => { setStep('loading'); setVerifyError(''); initiateSetup(); }}
                  className="btn-primary py-2.5 px-5 text-sm font-semibold"
                >
                  <RefreshCw size={14} /> Try Again
                </button>
                <button
                  onClick={handleBackToLogin}
                  className="btn-secondary py-2.5 px-5 text-sm font-semibold"
                >
                  Back to Login
                </button>
              </div>
            </div>
          )}

          {/* Back to login link (not shown in success state) */}
          {step !== 'success' && step !== 'error' && step !== 'loading' && (
            <div className="text-center pt-4 mt-4 border-t border-slate-700/50">
              <button
                onClick={handleBackToLogin}
                className="text-xs text-slate-500 hover:text-slate-400 transition-colors"
              >
                ← Back to login
              </button>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-slate-600 mt-6">
          <Shield size={12} className="inline mr-1" />Secured with 256-bit encryption. We never share your data.
        </p>
      </div>
    </div>
  );
}

// ─── Page Export with Suspense boundary ───────────────────────────────

export default function MFAEnrollmentPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-slate-400 text-sm flex items-center gap-2">
          <Loader2 size={16} className="animate-spin" />
          Loading...
        </div>
      </div>
    }>
      <MFAEnrollmentForm />
    </Suspense>
  );
}
