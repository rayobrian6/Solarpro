// ═══════════════════════════════════════════════════════════════════════════
// A CODE FAMILY WITH NO ADOPTED YEAR, AND A LINE ITEM ISSUING A RELEASE VERDICT
//
// ── "PENDING IBC" WAS NEVER AN EDITION ────────────────────────────────────
// The PE letter and the load-basis tables read the RAW edition token
// (`cp.ibc ?? 'PENDING'`) and prepended it to the family name, so an unresolved
// adoption printed as though PENDING were a year:
//
//     "Prepared under ASCE 7-22 · PENDING IBC · PENDING IRC · NEC 2020"
//     "...analyzed ... per ASCE 7-22 §26/27 and PENDING IBC/IRC."
//
// The projection has published the right label the whole time — `ibcLabel`,
// which reads "IBC PER AHJ ADOPTION" when the family governs but the year is the
// AHJ's to confirm at plan review, and "IBC PENDING" only when the adoption is
// genuinely unresolved. 63 places on the package already printed it correctly;
// the ones that did not are on the sheets a reviewer opens first.
//
// ── A BOM ROW MAY NOT ISSUE A RELEASE VERDICT ─────────────────────────────
// Seven racking rows ended "· NOT FOR PERMIT SUBMISSION". That is the PACKAGE's
// release state — decided by the release model, stated by the sheet banner — and
// on this design the model says DESIGN COMPLETE, because an unpinned rail SKU is
// an ADVISORY (a procurement item; the RT-Mini II PE letter delegates the rail
// "by others"). So the schedule declared the whole submittal blocked, seven
// times, over something already classified as not blocking.
//
// A line item states its own PROCUREMENT status. Whether the set may be
// submitted is not its to say — the same rule Root 2 applied to SCHED's branch
// matrix, which had grown its own second release model.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import { projectCodeAuthorityFromInput, PER_AHJ_EDITION } from '@/lib/permit/snapshot/codeAuthorityProjection';
import { PROCUREMENT_CLASS_LABEL } from '@/lib/structural-engine-v4';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));
const input: any = clone(braidonOriginalAuditFixture);
input.plansetProfile = 'design-review';
const html = generatePermitHTML(input) as unknown as string;
const text = html
  .replace(/<[^>]+>/g, ' ')
  .replace(/&middot;/g, '·').replace(/&mdash;/g, '—').replace(/&bull;/g, '·')
  .replace(/\s+/g, ' ');

describe('an unadopted code edition is named as one', () => {
  const cp = projectCodeAuthorityFromInput(input);

  it('the projection publishes the label the sheets must use', () => {
    expect(cp.ibcLabel).toBe(`IBC ${PER_AHJ_EDITION}`);
    expect(cp.ircLabel).toBe(`IRC ${PER_AHJ_EDITION}`);
  });

  it('and nothing prints PENDING as though it were a year', () => {
    expect(text).not.toMatch(/PENDING IBC/);
    expect(text).not.toMatch(/PENDING IRC/);
    expect(text).not.toMatch(/PENDING IFC/);
    expect(text).toMatch(/IBC PER AHJ ADOPTION/);
  });

  it('the PE letter states the code basis in the same words as the cover', () => {
    // The letterhead was the worst offender: it is the first line a reviewer
    // reads, and it read "Prepared under ASCE 7-22 · PENDING IBC".
    expect(text).toMatch(/Prepared under ASCE 7-22 · IBC PER AHJ ADOPTION/);
  });
});

describe('a procurement row states procurement, not release', () => {
  it('the class-B label names the procurement state only', () => {
    expect(PROCUREMENT_CLASS_LABEL.B).toBe(
      'DESIGN QUANTITY — NON-ORDERABLE / PENDING RACKING ASSEMBLY SELECTION');
    expect(PROCUREMENT_CLASS_LABEL.B).not.toMatch(/NOT FOR PERMIT SUBMISSION/);
  });

  it('no BOM line carries the package release verdict', () => {
    // Every surviving occurrence must be a sheet-level statement, not a row.
    for (const m of text.matchAll(/(.{110})NOT FOR PERMIT SUBMISSION/g)) {
      expect(m[1], m[1]).not.toMatch(/DESIGN QTY|assembly-dependent|ea NEC|Stage 5/);
    }
  });

  it('the rows still say plainly that they cannot be ordered', () => {
    // Nothing was softened: the honest procurement state is unchanged and still
    // excludes these rows from the authoritative total.
    expect(text).toMatch(/DESIGN QUANTITY — NON-ORDERABLE \/ PENDING RACKING ASSEMBLY SELECTION/);
    expect(text).toMatch(/assembly-dependent on the unselected rail SKU/);
  });
});
