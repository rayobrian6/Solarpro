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

const FORBIDDEN_SOURCE_IMPORTS = [
  'lib/survey/evidence',
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
  { label: 'image-byte analysis', regex: /getImageData|pixelData|decodeImage|parseImage|file\.arrayBuffer|arrayBuffer\(\)|Buffer\.from\(|readFile\(/i },
  { label: 'perceptual hashing', regex: /perceptual\s*hash|\bpHash\b|\bdHash\b|\baHash\b|\bimageHash\b/i },
  { label: 'semantic scene classification', regex: /scene classification|semantic visual|object detection|roof segmentation|geometry extraction/i },
  { label: 'direct canonical mutation', regex: /buildSurveyEvidenceManifest|evaluateEngineeringRequirements|buildCADReadinessMetadata|buildEngineeringRecommendations|buildEngineeringWorkflowOrchestration|INSERT INTO|UPDATE\s+/i },
  { label: 'canonical mutation enabled', regex: /canonicalMutationAllowed\s*:\s*true/i },
  { label: 'direct database mutation', regex: /\.(?:insert|upsert|delete)\(|(?:supabase|db|client)\.from\([^\n]+\.update\(|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM/i },
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
    for (const forbidden of FORBIDDEN_SOURCE_IMPORTS) {
      if (specifier.includes(forbidden) || specifier.includes(`@/${forbidden}`)) {
        violations.push(`${relative}: forbidden canonical/engineering import '${specifier}'.`);
      }
    }
  }

  lines.forEach((line, index) => {
    for (const pattern of PROHIBITED_RUNTIME_PATTERNS) {
      if (pattern.regex.test(line)) {
        const isAllowedGuardText = /prohibit|forbid|must not|not implement|no |blocked|without/i.test(line)
          && (relative.endsWith('sandboxGuards.ts') || relative.endsWith('candidateAdapterContracts.ts'));
        const isAllowedNegativeTest = relative.endsWith('.test.ts') && /toThrow|expect\(/.test(line);
        if (!isAllowedGuardText && !isAllowedNegativeTest) violations.push(`${relative}:${index + 1}: ${pattern.label}: ${line.trim()}`);
      }
    }
  });

  const isAdapterFile = /FixtureAdapter\.ts$/.test(relative) || /candidateNormalization\.ts$/.test(relative);
  if (isAdapterFile) {
    if (!/createCandidate|createReviewRequiredCandidates/.test(text)) {
      violations.push(`${relative}: adapter foundation must route candidate creation through createCandidate() or the shared createReviewRequiredCandidates() helper.`);
    }
    if (!/markReviewRequired|createReviewRequiredCandidates/.test(text)) {
      violations.push(`${relative}: adapter foundation must mark generated candidates review_required directly or through the shared helper.`);
    }
  }

  if (/generate[A-Za-z0-9]*Candidates\s*\(/.test(text) && !/getRegisteredOpenSourceTool/.test(text) && !relative.endsWith('candidateNormalization.ts') && !relative.endsWith('candidateAdapterTypes.ts')) {
    violations.push(`${relative}: runtime/candidate generation must resolve a registered tool before execution.`);
  }
}

if (violations.length) {
  console.error('Assisted evidence boundary violations found:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log(`Assisted evidence boundary guard passed. Scanned ${walk(ASSISTED_DIR).length} assistedEvidence files, ${walk(ASSISTED_SOURCES_DIR).length} assistedEvidenceSources files, and ${CANONICAL_FORBIDDEN_IMPORT_TARGETS.length} canonical/Engineering Intelligence boundary files.`);
