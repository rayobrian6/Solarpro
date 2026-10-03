/** @vitest-environment jsdom */
// ═══════════════════════════════════════════════════════════════════════════
// 🚨 AUTO / GUIDED / MANUAL — THREE WAYS THROUGH ONE ENGINEERING STATE.
//
// Ray (System Config gauntlet): "Auto / Guided / Manual over the same owners." The interview's
// answers, sources and blockers are identical in every mode (they come from
// buildSystemConfigInterview, which takes no mode); what changes is how much is put in front of the
// installer at once:
//   · MANUAL — every card open.
//   · GUIDED — one question at a time: only the card with the NEXT open question, marked NEXT.
//   · AUTO   — every card that still needs something.
// The Engineering Result card is open in every mode.
// ═══════════════════════════════════════════════════════════════════════════

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { SystemConfigInterview } from '@/components/engineering/systemConfig/SystemConfigInterview';
import { buildSystemConfigInterview } from '@/lib/electrical/systemConfigInterview';
import { resolvePvArrayDesign } from '@/lib/electrical/pvArrayDesign';
import { answerServiceRating } from '@/lib/electrical/systemConfigAnswers';
import { evaluateServiceTopology, type ServiceTopology } from '@/lib/electrical/serviceTopology';

afterEach(cleanup);

// A 200 A house with micros chosen: the service is recorded; the connection and the utility
// disconnect are still open questions (both in "System Behavior & Connection").
const topology = (answerServiceRating(null, 200) as { topology: ServiceTopology }).topology;
const pvArray = resolvePvArrayDesign({ placedModuleCount: 20, selectedPanelId: 'panel-std440' });
const interview = buildSystemConfigInterview({
  pvArray, topology, coupling: null, couplingIsDecision: false, architectureConflict: false,
  equipment: { pvInverter: { state: 'SELECTED', label: 'Enphase IQ8M', kind: 'micro' }, storage: null, gateway: null },
  evaluation: evaluateServiceTopology(topology),
});

function renderIn(mode: 'auto' | 'guided' | 'manual') {
  return render(
    <SystemConfigInterview
      interview={interview} topology={topology} pvArray={pvArray} derivedStrings={[]}
      equipment={{ gatewayProductId: null, storageProductId: null, storageLabel: null, totalUnits: 0 }}
      mode={mode} busy={false} error={null}
      onWrite={async () => true} onRecordCoupling={async () => true}
    />,
  );
}

/** A card is open when its items are rendered. */
const openCards = () => ['design', 'service', 'equipment', 'behavior', 'engineering'].filter(id =>
  within(screen.getByTestId(`interview-section-${id}`)).queryAllByTestId(/^interview-item-/).length > 0);

describe('the same interview, three ways through it', () => {
  it('fixture: the first open question is in System Behavior & Connection', () => {
    expect(interview.openQuestions[0]?.section).toBe('behavior');
    expect(interview.openQuestions.length).toBeGreaterThan(1);
  });

  it('MANUAL opens every card', () => {
    renderIn('manual');
    expect(openCards()).toEqual(['design', 'service', 'equipment', 'behavior', 'engineering']);
    expect(screen.queryByTestId('interview-next')).toBeNull();
  });

  it('GUIDED opens only the card with the next question (plus the result), and marks exactly that question', () => {
    renderIn('guided');
    expect(openCards()).toEqual(['behavior', 'engineering']);
    const marks = screen.getAllByTestId('interview-next');
    expect(marks).toHaveLength(1);
    const nextId = interview.openQuestions[0].id;
    expect(screen.getByTestId(`interview-item-${nextId}`).getAttribute('data-next')).toBe('true');
  });

  it('AUTO opens every card that still needs something; complete cards stay collapsed', () => {
    renderIn('auto');
    const incomplete = interview.sections.filter(s => s.status !== 'complete').map(s => s.id);
    expect(openCards()).toEqual(['design', 'service', 'equipment', 'behavior', 'engineering']
      .filter(id => incomplete.includes(id as never) || id === 'engineering'));
    expect(openCards()).not.toContain('design');   // 20 modules from Design: complete
  });

  it('the answers do not depend on the mode — the same release state is shown in all three', () => {
    for (const mode of ['auto', 'guided', 'manual'] as const) {
      renderIn(mode);
      expect(screen.getByTestId('interview-release').getAttribute('data-release-ready'))
        .toBe(interview.release.releaseReady ? 'yes' : 'no');
      cleanup();
    }
  });
});
