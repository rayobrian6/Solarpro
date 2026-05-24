// ============================================================================
// POST /api/site-surveys/[surveyId]/photo-classification-preview/apply
// Applies operator-reviewed photo labels to the existing site_survey_files.label
// path. This intentionally does not create CAD geometry, run solvers, or trigger
// permit generation. Existing evidence manifest/readiness code consumes labels.
// ============================================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import {
  diagnoseSiteSurveyFileLabelUpdateMatches,
  getSiteSurveyById,
  getSiteSurveyFiles,
  isValidUUID,
  updateSiteSurveyFileLabels,
} from "@/lib/db-neon";
import {
  buildSurveyEvidenceManifest,
  inferSurveyEvidenceCategoryFromText,
  getSurveyEvidenceLabel,
  type SurveyEvidenceCategory,
} from "@/lib/survey/evidence/manifest";
import { analyzeSurveyPhotosOpenSource } from "@/lib/siteSurvey/photoIntelligence";
import { buildSurveyEvidenceTraceability } from "@/lib/survey/evidence/provenance";
import { buildSurveyEvidenceEngineeringBridge } from "@/lib/survey/evidence/engineeringBridge";

type ApplyItem = {
  fileId: string;
  acceptedCategory: SurveyEvidenceCategory;
};

const NON_APPLY_CATEGORIES = new Set<SurveyEvidenceCategory>([
  "uncategorized",
  "duplicate",
  "blurry",
  "unusable",
]);
const MAX_APPLY = 120;

export async function POST(
  req: NextRequest,
  { params }: { params: { surveyId: string } },
) {
  try {
    const user = getUserFromRequest(req);
    if (!user)
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );

    const { surveyId } = params;
    if (!isValidUUID(surveyId)) {
      return NextResponse.json(
        { success: false, error: "Invalid survey ID" },
        { status: 400 },
      );
    }

    const survey = await getSiteSurveyById(surveyId, user.id);
    if (!survey)
      return NextResponse.json(
        { success: false, error: "Survey not found" },
        { status: 404 },
      );

    const body = await safeJson(req);
    const rawItems = Array.isArray(body?.items)
      ? body.items.slice(0, MAX_APPLY)
      : [];
    const files = await getSiteSurveyFiles(surveyId);
    const fileIds = new Set(files.map((file) => file.id));
    const beforeLabelSnapshot = files.map((file) => ({
      fileId: file.id,
      filename: file.filename,
      label: file.label,
      category: inferSurveyEvidenceCategoryFromText(
        file.label ?? file.filename ?? file.fileUrl,
      ),
    }));

    const normalizedItems = rawItems.map((item) => normalizeApplyItem(item));
    const rejectedItems = normalizedItems.map((item, index) => {
      if (!item) {
        return {
          index,
          reason: "invalid_shape_or_missing_file_id",
          rawItem: summarizeRawApplyItem(rawItems[index]),
        };
      }
      if (!fileIds.has(item.fileId)) {
        return {
          index,
          fileId: item.fileId,
          acceptedCategory: item.acceptedCategory,
          reason: "file_id_not_in_requested_survey_files",
        };
      }
      if (NON_APPLY_CATEGORIES.has(item.acceptedCategory)) {
        return {
          index,
          fileId: item.fileId,
          acceptedCategory: item.acceptedCategory,
          reason: "non_apply_category",
        };
      }
      return null;
    }).filter((item): item is NonNullable<typeof item> => item !== null);

    const items: ApplyItem[] = normalizedItems.filter((item): item is ApplyItem =>
      Boolean(
        item &&
        fileIds.has(item.fileId) &&
        !NON_APPLY_CATEGORIES.has(item.acceptedCategory),
      ),
    );

    if (items.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "No valid reviewed classifications were supplied",
          diagnostics: {
            requestReceived: true,
            requestedCount: rawItems.length,
            acceptedCount: 0,
            updateCount: 0,
            updatedCount: 0,
            rejectedCount: rejectedItems.length,
            rejectedItems,
            availableFileIds: files.map((file) => file.id),
            authority: {
              cadMutationAllowed: false,
              cadSolverExecutionAllowed: false,
              downstreamPermitAllowed: false,
            },
          },
        },
        { status: 400 },
      );
    }

    const deduped = Array.from(
      new Map(items.map((item) => [item.fileId, item])).values(),
    );
    const updates = deduped.map((item) => ({
      fileId: item.fileId,
      label: item.acceptedCategory,
    }));

    const updatedFiles = await updateSiteSurveyFileLabels(
      surveyId,
      user.id,
      updates,
    );

    if (updatedFiles.length !== updates.length) {
      const unmatchedFileIds = updates
        .map((update) => update.fileId)
        .filter((fileId) => !updatedFiles.some((file) => file.id === fileId));
      const rowMatchDiagnostics =
        await diagnoseSiteSurveyFileLabelUpdateMatches(
          surveyId,
          user.id,
          unmatchedFileIds,
        );

      return NextResponse.json(
        {
          success: false,
          error:
            "No survey file labels were updated for one or more reviewed classifications; canonical evidence was not recomputed from stale rows.",
          diagnostics: {
            requestReceived: true,
            requestedCount: rawItems.length,
            acceptedCount: deduped.length,
            updateCount: updates.length,
            updatedCount: updatedFiles.length,
            rejectedCount: rejectedItems.length,
            rejectedItems,
            normalizedUpdates: updates,
            updatedFileIds: updatedFiles.map((file) => file.id),
            unmatchedFileIds,
            rowMatchDiagnostics,
            beforeLabelSnapshot: beforeLabelSnapshot.filter((file) =>
              updates.some((update) => update.fileId === file.fileId),
            ),
            authority: {
              cadMutationAllowed: false,
              cadSolverExecutionAllowed: false,
              downstreamPermitAllowed: false,
            },
          },
        },
        { status: 409 },
      );
    }

    const refreshedFiles = await getSiteSurveyFiles(surveyId);
    const persistedLabelSnapshot = refreshedFiles
      .filter((file) => updates.some((update) => update.fileId === file.id))
      .map((file) => ({
        fileId: file.id,
        filename: file.filename,
        label: file.label,
        category: inferSurveyEvidenceCategoryFromText(
          file.label ?? file.filename ?? file.fileUrl,
        ),
      }));
    const failedPersistence = updates.filter((update) => {
      const refreshed = refreshedFiles.find((file) => file.id === update.fileId);
      return !refreshed || refreshed.label !== update.label;
    });

    if (failedPersistence.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Reviewed labels were acknowledged by the update helper but did not persist in site_survey_files.label after re-query.",
          diagnostics: {
            requestReceived: true,
            requestedCount: rawItems.length,
            acceptedCount: deduped.length,
            updateCount: updates.length,
            updatedCount: updatedFiles.length,
            rejectedCount: rejectedItems.length,
            rejectedItems,
            normalizedUpdates: updates,
            failedPersistence,
            beforeLabelSnapshot: beforeLabelSnapshot.filter((file) =>
              updates.some((update) => update.fileId === file.fileId),
            ),
            persistedLabelSnapshot,
            authority: {
              cadMutationAllowed: false,
              cadSolverExecutionAllowed: false,
              downstreamPermitAllowed: false,
            },
          },
        },
        { status: 409 },
      );
    }

    const photoAnalysis = await analyzeSurveyPhotosOpenSource(
      refreshedFiles.filter((file) => file.fileType === "photo"),
    );
    const evidenceManifest = buildSurveyEvidenceManifest({
      survey,
      files: refreshedFiles,
      photoAnalysis,
    });
    const evidenceTraceability = buildSurveyEvidenceTraceability({
      canonicalManifest: evidenceManifest,
      evidenceTruthSource: "canonical_manifest_v1",
    });
    const evidenceBridge = buildSurveyEvidenceEngineeringBridge(
      evidenceManifest,
      evidenceTraceability,
    );
    const appliedCategoryCounts = updatedFiles.reduce<Record<string, number>>(
      (acc, file) => {
        const category = inferSurveyEvidenceCategoryFromText(file.label);
        acc[category] = (acc[category] ?? 0) + 1;
        return acc;
      },
      {},
    );

    return NextResponse.json({
      success: true,
      data: {
        schemaVersion: "survey_photo_classification_apply_v1",
        surveyId,
        requestedCount: rawItems.length,
        acceptedCount: deduped.length,
        appliedCount: updatedFiles.length,
        appliedCategoryCounts,
        updatedFiles: updatedFiles.map((file) => ({
          fileId: file.id,
          label: file.label,
          category: inferSurveyEvidenceCategoryFromText(file.label),
          categoryLabel: getSurveyEvidenceLabel(
            inferSurveyEvidenceCategoryFromText(file.label),
          ),
        })),
        diagnostics: {
          persistence: {
            requestReceived: true,
            requestedCount: rawItems.length,
            acceptedCount: deduped.length,
            updateCount: updates.length,
            updatedCount: updatedFiles.length,
            rejectedCount: rejectedItems.length,
            rejectedItems,
            normalizedUpdates: updates,
            beforeLabelSnapshot: beforeLabelSnapshot.filter((file) =>
              updates.some((update) => update.fileId === file.fileId),
            ),
            persistedLabelSnapshot,
          },
          canonicalCounts: {
            rawPhotoItemCount: evidenceManifest.diagnostics.rawPhotoItemCount,
            canonicalItemCount: evidenceManifest.diagnostics.canonicalItemCount,
            promotedAiReviewedCount:
              evidenceManifest.diagnostics.promotedAiReviewedCount,
            suppressedDuplicateCount:
              evidenceManifest.diagnostics.suppressedDuplicateCount,
            requiredMissing: evidenceManifest.requiredMissing,
            classifiedItems: evidenceManifest.summary.classifiedItems,
            qualityCheckedItems: evidenceManifest.summary.qualityCheckedItems,
          },
          ignoredEvidence: evidenceManifest.diagnostics.ignoredEvidence.slice(
            0,
            25,
          ),
          mappingConflicts: evidenceManifest.diagnostics.mappingConflicts.slice(
            0,
            25,
          ),
          requirementReasoning:
            evidenceManifest.diagnostics.requirementReasoning,
        },
        refreshedDetail: {
          files: refreshedFiles,
          evidenceManifest,
          evidenceTraceability,
          evidenceBridge,
        },
        authority: {
          operatorReviewedLabelPersistence: true,
          canonicalEvidenceRecomputedByExistingManifestPath: true,
          cadMutationAllowed: false,
          cadSolverExecutionAllowed: false,
          downstreamPermitAllowed: false,
        },
      },
    });
  } catch (err) {
    console.error(
      "[POST /api/site-surveys/[surveyId]/photo-classification-preview/apply]",
      err,
    );
    return NextResponse.json(
      {
        success: false,
        error: "Failed to apply reviewed photo classifications",
        diagnostics: {
          requestReceived: true,
          authority: {
            cadMutationAllowed: false,
            cadSolverExecutionAllowed: false,
            downstreamPermitAllowed: false,
          },
        },
      },
      { status: 500 },
    );
  }
}

function summarizeRawApplyItem(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return {
    fileId: typeof record.fileId === "string" ? record.fileId : null,
    acceptedCategory:
      typeof record.acceptedCategory === "string"
        ? record.acceptedCategory
        : null,
  };
}

function normalizeApplyItem(value: unknown): ApplyItem | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const fileId = typeof record.fileId === "string" ? record.fileId : null;
  const accepted = inferSurveyEvidenceCategoryFromText(
    typeof record.acceptedCategory === "string"
      ? record.acceptedCategory
      : null,
  );
  if (!fileId) return null;
  return { fileId, acceptedCategory: accepted };
}

async function safeJson(
  req: NextRequest,
): Promise<Record<string, unknown> | null> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
