import type { SiteSurvey, SiteSurveyFile } from "@/lib/db/surveys";
import {
  buildSurveyEvidenceManifest,
  type SurveyEvidenceCategory,
  type SurveyEvidenceItem,
  type SurveyEvidenceManifest,
  type SurveyEvidenceCoverageGroup,
  type SurveyEvidenceConfidence,
  REQUIRED_SURVEY_EVIDENCE_CATEGORIES,
  SURVEY_EVIDENCE_CATEGORIES,
  getSurveyEvidenceDomain,
} from "./manifest";
import { buildSurveyEvidenceEngineeringBridge } from "./engineeringBridge";
import { buildSurveyEvidenceTraceability } from "./provenance";

import type {
  EvidenceDuplicateGroup,
  SurveyFilesBySurveyId,
  SurveySessionDuplicateGroup,
  SurveySessionDuplicateStatus,
  SurveySessionSummary,
} from "./sessionTypes";
export type {
  EvidenceDuplicateGroup,
  EvidenceDuplicateStatus,
  SurveyFilesBySurveyId,
  SurveySessionDuplicateGroup,
  SurveySessionDuplicateStatus,
  SurveySessionSummary,
} from "./sessionTypes";

export interface ProjectSurveyEvidenceHygieneManifest {
  manifestVersion: 1;
  projectId: string | null;
  generatedAt: string;
  surveySessionGroupId: string | null;
  canonicalSurveyId: string | null;
  surveySessionDuplicateStatus: SurveySessionDuplicateStatus;
  surveySubmissionCount: number;
  rawEvidenceCount: number;
  canonicalEvidenceCount: number;
  collapsedDuplicateEvidenceCount: number;
  banner: string | null;
  sessions: SurveySessionSummary[];
  sessionGroups: SurveySessionDuplicateGroup[];
  evidenceDuplicateGroups: EvidenceDuplicateGroup[];
  rawManifests: SurveyEvidenceManifest[];
  canonicalManifest: SurveyEvidenceManifest | null;
  engineeringBridge: ReturnType<
    typeof buildSurveyEvidenceEngineeringBridge
  > | null;
  traceability: ReturnType<typeof buildSurveyEvidenceTraceability>;
  warnings: string[];
}

interface BuildProjectSurveyEvidenceHygieneInput {
  projectId: string | null;
  surveys: SurveyFilesBySurveyId[];
  generatedAt?: string;
}

interface EvidenceWithSurvey {
  item: SurveyEvidenceItem;
  survey: SiteSurvey;
}

export function buildProjectSurveyEvidenceHygiene(
  input: BuildProjectSurveyEvidenceHygieneInput,
): ProjectSurveyEvidenceHygieneManifest {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const orderedSurveys = [...input.surveys].sort(compareNewestSurveyFirst);
  const rawManifests = orderedSurveys.map(({ survey, files }) =>
    buildSurveyEvidenceManifest({ survey, files, generatedAt }),
  );
  const allEvidence = rawManifests.flatMap((manifest, manifestIndex) =>
    manifest.items.map((item) => ({
      item,
      survey: orderedSurveys[manifestIndex].survey,
    })),
  );

  const evidenceDuplicateGroups = buildEvidenceDuplicateGroups(allEvidence);
  const canonicalEvidenceIds = new Set(
    evidenceDuplicateGroups.map((group) => group.canonicalEvidenceId),
  );
  const duplicateEvidenceIds = new Set(
    evidenceDuplicateGroups.flatMap((group) =>
      group.evidenceIds.filter((id) => id !== group.canonicalEvidenceId),
    ),
  );
  const canonicalItems = allEvidence
    .filter(
      ({ item }) =>
        canonicalEvidenceIds.has(item.evidenceId) ||
        !duplicateEvidenceIds.has(item.evidenceId),
    )
    .map(({ item }) =>
      annotateCanonicalEvidence(item, evidenceDuplicateGroups),
    );

  const sessionGroups = buildSurveySessionGroups(
    orderedSurveys,
    rawManifests,
    evidenceDuplicateGroups,
    canonicalEvidenceIds,
  );
  const sessionGroup =
    sessionGroups.find((group) => group.surveyIds.length > 1) ??
    sessionGroups[0] ??
    null;
  const canonicalSurveyId =
    sessionGroup?.canonicalSurveyId ?? orderedSurveys[0]?.survey.id ?? null;
  const sessions = orderedSurveys.map(({ survey }, index) => {
    const manifest = rawManifests[index];
    const group = sessionGroups.find((candidate) =>
      candidate.surveyIds.includes(survey.id),
    );
    const status = group?.statusBySurveyId[survey.id] ?? "unknown";
    return {
      surveyId: survey.id,
      surveySessionGroupId:
        group?.surveySessionGroupId ?? stableGroupId("session", [survey.id]),
      surveySessionDuplicateStatus: status,
      isCanonical: survey.id === group?.canonicalSurveyId,
      submittedAt: survey.createdAt ?? survey.updatedAt ?? null,
      technician: survey.inspectorName ?? extractTechnician(survey.surveyData),
      source: survey.source,
      rawPhotoCount: manifest.items.length,
      canonicalEvidenceCount: canonicalItems.filter(
        (item) => item.surveyId === survey.id,
      ).length,
      categoryCoverage: categoriesPresent(manifest.items),
      duplicateReason:
        group && group.surveyIds.length > 1 ? group.duplicateReason : null,
    } satisfies SurveySessionSummary;
  });

  const canonicalManifest = canonicalSurveyId
    ? buildCanonicalProjectManifest({
        projectId: input.projectId,
        canonicalSurveyId,
        generatedAt,
        items: canonicalItems,
        sourceManifests: rawManifests,
      })
    : null;

  const traceability = buildSurveyEvidenceTraceability({
    canonicalManifest,
    evidenceTruthSource: "canonical_manifest_v1",
    evidenceDuplicateGroups,
    sessions,
  });

  const repeatedSubmissionGroups = sessionGroups.filter(
    (group) => group.surveyIds.length > 1,
  );
  const warnings: string[] = [];
  if (repeatedSubmissionGroups.length > 0) {
    const total = repeatedSubmissionGroups.reduce(
      (sum, group) => sum + group.surveyIds.length,
      0,
    );
    warnings.push(
      `${total} survey submissions detected with overlapping evidence. Raw uploads are preserved; canonical coverage uses deduped representatives.`,
    );
  }


  return {
    manifestVersion: 1,
    projectId: input.projectId,
    generatedAt,
    surveySessionGroupId: sessionGroup?.surveySessionGroupId ?? null,
    canonicalSurveyId,
    surveySessionDuplicateStatus:
      sessionGroup && sessionGroup.surveyIds.length > 1
        ? "canonical"
        : orderedSurveys.length > 0
          ? "unique"
          : "unknown",
    surveySubmissionCount: orderedSurveys.length,
    rawEvidenceCount: allEvidence.length,
    canonicalEvidenceCount: canonicalItems.length,
    collapsedDuplicateEvidenceCount: Math.max(
      0,
      allEvidence.length - canonicalItems.length,
    ),
    banner:
      repeatedSubmissionGroups.length > 0
        ? `${repeatedSubmissionGroups.reduce((sum, group) => sum + group.surveyIds.length, 0)} survey submissions detected with overlapping evidence.`
        : null,
    sessions,
    sessionGroups,
    evidenceDuplicateGroups,
    rawManifests,
    canonicalManifest,
    engineeringBridge: canonicalManifest
      ? buildSurveyEvidenceEngineeringBridge(canonicalManifest, traceability)
      : null,
    traceability,
    warnings,
  };
}

function buildEvidenceDuplicateGroups(
  evidence: EvidenceWithSurvey[],
): EvidenceDuplicateGroup[] {
  const groups = new Map<string, EvidenceWithSurvey[]>();
  for (const candidate of evidence) {
    const key = evidenceFingerprint(candidate.item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)?.push(candidate);
  }

  const result: EvidenceDuplicateGroup[] = [];
  for (const [fingerprint, members] of groups.entries()) {
    if (members.length < 2) continue;
    const canonical = [...members].sort(compareBestEvidenceFirst)[0];
    const ids = members.map((member) => member.item.evidenceId).sort();
    const surveyIds = Array.from(
      new Set(members.map((member) => member.item.surveyId)),
    ).sort();
    result.push({
      evidenceDuplicateGroupId: stableGroupId("evidence", [
        fingerprint,
        ...ids,
      ]),
      canonicalEvidenceId: canonical.item.evidenceId,
      canonicalSurveyId: canonical.item.surveyId,
      evidenceIds: ids,
      surveyIds,
      duplicateCount: members.length - 1,
      duplicateReason: duplicateReasonForEvidence(canonical.item),
      category: canonical.item.category,
      rawUploadCount: members.length,
    });
  }
  return result.sort((a, b) =>
    a.evidenceDuplicateGroupId.localeCompare(b.evidenceDuplicateGroupId),
  );
}

function buildSurveySessionGroups(
  surveys: SurveyFilesBySurveyId[],
  manifests: SurveyEvidenceManifest[],
  evidenceGroups: EvidenceDuplicateGroup[],
  canonicalEvidenceIds: Set<string>,
): SurveySessionDuplicateGroup[] {
  const parent = new Map<string, string>();
  for (const { survey } of surveys) parent.set(survey.id, survey.id);

  const find = (id: string): string => {
    const current = parent.get(id) ?? id;
    if (current === id) return current;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
  };

  for (const group of evidenceGroups) {
    if (group.surveyIds.length < 2) continue;
    const [first, ...rest] = group.surveyIds;
    for (const id of rest) union(first, id);
  }

  for (let i = 0; i < surveys.length; i += 1) {
    for (let j = i + 1; j < surveys.length; j += 1) {
      if (
        areLikelyRepeatedSessions(
          surveys[i].survey,
          manifests[i],
          surveys[j].survey,
          manifests[j],
        )
      ) {
        union(surveys[i].survey.id, surveys[j].survey.id);
      }
    }
  }

  const byRoot = new Map<string, number[]>();
  surveys.forEach(({ survey }, index) => {
    const root = find(survey.id);
    if (!byRoot.has(root)) byRoot.set(root, []);
    byRoot.get(root)?.push(index);
  });

  return Array.from(byRoot.values())
    .map((indices) => {
      const groupSurveys = indices.map((index) => surveys[index].survey);
      const groupManifests = indices.map((index) => manifests[index]);
      const canonicalSurvey = [...groupSurveys].sort((a, b) =>
        compareBestSurveyFirst(
          a,
          b,
          manifests[surveys.findIndex((entry) => entry.survey.id === a.id)],
          manifests[surveys.findIndex((entry) => entry.survey.id === b.id)],
        ),
      )[0];
      const surveyIds = groupSurveys.map((survey) => survey.id).sort();
      const statusBySurveyId: Record<string, SurveySessionDuplicateStatus> = {};
      for (const survey of groupSurveys) {
        statusBySurveyId[survey.id] =
          groupSurveys.length === 1
            ? "unique"
            : survey.id === canonicalSurvey.id
              ? "canonical"
              : "overlapping_duplicate";
      }
      const allItems = groupManifests.flatMap((manifest) => manifest.items);
      const canonicalCount =
        allItems.filter((item) => canonicalEvidenceIds.has(item.evidenceId))
          .length || (groupSurveys.length === 1 ? allItems.length : 0);
      return {
        surveySessionGroupId: stableGroupId("session", surveyIds),
        canonicalSurveyId: canonicalSurvey.id,
        surveyIds,
        duplicateCount: Math.max(0, surveyIds.length - 1),
        duplicateReason:
          groupSurveys.length > 1
            ? "same project with overlapping metadata evidence batches: shared evidence fingerprints, similar photo counts, similar category coverage, and/or close submitted windows"
            : "single unique survey submission",
        statusBySurveyId,
        rawPhotoCount: allItems.length,
        canonicalEvidenceCount: canonicalCount,
        similarCategoryCoverage: categoriesPresent(allItems),
      } satisfies SurveySessionDuplicateGroup;
    })
    .sort(
      (a, b) =>
        b.surveyIds.length - a.surveyIds.length ||
        a.surveySessionGroupId.localeCompare(b.surveySessionGroupId),
    );
}

function buildCanonicalProjectManifest(input: {
  projectId: string | null;
  canonicalSurveyId: string;
  generatedAt: string;
  items: SurveyEvidenceItem[];
  sourceManifests: SurveyEvidenceManifest[];
}): SurveyEvidenceManifest {
  const coverage = buildCoverage(input.items);
  const requiredMissing = coverage
    .filter((group) => group.required && group.status === "missing")
    .map((group) => group.category);
  const warnings = [
    ...new Set([
      ...input.sourceManifests.flatMap((manifest) => manifest.warnings),
      ...requiredMissing.map(
        (category) => `Missing required survey evidence category: ${category}`,
      ),
    ]),
  ];
  const classifiedItems = input.items.filter(
    (item) => item.category !== "uncategorized",
  ).length;
  const completeness =
    input.items.length === 0
      ? "missing"
      : requiredMissing.length === 0
        ? "sufficient"
        : "partial";
  const rawPhotoItemCount = input.sourceManifests.reduce(
    (sum, manifest) =>
      sum + (manifest.diagnostics?.rawPhotoItemCount ?? manifest.summary.totalItems),
    0,
  );
  const diagnostics = {
    rawPhotoItemCount,
    canonicalItemCount: input.items.length,
    promotedAiReviewedCount: input.items.filter(
      (item) => item.category !== "uncategorized",
    ).length,
    suppressedDuplicateCount: Math.max(0, rawPhotoItemCount - input.items.length),
    ignoredEvidence: input.sourceManifests
      .flatMap((manifest) => manifest.diagnostics?.ignoredEvidence ?? [])
      .slice(0, 100),
    mappingConflicts: input.sourceManifests
      .flatMap((manifest) => manifest.diagnostics?.mappingConflicts ?? [])
      .slice(0, 100),
    requirementReasoning: coverage
      .filter((group) => group.required)
      .map((group) => ({
        category: group.category,
        count: group.count,
        status: group.status,
        reason:
          group.status === "present"
            ? `Canonical project manifest contains ${group.count} representative evidence item(s) for ${group.category}.`
            : `No representative canonical project evidence item mapped to required category ${group.category}.`,
      })),
  };

  return {
    manifestVersion: 1,
    projectId: input.projectId,
    surveyId: input.canonicalSurveyId,
    generatedAt: input.generatedAt,
    sourceOfTruth: "site_surveys+site_survey_files",
    surveyTechnician: null,
    items: input.items,
    coverage,
    requiredMissing,
    warnings,
    diagnostics,
    summary: {
      totalItems: input.items.length,
      classifiedItems,
      qualityCheckedItems: 0,
      duplicateCheckedItems: 0,
      aiProcessedItems: 0,
      engineeringReviewedItems: 0,
      permitConsumedItems: 0,
      confidence:
        completeness === "sufficient"
          ? "high"
          : input.items.length > 0
            ? "medium"
            : ("unknown" as SurveyEvidenceConfidence),
      completeness,
    },
    openSourceBoundaries: input.sourceManifests[0]?.openSourceBoundaries ?? {
      webRuntime: ["deterministic repeated survey hygiene"],
      pythonWorker: ["OpenCV blur/orientation/duplicate scoring"],
      futureOnly: ["Open3D geometry reasoning", "FreeCAD automation"],
    },
  };
}

function annotateCanonicalEvidence(
  item: SurveyEvidenceItem,
  groups: EvidenceDuplicateGroup[],
): SurveyEvidenceItem {
  const group = groups.find((candidate) =>
    candidate.evidenceIds.includes(item.evidenceId),
  );
  if (!group) return item;
  return {
    ...item,
    sceneGroup: group.evidenceDuplicateGroupId,
    quality: {
      ...item.quality,
      warnings: item.quality.warnings,
      duplicateScore: null,
    },
    processingHistory: [
      ...item.processingHistory,
      {
        status: "duplicate_checked",
        source: "metadata_duplicate_hygiene_v1",
        at: item.captureTimestamp ?? new Date(0).toISOString(),
        note: `Canonical representative for ${group.rawUploadCount} metadata-matched raw upload(s); no image bytes or perceptual hash used.`,
      },
    ],
  };
}

function buildCoverage(
  items: SurveyEvidenceItem[],
): SurveyEvidenceCoverageGroup[] {
  return SURVEY_EVIDENCE_CATEGORIES.map((category) => {
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

function areLikelyRepeatedSessions(
  a: SiteSurvey,
  aManifest: SurveyEvidenceManifest,
  b: SiteSurvey,
  bManifest: SurveyEvidenceManifest,
): boolean {
  if (!a.projectId || !b.projectId || a.projectId !== b.projectId) return false;
  const photoCountsSimilar =
    Math.abs(aManifest.items.length - bManifest.items.length) <=
    Math.max(
      2,
      Math.ceil(Math.max(aManifest.items.length, bManifest.items.length) * 0.2),
    );
  const coverageSimilarity = jaccard(
    categoriesPresent(aManifest.items),
    categoriesPresent(bManifest.items),
  );
  const sameTechnician =
    normalizeText(a.inspectorName ?? extractTechnician(a.surveyData)) ===
    normalizeText(b.inspectorName ?? extractTechnician(b.surveyData));
  const closeWindow =
    Math.abs(timestamp(a.createdAt) - timestamp(b.createdAt)) <=
    1000 * 60 * 60 * 24 * 14;
  const sameSource = a.source === b.source;
  return (
    photoCountsSimilar &&
    coverageSimilarity >= 0.5 &&
    (sameTechnician || sameSource || closeWindow)
  );
}

function compareNewestSurveyFirst(
  a: SurveyFilesBySurveyId,
  b: SurveyFilesBySurveyId,
): number {
  return timestamp(b.survey.createdAt) - timestamp(a.survey.createdAt);
}

function compareBestSurveyFirst(
  a: SiteSurvey,
  b: SiteSurvey,
  aManifest?: SurveyEvidenceManifest,
  bManifest?: SurveyEvidenceManifest,
): number {
  const aScore = surveyScore(a, aManifest);
  const bScore = surveyScore(b, bManifest);
  if (aScore !== bScore) return bScore - aScore;
  return timestamp(b.createdAt) - timestamp(a.createdAt);
}

function compareBestEvidenceFirst(
  a: EvidenceWithSurvey,
  b: EvidenceWithSurvey,
): number {
  const aScore = evidenceScore(a.item);
  const bScore = evidenceScore(b.item);
  if (aScore !== bScore) return bScore - aScore;
  return (
    timestamp(b.item.captureTimestamp ?? b.survey.createdAt) -
    timestamp(a.item.captureTimestamp ?? a.survey.createdAt)
  );
}

function surveyScore(
  survey: SiteSurvey,
  manifest?: SurveyEvidenceManifest,
): number {
  const requiredPresent =
    manifest?.coverage.filter(
      (group) => group.required && group.status === "present",
    ).length ?? 0;
  const classified = manifest?.summary.classifiedItems ?? 0;
  const total = manifest?.summary.totalItems ?? survey.fileCount ?? 0;
  return requiredPresent * 100 + classified * 5 + total;
}

function evidenceScore(item: SurveyEvidenceItem): number {
  let score = 0;
  if (item.category !== "uncategorized") score += 100;
  if (item.siteSurveyFileId) score += 20;
  if (item.filename) score += 5;
  if (item.mimeType) score += 3;
  if (item.captureTimestamp) score += 1;
  return score;
}

function evidenceFingerprint(item: SurveyEvidenceItem): string {
  const filename = normalizeFilename(
    item.filename ?? filenameFromUrl(item.fileUrl) ?? item.blobKey,
  );
  const urlHint = normalizeUrlHint(item.blobKey ?? item.fileUrl);
  const category = item.category;
  const submitted = normalizeText(item.submittedCategory);
  const mime = normalizeText(item.mimeType);
  return [
    item.projectId ?? "no_project",
    filename,
    urlHint,
    mime,
    category,
    submitted,
  ].join("|");
}

function duplicateReasonForEvidence(item: SurveyEvidenceItem): string {
  return [
    "metadata match on project_id",
    item.filename ? "normalized filename" : "url/storage-key filename hint",
    item.mimeType ? "content type" : null,
    item.submittedCategory ? "category label" : null,
    "survey_id grouping preserved",
  ]
    .filter(Boolean)
    .join(", ");
}

function categoriesPresent(
  items: SurveyEvidenceItem[],
): SurveyEvidenceCategory[] {
  return Array.from(
    new Set(
      items
        .filter((item) => item.category !== "uncategorized")
        .map((item) => item.category),
    ),
  ).sort();
}

function jaccard(
  a: SurveyEvidenceCategory[],
  b: SurveyEvidenceCategory[],
): number {
  const setA = new Set(a);
  const setB = new Set(b);
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 0;
  let intersection = 0;
  for (const value of setA) if (setB.has(value)) intersection += 1;
  return intersection / union.size;
}

function stableGroupId(prefix: string, parts: string[]): string {
  const input = parts.filter(Boolean).sort().join("|");
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return `${prefix}_${Math.abs(hash).toString(36).padStart(8, "0")}`;
}

function extractTechnician(
  surveyData: Record<string, unknown> | null | undefined,
): string | null {
  if (!surveyData || typeof surveyData !== "object") return null;
  const inspector = (surveyData as { inspector_name?: unknown }).inspector_name;
  if (typeof inspector === "string" && inspector.trim())
    return inspector.trim();
  const siteOverview = (surveyData as { siteOverview?: unknown }).siteOverview;
  if (siteOverview && typeof siteOverview === "object") {
    const nested = (siteOverview as { inspectorName?: unknown }).inspectorName;
    if (typeof nested === "string" && nested.trim()) return nested.trim();
  }
  return null;
}

function timestamp(value: string | null | undefined): number {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeText(value: string | null | undefined): string {
  return (
    value
      ?.trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_") ?? ""
  );
}

function normalizeFilename(value: string | null | undefined): string {
  if (!value) return "";
  const base = value.split(/[\\/]/).pop() ?? value;
  return base
    .trim()
    .toLowerCase()
    .replace(/^[0-9]{10,}-/, "")
    .replace(/[\s]+/g, "_");
}

function filenameFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.pathname.split("/").pop() ?? null;
  } catch {
    return url.split("/").pop() ?? null;
  }
}

function normalizeUrlHint(value: string | null | undefined): string {
  if (!value) return "";
  return normalizeFilename(filenameFromUrl(value) ?? value);
}
