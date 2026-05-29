#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const ASSISTED_DIR = path.join(ROOT, 'lib', 'assistedEvidence');
const ASSISTED_SOURCES_DIR = path.join(ROOT, 'lib', 'assistedEvidenceSources');
const CANONICAL_FORBIDDEN_IMPORT_TARGETS = [
  'lib/survey/evidence/manifest.ts',
  'lib/survey/evidence/engineeringRequirements.ts',
  'lib/engineeringIntelligence/signalExtraction.ts',
  'lib/engineeringIntelligence/contextResolution.ts',
  'lib/engineeringIntelligence/cadReadiness.ts',
  'lib/engineeringIntelligence/recommendationEngine.ts',
  'lib/engineeringIntelligence/workflowOrchestration.ts',
];

const APPROVED_METADATA_RUNTIME_IMPORT_FILES = new Set([
  'lib/assistedEvidenceSources/metadataRuntimeAdapter.ts',
]);

const APPROVED_SURVEY_ALIGNMENT_FILES = new Set([
  'lib/assistedEvidenceSources/surveyIngestionRuntimeBridge.ts',
  'lib/assistedEvidenceSources/ocrRuntimeBridge.ts',
]);

const APPROVED_OCR_RUNTIME_IMPORT_FILES = new Set([
  'lib/assistedEvidenceSources/ocrRuntimeAdapter.ts',
]);

const APPROVED_VISUAL_RUNTIME_IMPORT_FILES = new Set([
  'lib/assistedEvidenceSources/visualCategorizationRuntimeAdapter.ts',
]);

const APPROVED_GEOMETRY_RUNTIME_IMPORT_FILES = new Set([
  'lib/assistedEvidenceSources/geometryCandidateRuntimeAdapter.ts',
]);

const APPROVED_GEOMETRY_RUNTIME_FILES = new Set([
  'lib/assistedEvidenceSources/geometryCandidateTypes.ts',
  'lib/assistedEvidenceSources/geometryCandidateRuntimeAdapter.ts',
  'lib/assistedEvidenceSources/geometryCandidateRuntimeBridge.ts',
]);

const APPROVED_GEOMETRY_REVIEW_LIFECYCLE_FILES = new Set([
  'lib/assistedEvidenceSources/geometryCandidateReviewLifecycle.ts',
]);

const APPROVED_PHOTO_VISION_RUNTIME_FILES = new Set([
  'lib/assistedEvidenceSources/externalOpenCvPhotoVisionClient.ts',
  'lib/assistedEvidenceSources/openSourcePhotoVisionWorker.ts',
  'lib/assistedEvidenceSources/roofGeometryExtractor.ts',
  'lib/assistedEvidenceSources/openaiRoofGeometryExtractor.ts',
]);

const APPROVED_PHOTO_VISION_JOB_MANAGER_FILES = new Set([
  'lib/assistedEvidenceSources/asyncPhotoVisionJobManager.ts',
]);

const APPROVED_OBSTRUCTION_CLASSIFICATION_FILES = new Set([
  'lib/assistedEvidenceSources/roofObstructionRegistration.ts',
  'lib/assistedEvidenceSources/yoloToEvidenceMapper.ts',
  'lib/assistedEvidenceSources/openaiVisionClassifier.ts',
]);

const APPROVED_OVERLAY_COORDINATE_FILES = new Set([
  'lib/assistedEvidenceSources/overlayCoordinateConversion.ts',
]);

const APPROVED_GEOMETRY_REFINEMENT_FILES = new Set([
  'lib/assistedEvidenceSources/geometryRefinement.ts',
]);

const APPROVED_CANDIDATE_SUPPRESSION_FILES = new Set([
  'lib/assistedEvidenceSources/candidateSuppression.ts',
]);

const APPROVED_BEFORE_AFTER_EVIDENCE_FILES = new Set([
  'lib/assistedEvidenceSources/beforeAfterEvidence.ts',
]);

const APPROVED_PHOTO_VISION_RUNTIME_IMPORTS = new Set([
  'sharp',
]);

const APPROVED_CORE_HASH_FILES = new Set([
  'lib/assistedEvidence/candidateRegistry.ts',
]);

const APPROVED_METADATA_RUNTIME_IMPORTS = new Set([
  'sharp',
]);

const APPROVED_OCR_RUNTIME_IMPORTS = new Set([
  'tesseract.js',
]);

const FORBIDDEN_OCR_SOURCE_IMPORTS = [
  'app/api/bill-upload',
  'app/api/debug/ocr',
  'app/api/debug/bill',
  'app/api/ocr',
  'lib/billOcr',
  'lib/billOcrEngine',
  'lib/billParser',
  'lib/billPipeline',
  'lib/billClaudeExtractor',
  'lib/intake/utilityBillIntelligence',
];

const FORBIDDEN_GEOMETRY_IMPORTS = [
  'lib/cad',
  'lib/drafting',
  'lib/plan-set',
  'lib/engineering',
  'lib/engineeringIntelligence',
  'lib/system/conduitRouting',
  'lib/bom',
  'lib/topology-engine',
  'lib/roofGeometry',
  'lib/roofPlane3D',
  'lib/planeEngine',
  'lib/panelLayout',
  'lib/panelLayoutOptimized',
  'lib/placementEngine',
  'components/3d',
];

const FORBIDDEN_SOURCE_IMPORTS = [
  'lib/vision',
  'lib/system/visionPatch',
  'lib/survey/evidence',
  'lib/survey/ingest',
  'lib/db/surveys',
  'app/api/survey',
  'lib/engineeringIntelligence/signalExtraction',
  'lib/engineeringIntelligence/contextResolution',
  'lib/engineeringIntelligence/cadReadiness',
  'lib/engineeringIntelligence/recommendationEngine',
  'lib/engineeringIntelligence/workflowOrchestration',
  'lib/engineeringIntelligence/calculation',
  'lib/engineeringIntelligence/regeneration',
];

const PROHIBITED_RUNTIME_PATTERNS = [
  { label: 'tesseract runtime', regex: /tesseract|createWorker\(|recognize\(/i },
  { label: 'opencv runtime', regex: /opencv|cv2|@techstark\/opencv-js/i },
  { label: 'yolo runtime', regex: /\byolo\b|ultralytics/i },
  { label: 'tensorflow runtime', regex: /tensorflow|tfjs/i },
  { label: 'pytorch runtime', regex: /pytorch|(?<!flat_)\btorch\b/i },
  { label: 'onnx runtime', regex: /onnxruntime|\bonnx\b/i },
  { label: 'mediapipe runtime', regex: /mediapipe/i },
  { label: 'detectron segmentation runtime', regex: /detectron|segmentation|segmenter/i },
  { label: 'legacy vision service', regex: /VISION_SERVICE_URL|\/vision\/infer|VisionDetection|VisionInferenceResult|VisionBoundingBox/i },
  { label: 'spatial detection output', regex: /bounding\s*box|bbox|polygon|coordinate|roof\s*edge|setback|conduit\s*path|obstruction\s*map|geometry\s*truth/i },
  { label: 'geometry authority mutation', regex: /generateCADLayout|roofCAD|buildCADFromSurvey|mergeCADModels|adaptCADToDrafting|renderPlanSet|calcFireSetbacks|routeConduit|deriveRunLengths|evaluateEngineeringRequirements|buildCADReadinessMetadata|buildEngineeringRecommendations|buildEngineeringWorkflowOrchestration/i },
  { label: 'geometry measurable payload', regex: /boundingBox\s*[:=]|bbox\s*[:=]|polygon\s*[:=]|coordinates\s*[:=]|polyline\s*[:=]|roofEdge\s*[:=]|ridgeLine\s*[:=]|plane\s*[:=]|azimuth\s*[:=]|tilt\s*[:=]|pitch\s*[:=]|setback\s*[:=]|obstructionMap\s*[:=]|conduitPath\s*[:=]|routeLength\s*[:=]|cadModel\s*[:=]/i },
  { label: 'image-byte analysis', regex: /getImageData|pixelData|decodeImage|parseImage|file\.arrayBuffer|arrayBuffer\(\)|Buffer\.from\(|readFile\(/i },
  { label: 'perceptual hashing', regex: /perceptual\s*hash|\bpHash\b|\bdHash\b|\baHash\b|\bimageHash\b/i },
  { label: 'semantic scene classification', regex: /scene classification|semantic visual|object detection|roof segmentation|geometry extraction/i },
  { label: 'cad engineering recommendation workflow influence', regex: /buildCADReadinessMetadata|CAD\s*readiness|buildEngineeringRecommendations|recommendation\s*influence|buildEngineeringWorkflowOrchestration|workflow\s*influence|evaluateEngineeringRequirements|engineering\s*fact/i },
  { label: 'direct canonical mutation', regex: /buildSurveyEvidenceManifest|evaluateEngineeringRequirements|buildCADReadinessMetadata|buildEngineeringRecommendations|buildEngineeringWorkflowOrchestration|INSERT INTO|UPDATE\s+/i },
  { label: 'canonical mutation enabled', regex: /canonicalMutationAllowed\s*:\s*true/i },
  { label: 'direct database mutation', regex: /\.(?:insert|upsert|delete)\(|(?:supabase|db|client)\.from\([^\n]+\.update\(|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM/i },
  { label: 'survey table mutation', regex: /site_surveys|site_survey_files|project_physical_data/i },
  { label: 'duplicate blur system', regex: /blurScore\s*=|blurScore\s*:|laplacian|variance\s+of\s+laplacian|blur\s*threshold/i },
  { label: 'duplicate metadata system', regex: /widthPx\s*=|heightPx\s*=|EXIF parser|parseExif|readExif/i },
  { label: 'duplicate hashing system', regex: /createHash\(|sha256|checksum|fingerprint/i },
];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name === '.next' ? [] : walk(full);
    return /\.(ts|tsx|js|jsx)$/.test(entry.name) ? [full] : [];
  });
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, '/');
}

function importSpecifiers(text) {
  const matches = [...text.matchAll(/import\s+(?:type\s+)?(?:[^'";]+\s+from\s+)?['"]([^'"]+)['"]/g)];
  return matches.map(match => match[1]);
}

function isInsideNamedConstArray(lines, index, arrayName) {
  let sawArrayStart = false;
  for (let cursor = index; cursor >= 0 && cursor >= index - 80; cursor -= 1) {
    const current = lines[cursor];
    if (new RegExp(`const\\s+${arrayName}\\s*=\\s*\\[`).test(current)) {
      sawArrayStart = true;
      break;
    }
    if (cursor !== index && /^\s*\]\s*(?:as\s+const)?;?/.test(current)) break;
  }
  if (!sawArrayStart) return false;
  for (let cursor = index; cursor < lines.length && cursor <= index + 80; cursor += 1) {
    if (/^\s*\]\s*(?:as\s+const)?;?/.test(lines[cursor])) return true;
  }
  return false;
}

function sourceFiles() {
  return [...walk(ASSISTED_DIR), ...walk(ASSISTED_SOURCES_DIR)];
}

const violations = [];

for (const target of CANONICAL_FORBIDDEN_IMPORT_TARGETS) {
  const full = path.join(ROOT, target);
  if (!fs.existsSync(full)) continue;
  const text = fs.readFileSync(full, 'utf8');
  if (/assistedEvidence|assistedEvidenceSources|assisted-evidence/i.test(text)) {
    violations.push(`${target}: canonical/Engineering Intelligence runtime must not import or consume assisted evidence candidates or source adapters directly.`);
  }
}

for (const file of sourceFiles()) {
  const relative = rel(file);
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);

  for (const specifier of importSpecifiers(text)) {
    if (relative.includes('geometryCandidate')) {
      for (const forbiddenGeometry of FORBIDDEN_GEOMETRY_IMPORTS) {
        if (specifier.includes(forbiddenGeometry) || specifier.includes(`@/${forbiddenGeometry}`)) {
          violations.push(`${relative}: geometry candidate runtime must not import forbidden authority module '${specifier}'.`);
        }
      }
    }
    const isApprovedPhotoVisionFile = APPROVED_PHOTO_VISION_RUNTIME_FILES.has(relative)
      || APPROVED_PHOTO_VISION_JOB_MANAGER_FILES.has(relative)
      || APPROVED_OBSTRUCTION_CLASSIFICATION_FILES.has(relative)
      || (relative.endsWith('.test.ts') && (relative.includes('externalOpenCvPhotoVisionClient') || relative.includes('openSourcePhotoVisionWorker')));
    for (const forbidden of FORBIDDEN_SOURCE_IMPORTS) {
      if (specifier.includes(forbidden) || specifier.includes(`@/${forbidden}`)) {
        if (isApprovedPhotoVisionFile
          && (specifier.includes('lib/db/surveys') || specifier.includes('@/lib/db/surveys')
            || specifier.includes('lib/survey/evidence/categoryRegistry') || specifier.includes('@/lib/survey/evidence/categoryRegistry')
            || specifier.includes('lib/survey/evidence/manifest') || specifier.includes('@/lib/survey/evidence/manifest'))) {
          continue;
        }
        violations.push(`${relative}: forbidden canonical/engineering import '${specifier}'.`);
      }
    }
    if (APPROVED_METADATA_RUNTIME_IMPORTS.has(specifier) && !APPROVED_METADATA_RUNTIME_IMPORT_FILES.has(relative)) {
      if (!(APPROVED_PHOTO_VISION_RUNTIME_IMPORTS.has(specifier) && isApprovedPhotoVisionFile)) {
        violations.push(`${relative}: metadata runtime import '${specifier}' is only allowed in approved source adapter files.`);
      }
    }
    if (APPROVED_OCR_RUNTIME_IMPORTS.has(specifier) && !APPROVED_OCR_RUNTIME_IMPORT_FILES.has(relative)) {
      violations.push(`${relative}: OCR runtime import '${specifier}' is only allowed in the approved OCR runtime adapter.`);
    }
    for (const forbiddenOcr of FORBIDDEN_OCR_SOURCE_IMPORTS) {
      if (specifier.includes(forbiddenOcr) || specifier.includes(`@/${forbiddenOcr}`)) {
        violations.push(`${relative}: forbidden OCR/bill/debug import '${specifier}' inside assisted evidence runtime boundary.`);
      }
    }
  }

  lines.forEach((line, index) => {
    for (const pattern of PROHIBITED_RUNTIME_PATTERNS) {
      if (pattern.regex.test(line)) {
        const isAllowedGuardText = /prohibit|forbid|forbidden|must not|not implement|no |no_|No |blocked|without|cannot|non-authoritative|review-required|: false|return false/i.test(line)
          && (relative.endsWith('sandboxGuards.ts') || relative.endsWith('candidateAdapterContracts.ts') || relative.endsWith('openSourceToolRegistry.ts') || relative.endsWith('visualCategorizationRuntimeTypes.ts') || relative.endsWith('visualCategorizationRuntimeAdapter.ts') || relative.endsWith('geometryCandidateTypes.ts') || relative.endsWith('geometryCandidateRuntimeAdapter.ts') || relative.endsWith('candidateNormalization.ts') || relative.endsWith('ocrRuntimeBridge.ts'));
        const isAllowedNegativeTest = relative.endsWith('.test.ts');
        const isTestFixtureReference = relative.endsWith('.test.ts')
          && ['survey table mutation', 'duplicate blur system', 'duplicate metadata system', 'duplicate hashing system'].includes(pattern.label);
        const isApprovedSurveyAlignmentReference = APPROVED_SURVEY_ALIGNMENT_FILES.has(relative)
          && ['survey table mutation', 'duplicate blur system', 'duplicate metadata system', 'duplicate hashing system'].includes(pattern.label);
        const isApprovedCoreHashing = APPROVED_CORE_HASH_FILES.has(relative)
          && pattern.label === 'duplicate hashing system';
        const isApprovedMetadataAdapterHashing = APPROVED_METADATA_RUNTIME_IMPORT_FILES.has(relative)
          && pattern.label === 'duplicate hashing system';
        const isApprovedOcrRuntime = APPROVED_OCR_RUNTIME_IMPORT_FILES.has(relative)
          && ['tesseract runtime', 'image-byte analysis'].includes(pattern.label);
        const isApprovedOcrMetadataReference = ['lib/assistedEvidenceSources/openSourceToolRegistry.ts', 'lib/assistedEvidenceSources/candidateAdapterTypes.ts'].includes(relative)
          && pattern.label === 'tesseract runtime';
        const isApprovedOcrRuntimeHashing = APPROVED_OCR_RUNTIME_IMPORT_FILES.has(relative)
          && pattern.label === 'duplicate hashing system'
          && /runtimePayloadHash|deterministicHash/.test(line);
        const isApprovedVisualRuntimeHashing = APPROVED_VISUAL_RUNTIME_IMPORT_FILES.has(relative)
          && pattern.label === 'duplicate hashing system'
          && /createHash|sha256|runtimePayloadHash|byteSignature|stableHash/.test(line);
        const isApprovedVisualRuntimeImageBytes = APPROVED_VISUAL_RUNTIME_IMPORT_FILES.has(relative)
          && pattern.label === 'image-byte analysis'
          && /Uint8Array|imageBytes|byteLength/.test(line);
        const isApprovedGeometryRuntimeHashing = APPROVED_GEOMETRY_RUNTIME_IMPORT_FILES.has(relative)
          && pattern.label === 'duplicate hashing system'
          && /createHash|sha256|runtimePayloadHash|sourceImageByteHash|stableHash/.test(line);
        const isApprovedGeometryRuntimeImageBytes = APPROVED_GEOMETRY_RUNTIME_IMPORT_FILES.has(relative)
          && pattern.label === 'image-byte analysis'
          && /Uint8Array|imageBytes|byteLength/.test(line);
        const isApprovedGeometryRuntimeText = APPROVED_GEOMETRY_RUNTIME_FILES.has(relative)
          && ['spatial detection output', 'geometry authority mutation', 'geometry measurable payload', 'detectron segmentation runtime', 'semantic scene classification'].includes(pattern.label)
          && (/forbiddenUses|FORBIDDEN_USES|GEOMETRY_CANDIDATE_LIMITATIONS|no_|not |forbiddenStaleClasses|candidateSummary|registryNotes|must not|no /i.test(line)
            || isInsideNamedConstArray(lines, index, 'FORBIDDEN_USES')
            || isInsideNamedConstArray(lines, index, 'GEOMETRY_CANDIDATE_LIMITATIONS'));
        const isApprovedGeometryReviewLifecycleText = APPROVED_GEOMETRY_REVIEW_LIFECYCLE_FILES.has(relative)
          && ['spatial detection output', 'cad engineering recommendation workflow influence'].includes(pattern.label)
          && (/forbiddenEdges|forbiddenStaleClasses|candidateCanSatisfyRequirement|candidateCanInfluenceCADReadiness|candidateCanInfluenceRecommendations|candidateCanCreateWorkflowItems|projectionAutomaticallyMutatesCanonicalEvidence|must not|not canonical|not CAD|not engineering|No CAD|no canonical|without creating projections|downstream authority|MutationAllowed:\s*false|InfluenceAllowed:\s*false/i.test(line));
        // Photo vision runtime exemptions - the external OpenCV/YOLO/Tesseract client and worker
        // legitimately reference these tools and produce review-only spatial candidates
        const isApprovedPhotoVisionRuntimePattern = APPROVED_PHOTO_VISION_RUNTIME_FILES.has(relative)
          && ['opencv runtime', 'yolo runtime', 'tesseract runtime', 'semantic scene classification',
            'spatial detection output', 'geometry measurable payload', 'image-byte analysis', 'duplicate hashing system',
            'direct canonical mutation', 'direct database mutation',
            'cad engineering recommendation workflow influence'].includes(pattern.label);
        // Photo vision job manager exemptions - manages async jobs and photo label updates
        // using review-only bounded operations
        const isApprovedPhotoVisionJobManagerPattern = APPROVED_PHOTO_VISION_JOB_MANAGER_FILES.has(relative)
          && ['opencv runtime', 'yolo runtime', 'tesseract runtime', 'semantic scene classification',
            'spatial detection output', 'duplicate hashing system',
            'direct canonical mutation', 'direct database mutation', 'survey table mutation'].includes(pattern.label);
        // Obstruction classification exemptions - roof obstruction registration, YOLO-to-evidence
        // mapping, and OpenAI vision classification legitimately reference vision tool names,
        // spatial coordinates, and survey table operations for review-only candidate storage
        const isApprovedObstructionClassificationPattern = APPROVED_OBSTRUCTION_CLASSIFICATION_FILES.has(relative)
          && ['opencv runtime', 'yolo runtime', 'tesseract runtime', 'semantic scene classification',
            'spatial detection output', 'geometry measurable payload', 'geometry authority mutation',
            'duplicate hashing system', 'direct canonical mutation', 'direct database mutation',
            'survey table mutation', 'cad engineering recommendation workflow influence'].includes(pattern.label);
        // Overlay coordinate conversion exemptions - shared utility for converting
        // normalized coordinates to SVG/pixel coordinates for rendering
        const isApprovedOverlayCoordinatePattern = APPROVED_OVERLAY_COORDINATE_FILES.has(relative)
          && ['opencv runtime', 'yolo runtime', 'tesseract runtime', 'semantic scene classification',
            'spatial detection output', 'geometry measurable payload',
            'duplicate hashing system'].includes(pattern.label);
        // Geometry refinement exemptions - refines candidates using coordinate systems,
        // bounding boxes, and scene classification labels
        const isApprovedGeometryRefinementPattern = APPROVED_GEOMETRY_REFINEMENT_FILES.has(relative)
          && ['opencv runtime', 'yolo runtime', 'tesseract runtime', 'semantic scene classification',
            'spatial detection output', 'geometry measurable payload',
            'duplicate hashing system'].includes(pattern.label);
        // Candidate suppression exemptions - uses classification thresholds and
        // normalized regions for the 5-stage suppression pipeline
        const isApprovedCandidateSuppressionPattern = APPROVED_CANDIDATE_SUPPRESSION_FILES.has(relative)
          && ['spatial detection output', 'geometry measurable payload',
            'duplicate hashing system'].includes(pattern.label);
        // Before/after evidence exemptions - uses coordinate systems and classification
        // for matching before/after photo evidence
        const isApprovedBeforeAfterEvidencePattern = APPROVED_BEFORE_AFTER_EVIDENCE_FILES.has(relative)
          && ['spatial detection output', 'geometry measurable payload',
            'duplicate hashing system'].includes(pattern.label);
        if (!isAllowedGuardText && !isAllowedNegativeTest && !isTestFixtureReference && !isApprovedSurveyAlignmentReference && !isApprovedCoreHashing && !isApprovedMetadataAdapterHashing && !isApprovedOcrRuntime && !isApprovedOcrRuntimeHashing && !isApprovedVisualRuntimeHashing && !isApprovedVisualRuntimeImageBytes && !isApprovedOcrMetadataReference && !isApprovedGeometryRuntimeHashing && !isApprovedGeometryRuntimeImageBytes && !isApprovedGeometryRuntimeText && !isApprovedGeometryReviewLifecycleText && !isApprovedPhotoVisionRuntimePattern && !isApprovedPhotoVisionJobManagerPattern && !isApprovedObstructionClassificationPattern && !isApprovedOverlayCoordinatePattern && !isApprovedGeometryRefinementPattern && !isApprovedCandidateSuppressionPattern && !isApprovedBeforeAfterEvidencePattern) violations.push(`${relative}:${index + 1}: ${pattern.label}: ${line.trim()}`);
      }
    }
  });

  const isAdapterFile = /FixtureAdapter\.ts$/.test(relative) || /RuntimeAdapter\.ts$/.test(relative) || /candidateNormalization\.ts$/.test(relative);
  if (isAdapterFile) {
    if (!/createCandidate|createReviewRequiredCandidates/.test(text)) {
      violations.push(`${relative}: adapter foundation must route candidate creation through createCandidate() or the shared createReviewRequiredCandidates() helper.`);
    }
    if (!/markReviewRequired|createReviewRequiredCandidates/.test(text)) {
      violations.push(`${relative}: adapter foundation must mark generated candidates review_required directly or through the shared helper.`);
    }
  }

  const usesCandidateGeneration = /generate[A-Za-z0-9]*Candidates\s*\(/.test(text);
  const delegatesToRegisteredRuntime = APPROVED_SURVEY_ALIGNMENT_FILES.has(relative)
    && /generate(?:Metadata|Ocr)RuntimeCandidates\s*\(/.test(text)
    && !/getRegisteredOpenSourceTool/.test(text);
  const isCandidateGenerationTest = relative.endsWith('.test.ts');
  if (usesCandidateGeneration && !isCandidateGenerationTest && !/getRegisteredOpenSourceTool/.test(text) && !delegatesToRegisteredRuntime && !relative.endsWith('RuntimeAdapter.ts') && !relative.endsWith('candidateNormalization.ts') && !relative.endsWith('candidateAdapterTypes.ts')) {
    violations.push(`${relative}: runtime/candidate generation must resolve a registered tool before execution or delegate to an approved registered runtime bridge.`);
  }

  if (relative.includes('ocrRuntime') && /panelRating\s*[:=]|breakerSize\s*[:=]|serviceSize\s*[:=]|project_physical_data|buildCADReadinessMetadata|buildEngineeringRecommendations|buildEngineeringWorkflowOrchestration|evaluateEngineeringRequirements/.test(text)) {
    violations.push(`${relative}: OCR runtime must not convert text into engineering facts or downstream engineering authority.`);
  }

  if (relative.includes('ocrRuntime') && /confidence\s*[:=]\s*(?:0\.[89]|1(?:\.0+)?|8[5-9]|9\d|100)/.test(text) && !relative.endsWith('.test.ts')) {
    violations.push(`${relative}: OCR runtime must not silently upgrade OCR confidence with hard-coded high confidence values.`);
  }

  if (relative.includes('visualCategorizationRuntime') && !relative.endsWith('.test.ts')) {
    const activeVisualMutationPattern = /from ['"][^'"]*(?:survey|engineeringIntelligence|cadReadiness|recommendationEngine|workflowOrchestration|project_physical_data)|\b(?:db|sql|supabase|client)\s*\.\s*(?:insert|upsert|update|delete)\s*\(|buildSurveyEvidenceManifest\s*\(|buildCADReadinessMetadata\s*\(|buildEngineeringRecommendations\s*\(|buildEngineeringWorkflowOrchestration\s*\(|evaluateEngineeringRequirements\s*\(/i;
    if (activeVisualMutationPattern.test(text)) {
      violations.push(`${relative}: visual categorization runtime must not mutate canonical evidence or influence engineering/CAD/recommendation/workflow systems.`);
    }
  }

  if (relative.includes('visualCategorizationRuntime') && !relative.endsWith('.test.ts')) {
    const activeSpatialOutputPattern = /\b(?:boundingBox|bbox|polygon|coordinates|roofEdge|setback|conduitPath|obstructionMap)\s*[:=]/;
    if (activeSpatialOutputPattern.test(text)) {
      violations.push(`${relative}: visual categorization runtime must not emit spatial, geometric, or object-detection outputs.`);
    }
  }

  if (relative.includes('geometryCandidate') && !relative.endsWith('.test.ts')) {
    const mustUseLifecycle = relative.endsWith('RuntimeAdapter.ts');
    if (mustUseLifecycle && !/createReviewRequiredCandidates/.test(text)) {
      violations.push(`${relative}: geometry candidate runtime must route candidate creation through createReviewRequiredCandidates().`);
    }
    if (/\bcreateCandidate\s*\(/.test(text) && !/createReviewRequiredCandidates/.test(text)) {
      violations.push(`${relative}: geometry candidate runtime must not bypass createReviewRequiredCandidates()/createCandidate lifecycle.`);
    }
    if (/\bmarkReviewRequired\s*\(/.test(text) && !/createReviewRequiredCandidates/.test(text)) {
      violations.push(`${relative}: geometry candidate runtime must not bypass createReviewRequiredCandidates()/markReviewRequired lifecycle.`);
    }
    const forbiddenActiveGeometryPayload = /\b(?:boundingBox|bbox|polygon|coordinates|polyline|roofEdge|ridgeLine|valleyLine|plane|azimuth|tilt|pitch|setback|obstructionMap|conduitPath|routeLength|attachmentSpacing|rafter|truss|cadModel)\s*[:=]/i;
    if (forbiddenActiveGeometryPayload.test(text)) {
      violations.push(`${relative}: geometry candidate runtime must not emit measurable geometry, CAD, layout, setback, route, or structural payload fields.`);
    }
    const activeAuthorityMutationPattern = /\b(?:generateCADLayout|roofCAD|buildCADFromSurvey|mergeCADModels|adaptCADToDrafting|renderPlanSet|calcFireSetbacks|routeConduit|deriveRunLengths|evaluateEngineeringRequirements|buildCADReadinessMetadata|buildEngineeringRecommendations|buildEngineeringWorkflowOrchestration)\s*\(/i;
    if (activeAuthorityMutationPattern.test(text)) {
      violations.push(`${relative}: geometry candidate runtime must not call CAD, layout, roof-plane, setback, routing, NEC, engineering, workflow, recommendation, BOM, or plan-set authority.`);
    }
  }
}

if (violations.length) {
  console.error('Assisted evidence boundary violations found:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log(`Assisted evidence boundary guard passed. Scanned ${walk(ASSISTED_DIR).length} assistedEvidence files, ${walk(ASSISTED_SOURCES_DIR).length} assistedEvidenceSources files, and ${CANONICAL_FORBIDDEN_IMPORT_TARGETS.length} canonical/Engineering Intelligence boundary files.`);
