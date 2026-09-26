/**
 * tests/proposalUiMakesNoUnbackedClaim.test.ts
 *
 * ⚠️ THIS WHOLE FILE IS A SOURCE SCAN, AND THAT IS A DELIBERATE, STATED CHOICE.
 *
 * Every defect below is a literal string rendered by app/proposals/page.tsx
 * (3,400 lines) or app/proposals/view/[id]/page.tsx (2,500 lines). Both are
 * client components bound to useParams / useSearchParams, the app store, live
 * fetches and Recharts; the claims in question sit inside inner components that
 * need a fully-populated Proposal, a pricing config and a project snapshot.
 * Rendering either one in jsdom to read three sentences is not feasible, so the
 * strings are scanned instead — and the pieces that CAN be behavioural have been
 * made behavioural in their own files:
 *
 *   A2  → tests/cashFlowCardAnnouncesNoAbsentCredit.component.test.tsx (real render)
 *   A3  → tests/section48eBannerIsNotAFrozenTrue.test.ts (real predicate)
 *   A4  → the canonical SREC number itself, asserted below against a built proposal
 *   A5/A6 → tests/proposalInventsNoLenderTermsOrIncentives.test.ts (built object + HTML)
 *
 * COMMENTS ARE STRIPPED FIRST, with tests/support/stripSource.ts. This is not
 * hygiene: Phase 4 shipped TWO guards that were satisfied by the offending text
 * appearing inside the comment that documented its removal. The repair comments
 * in both pages necessarily quote "30% Investment Tax Credit", "ITC: On" and
 * "25-yr product warranty" to explain what was deleted.
 *
 * `stripComments` — not `stripCommentsAndStrings` — because the thing being
 * searched for IS the string body. The identifier stripper would blank
 * "ITC: On" to whitespace and every assertion here would pass vacuously.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A1 — AN "ITC: On" BADGE AND A "Remove Federal ITC?" DIALOG FOR A CREDIT THAT
 *      CANNOT EXIST.
 *
 * Every rep saw a green "✓ ITC: On" badge in the proposal toolbar. Touching it
 * opened a dialog asserting the homeowner gets "a 30% Investment Tax Credit" and
 * that removing it "will increase the net cost by ~30%". Both false for every
 * residential proposal: §25D was repealed by P.L. 119-21 for expenditures after
 * 2025-12-31, and the rendered document carries itcRate 0, itcAmount $0 and
 * netCost = gross. A rep could verbally promise a $9,000 credit on a $30,000
 * system on the strength of the badge, and flipping the toggle changed nothing in
 * the document — so the lie was undiscoverable from the screen.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A4 — TWO DIFFERENT SREC CONTRACT TOTALS IN ONE DOCUMENT.
 *
 * The installer proposal's SREC section printed the canonical figure via
 * cp.policy.srecSummary ("Estimated total contract value: $20,400"), while
 * Additional State Benefits printed the incentive catalog's generic $/kWh
 * estimate ("~$16,970") — a ~$3,400 disagreement about the same REC contract in
 * the same document. The Download button screenshots this DOM, so it shipped in
 * the PDF the rep emailed, and the canonical figure also drives the 25-yr
 * headline and the break-even year, so the smaller card made the payback look
 * unsupported.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A12 — "25-yr product warranty" ASSERTED UNCONDITIONALLY ON THE DOCUMENT THE
 *       HOMEOWNER SIGNS.
 *
 * With a green check, beside the correct model name — including for modules whose
 * real product warranty is 12 years, and when no panel is selected at all,
 * beneath the placeholder "High-efficiency solar panels". Racking had the same
 * shape: `|| '25-yr structural warranty'`. The inverter card next to them already
 * did it right ("Manufacturer warranty" when the term is unknown).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './support/stripSource';
import { buildCanonicalProposal } from '@/lib/proposal/buildCanonicalProposal';

const ROOT = join(__dirname, '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');

const INSTALLER_RAW = read('app', 'proposals', 'page.tsx');
const VIEW_RAW      = read('app', 'proposals', 'view', '[id]', 'page.tsx');
const INSTALLER     = stripComments(INSTALLER_RAW);
const VIEW          = stripComments(VIEW_RAW);

// ═══════════════════════════════════════════════════════════════════════════
// A1
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 A1 — the ITC control does not advertise a repealed credit', () => {
  it('the "ITC: On" / "ITC: Off" two-state badge is gone', () => {
    // The literal labels a rep read off the toolbar.
    expect(INSTALLER, 'the proposals page still renders an "ITC: On" badge')
      .not.toContain('ITC: On');
    expect(INSTALLER, 'the proposals page still renders an "ITC: Off" badge')
      .not.toContain('ITC: Off');
  });

  it('the modal no longer quotes a 30% Investment Tax Credit', () => {
    expect(INSTALLER, 'the dialog still promises a 30% Investment Tax Credit')
      .not.toContain('30% Investment Tax Credit');
    expect(INSTALLER, 'the dialog still claims removing ITC raises net cost ~30%')
      .not.toMatch(/increase the net cost by\s*~?30%/);
  });

  it('the control is gated on the authority, not rendered unconditionally', () => {
    // Both the badge and the dialog must be behind isItcEnabled(). Deleting the
    // strings while leaving an unconditional two-state toggle would be cosmetic.
    expect(INSTALLER, 'the page does not import isItcEnabled')
      .toMatch(/\bisItcEnabled\b/);
    expect(INSTALLER, 'the confirmation modal is not gated on the authority')
      .toMatch(/isItcEnabled\(\)\s*&&\s*showItcConfirm/);
  });

  it('when the credit is repealed the page states it, rather than offering a toggle', () => {
    expect(INSTALLER).toContain('Federal residential ITC: repealed (P.L. 119-21)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A4
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 A4 — one SREC number per document', () => {
  it('an srec/trec benefit card prints the canonical 25-yr contract value', () => {
    // The branch must exist and must read truth25yr, not inc.calculatedValue.
    for (const [name, src] of [['installer', INSTALLER], ['share view', VIEW]] as const) {
      expect(src, `${name}: no srec branch reading the canonical projection`)
        .toMatch(/inc\.type === 'srec'[\s\S]{0,200}?cp\.truth25yr\.srec_income_25yr/);
    }
  });

  it('🚨 the catalog estimate is not reachable for an srec/trec row', () => {
    // The defect was ORDER: `inc.calculatedValue` was tested before any srec
    // branch existed, so the generic estimate won. The srec test must come
    // first. Checked by position in the stripped source.
    const srecAt = INSTALLER.indexOf("inc.type === 'srec'");
    const calcAt = INSTALLER.indexOf('inc.calculatedValue > 0', srecAt > -1 ? srecAt : 0);
    expect(srecAt, 'the installer page has no srec branch at all').toBeGreaterThan(-1);
    expect(calcAt, 'the catalog estimate is tested BEFORE the srec branch')
      .toBeGreaterThan(srecAt);
  });

  it('the canonical SREC figure is a real, non-zero number for Illinois', () => {
    // Behavioural half: proves the value the card now reads actually exists, so
    // the repair is not "read a field that is always 0".
    const cp = buildCanonicalProposal({
      panelSpec: { manufacturer: 'Maxeon', model: 'MAX3-400-BLK', wattage: 400, efficiency: 22.3 },
      panelCount: 20,
      layoutSystemSizeKw: 8,
      annualProductionKwh: 11_200,
      monthlyProductionKwh: [700, 800, 1000, 1050, 1100, 1080, 1070, 1040, 940, 820, 620, 580],
      utilityName: 'Ameren Illinois',
      stateCode: 'IL',
      clientState: 'Illinois',
      annualUsageKwh: 12_000,
      systemType: 'roof',
      storedCashPrice: 29_280,
      purchaseMode: 'cash',
    });
    expect(cp.policy.srecAvailable).toBe(true);
    expect(cp.truth25yr.srec_income_25yr,
      'the canonical REC contract value is 0 — the card would print nothing')
      .toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A12
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 A12 — no warranty term is claimed unless one is on file', () => {
  for (const [name, src] of [['installer', INSTALLER], ['share view', VIEW]] as const) {
    it(`${name}: "25-yr product warranty" is never asserted unconditionally`, () => {
      // The unconditional JSX text. A conditional
      // `${selectedPanel.warranty}-yr product warranty` is a template and cannot
      // match this literal.
      expect(src, `${name} still asserts a 25-yr product warranty for any panel`)
        .not.toContain('25-yr product warranty');
    });

    it(`${name}: the racking fallback no longer invents a structural term`, () => {
      expect(src, `${name} still falls back to '25-yr structural warranty'`)
        .not.toContain('25-yr structural warranty');
    });

    it(`${name}: the panel card reads the snapshot's warranty when it has one`, () => {
      // Suppression must be conditional, matching the inverter card beside it.
      expect(src, `${name} does not read selectedPanel.warranty`)
        .toMatch(/selectedPanel\?\.warranty|selectedPanel\.warranty/);
      expect(src).toContain('Manufacturer warranty');
    });
  }
});
