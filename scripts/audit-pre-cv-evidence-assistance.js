#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'outputs', 'real-survey-data-validation');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'pre-cv-open-source-evidence-assistance-audit-v1-scan.json');

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.css', '.sql', '.sh'
]);

const SKIP_DIRS = new Set(['.git', '.next', 'node_modules', 'coverage', 'summarized_conversations']);

const TOKENS = [
  { token: 'tesseract', regex: /\btesseract(?:\.js)?\b|createWorker\(|recognize\(/i, severity: 'ocr_runtime_reference' },
  { token: 'ocr', regex: /\bOCR\b|\bocr\b|pdftotext|pdf-parse/i, severity: 'ocr_or_text_extraction_reference' },
  { token: 'pdf_parse', regex: /pdf-parse|pdftotext|pdfjs-dist/i, severity: 'pdf_text_extraction_reference' },
  { token: 'cloud_vision', regex: /OpenAI Vision|openai-vision|Google Vision|google-vision|GOOGLE_VISION|image_url|images:annotate/i, severity: 'cloud_vision_reference' },
  { token: 'claude_vision', regex: /Claude.*vision|claude-image|billClaudeExtractor|ANTHROPIC_API_KEY|anthropic\.com\/v1\/messages/i, severity: 'llm_vision_reference' },
  { token: 'sharp', regex: /\bsharp\b|sharp\(/i, severity: 'image_processing_reference' },
  { token: 'exif', regex: /\bexif\b|exif-reader/i, severity: 'image_metadata_reference' },
  { token: 'opencv', regex: /\bopencv\b|\bcv2\b|@techstark\/opencv-js/i, severity: 'prohibited_cv_reference' },
  { token: 'yolo', regex: /\byolo\b|ultralytics/i, severity: 'prohibited_detection_reference' },
  { token: 'tensorflow', regex: /tensorflow|tfjs/i, severity: 'prohibited_ml_reference' },
  { token: 'pytorch', regex: /pytorch|(?<!flat_)\btorch\b/i, severity: 'prohibited_ml_reference' },
  { token: 'onnx', regex: /onnxruntime|\bonnx\b/i, severity: 'prohibited_ml_reference' },
  { token: 'mediapipe', regex: /mediapipe/i, severity: 'prohibited_ml_reference' },
  { token: 'image_byte', regex: /getImageData|pixelData|imageBytes|decodeImage|parseImage|arrayBuffer\(\)|Buffer\.from\(|readFile\(|file\.arrayBuffer/i, severity: 'image_byte_or_file_buffer_reference' },
  { token: 'perceptual_hash', regex: /perceptual.*hash|pHash|dHash|aHash|imageHash/i, severity: 'perceptual_hash_reference' },
  { token: 'upload_transform', regex: /upload|multipart|FormData|file_type|content_type|mime|image\//i, severity: 'upload_or_file_handling_reference' },
  { token: 'canonical_mutation', regex: /canonical|manifest|requirement|satisfied|context|signal|promote|mutation|INSERT INTO|UPDATE\s+/i, severity: 'evidence_truth_or_mutation_reference' },
];

const TARGET_PATHS = [
  'app/api',
  'app/admin',
  'app/engineering',
  'app/projects',
  'app/survey',
  'app/portal',
  'components',
  'lib/engineeringIntelligence',
  'lib/survey',
  'lib/intake',
  'lib/files',
  'lib/permit',
  'lib/drafting',
  'lib/cad',
  'scripts',
  'tests',
  'package.json',
  'package-lock.json',
];

function toRel(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

function walk(target, out = []) {
  const full = path.join(ROOT, target);
  if (!fs.existsSync(full)) return out;
  const stat = fs.statSync(full);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
      if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(target, entry.name), out);
    }
    return out;
  }
  if (stat.isFile() && TEXT_EXTENSIONS.has(path.extname(full))) out.push(full);
  return out;
}

function classifyPath(rel) {
  if (/\.test\.|\/tests?\//.test(rel) || rel.startsWith('tests/')) return 'test-only';
  if (rel === 'package.json' || rel === 'package-lock.json') return 'dependency-only';
  if (/^app\/api\/debug\//.test(rel)) return 'reachable-debug-route';
  if (/^app\/api\/ocr\//.test(rel) || /^app\/api\/bill-upload\//.test(rel) || /^app\/api\/portal\/bill-upload\//.test(rel)) return 'active-production-path';
  if (/^app\/api\/survey\/upload-photo\//.test(rel) || /^app\/api\/project-files\//.test(rel) || /^app\/api\/site-surveys\//.test(rel)) return 'active-production-path';
  if (/^lib\/intake\//.test(rel)) return 'active-production-path';
  if (/^lib\/survey\//.test(rel) || /^lib\/engineeringIntelligence\//.test(rel)) return 'engineering-evidence-boundary';
  if (/^scripts\//.test(rel)) return 'audit-or-maintenance-script';
  return 'reachable-or-ui-adjacent';
}

function lineCategory(line) {
  if (/from ['"]tesseract\.js|require\(['"]tesseract\.js|createWorker\(|recognize\(/i.test(line)) return 'direct_tesseract_runtime';
  if (/from ['"]sharp|require\(['"]sharp|sharp\(/i.test(line)) return 'direct_sharp_runtime';
  if (/from ['"]exif-reader|require\(['"]exif-reader/i.test(line)) return 'direct_exif_runtime';
  if (/opencv|cv2|yolo|tensorflow|pytorch|onnx|mediapipe/i.test(line)) return 'prohibited_keyword_reference';
  if (/pdftotext|pdf-parse|OpenAI Vision|image_url|Extract ALL text/i.test(line)) return 'ocr_text_extraction_runtime';
  if (/arrayBuffer\(\)|Buffer\.from\(|readFile\(|writeFile\(/i.test(line)) return 'file_buffer_or_storage_runtime';
  if (/canonical|manifest|requirement|satisfied|promote|context|signal/i.test(line)) return 'truth_boundary_reference';
  return 'general_reference';
}

const files = [...new Set(TARGET_PATHS.flatMap((target) => walk(target)))].sort();
const findings = [];
const fileSummaries = new Map();

for (const file of files) {
  const rel = toRel(file);
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  for (const [idx, line] of lines.entries()) {
    for (const token of TOKENS) {
      if (!token.regex.test(line)) continue;
      findings.push({
        file: rel,
        line: idx + 1,
        token: token.token,
        severity: token.severity,
        pathClassification: classifyPath(rel),
        lineCategory: lineCategory(line),
        text: line.trim().slice(0, 500),
      });
    }
  }
}

for (const finding of findings) {
  const existing = fileSummaries.get(finding.file) ?? {
    file: finding.file,
    pathClassification: finding.pathClassification,
    tokens: {},
    lineCategories: {},
    count: 0,
  };
  existing.tokens[finding.token] = (existing.tokens[finding.token] ?? 0) + 1;
  existing.lineCategories[finding.lineCategory] = (existing.lineCategories[finding.lineCategory] ?? 0) + 1;
  existing.count += 1;
  fileSummaries.set(finding.file, existing);
}

const directRuntimeFindings = findings.filter((finding) =>
  ['direct_tesseract_runtime', 'direct_sharp_runtime', 'direct_exif_runtime', 'ocr_text_extraction_runtime'].includes(finding.lineCategory)
);

const engineeringBoundaryFindings = findings.filter((finding) =>
  finding.pathClassification === 'engineering-evidence-boundary' &&
  ['direct_tesseract_runtime', 'direct_sharp_runtime', 'direct_exif_runtime', 'ocr_text_extraction_runtime', 'prohibited_keyword_reference'].includes(finding.lineCategory) &&
  !/prohibited|No OCR|no OCR|not run|future-only|must not|does not/i.test(finding.text)
);

const output = {
  modelVersion: 'pre_cv_open_source_evidence_assistance_audit_scan_v1',
  generatedAt: new Date().toISOString(),
  scannedTargets: TARGET_PATHS,
  scannedFileCount: files.length,
  findingCount: findings.length,
  fileSummaryCount: fileSummaries.size,
  directRuntimeFindingCount: directRuntimeFindings.length,
  engineeringBoundaryRuntimeRiskCount: engineeringBoundaryFindings.length,
  packageDependencies: (() => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    return Object.fromEntries(Object.entries(deps).filter(([name]) => /tesseract|sharp|exif|pdf-parse|pdfjs|opencv|yolo|tensorflow|torch|onnx|mediapipe/i.test(name)));
  })(),
  classifications: Array.from(fileSummaries.values()).sort((a, b) => b.count - a.count || a.file.localeCompare(b.file)),
  directRuntimeFindings,
  engineeringBoundaryFindings,
  findings,
};

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2) + '\n');

console.log(`Pre-CV audit scan wrote ${path.relative(ROOT, OUTPUT_FILE)}`);
console.log(`scannedFileCount=${output.scannedFileCount}`);
console.log(`findingCount=${output.findingCount}`);
console.log(`directRuntimeFindingCount=${output.directRuntimeFindingCount}`);
console.log(`engineeringBoundaryRuntimeRiskCount=${output.engineeringBoundaryRuntimeRiskCount}`);
console.log(`packageDependencies=${JSON.stringify(output.packageDependencies)}`);
