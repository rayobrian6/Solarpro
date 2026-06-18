'use client';
/**
 * SignatureModal.tsx — Digital Signature Capture
 *
 * Two input modes:
 *   1. Draw  — freehand canvas signature
 *   2. Type  — styled text signature (cursive font)
 *
 * Collects: full name (required), email (optional), drawn/typed signature.
 * On submit: POSTs to PATCH /api/proposals/[id]?token=... with { signature, signerName, signerEmail }.
 */
import React, { useRef, useState, useEffect, useCallback } from 'react';
import { X, PenLine, Type, RotateCcw, CheckCircle, AlertTriangle, Loader } from 'lucide-react';

interface Props {
  proposalId: string;
  proposalTitle: string;
  token?: string | null;
  primaryColor?: string;
  onSuccess: (signerName: string) => void;
  onClose: () => void;
}

type Mode = 'draw' | 'type';

export default function SignatureModal({
  proposalId,
  proposalTitle,
  token,
  primaryColor = '#f59e0b',
  onSuccess,
  onClose,
}: Props) {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const [mode, setMode]           = useState<Mode>('draw');
  const [signerName, setSignerName]   = useState('');
  const [signerEmail, setSignerEmail] = useState('');
  const [typedSig, setTypedSig]   = useState('');
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn]   = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  // ── Canvas setup ────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, [mode]);

  const getPos = (e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
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
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  };

  // ── Typed signature preview ─────────────────────────────────────────────────
  const renderTypedSignatureToCanvas = useCallback((): string => {
    const canvas = document.createElement('canvas');
    canvas.width  = 520;
    canvas.height = 120;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#1e293b';
    ctx.font = `italic 52px "Dancing Script", "Brush Script MT", cursive, Georgia`;
    ctx.textBaseline = 'middle';
    ctx.fillText(typedSig || signerName, 20, canvas.height / 2);
    return canvas.toDataURL('image/png');
  }, [typedSig, signerName]);

  // ── Submit ──────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    setError(null);

    if (!signerName.trim() || signerName.trim().length < 2) {
      setError('Please enter your full name to sign.');
      return;
    }

    let signatureData: string | null = null;

    if (mode === 'draw') {
      if (!hasDrawn) {
        setError('Please draw your signature in the box above.');
        return;
      }
      const canvas = canvasRef.current;
      signatureData = canvas ? canvas.toDataURL('image/png') : null;
    } else {
      const name = (typedSig.trim() || signerName.trim());
      if (!name) {
        setError('Please enter your signature text.');
        return;
      }
      signatureData = renderTypedSignatureToCanvas();
    }

    setSubmitting(true);
    try {
      const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : '';
      const res = await fetch(`/api/proposals/${proposalId}${tokenQuery}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signature:   signatureData,
          signerName:  signerName.trim(),
          signerEmail: signerEmail.trim() || undefined,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as any)?.error || 'Signature submission failed. Please try again.');
        return;
      }

      onSuccess(signerName.trim());
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = signerName.trim().length >= 2 && (mode === 'draw' ? hasDrawn : !!(typedSig.trim() || signerName.trim()));

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/60">
          <div>
            <div className="text-sm font-bold text-white">Sign Proposal</div>
            <div className="text-xs text-slate-400 mt-0.5 truncate max-w-xs">{proposalTitle}</div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-700/60 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">

          {/* Signer info */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Full Name <span className="text-red-400">*</span></label>
              <input
                type="text"
                value={signerName}
                onChange={e => setSignerName(e.target.value)}
                placeholder="Your full legal name"
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 outline-none focus:border-amber-500/60 transition-colors"
                autoFocus
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Email <span className="text-slate-600">(optional)</span></label>
              <input
                type="email"
                value={signerEmail}
                onChange={e => setSignerEmail(e.target.value)}
                placeholder="your@email.com"
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 outline-none focus:border-amber-500/60 transition-colors"
              />
            </div>
          </div>

          {/* Mode toggle */}
          <div className="flex gap-2">
            {([['draw', <PenLine size={13} key="draw" />, 'Draw'] , ['type', <Type size={13} key="type" />, 'Type']] as [Mode, React.ReactNode, string][]).map(([m, icon, label]) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  mode === m
                    ? 'text-slate-900'
                    : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700'
                }`}
                style={mode === m ? { background: primaryColor } : {}}
              >
                {icon}{label}
              </button>
            ))}
          </div>

          {/* Signature area */}
          {mode === 'draw' ? (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-slate-400">Draw your signature below</span>
                <button
                  onClick={clearCanvas}
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors"
                >
                  <RotateCcw size={11} /> Clear
                </button>
              </div>
              <div
                className="rounded-xl border-2 border-dashed border-slate-600 overflow-hidden"
                style={{ touchAction: 'none' }}
              >
                <canvas
                  ref={canvasRef}
                  width={520}
                  height={120}
                  className="w-full block cursor-crosshair bg-white"
                  style={{ height: '120px' }}
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
            <div>
              <div className="mb-2">
                <span className="text-xs text-slate-400">Type your name as it will appear</span>
              </div>
              <input
                type="text"
                value={typedSig}
                onChange={e => setTypedSig(e.target.value)}
                placeholder={signerName || 'Your signature'}
                className="w-full bg-white border-2 border-dashed border-slate-400 rounded-xl px-4 py-4 text-slate-900 outline-none text-2xl italic"
                style={{ fontFamily: '"Dancing Script", "Brush Script MT", cursive, Georgia', height: '72px' }}
              />
            </div>
          )}

          {/* Legal disclosure */}
          <div className="bg-slate-800/50 rounded-lg px-3 py-2.5 text-xs text-slate-400 leading-relaxed">
            By signing, I confirm I have read this proposal and agree to its terms.
            This electronic signature is legally binding under the ESIGN Act and UETA.
            A copy will be recorded with timestamp and IP address for audit purposes.
          </div>

          {/* Error */}
          {error ? (
            <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">
              <AlertTriangle size={12} className="flex-shrink-0" />
              {error}
            </div>
          ) : null}

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 active:scale-[0.98]"
            style={{ background: canSubmit ? primaryColor : '#334155', color: canSubmit ? '#0f172a' : '#64748b' }}
          >
            {submitting ? (
              <><Loader size={14} className="animate-spin" /> Submitting…</>
            ) : (
              <><CheckCircle size={14} /> Sign &amp; Accept Proposal</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
