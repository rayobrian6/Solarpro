'use client';

/**
 * SignatureBlock — Inline e-signature capture block.
 *
 * Renders as an in-page section (not a modal) at the bottom of the
 * public proposal view. Supports:
 *   - Draw mode: freehand canvas signature
 *   - Type mode: styled cursive text preview
 *
 * On submit: POSTs to /api/proposals/[id]/sign with signerName, signerEmail,
 * signature data, agreedToTerms=true, and optional share token.
 *
 * Props:
 *   proposalId    — UUID of the proposal
 *   proposalTitle — displayed in the header
 *   token         — share token from URL (?token=...)
 *   primaryColor  — brand accent colour (default amber)
 *   onSuccess     — called with signerName when signature accepted
 *
 * States:
 *   idle     — waiting for user input
 *   signed   — submission was accepted (shows confirmation)
 *   error    — submission failed (shows message + retry)
 *
 * The SignatureModal (components/SignatureModal.tsx) is the modal variant
 * of this component. SignatureBlock is the inline/embedded variant — better
 * for proposals viewed on mobile or rendered for printing.
 */

import React, {
  useRef,
  useState,
  useEffect,
  useCallback,
} from 'react';
import {
  PenLine,
  Type,
  RotateCcw,
  CheckCircle,
  AlertTriangle,
  Loader2,
  Shield,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────

type Mode    = 'draw' | 'type';
type UIState = 'idle' | 'signing' | 'signed' | 'error';

interface SignatureBlockProps {
  proposalId:    string;
  proposalTitle: string;
  token?:        string | null;
  primaryColor?: string;
  onSuccess:     (signerName: string) => void;
}

// ── Component ─────────────────────────────────────────────────────────────

export default function SignatureBlock({
  proposalId,
  proposalTitle,
  token        = null,
  primaryColor = '#f59e0b',
  onSuccess,
}: SignatureBlockProps) {
  // ── State ──────────────────────────────────────────────────────────────
  const [mode, setMode]             = useState<Mode>('draw');
  const [signerName, setSignerName] = useState('');
  const [signerEmail, setSignerEmail] = useState('');
  const [typedSig, setTypedSig]     = useState('');
  const [isDrawing, setIsDrawing]   = useState(false);
  const [hasDrawn, setHasDrawn]     = useState(false);
  const [agreed, setAgreed]         = useState(false);
  const [uiState, setUiState]       = useState<UIState>('idle');
  const [error, setError]           = useState<string | null>(null);
  const [signedBy, setSignedBy]     = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastPos   = useRef<{ x: number; y: number } | null>(null);

  // ── Canvas init ────────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth   = 2;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    setHasDrawn(false);
  }, [mode]);

  // ── Pointer helpers ────────────────────────────────────────────────────

  const getPos = (e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) => {
    const rect   = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    if ('touches' in e) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top)  * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top)  * scaleY,
    };
  };

  const startDraw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    e.preventDefault();
    setIsDrawing(true);
    lastPos.current = getPos(e, canvas);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const draw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    e.preventDefault();
    const ctx = canvas.getContext('2d');
    if (!ctx || !lastPos.current) return;
    const pos = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    lastPos.current = pos;
    setHasDrawn(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDrawing]);

  const endDraw = useCallback(() => {
    setIsDrawing(false);
    lastPos.current = null;
  }, []);

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  };

  // ── Typed sig → canvas data URL ────────────────────────────────────────

  const typedSigDataUrl = useCallback((): string => {
    const canvas = document.createElement('canvas');
    canvas.width  = 520;
    canvas.height = 120;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle    = '#0f172a';
    ctx.font         = `italic 52px "Dancing Script", "Brush Script MT", cursive, Georgia`;
    ctx.textBaseline = 'middle';
    ctx.fillText(typedSig.trim() || signerName.trim(), 20, canvas.height / 2);
    return canvas.toDataURL('image/png');
  }, [typedSig, signerName]);

  // ── Validation ─────────────────────────────────────────────────────────

  const canSubmit =
    signerName.trim().length >= 2 &&
    agreed &&
    (mode === 'draw' ? hasDrawn : !!(typedSig.trim() || signerName.trim()));

  // ── Submit ─────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    setError(null);

    if (!signerName.trim() || signerName.trim().length < 2) {
      setError('Please enter your full legal name.');
      return;
    }
    if (!agreed) {
      setError('You must agree to the terms to sign.');
      return;
    }

    let signatureData: string | null = null;
    if (mode === 'draw') {
      if (!hasDrawn) {
        setError('Please draw your signature in the box above.');
        return;
      }
      signatureData = canvasRef.current?.toDataURL('image/png') ?? null;
    } else {
      signatureData = typedSigDataUrl();
    }

    setUiState('signing');

    try {
      const res = await fetch(`/api/proposals/${proposalId}/sign`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          signerName:    signerName.trim(),
          signerEmail:   signerEmail.trim() || undefined,
          signature:     signatureData,
          agreedToTerms: true,
          token:         token ?? undefined,
        }),
      });

      const data = await res.json().catch(() => ({})) as Record<string, unknown>;

      if (!res.ok) {
        setUiState('error');
        setError((data.error as string) || 'Signature submission failed. Please try again.');
        return;
      }

      setSignedBy(signerName.trim());
      setUiState('signed');
      onSuccess(signerName.trim());
    } catch {
      setUiState('error');
      setError('Network error. Please check your connection and try again.');
    }
  };

  // ── Signed state ───────────────────────────────────────────────────────

  if (uiState === 'signed') {
    return (
      <div
        data-testid="signature-block-signed"
        className="rounded-2xl border p-8 text-center"
        style={{ background: '#052e16', borderColor: '#166534' }}
      >
        <div className="w-14 h-14 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center mx-auto mb-4">
          <CheckCircle size={28} className="text-emerald-400" />
        </div>
        <h3 className="text-emerald-300 font-black text-xl mb-2">✨ Proposal Signed & Accepted!</h3>
        <p className="text-emerald-200/80 text-sm mb-1">
          {signedBy ? `Signed by ${signedBy}.` : ''}{' '}
          Your installer has been notified and will be in touch within 24 hours.
        </p>
        <p className="text-emerald-600 text-xs mt-3">
          A record of your signature has been saved for {proposalTitle}.
        </p>
      </div>
    );
  }

  // ── Idle / error state ─────────────────────────────────────────────────

  return (
    <div
      data-testid="signature-block"
      className="rounded-2xl border border-slate-700/60 bg-slate-900/60 p-6"
    >
      {/* Header */}
      <div className="flex items-start gap-3 mb-5">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: `${primaryColor}20`, border: `1px solid ${primaryColor}40` }}
        >
          <PenLine size={18} style={{ color: primaryColor }} />
        </div>
        <div>
          <h3 className="text-white font-bold text-base">Sign & Accept Proposal</h3>
          <p className="text-slate-400 text-xs mt-0.5">{proposalTitle}</p>
        </div>
      </div>

      {/* Name + Email */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <div>
          <label className="text-xs text-slate-400 mb-1 block font-medium">
            Full Name <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={signerName}
            onChange={e => setSignerName(e.target.value)}
            placeholder="Your full legal name"
            data-testid="signer-name-input"
            className="w-full bg-slate-800 border border-slate-600/60 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 outline-none focus:border-amber-500/60 transition-colors"
          />
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1 block font-medium">
            Email <span className="text-slate-600">(optional)</span>
          </label>
          <input
            type="email"
            value={signerEmail}
            onChange={e => setSignerEmail(e.target.value)}
            placeholder="your@email.com"
            data-testid="signer-email-input"
            className="w-full bg-slate-800 border border-slate-600/60 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 outline-none focus:border-amber-500/60 transition-colors"
          />
        </div>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-2 mb-3">
        {(['draw', 'type'] as Mode[]).map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            data-testid={`mode-btn-${m}`}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              mode === m ? 'text-slate-900' : 'bg-slate-800 text-slate-400 hover:text-white'
            }`}
            style={mode === m ? { background: primaryColor } : {}}
          >
            {m === 'draw' ? <PenLine size={12} /> : <Type size={12} />}
            {m === 'draw' ? 'Draw' : 'Type'}
          </button>
        ))}
      </div>

      {/* Signature area */}
      {mode === 'draw' ? (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-slate-400">Draw your signature below</span>
            <button
              onClick={clearCanvas}
              data-testid="clear-canvas-btn"
              className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              <RotateCcw size={10} /> Clear
            </button>
          </div>
          <div
            className="rounded-xl border-2 border-dashed border-slate-600 overflow-hidden bg-slate-50"
            style={{ touchAction: 'none' }}
          >
            <canvas
              ref={canvasRef}
              width={520}
              height={120}
              data-testid="signature-canvas"
              className="w-full block cursor-crosshair"
              style={{ height: '120px', background: '#f8fafc' }}
              onMouseDown={startDraw}
              onMouseMove={draw}
              onMouseUp={endDraw}
              onMouseLeave={endDraw}
              onTouchStart={startDraw}
              onTouchMove={draw}
              onTouchEnd={endDraw}
            />
          </div>
          {!hasDrawn ? (
            <p className="text-xs text-slate-600 mt-1.5 text-center">← Sign with your mouse or finger</p>
          ) : null}
        </div>
      ) : (
        <div className="mb-4">
          <span className="text-xs text-slate-400 block mb-1.5">Type your name as signature</span>
          <input
            type="text"
            value={typedSig}
            onChange={e => setTypedSig(e.target.value)}
            placeholder={signerName || 'Your signature'}
            data-testid="typed-sig-input"
            className="w-full bg-slate-50 border-2 border-dashed border-slate-400 rounded-xl px-4 py-4 text-slate-900 outline-none text-2xl italic"
            style={{ fontFamily: '"Dancing Script", "Brush Script MT", cursive, Georgia', height: '72px' }}
          />
        </div>
      )}

      {/* Agreement checkbox */}
      <label className="flex items-start gap-2.5 mb-4 cursor-pointer">
        <input
          type="checkbox"
          checked={agreed}
          onChange={e => setAgreed(e.target.checked)}
          data-testid="agree-checkbox"
          className="mt-0.5 w-4 h-4 accent-amber-500 cursor-pointer flex-shrink-0"
        />
        <span className="text-xs text-slate-400 leading-relaxed">
          I confirm I have read this proposal and agree to its terms. This electronic signature
          is legally binding under the ESIGN Act and UETA. A timestamp and IP address will be
          recorded for audit purposes.
        </span>
      </label>

      {/* Error */}
      {(uiState === 'error' || error) ? (
        <div
          data-testid="signature-error"
          className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2 mb-3"
        >
          <AlertTriangle size={12} className="flex-shrink-0" />
          {error}
        </div>
      ) : null}

      {/* Submit button */}
      <button
        onClick={handleSubmit}
        disabled={!canSubmit || uiState === 'signing'}
        data-testid="sign-submit-btn"
        className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-black text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 active:scale-[0.98]"
        style={{
          background: canSubmit && uiState !== 'signing' ? primaryColor : '#334155',
          color:      canSubmit && uiState !== 'signing' ? '#0f172a'    : '#64748b',
        }}
      >
        {uiState === 'signing' ? (
          <><Loader2 size={14} className="animate-spin" /> Submitting…</>
        ) : (
          <><CheckCircle size={14} /> Sign &amp; Accept Proposal</>
        )}
      </button>

      {/* Trust indicators */}
      <div className="flex items-center justify-center gap-4 mt-3">
        <div className="flex items-center gap-1 text-xs text-slate-600">
          <Shield size={10} /> Legally binding
        </div>
        <div className="text-slate-700 text-xs">·</div>
        <div className="text-xs text-slate-600">No DocuSign needed</div>
        <div className="text-slate-700 text-xs">·</div>
        <div className="text-xs text-slate-600">Encrypted & stored</div>
      </div>
    </div>
  );
}
