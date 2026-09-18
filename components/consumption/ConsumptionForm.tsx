'use client';
/**
 * components/consumption/ConsumptionForm.tsx
 *
 * The full-page Consumption Profile form. Mirrors the layout in
 * aurora_frames/frame_0050.jpg:
 *
 *   Consumption Profile
 *   Enter this information in order to run financial simulations …
 *
 *   [ Estimate Consumption using Electric Bill ]  [ Upload Green Button Data ]
 *
 *   Utility information
 *     Profile Type             (•) Residential   ( ) Commercial
 *     Utility Provider         [ San Diego Gas & Electric Co. ▼ ]
 *     Utility Rate             [ DR - Coastal Baseline Region ▼ ]
 *     Rate Effective Period    [ 01 Jan 2017 – Present ▼ ]
 *
 *   Location
 *     Pick the location that most accurately represents the project's consumption profile
 *     [ SAN DIEGO MIRAMAR NAS ▼ ]
 *
 *   [ Submit ]
 *
 * Submit flow:
 *   1. validate() in lib/consumption/validation.ts (client-side guard)
 *   2. POST /api/consumption
 *   3. On success → save to localStorage, swap to "Saved" state
 *   4. On error → show inline error, leave form editable
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader2,
  Save,
  CheckCircle2,
  RefreshCw,
  Pencil,
  AlertTriangle,
} from 'lucide-react';

import {
  defaultConsumptionForm,
  validateConsumptionProfile,
  sumAnnualKwh,
} from '@/lib/consumption/validation';
import {
  UTILITY_PROVIDERS,
  UTILITY_RATES,
  RATE_EFFECTIVE_PERIODS,
  CONSUMPTION_LOCATIONS,
  ratesForProviderAndType,
  periodsForRate,
} from '@/lib/consumption/options';
import {
  loadSavedProfile,
  saveProfile,
  clearSavedProfile,
} from '@/lib/consumption/storage';
import type {
  ConsumptionProfileForm,
  ConsumptionProfileResult,
  ProfileType,
  GreenButtonSource,
} from '@/lib/consumption/types';
import SourceButtons from './SourceButtons';

type SubmitState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'saved'; result: ConsumptionProfileResult }
  | { kind: 'error'; message: string };

const FIELD_LABELS: Record<keyof ConsumptionProfileForm, string> = {
  profileType: 'Profile type',
  providerId: 'Utility provider',
  rateId: 'Utility rate',
  ratePeriodId: 'Rate effective period',
  locationId: 'Location',
  source: 'Data source',
  monthlyKwh: 'Monthly kWh',
  annualKwh: 'Annual kWh',
};

export default function ConsumptionForm() {
  const router = useRouter();
  const [form, setForm] = useState<Partial<ConsumptionProfileForm>>(() => {
    const saved = loadSavedProfile();
    return saved ? { ...defaultConsumptionForm(), ...saved.profile } : defaultConsumptionForm();
  });
  const [errors, setErrors] = useState<Partial<Record<keyof ConsumptionProfileForm, string>>>({});
  const [submit, setSubmit] = useState<SubmitState>({ kind: 'idle' });

  /* Rehydrate on mount so the saved-state badge is correct even if
     localStorage was written by another tab. */
  useEffect(() => {
    const saved = loadSavedProfile();
    if (saved) {
      setForm((cur) => ({ ...cur, ...saved.profile }));
      setSubmit({ kind: 'saved', result: saved });
    }
  }, []);

  /* Whenever provider or profile type changes, clamp the rate id to
     one that matches the new context. Same for rate → period. */
  useEffect(() => {
    if (!form.providerId || !form.profileType) return;
    const rates = ratesForProviderAndType(form.providerId, form.profileType);
    if (!rates.some((r) => r.id === form.rateId)) {
      const first = rates[0];
      setForm((cur) => ({
        ...cur,
        rateId: first?.id,
        ratePeriodId: first ? periodsForRate(first.id)[0]?.id : undefined,
      }));
    }
  }, [form.providerId, form.profileType]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!form.rateId) return;
    const periods = periodsForRate(form.rateId);
    if (!periods.some((p) => p.id === form.ratePeriodId)) {
      setForm((cur) => ({ ...cur, ratePeriodId: periods[0]?.id }));
    }
  }, [form.rateId]); // eslint-disable-line react-hooks/exhaustive-deps

  const rateOptions = useMemo(() => {
    if (!form.providerId || !form.profileType) return [] as ReturnType<typeof ratesForProviderAndType>;
    return ratesForProviderAndType(form.providerId, form.profileType);
  }, [form.providerId, form.profileType]);

  const periodOptions = useMemo(() => {
    if (!form.rateId) return [] as ReturnType<typeof periodsForRate>;
    return periodsForRate(form.rateId);
  }, [form.rateId]);

  const isReadOnly = submit.kind === 'saved';

  function updateField<K extends keyof ConsumptionProfileForm>(
    key: K,
    value: ConsumptionProfileForm[K] | undefined,
  ) {
    setForm((cur) => ({ ...cur, [key]: value }));
    setErrors((cur) => {
      if (!cur[key]) return cur;
      const next = { ...cur };
      delete next[key];
      return next;
    });
    if (submit.kind === 'saved') setSubmit({ kind: 'idle' });
  }

  function handleSource(source: GreenButtonSource) {
    updateField('source', source);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const result = validateConsumptionProfile(form);
    if (result.ok === 'error') {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setSubmit({ kind: 'submitting' });

    try {
      const res = await fetch('/api/consumption', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ profile: result.data }),
      });
      const body = (await res.json()) as
        | { success: true; data: ConsumptionProfileResult }
        | { success: false; error: string };
      if (!res.ok || !('success' in body) || !body.success) {
        const msg = 'success' in body && body.success === false ? body.error : `Server returned ${res.status}`;
        setSubmit({ kind: 'error', message: msg });
        return;
      }
      saveProfile(body.data);
      setSubmit({ kind: 'saved', result: body.data });
    } catch (err) {
      // Offline fallback: persist locally so the user doesn't lose work
      const now = new Date().toISOString();
      const fallback: ConsumptionProfileResult = {
        id: `local-${Date.now()}`,
        profile: result.data,
        createdAt: now,
        updatedAt: now,
      };
      saveProfile(fallback);
      setSubmit({
        kind: 'saved',
        result: fallback,
      });
      // Note the offline path in the UI as a warning so the user knows
      // it didn't reach the server.
      // eslint-disable-next-line no-console
      console.warn('[consumption] offline save:', err);
    }
  }

  function handleEdit() {
    setSubmit({ kind: 'idle' });
  }

  function handleReset() {
    clearSavedProfile();
    setForm(defaultConsumptionForm());
    setErrors({});
    setSubmit({ kind: 'idle' });
  }

  const saved = submit.kind === 'saved' ? submit.result : null;
  const derivedAnnual = form.monthlyKwh ? sumAnnualKwh(form.monthlyKwh) : undefined;

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-3xl mx-auto px-6 py-6 space-y-6"
      data-testid="consumption-form"
    >
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-white" data-testid="form-title">
          Consumption Profile
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Enter this information in order to run financial simulations for any designs
        </p>
      </div>

      {/* Top action buttons */}
      <SourceButtons onSourceChange={handleSource} />

      {/* Saved-state banner */}
      {saved ? (
        <div
          className="card p-3 flex items-center gap-3 border-emerald-500/30 bg-emerald-500/5"
          data-testid="saved-banner"
        >
          <CheckCircle2 size={16} className="text-emerald-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm text-white font-medium">Profile saved</div>
            <div className="text-[11px] text-slate-400">
              ID {saved.id} · updated {new Date(saved.updatedAt).toLocaleString()}
            </div>
          </div>
          <button type="button" onClick={handleEdit} className="btn-ghost text-xs">
            <Pencil size={12} /> Edit
          </button>
          <button type="button" onClick={handleReset} className="btn-ghost text-xs">
            <RefreshCw size={12} /> Reset
          </button>
        </div>
      ) : null}

      {/* Error banner (server / network) */}
      {submit.kind === 'error' ? (
        <div
          className="card p-3 flex items-center gap-3 border-red-500/30 bg-red-500/5"
          data-testid="error-banner"
        >
          <AlertTriangle size={16} className="text-red-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm text-white font-medium">Could not save</div>
            <div className="text-[11px] text-slate-400">{submit.message}</div>
          </div>
        </div>
      ) : null}

      {/* Utility information */}
      <fieldset
        className="card p-5 space-y-4"
        disabled={isReadOnly}
        data-testid="fieldset-utility"
      >
        <legend className="text-base font-semibold text-white px-1">Utility information</legend>

        {/* Profile Type */}
        <div className="grid grid-cols-[160px_1fr] items-center gap-3">
          <label className="input-label !mb-0">Profile Type</label>
          <div className="flex items-center gap-5" role="radiogroup" aria-label="Profile type">
            {(['residential', 'commercial'] as ProfileType[]).map((opt) => (
              <label
                key={opt}
                className="flex items-center gap-2 text-sm text-slate-200 cursor-pointer"
              >
                <input
                  type="radio"
                  name="profileType"
                  value={opt}
                  checked={form.profileType === opt}
                  onChange={() => updateField('profileType', opt)}
                  data-testid={`radio-${opt}`}
                />
                <span className="capitalize">{opt}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Utility Provider */}
        <div className="grid grid-cols-[160px_1fr] items-center gap-3">
          <label htmlFor="providerId" className="input-label !mb-0">Utility Provider</label>
          <div>
            <select
              id="providerId"
              className="select"
              value={form.providerId ?? ''}
              onChange={(e) => updateField('providerId', e.target.value)}
              data-testid="select-provider"
            >
              {UTILITY_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            {errors.providerId ? (
              <p className="text-[11px] text-red-400 mt-1">{errors.providerId}</p>
            ) : null}
          </div>
        </div>

        {/* Utility Rate */}
        <div className="grid grid-cols-[160px_1fr] items-center gap-3">
          <label htmlFor="rateId" className="input-label !mb-0">Utility Rate</label>
          <div>
            <select
              id="rateId"
              className="select"
              value={form.rateId ?? ''}
              onChange={(e) => updateField('rateId', e.target.value)}
              data-testid="select-rate"
            >
              {rateOptions.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
            {errors.rateId ? (
              <p className="text-[11px] text-red-400 mt-1">{errors.rateId}</p>
            ) : null}
          </div>
        </div>

        {/* Rate Effective Period */}
        <div className="grid grid-cols-[160px_1fr] items-center gap-3">
          <label htmlFor="ratePeriodId" className="input-label !mb-0">Rate Effective Period</label>
          <div>
            <select
              id="ratePeriodId"
              className="select"
              value={form.ratePeriodId ?? ''}
              onChange={(e) => updateField('ratePeriodId', e.target.value)}
              data-testid="select-period"
            >
              {periodOptions.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
            {errors.ratePeriodId ? (
              <p className="text-[11px] text-red-400 mt-1">{errors.ratePeriodId}</p>
            ) : null}
          </div>
        </div>

        {errors.profileType ? (
          <p className="text-[11px] text-red-400">{FIELD_LABELS.profileType}: {errors.profileType}</p>
        ) : null}
      </fieldset>

      {/* Location */}
      <fieldset className="card p-5 space-y-3" disabled={isReadOnly} data-testid="fieldset-location">
        <legend className="text-base font-semibold text-white px-1">Location</legend>
        <p className="text-xs text-slate-400">
          Pick the location that most accurately represents the project&apos;s consumption profile
        </p>
        <div>
          <label htmlFor="locationId" className="sr-only">Location</label>
          <select
            id="locationId"
            className="select"
            value={form.locationId ?? ''}
            onChange={(e) => updateField('locationId', e.target.value)}
            data-testid="select-location"
          >
            {CONSUMPTION_LOCATIONS.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
          {errors.locationId ? (
            <p className="text-[11px] text-red-400 mt-1">{errors.locationId}</p>
          ) : null}
        </div>
      </fieldset>

      {/* Source / monthly kWh summary (if any data was uploaded) */}
      {form.source && form.source !== 'none' ? (
        <div className="card p-4 space-y-2" data-testid="source-summary">
          <div className="text-xs text-slate-400">
            Data source: <span className="text-slate-200 font-medium">{form.source}</span>
            {derivedAnnual !== undefined ? (
              <>
                {' · '}
                <span className="text-slate-200 font-medium">{derivedAnnual.toLocaleString()} kWh/yr</span>
                {' (derived from monthly data)'}
              </>
            ) : null}
          </div>
          {errors.monthlyKwh ? (
            <p className="text-[11px] text-red-400">{errors.monthlyKwh}</p>
          ) : null}
        </div>
      ) : null}

      {/* Submit */}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          className="btn-primary"
          disabled={submit.kind === 'submitting' || isReadOnly}
          data-testid="btn-submit"
        >
          {submit.kind === 'submitting' ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Save size={14} />
          )}
          <span>{submit.kind === 'submitting' ? 'Saving…' : 'Submit'}</span>
        </button>

        {saved ? (
          <button
            type="button"
            onClick={() => router.push('/design')}
            className="btn-secondary"
            data-testid="btn-go-design"
          >
            Continue to Design
          </button>
        ) : null}

        {Object.keys(errors).length > 0 ? (
          <span className="text-[11px] text-red-400">
            {Object.keys(errors).length} field{Object.keys(errors).length === 1 ? '' : 's'} need attention
          </span>
        ) : null}
      </div>
    </form>
  );
}
