#!/usr/bin/env python3
"""
Phase 4.12 — Harden lib/microStage.ts:
  1. Add idempotency check (SELECT 1 before INSERT)
  2. Add WARN log on duplicate attempt
  3. Improve WARN log on backward stage attempt
"""

import sys

fpath = "lib/microStage.ts"

with open(fpath, "r", encoding="utf-8") as f:
    src = f.read()

# ---------------------------------------------------------------------------
# Target: _doWriteMicroStage — replace the INSERT block with idempotency check
# ---------------------------------------------------------------------------

old_do_write = """async function _doWriteMicroStage(
  projectId: string,
  stage: MicroStage,
  createdBy: string | null,
  metadata: Record<string, unknown> | null,
): Promise<void> {
  const sql = await getDbReady();

  // 1. Insert micro stage
  const metaJson = metadata ? JSON.stringify(metadata) : null;
  await sql`
    INSERT INTO project_micro_stages
      (project_id, micro_stage, created_by, metadata)
    VALUES
      (${projectId}, ${stage}, ${createdBy}, ${metaJson}::jsonb)
  `;

  // 2. Resolve target homeowner_stage
  const targetHomeownerStage = MICRO_TO_HOMEOWNER[stage];
  if (!targetHomeownerStage) return;

  // 3. Read current homeowner_stage
  const rows = await sql`
    SELECT homeowner_stage FROM projects WHERE id = ${projectId} LIMIT 1
  `;
  if (rows.length === 0) return;

  const currentStage = rows[0].homeowner_stage as HomeownerStage | null;
  const currentIdx   = currentStage ? HOMEOWNER_STAGES.indexOf(currentStage) : -1;
  const targetIdx    = HOMEOWNER_STAGES.indexOf(targetHomeownerStage);

  // 4. Forward-only update
  if (targetIdx <= currentIdx) {
    if (process.env.NODE_ENV === 'development') {
      console.debug(
        `[writeMicroStage] Skip homeowner sync: project=${projectId} ` +
        `current=${currentStage} >= target=${targetHomeownerStage}`,
      );
    }
    return;
  }"""

new_do_write = """async function _doWriteMicroStage(
  projectId: string,
  stage: MicroStage,
  createdBy: string | null,
  metadata: Record<string, unknown> | null,
): Promise<void> {
  const sql = await getDbReady();

  // 1. Idempotency check — never write the same micro_stage twice per project
  const existing = await sql`
    SELECT 1 FROM project_micro_stages
    WHERE project_id = ${projectId}
      AND micro_stage = ${stage}
    LIMIT 1
  `;
  if (existing.length > 0) {
    console.warn(
      `[writeMicroStage] WARN: duplicate stage skipped ` +
      `project=${projectId} stage=${stage}`,
    );
    return;
  }

  // 2. Insert micro stage
  const metaJson = metadata ? JSON.stringify(metadata) : null;
  await sql`
    INSERT INTO project_micro_stages
      (project_id, micro_stage, created_by, metadata)
    VALUES
      (${projectId}, ${stage}, ${createdBy}, ${metaJson}::jsonb)
  `;

  // 3. Resolve target homeowner_stage
  const targetHomeownerStage = MICRO_TO_HOMEOWNER[stage];
  if (!targetHomeownerStage) return;

  // 4. Read current homeowner_stage
  const rows = await sql`
    SELECT homeowner_stage FROM projects WHERE id = ${projectId} LIMIT 1
  `;
  if (rows.length === 0) return;

  const currentStage = rows[0].homeowner_stage as HomeownerStage | null;
  const currentIdx   = currentStage ? HOMEOWNER_STAGES.indexOf(currentStage) : -1;
  const targetIdx    = HOMEOWNER_STAGES.indexOf(targetHomeownerStage);

  // 5. Forward-only guard — homeowner_stage never moves backward
  if (targetIdx <= currentIdx) {
    console.warn(
      `[writeMicroStage] WARN: backward/same stage skipped ` +
      `project=${projectId} micro=${stage} ` +
      `current=${currentStage}(${currentIdx}) target=${targetHomeownerStage}(${targetIdx})`,
    );
    return;
  }"""

if old_do_write not in src:
    print("❌ Could not find _doWriteMicroStage body — no changes made")
    sys.exit(1)

src = src.replace(old_do_write, new_do_write, 1)
print("✅ Added idempotency check + improved WARN logs in _doWriteMicroStage")

with open(fpath, "w", encoding="utf-8") as f:
    f.write(src)

print("✅ lib/microStage.ts written successfully")