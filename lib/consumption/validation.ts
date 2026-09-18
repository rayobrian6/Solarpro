/**
 * lib/consumption/validation.ts
 *
 * Pure validation for the Consumption Profile form. PURE — no React,
 * no fetch, no fs. Imported by:
 *   - components/consumption/ConsumptionForm.tsx  (client-side guard)
 *   - app/api/consumption/route.ts                (server-side guard)
 *   - tests/consumption.test.ts                   (unit tests)
 *
 * Rules are documented in app/consumption/DESIGN.md §4.
 */

import type {
  ConsumptionProfileForm,
  ProfileType,
  ValidationResult,
} from './types';
import {
  getProvider,
  getRate,
  getRatePeriod,
  getLocation,
  ratesForProviderAndType,
  periodsForRate,
} from './options';

/** Months in a year — used by R7 (12-element monthly kWh array). */
export const MONTHS_IN_YEAR = 12;

/** Reasonable bounds for an annual residential consumption figure. */
export const MIN_ANNUAL_KWH = 100;
export const MAX_ANNUAL_KWH = 100_000;

const PROFILE_TYPES: readonly ProfileType[] = ['residential', 'commercial'] as const;

/**
 * Validate a ConsumptionProfileForm. Returns a discriminated union:
 *   - { ok: true,  data }            on success
 *   - { ok: false, errors }          on failure (errors map a field name → msg)
 */
export function validateConsumptionProfile(
  form: Partial<ConsumptionProfileForm>,
): ValidationResult<ConsumptionProfileForm> {
  const errors: Partial<Record<keyof ConsumptionProfileForm, string>> = {};

  // ── R1: profileType ──────────────────────────────────────────────
  if (!form.profileType) {
    errors.profileType = 'Profile type is required';
  } else if (!PROFILE_TYPES.includes(form.profileType)) {
    errors.profileType = 'Profile type must be residential or commercial';
  }

  // ── R2: providerId ───────────────────────────────────────────────
  if (!form.providerId) {
    errors.providerId = 'Utility provider is required';
  } else if (!getProvider(form.providerId)) {
    errors.providerId = 'Unknown utility provider';
  }

  // ── R3 + R4: rateId (must exist, match profileType, match providerId) ──
  if (!form.rateId) {
    errors.rateId = 'Utility rate is required';
  } else {
    const rate = getRate(form.rateId);
    if (!rate) {
      errors.rateId = 'Unknown utility rate';
    } else if (form.profileType && !rate[form.profileType]) {
      errors.rateId = `Rate ${rate.code} is not available for ${form.profileType} customers`;
    } else if (form.providerId && rate.providerId !== form.providerId) {
      errors.rateId = 'Selected rate does not belong to the selected provider';
    }
  }

  // ── R5: ratePeriodId (must exist for the rate) ──────────────────
  if (!form.ratePeriodId) {
    errors.ratePeriodId = 'Rate effective period is required';
  } else {
    const period = getRatePeriod(form.ratePeriodId);
    if (!period) {
      errors.ratePeriodId = 'Unknown rate effective period';
    } else if (form.rateId && period.rateId !== form.rateId) {
      errors.ratePeriodId = 'Selected period does not apply to the selected rate';
    }
  }

  // ── R6: locationId ──────────────────────────────────────────────
  if (!form.locationId) {
    errors.locationId = 'Location is required';
  } else if (!getLocation(form.locationId)) {
    errors.locationId = 'Unknown location';
  }

  // ── source (no error if missing — defaults to 'none') ───────────
  if (form.source && !['none', 'electric-bill', 'green-button'].includes(form.source)) {
    errors.source = 'Invalid data source';
  }

  // ── R7: monthlyKwh when source is electric-bill or green-button ──
  if (form.source === 'electric-bill' || form.source === 'green-button') {
    if (!Array.isArray(form.monthlyKwh)) {
      errors.monthlyKwh = 'Monthly kWh data is required when importing a bill or Green Button file';
    } else if (form.monthlyKwh.length !== MONTHS_IN_YEAR) {
      errors.monthlyKwh = `Expected ${MONTHS_IN_YEAR} months of data, got ${form.monthlyKwh.length}`;
    } else {
      for (let i = 0; i < form.monthlyKwh.length; i++) {
        const v = form.monthlyKwh[i];
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
          errors.monthlyKwh = `Month ${i + 1} has an invalid kWh value`;
          break;
        }
      }
    }
  }

  // ── R8: annualKwh bounds (if explicitly provided) ───────────────
  if (form.annualKwh !== undefined) {
    if (
      typeof form.annualKwh !== 'number' ||
      !Number.isFinite(form.annualKwh) ||
      form.annualKwh < MIN_ANNUAL_KWH ||
      form.annualKwh > MAX_ANNUAL_KWH
    ) {
      errors.annualKwh = `Annual kWh must be between ${MIN_ANNUAL_KWH.toLocaleString()} and ${MAX_ANNUAL_KWH.toLocaleString()}`;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: 'error', errors } as const;
  }

  // Happy path — narrow Partial<Form> → Form. The discriminator check
  // above guarantees every required key is present and well-typed.
  return {
    ok: 'success',
    data: {
      profileType: form.profileType as ProfileType,
      providerId: form.providerId as string,
      rateId: form.rateId as string,
      ratePeriodId: form.ratePeriodId as string,
      locationId: form.locationId as string,
      source: form.source ?? 'none',
      ...(form.monthlyKwh !== undefined ? { monthlyKwh: form.monthlyKwh } : {}),
      ...(form.annualKwh !== undefined ? { annualKwh: form.annualKwh } : {}),
    },
  } as const;
}

/**
 * Sum a 12-element monthly kWh array to an annual figure. Returns
 * undefined if the array is missing or the wrong length — callers
 * that need a guaranteed number should validate first.
 */
export function sumAnnualKwh(monthlyKwh: number[] | undefined): number | undefined {
  if (!Array.isArray(monthlyKwh) || monthlyKwh.length !== MONTHS_IN_YEAR) return undefined;
  let total = 0;
  for (const v of monthlyKwh) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
    total += v;
  }
  return total;
}

/**
 * Default form (used by the form component's initial state). Aurora
 * pre-fills with SDG&E + Coastal Baseline + San Diego Miramar NAS
 * (the values in the screenshot), so we match that.
 */
export function defaultConsumptionForm(): Partial<ConsumptionProfileForm> {
  return {
    profileType: 'residential',
    providerId: 'sdge',
    rateId: 'sdge-dr',
    ratePeriodId: 'sdge-dr-2017-present',
    locationId: 'san-diego-miramar-nas',
    source: 'none',
  };
}

/* ────────────────────────────────────────────────────────────────────
 * Light sanity checks the test suite runs on the option lists
 * themselves. These run once per import (cheap, <1ms).
 * ──────────────────────────────────────────────────────────────────── */

let _optionConsistencyChecked: boolean = false;
export function ensureOptionConsistency(): void {
  if (_optionConsistencyChecked) return;
  _optionConsistencyChecked = true;

  // The default rate must exist for the default provider. This is a
  // runtime sanity check, not a guarantee — full coverage lives in
  // tests/consumption.test.ts.
  const def = defaultConsumptionForm();
  if (def.providerId && def.rateId) {
    const rates = ratesForProviderAndType(def.providerId, def.profileType ?? 'residential');
    if (!rates.some((r) => r.id === def.rateId)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[consumption] default rate "${def.rateId}" not in provider "${def.providerId}" list`,
      );
    }
  }
}
