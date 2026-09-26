/**
 * Priority 10 — Homeowner Portal: Document Vault + Referral Generator
 *
 * Tests cover:
 *   1. Source assertions: DocumentVault component
 *   2. Source assertions: ReferralSection component
 *   3. Source assertions: portal dashboard JSX integration
 *   4. REFERRAL_ELIGIBLE_STAGES constant
 *   5. Portal dashboard imports (FileText, Download, Gift, Copy, Link2, CheckCircle)
 *   6. Referral URL structure (uses /portal?ref= pattern)
 *   7. void documents suppressor removed (documents now rendered)
 *   8. DocumentVault renders all file categories from PortalDocument
 *   9. Regression: original portal sections still present
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

function readSrc(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf-8');
}

const src = readSrc('app/portal/dashboard/page.tsx');

// ─── 1. DocumentVault source assertions ──────────────────────────────────────

describe('DocumentVault component', () => {
  it('exists as a function in the portal dashboard', () => {
    expect(src).toContain('function DocumentVault(');
  });

  it('receives documents prop', () => {
    expect(src).toContain('documents: PortalDocument[]');
  });

  it('returns null when documents array is empty', () => {
    expect(src).toContain('if (documents.length === 0) return null');
  });

  it('renders each document with its label', () => {
    expect(src).toContain('doc.label');
  });

  it('renders upload date formatted with toLocaleDateString', () => {
    expect(src).toContain('toLocaleDateString');
    expect(src).toContain('doc.uploaded_at');
  });

  it('uses FileText icon for document rows', () => {
    expect(src).toContain('FileText');
  });

  it('uses Download icon for each document row', () => {
    expect(src).toContain('Download');
  });

  it('has Your Documents header', () => {
    expect(src).toContain('Your Documents');
  });

  /**
   * 🚨 UPDATED: the vault no longer maps `documents` directly.
   *
   * The bill upload now stores TWO rows — the homeowner's actual bill and a
   * machine-readable `Bill_Data_*.json` summary of the five parsed fields — and
   * both are `utility_bill`, so both reach the portal. The summary is filtered out
   * before the list is rendered (lib/portal/documents.ts); offering the homeowner
   * a download of five numbers in braces is not a document vault.
   *
   * What the homeowner actually SEES is asserted by rendering the page in
   * tests/portalDashboardTellsOneTruth.component.test.tsx. This is the source-level
   * remnant.
   */
  it('maps over the homeowner-facing documents', () => {
    expect(src).toContain('documents.filter(isHomeownerFacingDocument)');
    expect(src).toContain('visible.map(');
  });
});

// ─── 2. ReferralSection source assertions ────────────────────────────────────

describe('ReferralSection component', () => {
  it('exists as a function in the portal dashboard', () => {
    expect(src).toContain('function ReferralSection(');
  });

  /**
   * 🚨 UPDATED, AND THIS ONE WAS PINNING A DEFECT.
   *
   * `REFERRAL_ELIGIBLE_STAGES` held `['install_scheduled', 'completed']` and was
   * tested with `.includes(stage)` where `stage` is a `HomeownerStage`.
   * `install_scheduled` is a MICRO-stage — not a member of that union, and never
   * equal to any member — so the install-scheduled half NEVER FIRED and the card
   * appeared only at `completed`. The array had been widened to `string[]`, which
   * is why the comparison type-checked.
   *
   * Each is now asked of the vocabulary that holds it. That the card really does
   * appear at install_scheduled is proven by rendering, in
   * tests/portalDashboardTellsOneTruth.component.test.tsx.
   */
  it('shows at completed (a homeowner stage) or install_scheduled (a micro-stage)', () => {
    expect(src).toContain("'install_scheduled'");
    expect(src).toContain("'completed'");
    expect(src).toContain('REFERRAL_ELIGIBLE_STAGES');
    expect(src).toContain('REFERRAL_ELIGIBLE_MICRO_STAGES');
  });

  it('returns null for ineligible stages', () => {
    expect(src).toContain('if (!eligible) return null;');
  });

  it('uses navigator.clipboard.writeText', () => {
    expect(src).toContain('navigator.clipboard.writeText');
  });

  it('has clipboard fallback (execCommand copy)', () => {
    expect(src).toContain('execCommand');
    expect(src).toContain("'copy'");
  });

  /**
   * 🚨 UPDATED, AND THESE TWO PINNED THE DEFECT MOST DIRECTLY.
   *
   * `/portal?ref=<first name>` sent a referred neighbour to an email-OTP LOGIN
   * WALL for an account they do not have — no quote form, no path forward — with
   * the referrer's first name as an "attribution" that nothing anywhere read. The
   * link now goes to the public intake funnel and carries the referring client's
   * id in parameters that funnel already forwards and the intake route already
   * persists. See lib/portal/referral.ts and
   * tests/portalNumbersAndReferralUnit.test.ts for the URL's shape.
   */
  it('builds the referral URL through the shared builder, not inline', () => {
    expect(src).toContain('buildReferralUrl(base, clientId)');
    expect(src, 'the referral still points at the portal login wall')
      .not.toContain('/portal?ref=');
  });

  it('does not put the client\'s name in a link they are told to share', () => {
    expect(src).not.toContain("clientName.split(' ')[0]");
  });

  it('has copy feedback state (copied)', () => {
    expect(src).toContain('copied');
    expect(src).toContain('setCopied(true)');
    expect(src).toContain('setCopied(false)');
  });

  it('shows Copied! feedback text', () => {
    expect(src).toContain("'Copied!'");
  });

  it('shows Copy button text', () => {
    expect(src).toContain("'Copy'");
  });

  it('uses Gift icon for header', () => {
    expect(src).toContain('Gift');
  });

  it('uses Link2 icon for URL display', () => {
    expect(src).toContain('Link2');
  });

  it('uses Copy icon for copy button', () => {
    expect(src).toContain('Copy');
  });

  it('has "Refer a Neighbor" heading', () => {
    expect(src).toContain('Refer a Neighbor');
  });

  it('has "Love your solar? Share it." CTA', () => {
    expect(src).toContain('Love your solar? Share it.');
  });

  it('mentions ownerCompany in the copy', () => {
    expect(src).toContain('ownerCompany');
  });

  it('resets copied state after 2500ms', () => {
    expect(src).toContain('2500');
  });
});

// ─── 3. Portal dashboard JSX integration ─────────────────────────────────────

describe('Portal dashboard JSX integration', () => {
  it('renders <DocumentVault documents={documents} />', () => {
    expect(src).toContain('<DocumentVault documents={documents}');
  });

  it('renders <ReferralSection stage={stage}', () => {
    expect(src).toContain('<ReferralSection');
    expect(src).toContain('stage={stage}');
  });

  it('passes ownerCompany to ReferralSection', () => {
    expect(src).toContain('ownerCompany={owner?.company ?? null}');
  });

  it('passes the client ID to ReferralSection (not their name — see above)', () => {
    expect(src).toContain('clientId={client?.id ?? null}');
  });

  it('DocumentVault appears before ReferralSection in render order', () => {
    const vaultIdx = src.indexOf('<DocumentVault documents={documents}');
    const referralIdx = src.indexOf('<ReferralSection');
    expect(vaultIdx).toBeGreaterThan(-1);
    expect(referralIdx).toBeGreaterThan(-1);
    expect(vaultIdx).toBeLessThan(referralIdx);
  });
});

// ─── 4. REFERRAL_ELIGIBLE_STAGES ──────────────────────────────────────────────

describe('REFERRAL_ELIGIBLE_STAGES constant', () => {
  it('is typed as HomeownerStage[], which is what made the old bug invisible', () => {
    // It was `string[]`, so putting a micro-stage name in it type-checked. Typed to
    // the union, `'install_scheduled'` in this array is now a compile error.
    expect(src).toContain('const REFERRAL_ELIGIBLE_STAGES: HomeownerStage[] = [');
  });

  it('contains install_scheduled', () => {
    expect(src).toContain("'install_scheduled'");
  });

  it('contains completed', () => {
    // 'completed' appears multiple times — just ensure it's in the array definition context
    expect(src).toContain("REFERRAL_ELIGIBLE_STAGES");
    expect(src).toContain("'completed'");
  });
});

// ─── 5. Portal dashboard imports ─────────────────────────────────────────────

describe('Portal dashboard imports', () => {
  it('imports FileText from lucide-react', () => {
    expect(src).toContain('FileText');
  });

  it('imports Download from lucide-react', () => {
    expect(src).toContain('Download');
  });

  it('imports Gift from lucide-react', () => {
    expect(src).toContain('Gift');
  });

  it('imports Copy from lucide-react', () => {
    expect(src).toContain('Copy');
  });

  it('imports Link2 from lucide-react', () => {
    expect(src).toContain('Link2');
  });

  it('imports CheckCircle from lucide-react', () => {
    expect(src).toContain('CheckCircle');
  });
});

// ─── 6. Referral URL structure ────────────────────────────────────────────────

describe('Referral URL structure', () => {
  it('uses window.location.origin for the base URL', () => {
    expect(src).toContain('window.location.origin');
  });

  it('falls back to NEXT_PUBLIC_BASE_URL env var', () => {
    expect(src).toContain('NEXT_PUBLIC_BASE_URL');
  });

  it('hands the base URL to the shared builder', () => {
    // The path and parameters are that module's business, and are asserted
    // behaviourally in tests/portalNumbersAndReferralUnit.test.ts.
    expect(src).toContain("import { buildReferralUrl } from '@/lib/portal/referral'");
    expect(src).toContain('buildReferralUrl(base, clientId)');
  });
});

// ─── 7. void documents suppressor removed ─────────────────────────────────────

describe('void documents suppressor', () => {
  it('void documents is no longer needed (documents now rendered)', () => {
    expect(src).not.toContain('void documents');
  });
});

// ─── 8. PortalDocument interface ─────────────────────────────────────────────

describe('PortalDocument interface', () => {
  it('has project_id field', () => {
    const interfaceBlock = src.slice(src.indexOf('interface PortalDocument'), src.indexOf('interface PortalDocument') + 200);
    expect(interfaceBlock).toContain('project_id');
  });

  it('has doc_type field', () => {
    const interfaceBlock = src.slice(src.indexOf('interface PortalDocument'), src.indexOf('interface PortalDocument') + 200);
    expect(interfaceBlock).toContain('doc_type');
  });

  it('has label field', () => {
    const interfaceBlock = src.slice(src.indexOf('interface PortalDocument'), src.indexOf('interface PortalDocument') + 200);
    expect(interfaceBlock).toContain('label');
  });

  it('has uploaded_at field', () => {
    const interfaceBlock = src.slice(src.indexOf('interface PortalDocument'), src.indexOf('interface PortalDocument') + 200);
    expect(interfaceBlock).toContain('uploaded_at');
  });
});

// ─── 9. Regression: original portal sections intact ──────────────────────────

describe('Portal dashboard regression — original sections', () => {
  it('still has MonitoringFoundation component', () => {
    expect(src).toContain('function MonitoringFoundation(');
    expect(src).toContain('<MonitoringFoundation stage={stage}');
  });

  it('still has ProjectTeam component', () => {
    expect(src).toContain('function ProjectTeam(');
    expect(src).toContain('<ProjectTeam');
  });

  it('still has proposals state', () => {
    expect(src).toContain('proposals');
  });

  it('still has stage-based rendering logic', () => {
    expect(src).toContain('homeowner_stage');
  });

  it('still has loading state', () => {
    expect(src).toContain('loading');
  });

  it('still has portal session auth', () => {
    expect(src).toContain('PORTAL_AUTH_REQUIRED');
  });
});
