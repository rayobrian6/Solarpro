# Open-Source Tool Governance V1

## Purpose

This document defines the governance architecture for any open-source OCR, computer-vision, image-processing, image-metadata, model-assisted, or evidence-assistance code considered for SolarPro. The purpose is to prevent probabilistic runtime output from crossing deterministic engineering boundaries. A registered tool may produce assisted evidence candidates only. It may not produce canonical evidence, satisfy engineering requirements, determine CAD readiness, generate recommendations, create workflow items, mutate projects, or perform engineering calculations.

## Registry Architecture

All open-source tools must be registered before execution. The registry should live in a dedicated assisted evidence runtime/source namespace, separate from canonical survey evidence and Engineering Intelligence modules. Recommended future location:

```text
lib/assistedEvidenceRuntime/
  openSourceToolTypes.ts
  openSourceToolRegistry.ts
  adapterContracts.ts
  sourceExecutionGuards.ts
  fixtures/
  adapters/
```

The registry is an allowlist, not a discovery mechanism. If a tool is not registered, it must not run. If a tool registration is incomplete, it must fail closed. If a tool declares any ability to mutate canonical evidence or influence engineering state, it must be rejected by registry validation.

## Registration Schema

A tool registration should include the following fields:

```ts
interface OpenSourceAssistedEvidenceToolRegistration {
  toolId: string;
  toolName: string;
  toolVersion: string;
  packageName: string | null;
  sourceUrl: string;
  license: string;
  licenseUrl: string;
  licenseVerifiedAt: string;
  licenseVerifiedBy: string;
  runtimeCategory: RuntimeCategory;
  runtimeTrustLevel: RuntimeTrustLevel;
  allowedCandidateTypes: AssistedEvidenceCandidateType[];
  allowedCandidateCategories: AssistedEvidenceCandidateCategory[];
  outputSchemaVersion: string;
  adapterId: string;
  adapterVersion: string;
  processesImageBytes: boolean;
  performsOcr: boolean;
  performsObjectDetection: boolean;
  performsSegmentation: boolean;
  performsGeometryExtraction: boolean;
  requiresNativeBinary: boolean;
  requiresModelWeights: boolean;
  supportedRuntimeEnvironments: RuntimeEnvironment[];
  versionPinning: VersionPinningPolicy;
  dependencyIsolation: DependencyIsolationPolicy;
  deterministicReplaySupport: DeterministicReplaySupport;
  reviewRequired: true;
  nonAuthoritative: true;
  canonicalMutationAllowed: false;
  enabled: boolean;
  deprecatedAt: string | null;
  notes: string[];
}
```

The fields `reviewRequired`, `nonAuthoritative`, and `canonicalMutationAllowed` are not operational toggles. They are safety invariants. `reviewRequired` must always be true. `nonAuthoritative` must always be true. `canonicalMutationAllowed` must always be false.

## Runtime Categories

Allowed runtime categories should be explicit:

- `fixture_only`: static deterministic fixture payloads used for tests and architecture proof.
- `image_metadata`: file-level metadata, dimensions, orientation metadata, file size, type, timestamp, and non-semantic quality signals.
- `ocr_text_candidate`: OCR or text-region extraction producing review-required text candidates only.
- `visual_category_candidate`: semantic photo/category suggestion producing possible scene/context candidates only.
- `geometry_candidate_blocked`: future geometry extraction category, blocked until separately approved.
- `cad_or_engineering_blocked`: prohibited category for any direct CAD or engineering influence.

The first runtime pilot should use `image_metadata`. `fixture_only` must precede all runtime categories.

## Runtime Trust Levels

Runtime trust levels should describe containment expectations, not correctness:

- `trusted_fixture`: source-controlled deterministic fixtures only.
- `low_risk_metadata`: non-semantic metadata extraction with limited input surface.
- `bounded_probabilistic_text`: OCR/text extraction with known false-positive risk.
- `bounded_probabilistic_visual`: visual categorization with semantic false-positive risk.
- `high_risk_geometry`: geometry/roof/scene interpretation requiring future approval.
- `blocked_engineering_authority`: any runtime claiming engineering authority; not allowed.

No trust level allows canonical mutation.

## License Metadata Requirements

Every registered tool must include a license identifier, license URL, source URL, package URL when applicable, version, verification timestamp, and verifier identity. License metadata must be source-controlled in the registry and reflected in governance reports.

Approved posture after verification:

- MIT
- Apache-2.0
- BSD-2-Clause
- BSD-3-Clause
- ISC
- MPL-2.0 only after compatibility review

High-risk or blocked posture unless explicitly approved by counsel or project owner:

- AGPL
- GPL
- LGPL when obligations are unclear
- SSPL
- Commons Clause
- non-commercial licenses
- research-only licenses
- field-of-use restricted model licenses
- unknown or missing license
- custom model terms without redistribution/runtime clarity

## Native Binary Policy

Native binaries are blocked by default. A native dependency may be considered only after an explicit approval packet documents supported platforms, deterministic installation, security posture, known CVEs, package provenance, checksum strategy, container/server compatibility, CI compatibility, rollback steps, and why a pure TypeScript/JavaScript or fixture-only alternative is insufficient.

## Model-Weight Policy

Model weights are blocked by default. Any future model-weight intake must record model name, model version, source URL, license, license URL, checksum, storage location, expected size, runtime memory cost, update policy, deprecation policy, and whether the model has field-of-use restrictions. Model outputs remain candidates only.

## Browser and Server Runtime Policy

Browser runtimes must not access canonical application state, engineering state, or mutation APIs. They should be limited to local preview or upload-preflight candidate generation and should submit only normalized candidate metadata to the review-required sandbox.

Server runtimes must run behind wrapper boundaries with file-size limits, timeout limits, concurrency limits, schema validation, error envelopes, and audit logging. Server runtimes must not import canonical modules or database mutation modules.

## Version Pinning Strategy

Runtime dependencies must be pinned to exact versions in lockfiles. Tool registrations must record the runtime version, adapter version, output schema version, and configuration hash. Version updates require a new registry entry or explicit version bump, replay comparison tests, and validation logs.

## Dependency Isolation Strategy

Open-source runtime code should be isolated in a dedicated namespace and, where practical, a dedicated execution wrapper. Runtime-specific imports should not leak into canonical modules. Heavy or risky dependencies should be dynamically isolated behind runner interfaces, disabled in CI unless intentionally tested, and guarded by explicit registry checks.

## Deterministic Replay Considerations

Every candidate generated from runtime output must preserve deterministic replay metadata. Required provenance includes source file id, source upload key, project id, survey id, tool id, tool version, tool run id, adapter id, adapter version, tool config hash, source metadata hash, output schema version, normalization version, created timestamp supplied by the caller, limitations, and raw-output summary hash when raw output is not stored.

Runtime output may be probabilistic, but normalization must be deterministic for a given input payload. Arrays must be sorted by stable keys, object keys must be stable-stringified, confidence values must be clamped and rounded by policy, and omitted/undefined fields must be normalized consistently.

## Registry Enforcement Rules

The registry validator must reject a tool if:

- license metadata is missing.
- source URL is missing.
- version is not pinned.
- no allowed candidate types are declared.
- `reviewRequired` is not true.
- `nonAuthoritative` is not true.
- `canonicalMutationAllowed` is not false.
- the tool declares CAD, engineering, recommendation, workflow, or canonical mutation authority.
- the runtime category is blocked.
- native binaries or model weights are required without explicit approval.
- the adapter id is missing or not compatible with the candidate types.

## Open-Source Intake Checklist

Before any runtime dependency is added, the following checklist must be complete:

- Tool name, package, version, and source URL recorded.
- License identifier and license URL verified.
- License posture classified as approved, high-risk, or blocked.
- Runtime category selected.
- Runtime trust level selected.
- Candidate types and categories allowlisted.
- Adapter contract identified.
- Output schema version defined.
- Version pinning strategy documented.
- Native binary status documented.
- Model-weight status documented.
- Browser/server runtime policy documented.
- Input limits documented.
- Timeout and failure policy documented.
- Deterministic replay metadata documented.
- Boundary validation updated if needed.
- Fixture-only adapter implemented first.
- Tests prove candidate-only behavior.
- Review UI semantics confirmed.
- Rollback plan documented.

## Governance Checklist for Pulling a Tool Forward

A tool may move from inventory to fixture to runtime only when all gates pass. The fixture gate requires deterministic adapter tests and no runtime dependency. The runtime harness gate requires wrapper boundaries, failure handling, and validation. The runtime pilot gate requires explicit approval, pinned dependency, license report, boundary checks, and review-only operational semantics. No gate authorizes canonical mutation.

## Prohibited Claims

Open-source tools must not be described in product or UI language as verifying, approving, engineering, designing, calculating, or completing site conditions. Unreviewed output must use language such as candidate, possible, suggested, requires review, non-authoritative, or assisted metadata.
