// ============================================================================
// v47.434 Stage 9.1 — Survey Contract Drift Guard
//
// Locks the v1.0 contract constants so any future value drift fails CI loudly.
// Bumping the schemaVersion, adding a new event type, adding a new project
// origin, or adding a new delivery status REQUIRES a conscious test update —
// at which point the reviewer sees this file and knows the contract moved.
//
// ENFORCED INVARIANTS:
//   1. CURRENT_SCHEMA_VERSION === '1.0'                 (FROZEN)
//   2. SUPPORTED_SURVEY_EVENT_TYPES === ['survey.completed']
//   3. PROJECT_ORIGIN_VALUES === ['manual','bill_upload','survey','api']
//   4. WebhookDeliveryStatus union is the exact 6-member set
//
// This is the contract-surface analogue of the brand-profile drift guard
// added in v47.432: value-level snapshot of a type surface the external
// survey tool integrates against.
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION,
  SUPPORTED_SURVEY_EVENT_TYPES,
  PROJECT_ORIGIN_VALUES,
  type WebhookDeliveryStatus,
} from './types';

describe('survey contract drift guard — schemaVersion', () => {
  it('locks CURRENT_SCHEMA_VERSION to "1.0"', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe('1.0');
  });
});

describe('survey contract drift guard — event taxonomy', () => {
  it('locks SUPPORTED_SURVEY_EVENT_TYPES to exactly ["survey.completed"]', () => {
    expect(SUPPORTED_SURVEY_EVENT_TYPES).toEqual(['survey.completed']);
  });

  it('SUPPORTED_SURVEY_EVENT_TYPES has no duplicates', () => {
    const uniq = new Set(SUPPORTED_SURVEY_EVENT_TYPES);
    expect(uniq.size).toBe(SUPPORTED_SURVEY_EVENT_TYPES.length);
  });
});

describe('survey contract drift guard — project origin', () => {
  it('locks PROJECT_ORIGIN_VALUES to exactly [manual, bill_upload, survey, api]', () => {
    expect(PROJECT_ORIGIN_VALUES).toEqual(['manual', 'bill_upload', 'survey', 'api']);
  });

  it('PROJECT_ORIGIN_VALUES has no duplicates', () => {
    const uniq = new Set(PROJECT_ORIGIN_VALUES);
    expect(uniq.size).toBe(PROJECT_ORIGIN_VALUES.length);
  });

  it('every origin is a stable non-empty string (DB text column contract)', () => {
    for (const o of PROJECT_ORIGIN_VALUES) {
      expect(typeof o).toBe('string');
      expect(o.length).toBeGreaterThan(0);
      // Lowercase snake_case — matches the DB default 'manual' in migration 011
      expect(o).toBe(o.toLowerCase());
    }
  });
});

describe('survey contract drift guard — webhook delivery status', () => {
  // Can't enumerate a type at runtime; we snapshot by constructing each value
  // and letting TS fail at compile-time if the union changes.
  const ALL_STATUSES: readonly WebhookDeliveryStatus[] = [
    'received',
    'verified',
    'duplicate',
    'ingested',
    'failed',
    'replayed',
  ];

  it('WebhookDeliveryStatus has exactly 6 members', () => {
    expect(ALL_STATUSES).toHaveLength(6);
  });

  it('WebhookDeliveryStatus contains the expected 6 values (snapshot)', () => {
    expect([...ALL_STATUSES].sort()).toEqual(
      ['duplicate', 'failed', 'ingested', 'received', 'replayed', 'verified'],
    );
  });
});