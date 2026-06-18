'use client';
import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

/**
 * ActionModal — shared modal chrome for all execution modals.
 * Clean, minimal, fast. Uses the design system tokens.
 */
interface ActionModalProps {
  title: string;
  subtitle?: string;
  accentColor?: string;
  icon?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: string;
}

export default function ActionModal({
  title, subtitle, accentColor = 'var(--accent-amber)',
  icon, onClose, children, maxWidth = '480px',
}: ActionModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === overlayRef.current) onClose(); }}>
      <div className="w-full rounded-2xl overflow-hidden animate-fade-in"
        style={{
          maxWidth,
          background: 'var(--bg-card)',
          border: `1px solid ${accentColor}33`,
          boxShadow: `0 0 0 1px ${accentColor}18, 0 25px 60px rgba(0,0,0,0.5)`,
        }}
        onClick={e => e.stopPropagation()}>
        {/* Accent bar */}
        <div className="h-0.5" style={{ background: accentColor }} />

        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-5 pb-3">
          <div className="flex items-center gap-3">
            {icon ? (
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: `${accentColor}18` }}>
                <span style={{ color: accentColor }}>{icon}</span>
              </div>
            ) : null}
            <div>
              <h2 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>{title}</h2>
              {subtitle ? <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{subtitle}</p> : null}
            </div>
          </div>
          <button onClick={onClose}
            className="p-1.5 rounded-lg transition-colors hover:bg-white/5"
            style={{ color: 'var(--text-muted)' }}>
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 pb-6">
          {children}
        </div>
      </div>
    </div>
  );
}