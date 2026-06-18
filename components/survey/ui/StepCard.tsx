// ============================================================================
// v47.437 - Survey V2: StepCard
//
// A container card for each survey step section. Provides consistent padding,
// border, rounded corners, and an optional section title + subtitle.
// Pure ASCII, no Unicode.
// ============================================================================

import React from 'react';

interface StepCardProps {
  title?: string;
  subtitle?: string;
  className?: string;
  children: React.ReactNode;
}

export function StepCard({ title, subtitle, className = '', children }: StepCardProps) {
  return (
    <div className={`bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden ${className}`}>
      {(title || subtitle) ? (
        <div className="px-5 py-4 border-b border-gray-100 bg-gray-50">
          {title ? (
            <h3 className="text-sm font-semibold text-gray-800 tracking-wide uppercase">
              {title}
            </h3>
          ) : null}
          {subtitle ? (
            <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>
          ) : null}
        </div>
      ) : null}
      <div className="px-5 py-5">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StepField - labeled field wrapper inside a StepCard
// ---------------------------------------------------------------------------
interface StepFieldProps {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}

export function StepField({
  label,
  required,
  hint,
  error,
  children,
  className = '',
}: StepFieldProps) {
  return (
    <div className={`mb-5 last:mb-0 ${className}`}>
      <label className="block mb-1.5">
        <span className="text-sm font-medium text-gray-700">
          {label}
          {required ? (
            <span className="ml-0.5 text-red-500" aria-hidden="true">
              *
            </span>
          ) : null}
        </span>
        {hint ? (
          <span className="block text-xs text-gray-400 mt-0.5">{hint}</span>
        ) : null}
      </label>
      {children}
      {error ? (
        <p className="mt-1 text-xs text-red-500">{error}</p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StepTextArea - multiline text input
// ---------------------------------------------------------------------------
interface StepTextAreaProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
}

export function StepTextArea({
  value,
  onChange,
  placeholder,
  rows = 3,
  disabled,
}: StepTextAreaProps) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      disabled={disabled}
      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800
        placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-500
        focus:border-transparent resize-none disabled:bg-gray-50 disabled:text-gray-400"
    />
  );
}

// ---------------------------------------------------------------------------
// StepInput - single-line text input
// ---------------------------------------------------------------------------
interface StepInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'number' | 'email';
  disabled?: boolean;
}

export function StepInput({
  value,
  onChange,
  placeholder,
  type = 'text',
  disabled,
}: StepInputProps) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800
        placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-500
        focus:border-transparent disabled:bg-gray-50 disabled:text-gray-400"
    />
  );
}

// ---------------------------------------------------------------------------
// StepToggle - yes/no/null boolean toggle
// ---------------------------------------------------------------------------
interface StepToggleProps {
  value: boolean | null;
  onChange: (value: boolean) => void;
  labelYes?: string;
  labelNo?: string;
  disabled?: boolean;
}

export function StepToggle({
  value,
  onChange,
  labelYes = 'Yes',
  labelNo = 'No',
  disabled,
}: StepToggleProps) {
  return (
    <div className="flex gap-2">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(true)}
        className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors
          ${value === true
            ? 'bg-cyan-500 border-cyan-500 text-white'
            : 'bg-white border-gray-300 text-gray-600 hover:border-cyan-400'
          }
          disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {labelYes}
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(false)}
        className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors
          ${value === false
            ? 'bg-gray-700 border-gray-700 text-white'
            : 'bg-white border-gray-300 text-gray-600 hover:border-gray-400'
          }
          disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {labelNo}
      </button>
    </div>
  );
}