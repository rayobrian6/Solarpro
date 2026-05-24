// ============================================================================
// POST /api/site-surveys/[surveyId]/photo-classification-preview
// Operator-triggered, read-only photo evidence classification preview.
// No DB writes, no CAD mutation, no solver execution, no permit trigger.
// ============================================================================

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getSiteSurveyById, getSiteSurveyFiles, isValidUUID } from '@/lib/db-neon';
import { inferSurveyEvidenceCategoryFromText, getSurveyEvidenceLabel, type SurveyEvidenceCategory } from '@/lib/survey/evidence/manifest';
import type { SiteSurveyFile } from '@/lib/db/surveys';

type PreviewCategory = Exclude<SurveyEvidenceCategory, 'duplicate' | 'blurry' | 'unusable'>;

type VisionCandidate = {
  fileId: string;
  filename: string | null;
  fileUrl: string;
  currentLabel: string | null;
  currentCategory: SurveyEvidenceCategory;
  suggestedCategory: PreviewCategory;
  suggestedLabel: string;
  confidence: 'high' | 'medium' | 'low';
  evidenceSignals: string[];
  rationale: string;
  reviewRequired: boolean;
};

const ALLOWED_CATEGORIES: PreviewCategory[] = [
  'main_service_panel',
  'subpanel',
  'meter',
  'disconnect',
  'grounding',
  'utility_connection',
  'roof_plane',
  'roof_edge',
  'ridge',
  'attic',
  'rafters',
  'obstructions',
  'roof_surface',
  'detached_structures',
  'trench_path',
  'battery_location',
  'inverter_location',
  'gateway_location',
  'garage_interior_wall',
  'attic_access',
  'utility_access',
  'overview',
  'uncategorized',
];

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 60;

export async function POST(
  req: NextRequest,
  { params }: { params: { surveyId: string } },
) {
  try {
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const { surveyId } = params;
    if (!isValidUUID(surveyId)) {
      return NextResponse.json({ success: false, error: 'Invalid survey ID' }, { status: 400 });
    }

    const survey = await getSiteSurveyById(surveyId, user.id);
    if (!survey) return NextResponse.json({ success: false, error: 'Survey not found' }, { status: 404 });

    const body = await safeJson(req);
    const requestedLimit = Number(body?.limit ?? DEFAULT_LIMIT);
    const limit = Math.max(1, Math.min(Number.isFinite(requestedLimit) ? requestedLimit : DEFAULT_LIMIT, MAX_LIMIT));
    const includeAlreadyLabeled = body?.includeAlreadyLabeled === true;

    const files = (await getSiteSurveyFiles(surveyId)).filter(file => file.fileType === 'photo');
    const candidates = files
      .filter(file => includeAlreadyLabeled || inferSurveyEvidenceCategoryFromText(file.label ?? file.filename ?? file.fileUrl) === 'uncategorized')
      .slice(0, limit);

    if (candidates.length === 0) {
      return NextResponse.json({
        success: true,
        data: buildResponse([], files, limit, false, 'No uncategorized photos were available for preview classification.'),
      });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      const deterministic = candidates.map(file => deterministicCandidate(file));
      return NextResponse.json({
        success: true,
        data: buildResponse(deterministic, files, limit, false, 'OPENAI_API_KEY is not set; returned deterministic metadata-only suggestions.'),
      });
    }

    const visionCandidates = await classifyWithVision(candidates, apiKey);
    return NextResponse.json({
      success: true,
      data: buildResponse(visionCandidates, files, limit, true, 'Vision classification preview completed. Review suggestions before any future persistence step.'),
    });
  } catch (err) {
    console.error('[POST /api/site-surveys/[surveyId]/photo-classification-preview]', err);
    return NextResponse.json({ success: false, error: 'Failed to classify survey photos' }, { status: 500 });
  }
}

async function classifyWithVision(files: SiteSurveyFile[], apiKey: string): Promise<VisionCandidate[]> {
  const prompt = [
    'You are classifying solar site-survey photos for evidence organization only.',
    'Return strict JSON with key "items" as an array. One item per image in order.',
    `Allowed categories: ${ALLOWED_CATEGORIES.join(', ')}.`,
    'Choose meter for utility meter close/far shots.',
    'Choose main_service_panel for breaker panel / MSP photos.',
    'Choose overview for whole-home exterior/site context shots.',
    'Choose roof_plane for visible roof plane or roof overview shots.',
    'Choose garage_interior_wall, battery_location, inverter_location, or gateway_location for proposed equipment wall/location photos when appropriate.',
    'Choose obstructions for vents, chimneys, skylights, HVAC, or roof obstructions.',
    'If unclear, use uncategorized and reviewRequired true.',
    'Do not infer measurements, code compliance, or CAD geometry.',
    'Each item must include: suggestedCategory, confidence high|medium|low, evidenceSignals string[], rationale string, reviewRequired boolean.',
  ].join('\n');

  const content: Array<Record<string, unknown>> = [{ type: 'text', text: prompt }];
  files.forEach((file, index) => {
    content.push({ type: 'text', text: `Image ${index + 1}: fileId=${file.id}; filename=${file.filename ?? 'unknown'}; currentLabel=${file.label ?? 'none'}` });
    content.push({ type: 'image_url', image_url: { url: file.fileUrl, detail: 'low' } });
  });

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.SURVEY_PHOTO_CLASSIFIER_MODEL || 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: 3500,
      messages: [{ role: 'user', content }],
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`OpenAI Vision classification failed: ${resp.status} ${text.slice(0, 300)}`);
  }

  const json = await resp.json();
  const raw = json?.choices?.[0]?.message?.content;
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const items = Array.isArray(parsed?.items) ? parsed.items : [];

  return files.map((file, index) => {
    const item = items[index] ?? {};
    const category = normalizePreviewCategory(item.suggestedCategory);
    const confidence = item.confidence === 'high' || item.confidence === 'medium' || item.confidence === 'low' ? item.confidence : 'low';
    const evidenceSignals = Array.isArray(item.evidenceSignals)
      ? item.evidenceSignals.filter((signal: unknown): signal is string => typeof signal === 'string').slice(0, 6)
      : [];
    return {
      fileId: file.id,
      filename: file.filename,
      fileUrl: file.fileUrl,
      currentLabel: file.label,
      currentCategory: inferSurveyEvidenceCategoryFromText(file.label ?? file.filename ?? file.fileUrl),
      suggestedCategory: category,
      suggestedLabel: getSurveyEvidenceLabel(category),
      confidence,
      evidenceSignals,
      rationale: typeof item.rationale === 'string' ? item.rationale.slice(0, 500) : 'No rationale returned.',
      reviewRequired: item.reviewRequired !== false || confidence !== 'high',
    };
  });
}

function deterministicCandidate(file: SiteSurveyFile): VisionCandidate {
  const currentCategory = inferSurveyEvidenceCategoryFromText(file.label ?? file.filename ?? file.fileUrl);
  const suggestedCategory = normalizePreviewCategory(currentCategory);
  return {
    fileId: file.id,
    filename: file.filename,
    fileUrl: file.fileUrl,
    currentLabel: file.label,
    currentCategory,
    suggestedCategory,
    suggestedLabel: getSurveyEvidenceLabel(suggestedCategory),
    confidence: suggestedCategory === 'uncategorized' ? 'low' : 'medium',
    evidenceSignals: suggestedCategory === 'uncategorized'
      ? ['No useful label/filename metadata found; vision classification is required.']
      : ['Matched existing label/filename metadata.'],
    rationale: suggestedCategory === 'uncategorized'
      ? 'The current metadata does not identify this photo. Use the vision preview with OPENAI_API_KEY enabled or classify manually.'
      : 'Suggested from existing label/filename metadata only.',
    reviewRequired: true,
  };
}

function buildResponse(candidates: VisionCandidate[], files: SiteSurveyFile[], limit: number, visionExecuted: boolean, note: string) {
  const categoryCounts = Object.fromEntries(ALLOWED_CATEGORIES.map(category => [category, 0])) as Record<PreviewCategory, number>;
  for (const candidate of candidates) categoryCounts[candidate.suggestedCategory] += 1;
  return {
    schemaVersion: 'survey_photo_classification_preview_v1' as const,
    mode: 'operator_triggered_read_only_photo_classification_preview' as const,
    totalPhotoCount: files.length,
    processedPhotoCount: candidates.length,
    skippedPhotoCount: Math.max(files.length - candidates.length, 0),
    requestedLimit: limit,
    visionExecuted,
    categoryCounts,
    candidates,
    note,
    noAuthorityEnforcement: {
      readOnly: true,
      previewOnly: true,
      persistenceAllowed: false,
      siteSurveyFileLabelMutationAllowed: false,
      canonicalEvidenceMutationAllowed: false,
      canonicalGeometryMutationAllowed: false,
      cadMutationAllowed: false,
      cadSolverExecutionAllowed: false,
      downstreamEngineeringAllowed: false,
      downstreamPermitAllowed: false,
    },
  };
}

function normalizePreviewCategory(value: unknown): PreviewCategory {
  const category = inferSurveyEvidenceCategoryFromText(typeof value === 'string' ? value : null);
  return ALLOWED_CATEGORIES.includes(category as PreviewCategory) ? category as PreviewCategory : 'uncategorized';
}

async function safeJson(req: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
