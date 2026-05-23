export const GEOMETRY_CANDIDATE_RUNTIME_TOOL_NAME = 'deterministic-geometry-adjacency-runtime' as const;
export const GEOMETRY_CANDIDATE_RUNTIME_TOOL_VERSION = '1.0.0' as const;
export const GEOMETRY_CANDIDATE_BOUNDARY_POLICY_VERSION = 'geometry_candidate_boundary_v1' as const;

export const ALLOWED_GEOMETRY_CANDIDATE_LABELS = ['possible_obstruction_candidate'] as const;
export type GeometryCandidateLabel = (typeof ALLOWED_GEOMETRY_CANDIDATE_LABELS)[number];

export const GEOMETRY_CANDIDATE_LIMITATIONS = [
  'geometry_candidate_only',
  'possible_obstruction_candidate_only',
  'non_authoritative_review_required',
  'source_image_review_context_only',
  'coarse_non_measuring_region_hint_only',
  'no_coordinates',
  'no_bounding_box',
  'no_polygon',
  'no_obstruction_map',
  'no_object_detection',
  'no_segmentation',
  'no_roof_extraction',
  'no_plane_generation',
  'no_setback_generation',
  'no_cad_mutation',
  'no_layout_mutation',
  'no_nec_influence',
  'no_engineering_mutation',
  'no_workflow_or_recommendation_influence',
  'no_canonical_mutation',
] as const;

export type GeometryCandidateLimitation = (typeof GEOMETRY_CANDIDATE_LIMITATIONS)[number];

export interface GeometryCandidateExtractionInput {
  imageBytes: Uint8Array;
  sourceContextText?: string | null;
}

export interface GeometryCandidateSignal {
  signalId: string;
  label: GeometryCandidateLabel;
  confidence: number;
  sourceImageLineageRef: string;
  reviewRegionDescriptor: 'coarse_source_image_context';
  evidenceBasis: string[];
  limitationRefs: GeometryCandidateLimitation[];
}

export interface GeometryCandidateRuntimePayload {
  runtimePayloadHash: string;
  inputByteLength: number;
  method: 'deterministic_source_context_obstruction_terms_and_byte_hash';
  boundaryPolicyVersion: typeof GEOMETRY_CANDIDATE_BOUNDARY_POLICY_VERSION;
  sourceContextTextHash: string;
  sourceImageByteHash: string;
  confidence: number;
  derivedSignals: GeometryCandidateSignal[];
  stalePropagation: {
    candidateOnly: true;
    allowedStaleClasses: ['candidate_source_stale', 'candidate_runtime_stale', 'candidate_policy_stale', 'candidate_review_stale'];
    forbiddenStaleClasses: ['canonical_geometry_stale', 'cad_output_stale', 'engineering_output_stale', 'route_output_stale', 'bom_output_stale', 'plan_set_output_stale'];
  };
}
