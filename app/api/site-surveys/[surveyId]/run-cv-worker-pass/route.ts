// ============================================================================
// POST /api/site-surveys/[surveyId]/run-cv-worker-pass
// Compatibility alias for the external OSS CV worker pass.
// Review-only candidates only: no CAD/canonical/permit/BOM/workflow mutation.
// ============================================================================

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export { POST, GET } from '../open-source-photo-vision-pass/route';
