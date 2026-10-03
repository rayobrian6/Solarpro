/** @vitest-environment jsdom */
// ═══════════════════════════════════════════════════════════════════════════
// 🚨 AUTO / GUIDED / MANUAL — THREE WAYS THROUGH ONE ENGINEERING STATE.
//
// Ray (System Config gauntlet): "Auto / Guided / Manual over the same owners." The interview's
// answers, sources and blockers are identical in every mode (they come from
// buildSystemConfigInterview, which takes no mode).
//
// REWRITTEN FOR V3, NOT DELETED (2026-10-03). This file used to render the five-card
// SystemConfigInterview and prove GUIDED opened only the card with the next question and marked it.
// Ray rejected that questionnaire ("Guided: a one-line strip … No separate layout."), so the same
// requirements are proved through what replaced it:
//   · GUIDED marks exactly ONE next question — the guided strip's single [Answer], the first item of
//     the one required queue, which [Answer] hands over to be revealed and asked.
//   · The release state does not depend on the mode — the readiness panel takes no mode, and the
//     strip and the panel count the same queue.
//   · The status never says COMPLETE while something is still to review.
//   · The page mounts the strip ONLY in guided mode, no questionnaire above the grid, and the
//     readiness panel UNDER the grid.
// ═══════════════════════════════════════════════════════════════════════════

import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { buildSystemConfigInterview } from '@/lib/electrical/systemConfigInterview';
import { requiredQueue, nextActionLabel } from '@/lib/electrical/systemConfigPlacement';
import { resolvePvArrayDesign } from '@/lib/electrical/pvArrayDesign';
import { answerServiceRating } from '@/lib/electrical/systemConfigAnswers';
import { evaluateServiceTopology, type ServiceTopology } from '@/lib/electrical/serviceTopology';
import { GuidedStrip } from '@/components/engineering/systemConfig/GuidedStrip';
import { EngineeringReadinessPanel } from '@/components/engineering/systemConfig/EngineeringReadinessPanel';
import { applyVia } from '@/components/engineering/systemConfig/ItemEditor';

afterEach(cleanup);

// A 200 A house with micros chosen: the service is recorded; the connection and the utility
// disconnect are still open questions.
const topology = (answerServiceRating(null, 200) as { topology: ServiceTopology }).topology;
const pvArray = resolvePvArrayDesign({ placedModuleCount: 20, selectedPanelId: 'panel-std440' });
const interview = buildSystemConfigInterview({
  pvArray, topology, coupling: null, couplingIsDecision: false, architectureConflict: false,
  equipment: { pvInverter: { state: 'SELECTED', label: 'Enphase IQ8M', kind: 'micro' }, storage: null, gateway: null },
  evaluation: evaluateServiceTopology(topology),
});

function renderPanel(iv = interview) {
  return render(
    <EngineeringReadinessPanel interview={iv} topology={topology} pvArray={pvArray} derivedStrings={[]}
      equipment={{ gatewayProductId: null, storageProductId: null, storageLabel: null, totalUnits: 0 }}
      busy={false} apply={applyVia(async () => true)} />,
  );
}

describe('the same engineering state, three ways through it', () => {
  it('fixture: the open questions are still asked, and the queue holds every one of them', () => {
    expect(interview.openQuestions.map(q => q.id)).toEqual(['behavior.interconnection', 'behavior.isolation']);
    const q = requiredQueue(interview).map(i => i.id);
    for (const open of interview.openQuestions) expect(q).toContain(open.id);
  });

  it('GUIDED marks exactly one next question — the first required one — and [Answer] hands that item over', () => {
    const onAnswer = vi.fn();
    render(<GuidedStrip interview={interview} onAnswer={onAnswer} />);
    const next = requiredQueue(interview)[0];
    expect(screen.getByTestId('guided-strip').getAttribute('data-next')).toBe(next.id);
    expect(screen.getAllByTestId('guided-answer')).toHaveLength(1);
    expect(screen.getByTestId('guided-next').textContent).toBe(nextActionLabel(next));
    fireEvent.click(screen.getByTestId('guided-answer'));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer.mock.calls[0][0].id).toBe(next.id);
  });

  it('answering the marked question moves GUIDED on to the next one', () => {
    const [first, second] = requiredQueue(interview);
    const answered = {
      ...interview,
      sections: interview.sections.map(s => ({ ...s, items: s.items.map(i => (i.id === first.id ? { ...i, state: 'answered' as const } : i)) })),
      openQuestions: interview.openQuestions.filter(q => q.id !== first.id),
    };
    render(<GuidedStrip interview={answered} onAnswer={() => undefined} />);
    expect(screen.getByTestId('guided-strip').getAttribute('data-next')).toBe(second.id);
  });

  it('the release state does not depend on the mode: one status, read from the interview alone', () => {
    renderPanel();
    expect(screen.getByTestId('engineering-readiness').getAttribute('data-release'))
      .toBe(interview.release.releaseReady ? 'ELIGIBLE' : 'BLOCKED');
    render(<GuidedStrip interview={interview} onAnswer={() => undefined} />);
    const n = requiredQueue(interview).length;
    expect(screen.getByTestId('guided-count').textContent).toBe(`${n} required answers`);
    expect(screen.getByTestId('readiness-status').textContent).toBe(`BLOCKED — ${n} required answers`);
  });
});

describe('the status never says "complete" while something is still to review', () => {
  it('release-eligible with an item needing verification reads "ELIGIBLE — 1 item to review", not COMPLETE', () => {
    const reviewing = {
      ...interview,
      release: { drawable: true, releaseReady: true, blockers: [] },
      sections: interview.sections.map(s => ({ ...s, items: s.items.map(i => (i.id === 'behavior.utility.meter-collar' ? i
        : { ...i, state: 'answered' as const })) })),
      openQuestions: [],
    };
    renderPanel(reviewing);
    const status = screen.getByTestId('readiness-status');
    expect(status.textContent).toBe('ELIGIBLE — 1 item to review');
    expect(status.textContent).not.toMatch(/COMPLETE/);
  });
});

describe('the page: no questionnaire above the grid, guided is one line, readiness at the bottom', () => {
  const page = readFileSync(resolve(process.cwd(), 'app/engineering/page.tsx'), 'utf8');
  // The System Config tab body ends where the next tab's begins (Service Topology is no longer a tab).
  const tab = page.slice(page.indexOf("{activeTab === 'config' ? ((() => {"), page.indexOf("{activeTab === 'compliance' ? ((() => {"));
  it('the slice is the System Config tab body, not the rest of the file', () => {
    expect(page.indexOf("{activeTab === 'compliance' ? ((() => {")).toBeGreaterThan(page.indexOf("{activeTab === 'config' ? ((() => {"));
  });

  it('the five-card interview is gone from the page', () => {
    expect(page).not.toContain('<SystemConfigInterview');
    expect(page).not.toContain('systemConfig/SystemConfigInterview');
  });

  it('the guided strip renders only in guided mode, before the grid, and reveals + asks the item', () => {
    expect(tab).toMatch(/\{controlMode === 'guided' \? \(\s*<GuidedStrip interview=\{systemConfigInterview\}\s*onAnswer=\{item => openQuestion\(item\.id, \{ reveal: true \}\)\} \/>/);
    expect(tab.indexOf('<GuidedStrip')).toBeLessThan(tab.indexOf('3-COLUMN RESPONSIVE GRID'));
  });

  it('the readiness panel is mounted under the 3-column grid, full width, on the one write path', () => {
    const grid = tab.indexOf('end 3-col grid');
    expect(grid).toBeGreaterThan(0);
    expect(tab.indexOf('<EngineeringReadinessPanel')).toBeGreaterThan(grid);
    expect(page).toContain('const applyInterviewAnswer = applyVia(writeInterviewAnswer, setInterviewRefusal);');
    expect(page).toContain('apply: applyInterviewAnswer,');
  });

  it('the existing cards carry the anchors the guided strip scrolls to', () => {
    for (const id of ['sc-card-summary', 'sc-card-inverters', 'sc-card-battery', 'sc-card-system-config']) {
      expect(tab, id).toContain(`id="${id}"`);
    }
  });
});
