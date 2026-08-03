// lib/fieldMeasurement/evidence.ts
// WS-5 — EVIDENCE ATTACHMENTS FOR A FIELD MEASUREMENT.
//
// The platform already has an attachment system: site_survey_files, scoped to a
// survey which is scoped to a project (migration 016). A route photograph, a
// marked-up plan, an as-built sketch, a laser screenshot, a field worksheet and
// survey evidence are all rows in that table. This module does NOT invent a
// second attachment store; it validates references INTO the existing one.
//
// FOUR RULES, and the fourth is the one that is easy to get wrong:
//
//   1. An attachment must belong to the SAME project (and therefore the same
//      tenant) as the measurement. A reference across projects is refused, not
//      ignored — silently dropping it would let a verification appear evidenced.
//
//   2. The actor must be able to reach it. Reachability is the project-access
//      gate that already governs the attachment's own surface; a measurement
//      cannot launder access to a file its recorder could not open.
//
//   3. IDs ARE RECORDED, CONTENT IS NOT. The audit trail carries attachment ids
//      and counts. It never carries file bytes, URLs with credentials, or
//      extracted text: an audit record is read by people who are not
//      necessarily cleared for the artefact it points at.
//
//   4. EVIDENCE IS RE-CHECKED AT VERIFICATION TIME, not trusted from record
//      time. An attachment that has since been deleted or moved out of the
//      project stops satisfying the policy — it does not keep a verification
//      alive silently. This is why `resolveEvidence` is called by the
//      verification policy and not only by the record path.

import { getDbReady } from '@/lib/db/core';

export interface EvidenceAttachmentFact {
  attachmentId: string;
  /** the attachment exists AND is readable right now. */
  present: boolean;
  /** the project the attachment actually belongs to (null when not found). */
  projectId: string | null;
  /** a short kind label for display ('photo' | 'document' | …). Never content. */
  kind: string | null;
  /** a display label for the operator panel. Never a URL with credentials. */
  label: string | null;
}

export interface EvidenceResolution {
  /** every id that was asked about, in request order. */
  facts: EvidenceAttachmentFact[];
  /** ids that exist, are readable, and belong to THIS project. */
  validIds: string[];
  /** ids that failed, each with the reason. */
  invalid: { attachmentId: string; reason: string }[];
  /** true ⇒ at least one valid attachment. The policy's evidence gate. */
  sufficient: boolean;
  /** set when the attachment store itself could not be read. Distinct from
   *  "no attachments": unavailable is RETRYABLE, empty is REQUIRES_INPUT. */
  storeError: string | null;
}

/** The seam. Injectable so the service and its tests share ONE evidence path. */
export interface EvidenceSource {
  lookup(projectId: string, attachmentIds: string[]): Promise<EvidenceAttachmentFact[]>;
}

/**
 * Resolve an evidence set for a project. NEVER throws for a business reason: a
 * store failure is reported as `storeError` with `sufficient: false`, because an
 * unreadable evidence store must not read as "evidence present".
 */
export async function resolveEvidence(
  projectId: string,
  attachmentIds: readonly string[],
  src: EvidenceSource,
): Promise<EvidenceResolution> {
  const ids = [...new Set(attachmentIds.map(s => String(s).trim()).filter(Boolean))];
  if (ids.length === 0) {
    return { facts: [], validIds: [], invalid: [], sufficient: false, storeError: null };
  }
  let facts: EvidenceAttachmentFact[];
  try {
    facts = await src.lookup(projectId, ids);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      facts: ids.map(id => ({ attachmentId: id, present: false, projectId: null, kind: null, label: null })),
      validIds: [],
      invalid: ids.map(id => ({ attachmentId: id, reason: `evidence store unavailable: ${msg}` })),
      sufficient: false,
      storeError: msg,
    };
  }

  const byId = new Map(facts.map(f => [f.attachmentId, f]));
  const validIds: string[] = [];
  const invalid: { attachmentId: string; reason: string }[] = [];
  for (const id of ids) {
    const f = byId.get(id);
    if (!f || !f.present) {
      invalid.push({ attachmentId: id, reason: 'attachment not found or no longer readable' });
      continue;
    }
    if (f.projectId !== projectId) {
      invalid.push({ attachmentId: id, reason: 'attachment belongs to a different project' });
      continue;
    }
    validIds.push(id);
  }
  return {
    facts: ids.map(id => byId.get(id) ?? { attachmentId: id, present: false, projectId: null, kind: null, label: null }),
    validIds,
    invalid,
    sufficient: validIds.length > 0,
    storeError: null,
  };
}

/**
 * The production evidence source: site_survey_files joined through site_surveys
 * to the project. The join IS the tenant/project scoping — a file whose survey
 * belongs to another project simply does not come back, so a cross-project id
 * lands in `invalid` rather than being silently accepted.
 */
export const productionEvidenceSource: EvidenceSource = {
  async lookup(projectId: string, attachmentIds: string[]): Promise<EvidenceAttachmentFact[]> {
    const sql = await getDbReady();
    const rows = await sql`
      SELECT f.id, f.file_type, f.label, f.filename, s.project_id
      FROM site_survey_files f
      JOIN site_surveys s ON s.id = f.survey_id
      WHERE f.id = ANY(${attachmentIds}::uuid[])
        AND s.project_id = ${projectId}
    `;
    return (rows as Array<{ id: string; file_type: string | null; label: string | null; filename: string | null; project_id: string }>)
      .map(r => ({
        attachmentId: String(r.id),
        present: true,
        projectId: String(r.project_id),
        kind: r.file_type ? String(r.file_type) : null,
        // A human label only. Never the file URL — an audit reader is not
        // necessarily cleared for the artefact.
        label: r.label ? String(r.label) : (r.filename ? String(r.filename) : null),
      }));
  },
};
