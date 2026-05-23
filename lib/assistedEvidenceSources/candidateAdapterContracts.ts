import type { FixtureCandidateAdapter, MetadataFixturePayload, MetadataRuntimePayload, OcrFixturePayload, OcrRuntimePayload, RuntimeCandidateAdapter } from './candidateAdapterTypes';

export type MetadataCandidateFixtureAdapter = FixtureCandidateAdapter<MetadataFixturePayload>;
export type OcrCandidateFixtureAdapter = FixtureCandidateAdapter<OcrFixturePayload>;
export type MetadataCandidateRuntimeAdapter = RuntimeCandidateAdapter<MetadataRuntimePayload>;
export type OcrCandidateRuntimeAdapter = RuntimeCandidateAdapter<OcrRuntimePayload>;
export type VisualCategorizationFixtureAdapter = FixtureCandidateAdapter<Record<string, never>>;
export type FutureGeometryAdapterPlaceholder = never;

export const ADAPTER_CONTRACT_INVARIANTS = [
  'Adapters output normalized candidate payloads only.',
  'Adapters must route candidate creation through createCandidate() and markReviewRequired().',
  'Runtime adapters must be server-only and adapter-contained.',
  'Adapters must not import canonical evidence, engineering requirements, CAD readiness, recommendations, or workflows.',
  'Adapters must not upgrade confidence implicitly.',
  'Future geometry adapters are placeholders only and are not approved for runtime execution.',
] as const;
