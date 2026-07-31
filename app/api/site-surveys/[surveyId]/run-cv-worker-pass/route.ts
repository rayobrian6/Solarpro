// ============================================================================
// POST /api/site-surveys/[surveyId]/run-cv-worker-pass
// Compatibility alias for the external OSS CV worker pass.
// Review-only candidates only: no CAD/canonical/permit/BOM/workflow mutation.
// ============================================================================

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export { /* @next-codemod-error `POST` export is re-exported. Check if this component uses `params` or `searchParams`*/
POST, /* @next-codemod-error `GET` export is re-exported. Check if this component uses `params` or `searchParams`*/
GET } from '../open-source-photo-vision-pass/route';
