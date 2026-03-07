'use client';
/**
 * Toast Notification System
 * - Global toast context + hook
 * - Auto-dismiss after 4 seconds
 * - Types: success, error, warning, info, loading
 */
import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { CheckCircle, AlertCircle, AlertTriangle, Info, Loader, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info' | 'loading';

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number; // ms, 0 = persistent
}

interface ToastContextValue {
  toasts: Toast[];
  showToast: (toast: Omit<Toast, 'id'>) => string;
  dismissToast: (id: string) => void;
  success: (title: string, message?: string) => string;
  error: (title: string, message?: string) => string;
  warning: (title: string, message?: string) => string;
  info: (title: string, message?: string) => string;
  loading: (title: string, message?: string) => string;
  update: (id: string, toast: Partial<Omit<Toast, 'id'>>) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) { clearTimeout(timer); timersRef.current.delete(id); }
  }, []);

  const showToast = useCallback((toast: Omit<Toast, 'id'>): string => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const duration = toast.duration !== undefined ? toast.duration : (toast.type === 'loading' ? 0 : 4000);
    setToasts(prev => [...prev.slice(-4), { ...toast, id, duration }]); // max 5 toasts
    if (duration > 0) {
      const timer = setTimeout(() => dismissToast(id), duration);
      timersRef.current.set(id, timer);
    }
    return id;
  }, [dismissToast]);

  const update = useCallback((id: string, updates: Partial<Omit<Toast, 'id'>>) => {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
    // If updating to non-loading type, set auto-dismiss
    if (updates.type && updates.type !== 'loading') {
      const duration = updates.duration !== undefined ? updates.duration : 4000;
      if (duration > 0) {
        const existing = timersRef.current.get(id);
        if (existing) clearTimeout(existing);
        const timer = setTimeout(() => dismissToast(id), duration);
        timersRef.current.set(id, timer);
      }
    }
  }, [dismissToast]);

  const success = useCallback((title: string, message?: string) => showToast({ type: 'success', title, message }), [showToast]);
  const error   = useCallback((title: string, message?: string) => showToast({ type: 'error',   title, message, duration: 6000 }), [showToast]);
  const warning = useCallback((title: string, message?: string) => showToast({ type: 'warning', title, message }), [showToast]);
  const info    = useCallback((title: string, message?: string) => showToast({ type: 'info',    title, message }), [showToast]);
  const loading = useCallback((title: string, message?: string) => showToast({ type: 'loading', title, message, duration: 0 }), [showToast]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => { timersRef.current.forEach(t => clearTimeout(t)); };
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, showToast, dismissToast, success, error, warning, info, loading, update }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

// ─── Toast Container ──────────────────────────────────────────────────────────
function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-2 pointer-events-none" aria-live="polite">
      {toasts.map(toast => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

// ─── Individual Toast ─────────────────────────────────────────────────────────
function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Animate in
    const t = setTimeout(() => setVisible(true), 10);
    return () => clearTimeout(t);
  }, []);

  const icons: Record<ToastType, React.ReactNode> = {
    success: <CheckCircle size={16} className="text-emerald-400 flex-shrink-0" />,
    error:   <AlertCircle size={16} className="text-red-400 flex-shrink-0" />,
    warning: <AlertTriangle size={16} className="text-amber-400 flex-shrink-0" />,
    info:    <Info size={16} className="text-blue-400 flex-shrink-0" />,
    loading: <Loader size={16} className="text-amber-400 flex-shrink-0 animate-spin" />,
  };

  const borders: Record<ToastType, string> = {
    success: 'border-emerald-500/30',
    error:   'border-red-500/30',
    warning: 'border-amber-500/30',
    info:    'border-blue-500/30',
    loading: 'border-amber-500/30',
  };

  const glows: Record<ToastType, string> = {
    success: 'shadow-emerald-500/10',
    error:   'shadow-red-500/10',
    warning: 'shadow-amber-500/10',
    info:    'shadow-blue-500/10',
    loading: 'shadow-amber-500/10',
  };

  return (
    <div
      className={`pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-xl border bg-slate-900/95 backdrop-blur-sm shadow-xl transition-all duration-300 min-w-[280px] max-w-[380px] ${borders[toast.type]} ${glows[toast.type]} ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
      }`}
    >
      {icons[toast.type]}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-white leading-tight">{toast.title}</div>
        {toast.message && (
          <div className="text-xs text-slate-400 mt-0.5 leading-relaxed">{toast.message}</div>
        )}
      </div>
      {toast.type !== 'loading' && (
        <button
          onClick={() => onDismiss(toast.id)}
          className="text-slate-500 hover:text-slate-300 transition-colors flex-shrink-0 mt-0.5"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}