// ============================================================================
// v47.437 - Survey V2: Draft Defaults + JWT Pre-fill
//
// buildInitialDraft() creates a blank SurveyV2Draft pre-filled from the
// decoded JWT handoff token claims. Called on first load of /survey/[token].
//
// If the token has already been started (localStorage key exists), the
// existing draft is returned instead.
// ============================================================================

import type {
  SurveyV2Draft,
  SurveySiteOverview,
  SurveyRoofConditions,
  SurveyElectricalService,
  SurveyObstructions,
  SurveyPhotos,
} from './types';

// ---------------------------------------------------------------------------
// HandoffClaims - decoded JWT payload shape (matches tokenMinter.ts)
// ---------------------------------------------------------------------------
export interface HandoffClaims {
  jti: string;
  project_id: string;
  project_name?: string;
  site_name?: string;
  site_address?: string;
  inspector_name?: string;
  latitude?: number;
  longitude?: number;
  gps_accuracy?: number;
  category_id?: string;
  category_name?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
  iat: number;
  exp: number;
}

// ---------------------------------------------------------------------------
// blankSiteOverview
// ---------------------------------------------------------------------------
function blankSiteOverview(claims: HandoffClaims): SurveySiteOverview {
  return {
    projectName: claims.project_name ?? claims.site_name ?? '',
    siteAddress: claims.site_address ?? '',
    latitude: claims.latitude ?? null,
    longitude: claims.longitude ?? null,
    structureType: '',
    stories: '',
    inspectorName: claims.inspector_name ?? '',
    accessNotes: '',
  };
}

// ---------------------------------------------------------------------------
// blankRoofConditions
// ---------------------------------------------------------------------------
function blankRoofConditions(): SurveyRoofConditions {
  return {
    roofMaterial: '',
    roofPitch: '',
    rafterSpacing: '',
    roofCondition: '',
    roofAgeYears: null,
    atticAccess: null,
    mountingNotes: '',
  };
}

// ---------------------------------------------------------------------------
// blankElectricalService
// ---------------------------------------------------------------------------
function blankElectricalService(): SurveyElectricalService {
  return {
    panelRating: '',
    panelBrand: '',
    availableBreakerSlots: '',
    meterSocketType: '',
    interconnectionPoint: '',
    serviceEntrance: '',
    hasSubPanel: null,
    subPanelRating: '',
    electricalNotes: '',
  };
}

// ---------------------------------------------------------------------------
// blankObstructions
// ---------------------------------------------------------------------------
function blankObstructions(): SurveyObstructions {
  return {
    obstructions: [],
    setbackNotes: '',
    estimatedUsableRoofPct: null,
  };
}

// ---------------------------------------------------------------------------
// blankPhotos
// ---------------------------------------------------------------------------
function blankPhotos(): SurveyPhotos {
  return {
    photos: [],
  };
}

// ---------------------------------------------------------------------------
// buildInitialDraft
//
// Creates a fresh SurveyV2Draft from decoded JWT claims.
// ---------------------------------------------------------------------------
export function buildInitialDraft(claims: HandoffClaims): SurveyV2Draft {
  return {
    token: '',
    projectId: claims.project_id,
    projectName: claims.project_name ?? claims.site_name ?? claims.project_id,
    siteOverview: blankSiteOverview(claims),
    roofConditions: blankRoofConditions(),
    electricalService: blankElectricalService(),
    obstructions: blankObstructions(),
    photos: blankPhotos(),
    currentStep: 1,
    completedSteps: [],
    lastSavedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// DRAFT_STORAGE_KEY - localStorage key for a given survey token
// ---------------------------------------------------------------------------
export function draftStorageKey(jti: string): string {
  return `solarpro_survey_draft_${jti}`;
}

// ---------------------------------------------------------------------------
// saveDraft / loadDraft / clearDraft
// ---------------------------------------------------------------------------
export function saveDraft(draft: SurveyV2Draft): void {
  if (typeof window === 'undefined') return;
  const key = draftStorageKey(draft.token || draft.projectId);
  const updated = { ...draft, lastSavedAt: new Date().toISOString() };
  try {
    localStorage.setItem(key, JSON.stringify(updated));
  } catch {
    // localStorage full or unavailable - silent fail
  }
}

export function loadDraft(jti: string): SurveyV2Draft | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(draftStorageKey(jti));
    if (!raw) return null;
    return JSON.parse(raw) as SurveyV2Draft;
  } catch {
    return null;
  }
}

export function clearDraft(jti: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(draftStorageKey(jti));
  } catch {
    // silent
  }
}

// ---------------------------------------------------------------------------
// decodeTokenClaims
//
// Client-side JWT decode (no verification - server verifies on submit).
// Returns null if token is malformed.
// ---------------------------------------------------------------------------
export function decodeTokenClaims(token: string): HandoffClaims | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1];
    // Pad base64url to standard base64
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/');
    const pad = padded.length % 4;
    const paddedStr = pad ? padded + '='.repeat(4 - pad) : padded;
    const decoded = JSON.parse(atob(paddedStr));
    if (!decoded.project_id || !decoded.jti) return null;
    return decoded as HandoffClaims;
  } catch {
    return null;
  }
}