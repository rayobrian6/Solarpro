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
 *  - COLLAPSED by default on first view (no localStorage entry) ← new behaviour
 *  - Expands when localStorage has '0' (user previously opened it)
 *  - Collapsed when localStorage has '1' (previously dismissed)
 *  - Toggle button has correct aria-expanded
 *  - Click toggle expands collapsed panel
 *  - Click toggle collapses expanded panel
 *  - Expanded state renders iframe with correct YouTube URL
 *  - Expanded state renders description text
 *  - Dismiss button collapses panel and writes '1' to localStorage
 *  - Collapsed state hides iframe (no background loading)
 *  - Tab changes reset to correct stored state
 *  - Separate localStorage keys per tabId
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act }                   from '@testing-library/react';
import '@testing-library/jest-dom';
import React                                               from 'react';
import TutorialPanel, { TutorialPanelProps }               from '@/components/project/TutorialPanel';

// ── localStorage mock ────────────────────────────────────────────────────────

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

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// ── Tests ────────────────────────────────────────────────────────────────────

describe('TutorialPanel', () => {

  beforeEach(() => {
    localStorageMock.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  // ── Default COLLAPSED state (no localStorage entry) ──────────────────────
  //
  // NEW BEHAVIOUR: The panel starts collapsed on first view.
  // It only auto-expands if the user previously opened it (localStorage = '0').

  describe('default collapsed state (no localStorage entry)', () => {
    it('is COLLAPSED by default when no localStorage entry exists', () => {
      renderPanel();
      expect(screen.queryByTestId('tutorial-content-bill')).not.toBeInTheDocument();
    });

    it('toggle button has aria-expanded=false when collapsed by default', () => {
      renderPanel();
      const toggle = screen.getByTestId('tutorial-toggle-bill');
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
    });

    it('does not render description text when collapsed', () => {
      renderPanel();
      expect(screen.queryByText(defaultProps.description)).not.toBeInTheDocument();
    });

    it('does not render iframe when collapsed (no background loading)', () => {
      renderPanel();
      expect(screen.queryByTestId('tutorial-iframe-bill')).not.toBeInTheDocument();
    });

    it('does not render the dismiss button when collapsed', () => {
      renderPanel();
      expect(screen.queryByTestId('tutorial-dismiss-bill')).not.toBeInTheDocument();
    });
  });

  // ── Auto-expand state (localStorage = '0', user previously opened it) ────

  describe('auto-expanded state (localStorage = "0" — user previously opened)', () => {
    beforeEach(() => {
      localStorageMock.setItem('tutorial_collapsed_bill', '0');
    });

    it('is expanded when localStorage entry is "0"', () => {
      renderPanel();
      expect(screen.getByTestId('tutorial-content-bill')).toBeInTheDocument();
    });

    it('toggle button has aria-expanded=true when auto-expanded', () => {
      renderPanel();
      const toggle = screen.getByTestId('tutorial-toggle-bill');
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
    });

    it('shows the description text when auto-expanded', () => {
      renderPanel();
      expect(screen.getByText(defaultProps.description)).toBeInTheDocument();
    });

    it('renders iframe with YouTube embed URL when auto-expanded', () => {
      renderPanel();
      const iframe = screen.getByTestId('tutorial-iframe-bill');
      expect(iframe).toBeInTheDocument();
      expect(iframe).toHaveAttribute(
        'src',
        'https://www.youtube-nocookie.com/embed/TEST_VIDEO_ID?rel=0&modestbranding=1',
      );
    });

    it('renders the dismiss button when auto-expanded', () => {
      renderPanel();
      expect(screen.getByTestId('tutorial-dismiss-bill')).toBeInTheDocument();
    });
  });

  // ── Collapsed state (localStorage = '1', previously dismissed) ───────────

  describe('collapsed state (localStorage = "1" — previously dismissed)', () => {
    beforeEach(() => {
      localStorageMock.setItem('tutorial_collapsed_bill', '1');
    });

    it('starts collapsed when localStorage entry is "1"', () => {
      renderPanel();
      expect(screen.queryByTestId('tutorial-content-bill')).not.toBeInTheDocument();
    });

    it('toggle button has aria-expanded=false when dismissed', () => {
      renderPanel();
      const toggle = screen.getByTestId('tutorial-toggle-bill');
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
    });

    it('does not render iframe when dismissed (no background loading)', () => {
      renderPanel();
      expect(screen.queryByTestId('tutorial-iframe-bill')).not.toBeInTheDocument();
    });
  });

  // ── Toggle behaviour ──────────────────────────────────────────────────────

  describe('toggle behaviour', () => {
    it('expands when toggle is clicked while collapsed (default state)', () => {
      renderPanel();
      expect(screen.queryByTestId('tutorial-content-bill')).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId('tutorial-toggle-bill'));

      expect(screen.getByTestId('tutorial-content-bill')).toBeInTheDocument();
    });

    it('collapses when toggle is clicked while expanded', () => {
      localStorageMock.setItem('tutorial_collapsed_bill', '0');
      renderPanel();
      expect(screen.getByTestId('tutorial-content-bill')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('tutorial-toggle-bill'));

      expect(screen.queryByTestId('tutorial-content-bill')).not.toBeInTheDocument();
    });

    it('writes "1" to localStorage when collapsed via toggle', () => {
      localStorageMock.setItem('tutorial_collapsed_bill', '0');
      renderPanel();
      fireEvent.click(screen.getByTestId('tutorial-toggle-bill'));

      expect(localStorageMock.getItem('tutorial_collapsed_bill')).toBe('1');
    });

    it('writes "0" to localStorage when expanded via toggle', () => {
      renderPanel();
      fireEvent.click(screen.getByTestId('tutorial-toggle-bill'));

      // '0' means "user has opened it" — persist so it auto-expands next time
      expect(localStorageMock.getItem('tutorial_collapsed_bill')).toBe('0');
    });

    it('toggle can expand then collapse repeatedly', () => {
      renderPanel();

      // expand
      fireEvent.click(screen.getByTestId('tutorial-toggle-bill'));
      expect(screen.getByTestId('tutorial-content-bill')).toBeInTheDocument();

      // collapse
      fireEvent.click(screen.getByTestId('tutorial-toggle-bill'));
      expect(screen.queryByTestId('tutorial-content-bill')).not.toBeInTheDocument();
    });
  });

  // ── Dismiss button ────────────────────────────────────────────────────────

  describe('dismiss button', () => {
    it('collapses the panel when dismiss is clicked (panel was open)', () => {
      // First open the panel, then dismiss
      localStorageMock.setItem('tutorial_collapsed_bill', '0');
      renderPanel();
      expect(screen.getByTestId('tutorial-content-bill')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('tutorial-dismiss-bill'));

      expect(screen.queryByTestId('tutorial-content-bill')).not.toBeInTheDocument();
    });

    it('writes "1" to localStorage on dismiss', () => {
      localStorageMock.setItem('tutorial_collapsed_bill', '0');
      renderPanel();
      fireEvent.click(screen.getByTestId('tutorial-dismiss-bill'));

      expect(localStorageMock.getItem('tutorial_collapsed_bill')).toBe('1');
    });
  });

  // ── Accessibility ─────────────────────────────────────────────────────────

  describe('accessibility', () => {
    it('video region has aria-label when expanded', () => {
      localStorageMock.setItem('tutorial_collapsed_bill', '0');
      renderPanel();
      const region = screen.getByRole('region');
      expect(region).toHaveAttribute(
        'aria-label',
        'How to upload a utility bill tutorial video',
      );
    });

    it('iframe has a title attribute for screen readers when expanded', () => {
      localStorageMock.setItem('tutorial_collapsed_bill', '0');
      renderPanel();
      const iframe = screen.getByTestId('tutorial-iframe-bill');
      expect(iframe).toHaveAttribute('title', 'How to upload a utility bill');
    });

    it('dismiss button has aria-label when expanded', () => {
      localStorageMock.setItem('tutorial_collapsed_bill', '0');
      renderPanel();
      const dismissBtn = screen.getByTestId('tutorial-dismiss-bill');
      expect(dismissBtn).toHaveAttribute('aria-label', 'Dismiss tutorial');
    });
  });

  // ── tabId isolation ───────────────────────────────────────────────────────

  describe('tabId isolation', () => {
    it('uses separate localStorage keys per tabId', () => {
      // bill tab is dismissed
      localStorageMock.setItem('tutorial_collapsed_bill', '1');

      // design tab has never been opened — should be collapsed (not affected by bill)
      renderPanel({ tabId: 'design', title: 'Design Studio' });

      expect(screen.queryByTestId('tutorial-content-design')).not.toBeInTheDocument();
      expect(localStorageMock.getItem('tutorial_collapsed_design')).toBeNull();
    });

    it('dismissing one tab does not affect another tab', () => {
      localStorageMock.setItem('tutorial_collapsed_proposal', '0');
      renderPanel({ tabId: 'proposal', title: 'Proposal Tutorial' });
      fireEvent.click(screen.getByTestId('tutorial-dismiss-proposal'));

      expect(localStorageMock.getItem('tutorial_collapsed_proposal')).toBe('1');
      expect(localStorageMock.getItem('tutorial_collapsed_bill')).toBeNull();
    });

    it('a tab with "0" in storage expands while another tab with null stays collapsed', () => {
      localStorageMock.setItem('tutorial_collapsed_design', '0');
      // bill tab has no entry
      const { unmount } = renderPanel({ tabId: 'design', title: 'Design Studio' });
      expect(screen.getByTestId('tutorial-content-design')).toBeInTheDocument();
      unmount();

      renderPanel({ tabId: 'bill', title: 'Bill Tutorial' });
      expect(screen.queryByTestId('tutorial-content-bill')).not.toBeInTheDocument();
    });
  });
});
