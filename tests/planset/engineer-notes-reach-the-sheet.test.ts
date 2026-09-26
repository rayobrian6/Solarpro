// ═══════════════════════════════════════════════════════════════════════════
// THE ENGINEER'S NOTES WERE THREADED INTO THE GENERATOR AND READ BY NO SHEET
//
// app/engineering/page.tsx has a textarea headed ENGINEERING NOTES — "Add engineering
// notes, special conditions, AHJ requirements, utility interconnection notes…" — and
// threads its value into `permitInput.project.notes`, inside the payload the page's
// own comment calls "the one that reaches the AHJ".
//
// A grep for `.notes` across lib/permit, lib/drafting and lib/cad returned only CSS, a
// BOM item field, document-resolution notes, and the cover's OWN bucket arrays, which
// are filled entirely from `buildConstructionNotes(input)` — a fixed, code-derived
// list of NEC/IFC/BESS prose.
//
// 🚨 THE CRUEL PART IS THAT THE COVER DOES PRINT A GENERAL NOTES BLOCK. An engineer
// typing "AHJ requires the 36in pathway on the west plane; rafters sistered bays 3-5"
// gets a stamped set with a notes section full of boilerplate, and no signal that
// their sentence was dropped. It is somebody else's notes in the place theirs should
// be. That is the OUTPUT-CONSISTENCY LAW exactly: a thing the user states about
// physical reality that no downstream consumer consumes or declines out loud.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

function render(notes?: string): string {
  const input: any = clone(braidonOriginalAuditFixture);
  input.plansetProfile = 'design-review';
  if (notes !== undefined) input.project.notes = notes;
  const html = generatePermitHTML(input) as unknown as string;
  return html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
}

const NOTE_A = 'AHJ requires the 36in pathway on the west plane';
const NOTE_B = 'Rafters sistered bays 3-5 per field survey';
const NOTE_C = 'Utility requires the production meter ahead of the disconnect';

describe('the engineer of record\'s notes reach the stamped set', () => {
  it('🚨 a note typed into ENGINEERING NOTES appears in the package', () => {
    const text = render(NOTE_A);
    expect(text, 'the engineer typed a project-specific condition and the package does not contain it')
      .toContain(NOTE_A);
  });

  it('every line of a multi-line entry survives as its own note', () => {
    const text = render(`${NOTE_A}\n${NOTE_B}\n\n${NOTE_C}`);
    for (const n of [NOTE_A, NOTE_B, NOTE_C]) expect(text, n).toContain(n);
  });

  it('🚨 they are attributed, not blended into the generated boilerplate', () => {
    // A human's note about THIS building must not be mistakable for the generated
    // prose that is identical on every package this product has ever produced.
    const text = render(NOTE_A);
    expect(text).toMatch(/PROJECT-SPECIFIC \(ENGINEER OF RECORD\)/i);
  });

  it('an empty notes box invents nothing', () => {
    for (const empty of ['', '   ', '\n\n']) {
      const text = render(empty);
      expect(text, `notes=${JSON.stringify(empty)}`)
        .not.toMatch(/PROJECT-SPECIFIC \(ENGINEER OF RECORD\)/i);
    }
  });

  it('and the generated construction notes are still there', () => {
    // The engineer's notes are added, never substituted — the code prose is what makes
    // the set reviewable, and an "improvement" that dropped it would be a regression
    // this case exists to refuse.
    const text = render(NOTE_A);
    expect(text).toMatch(/NEC 110\.3\(B\)|Article 690/);
    expect(text).toMatch(/ELECTRICAL/);
  });

  it('notes are escaped, not injected as markup', () => {
    // The field is free text from a user and lands in generated HTML.
    const input: any = clone(braidonOriginalAuditFixture);
    input.plansetProfile = 'design-review';
    input.project.notes = '<script>alert(1)</script> & "quoted"';
    const raw = generatePermitHTML(input) as unknown as string;
    expect(raw, 'a raw <script> from a user field reached the rendered package')
      .not.toContain('<script>alert(1)</script>');
  });
});
