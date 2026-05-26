import type { SiteSurvey, SiteSurveyFile } from "@/lib/db/surveys";
import type { SurveyPhotoOpenSourceAnalysis } from "@/lib/siteSurvey/photoIntelligence";

import {
  REQUIRED_SURVEY_EVIDENCE_CATEGORIES,
  SURVEY_EVIDENCE_CATEGORIES,
  getSurveyEvidenceDomain,
  inferSurveyEvidenceCategoryFromText,
  normalizeSurveyEvidenceCategory,
} from "./categoryRegistry";
import type {
  SurveyEvidenceCategory,
  SurveyEvidenceDomain,
} from "./categoryRegistry";

export type {
  SurveyEvidenceCategory,
  SurveyEvidenceDomain,
  SurveyEvidenceCategoryDefinition,
  SurveyEvidenceEngineeringBucket,
} from "./categoryRegistry";
export {
  REQUIRED_SURVEY_EVIDENCE_CATEGORIES,
  SURVEY_EVIDENCE_CATEGORIES,
  SURVEY_EVIDENCE_CATEGORY_DOMAIN,
  SURVEY_EVIDENCE_CATEGORY_REGISTRY,
  getSurveyEvidenceCategoryDefinition,
  getSurveyEvidenceDomain,
  getSurveyEvidenceLabel,
  inferSurveyEvidenceCategoryFromText,
  normalizeSurveyEvidenceCategory,
} from "./categoryRegistry";

export type SurveyEvidenceProcessingStatus =
  | "uploaded"
  | "classified"
  | "quality_checked"
  | "duplicate_checked"
  | "ai_pending"
  | "ai_processed"
  | "engineering_reviewed"
  | "permit_consumed"
  | "archived";

export type SurveyEvidenceAiExtractionStatus =
  | "not_started"
  | "not_applicable"
  | "pending"
  | "processed"
  | "failed"
  | "review_required";

export type SurveyEvidenceConfidence = "unknown" | "low" | "medium" | "high";

export interface SurveyEvidenceImageMetadata {
  widthPx: number | null;
  heightPx: number | null;
  orientation: string | null;
}

export interface SurveyEvidenceQuality {
  blurScore: number | null;
  duplicateScore: number | null;
  warnings: string[];
}

export interface SurveyEvidenceHistoryEvent {
  status: SurveyEvidenceProcessingStatus;
  source: string;
  at: string;
  note?: string;
}

export interface SurveyEvidenceEngineeringUsageReference {
  system: "engineering" | "permit" | "cad" | "structural" | "electrical";
  reference: string;
  consumedAt?: string;
}

export interface SurveyEvidenceItem {
  evidenceId: string;
  projectId: string | null;
  surveyId: string;
  siteSurveyFileId: string | null;
  projectFileId: string | null;
  fileUrl: string;
  blobKey: string | null;
  filename: string | null;
  mimeType: string | null;
  submittedCategory: string | null;
  category: SurveyEvidenceCategory;
  domain: SurveyEvidenceDomain;
  processingStatus: SurveyEvidenceProcessingStatus;
  evidenceConfidence: SurveyEvidenceConfidence;
  evidenceSource:
    | "site_survey_files"
    | "survey_payload"
    | "project_files"
    | "manual"
    | "derived";
  captureTimestamp: string | null;
  surveyTechnician: string | null;
  image: SurveyEvidenceImageMetadata;
  quality: SurveyEvidenceQuality;
  sceneGroup: string | null;
  processingHistory: SurveyEvidenceHistoryEvent[];
  aiExtractionStatus: SurveyEvidenceAiExtractionStatus;
  engineeringUsageReferences: SurveyEvidenceEngineeringUsageReference[];
  /** Obstruction data from vision pipeline (only present for roof_plane items) */
  obstructionData?: SurveyEvidenceObstructionData | null;
}

/**
 * Obstruction data linked to a roof_plane evidence item.
 * Populated by the roof obstruction registration pipeline (Phase 3).
 */
export interface SurveyEvidenceObstructionData {
  /** Number of deduplicated obstructions found on this roof plane photo */
  obstructionCount: number;
  /** Size distribution of obstructions */
  sizeDistribution: {
    tiny: number;
    small: number;
    medium: number;
    large: number;
    huge: number;
  };
  /** Average confidence of obstruction detections */
  avgConfidence: number;
  /** Whether these obstructions have been human-reviewed */
  reviewed: boolean;
  /** Individual obstruction bounding boxes (normalized 0-1000 coordinates) */
  obstructions: Array<{
    id: string;
    region: {
      x: number;
      y: number;
      width: number;
      height: number;
      coordinateSystem: "normalized_image_0_1000";
    };
    areaNormalized: number;
    confidence: number;
    obstructionType: string | null;
    reviewed: boolean;
  }>;
}

export interface SurveyEvidenceCoverageGroup {
  category: SurveyEvidenceCategory;
  domain: SurveyEvidenceDomain;
  required: boolean;
  count: number;
  status: "missing" | "present";
}

export interface SurveyEvidenceDiagnostics {
  rawPhotoItemCount: number;
  canonicalItemCount: number;
  promotedAiReviewedCount: number;
  suppressedDuplicateCount: number;
  ignoredEvidence: Array<{
    evidenceId: string;
    siteSurveyFileId: string | null;
    fileUrl: string;
    reason: string;
    representativeEvidenceId: string | null;
  }>;
  mappingConflicts: Array<{
    source: string;
    normalizedCategory: SurveyEvidenceCategory;
    inferredCategory: SurveyEvidenceCategory;
    resolvedCategory: SurveyEvidenceCategory;
  }>;
  requirementReasoning: Array<{
    category: SurveyEvidenceCategory;
    count: number;
    status: "missing" | "present";
    reason: string;
  }>;
}

export interface SurveyEvidenceManifest {
  manifestVersion: 1;
  projectId: string | null;
  surveyId: string;
  generatedAt: string;
  sourceOfTruth: "site_surveys+site_survey_files";
  surveyTechnician: string | null;
  items: SurveyEvidenceItem[];
  coverage: SurveyEvidenceCoverageGroup[];
  requiredMissing: SurveyEvidenceCategory[];
  warnings: string[];
  diagnostics?: SurveyEvidenceDiagnostics;
  summary: {
    totalItems: number;
    classifiedItems: number;
    qualityCheckedItems: number;
    duplicateCheckedItems: number;
    aiProcessedItems: number;
    engineeringReviewedItems: number;
    permitConsumedItems: number;
    confidence: SurveyEvidenceConfidence;
    completeness: "missing" | "partial" | "sufficient";
  };
  /** Obstruction data summary across all roof_plane evidence items (Phase 3) */
  obstructionSummary?: {
    roofPhotosWithObstructions: number;
    totalObstructions: number;
    reviewedObstructions: number;
    obstructionTypeDistribution: Record<string, number>;
  } | null;
  openSourceBoundaries: {
    webRuntime: string[];
    pythonWorker: string[];
    futureOnly: string[];
  };
}

interface PayloadPhotoLike {
  url?: unknown;
  uploadKey?: unknown;
  category?: unknown;
  capturedAt?: unknown;
  timestamp?: unknown;
  createdAt?: unknown;
  notes?: unknown;
}

export interface BuildSurveyEvidenceManifestInput {
  survey: Pick<SiteSurvey, "id" | "projectId" | "surveyData" | "inspectorName">;
  files: SiteSurveyFile[];
  generatedAt?: string;
  photoAnalysis?: SurveyPhotoOpenSourceAnalysis[];
  /** Obstruction data per filename (from roof obstruction registration pipeline) */
  obstructionDataByFilename?: Map<string, SurveyEvidenceObstructionData> | null;
}

export function buildSurveyEvidenceManifest(
  input: BuildSurveyEvidenceManifestInput,
): SurveyEvidenceManifest {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const payloadPhotos = extractPayloadPhotos(input.survey.surveyData);
  const photoAnalysisByFileId = new Map(
    (input.photoAnalysis ?? []).map((analysis) => [analysis.fileId, analysis]),
  );
  const seenUrls = new Set<string>();
  const mappingConflicts: SurveyEvidenceDiagnostics["mappingConflicts"] = [];

  const rawItems = input.files
    .filter((file) => file.fileType === "photo")
    .map((file, index) => {
      seenUrls.add(file.fileUrl);
      return buildEvidenceItem({
        survey: input.survey,
        file,
        index,
        generatedAt,
        payloadPhoto: findPayloadPhoto(file, payloadPhotos),
        photoAnalysis: photoAnalysisByFileId.get(file.id) ?? null,
        obstructionData: (input.obstructionDataByFilename && file.filename)
          ? input.obstructionDataByFilename.get(file.filename) ?? null
          : null,
        mappingConflicts,
      });
    });

  // If a payload photo was submitted but never made it into site_survey_files,
  // expose it as a derived manifest item instead of hiding the evidence gap.
  for (const payloadPhoto of payloadPhotos) {
    const url = typeof payloadPhoto.url === "string" ? payloadPhoto.url : "";
    if (!url || seenUrls.has(url)) continue;
    rawItems.push(
      buildPayloadOnlyEvidenceItem({
        survey: input.survey,
        payloadPhoto,
        index: rawItems.length,
        generatedAt,
        mappingConflicts,
      }),
    );
  }

  const { items, ignoredEvidence } = suppressDuplicateEvidence(
    rawItems,
    photoAnalysisByFileId,
  );
  const coverage = buildCoverage(items);
  const requiredMissing = coverage
    .filter((group) => group.required && group.status === "missing")
    .map((group) => group.category);

  const warnings: string[] = [];
  if (items.length === 0)
    warnings.push("No survey photo evidence items are linked to this survey.");
  for (const category of requiredMissing) {
    warnings.push(`Missing required survey evidence category: ${category}`);
  }

  const classifiedItems = items.filter(
    (item) => item.category !== "uncategorized",
  ).length;
  const qualityCheckedItems = items.filter(
    (item) =>
      item.quality.blurScore !== null ||
      item.quality.warnings.some((warning) =>
        warning.startsWith("image_analysis:"),
      ),
  ).length;
  const duplicateCheckedItems = items.filter(
    (item) =>
      item.quality.duplicateScore !== null ||
      item.quality.warnings.some((warning) =>
        warning.startsWith("duplicate_analysis:"),
      ),
  ).length;
  const aiProcessedItems = items.filter(
    (item) => item.aiExtractionStatus === "processed",
  ).length;
  const engineeringReviewedItems = items.filter(
    (item) => item.processingStatus === "engineering_reviewed",
  ).length;
  const permitConsumedItems = items.filter(
    (item) => item.processingStatus === "permit_consumed",
  ).length;
  const completeness =
    items.length === 0
      ? "missing"
      : requiredMissing.length === 0
        ? "sufficient"
        : "partial";

  const diagnostics: SurveyEvidenceDiagnostics = {
    rawPhotoItemCount: rawItems.length,
    canonicalItemCount: items.length,
    promotedAiReviewedCount: items.filter(
      (item) =>
        item.processingHistory.some(
          (event) => event.source === "category_mapper_v1",
        ) && item.category !== "uncategorized",
    ).length,
    suppressedDuplicateCount: ignoredEvidence.length,
    ignoredEvidence,
    mappingConflicts,
    requirementReasoning: coverage
      .filter((group) => group.required)
      .map((group) => ({
        category: group.category,
        count: group.count,
        status: group.status,
        reason:
          group.status === "present"
            ? `Canonical manifest contains ${group.count} representative evidence item(s) for ${group.category}.`
            : `No representative canonical evidence item mapped to required category ${group.category}.`,
      })),
  };

  return {
    manifestVersion: 1,
    projectId: input.survey.projectId ?? null,
    surveyId: input.survey.id,
    generatedAt,
    sourceOfTruth: "site_surveys+site_survey_files",
    surveyTechnician:
      input.survey.inspectorName ?? extractTechnician(input.survey.surveyData),
    items,
    coverage,
    requiredMissing,
    warnings,
    diagnostics,
    summary: {
      totalItems: items.length,
      classifiedItems,
      qualityCheckedItems,
      duplicateCheckedItems,
      aiProcessedItems,
      engineeringReviewedItems,
      permitConsumedItems,
      confidence:
        completeness === "sufficient"
          ? "high"
          : items.length > 0
            ? "medium"
            : "unknown",
      completeness,
    },
    openSourceBoundaries: {
      webRuntime: [
        "deterministic manifest construction",
        "open-source image quality scoring",
        "open-source duplicate detection",
        "category coverage warnings",
        "admin/project evidence viewer",
        "engineering/permit evidence summary",
      ],
      pythonWorker: [
        "YOLO/Supervision detection candidates",
        "targeted OCR extraction candidates",
      ],
      futureOnly: [
        "Open3D geometry reasoning",
        "FreeCAD automation",
        "Detectron2 segmentation",
        "Label Studio dataset workflows",
      ],
    },
    obstructionSummary: buildObstructionSummary(items),
  };
}

/**
 * Build an obstruction summary across all roof_plane evidence items.
 * Returns null if no roof_plane items have obstruction data.
 */
function buildObstructionSummary(
  items: SurveyEvidenceItem[],
): SurveyEvidenceManifest["obstructionSummary"] {
  const roofItemsWithObstructions = items.filter(
    (item) => item.category === "roof_plane" && item.obstructionData && item.obstructionData.obstructionCount > 0,
  );

  if (roofItemsWithObstructions.length === 0) return null;

  let totalObstructions = 0;
  let reviewedObstructions = 0;
  const typeDistribution: Record<string, number> = {};

  for (const item of roofItemsWithObstructions) {
    const data = item.obstructionData!;
    totalObstructions += data.obstructionCount;
    reviewedObstructions += data.obstructions.filter((o) => o.reviewed).length;

    for (const obs of data.obstructions) {
      const type = obs.obstructionType ?? "unknown";
      typeDistribution[type] = (typeDistribution[type] ?? 0) + 1;
    }
  }

  return {
    roofPhotosWithObstructions: roofItemsWithObstructions.length,
    totalObstructions,
    reviewedObstructions,
    obstructionTypeDistribution: typeDistribution,
  };
}

function buildEvidenceItem(input: {
  survey: Pick<SiteSurvey, "id" | "projectId" | "surveyData" | "inspectorName">;
  file: SiteSurveyFile;
  payloadPhoto: PayloadPhotoLike | null;
  photoAnalysis: SurveyPhotoOpenSourceAnalysis | null;
  obstructionData: SurveyEvidenceObstructionData | null;
  index: number;
  generatedAt: string;
  mappingConflicts?: SurveyEvidenceDiagnostics["mappingConflicts"];
}): SurveyEvidenceItem {
  const submittedCategory =
    input.file.label ?? asString(input.payloadPhoto?.category);
  const category = classifySubmittedEvidenceCategory(
    submittedCategory,
    input.mappingConflicts,
  );
  const classified = category !== "uncategorized";
  const photoAnalysis = input.photoAnalysis;
  const quality = evidenceQualityFromAnalysis(photoAnalysis);
  const image = photoAnalysis?.analyzed
    ? {
        widthPx: photoAnalysis.widthPx,
        heightPx: photoAnalysis.heightPx,
        orientation: inferOrientation(
          photoAnalysis.widthPx,
          photoAnalysis.heightPx,
        ),
      }
    : { widthPx: null, heightPx: null, orientation: null };
  const processingStatus = photoAnalysis?.analyzed
    ? classified
      ? "classified"
      : "quality_checked"
    : classified
      ? "classified"
      : "uploaded";
  const captureTimestamp =
    asString(input.payloadPhoto?.capturedAt) ??
    asString(input.payloadPhoto?.timestamp) ??
    asString(input.payloadPhoto?.createdAt) ??
    input.file.createdAt ??
    null;

  return {
    evidenceId: stableEvidenceId(
      input.survey.id,
      input.file.id || input.file.fileUrl,
      input.index,
    ),
    projectId: input.survey.projectId ?? null,
    surveyId: input.survey.id,
    siteSurveyFileId: input.file.id,
    projectFileId: null,
    fileUrl: input.file.fileUrl,
    blobKey:
      asString(input.payloadPhoto?.uploadKey) ??
      inferBlobKey(input.file.fileUrl),
    filename: input.file.filename,
    mimeType: input.file.mimeType,
    submittedCategory: submittedCategory ?? null,
    category,
    domain: getSurveyEvidenceDomain(category),
    processingStatus,
    evidenceConfidence: classified ? "high" : "unknown",
    evidenceSource: "site_survey_files",
    captureTimestamp,
    surveyTechnician:
      input.survey.inspectorName ?? extractTechnician(input.survey.surveyData),
    image,
    quality,
    sceneGroup: null,
    processingHistory: [
      {
        status: "uploaded",
        source: "survey_ingest",
        at: input.file.createdAt ?? input.generatedAt,
        note: photoAnalysis?.analyzed
          ? `Photo linked from site_survey_files; open-source image scan completed (${photoAnalysis.format ?? "unknown"} ${photoAnalysis.widthPx ?? "?"}x${photoAnalysis.heightPx ?? "?"}, quality ${photoAnalysis.qualityScore}/100).`
          : "Photo linked from site_survey_files; image quality and duplicate analysis unavailable until the route can fetch the image.",
      },
      ...(photoAnalysis?.analyzed
        ? [
            {
              status: "quality_checked" as const,
              source: "sharp_sha256_perceptual_hash_laplacian_v1",
              at: input.generatedAt,
              note: `Quality scan completed: ${photoAnalysis.qualityStatus}, sharpness ${photoAnalysis.sharpnessScore ?? "n/a"}, brightness ${photoAnalysis.brightnessScore ?? "n/a"}.`,
            },
            {
              status: "duplicate_checked" as const,
              source: "sharp_sha256_perceptual_hash_laplacian_v1",
              at: input.generatedAt,
              note: photoAnalysis.duplicateGroupId
                ? `Duplicate scan completed: group ${photoAnalysis.duplicateGroupId}, rank ${photoAnalysis.duplicateRank}/${photoAnalysis.duplicateGroupSize}.`
                : "Duplicate scan completed: no near-duplicate group detected in analyzed survey batch.",
            },
          ]
        : []),
      ...(classified
        ? [
            {
              status: "classified" as const,
              source: "category_mapper_v1",
              at: input.generatedAt,
              note: `Submitted category "${submittedCategory}" mapped to evidence category "${category}".`,
            },
          ]
        : []),
    ],
    aiExtractionStatus: photoAnalysis?.analyzed
      ? "not_applicable"
      : "not_started",
    engineeringUsageReferences: [],
    obstructionData: (input.obstructionData && classified && category === "roof_plane")
      ? input.obstructionData
      : null,
  };
}

function buildPayloadOnlyEvidenceItem(input: {
  survey: Pick<SiteSurvey, "id" | "projectId" | "surveyData" | "inspectorName">;
  payloadPhoto: PayloadPhotoLike;
  index: number;
  generatedAt: string;
  mappingConflicts?: SurveyEvidenceDiagnostics["mappingConflicts"];
}): SurveyEvidenceItem {
  const url = asString(input.payloadPhoto.url) ?? "";
  const submittedCategory = asString(input.payloadPhoto.category);
  const category = classifySubmittedEvidenceCategory(
    submittedCategory,
    input.mappingConflicts,
  );
  const classified = category !== "uncategorized";

  return {
    evidenceId: stableEvidenceId(
      input.survey.id,
      url || "payload-photo",
      input.index,
    ),
    projectId: input.survey.projectId ?? null,
    surveyId: input.survey.id,
    siteSurveyFileId: null,
    projectFileId: null,
    fileUrl: url,
    blobKey: asString(input.payloadPhoto.uploadKey) ?? inferBlobKey(url),
    filename: null,
    mimeType: null,
    submittedCategory: submittedCategory ?? null,
    category,
    domain: getSurveyEvidenceDomain(category),
    processingStatus: classified ? "classified" : "uploaded",
    evidenceConfidence: classified ? "medium" : "unknown",
    evidenceSource: "survey_payload",
    captureTimestamp:
      asString(input.payloadPhoto.capturedAt) ??
      asString(input.payloadPhoto.timestamp) ??
      asString(input.payloadPhoto.createdAt),
    surveyTechnician:
      input.survey.inspectorName ?? extractTechnician(input.survey.surveyData),
    image: { widthPx: null, heightPx: null, orientation: null },
    quality: {
      blurScore: null,
      duplicateScore: null,
      warnings: [
        "Photo exists in survey payload but was not found in site_survey_files.",
      ],
    },
    sceneGroup: null,
    processingHistory: [
      {
        status: "uploaded",
        source: "survey_payload",
        at: input.generatedAt,
        note: "Payload photo was included in manifest because no matching site_survey_files row was found.",
      },
    ],
    aiExtractionStatus: "not_started",
    engineeringUsageReferences: [],
  };
}

function evidenceQualityFromAnalysis(
  analysis: SurveyPhotoOpenSourceAnalysis | null,
): SurveyEvidenceQuality {
  if (!analysis) return { blurScore: null, duplicateScore: null, warnings: [] };
  if (!analysis.analyzed) {
    return {
      blurScore: null,
      duplicateScore: null,
      warnings: [
        "image_analysis:unavailable",
        "duplicate_analysis:unavailable",
        ...(analysis.analysisError
          ? [`image_analysis_error:${analysis.analysisError}`]
          : []),
      ],
    };
  }

  const blurRisk =
    analysis.sharpnessScore === null
      ? null
      : clamp(100 - analysis.sharpnessScore, 0, 100);
  const duplicateScore =
    analysis.duplicateGroupSize > 1
      ? analysis.isDuplicateRepresentative
        ? 35
        : 95
      : 0;
  const warnings = [
    `image_analysis:${analysis.qualityStatus}`,
    `image_analysis_engine:sharp_sha256_perceptual_hash_laplacian_v1`,
    `quality_score:${analysis.qualityScore}`,
    ...analysis.qualityFlags.map((flag) => `quality_flag:${flag}`),
    analysis.duplicateGroupId
      ? `duplicate_analysis:${analysis.duplicateGroupId}:rank_${analysis.duplicateRank}_of_${analysis.duplicateGroupSize}`
      : "duplicate_analysis:no_near_duplicate_detected",
    ...(analysis.isDuplicateRepresentative
      ? []
      : ["duplicate_analysis:not_representative"]),
  ];

  return { blurScore: blurRisk, duplicateScore, warnings };
}

function inferOrientation(
  width: number | null,
  height: number | null,
): string | null {
  if (!width || !height) return null;
  if (width === height) return "square";
  return width > height ? "landscape" : "portrait";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function classifySubmittedEvidenceCategory(
  category: string | null | undefined,
  mappingConflicts?: SurveyEvidenceDiagnostics["mappingConflicts"],
): SurveyEvidenceCategory {
  const exact = normalizeSurveyEvidenceCategory(category);
  const inferred = inferSurveyEvidenceCategoryFromText(category);
  const resolved = exact !== "uncategorized" ? exact : inferred;
  if (
    category &&
    exact !== "uncategorized" &&
    inferred !== "uncategorized" &&
    exact !== inferred
  ) {
    mappingConflicts?.push({
      source: category,
      normalizedCategory: exact,
      inferredCategory: inferred,
      resolvedCategory: resolved,
    });
  }
  return resolved;
}

function suppressDuplicateEvidence(
  rawItems: SurveyEvidenceItem[],
  photoAnalysisByFileId: Map<string, SurveyPhotoOpenSourceAnalysis>,
): {
  items: SurveyEvidenceItem[];
  ignoredEvidence: SurveyEvidenceDiagnostics["ignoredEvidence"];
} {
  const representatives = new Map<string, SurveyEvidenceItem>();
  const ignoredEvidence: SurveyEvidenceDiagnostics["ignoredEvidence"] = [];
  const output: SurveyEvidenceItem[] = [];

  for (const item of rawItems) {
    const analysis = item.siteSurveyFileId
      ? (photoAnalysisByFileId.get(item.siteSurveyFileId) ?? null)
      : null;
    const key = duplicateIdentityKey(item, analysis);
    const existing = representatives.get(key);
    const isKnownNonRepresentative = Boolean(
      analysis &&
      analysis.duplicateGroupSize > 1 &&
      analysis.isDuplicateRepresentative === false,
    );

    if (
      existing &&
      (isKnownNonRepresentative ||
        key.startsWith("url:") ||
        key.startsWith("blob:") ||
        key.startsWith("hash:") ||
        key.startsWith("phash:") ||
        key.startsWith("group:"))
    ) {
      ignoredEvidence.push({
        evidenceId: item.evidenceId,
        siteSurveyFileId: item.siteSurveyFileId,
        fileUrl: item.fileUrl,
        reason: analysis?.duplicateGroupId
          ? `duplicate_suppressed:${analysis.duplicateGroupId}:rank_${analysis.duplicateRank}_of_${analysis.duplicateGroupSize}`
          : "duplicate_suppressed:matching_logical_photo_identity",
        representativeEvidenceId: existing.evidenceId,
      });
      continue;
    }

    representatives.set(key, item);
    output.push(item);
  }

  return { items: output, ignoredEvidence };
}

function duplicateIdentityKey(
  item: SurveyEvidenceItem,
  analysis: SurveyPhotoOpenSourceAnalysis | null,
): string {
  if (analysis?.duplicateGroupId) return `group:${analysis.duplicateGroupId}`;
  if (analysis?.exactHash) return `hash:${analysis.exactHash}`;
  if (analysis?.perceptualHash) return `phash:${analysis.perceptualHash}`;
  if (item.blobKey) return `blob:${item.blobKey}`;
  const normalizedUrl = item.fileUrl.split(/[?#]/)[0];
  if (normalizedUrl) return `url:${normalizedUrl}`;
  return `evidence:${item.evidenceId}`;
}

function buildCoverage(
  items: SurveyEvidenceItem[],
): SurveyEvidenceCoverageGroup[] {
  const tracked = SURVEY_EVIDENCE_CATEGORIES;

  return tracked.map((category) => {
    const count = items.filter((item) => item.category === category).length;
    return {
      category,
      domain: getSurveyEvidenceDomain(category),
      required: REQUIRED_SURVEY_EVIDENCE_CATEGORIES.includes(category),
      count,
      status: count > 0 ? "present" : "missing",
    };
  });
}

function extractPayloadPhotos(
  surveyData: Record<string, unknown> | null | undefined,
): PayloadPhotoLike[] {
  if (!surveyData || typeof surveyData !== "object") return [];
  const photos = (surveyData as { photos?: unknown }).photos;
  if (!Array.isArray(photos)) return [];
  return photos.filter(
    (photo): photo is PayloadPhotoLike =>
      typeof photo === "object" && photo !== null,
  );
}

function findPayloadPhoto(
  file: SiteSurveyFile,
  payloadPhotos: PayloadPhotoLike[],
): PayloadPhotoLike | null {
  return (
    payloadPhotos.find((photo) => {
      const url = asString(photo.url);
      if (url && url === file.fileUrl) return true;
      const category = asString(photo.category);
      return Boolean(category && file.label && category === file.label);
    }) ?? null
  );
}

function extractTechnician(
  surveyData: Record<string, unknown> | null | undefined,
): string | null {
  if (!surveyData || typeof surveyData !== "object") return null;
  const rootInspector = asString(
    (surveyData as { inspector_name?: unknown }).inspector_name,
  );
  if (rootInspector) return rootInspector;
  const siteOverview = (surveyData as { siteOverview?: unknown }).siteOverview;
  if (siteOverview && typeof siteOverview === "object") {
    return asString(
      (siteOverview as { inspectorName?: unknown }).inspectorName,
    );
  }
  return null;
}

function stableEvidenceId(
  surveyId: string,
  source: string,
  index: number,
): string {
  const input = `${surveyId}:${source}:${index}`;
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return `ev_${Math.abs(hash).toString(36).padStart(6, "0")}`;
}

function inferBlobKey(url: string): string | null {
  if (!url) return null;
  const marker = "/surveys/";
  const idx = url.indexOf(marker);
  if (idx >= 0) return url.slice(idx + 1);
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
