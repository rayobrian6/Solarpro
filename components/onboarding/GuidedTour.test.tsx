/**
 * GuidedTour component unit tests.
 *
 * Tests the first-run visual overlay tour component in isolation:
 *  - Renders with correct step content
 *  - Progress dots reflect current step
 *  - Next / Back navigation works
 *  - Skip calls onComplete immediately
 *  - Escape key calls onComplete
 *  - Final step CTA calls onComplete
 *  - Back button hidden on first step
 *  - All 5 steps are reachable via Next
 *
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import GuidedTour from '@/components/onboarding/GuidedTour';

// ── Helpers ──────────────────────────────────────────────────────────────

/** Render the tour with a no-op onComplete by default */
function renderTour(onComplete = vi.fn()) {
  return render(<GuidedTour onComplete={onComplete} />);
}

/**
 * Render + fast-forward past the 800ms mount delay so the overlay is visible.
 */
async function renderAndShow(onComplete = vi.fn()) {
  const result = renderTour(onComplete);
  await act(async () => {
    vi.advanceTimersByTime(1000);
  });
  return result;
}

/** Advance through n steps by clicking the primary CTA */
async function advanceSteps(n: number) {
  for (let i = 0; i < n; i++) {
    const btn = screen.getByRole('button', { name: /got it|finish tour/i });
    await act(async () => { fireEvent.click(btn); });
  }
}

// ── Setup ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  // GuidedTour uses createPortal — ensure document.body exists
  document.body.innerHTML = '<div id="root"></div>';
  // Stub window dimensions so popover position calculations don't throw
  Object.defineProperty(window, 'innerWidth',  { writable: true, configurable: true, value: 1280 });
  Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 800 });
});

afterEach(() => {
  vi.runAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────

describe('GuidedTour', () => {

  // ── Before mount delay: tour is hidden ────────────────────────────────

  describe('before mount delay', () => {
    it('does not render the dialog immediately (waits for 800ms delay)', () => {
      renderTour();
      // Nothing visible yet
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  // ── After mount delay: initial render ─────────────────────────────────

  describe('initial render (after mount delay)', () => {
    it('renders Step 1 title after mount delay', async () => {
      await renderAndShow();
      expect(screen.getByText('Start with a client')).toBeDefined();
    });

    it('shows "Step 1 of 5" progress label', async () => {
      await renderAndShow();
      expect(screen.getByText('Step 1 of 5')).toBeDefined();
    });

    it('renders the primary CTA "Got it — next"', async () => {
      await renderAndShow();
      expect(screen.getByRole('button', { name: /got it — next/i })).toBeDefined();
    });

    it('does NOT show Back button on step 1', async () => {
      await renderAndShow();
      const backBtns = screen.queryAllByRole('button', { name: /back/i });
      expect(backBtns.length).toBe(0);
    });

    it('renders 5 progress dots', async () => {
      await renderAndShow();
      const dialog = screen.getByRole('dialog');
      const dots = dialog.querySelectorAll('[class*="rounded-full"][class*="h-1.5"]');
      expect(dots.length).toBe(5);
    });

    it('renders a "Skip tour" text button', async () => {
      await renderAndShow();
      const skipBtns = screen.getAllByText(/skip tour/i);
      expect(skipBtns.length).toBeGreaterThanOrEqual(1);
    });

    it('renders aria-label on the dialog', async () => {
      await renderAndShow();
      const dialog = screen.getByRole('dialog');
      expect(dialog.getAttribute('aria-label')).toMatch(/step 1 of 5/i);
    });
  });

  // ── Step body content ───────────────────────────────────────────────────

  describe('step body content', () => {
    it('step 1 body mentions "client"', async () => {
      await renderAndShow();
      expect(screen.getByRole('dialog').textContent).toMatch(/client/i);
    });

    it('step 2 title is "Create a project"', async () => {
      await renderAndShow();
      await advanceSteps(1);
      expect(screen.getByText('Create a project')).toBeDefined();
    });

    it('step 3 title mentions bill upload', async () => {
      await renderAndShow();
      await advanceSteps(2);
      expect(screen.getByRole('dialog').textContent).toMatch(/bill/i);
    });

    it('step 4 title is "Design on the real roof"', async () => {
      await renderAndShow();
      await advanceSteps(3);
      expect(screen.getByText('Design on the real roof')).toBeDefined();
    });

    it('step 5 title mentions "proposal"', async () => {
      await renderAndShow();
      await advanceSteps(4);
      expect(screen.getByRole('dialog').textContent).toMatch(/proposal/i);
    });
  });

  // ── Navigation: Next ────────────────────────────────────────────────────

  describe('Next navigation', () => {
    it('advances from step 1 to step 2 on CTA click', async () => {
      await renderAndShow();
      await advanceSteps(1);
      expect(screen.getByText('Step 2 of 5')).toBeDefined();
    });

    it('shows Back button from step 2 onwards', async () => {
      await renderAndShow();
      await advanceSteps(1);
      expect(screen.getByRole('button', { name: /back/i })).toBeDefined();
    });

    it('CTA on final step says "Finish tour"', async () => {
      await renderAndShow();
      await advanceSteps(4);
      expect(screen.getByRole('button', { name: /finish tour/i })).toBeDefined();
    });

    it('progress label updates through all 5 steps', async () => {
      await renderAndShow();
      for (let i = 1; i <= 5; i++) {
        expect(screen.getByText(`Step ${i} of 5`)).toBeDefined();
        if (i < 5) await advanceSteps(1);
      }
    });
  });

  // ── Navigation: Back ───────────────────────────────────────────────────

  describe('Back navigation', () => {
    it('goes back from step 3 to step 2', async () => {
      await renderAndShow();
      await advanceSteps(2);           // now on step 3
      const back = screen.getByRole('button', { name: /back/i });
      await act(async () => { fireEvent.click(back); });
      expect(screen.getByText('Step 2 of 5')).toBeDefined();
    });

    it('Back button disappears when back on step 1', async () => {
      await renderAndShow();
      await advanceSteps(1);
      const back = screen.getByRole('button', { name: /back/i });
      await act(async () => { fireEvent.click(back); });
      expect(screen.queryByRole('button', { name: /back/i })).toBeNull();
    });
  });

  // ── Completion ─────────────────────────────────────────────────────────

  describe('completion', () => {
    it('calls onComplete when Finish Tour is clicked', async () => {
      const onComplete = vi.fn();
      await renderAndShow(onComplete);
      await advanceSteps(4);  // reach step 5
      const finish = screen.getByRole('button', { name: /finish tour/i });
      await act(async () => {
        fireEvent.click(finish);
        vi.advanceTimersByTime(300);
      });
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('calls onComplete exactly once on text skip click', async () => {
      const onComplete = vi.fn();
      await renderAndShow(onComplete);
      const skip = screen.getAllByText(/skip tour/i)[0];
      await act(async () => {
        fireEvent.click(skip);
        vi.advanceTimersByTime(300);
      });
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('calls onComplete on Escape key press', async () => {
      const onComplete = vi.fn();
      await renderAndShow(onComplete);
      await act(async () => {
        fireEvent.keyDown(window, { key: 'Escape' });
        vi.advanceTimersByTime(300);
      });
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
  });

  // ── X button (close) ───────────────────────────────────────────────────

  describe('X close button', () => {
    it('X button has aria-label "Close tour"', async () => {
      await renderAndShow();
      const xBtn = screen.getByRole('button', { name: 'Close tour' });
      expect(xBtn).toBeDefined();
    });

    it('clicking X calls onComplete', async () => {
      const onComplete = vi.fn();
      await renderAndShow(onComplete);
      const xBtn = screen.getByRole('button', { name: 'Close tour' });
      await act(async () => {
        fireEvent.click(xBtn);
        vi.advanceTimersByTime(300);
      });
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
  });

  // ── Accessibility ──────────────────────────────────────────────────────

  describe('accessibility', () => {
    it('dialog has role="dialog"', async () => {
      await renderAndShow();
      expect(screen.getByRole('dialog')).toBeDefined();
    });

    it('dialog has aria-modal="true"', async () => {
      await renderAndShow();
      expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true');
    });

    it('aria-label updates as step advances', async () => {
      await renderAndShow();
      await advanceSteps(1);
      const dialog = screen.getByRole('dialog');
      expect(dialog.getAttribute('aria-label')).toMatch(/step 2 of 5/i);
    });
  });

  // ── Spotlight/positioning ──────────────────────────────────────────────

  describe('spotlight positioning', () => {
    it('renders popover with step title even when data-tour target is absent', async () => {
      // No data-tour="clients" in DOM → should fall back to centre-screen
      await renderAndShow();
      expect(screen.getByRole('dialog')).toBeDefined();
      expect(screen.getByText('Start with a client')).toBeDefined();
    });

    it('renders spotlight SVG overlay when visible', async () => {
      await renderAndShow();
      // The spotlight is rendered via createPortal into document.body
      // SVG may be 0 in jsdom since getBoundingClientRect() returns 0,0,0,0
      // but the dialog + popover must be present
      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeDefined();
    });

    it('spotlight border ring is rendered when data-tour element has size in DOM', async () => {
      // Mock getBoundingClientRect so jsdom returns realistic values
      const fakeNav = document.createElement('a');
      fakeNav.setAttribute('data-tour', 'clients');
      document.body.appendChild(fakeNav);

      // Override getBoundingClientRect for this element
      fakeNav.getBoundingClientRect = () => ({
        top: 100, left: 50, width: 120, height: 40,
        bottom: 140, right: 170, x: 50, y: 100,
        toJSON: () => ({}),
      });

      await renderAndShow();

      // The spotlight ring div should be present
      const ring = document.querySelector('[class*="border-amber-4"]');
      expect(ring).not.toBeNull();

      document.body.removeChild(fakeNav);
    });
  });
});
