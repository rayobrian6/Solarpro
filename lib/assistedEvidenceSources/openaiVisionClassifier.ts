/**
 * OpenAI Vision Classification Module
 *
 * Uses GPT-4o Vision to classify survey photos into evidence categories.
 * This is the primary method for detecting main_service_panel photos,
 * which YOLO cannot reliably detect.
 *
 * Architecture:
 *   Unclassified photo (NULL label)
 *       ↓
 *   OpenAI Vision API call (GPT-4o)
 *       ↓
 *   EvidenceCategory classification + confidence
 *       ↓
 *   site_survey_files.label updated
 *
 * Cost considerations:
 *   - GPT-4o: ~$0.0025/image (85 tokens input + 100 tokens output)
 *   - For 5 unclassified photos: ~$0.01 total
 *   - Only called for photos that heuristic classification couldn't handle
 *
 * Fallback strategy:
 *   1. YOLO object_detection → direct category mapping
 *   2. Roof edge heuristic → roof_plane
 *   3. Candidate diversity heuristic → overview
 *   4. OpenAI Vision → any category (this module)
 *   5. Manual labeling → remaining unclassified
 */

import type { SurveyEvidenceCategory } from '@/lib/survey/evidence/categoryRegistry';

// ─────────────────────────────────────────────────────────────────────────────
// Section 1: Types
// ─────────────────────────────────────────────────────────────────────────────

export interface VisionClassificationResult {
  /** The file_id being classified */
  fileId: string;
  /** The filename of the photo */
  filename: string;
  /** The classified evidence category */
  category: SurveyEvidenceCategory | null;
  /** Confidence score (0-1) */
  confidence: number;
  /** Method used for classification */
  method: 'openai_vision';
  /** GPT-4o's reasoning for the classification */
  reasoning: string;
  /** Whether this classification should be auto-applied */
  autoApply: boolean;
}

export interface VisionClassificationBatchResult {
  /** Total photos classified */
  totalClassified: number;
  /** Results per photo */
  results: VisionClassificationResult[];
  /** Cost estimate in USD */
  estimatedCost: number;
  /** Any errors encountered */
  errors: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 2: Classification Prompt
// ─────────────────────────────────────────────────────────────────────────────

const CLASSIFICATION_PROMPT = `You are an expert at classifying photos from solar energy site surveys. Analyze this photo and classify it into exactly ONE of the following categories:

1. **main_service_panel** - A photo of an electrical panel, breaker box, or main service panel. Key visual indicators:
   - Rectangular metal box with a door (open or closed)
   - Rows of circuit breakers (small rectangular switches)
   - Usually mounted on a wall (indoor garage, basement, or exterior)
   - May have labels/ratings visible (e.g., "200A", "MAIN")
   - Wiring visible if panel door is open
   - This is NOT a meter (meters are round/digital devices mounted outside)

2. **roof_plane** - A photo showing a roof surface. Key indicators:
   - Sloped or flat roof surface visible
   - Roofing material visible (shingles, tiles, metal panels)
   - May show vents, pipes, chimneys, or skylights ON the roof
   - Sky visible at edges
   - Taken from ON the roof or looking up at the roof

3. **meter** - A photo of an electrical utility meter. Key indicators:
   - Glass dome or digital display
   - Round or rectangular device smaller than a panel
   - Mounted on exterior wall
   - Utility company label visible
   - LCD/LED display showing consumption

4. **overview** - A wide-angle photo showing the overall site or property. Key indicators:
   - Entire house or building visible
   - Property overview/landscape view showing surrounding area
   - Vehicles, driveways, yards visible
   - Wide field of view showing context

5. **other** - Any photo that doesn't fit the above categories (e.g., close-up of wiring, attic access, interior room, etc.)

Respond with ONLY a JSON object (no markdown, no code blocks):
{"category": "CATEGORY_NAME", "confidence": CONFIDENCE_VALUE, "reasoning": "BRIEF_EXPLANATION"}

Where CATEGORY_NAME is one of: main_service_panel, roof_plane, meter, overview, other
And CONFIDENCE_VALUE is a decimal between 0.0 and 1.0`;

// ─────────────────────────────────────────────────────────────────────────────
// Section 3: OpenAI Vision API Call
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimum confidence for auto-applying a Vision classification.
 * Classifications below this threshold require human review.
 */
export const VISION_AUTO_APPLY_MIN_CONFIDENCE = Number(
  process.env.VISION_AUTO_APPLY_MIN_CONFIDENCE || 0.80,
);

/**
 * Classify a single photo using OpenAI Vision.
 *
 * @param imageUrl - URL of the photo to classify
 * @param openaiApiKey - OpenAI API key
 * @returns Classification result
 */
export async function classifyPhotoWithVision(
  imageUrl: string,
  openaiApiKey: string,
): Promise<VisionClassificationResult | null> {
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: CLASSIFICATION_PROMPT },
              { type: 'image_url', image_url: { url: imageUrl, detail: 'low' } },
            ],
          },
        ],
        max_tokens: 200,
        temperature: 0.1, // Low temperature for consistent classification
      }),
      signal: AbortSignal.timeout(30_000), // 30s timeout
    });

    if (!response.ok) {
      console.error(`[classifyPhotoWithVision] API error: ${response.status}`);
      return null;
    }

    const json = await response.json() as Record<string, unknown>;
    const choices = json.choices as Array<{ message: { content: string } }>;
    if (!choices || choices.length === 0) return null;

    const content = choices[0].message.content.trim();

    // Parse the JSON response
    // Handle potential markdown code blocks
    let cleanContent = content;
    if (cleanContent.startsWith('```')) {
      cleanContent = cleanContent.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const parsed = JSON.parse(cleanContent) as {
      category: string;
      confidence: number;
      reasoning: string;
    };

    // Map to our category system
    const category = mapVisionCategoryToEvidenceCategory(parsed.category);

    return {
      fileId: '', // Will be set by caller
      filename: '', // Will be set by caller
      category,
      confidence: parsed.confidence,
      method: 'openai_vision',
      reasoning: parsed.reasoning,
      autoApply: parsed.confidence >= VISION_AUTO_APPLY_MIN_CONFIDENCE && category !== null,
    };
  } catch (err) {
    console.error(`[classifyPhotoWithVision] Error:`, err);
    return null;
  }
}

/**
 * Map a Vision API category string to our evidence category type.
 */
function mapVisionCategoryToEvidenceCategory(
  category: string,
): SurveyEvidenceCategory | null {
  const normalized = category.trim().toLowerCase();

  const mapping: Record<string, SurveyEvidenceCategory> = {
    'main_service_panel': 'main_service_panel',
    'roof_plane': 'roof_plane',
    'meter': 'meter',
    'overview': 'overview',
  };

  return mapping[normalized] || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 4: Batch Classification for Survey
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classify all unclassified photos in a survey using OpenAI Vision.
 *
 * This is called as a fallback after heuristic classification has been applied.
 * Only photos with NULL labels are sent to the Vision API.
 *
 * @param surveyId - The survey to classify
 * @param openaiApiKey - OpenAI API key
 * @returns Batch classification results
 */
export async function classifyUnclassifiedPhotosWithVision(
  surveyId: string,
  openaiApiKey: string,
): Promise<VisionClassificationBatchResult> {
  const { getDbReady } = await import('@/lib/db/core');
  const sql = await getDbReady();

  const results: VisionClassificationResult[] = [];
  const errors: string[] = [];
  let estimatedCost = 0;

  // Step 1: Get all unclassified photos (NULL or empty label)
  const rows = await sql`
    SELECT DISTINCT ON (filename)
      id, filename, file_url
    FROM site_survey_files
    WHERE survey_id = ${surveyId}
      AND (label IS NULL OR label = '')
    ORDER BY filename
  `;

  const unclassifiedPhotos = rows as Array<{
    id: string;
    filename: string;
    file_url: string;
  }>;

  console.log(`[classifyUnclassifiedPhotosWithVision] Found ${unclassifiedPhotos.length} unclassified photos to classify`);

  if (unclassifiedPhotos.length === 0) {
    return {
      totalClassified: 0,
      results: [],
      estimatedCost: 0,
      errors: [],
    };
  }

  // Step 2: Classify each photo
  for (const photo of unclassifiedPhotos) {
    const result = await classifyPhotoWithVision(photo.file_url, openaiApiKey);

    if (result) {
      result.fileId = photo.id;
      result.filename = photo.filename;
      results.push(result);
      estimatedCost += 0.0025; // ~$0.0025 per image

      console.log(`[classifyUnclassifiedPhotosWithVision] ${photo.filename} → ${result.category} (conf=${result.confidence}, auto=${result.autoApply})`);
    } else {
      errors.push(`Failed to classify ${photo.filename}`);
    }

    // Rate limiting: 1 request per second
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Step 3: Auto-apply high-confidence classifications
  const autoApplyResults = results.filter(r => r.autoApply && r.category);

  if (autoApplyResults.length > 0) {
    // Get ALL file_ids for each filename (to update all duplicate rows)
    const updatesForDb: Array<{ fileId: string; label: string }> = [];

    for (const result of autoApplyResults) {
      // Get all file_ids for this filename
      const fileRows = await sql`
        SELECT id
        FROM site_survey_files
        WHERE survey_id = ${surveyId}
          AND filename = ${result.filename}
          AND (label IS NULL OR label = '')
      `;

      for (const row of fileRows as Array<{ id: string }>) {
        updatesForDb.push({
          fileId: row.id,
          label: result.category!,
        });
      }
    }

    if (updatesForDb.length > 0) {
      // Apply updates using the existing function
      const { updateSiteSurveyFileLabels } = await import('@/lib/db/surveys');
      const userId = 'openai_vision_auto'; // System user for auto-labeling
      const updatedFiles = await updateSiteSurveyFileLabels(surveyId, userId, updatesForDb);
      console.log(`[classifyUnclassifiedPhotosWithVision] Auto-applied ${updatedFiles.length} label updates`);
    }
  }

  return {
    totalClassified: results.length,
    results,
    estimatedCost,
    errors,
  };
}
