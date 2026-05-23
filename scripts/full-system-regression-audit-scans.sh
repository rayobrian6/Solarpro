#!/usr/bin/env bash
set -u
OUT_DIR="outputs/real-survey-data-validation"
mkdir -p "$OUT_DIR"
SCOPE=(
  app/api/admin/survey-reassign
  app/api/admin/survey-webhook-log
  app/api/debug/backfill-site-surveys
  app/api/engineering
  app/api/site-surveys
  app/api/survey
  app/api/webhooks/survey-complete
  app/engineering/permit
  app/projects
  lib/db/surveys.ts
  lib/documentProvenance
  lib/drafting
  lib/engineering/surveyEvidence.ts
  lib/engineering/surveyEvidence.test.ts
  lib/engineeringDecisionProvenance
  lib/engineeringStateInvalidation
  lib/permit
  lib/siteSurvey/permitIntegration.ts
  lib/survey
)
run_scan() {
  local name="$1"
  local pattern="$2"
  local flags="${3:--RInE}"
  local log="$OUT_DIR/full-system-regression-audit-${name}.log"
  printf '# Scan: %s\n# Pattern: %s\n\n' "$name" "$pattern" > "$log"
  grep $flags --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' --include='*.md' "$pattern" "${SCOPE[@]}" >> "$log" 2>/dev/null || true
  printf '%s\n' "$?" > "$OUT_DIR/full-system-regression-audit-${name}.exit"
}
run_scan prohibited-boundary 'OCR|YOLO|computer vision|image-byte|image byte|semantic inference|autonomous regeneration|CAD generation|AI-generated|OpenAI|Anthropic|generate.*CAD|inspect.*image|vision'
run_scan todo-fixme-hack 'TODO|FIXME|HACK|temporary|temporarily|bypass|skip.*guard|disable.*guard|eslint-disable|ts-ignore|ts-expect-error'
run_scan raw-count-usage 'rawPhotoCount|rawEvidenceCount|fileCount|photos\.length|files\.length|photoCount|uploadCount|raw.*count'
run_scan evidence-manifest-direct 'evidenceManifest|canonicalManifest|evidenceHygiene'
run_scan provenance-guards 'DocumentProvenanceBundle|documentProvenance|assert.*Provenance|auditGuards|provenance.*guard|RequirementDocumentBinding|decisionProvenance'
run_scan decision-state-lineage 'dependencyNodeIds|derivedFrom|dependencyGraph|EngineeringDependencyGraph|stateDependencyHash|stateGenerationHash|SelectiveRegeneration|regeneration|lineage|staleStateMetadata'
run_scan imports-exports-types '^import |^export |interface .*\{|type .*='
# Additional exact unsafe optional-chain pattern family discovered during regression triage.
run_scan unsafe-field-evidence 'surveyEvidence\?\.fieldEvidence\.'
# Summaries
for f in "$OUT_DIR"/full-system-regression-audit-*.log; do
  printf '%s %s\n' "$(basename "$f")" "$(grep -vc '^#\|^$' "$f" || true)"
done > "$OUT_DIR/full-system-regression-audit-scan-summary.log"
cat "$OUT_DIR/full-system-regression-audit-scan-summary.log"
