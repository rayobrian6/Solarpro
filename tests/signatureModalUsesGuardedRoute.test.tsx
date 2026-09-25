/** @vitest-environment jsdom */
/**
 * tests/signatureModalUsesGuardedRoute.test.tsx
 *
 * THE SAFE SIGNING PATH WAS DEAD CODE AND THE UNGUARDED ONE WAS LIVE.
 *
 * Two signing implementations shipped. POST /api/proposals/[id]/sign checks
 * `signed_at || status === 'accepted'` and answers 409 — but its only
 * component, components/proposals/SignatureBlock.tsx, had zero callers.
 * The homeowner's actual signing UI is components/SignatureModal.tsx, rendered
 * by app/proposals/view/[id]/page.tsx, and it submitted to the endpoint that
 * had no idempotency check whatsoever.
 *
 * This suite pins the modal to the guarded endpoint, and pins the 409 to
 * something the homeowner can read. Guarding the old endpoint server-side is
 * covered by tests/proposalIssuedArtifactImmutability.test.ts — both halves are
 * needed, because a client that points somewhere safer does not close an
 * endpoint that anyone holding the share link can still call directly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

// ── Canvas mock (jsdom implements no 2D context) ────────────────────────────

const ctxMock = {
  fillStyle: '', strokeStyle: '', lineWidth: 0, lineCap: '', lineJoin: '',
  textBaseline: '', font: '',
  fillRect: vi.fn(), clearRect: vi.fn(), beginPath: vi.fn(),
  moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), fillText: vi.fn(),
};
vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctxMock as never);
vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,mock');

import SignatureModal from '@/components/SignatureModal';

// ── Helpers ─────────────────────────────────────────────────────────────────

const PROPOSAL_ID = 'prop-abc-123';
const TOKEN       = 'share-token-xyz';

function renderModal(props: Record<string, unknown> = {}) {
  return render(
    <SignatureModal
      proposalId={PROPOSAL_ID}
      proposalTitle="Test Solar Proposal"
      token={TOKEN}
      onSuccess={vi.fn()}
      onClose={vi.fn()}
      {...props}
    />,
  );
}

/** Fill the name and produce a typed signature, then submit. */
async function signAs(name: string) {
  fireEvent.change(screen.getByPlaceholderText(/your full legal name/i), {
    target: { value: name },
  });
  fireEvent.click(screen.getByText('Type'));
  fireEvent.change(screen.getByPlaceholderText(name), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: /sign & accept proposal/i }));
}

function lastFetch() {
  const calls = vi.mocked(global.fetch).mock.calls;
  return calls[calls.length - 1];
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('SignatureModal submits to the guarded signing endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok:     true,
      status: 200,
      json:   async () => ({ success: true, signerName: 'Jane Homeowner', signedAt: '2026-09-25T00:00:00Z' }),
    } as Response);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('POSTs to the dedicated sign endpoint, not the general proposal PATCH', async () => {
    renderModal();
    await signAs('Jane Homeowner');
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    const [url, init] = lastFetch() as [string, RequestInit];
    expect(url).toContain(`/api/proposals/${PROPOSAL_ID}/sign`);
    expect(init.method).toBe('POST');
  });

  it('carries the share token and the terms agreement the guarded route requires', async () => {
    renderModal();
    await signAs('Jane Homeowner');
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    const [, init] = lastFetch() as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.token).toBe(TOKEN);
    expect(body.agreedToTerms).toBe(true);
    expect(body.signerName).toBe('Jane Homeowner');
    expect(String(body.signature)).toMatch(/^data:image\//);
  });

  it('shows the homeowner a plain explanation when the route answers 409', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok:     false,
      status: 409,
      json:   async () => ({ success: false, error: 'Proposal has already been signed.' }),
    } as Response);

    renderModal();
    await signAs('Mallory Attacker');

    expect(await screen.findByText(/already been signed/i)).toBeInTheDocument();
  });

  it('does not report success to the page when the signature was refused', async () => {
    const onSuccess = vi.fn();
    vi.mocked(global.fetch).mockResolvedValue({
      ok:     false,
      status: 409,
      json:   async () => ({ success: false, error: 'Proposal has already been signed.' }),
    } as Response);

    renderModal({ onSuccess });
    await signAs('Mallory Attacker');

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('reports success to the page on a first signature', async () => {
    const onSuccess = vi.fn();
    renderModal({ onSuccess });
    await signAs('Jane Homeowner');

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('Jane Homeowner'));
  });
});
