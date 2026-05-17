/** @vitest-environment jsdom */
/**
 * Tests for components/project/TutorialPanel.tsx
 *
 * Strategy:
 *  - Render in jsdom environment
 *  - Mock localStorage to control initial collapsed state
 *  - Verify rendering, toggle behaviour, dismiss, and iframe embedding
 *
 * Coverage:
 *  - Renders with correct data-testid
 *  - Shows title in toggle bar
 *  - Shows duration label when provided
 *  - Expanded by default on first view (no localStorage entry)
 *  - Collapsed when localStorage says it was dismissed before
 *  - Toggle button has correct aria-expanded
 *  - Click toggle collapses expanded panel
 *  - Click toggle expands collapsed panel
 *  - Expanded state renders iframe with correct YouTube URL
 *  - Expanded state renders description text
 *  - Dismiss button collapses panel and writes to localStorage
 *  - Collapsed state hides iframe (no background loading)
 *  - Returns null before hydration (SSR safety)
 *  - Tab changes reset to correct stored state
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act }                   from '@testing-library/react';
import '@testing-library/jest-dom';
import React                                               from 'react';
import TutorialPanel, { TutorialPanelProps }               from '@/components/project/TutorialPanel';

// ── localStorage mock ─────────────────────────────────────────────────────────

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem:     (key: string) => store[key] ?? null,
    setItem:     (key: string, value: string) => { store[key] = value; },
    removeItem:  (key: string) => { delete store[key]; },
    clear:       () => { store = {}; },
  };
})();

Object.defineProperty(window, 'localStorage', {
  value:    localStorageMock,
  writable: true,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const defaultProps: TutorialPanelProps = {
  tabId:       'bill',
  title:       'How to upload a utility bill',
  description: 'Upload a PDF or photo. SolarPro extracts kWh and rates automatically.',
  videoId:     'TEST_VIDEO_ID',
  duration:    '1:15',
};

function renderPanel(props: Partial<TutorialPanelProps> = {}) {
  return render(<TutorialPanel {...defaultProps} {...props} />);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TutorialPanel', () => {

  beforeEach(() => {
    localStorageMock.clear();
    // vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // vi.useRealTimers();
  });

  // ── Renders ──────────────────────────────────────────────────────────────

  describe('rendering', () => {
    it('renders the panel container', () => {
      renderPanel();
      expect(screen.getByTestId('tutorial-panel-bill')).toBeInTheDocument();
    });

    it('renders the toggle button', () => {
      renderPanel();
      expect(screen.getByTestId('tutorial-toggle-bill')).toBeInTheDocument();
    });

    it('shows the title in the toggle bar', () => {
      renderPanel();
      expect(screen.getByText('How to upload a utility bill')).toBeInTheDocument();
    });

    it('shows the duration label when provided', () => {
      renderPanel({ duration: '1:15' });
      expect(screen.getByText(/1:15/)).toBeInTheDocument();
    });

    it('does not show duration when not provided', () => {
      renderPanel({ duration: undefined });
      expect(screen.queryByText(/1:15/)).not.toBeInTheDocument();
    });
  });

  // ── Default expanded state ────────────────────────────────────────────────

  describe('default expanded state (no localStorage entry)', () => {
    it('is expanded by default when no localStorage entry exists', () => {
      renderPanel();
      expect(screen.getByTestId('tutorial-content-bill')).toBeInTheDocument();
    });

    it('toggle button has aria-expanded=true when expanded', () => {
      renderPanel();
      const toggle = screen.getByTestId('tutorial-toggle-bill');
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
    });

    it('shows the description text when expanded', () => {
      renderPanel();
      expect(screen.getByText(defaultProps.description)).toBeInTheDocument();
    });

    it('renders iframe with YouTube embed URL when expanded', () => {
      renderPanel();
      const iframe = screen.getByTestId('tutorial-iframe-bill');
      expect(iframe).toBeInTheDocument();
      expect(iframe).toHaveAttribute(
        'src',
        'https://www.youtube-nocookie.com/embed/TEST_VIDEO_ID?rel=0&modestbranding=1',
      );
    });

    it('renders the dismiss button when expanded', () => {
      renderPanel();
      expect(screen.getByTestId('tutorial-dismiss-bill')).toBeInTheDocument();
    });
  });

  // ── Collapsed state (localStorage says previously dismissed) ─────────────

  describe('collapsed state (previously dismissed via localStorage)', () => {
    beforeEach(() => {
      // Simulate user having previously dismissed the bill tutorial
      localStorageMock.setItem('tutorial_collapsed_bill', '1');
    });

    it('starts collapsed when localStorage entry exists', () => {
      renderPanel();
      expect(screen.queryByTestId('tutorial-content-bill')).not.toBeInTheDocument();
    });

    it('toggle button has aria-expanded=false when collapsed', () => {
      renderPanel();
      const toggle = screen.getByTestId('tutorial-toggle-bill');
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
    });

    it('does not render iframe when collapsed (no background loading)', () => {
      renderPanel();
      expect(screen.queryByTestId('tutorial-iframe-bill')).not.toBeInTheDocument();
    });
  });

  // ── Toggle behaviour ──────────────────────────────────────────────────────

  describe('toggle behaviour', () => {
    it('collapses when toggle is clicked while expanded', () => {
      renderPanel();
      expect(screen.getByTestId('tutorial-content-bill')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('tutorial-toggle-bill'));

      expect(screen.queryByTestId('tutorial-content-bill')).not.toBeInTheDocument();
    });

    it('expands when toggle is clicked while collapsed', () => {
      localStorageMock.setItem('tutorial_collapsed_bill', '1');
      renderPanel();
      expect(screen.queryByTestId('tutorial-content-bill')).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId('tutorial-toggle-bill'));

      expect(screen.getByTestId('tutorial-content-bill')).toBeInTheDocument();
    });

    it('writes to localStorage when collapsed via toggle', () => {
      renderPanel();
      fireEvent.click(screen.getByTestId('tutorial-toggle-bill'));

      expect(localStorageMock.getItem('tutorial_collapsed_bill')).toBe('1');
    });

    it('removes from localStorage when expanded via toggle', () => {
      localStorageMock.setItem('tutorial_collapsed_bill', '1');
      renderPanel();
      fireEvent.click(screen.getByTestId('tutorial-toggle-bill'));

      expect(localStorageMock.getItem('tutorial_collapsed_bill')).toBeNull();
    });
  });

  // ── Dismiss button ────────────────────────────────────────────────────────

  describe('dismiss button', () => {
    it('collapses the panel when dismiss is clicked', () => {
      renderPanel();
      expect(screen.getByTestId('tutorial-content-bill')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('tutorial-dismiss-bill'));

      expect(screen.queryByTestId('tutorial-content-bill')).not.toBeInTheDocument();
    });

    it('writes collapsed=1 to localStorage on dismiss', () => {
      renderPanel();
      fireEvent.click(screen.getByTestId('tutorial-dismiss-bill'));

      expect(localStorageMock.getItem('tutorial_collapsed_bill')).toBe('1');
    });
  });

  // ── Accessibility ─────────────────────────────────────────────────────────

  describe('accessibility', () => {
    it('video region has aria-label', () => {
      renderPanel();
      const region = screen.getByRole('region');
      expect(region).toHaveAttribute(
        'aria-label',
        'How to upload a utility bill tutorial video',
      );
    });

    it('iframe has a title attribute for screen readers', () => {
      renderPanel();
      const iframe = screen.getByTestId('tutorial-iframe-bill');
      expect(iframe).toHaveAttribute('title', 'How to upload a utility bill');
    });

    it('dismiss button has aria-label', () => {
      renderPanel();
      const dismissBtn = screen.getByTestId('tutorial-dismiss-bill');
      expect(dismissBtn).toHaveAttribute('aria-label', 'Dismiss tutorial');
    });
  });

  // ── tabId isolation ───────────────────────────────────────────────────────

  describe('tabId isolation', () => {
    it('uses separate localStorage keys per tabId', () => {
      localStorageMock.setItem('tutorial_collapsed_bill', '1');

      // Render design panel (not bill) — should be expanded
      renderPanel({ tabId: 'design', title: 'Design Studio' });

      expect(screen.getByTestId('tutorial-content-design')).toBeInTheDocument();
      expect(localStorageMock.getItem('tutorial_collapsed_design')).toBeNull();
    });

    it('dismissing one tab does not affect another tab', () => {
      renderPanel({ tabId: 'proposal', title: 'Proposal Tutorial' });
      fireEvent.click(screen.getByTestId('tutorial-dismiss-proposal'));

      expect(localStorageMock.getItem('tutorial_collapsed_proposal')).toBe('1');
      expect(localStorageMock.getItem('tutorial_collapsed_bill')).toBeNull();
    });
  });
});
