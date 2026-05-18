/** @vitest-environment jsdom */
/**
 * Tests for components/proposals/SignatureBlock.tsx
 *
 * Strategy:
 *  - Render in jsdom environment
 *  - Use @testing-library/react + userEvent
 *  - Mock fetch to control API responses
 *  - Mock canvas APIs (jsdom doesn't implement getContext)
 *
 * Coverage:
 *  - Renders idle state with correct elements
 *  - Name input updates state (enables/disables submit)
 *  - Mode toggle between draw and type
 *  - Agree checkbox enables submit
 *  - Submit disabled until valid
 *  - Submit POSTs to correct endpoint
 *  - Shows signed confirmation on success
 *  - Shows error message on API failure
 *  - Shows error on network failure
 *  - 409 already-signed shows correct message
 *  - onSuccess callback is called with signerName
 *  - Clear canvas button is present in draw mode
 *  - Typed sig input visible in type mode
 *  - ESIGN Act legal text is present
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor }               from '@testing-library/react';
import userEvent                                            from '@testing-library/user-event';
import '@testing-library/jest-dom';
import React                                               from 'react';

// ── Canvas mock ──────────────────────────────────────────────────────────────
// jsdom doesn't implement canvas 2D context; we mock getContext globally.

const ctxMock = {
  fillStyle:    '',
  strokeStyle:  '',
  lineWidth:    0,
  lineCap:      '',
  lineJoin:     '',
  textBaseline: '',
  font:         '',
  fillRect:     vi.fn(),
  strokeRect:   vi.fn(),
  clearRect:    vi.fn(),
  beginPath:    vi.fn(),
  moveTo:       vi.fn(),
  lineTo:       vi.fn(),
  stroke:       vi.fn(),
  fillText:     vi.fn(),
  toDataURL:    vi.fn(() => 'data:image/png;base64,mock'),
};

// Patch HTMLCanvasElement.prototype.getContext globally
vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctxMock as never);
// Patch toDataURL at the prototype level too
vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,mock');

// ── Component import ─────────────────────────────────────────────────────────

import SignatureBlock from '@/components/proposals/SignatureBlock';

// ── Helpers ──────────────────────────────────────────────────────────────────

const defaultProps = {
  proposalId:    'prop-test-123',
  proposalTitle: 'Test Solar Proposal',
  token:         null,
  onSuccess:     vi.fn(),
};

function renderBlock(props = {}) {
  return render(<SignatureBlock {...defaultProps} {...props} />);
}

/** Fill name, check agree box — minimum to enable submit button */
async function fillMinimumValid(user: ReturnType<typeof userEvent.setup>) {
  const nameInput = screen.getByTestId('signer-name-input');
  await user.clear(nameInput);
  await user.type(nameInput, 'Alice Smith');
  const checkbox = screen.getByTestId('agree-checkbox');
  await user.click(checkbox);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SignatureBlock', () => {
  const user = userEvent.setup();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok:   true,
      json: async () => ({ success: true, signerName: 'Alice Smith', signedAt: new Date().toISOString() }),
    } as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Renders idle state ───────────────────────────────────────────────────

  describe('idle state rendering', () => {
    it('renders the signature block container', () => {
      renderBlock();
      expect(screen.getByTestId('signature-block')).toBeInTheDocument();
    });

    it('shows proposal title in header', () => {
      renderBlock();
      expect(screen.getByText('Test Solar Proposal')).toBeInTheDocument();
    });

    it('shows "Sign & Accept Proposal" heading', () => {
      renderBlock();
      // Both the h3 and the button contain this text; query by heading role
      expect(screen.getByRole('heading', { name: /sign & accept proposal/i })).toBeInTheDocument();
    });

    it('renders name input', () => {
      renderBlock();
      expect(screen.getByTestId('signer-name-input')).toBeInTheDocument();
    });

    it('renders email input', () => {
      renderBlock();
      expect(screen.getByTestId('signer-email-input')).toBeInTheDocument();
    });

    it('renders Draw and Type mode buttons', () => {
      renderBlock();
      expect(screen.getByTestId('mode-btn-draw')).toBeInTheDocument();
      expect(screen.getByTestId('mode-btn-type')).toBeInTheDocument();
    });

    it('shows canvas in draw mode by default', () => {
      renderBlock();
      expect(screen.getByTestId('signature-canvas')).toBeInTheDocument();
    });

    it('renders agree checkbox', () => {
      renderBlock();
      expect(screen.getByTestId('agree-checkbox')).toBeInTheDocument();
    });

    it('renders submit button', () => {
      renderBlock();
      expect(screen.getByTestId('sign-submit-btn')).toBeInTheDocument();
    });

    it('submit button is disabled initially', () => {
      renderBlock();
      expect(screen.getByTestId('sign-submit-btn')).toBeDisabled();
    });

    it('contains ESIGN Act legal text', () => {
      renderBlock();
      expect(screen.getByText(/ESIGN Act/i)).toBeInTheDocument();
    });

    it('contains UETA legal text', () => {
      renderBlock();
      expect(screen.getByText(/UETA/i)).toBeInTheDocument();
    });
  });

  // ── Name input ────────────────────────────────────────────────────────────

  describe('name input', () => {
    it('updates when user types', async () => {
      renderBlock();
      const input = screen.getByTestId('signer-name-input') as HTMLInputElement;
      await user.type(input, 'Bob Jones');
      expect(input.value).toBe('Bob Jones');
    });

    it('submit remains disabled with only name (no agree)', async () => {
      renderBlock();
      const input = screen.getByTestId('signer-name-input');
      await user.type(input, 'Bob Jones');
      expect(screen.getByTestId('sign-submit-btn')).toBeDisabled();
    });
  });

  // ── Mode toggle ───────────────────────────────────────────────────────────

  describe('mode toggle', () => {
    it('switches to type mode when Type button is clicked', async () => {
      renderBlock();
      await user.click(screen.getByTestId('mode-btn-type'));
      expect(screen.getByTestId('typed-sig-input')).toBeInTheDocument();
      expect(screen.queryByTestId('signature-canvas')).not.toBeInTheDocument();
    });

    it('switches back to draw mode when Draw button is clicked', async () => {
      renderBlock();
      await user.click(screen.getByTestId('mode-btn-type'));
      await user.click(screen.getByTestId('mode-btn-draw'));
      expect(screen.getByTestId('signature-canvas')).toBeInTheDocument();
      expect(screen.queryByTestId('typed-sig-input')).not.toBeInTheDocument();
    });

    it('shows clear canvas button in draw mode', () => {
      renderBlock();
      expect(screen.getByTestId('clear-canvas-btn')).toBeInTheDocument();
    });

    it('does not show clear canvas button in type mode', async () => {
      renderBlock();
      await user.click(screen.getByTestId('mode-btn-type'));
      expect(screen.queryByTestId('clear-canvas-btn')).not.toBeInTheDocument();
    });

    it('typed sig input is visible in type mode', async () => {
      renderBlock();
      await user.click(screen.getByTestId('mode-btn-type'));
      expect(screen.getByTestId('typed-sig-input')).toBeVisible();
    });
  });

  // ── Agree checkbox ────────────────────────────────────────────────────────

  describe('agree checkbox', () => {
    it('unchecked by default', () => {
      renderBlock();
      const cb = screen.getByTestId('agree-checkbox') as HTMLInputElement;
      expect(cb.checked).toBe(false);
    });

    it('toggles to checked when clicked', async () => {
      renderBlock();
      const cb = screen.getByTestId('agree-checkbox') as HTMLInputElement;
      await user.click(cb);
      expect(cb.checked).toBe(true);
    });
  });

  // ── Submit enablement ─────────────────────────────────────────────────────

  describe('submit button enablement', () => {
    it('remains disabled without name', async () => {
      renderBlock();
      const cb = screen.getByTestId('agree-checkbox');
      await user.click(cb);
      // In draw mode, also need hasDrawn. Without name, still disabled.
      expect(screen.getByTestId('sign-submit-btn')).toBeDisabled();
    });

    it('is enabled in type mode with name + agree (no drawing required)', async () => {
      renderBlock();
      await user.click(screen.getByTestId('mode-btn-type'));
      const nameInput = screen.getByTestId('signer-name-input');
      await user.type(nameInput, 'Alice Smith');
      await user.click(screen.getByTestId('agree-checkbox'));
      // In type mode, signerName serves as typed signature → canSubmit = true
      expect(screen.getByTestId('sign-submit-btn')).not.toBeDisabled();
    });
  });

  // ── Form submission ───────────────────────────────────────────────────────

  describe('form submission', () => {
    it('POSTs to the correct API endpoint', async () => {
      renderBlock();
      await user.click(screen.getByTestId('mode-btn-type'));
      await fillMinimumValid(user);

      await user.click(screen.getByTestId('sign-submit-btn'));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/proposals/prop-test-123/sign',
          expect.objectContaining({ method: 'POST' }),
        );
      });
    });

    it('includes signerName and agreedToTerms=true in POST body', async () => {
      renderBlock();
      await user.click(screen.getByTestId('mode-btn-type'));
      await fillMinimumValid(user);

      await user.click(screen.getByTestId('sign-submit-btn'));

      await waitFor(() => {
        const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
        const body = JSON.parse(init.body as string) as Record<string, unknown>;
        expect(body.signerName).toBe('Alice Smith');
        expect(body.agreedToTerms).toBe(true);
      });
    });

    it('includes token in POST body when token prop is provided', async () => {
      renderBlock({ token: 'my-share-token' });
      await user.click(screen.getByTestId('mode-btn-type'));
      await fillMinimumValid(user);

      await user.click(screen.getByTestId('sign-submit-btn'));

      await waitFor(() => {
        const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
        const body = JSON.parse(init.body as string) as Record<string, unknown>;
        expect(body.token).toBe('my-share-token');
      });
    });
  });

  // ── Success state ─────────────────────────────────────────────────────────

  describe('success state', () => {
    it('shows signed confirmation after successful submission', async () => {
      renderBlock();
      await user.click(screen.getByTestId('mode-btn-type'));
      await fillMinimumValid(user);

      await user.click(screen.getByTestId('sign-submit-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('signature-block-signed')).toBeInTheDocument();
      });
    });

    it('shows "Proposal Signed & Accepted" in confirmation', async () => {
      renderBlock();
      await user.click(screen.getByTestId('mode-btn-type'));
      await fillMinimumValid(user);

      await user.click(screen.getByTestId('sign-submit-btn'));

      await waitFor(() => {
        expect(screen.getByText(/Proposal Signed & Accepted/i)).toBeInTheDocument();
      });
    });

    it('calls onSuccess with signerName', async () => {
      const onSuccess = vi.fn();
      renderBlock({ onSuccess });
      await user.click(screen.getByTestId('mode-btn-type'));
      await fillMinimumValid(user);

      await user.click(screen.getByTestId('sign-submit-btn'));

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalledWith('Alice Smith');
      });
    });

    it('hides the signature form after successful submission', async () => {
      renderBlock();
      await user.click(screen.getByTestId('mode-btn-type'));
      await fillMinimumValid(user);

      await user.click(screen.getByTestId('sign-submit-btn'));

      await waitFor(() => {
        expect(screen.queryByTestId('signature-block')).not.toBeInTheDocument();
      });
    });
  });

  // ── Error state ───────────────────────────────────────────────────────────

  describe('error state', () => {
    it('shows error message when API returns non-ok', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok:   false,
        json: async () => ({ success: false, error: 'Signature submission failed. Please try again.' }),
      } as Response);

      renderBlock();
      await user.click(screen.getByTestId('mode-btn-type'));
      await fillMinimumValid(user);

      await user.click(screen.getByTestId('sign-submit-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('signature-error')).toBeInTheDocument();
      });
    });

    it('shows specific error text from API response', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok:   false,
        json: async () => ({ success: false, error: 'Proposal has already been signed.' }),
      } as Response);

      renderBlock();
      await user.click(screen.getByTestId('mode-btn-type'));
      await fillMinimumValid(user);

      await user.click(screen.getByTestId('sign-submit-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('signature-error')).toHaveTextContent(
          /already been signed/i,
        );
      });
    });

    it('shows network error message when fetch throws', async () => {
      vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));

      renderBlock();
      await user.click(screen.getByTestId('mode-btn-type'));
      await fillMinimumValid(user);

      await user.click(screen.getByTestId('sign-submit-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('signature-error')).toBeInTheDocument();
        expect(screen.getByTestId('signature-error')).toHaveTextContent(
          /network error/i,
        );
      });
    });

    it('does not call onSuccess on error', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok:   false,
        json: async () => ({ success: false, error: 'Server error' }),
      } as Response);

      const onSuccess = vi.fn();
      renderBlock({ onSuccess });
      await user.click(screen.getByTestId('mode-btn-type'));
      await fillMinimumValid(user);

      await user.click(screen.getByTestId('sign-submit-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('signature-error')).toBeInTheDocument();
      });
      expect(onSuccess).not.toHaveBeenCalled();
    });
  });
});
