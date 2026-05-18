/**
 * GuidedTourController unit tests.
 *
 * Tests the thin wrapper that:
 *  - Reads hasSeenTour from UserContext
 *  - Renders GuidedTour only when hasSeenTour === false
 *  - Does NOT render when user is loading
 *  - Does NOT render when user is null
 *  - Does NOT render when hasSeenTour === true
 *  - POSTs to /api/settings/onboarding-complete and calls refreshUser on complete
 *  - Guards against double-fire (race condition protection)
 *
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

// ── Mocks ─────────────────────────────────────────────────────────────────

// Mock UserContext
const mockUseUser = vi.fn();
vi.mock('@/contexts/UserContext', () => ({
  useUser: () => mockUseUser(),
}));

// Mock GuidedTour — we just want to know it was/wasn't rendered
vi.mock('@/components/onboarding/GuidedTour', () => ({
  default: ({ onComplete }: { onComplete: () => void }) => (
    <div data-testid="guided-tour">
      <button onClick={onComplete}>complete</button>
    </div>
  ),
}));

// Mock fetch
const mockFetch = vi.fn(() => Promise.resolve({ ok: true }));
global.fetch = mockFetch as unknown as typeof fetch;

import GuidedTourController from '@/components/onboarding/GuidedTourController';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeUser(overrides: Partial<{ hasSeenTour: boolean }> = {}) {
  return {
    id:                 'user-1',
    name:               'Ray Obrian',
    email:              'ray@example.com',
    role:               'user',
    plan:               'professional',
    subscriptionStatus: 'active',
    trialEndsAt:        null,
    isFreePass:         false,
    hasAccess:          true,
    hasSeenTour:        false,
    tourCompletedAt:    null,
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('GuidedTourController', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Rendering conditions ────────────────────────────────────────────────

  describe('rendering conditions', () => {
    it('renders GuidedTour when user.hasSeenTour is false', () => {
      mockUseUser.mockReturnValue({
        user:        makeUser({ hasSeenTour: false }),
        loading:     false,
        refreshUser: vi.fn(),
      });

      render(<GuidedTourController />);
      expect(screen.getByTestId('guided-tour')).toBeDefined();
    });

    it('does NOT render GuidedTour when user.hasSeenTour is true', () => {
      mockUseUser.mockReturnValue({
        user:        makeUser({ hasSeenTour: true }),
        loading:     false,
        refreshUser: vi.fn(),
      });

      render(<GuidedTourController />);
      expect(screen.queryByTestId('guided-tour')).toBeNull();
    });

    it('does NOT render while user is loading', () => {
      mockUseUser.mockReturnValue({
        user:        null,
        loading:     true,
        refreshUser: vi.fn(),
      });

      render(<GuidedTourController />);
      expect(screen.queryByTestId('guided-tour')).toBeNull();
    });

    it('does NOT render when user is null (not logged in)', () => {
      mockUseUser.mockReturnValue({
        user:        null,
        loading:     false,
        refreshUser: vi.fn(),
      });

      render(<GuidedTourController />);
      expect(screen.queryByTestId('guided-tour')).toBeNull();
    });
  });

  // ── onComplete handler ──────────────────────────────────────────────────

  describe('onComplete handler', () => {
    it('POSTs to /api/settings/onboarding-complete when tour completes', async () => {
      const refreshUser = vi.fn().mockResolvedValue(undefined);
      mockUseUser.mockReturnValue({
        user:    makeUser({ hasSeenTour: false }),
        loading: false,
        refreshUser,
      });

      render(<GuidedTourController />);

      const completeBtn = screen.getByRole('button', { name: /complete/i });
      await act(async () => { completeBtn.click(); });

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/settings/onboarding-complete',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('calls refreshUser after POST succeeds', async () => {
      const refreshUser = vi.fn().mockResolvedValue(undefined);
      mockUseUser.mockReturnValue({
        user:    makeUser({ hasSeenTour: false }),
        loading: false,
        refreshUser,
      });

      render(<GuidedTourController />);

      const completeBtn = screen.getByRole('button', { name: /complete/i });
      await act(async () => { completeBtn.click(); });

      expect(refreshUser).toHaveBeenCalledTimes(1);
    });

    it('guards against double-fire — fetch called exactly once even if handler fires twice', async () => {
      const refreshUser = vi.fn().mockResolvedValue(undefined);
      mockUseUser.mockReturnValue({
        user:    makeUser({ hasSeenTour: false }),
        loading: false,
        refreshUser,
      });

      render(<GuidedTourController />);

      const completeBtn = screen.getByRole('button', { name: /complete/i });
      await act(async () => {
        completeBtn.click();
        completeBtn.click();  // double-fire
      });

      // Guard ref should prevent second call
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('does not throw if fetch fails (non-critical)', async () => {
      mockFetch.mockRejectedValueOnce(new Error('network error'));
      const refreshUser = vi.fn().mockResolvedValue(undefined);
      mockUseUser.mockReturnValue({
        user:    makeUser({ hasSeenTour: false }),
        loading: false,
        refreshUser,
      });

      render(<GuidedTourController />);

      const completeBtn = screen.getByRole('button', { name: /complete/i });

      // Should not throw
      await act(async () => { completeBtn.click(); });
      // Test passes if no error was thrown
    });
  });
});
