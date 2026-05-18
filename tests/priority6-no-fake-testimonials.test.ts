// ─────────────────────────────────────────────────────────────────────────────
// Priority 6: No Fake Testimonials
//
// Verifies that:
//   1. No hardcoded fake customer testimonials exist in proposal pages
//      (the "Michael R. — Verified Customer" fabrication is gone)
//   2. The proposal footer block is controlled by `proposalFooterText`
//      from branding configuration
//   3. When proposalFooterText is null/empty, a generic professional
//      fallback is rendered (not a fake attribution)
//   4. The PDF renderer source (renderProposalHTML.ts) is also clean of fake quotes
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// ─── Helpers: read source files ────────────────────────────────────────────

function readSource(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

// ─────────────────────────────────────────────────────────────────────────────

describe('Priority 6 — No fake testimonials in source files', () => {
  // Known fake testimonial patterns that were previously hardcoded
  const FAKE_PATTERNS = [
    'Michael R.',
    'Michael R. —',
    'Verified Customer',
    /['"]Michael\s+R\./,
  ];

  it('proposal view page has no fake "Michael R." testimonial', () => {
    const src = readSource('app/proposals/view/[id]/page.tsx');
    expect(src).not.toContain('Michael R.');
    expect(src).not.toContain('Verified Customer');
  });

  it('proposals list page has no fake "Michael R." testimonial', () => {
    const src = readSource('app/proposals/page.tsx');
    expect(src).not.toContain('Michael R.');
    expect(src).not.toContain('Verified Customer');
  });

  it('PDF renderer (renderProposalHTML) has no hardcoded fake customer name', () => {
    const src = readSource('lib/proposal/renderProposalHTML.ts');
    expect(src).not.toContain('Michael R.');
    expect(src).not.toContain('Verified Customer');
  });

  it('no fake testimonials in any proposal-related source file', () => {
    const files = [
      'app/proposals/view/[id]/page.tsx',
      'app/proposals/page.tsx',
      'lib/proposal/renderProposalHTML.ts',
      'lib/proposal/canonicalProposal.ts',
    ];
    for (const file of files) {
      const src = readSource(file);
      for (const pattern of FAKE_PATTERNS) {
        if (typeof pattern === 'string') {
          expect(src, `${file} should not contain "${pattern}"`).not.toContain(pattern);
        } else {
          expect(src, `${file} should not match ${pattern}`).not.toMatch(pattern);
        }
      }
    }
  });
});

describe('Priority 6 — proposalFooterText controls footer block', () => {
  it('proposal view page uses proposalFooterText when set', () => {
    const src = readSource('app/proposals/view/[id]/page.tsx');
    // The block should conditionally render based on branding.proposalFooterText
    expect(src).toContain('branding.proposalFooterText');
    expect(src).toContain('proposalFooterText ?');
  });

  it('proposal view page has fallback for missing proposalFooterText', () => {
    const src = readSource('app/proposals/view/[id]/page.tsx');
    // Should show generic professional message, not a fake attribution
    expect(src).toContain('Licensed solar professionals');
  });

  it('proposals list page uses proposalFooterText when set', () => {
    const src = readSource('app/proposals/page.tsx');
    expect(src).toContain('branding.proposalFooterText');
    expect(src).toContain('proposalFooterText ?');
  });

  it('proposals list page has fallback for missing proposalFooterText', () => {
    const src = readSource('app/proposals/page.tsx');
    expect(src).toContain('Licensed solar professionals');
  });

  it('proposal view page footer block shows company name when branding text is set', () => {
    const src = readSource('app/proposals/view/[id]/page.tsx');
    // When proposalFooterText is set, the company name should be shown as attribution
    // (not a fake customer name)
    expect(src).toContain('{branding.companyName}');
    // And the company logo should be shown if available
    expect(src).toContain('companyLogoUrl');
  });

  it('both proposal pages share the same footer logic pattern', () => {
    const viewSrc = readSource('app/proposals/view/[id]/page.tsx');
    const listSrc = readSource('app/proposals/page.tsx');
    // Both should have proposalFooterText conditional logic
    expect(viewSrc).toContain('branding.proposalFooterText ?');
    expect(listSrc).toContain('branding.proposalFooterText ?');
    // Both should have the same fallback text
    expect(viewSrc).toContain('Licensed solar professionals committed to quality');
    expect(listSrc).toContain('Licensed solar professionals committed to quality');
  });
});

describe('Priority 6 — branding.proposalFooterText field plumbing', () => {
  it('proposal view page declares proposalFooterText in branding type', () => {
    const src = readSource('app/proposals/view/[id]/page.tsx');
    expect(src).toContain('proposalFooterText: string | null');
  });

  it('proposals list page declares proposalFooterText in branding type', () => {
    const src = readSource('app/proposals/page.tsx');
    expect(src).toContain('proposalFooterText: string | null');
  });

  it('proposal view page initialises proposalFooterText to null in default branding', () => {
    const src = readSource('app/proposals/view/[id]/page.tsx');
    // Both the branding state init and the default branding object should set null
    const occurrences = (src.match(/proposalFooterText:\s*null/g) || []).length;
    expect(occurrences).toBeGreaterThanOrEqual(1);
  });

  it('proposal view page maps proposalFooterText from API response', () => {
    const src = readSource('app/proposals/view/[id]/page.tsx');
    expect(src).toContain('proposalFooterText: d.data.proposalFooterText');
  });

  it('proposals list page maps proposalFooterText from API response', () => {
    const src = readSource('app/proposals/page.tsx');
    expect(src).toContain('proposalFooterText: d.data.proposalFooterText');
  });
});

describe('Priority 6 — PDF renderer has no fake testimonials', () => {
  it('renderProposalHTML source has no hardcoded fake customer name', () => {
    const src = readSource('lib/proposal/renderProposalHTML.ts');
    expect(src).not.toContain('Michael R.');
    expect(src).not.toContain('Verified Customer');
  });

  it('renderProposalHTML source uses companyName for attribution, not a fake name', () => {
    const src = readSource('lib/proposal/renderProposalHTML.ts');
    // The company name should appear in the output
    expect(src).toContain('branding.companyName');
  });
});

describe('Priority 6 — data-block-id attribute preserved', () => {
  // The block kept its data-block-id="testimonial" attribute for backwards compatibility
  // with any block-hiding/showing logic, even though it now shows company content
  it('proposal view page still has data-block-id="testimonial" block for compat', () => {
    const src = readSource('app/proposals/view/[id]/page.tsx');
    expect(src).toContain('data-block-id="testimonial"');
  });

  it('proposals list page still has data-block-id="testimonial" block for compat', () => {
    const src = readSource('app/proposals/page.tsx');
    expect(src).toContain('data-block-id="testimonial"');
  });
});
