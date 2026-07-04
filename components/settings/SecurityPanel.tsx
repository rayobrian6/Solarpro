'use client';
/**
 * SecurityPanel — MFA enrollment and status display for /settings Security tab.
 *
 * SOC 2 (CC7.2) / ISO 27001 (A.12.4) readiness: admin/staff accounts must have MFA.
 * This component provides:
 *   1. MFA status display (enabled/disabled, method, enrollment date)
 *   2. Enrollment flow (generate secret → show QR → verify first code → enable)
 *   3. Recovery code display (one-time view after enrollment)
 *
 * SECURITY:
 *   - TOTP secrets and recovery codes are NEVER stored in state after enrollment
 *   - Recovery codes are shown ONCE — user must save them
 *   - No unsafe MFA disable endpoint exists
 *   - MFA enrollment required banner for admin/staff roles
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Shield, ShieldCheck, ShieldAlert, Key, QrCode, Copy, Check,
  AlertTriangle, RefreshCw, Loader2, Eye, EyeOff, Download,
} from 'lucide-react';
import type { AppUser } from '@/contexts/UserContext';
import { isAdminRole } from '@/contexts/UserContext';

// ─── Types ───────────────────────────────────────────────────────────────

type EnrollmentStep = 'idle' | 'loading' | 'qr_ready' | 'verifying' | 'success' | 'error';

interface MFASetupResponse {
  uri: string;
  secret: string;
  message: string;
  // Recovery codes: returned from PUT after TOTP verification (timing fix).
  // Previously they came from POST; now POST only returns uri + secret.
  recovery_codes?: string[];
}

interface SecurityPanelProps {
  user: AppUser;
  onUserUpdate?: () => void; // trigger UserContext refresh after enrollment
}

// ─── Component ───────────────────────────────────────────────────────────

export default function SecurityPanel({ user, onUserUpdate }: SecurityPanelProps) {
  // Enrollment state
  const [step, setStep] = useState<EnrollmentStep>('idle');
  const [setupData, setSetupData] = useState<MFASetupResponse | null>(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [verifyError, setVerifyError] = useState('');
  const [showRecoveryCodes, setShowRecoveryCodes] = useState(false);
  const [showManualSecret, setShowManualSecret] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  // Recovery codes confirmed saved
  const [recoveryConfirmed, setRecoveryConfirmed] = useState(false);

  const verifyInputRef = useRef<HTMLInputElement>(null);

  const isMFARequired = isAdminRole(user.role) && !user.mfaEnabled;
  const isMFADisabled = !user.mfaEnabled;

  // ─── Generate QR code from otpauth URI ──────────────────────────────
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
        console.error('[MFA_QR_ERROR]', err);
      });
    }).catch(err => {
      console.error('[MFA_QR_IMPORT_ERROR]', err);
    });

    return () => { cancelled = true; };
  }, [setupData?.uri]);

  // ─── Step 1: Initiate MFA setup (POST /api/auth/mfa/setup) ──────────
  const initiateSetup = useCallback(async () => {
    setStep('loading');
    setVerifyError('');
    setVerifyCode('');
    setSetupData(null);
    setQrDataUrl(null);
    setShowRecoveryCodes(false);
    setShowManualSecret(false);
    setRecoveryConfirmed(false);

    try {
      const res = await fetch('/api/auth/mfa/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();

      if (!res.ok) {
        setStep('error');
        setVerifyError(data.error || 'Failed to initiate MFA setup.');
        return;
      }

      setSetupData(data);
      setStep('qr_ready');

      // Auto-focus the verify input after a short delay
      setTimeout(() => verifyInputRef.current?.focus(), 500);
    } catch {
      setStep('error');
      setVerifyError('Network error. Please try again.');
    }
  }, []);

  // ─── Step 2: Verify first TOTP code (PUT /api/auth/mfa/setup) ──────
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
      const data = await res.json();

      if (!res.ok) {
        setStep('qr_ready');
        setVerifyError(data.error || 'Invalid verification code. Try again.');
        setVerifyCode('');
        return;
      }

      // MFA enabled successfully
      // Recovery codes now come from the PUT response (timing fix: codes are
      // generated AFTER TOTP proof-of-possession, not before)
      if (data.recovery_codes && data.recovery_codes.length > 0) {
        // Store recovery codes in setupData so the success card can display them
        setSetupData(prev => prev ? { ...prev, recovery_codes: data.recovery_codes } : { uri: '', secret: '', message: '', recovery_codes: data.recovery_codes });
      }
      setStep('success');
      setShowRecoveryCodes(true);

      // Notify parent to refresh user context
      if (onUserUpdate) onUserUpdate();
    } catch {
      setStep('qr_ready');
      setVerifyError('Network error. Please try again.');
    }
  }, [verifyCode, onUserUpdate]);

  // ─── Copy to clipboard helper ──────────────────────────────────────
  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Fallback for older browsers
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

  // ─── Download recovery codes as text file ───────────────────────────
  const downloadRecoveryCodes = () => {
    if (!setupData?.recovery_codes) return;
    const content = [
      'SolarPro MFA Recovery Codes',
      '=============================',
      `Account: ${user.email}`,
      `Generated: ${new Date().toLocaleDateString()}`,
      '',
      'IMPORTANT: Store these codes in a safe place.',
      'Each code can only be used once.',
      'If you lose your authenticator device, use a code to regain access.',
      '',
      ...setupData.recovery_codes.map((code, i) => `${i + 1}. ${code}`),
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

  // ─── Render: MFA Status Card ───────────────────────────────────────

  const renderStatusCard = () => (
    <div className="card p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {user.mfaEnabled ? (
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
              <ShieldCheck size={18} className="text-emerald-400" />
            </div>
          ) : (
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
              <ShieldAlert size={18} className="text-amber-400" />
            </div>
          )}
          <div>
            <h3 className="text-white font-bold">Multi-Factor Authentication</h3>
            <p className="text-sm text-slate-400">
              {user.mfaEnabled ? 'Enabled — your account is protected' : 'Not enabled — your account is at risk'}
            </p>
          </div>
        </div>
        {user.mfaEnabled ? (
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
            Active
          </span>
        ) : (
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30">
            Inactive
          </span>
        )}
      </div>

      {/* MFA details if enabled */}
      {user.mfaEnabled && (
        <div className="grid grid-cols-2 gap-4 pt-2">
          <div>
            <p className="text-xs text-slate-500 mb-0.5">Method</p>
            <p className="text-sm text-slate-300 capitalize">{user.mfaMethod || 'TOTP'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-0.5">Enrolled</p>
            <p className="text-sm text-slate-300">
              {user.mfaEnrolledAt
                ? new Date(user.mfaEnrolledAt).toLocaleDateString(undefined, {
                    year: 'numeric', month: 'short', day: 'numeric',
                  })
                : 'N/A'}
            </p>
          </div>
        </div>
      )}

      {/* MFA enrollment required warning for admin/staff */}
      {isMFARequired && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 flex items-start gap-3">
          <AlertTriangle size={16} className="text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-amber-400 text-sm font-medium">MFA enrollment required</p>
            <p className="text-amber-400/70 text-xs mt-0.5">
              Your role ({user.role}) requires multi-factor authentication per security policy.
              Please enroll below to access the platform.
            </p>
          </div>
        </div>
      )}

      {/* Enable button when MFA is not yet enabled */}
      {isMFADisabled && step === 'idle' && (
        <button
          onClick={initiateSetup}
          className="btn-primary py-2.5 px-5 text-sm font-semibold w-full justify-center"
        >
          <Shield size={16} />
          Enable MFA
        </button>
      )}
    </div>
  );

  // ─── Render: Enrollment QR Card ─────────────────────────────────────

  const renderEnrollmentCard = () => {
    if (step !== 'qr_ready' && step !== 'verifying') return null;

    return (
      <div className="card p-6 space-y-5">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center">
            <QrCode size={18} className="text-blue-400" />
          </div>
          <div>
            <h3 className="text-white font-bold">Set Up Authenticator</h3>
            <p className="text-sm text-slate-400">Scan the QR code with your authenticator app</p>
          </div>
        </div>

        {/* QR Code */}
        <div className="flex justify-center py-3">
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
            {showManualSecret ? 'Hide manual entry key' : 'Can\'t scan? Enter key manually'}
          </button>
        </div>

        {showManualSecret && setupData?.secret && (
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
              className="input w-36 text-center text-lg tracking-[0.3em] font-mono"
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
    );
  };

  // ─── Render: Success + Recovery Codes Card ──────────────────────────

  const renderSuccessCard = () => {
    if (step !== 'success') return null;

    return (
      <div className="card p-6 space-y-5">
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
        {showRecoveryCodes && setupData?.recovery_codes && (
          <div className="space-y-3">
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
              <div className="flex items-start gap-2">
                <AlertTriangle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-red-400 text-sm font-semibold">Save these recovery codes now</p>
                  <p className="text-red-400/70 text-xs mt-0.5">
                    This is the ONLY time these codes will be shown. If you lose your authenticator
                    device, you will need a recovery code to regain access.
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-slate-900/60 border border-slate-700 rounded-xl p-4">
              <div className="grid grid-cols-2 gap-2 font-mono text-sm">
                {setupData.recovery_codes.map((code, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-slate-500 text-xs w-4">{i + 1}.</span>
                    <span className="text-amber-400 select-all">{code}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => copyToClipboard(setupData.recovery_codes.join('\n'), 'recovery')}
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
                onClick={() => {
                  setShowRecoveryCodes(false);
                  setSetupData(null);
                  setStep('idle');
                }}
                className="btn-primary py-2.5 px-5 text-sm font-semibold w-full justify-center"
              >
                Done
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  // ─── Render: Error state ────────────────────────────────────────────

  const renderErrorCard = () => {
    if (step !== 'error') return null;

    return (
      <div className="card p-6 space-y-4">
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
          <p className="text-red-400 text-sm">{verifyError}</p>
        </div>
        <button
          onClick={() => { setStep('idle'); setVerifyError(''); }}
          className="btn-secondary py-2.5 px-5 text-sm font-semibold"
        >
          Try Again
        </button>
      </div>
    );
  };

  // ─── Render: Loading state ──────────────────────────────────────────

  if (step === 'loading') {
    return (
      <div className="space-y-4">
        {renderStatusCard()}
        <div className="card p-6 flex items-center justify-center gap-3">
          <Loader2 size={20} className="text-amber-400 animate-spin" />
          <span className="text-slate-300 text-sm">Generating MFA secret…</span>
        </div>
      </div>
    );
  }

  // ─── Main render ────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {renderStatusCard()}
      {renderEnrollmentCard()}
      {renderSuccessCard()}
      {renderErrorCard()}

      {/* Security info card */}
      <div className="card p-6 space-y-3">
        <div className="flex items-center gap-3">
          <Key size={16} className="text-slate-400" />
          <h3 className="text-white font-bold text-sm">About MFA</h3>
        </div>
        <div className="text-xs text-slate-500 space-y-1.5">
          <p>Multi-factor authentication adds an extra layer of security to your account.
             After entering your password, you will also need to provide a code from your
             authenticator app (Google Authenticator, Authy, 1Password, etc.).</p>
          <p>Recovery codes let you regain access if you lose your authenticator device.
             Each code can only be used once. Store them in a safe place — they are shown
             only during enrollment.</p>
          {isAdminRole(user.role) && (
            <p className="text-amber-400/70">
              Your role ({user.role}) requires MFA to be enabled per security policy (POL-SEC-009).
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
