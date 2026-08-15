// ============================================================================
// POST /api/site-surveys/[surveyId]/run-cv-worker-pass
// Compatibility alias for the external OSS CV worker pass.
// Review-only candidates only: no CAD/canonical/permit/BOM/workflow mutation.
// ============================================================================

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export { /* @next-codemod-ignore `POST` export is re-exported. Check if this component uses `params` or `searchParams` (source route already does `await props.params` on lines 56 and 173.) */
POST, /* @next-codemod-ignore `GET` export is re-exported. Check if this component uses `params` or `searchParams` (source route already does `await props.params` on lines 56 and 173.) */
GET } from '../open-source-photo-vision-pass/route';
