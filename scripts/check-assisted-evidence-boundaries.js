#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const ASSISTED_DIR = path.join(ROOT, 'lib', 'assistedEvidence');
const CANONICAL_FORBIDDEN_IMPORT_TARGETS = [
  'lib/survey/evidence/manifest.ts',
  'lib/survey/evidence/engineeringRequirements.ts',
  'lib/engineeringIntelligence/signalExtraction.ts',
  'lib/engineeringIntelligence/contextResolution.ts',
  'lib/engineeringIntelligence/cadReadiness.ts',
  'lib/engineeringIntelligence/recommendationEngine.ts',
  'lib/engineeringIntelligence/workflowOrchestration.ts',
];

const PROHIBITED_ASSISTED_PATTERNS = [
  { label: 'tesseract runtime', regex: /tesseract|createWorker\(|recognize\(/i },
  { label: 'opencv runtime', regex: /opencv|cv2|@techstark\/opencv-js/i },
  { label: 'yolo runtime', regex: /\byolo\b|ultralytics/i },
  { label: 'tensorflow runtime', regex: /tensorflow|tfjs/i },
  { label: 'pytorch runtime', regex: /pytorch|(?<!flat_)\btorch\b/i },
  { label: 'onnx runtime', regex: /onnxruntime|\bonnx\b/i },
  { label: 'mediapipe runtime', regex: /mediapipe/i },
  { label: 'image-byte analysis', regex: /getImageData|pixelData|imageBytes|decodeImage|parseImage|file\.arrayBuffer|arrayBuffer\(\)|Buffer\.from\(|readFile\(/i },
  { label: 'perceptual hashing', regex: /perceptual\s*hash|\bpHash\b|\bdHash\b|\baHash\b|\bimageHash\b/i },
  { label: 'semantic scene classification', regex: /scene classification|semantic visual|object detection|roof segmentation|geometry extraction/i },
  { label: 'direct canonical mutation', regex: /buildSurveyEvidenceManifest|evaluateEngineeringRequirements|buildCADReadinessMetadata|buildEngineeringRecommendations|buildEngineeringWorkflowOrchestration|INSERT INTO|UPDATE\s+/i },
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

const violations = [];

for (const target of CANONICAL_FORBIDDEN_IMPORT_TARGETS) {
  const full = path.join(ROOT, target);
  if (!fs.existsSync(full)) continue;
  const text = fs.readFileSync(full, 'utf8');
  if (/assistedEvidence|assisted-evidence/i.test(text)) {
    violations.push(`${target}: canonical/Engineering Intelligence runtime must not import or consume assistedEvidence candidates directly.`);
  }
}

for (const file of walk(ASSISTED_DIR)) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const pattern of PROHIBITED_ASSISTED_PATTERNS) {
      if (pattern.regex.test(line)) {
        const allowComment = /prohibit|forbid|must not|not implement|no /i.test(line) && rel(file).endsWith('sandboxGuards.ts');
        if (!allowComment) violations.push(`${rel(file)}:${index + 1}: ${pattern.label}: ${line.trim()}`);
      }
    }
  });
}

if (violations.length) {
  console.error('Assisted evidence boundary violations found:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log(`Assisted evidence boundary guard passed. Scanned ${walk(ASSISTED_DIR).length} assistedEvidence files and ${CANONICAL_FORBIDDEN_IMPORT_TARGETS.length} canonical/Engineering Intelligence boundary files.`);
