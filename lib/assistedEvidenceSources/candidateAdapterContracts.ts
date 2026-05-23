import type { FixtureCandidateAdapter, MetadataFixturePayload, OcrFixturePayload } from './candidateAdapterTypes';

export type MetadataCandidateFixtureAdapter = FixtureCandidateAdapter<MetadataFixturePayload>;
export type OcrCandidateFixtureAdapter = FixtureCandidateAdapter<OcrFixturePayload>;
export type VisualCategorizationFixtureAdapter = FixtureCandidateAdapter<Record<string, never>>;
export type FutureGeometryAdapterPlaceholder = never;

export const ADAPTER_CONTRACT_INVARIANTS = [
  'Adapters output normalized candidate payloads only.',
  'Adapters must route candidate creation through createCandidate() and markReviewRequired().',
  'Adapters must not import canonical evidence, engineering requirements, CAD readiness, recommendations, or workflows.',
  'Adapters must not upgrade confidence implicitly.',
  'Future geometry adapters are placeholders only and are not approved for runtime execution.',
] as const;
