'use client';
/**
 * CreateDesignModal — Aurora-parity Create Design modal.
 * See ./DESIGN.md for full spec. See HANDOFF_2026-08-25_AURORA_ANALYSIS.md §5.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  appendDesign,
  DEFAULT_COST_PER_WATT,
  generateDesignId,
  suggestDesignName,
  validateDesignDraft,
  type Design,
  type DesignDraft,
  type DesignValidation,
} from './Design';

export interface CreateDesignModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (design: Design) => void;
  projectId: string;
  existingDesigns?: Design[];
}

const MODAL_TITLE_ID = 'create-design-title';

export default function CreateDesignModal(props: CreateDesignModalProps) {
  const { open, onClose, onCreate, projectId, existingDesigns } = props;

  const nameInputRef = useRef<HTMLInputElement | null>(null);

  const defaultName = useMemo(
    () => suggestDesignName((existingDesigns ?? []).map((d) => d.name)),
    [existingDesigns],
  );

  const [name, setName] = useState<string>(defaultName);
  const [costStr, setCostStr] = useState<string>(String(DEFAULT_COST_PER_WATT));
  const [error, setError] = useState<DesignValidation | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);

  useEffect(() => {
    if (open) {
      setName(defaultName);
      setCostStr(String(DEFAULT_COST_PER_WATT));
      setError(null);
      setSubmitting(false);
    }
  }, [open, defaultName]);

  useEffect(() => {
    if (open) {
      const t = window.setTimeout(() => nameInputRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const parsedCost = useMemo(() => {
    const n = parseFloat(costStr);
    return Number.isFinite(n) ? n : NaN;
  }, [costStr]);

  const draft: DesignDraft = useMemo(
    () => ({ name, costPerWatt: parsedCost }),
    [name, parsedCost],
  );

  const liveValidation = useMemo(() => validateDesignDraft(draft), [draft]);
  const isValid = liveValidation.ok;

  const handleSubmit = useCallback(
    (e?: React.FormEvent) => {
      if (e) e.preventDefault();
      if (submitting) return;

      const v = validateDesignDraft(draft);
      if (!v.ok) {
        setError(v);
        return;
      }

      setError(null);
      setSubmitting(true);
      try {
        const saved: Design = {
          id: generateDesignId(),
          projectId,
          name: draft.name.trim(),
          costPerWatt: Number(draft.costPerWatt),
          createdAt: new Date().toISOString(),
          active: true,
        };
        appendDesign(saved);
        onCreate(saved);
        onClose();
      } finally {
        setSubmitting(false);
      }
    },
    [draft, onClose, onCreate, projectId, submitting],
  );

  const handleCancel = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleBackdropMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose],
  );

  if (!open) return null;

  const nameError = error?.name ?? (liveValidation.ok ? undefined : liveValidation.name);
  const costError = error?.costPerWatt ?? (liveValidation.ok ? undefined : liveValidation.costPerWatt);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={MODAL_TITLE_ID}
      onMouseDown={handleBackdropMouseDown}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(2px)',
        WebkitBackdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
      }}
      data-testid="create-design-modal"
    >
      <div
        style={{
          position: 'relative',
          background: '#ffffff',
          width: 320,
          maxWidth: 'calc(100vw - 32px)',
          borderRadius: 8,
          padding: '20px 24px',
          boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
          color: '#1a1a1a',
        }}
        data-testid="create-design-modal-card"
      >
        <h2
          id={MODAL_TITLE_ID}
          style={{
            margin: '0 0 16px 0',
            fontSize: 16,
            fontWeight: 700,
            textAlign: 'center',
            color: '#1a1a1a',
          }}
        >
          Create Design
        </h2>

        <form onSubmit={handleSubmit} noValidate>
          <FormRow
            label="Name"
            htmlFor="create-design-name"
            error={nameError}
          >
            <input
              ref={nameInputRef}
              id="create-design-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              aria-invalid={Boolean(nameError)}
              aria-describedby={nameError ? 'create-design-name-err' : undefined}
              data-testid="create-design-name-input"
              style={{
                width: 200,
                padding: '6px 8px',
                border: `1px solid ${nameError ? '#c0392b' : '#d0d0d0'}`,
                borderRadius: 4,
                fontSize: 13,
                color: '#1a1a1a',
                background: '#fff',
                outline: 'none',
              }}
            />
          </FormRow>

          <FormRow
            label="Cost $/W"
            htmlFor="create-design-cost"
            error={costError}
          >
            <input
              id="create-design-cost"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              max="100"
              value={costStr}
              onChange={(e) => setCostStr(e.target.value)}
              aria-invalid={Boolean(costError)}
              aria-describedby={costError ? 'create-design-cost-err' : undefined}
              data-testid="create-design-cost-input"
              style={{
                width: 200,
                padding: '6px 8px',
                border: `1px solid ${costError ? '#c0392b' : '#d0d0d0'}`,
                borderRadius: 4,
                fontSize: 13,
                color: '#1a1a1a',
                background: '#fff',
                outline: 'none',
              }}
            />
          </FormRow>

          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 8,
              marginTop: 16,
            }}
          >
            <button
              type="button"
              onClick={handleCancel}
              data-testid="create-design-cancel"
              style={{
                background: 'transparent',
                color: '#555',
                padding: '6px 12px',
                fontSize: 13,
                border: 'none',
                cursor: 'pointer',
                borderRadius: 4,
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!isValid || submitting}
              data-testid="create-design-submit"
              style={{
                background: 'linear-gradient(135deg, #14b8a6, #0d9488)',
                color: '#fff',
                padding: '6px 16px',
                fontSize: 13,
                fontWeight: 600,
                border: 'none',
                borderRadius: 4,
                cursor: !isValid || submitting ? 'not-allowed' : 'pointer',
                opacity: !isValid || submitting ? 0.5 : 1,
              }}
            >
              {submitting ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface FormRowProps {
  label: string;
  htmlFor: string;
  error?: string;
  children: React.ReactNode;
}

function FormRow({ label, htmlFor, error, children }: FormRowProps) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <label
          htmlFor={htmlFor}
          style={{
            fontSize: 12,
            color: '#555',
            flex: '0 0 auto',
            minWidth: 80,
            textAlign: 'right',
          }}
        >
          {label}
        </label>
        {children}
      </div>
      {error ? (
        <div
          id={`${htmlFor}-err`}
          role="alert"
          style={{
            color: '#c0392b',
            fontSize: 12,
            marginTop: 4,
            textAlign: 'right',
          }}
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}
