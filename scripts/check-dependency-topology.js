#!/usr/bin/env node
/*
 * Dependency Topology Guard
 *
 * Enforces the stabilization rule:
 * survey ingestion/history -> canonical evidence -> requirement registry/evaluation
 * -> provenance/traceability -> document provenance/bindings
 * -> engineering decision provenance -> state invalidation/regeneration planning
 * -> render context/document rendering -> UI/routes.
 *
 * Lower-level modules must not import higher-level rendering/UI/route code.
 * Cycles touching protected architecture areas fail the guard.
 *
 * This script intentionally uses only Node built-ins so the topology guard does
 * not introduce another dependency surface. It scans static TS/TSX imports,
 * export-from edges, and simple dynamic import() edges that resolve inside app/
 * or lib/.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCAN_ROOTS = ['app', 'lib'];
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];
const INDEX_EXTENSIONS = EXTENSIONS.map((ext) => path.join('index' + ext));

const PROTECTED_PATTERNS = [
  /^lib\/survey\//,
  /^lib\/engineering\/surveyEvidence\.ts$/,
  /^lib\/engineeringRequirements\//,
  /^lib\/documentProvenance\//,
  /^lib\/engineeringDecisionProvenance\//,
  /^lib\/engineeringStateInvalidation\//,
  /^lib\/drafting\//,
  /^lib\/cad\//,
  /^lib\/renderContext/,
  /^lib\/renderPlanSet/,
  /^lib\/permit\//,
  /^app\/api\/engineering\//,
  /^app\/engineering\/permit\//,
  /^app\/projects\//,
];

const LAYERS = [
  {
    id: 'survey-ingestion-history',
    rank: 10,
    patterns: [/^lib\/survey\/ingest\//, /^lib\/survey\/history\//, /^lib\/db\/surveys\.ts$/],
  },
  {
    id: 'canonical-evidence',
    rank: 20,
    patterns: [/^lib\/survey\/evidence\/manifest\.ts$/, /^lib\/survey\/evidence\/canonical/, /^lib\/survey\/evidence\/sessionTypes\.ts$/],
  },
  {
    id: 'requirement-registry-evaluation',
    rank: 30,
    patterns: [/^lib\/survey\/evidence\/engineeringRequirements\.ts$/, /^lib\/engineeringRequirements\//, /requirementRegistry/i],
  },
  {
    id: 'provenance-traceability',
    rank: 40,
    patterns: [/^lib\/survey\/evidence\/provenance\.ts$/, /traceability/i],
  },
  {
    id: 'document-provenance-bindings',
    rank: 50,
    patterns: [/^lib\/documentProvenance\//, /document.*binding/i],
  },
  {
    id: 'engineering-decision-provenance',
    rank: 60,
    patterns: [/^lib\/engineeringDecisionProvenance\//],
  },
  {
    id: 'state-invalidation-regeneration',
    rank: 70,
    patterns: [/^lib\/engineeringStateInvalidation\//, /regeneration/i, /invalidation/i],
  },
  {
    id: 'render-context-document-rendering',
    rank: 80,
    patterns: [/^lib\/drafting\//, /^lib\/renderContext/, /^lib\/renderPlanSet/, /^lib\/permit\//],
  },
  {
    id: 'ui-routes',
    rank: 90,
    patterns: [/^app\//],
  },
];

function toPosix(filePath) {
  return filePath.split(path.sep).join('/');
}

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (EXTENSIONS.includes(path.extname(entry.name)) && !entry.name.endsWith('.d.ts') && !entry.name.includes('.test.')) files.push(full);
  }
  return files;
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function hasRuntimeNamedSpecifiers(clause) {
  const named = clause.match(/\{([\s\S]*?)\}/);
  if (!named) return true;
  const entries = named[1]
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length === 0) return false;
  return entries.some((entry) => !entry.startsWith('type '));
}

function extractSpecifiers(source) {
  const specifiers = [];
  const text = stripComments(source);

  let match;
  const sideEffectImport = /\bimport\s+['"]([^'"]+)['"]/g;
  while ((match = sideEffectImport.exec(text)) !== null) specifiers.push(match[1]);

  const importFrom = /\bimport\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
  while ((match = importFrom.exec(text)) !== null) {
    const clause = match[1].trim();
    if (clause.startsWith('type ')) continue;
    if (!hasRuntimeNamedSpecifiers(clause)) continue;
    specifiers.push(match[2]);
  }

  const exportFrom = /\bexport\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
  while ((match = exportFrom.exec(text)) !== null) {
    const clause = match[1].trim();
    if (clause.startsWith('type ')) continue;
    if (!hasRuntimeNamedSpecifiers(clause)) continue;
    specifiers.push(match[2]);
  }

  // Deliberately do not treat TypeScript import('module').Type queries as
  // runtime edges. Static imports/export-from and require() calls are the
  // protected topology surface guarded here.

  const requireCall = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = requireCall.exec(text)) !== null) specifiers.push(match[1]);

  return specifiers;
}

function resolveSpecifier(fromFile, specifier, knownFiles) {
  if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return null;
  let base;
  if (specifier.startsWith('@/')) {
    base = path.join(ROOT, specifier.slice(2));
  } else {
    base = path.resolve(path.dirname(fromFile), specifier);
  }

  const candidates = [];
  if (EXTENSIONS.includes(path.extname(base))) candidates.push(base);
  for (const ext of EXTENSIONS) candidates.push(base + ext);
  for (const indexFile of INDEX_EXTENSIONS) candidates.push(path.join(base, indexFile));

  for (const candidate of candidates) {
    const normalized = path.normalize(candidate);
    if (knownFiles.has(normalized)) return normalized;
  }
  return null;
}

function layerOf(relPath) {
  return LAYERS.find((layer) => layer.patterns.some((pattern) => pattern.test(relPath))) || null;
}

function isProtected(relPath) {
  return PROTECTED_PATTERNS.some((pattern) => pattern.test(relPath));
}

function buildGraph(files) {
  const knownFiles = new Set(files.map((file) => path.normalize(file)));
  const graph = new Map();
  for (const file of files) {
    const normalized = path.normalize(file);
    const source = fs.readFileSync(normalized, 'utf8');
    const deps = [];
    for (const specifier of extractSpecifiers(source)) {
      const resolved = resolveSpecifier(normalized, specifier, knownFiles);
      if (resolved) deps.push(resolved);
    }
    graph.set(normalized, [...new Set(deps)]);
  }
  return graph;
}

function findCycles(graph) {
  const cycles = [];
  const stack = [];
  const state = new Map();
  const inStack = new Map();
  const seen = new Set();

  function canonicalize(cycle) {
    const body = cycle.slice(0, -1);
    let best = null;
    for (let i = 0; i < body.length; i++) {
      const rotated = body.slice(i).concat(body.slice(0, i));
      const key = rotated.join('>');
      if (best === null || key < best) best = key;
    }
    return best;
  }

  function visit(node) {
    state.set(node, 'visiting');
    inStack.set(node, stack.length);
    stack.push(node);
    for (const dep of graph.get(node) || []) {
      if (!graph.has(dep)) continue;
      if (state.get(dep) === 'visiting') {
        const start = inStack.get(dep);
        const cycle = stack.slice(start).concat(dep);
        const key = canonicalize(cycle);
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push(cycle);
        }
      } else if (!state.has(dep)) {
        visit(dep);
      }
    }
    stack.pop();
    inStack.delete(node);
    state.set(node, 'visited');
  }

  for (const node of graph.keys()) {
    if (!state.has(node)) visit(node);
  }
  return cycles;
}

function findDirectionalViolations(graph) {
  const violations = [];
  for (const [from, deps] of graph.entries()) {
    const fromRel = toPosix(path.relative(ROOT, from));
    const fromLayer = layerOf(fromRel);
    if (!fromLayer) continue;
    for (const dep of deps) {
      const depRel = toPosix(path.relative(ROOT, dep));
      const depLayer = layerOf(depRel);
      if (!depLayer) continue;
      if (fromLayer.rank < depLayer.rank) {
        violations.push({ from: fromRel, fromLayer: fromLayer.id, to: depRel, toLayer: depLayer.id });
      }
    }
  }
  return violations;
}

function main() {
  const files = SCAN_ROOTS.flatMap((root) => walk(path.join(ROOT, root))).map((file) => path.normalize(file));
  const graph = buildGraph(files);
  const cycles = findCycles(graph);
  const protectedCycles = cycles.filter((cycle) =>
    cycle.some((file) => isProtected(toPosix(path.relative(ROOT, file)))),
  );
  const directionalViolations = findDirectionalViolations(graph);
  const hardDirectionalViolations = directionalViolations.filter((violation) => {
    const isRenderOrUiImport = violation.toLayer === 'render-context-document-rendering' || violation.toLayer === 'ui-routes';
    const isLowerLevelImporter = violation.fromLayer !== 'render-context-document-rendering' && violation.fromLayer !== 'ui-routes';
    return isRenderOrUiImport && isLowerLevelImporter;
  });

  console.log(`Dependency topology guard scanned ${files.length} source files.`);

  if (cycles.length === 0) {
    console.log('Circular dependencies: 0');
  } else {
    console.log(`Circular dependencies: ${cycles.length}`);
    cycles.forEach((cycle, index) => {
      const relCycle = cycle.map((file) => toPosix(path.relative(ROOT, file))).join(' > ');
      const marker = protectedCycles.includes(cycle) ? 'PROTECTED' : 'unprotected';
      console.log(`${index + 1}) [${marker}] ${relCycle}`);
    });
  }

  if (directionalViolations.length === 0) {
    console.log('Directional architecture warnings: 0');
  } else {
    console.log(`Directional architecture warnings: ${directionalViolations.length}`);
    console.log(`Hard directional violations: ${hardDirectionalViolations.length}`);
    directionalViolations.forEach((violation, index) => {
      console.log(
        `${index + 1}) ${violation.from} (${violation.fromLayer}) -> ${violation.to} (${violation.toLayer})`,
      );
    });
  }

  if (protectedCycles.length > 0 || hardDirectionalViolations.length > 0) {
    console.error('Dependency topology guard failed. Protected cycles or hard upward rendering/UI imports were detected.');
    process.exit(1);
  }

  console.log('Dependency topology guard passed.');
}

main();
