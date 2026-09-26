// ============================================================================
// v47.438 - Survey V2: Draft Defaults + JWT Pre-fill
//
// buildInitialDraft() creates a blank SurveyV2Draft pre-filled from the
// decoded JWT handoff token claims. Called on first load of /survey/[token].
//
// If the token has already been started (localStorage key exists), the
// existing draft is returned instead.
//
// v47.438: Standalone survey support.
//   - decodeTokenClaims now accepts project_id === "__standalone__"
//   - buildInitialDraft sets standalone=true and selectedClientId/ProjectId=null
//     so the Step 1 picker is shown to the field worker.
// ============================================================================

import type {
  SurveyV2Draft,
  SurveySiteOverview,
  SurveyRoofConditions,
  SurveyElectricalService,
  SurveyObstructions,
  SurveyPhotos,
} from './types';
import { STANDALONE_PROJECT_ID } from './types';

// ---------------------------------------------------------------------------
// HandoffClaims - decoded JWT payload shape (matches tokenMinter.ts)
// ---------------------------------------------------------------------------
export interface HandoffClaims {
  jti: string;
  // project_id is "__standalone__" for field-worker self-initiated surveys.
  project_id: string;
  // v47.438: standalone flag from the JWT.
  standalone?: boolean;
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
  // QW-2: Pre-fill structure type and stories from project data
  structure_type?: string;
  stories?: string;
  iat: number;
  exp: number;
}

// ---------------------------------------------------------------------------
// blankSiteOverview
// ---------------------------------------------------------------------------
function blankSiteOverview(claims: HandoffClaims): SurveySiteOverview {
  // QW-2: Pre-fill structureType and stories from JWT claims when available.
  // These come from the project record and save the field worker from re-entering.
  const validStructureTypes = ['residential', 'commercial', 'industrial'] as const;
  const validStories = ['1', '2', '3+'] as const;
  const prefillStructureType = claims.structure_type && validStructureTypes.includes(claims.structure_type as any)
    ? (claims.structure_type as SurveySiteOverview['structureType'])
    : '';
  const prefillStories = claims.stories && validStories.includes(claims.stories as any)
    ? (claims.stories as SurveySiteOverview['stories'])
    : '';

  return {
    projectName: claims.project_name ?? claims.site_name ?? '',
    siteAddress: claims.site_address ?? '',
    latitude: claims.latitude ?? null,
    longitude: claims.longitude ?? null,
    structureType: prefillStructureType,
    stories: prefillStories,
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
    // Empty means NOT RECORDED, not "same as the main" — see the field's note in types.ts.
    busbarRating: '',
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
//
// For standalone surveys (project_id === "__standalone__"):
//   - standalone: true is set
//   - projectId: "__standalone__"
//   - projectName: "" (field worker will set via picker)
//   - selectedClientId/ProjectId: null (field worker will pick)
// ---------------------------------------------------------------------------
export function buildInitialDraft(claims: HandoffClaims): SurveyV2Draft {
  const isStandalone =
    claims.standalone === true || claims.project_id === STANDALONE_PROJECT_ID;

  return {
    token: '',
    projectId: claims.project_id,
    projectName: isStandalone
      ? ''
      : (claims.project_name ?? claims.site_name ?? claims.project_id),

    // v47.438: standalone fields
    standalone: isStandalone || undefined,
    selectedClientId: isStandalone ? null : undefined,
    selectedProjectId: isStandalone ? null : undefined,

    siteOverview: blankSiteOverview(claims),
    roofConditions: blankRoofConditions(),
    electricalService: blankElectricalService(),
    obstructions: blankObstructions(),
    photos: blankPhotos(),
    currentStep: 1,
    completedSteps: [],
    // 🚨 NOTHING HAS BEEN SAVED YET, SO THIS SAYS NOTHING.
    //
    // This was `new Date().toISOString()` — the moment the surveyor OPENED the
    // link. `lastSavedAt` is read by exactly one consumer, the SurveyShell header
    // ("Saved HH:MM"), and `saveDraft` never wrote back into React state, so the
    // header displayed the open time for the entire survey. A crew could work for
    // forty minutes across five steps and have no way to tell whether their last
    // ten minutes of answers had persisted.
    //
    // Worse, on a device where localStorage throws — Safari private browsing,
    // storage full, site data blocked — the header still read "Saved 09:14" while
    // NOTHING had ever been written. Backgrounding the app reloaded the tab,
    // `loadDraft` returned null, and the survey restarted from blank having
    // reported success the whole time.
    //
    // Empty string is falsy, and the header renders the "Saved" span only when
    // `lastSavedAt` is truthy, so a fresh draft now claims nothing until a write
    // has actually succeeded. A RESUMED draft carries the real timestamp
    // `saveDraft` persisted, so resume still shows a true last-write time.
    lastSavedAt: '',
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
/**
 * The outcome of one `saveDraft` call. A caller must commit `savedAt` into state
 * on success and surface `saved === false` to the surveyor — see the note in
 * `saveDraft`.
 */
export interface DraftSaveResult {
  /** TRUE only when the draft is now in localStorage. */
  saved: boolean;
  /** The timestamp that was actually persisted. `null` when nothing was written. */
  savedAt: string | null;
  /** Why no write happened. Set only when `saved` is false. */
  reason?: 'no_window' | 'storage_threw';
  /** The thrown error's message, when there was one. */
  error?: string;
}

/**
 * Persist the draft to localStorage.
 *
 * 🚨 THIS RETURNED `void`, SO A FAILED WRITE WAS INDISTINGUISHABLE FROM A GOOD ONE.
 *
 * The `catch {}` below swallowed every storage failure — the exact failure modes
 * a field device hits: Safari private browsing, a full quota, site data blocked
 * by policy. The caller had no way to know, and the header went on reporting
 * "Saved", so a surveyor was told their work was safe by the one indicator that
 * could not possibly know. Two things had to change together: the write has to
 * report its outcome, and the caller has to render the outcome rather than a
 * timestamp it minted itself.
 *
 * The timestamp is generated ONCE, before the write, and the same value is both
 * stored and returned — so the caller's header cannot drift from what is on disk.
 * Every localStorage touch in this module is inside a try/catch: in a browser with
 * site data blocked, reading the `localStorage` PROPERTY itself throws, not just
 * the method call, so the access must be inside the guarded block and not hoisted
 * out of it.
 *
 * No read-back verification: a `setItem` that returns without throwing has
 * written, and re-reading a multi-hundred-KB draft on every 800ms autosave would
 * cost more than it proves. The failure this guards is the throw.
 */
export function saveDraft(draft: SurveyV2Draft): DraftSaveResult {
  if (typeof window === 'undefined') return { saved: false, savedAt: null, reason: 'no_window' };
  // Key on the JWT jti, the same key loadDraft/clearDraft use. draft.token is
  // the FULL handoff JWT, so keying on it here meant the autosave wrote to a key
  // the resume path (draftStorageKey(claims.jti)) could never read — silently
  // losing all in-progress field data on reload.
  const keyId = decodeTokenClaims(draft.token)?.jti || draft.token || draft.projectId;
  const key = draftStorageKey(keyId);
  const savedAt = new Date().toISOString();
  const updated = { ...draft, lastSavedAt: savedAt };
  try {
    localStorage.setItem(key, JSON.stringify(updated));
    return { saved: true, savedAt };
  } catch (err) {
    return {
      saved: false,
      savedAt: null,
      reason: 'storage_threw',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Read the draft back. The localStorage access is INSIDE the try for the same
 * reason as in `saveDraft`: with site data blocked, touching the property throws.
 *
 * `null` means "nothing usable to resume", which covers both no stored draft and
 * a stored draft that will not parse. That collapse is acceptable only because
 * the caller's fallback is `buildInitialDraft`, which no longer claims to have
 * saved anything — so a corrupt draft now presents as a blank survey with NO
 * "Saved" indicator, instead of a blank survey reporting a successful save.
 */
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
// Returns null if token is malformed or missing required fields.
//
// v47.438: Accepts project_id === "__standalone__" as valid.
// Previously required project_id to be a real project UUID.
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
    // Must have jti
    if (!decoded.jti) return null;
    // Must have project_id (can be "__standalone__" or a real UUID)
    if (!decoded.project_id) return null;
    return decoded as HandoffClaims;
  } catch {
    return null;
  }
}