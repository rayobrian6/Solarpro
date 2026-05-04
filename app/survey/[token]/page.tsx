// ============================================================================
// v47.438 - Survey V2: /survey/[token] page
//
// Entry point for the field survey flow. On mount:
//   1. Decodes the JWT token from the URL (client-side, no verification)
//   2. Loads existing draft from localStorage (if resuming)
//   3. Builds a fresh draft from JWT claims (if new survey)
//   4. Renders the SurveyShell + current step component
//
// v47.438: Standalone survey support.
//   When claims.standalone === true (project_id === "__standalone__"):
//   - Fetches GET /api/survey/lookup-data?token=<jwt> to get clients+projects
//   - Passes lookup data + picker callbacks to StepSiteOverview
//   - Updates draft.selectedClientId / selectedProjectId on picker change
//   - canAdvanceStep(1) requires a client OR project selection for standalone
//   - Payload includes selectedClientId + selectedProjectId on submit
//
// All state is managed here and passed down to step components.
// Draft is auto-saved to localStorage on every change (debounced 800ms).
//
// Submission: POST /api/survey/submit with full draft payload.
// The server verifies the JWT, validates required fields, and POSTs
// to the webhook pipeline.
//
// This is a client component - all survey interaction is in-browser.
// Pure ASCII, no Unicode.
// ============================================================================

'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import type {
  SurveyV2Draft,
  SurveyPhoto,
  SurveyV2Payload,
  SurveyLookupData,
} from '../../../lib/survey/v2/types';
import { REQUIRED_PHOTO_CATEGORIES, STANDALONE_PROJECT_ID } from '../../../lib/survey/v2/types';
import {
  buildInitialDraft,
  decodeTokenClaims,
  loadDraft,
  saveDraft,
  clearDraft,
} from '../../../lib/survey/v2/defaults';
import { SurveyShell } from '../../../components/survey/SurveyShell';
import { StepSiteOverview } from '../../../components/survey/StepSiteOverview';
import { StepRoof } from '../../../components/survey/StepRoof';
import { StepElectrical } from '../../../components/survey/StepElectrical';
import { StepObstructions } from '../../../components/survey/StepObstructions';
import { StepPhotos } from '../../../components/survey/StepPhotos';
import { StepReview } from '../../../components/survey/StepReview';
import type {
  SurveySiteOverview,
  SurveyRoofConditions,
  SurveyElectricalService,
  SurveyObstructions,
} from '../../../lib/survey/v2/types';

// ---------------------------------------------------------------------------
// canAdvanceStep - validates required fields before allowing Next
// ---------------------------------------------------------------------------
function canAdvanceStep(draft: SurveyV2Draft, step: number): boolean {
  switch (step) {
    case 1: {
      const s = draft.siteOverview;
      // v47.438: standalone surveys also require a client or project selection
      if (draft.standalone) {
        const hasSelection = !!(draft.selectedProjectId || draft.selectedClientId);
        if (!hasSelection) return false;
      }
      return !!(
        s.projectName.trim() &&
        s.siteAddress.trim() &&
        s.structureType &&
        s.stories &&
        s.inspectorName.trim()
      );
    }
    case 2: {
      const r = draft.roofConditions;
      return !!(r.roofMaterial && r.roofPitch && r.rafterSpacing && r.roofCondition);
    }
    case 3: {
      const e = draft.electricalService;
      return !!(
        e.panelBrand &&
        e.panelRating &&
        e.availableBreakerSlots &&
        e.meterSocketType &&
        e.interconnectionPoint &&
        e.serviceEntrance
      );
    }
    case 4:
      // Obstructions step is optional - always allow advance
      return true;
    case 5: {
      // All required photos must be captured
      const captured = REQUIRED_PHOTO_CATEGORIES.filter((cat) =>
        draft.photos.photos.some((p) => p.category === cat),
      );
      return captured.length === REQUIRED_PHOTO_CATEGORIES.length;
    }
    case 6:
      // Review step - submit readiness same as step 5
      return canAdvanceStep(draft, 5);
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// SurveyPage
// ---------------------------------------------------------------------------
export default function SurveyPage() {
  const params = useParams();
  const token = typeof params?.token === 'string' ? params.token : '';

  // Core survey state
  const [draft, setDraft] = useState<SurveyV2Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitDone, setSubmitDone] = useState(false);

  // v47.438: lookup data for standalone survey picker
  const [lookupData, setLookupData] = useState<SurveyLookupData | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  // Auto-save debounce ref
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---------------------------------------------------------------------------
  // Init: decode token, load or build draft
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!token) {
      setError('No survey token provided.');
      return;
    }

    const claims = decodeTokenClaims(token);
    if (!claims) {
      setError('Invalid or malformed survey token. Please request a new survey link.');
      return;
    }

    // Check expiry
    const now = Math.floor(Date.now() / 1000);
    if (claims.exp < now) {
      setError('This survey link has expired. Please request a new one from your project manager.');
      return;
    }

    // Try to resume existing draft
    const existing = loadDraft(claims.jti);
    if (existing) {
      // Stamp the current token (in case it was refreshed)
      setDraft({ ...existing, token });
    } else {
      const fresh = buildInitialDraft(claims);
      setDraft({ ...fresh, token });
    }

    // v47.438: if standalone, fetch lookup data for the client/project picker
    const isStandalone =
      claims.standalone === true || claims.project_id === STANDALONE_PROJECT_ID;
    if (isStandalone) {
      setLookupLoading(true);
      fetch(`/api/survey/lookup-data?token=${encodeURIComponent(token)}`)
        .then((res) => res.json())
        .then((body) => {
          if (body.success && body.data) {
            setLookupData(body.data as SurveyLookupData);
          } else {
            setLookupError(body.error ?? 'Failed to load client list');
          }
        })
        .catch(() => setLookupError('Network error loading client list'))
        .finally(() => setLookupLoading(false));
    }
  }, [token]);

  // ---------------------------------------------------------------------------
  // Auto-save on draft change (debounced 800ms)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!draft) return;

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    setSaving(true);
    saveTimerRef.current = setTimeout(() => {
      saveDraft(draft);
      setSaving(false);
    }, 800);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [draft]);

  // ---------------------------------------------------------------------------
  // Update helpers
  // ---------------------------------------------------------------------------
  function updateDraft(patch: Partial<SurveyV2Draft>) {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  function handleSiteOverview(data: SurveySiteOverview) {
    updateDraft({ siteOverview: data });
  }

  function handleRoof(data: SurveyRoofConditions) {
    updateDraft({ roofConditions: data });
  }

  function handleElectrical(data: SurveyElectricalService) {
    updateDraft({ electricalService: data });
  }

  function handleObstructions(data: SurveyObstructions) {
    updateDraft({ obstructions: data });
  }

  function handlePhotoUploaded(photo: SurveyPhoto) {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        photos: {
          photos: [...prev.photos.photos, photo],
        },
      };
    });
  }

  function handlePhotoRemoved(photoId: string) {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        photos: {
          photos: prev.photos.photos.filter((p) => p.id !== photoId),
        },
      };
    });
  }

  // v47.438: picker callbacks
  function handleSelectClient(clientId: string, clientName: string) {
    updateDraft({
      selectedClientId: clientId,
      selectedProjectId: null,
      // Auto-fill projectName hint for the field worker
      siteOverview: draft
        ? { ...draft.siteOverview, projectName: draft.siteOverview.projectName || clientName }
        : draft?.siteOverview ?? {} as SurveySiteOverview,
    });
  }

  function handleSelectProject(projectId: string, projectName: string) {
    // Find client info from lookup data for pre-filling
    const proj = lookupData?.projects.find((p) => p.id === projectId);
    updateDraft({
      selectedProjectId: projectId,
      selectedClientId: proj?.clientId ?? null,
      projectName,
      siteOverview: draft
        ? {
            ...draft.siteOverview,
            projectName: projectName,
            siteAddress: draft.siteOverview.siteAddress || (proj?.address ?? ''),
          }
        : draft?.siteOverview ?? {} as SurveySiteOverview,
    });
  }

  function handleClearSelection() {
    updateDraft({
      selectedClientId: null,
      selectedProjectId: null,
    });
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------
  const handleNext = useCallback(() => {
    if (!draft) return;
    const next = Math.min(draft.currentStep + 1, 6);
    const completed = draft.completedSteps.includes(draft.currentStep)
      ? draft.completedSteps
      : [...draft.completedSteps, draft.currentStep];
    updateDraft({ currentStep: next, completedSteps: completed });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [draft]);

  const handleBack = useCallback(() => {
    if (!draft) return;
    const prev = Math.max(draft.currentStep - 1, 1);
    updateDraft({ currentStep: prev });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [draft]);

  const handleEditStep = useCallback((step: number) => {
    updateDraft({ currentStep: step });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------
  const handleSubmit = useCallback(async () => {
    if (!draft) return;
    setSubmitting(true);
    setSubmitError(null);

    try {
      const claims = decodeTokenClaims(token);
      if (!claims) throw new Error('Token decode failed');

      const payload: SurveyV2Payload = {
        schemaVersion: '2.0',
        surveyId: claims.jti,
        projectId: draft.projectId,
        submittedAt: new Date().toISOString(),
        inspectorName: draft.siteOverview.inspectorName,
        siteOverview: draft.siteOverview,
        roofConditions: draft.roofConditions,
        electricalService: draft.electricalService,
        obstructions: draft.obstructions,
        photos: draft.photos.photos,
        // v47.438: include picker selections for standalone surveys
        selectedClientId: draft.selectedClientId ?? null,
        selectedProjectId: draft.selectedProjectId ?? null,
      };

      const res = await fetch('/api/survey/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, payload }),
        credentials: 'include',
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = (body as { error?: string }).error ?? `Submission failed (${res.status})`;
        setSubmitError(msg);
        setSubmitting(false);
        return;
      }

      // Clear localStorage draft on success
      if (claims.jti) {
        clearDraft(claims.jti);
      }

      setSubmitDone(true);
      setSubmitting(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Submission failed';
      setSubmitError(msg);
      setSubmitting(false);
    }
  }, [draft, token]);

  // ---------------------------------------------------------------------------
  // Render: error state
  // ---------------------------------------------------------------------------
  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="max-w-sm w-full bg-white rounded-2xl border border-red-200 shadow-sm p-6 text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto">
            <span className="text-red-500 text-xl font-bold">!</span>
          </div>
          <h1 className="text-base font-bold text-gray-900">Survey Link Error</h1>
          <p className="text-sm text-gray-500">{error}</p>
          <p className="text-xs text-gray-400">
            Contact your project manager if this error persists.
          </p>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: success state
  // ---------------------------------------------------------------------------
  if (submitDone) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="max-w-sm w-full bg-white rounded-2xl border border-green-200 shadow-sm p-6 text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto">
            <span className="text-green-600 text-xl font-bold">OK</span>
          </div>
          <h1 className="text-base font-bold text-gray-900">Survey Submitted!</h1>
          <p className="text-sm text-gray-500">
            Your survey for{' '}
            <span className="font-semibold">{draft?.projectName || draft?.siteOverview?.projectName}</span> has been
            submitted successfully.
          </p>
          <p className="text-xs text-gray-400">
            The engineering team will process the data and update the project.
          </p>
          <p className="text-xs text-gray-400 mt-4">
            You may close this window.
          </p>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: loading state
  // ---------------------------------------------------------------------------
  if (!draft) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-cyan-300 border-t-cyan-600 animate-spin" />
          <p className="text-sm text-gray-500">Loading survey...</p>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: main survey shell
  // ---------------------------------------------------------------------------
  const canAdvance = canAdvanceStep(draft, draft.currentStep);

  // Shell header: show "Select client..." amber text when standalone + no selection yet
  const displayProjectName = (() => {
    if (!draft.standalone) return draft.projectName;
    if (draft.selectedProjectId || draft.selectedClientId) {
      return draft.projectName || draft.siteOverview.projectName || 'Survey In Progress';
    }
    return '';  // SurveyShell shows "Untitled Project" fallback — we override below
  })();

  return (
    <SurveyShell
      projectName={displayProjectName}
      currentStep={draft.currentStep}
      completedSteps={draft.completedSteps}
      lastSavedAt={draft.lastSavedAt}
      saving={saving}
      submitting={submitting}
      canAdvance={canAdvance}
      onBack={handleBack}
      onNext={handleNext}
      onSubmit={handleSubmit}
      standalone={draft.standalone}
      hasSelection={!!(draft.selectedProjectId || draft.selectedClientId)}
    >
      {draft.currentStep === 1 && (
        <StepSiteOverview
          data={draft.siteOverview}
          onChange={handleSiteOverview}
          disabled={submitting}
          standalone={draft.standalone}
          lookupClients={lookupData?.clients ?? []}
          lookupProjects={lookupData?.projects ?? []}
          lookupLoading={lookupLoading}
          lookupError={lookupError}
          selectedClientId={draft.selectedClientId}
          selectedProjectId={draft.selectedProjectId}
          onSelectClient={handleSelectClient}
          onSelectProject={handleSelectProject}
          onClearSelection={handleClearSelection}
        />
      )}
      {draft.currentStep === 2 && (
        <StepRoof
          data={draft.roofConditions}
          onChange={handleRoof}
          disabled={submitting}
        />
      )}
      {draft.currentStep === 3 && (
        <StepElectrical
          data={draft.electricalService}
          onChange={handleElectrical}
          disabled={submitting}
        />
      )}
      {draft.currentStep === 4 && (
        <StepObstructions
          data={draft.obstructions}
          onChange={handleObstructions}
          disabled={submitting}
        />
      )}
      {draft.currentStep === 5 && (
        <StepPhotos
          surveyToken={token}
          data={draft.photos}
          onPhotoUploaded={handlePhotoUploaded}
          onPhotoRemoved={handlePhotoRemoved}
          disabled={submitting}
        />
      )}
      {draft.currentStep === 6 && (
        <StepReview
          draft={draft}
          onEditStep={handleEditStep}
          submitError={submitError}
        />
      )}
    </SurveyShell>
  );
}