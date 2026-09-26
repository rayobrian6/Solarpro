/** @vitest-environment jsdom */

/**
 * tests/portalDashboardTellsOneTruth.component.test.tsx
 *
 * ONE SYSTEM, ONE SCREEN, TWO DIFFERENT ANSWERS. THIS RENDERS THE SCREEN.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. PRODUCTION AND CO2, TWICE, DIFFERENTLY. `app/portal/dashboard/page.tsx`
 *      carried a local `calcBenefits()` using 1400 kWh/kW/yr and 0.386 kg
 *      CO2/kWh, while the SystemPerformance card a few hundred pixels further
 *      down used lib/portal/production.ts's 1370 and 0.4. A completed-stage
 *      homeowner scrolled past two cards answering "how much will my system
 *      make?" and "how much CO2 do I offset?" with different numbers — ~300
 *      kWh/yr and 0.1 tons apart — and nothing said which was right. The dollar
 *      savings figure was derived from the wrong one.
 *
 *   2. A DOWNLOAD ICON THAT WAS NOT A CONTROL. The document vault rendered a
 *      download glyph with no href, no handler, and no endpoint. The homeowner
 *      clicked it and nothing happened.
 *
 *   3. A REFERRAL LINK TO A LOGIN WALL, WHICH ALSO NEVER APPEARED. It pointed at
 *      `/portal?ref=<first name>` — an email-OTP sign-in for an account the
 *      neighbour does not have, carrying an attribution nothing reads. And its
 *      eligibility gate compared a MICRO-stage name (`install_scheduled`) against
 *      a `HomeownerStage`, so the install-scheduled half never fired at all.
 *
 *   4. "THIS IS EXACTLY WHAT <name> SEES IN THEIR PORTAL" — on an admin preview
 *      built from a THIRD hardcoded copy of the stage copy that differed in every
 *      stage, read aloud by reps on live calls.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THESE TESTS RENDER
 * ─────────────────────────────────────────────────────────────────────────────
 * Every one of those four is a claim about what a person SEES. A source scan can
 * say `calcBenefits` is gone; only a render can say the two cards now agree,
 * because agreement is a property of the output, not of the source. So the real
 * page is mounted against a stubbed `/api/portal/dashboard`, and the assertions
 * read the DOM.
 */

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import {
  estimateAnnualKwh,
  estimateCo2Tons,
  estimateAnnualSavingsUsd,
} from '@/lib/portal/production';
import { STAGE_CONTENT } from '@/lib/portal/stageContent';

// ── Identities ──────────────────────────────────────────────────────────────

const CLIENT_ID  = '33333333-3333-4333-8333-333333333333';
const PROJECT_ID = '4030b664-bebe-433b-a11c-cda05ead2f7d';
const BILL_FILE  = '55555555-5555-4555-8555-555555555555';

/** One system. Every number on the screen must be derived from this. */
const SYSTEM_KW = 8.4;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useParams: () => ({ id: PROJECT_ID }),
}));

// ── The payload the read route returns ──────────────────────────────────────

type Payload = Record<string, unknown>;

function dashboardPayload(over: Payload = {}): Payload {
  return {
    success: true,
    client: { id: CLIENT_ID, name: 'Braidon Pilla', email: 'braidon@e.st', phone: null },
    owner:  { name: 'Ray', phone: null, email: null, company: 'Under the Sun Solar' },
    projects: [{
      id: PROJECT_ID,
      name: 'BRAIDON M PILLA — Solar',
      address: '3 Melvin Drive, Granite City, IL 62040',
      system_size_kw: SYSTEM_KW,
      homeowner_stage: 'completed',
      updated_at: '2026-09-01T12:00:00.000Z',
      created_at: '2026-08-01T12:00:00.000Z',
      install_date: null,
    }],
    stageHistory: [],
    documents: [
      // The homeowner's real bill, with an id — the endpoint can serve it.
      {
        project_id: PROJECT_ID, doc_type: 'project_file', id: BILL_FILE,
        label: 'Utility Bill', uploaded_at: '2026-08-02T12:00:00.000Z',
      },
      // The parsed-data summary. Machine-readable, and not for them.
      {
        project_id: PROJECT_ID, doc_type: 'project_file', id: '66666666-6666-4666-8666-666666666666',
        label: 'Bill Data Portal', uploaded_at: '2026-08-02T12:00:00.000Z',
      },
    ],
    microStages: [],
    proposals: [],
    ...over,
  };
}

function stubDashboard(payload: Payload) {
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes('/api/portal/dashboard')) {
      return new Response(JSON.stringify(payload), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
}

const bodyText = (): string => document.body.textContent ?? '';
const occurrences = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1;

async function renderPortal(payload: Payload = dashboardPayload()) {
  stubDashboard(payload);
  const { default: PortalDashboard } = await import('@/app/portal/dashboard/page');
  render(<PortalDashboard />);
  // The page shows a loader until the fetch resolves.
  await waitFor(() => expect(screen.queryByText(/Loading your portal/)).not.toBeInTheDocument());
}

beforeEach(() => { vi.resetModules(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

// ═══════════════════════════════════════════════════════════════════════════
// 1. 🚨 ONE SYSTEM, ONE ANSWER
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 the portal asserts ONE production figure and ONE carbon figure', () => {
  it('both cards show the same annual kWh, and it is the module\'s', async () => {
    await renderPortal();

    const expected = estimateAnnualKwh(SYSTEM_KW).toLocaleString();   // 11,508
    expect(expected).toBe('11,508');

    const text = bodyText();
    // Two cards are on screen for a completed project: "Projected System
    // Benefits" and "Your expected production". Both must print this number.
    expect(occurrences(text, expected),
      'the two production cards do not agree — or one of them is missing').toBe(2);

    // And the number the deleted local helper produced (8.4 × 1400) is nowhere.
    expect(text, 'a second production multiplier is still in play')
      .not.toContain((Math.round(SYSTEM_KW * 1400)).toLocaleString());
  });

  it('both cards show the same CO2 tons', async () => {
    await renderPortal();
    const tons = String(estimateCo2Tons(estimateAnnualKwh(SYSTEM_KW)));  // '4.6'
    expect(tons).toBe('4.6');

    const text = bodyText();
    expect(occurrences(text, `${tons} tons/year`), 'the performance card\'s CO2 line').toBe(1);
    // The benefits grid prints the same value in its own tile.
    expect(occurrences(text, tons)).toBeGreaterThanOrEqual(2);

    // The old local helper's answer (0.386 kg/kWh on 1400 kWh/kW) was 4.5.
    expect(text).not.toContain('4.5 tons/year');
  });

  it('and the savings figure is derived from that same production number', async () => {
    await renderPortal();
    const savings = estimateAnnualSavingsUsd(estimateAnnualKwh(SYSTEM_KW));
    expect(bodyText()).toContain(`$${savings.toLocaleString()}`);
    // Not the figure derived from the other multiplier.
    expect(bodyText()).not.toContain(`$${Math.round(SYSTEM_KW * 1400 * 0.135).toLocaleString()}`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. THE DOCUMENT VAULT
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 the download glyph is a real link, or is not there', () => {
  it('the homeowner\'s bill is a link to the portal file endpoint', async () => {
    await renderPortal();
    const link = screen.getByRole('link', { name: /Download Utility Bill/i });
    expect(link).toHaveAttribute('href', `/api/portal/files/${BILL_FILE}`);
  });

  it('the parsed-data summary is not offered to them at all', async () => {
    await renderPortal();
    expect(screen.queryByText('Bill Data Portal'),
      'the homeowner is being shown a JSON blob of five parsed numbers').not.toBeInTheDocument();
  });

  /**
   * MEASURED: this one PASSES with the dead icon restored, because the old glyph
   * was an `<svg>` and `queryByRole('link')` finds nothing either way. It guards
   * the no-id branch of the repair, not the repair itself — the discriminating
   * assertion is the one above. Recorded rather than counted.
   */
  it('a document with no id renders NO download control rather than a dead one', async () => {
    await renderPortal(dashboardPayload({
      documents: [{
        project_id: PROJECT_ID, doc_type: 'project_file',
        label: 'Utility Bill', uploaded_at: '2026-08-02T12:00:00.000Z',
      }],
    }));
    // The row is still listed — a read-only list is honest.
    expect(screen.getByText('Utility Bill')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Download/i }),
      'a download control was rendered with nothing to download').not.toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. THE REFERRAL LINK
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 the referral link goes somewhere a stranger can act', () => {
  it('it lands on the public intake funnel, not the portal login', async () => {
    await renderPortal();
    const text = bodyText();
    expect(text).toContain('/free-solar-estimate?');
    expect(text, 'the referral still points at the login wall').not.toContain('/portal?ref=');
  });

  it('and it carries the referring client\'s id, not their first name', async () => {
    await renderPortal();
    const text = bodyText();
    expect(text).toContain(`utm_content=${CLIENT_ID}`);
    expect(text).toContain(`ref=${CLIENT_ID}`);
    expect(text, "the referrer's personal name is in a link they are told to share")
      .not.toContain('ref=Braidon');
  });

  it('🚨 it appears at install_scheduled — which it never did', async () => {
    // The gate tested the micro-stage name `install_scheduled` against a
    // `HomeownerStage`, which it can never equal, so the card only ever showed at
    // `completed`. A homeowner whose install date is confirmed is the single most
    // referral-willing person in the pipeline.
    await renderPortal(dashboardPayload({
      projects: [{
        id: PROJECT_ID, name: 'x', address: null, system_size_kw: SYSTEM_KW,
        homeowner_stage: 'installation',
        updated_at: '2026-09-01T12:00:00.000Z', created_at: '2026-08-01T12:00:00.000Z',
      }],
      microStages: [{
        project_id: PROJECT_ID, micro_stage: 'install_scheduled',
        created_at: '2026-09-01T12:00:00.000Z',
      }],
    }));
    expect(screen.getByText('Refer a Neighbor')).toBeInTheDocument();
  });

  it('and not before that', async () => {
    // The paired negative: the card is gated, not simply always on.
    await renderPortal(dashboardPayload({
      projects: [{
        id: PROJECT_ID, name: 'x', address: null, system_size_kw: SYSTEM_KW,
        homeowner_stage: 'installation',
        updated_at: '2026-09-01T12:00:00.000Z', created_at: '2026-08-01T12:00:00.000Z',
      }],
      microStages: [{
        project_id: PROJECT_ID, micro_stage: 'permit_submitted',
        created_at: '2026-09-01T12:00:00.000Z',
      }],
    }));
    expect(screen.queryByText('Refer a Neighbor')).not.toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. THE ADMIN "PORTAL PREVIEW"
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 the admin preview shows the words the customer is actually shown', () => {
  async function renderPreview(stage: string) {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: true,
      project: {
        id: PROJECT_ID, name: 'BRAIDON M PILLA — Solar',
        address: '3 Melvin Drive, Granite City, IL 62040',
        system_size_kw: SYSTEM_KW, homeowner_stage: stage,
        created_at: '2026-08-01T12:00:00.000Z', updated_at: '2026-09-01T12:00:00.000Z',
        client_name: 'Braidon Pilla', client_email: 'braidon@e.st',
      },
      stageHistory: [],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    const { default: Preview } = await import('@/app/admin/projects/[id]/portal-preview/page');
    render(<Preview />);
    await waitFor(() => expect(screen.queryByText(/Loading preview/)).not.toBeInTheDocument());
  }

  it.each(['under_review', 'site_survey', 'installation', 'completed'] as const)(
    'at %s it renders the portal\'s own headline, body and next step',
    async (stage) => {
      await renderPreview(stage);
      const c = STAGE_CONTENT[stage];
      expect(screen.getByText(c.headline)).toBeInTheDocument();
      expect(screen.getByText(c.body)).toBeInTheDocument();
      if (c.next) expect(screen.getByText(c.next)).toBeInTheDocument();
      expect(screen.getByText(c.action)).toBeInTheDocument();
      // The step label is derived from the same table, so "Step 3 of 7" cannot
      // drift from the roadmap the customer sees.
      expect(bodyText()).toContain(`Step ${c.stepNum} of 7`);
      expect(bodyText()).toContain(c.roadmapLabel);
    },
  );

  it('and it no longer claims to be exactly what the customer sees', async () => {
    // It was not: no proposal link, no upload prompt, no documents, no install
    // date. Dropping the claim is the honest half of this repair — the page still
    // does not render those components.
    await renderPreview('installation');
    expect(bodyText(), 'a claim the page cannot honour is back').not.toContain('exactly what');
    expect(bodyText()).toContain('Admin Preview');
  });
});
