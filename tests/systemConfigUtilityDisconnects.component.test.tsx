/** @vitest-environment jsdom */
// ═══════════════════════════════════════════════════════════════════════════
// The utility-fact and disconnecting-means editors, clicked: each control writes the service graph
// through `apply` — the page's one write path, the same one the PUT route sits behind.
// (The PUT → GET → engineering round trip itself is proven in the .postgres test beside this one.)
//
// REWRITTEN FOR V3, NOT DELETED (2026-10-03). These editors used to sit in the five-card interview.
// The disconnecting means now live in the Engineering Readiness panel's REVIEW ENGINEERING modal
// (their home per the V3 spec), and the meter-collar ruling is asked in a QuestionDialog through the
// same `ItemEditor` the System Configuration card uses. Every requirement below is unchanged.
// ═══════════════════════════════════════════════════════════════════════════
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { ServiceTopologyPanel } from '@/components/engineering/ServiceTopologyPanel';
import { buildSystemConfigInterview, type InterviewEquipment } from '@/lib/electrical/systemConfigInterview';
import { answerServiceRating } from '@/lib/electrical/systemConfigAnswers';
import { resolvePvArrayDesign } from '@/lib/electrical/pvArrayDesign';
import { buildRaysIntendedJob } from '@/lib/electrical/fixtures/tesla400aTwoGateway';
import { evaluateServiceTopology, type ServiceTopology } from '@/lib/electrical/serviceTopology';
import { findInterviewItem, homeOf } from '@/lib/electrical/systemConfigPlacement';
import { EngineeringReadinessPanel } from '@/components/engineering/systemConfig/EngineeringReadinessPanel';
import { QuestionDialog, applyVia } from '@/components/engineering/systemConfig/ItemEditor';

afterEach(cleanup);

const pv20 = resolvePvArrayDesign({ placedModuleCount: 20, selectedPanelId: 'panel-std440' });
const MICROS: InterviewEquipment = {
  pvInverter: { state: 'SELECTED', label: 'Enphase IQ8M', kind: 'micro' }, storage: null, gateway: null,
};
const PW3_EQUIPMENT: InterviewEquipment = {
  pvInverter: { state: 'NONE' },
  storage: { label: 'Tesla Powerwall 3', count: 4, pvInput: true, backupCapable: true, requiresGateway: true },
  gateway: { label: 'Tesla Gateway 3', count: 2 },
};
const NO_EQUIPMENT = { gatewayProductId: null, storageProductId: null, storageLabel: null, totalUnits: 0 };

const interviewOf = (t: ServiceTopology, equipment: InterviewEquipment) => buildSystemConfigInterview({
  pvArray: pv20, topology: t, coupling: null, couplingIsDecision: false, architectureConflict: false,
  equipment, evaluation: evaluateServiceTopology(t),
});

/** The readiness panel, with Review Engineering open — where the disconnecting means are edited. */
function mountReview(t: ServiceTopology, equipment: InterviewEquipment = MICROS) {
  const writes: ServiceTopology[] = [];
  render(
    <EngineeringReadinessPanel interview={interviewOf(t, equipment)} topology={t} pvArray={pv20} derivedStrings={[]}
      equipment={NO_EQUIPMENT} busy={false} apply={applyVia(async next => { writes.push(next); return true; })} />,
  );
  fireEvent.click(screen.getByTestId('readiness-review'));
  return { writes, review: screen.getByTestId('review-engineering') };
}

const house200 = () => {
  const r = answerServiceRating(null, 200);
  if (r.ok === false) throw new Error(r.refused);
  return r.topology;
};

describe('Review Engineering edits the disconnecting means; a dialog asks the meter-collar ruling', () => {
  it('"+ Add a service disconnect" writes a device with no seeded rating', async () => {
    const { writes, review } = mountReview(house200());
    fireEvent.click(within(review).getByTestId('answer-disconnect-add-service-disconnect'));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].devices).toEqual([expect.objectContaining({
      label: 'Service disconnect', roles: ['service-disconnect'], ratedAmps: null,
    })]);
  });

  it('placing it ahead of the panel and naming the part are each one write', async () => {
    const t0 = house200();
    const withDevice: ServiceTopology = { ...t0, devices: [{
      id: 'device-1', label: 'Service disconnect', roles: ['service-disconnect'], ratedAmps: null,
      sccrA: null, lockableOpen: true, visibleOpen: false,
    }] };
    const { writes, review } = mountReview(withDevice);
    expect(within(review).getByTestId('answer-disconnect-requirement-device-1').textContent).toBe('rating not established');
    fireEvent.change(within(review).getByTestId('answer-disconnect-place-device-1'), { target: { value: 'msp-1' } });
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].devices[0]).toMatchObject({ inlineOnNodeId: 'msp-1' });
    const part = within(review).getByTestId('answer-disconnect-part-device-1');
    fireEvent.change(part, { target: { value: 'DU224RB' } });
    fireEvent.blur(part);
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1].devices[0]).toMatchObject({ productId: 'DU224RB' });
    const sccr = within(review).getByTestId('answer-disconnect-sccr-device-1');
    fireEvent.change(sccr, { target: { value: '22000' } });
    fireEvent.blur(sccr);
    await waitFor(() => expect(writes).toHaveLength(3));
    expect(writes[2].devices[0]).toMatchObject({ sccrA: 22000 });
  });

  it('the meter-collar ruling is a three-state select (System Configuration card) that writes the interconnection fact', async () => {
    const t = house200();
    const item = findInterviewItem(interviewOf(t, MICROS), 'behavior.utility.meter-collar')!;
    expect(homeOf(item.id)).toBe('systemConfig');
    const writes: ServiceTopology[] = [];
    let closed = 0;
    render(<QuestionDialog item={item} topology={t} pvArray={pv20} derivedStrings={[]} equipment={NO_EQUIPMENT} busy={false}
                           apply={applyVia(async next => { writes.push(next); return true; })} onClose={() => { closed++; }} />);
    const sel = screen.getByTestId('answer-utility-meter-collar') as HTMLSelectElement;
    expect(sel.value).toBe('unknown');
    fireEvent.change(sel, { target: { value: 'not-permitted' } });
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].interconnection.meterCollarPermitted).toBe(false);
    await waitFor(() => expect(closed).toBe(1));
  });

  it('🚨 Ray’s job: a seeded 400 A with no part is labelled a recorded rating, and naming part ABC123 does not adopt it', async () => {
    const rays = { ...buildRaysIntendedJob().topology, solarCoupling: 'dc-coupled-storage' as const };
    const { writes, review } = mountReview(rays, PW3_EQUIPMENT);
    const rating = within(review).getByTestId('answer-disconnect-rating-svc-disco') as HTMLInputElement;
    expect(rating.closest('label')?.textContent, 'the seeded number was offered as the part’s rating')
      .toBe('Recorded rating (A) — not from a part');
    expect(within(review).getByTestId('answer-disconnect-sccr-svc-disco').closest('label')?.textContent)
      .toBe('Recorded SCCR (A) — not from a part');
    const part = within(review).getByTestId('answer-disconnect-part-svc-disco');
    fireEvent.change(part, { target: { value: 'ABC123' } });
    fireEvent.blur(part);
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].devices.find(d => d.id === 'svc-disco'))
      .toMatchObject({ productId: 'ABC123', ratedAmps: null, sccrA: null });
  });

  it('with a part chosen, the boxes are that part’s rating and SCCR', () => {
    const t0 = house200();
    const { review } = mountReview({ ...t0, devices: [{
      id: 'device-1', label: 'Service disconnect', roles: ['service-disconnect'], ratedAmps: 200,
      sccrA: null, lockableOpen: true, visibleOpen: false, productId: 'DU224RB',
    }] });
    expect(within(review).getByTestId('answer-disconnect-rating-device-1').closest('label')?.textContent).toBe('Part rating (A)');
    expect(within(review).getByTestId('answer-disconnect-sccr-device-1').closest('label')?.textContent).toBe('SCCR (A)');
  });

  it('Ray’s job: the engine’s requirement per switch, and the manufacturer document stated without an editor', () => {
    const rays = { ...buildRaysIntendedJob().topology, solarCoupling: 'dc-coupled-storage' as const };
    const { review } = mountReview(rays, PW3_EQUIPMENT);
    expect(within(review).getByTestId('answer-disconnect-requirement-knife-a').textContent)
      .toBe('200 A — what Tesla Backup Gateway 3 carries');
    expect(within(review).getByTestId('answer-disconnect-requirement-svc-disco').textContent).toBe('rating not established');
    const doc = within(review).getByTestId('interview-item-engineering.disconnect.multi-gateway-doc');
    expect(doc.textContent).toContain('MANUFACTURER DOCUMENT REQUIRED');
    expect(doc.querySelector('input,select,button')).toBeNull();
  });
});

describe('the per-device in-line rating verdict still shows on the Service Topology tab', () => {
  it('each switch’s "rating vs its path" check is listed with the site checks, once per switch', () => {
    const rays = buildRaysIntendedJob().topology;
    const inline = rays.devices.filter(d => d.inlineOnNodeId);
    expect(inline.length, 'precondition: Ray’s job has a switch in line ahead of each gateway').toBe(2);
    render(<ServiceTopologyPanel topology={rays} />);
    for (const d of inline) expect(screen.getAllByText(`${d.label} rating vs its path`)).toHaveLength(1);
  });
});
