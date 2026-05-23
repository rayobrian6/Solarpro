#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();

/**
 * Engineering Intelligence V1 truth-boundary scan.
 *
 * This scan intentionally targets Engineering Intelligence and adjacent canonical
 * engineering-state/provenance code. The repository has pre-existing utility
 * bill OCR/image-processing features; those are outside this directive and must
 * not weaken the Engineering Intelligence boundary. Any prohibited runtime use
 * inside the scoped Engineering Intelligence paths fails this check.
 */
const SCAN_TARGETS = [
  'app/admin/engineering-intelligence',
  'lib/engineeringIntelligence',
  'lib/engineeringStateInvalidation',
  'lib/documentProvenance',
  'lib/engineeringDecisionProvenance',
  'lib/survey/evidence',
  'lib/survey/ingest',
  'tests',
];

const ALLOWED_PATH_PATTERNS = [
  /outputs\//,
  /node_modules\//,
  /\.next\//,
  /coverage\//,
  /summarized_conversations\//,
  /check-engineering-boundaries\.js$/,
  /bill-upload\.test\.ts$/,
];

const ALLOWED_LINE_PATTERNS = [
  /prohibitedRuntimeBehavior/i,
  /future capability/i,
  /supportsOCR|supportsCVClassification|supportsCADInference|supportsSemanticExtraction/,
  /No OCR|no OCR|OCR\/CV|OpenCV|YOLO|TensorFlow|PyTorch|image-byte|semantic inference|hallucinated geometry|autonomous regeneration/i,
  /prohibited-boundary|boundary scan|truth boundary/i,
  /must not|does not|not used|disabled|prohibited|never/i,
  /no autonomous CAD generation/i,
  /no semantic scene classifier/i,
  /no object detection/i,
  /flat_torch|Flat Torch-Down/,
  /describe\(|it\(|expect\(/,
];

const BANNED_PATTERNS = [
  { code: 'ocr_runtime', pattern: /\b(tesseract|ocrad|easyocr|paddleocr|OCRWorker)\b/i },
  { code: 'opencv_runtime', pattern: /\b(opencv|cv2|OpenCV|@techstark\/opencv-js)\b/i },
  { code: 'yolo_runtime', pattern: /\b(yolo|ultralytics)\b/i },
  { code: 'ml_runtime', pattern: /\b(tensorflow|tfjs|pytorch|onnxruntime|keras)\b|(?<!flat_)\btorch\b/i },
  { code: 'image_byte_analysis', pattern: /\b(getImageData|pixelData|imageBytes|parseImage|decodeImage|sharp\(|jimp\(|exiftool)\b/i },
  { code: 'scene_classification', pattern: /\b(scene classification|classifyScene|semantic scene|object detection)\b/i },
  { code: 'autonomous_cad_generation', pattern: /\b(generateCAD|autonomous CAD|autoGenerateLayout|hallucinated geometry|inferGeometry)\b/i },
];

const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

function walk(target, files = []) {
  if (!fs.existsSync(target)) return files;
  const stat = fs.statSync(target);
  const rel = path.relative(ROOT, target).replace(/\\/g, '/');
  if (ALLOWED_PATH_PATTERNS.some(pattern => pattern.test(rel))) return files;

  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
      walk(path.join(target, entry.name), files);
    }
    return files;
  }

  if (stat.isFile() && EXTENSIONS.has(path.extname(target))) files.push(target);
  return files;
}

const matches = [];
const scannedFiles = new Set();
for (const scanTarget of SCAN_TARGETS) {
  for (const file of walk(path.join(ROOT, scanTarget))) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    if (scannedFiles.has(rel)) continue;
    scannedFiles.add(rel);
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      if (ALLOWED_LINE_PATTERNS.some(pattern => pattern.test(line))) return;
      for (const banned of BANNED_PATTERNS) {
        if (banned.pattern.test(line)) matches.push({ file: rel, line: index + 1, code: banned.code, text: line.trim() });
      }
    });
  }
}

if (matches.length) {
  console.error('Engineering Intelligence boundary scan failed. Prohibited runtime pattern(s) found inside scoped Engineering Intelligence paths:');
  for (const match of matches) console.error(`${match.file}:${match.line} ${match.code} ${match.text}`);
  console.error(`Scanned ${scannedFiles.size} scoped file(s).`);
  process.exit(1);
}

console.log(`Engineering Intelligence boundary scan passed: no prohibited OCR/CV/ML/image-byte/CAD-autogeneration runtime patterns found in ${scannedFiles.size} scoped file(s).`);
