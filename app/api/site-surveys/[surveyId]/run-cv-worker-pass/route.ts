// ============================================================================
// POST /api/site-surveys/[surveyId]/run-cv-worker-pass
// Compatibility alias for the external OSS CV worker pass.
// Review-only candidates only: no CAD/canonical/permit/BOM/workflow mutation.
// ============================================================================

export { runtime, dynamic, maxDuration, POST } from '../open-source-photo-vision-pass/route';
