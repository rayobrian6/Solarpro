/**
 * lib/consumption/types.ts
 *
 * Schema for the Solarpro Consumption Profile form. Mirrors the Aurora
 * "Consumption" full-page form (aurora_frames/frame_0050.jpg).
 *
 * This file is the single source of truth for the form's data shape.
 * It is consumed by:
 *   - lib/consumption/validation.ts  (pure validation rules)
 *   - lib/consumption/storage.ts      (localStorage read/write)
 *   - lib/consumption/options.ts     (option lists — separate file)
 *   - components/consumption/ConsumptionForm.tsx
 *   - app/api/consumption/route.ts    (POST handler stub)
 *   - tests/consumption.test.ts       (unit tests)
 *
 * Keep this file PURE: no React, no Next, no Node-only imports.
 */

export type ProfileType = 'residential' | 'commercial';

/**
 * Where the consumption numbers came from.
 *   none            → user didn't import data; financial sims will be limited
 *   electric-bill   → user uploaded a PDF/CSV bill and we parsed 12mo of kWh
 *   green-button    → user uploaded a Green Button XML/JSON
 */
export type GreenButtonSource = 'none' | 'electric-bill' | 'green-button';

export interface UtilityProvider {
  /** Stable id, lowercase, no spaces. e.g. "sdge" */
  id: string;
  /** Display name, e.g. "San Diego Gas & Electric Co." */
  name: string;
  /** Two-letter US state code, e.g. "CA" */
  state: string;
  residential: boolean;
  commercial: boolean;
}

export interface UtilityRate {
  /** Stable id, e.g. "sdge-dr" */
  id: string;
  /** FK to UtilityProvider.id */
  providerId: string;
  /** Tariff code, e.g. "DR", "E-1", "B-19" */
  code: string;
  /** Human label, e.g. "DR - Coastal Baseline Region" */
  label: string;
  residential: boolean;
  commercial: boolean;
}

export interface RateEffectivePeriod {
  /** Stable id, e.g. "sdge-dr-2017" */
  id: string;
  /** FK to UtilityRate.id */
  rateId: string;
  /** ISO date "YYYY-MM-DD" */
  effectiveFrom: string;
  /** ISO date or null (= "Present") */
  effectiveTo: string | null;
  /** Human label, e.g. "01 Jan 2017 – Present" */
  label: string;
}

export interface ConsumptionLocation {
  /** Stable id, e.g. "san-diego-miramar-nas" */
  id: string;
  /** Display name (uppercase as Aurora renders it) */
  name: string;
  /** Two-letter state code */
  state: string;
  lat: number;
  lng: number;
  /** NREL TMY3 station id, e.g. "722902" */
  tmyStation?: string;
}

/**
 * The actual form payload. All fields are required EXCEPT the
 * consumption-number fields (monthlyKwh, annualKwh) which are only
 * required when source != 'none'.
 */
export interface ConsumptionProfileForm {
  profileType: ProfileType;
  providerId: string;
  rateId: string;
  ratePeriodId: string;
  locationId: string;
  source: GreenButtonSource;
  /** 12-element array, kWh per month, in calendar order Jan–Dec */
  monthlyKwh?: number[];
  /** Sum of monthlyKwh, or user-entered override */
  annualKwh?: number;
}

/**
 * Server-side record (what the API returns and what localStorage holds).
 */
export interface ConsumptionProfileResult {
  id: string;
  projectId?: string;
  profile: ConsumptionProfileForm;
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

/**
 * Validation result envelope. ok=true means the form is valid.
 * ok=false means errors maps a field name → human message.
 */
export type ValidationResult<T> =
  | { ok: 'success'; data: T }
  | { ok: 'error'; errors: Partial<Record<keyof T, string>> };
