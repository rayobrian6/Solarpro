'use client';

// ═══════════════════════════════════════════════════════════════════════════
// EXISTING ELECTRICAL SERVICE — the left-column card, where the old Main Service Panel card was.
//
// Ray (System Config UX correction V3): "The existing System Config sections must become smarter and
// absorb the engineering questions that naturally belong there." The service questions the five-card
// questionnaire used to ask above the grid are asked HERE, compactly:
//
//   Service rating [400 A ▼]   Electrical system [120/240 V split phase ▼]
//   Distribution  (One 400 A main panel) (Two 200 A main panels) (Other / custom)   ← only when asked
//   MSP #1  Main [200 ▼]  Bus [200 ▼]  [Eaton]                                       ← one row per panel
//   Available fault current [   ] kA from the utility
//   ☑ Existing service equipment · [Eaton] · Field verification 5 items required [Verify]
//
// A plain 200 A / one-MSP house shows one compact panel row and NO multi-panel controls: the
// interview does not ask a 200 A service how it is split. A panel whose NEC 705.12(B) check FAILS
// (the engine's verdict, read — never recomputed) lists the 120% remedies — derate this panel's main,
// or upgrade its busbar — as PROPOSED WORK, never written as the panel's rating.
//
// The controls themselves live in `ServiceControls.tsx`, shared with the question dialog, so
// [Answer Next] asks a service question with exactly the editor this card uses. Every write goes
// through `systemConfigAnswers.ts` into `apply` — the page's one write path, which also mirrors the
// first panel's main / bus / manufacturer into the legacy config, and which refuses to write while
// the graph is unread. A writer's refusal is shown here, in the card, and never written.
// ═══════════════════════════════════════════════════════════════════════════

import React, { useId, useMemo, useState } from 'react';
import { Shield } from 'lucide-react';
import type { SystemConfigInterview } from '@/lib/electrical/systemConfigInterview';
import {
  existingNeedField, panelBusbarCheck, serviceCardLayout, type ExistingServiceField,
} from '@/lib/electrical/systemConfigServiceCard';
import {
  ProvenanceChip, SystemConfigModal, unreadGraphRefusal, type ApplyAnswer, type ItemEditorContext,
} from '@/components/engineering/systemConfig/ItemEditor';
import { ExistingServiceVerifyForm } from '@/components/engineering/systemConfig/cards/ExistingServiceVerifyForm';
import {
  DistributionControl, ElectricalSystemSelect, ExistingServiceLine, FaultCurrentRow, PanelRow, ServiceRatingSelect,
} from '@/components/engineering/systemConfig/cards/ServiceControls';

export interface ExistingElectricalServiceCardProps extends ItemEditorContext {
  /** The LIVE interview — relevance, answers and provenance are read from it, never re-derived. */
  interview: Pick<SystemConfigInterview, 'sections' | 'evaluation'>;
  /** The page's write error (the PUT failed). */
  error?: string | null;
}

export function ExistingElectricalServiceCard(props: ExistingElectricalServiceCardProps) {
  const { interview, topology: t, graphRead } = props;
  const layout = useMemo(() => serviceCardLayout(interview, t), [interview, t]);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const verifyTitleId = useId();

  const unread = unreadGraphRefusal(graphRead) !== null;
  const locked = props.busy || unread;
  // The card's own apply: a refusal is shown in the card; an accepted answer takes the page's path.
  // 🚨 Never over a graph that has not been read (or is being re-read): the answer would be computed
  // from a graph that is not the stored one, and the PUT would replace the stored one with it. The
  // page's write path refuses that too (`guardGraphRead`); this keeps the card from even asking.
  const apply: ApplyAnswer = async r => {
    if (unread) return false;
    if (r.ok === false) { setRefusal(r.refused); return false; }
    setRefusal(null);
    return props.apply(r);
  };

  const ex = t?.service.existingEquipment ?? null;
  const needFields = layout.existingNeeds
    .map(i => existingNeedField(i.id)).filter((f): f is ExistingServiceField => f !== null);
  const checks = interview.evaluation?.checks ?? null;
  const notice = (
    <>
      {refusal ? (
        <div data-testid="svc-refusal" className="mb-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-200">{refusal}</div>
      ) : null}
      {props.error ? (
        <div data-testid="svc-error" className="mb-2 rounded-lg border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-200">{props.error}</div>
      ) : null}
    </>
  );

  return (
    <div data-testid="svc-card">
      <h3 className="text-sm font-extrabold text-slate-100 mb-3 flex items-center gap-2 tracking-tight">
        <Shield size={14} className="text-amber-400" /> Existing Electrical Service
        <span className="ml-1 text-[10px] font-normal text-slate-500 normal-case tracking-normal">NEC 705.12(B) per panel</span>
      </h3>
      {verifyOpen ? null : notice}

      {/* ── Rating · electrical system ── */}
      <div className="grid grid-cols-2 gap-3">
        <div data-state={layout.rating?.state}>
          <label className="eng-label flex items-center gap-1.5">
            Service rating <ProvenanceChip compact source={layout.rating?.source} />
          </label>
          <ServiceRatingSelect t={t} item={layout.rating} ids="svc" disabled={locked} apply={apply} />
        </div>
        {t && layout.system ? (
          <div data-state={layout.system.state}>
            <label className="eng-label flex items-center gap-1.5">
              Electrical system <ProvenanceChip compact source={layout.system.source} />
            </label>
            <ElectricalSystemSelect t={t} item={layout.system} ids="svc" disabled={locked} apply={apply} />
          </div>
        ) : null}
      </div>

      {!t ? (
        <div data-testid={unread ? 'svc-unread' : 'svc-start'} className="mt-2 text-[11px] text-slate-400">
          {graphRead === 'failed'
            ? 'The service could not be read. Nothing is written here until it can be — reload to try again.'
            : graphRead === 'loading'
              ? 'Reading the service…'
              : 'Enter the service rating — the panels, the fault current and the existing equipment follow.'}
        </div>
      ) : null}

      {/* ── Distribution — when the interview asks it, or when a recorded split no longer fits ── */}
      {t && layout.distribution?.options ? (
        <div data-testid="svc-distribution" data-state={layout.distribution.state} className="mt-3">
          <div className="eng-label flex items-center gap-1.5">
            {layout.distribution.question.replace(/\?$/, '')}
            <ProvenanceChip compact source={layout.distribution.source} />
          </div>
          <DistributionControl t={t} item={layout.distribution} ids="svc" disabled={locked} apply={apply} />
        </div>
      ) : null}

      {/* ── Panels: one row each; one compact row on a one-MSP service. Each says where its figures
           came from — a row nobody has read yet is "Not set" and asks for them. ── */}
      {t && layout.panels.length > 0 ? (
        <div data-testid="svc-panels" data-multi={layout.multiPanel ? 'true' : 'false'} className="mt-3 space-y-1.5">
          {layout.panels.map(({ panel, item }) => (
            <PanelRow key={panel.id} t={t} panel={panel} item={item} ids="svc" disabled={locked} apply={apply}
                      check={panelBusbarCheck(t, checks, panel.id)}
                      chip={<ProvenanceChip compact source={item?.source} testid={`svc-panel-source-${panel.id}`} />} />
          ))}
        </div>
      ) : null}

      {/* ── Available fault current ── */}
      {t && layout.faultCurrent ? (
        <div className="mt-3">
          <FaultCurrentRow t={t} item={layout.faultCurrent} ids="svc" disabled={locked} apply={apply}
                           chip={<ProvenanceChip compact source={layout.faultCurrent.source} />} />
        </div>
      ) : null}

      {/* ── Existing service equipment ── */}
      {t && layout.existing ? (
        <div data-testid="svc-existing-line" data-state={layout.existing.state}
             className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-lg border border-slate-700/40 bg-slate-900/50 p-2 text-[11px] text-slate-300">
          <ExistingServiceLine t={t} ids="svc" disabled={locked} apply={apply}>
            <span className="text-slate-600">·</span>
            <span data-testid="svc-existing-status" className={needFields.length > 0 || !ex?.verified ? 'text-amber-300' : 'text-emerald-300'}>
              {needFields.length > 0
                ? `Field verification ${needFields.length} item${needFields.length === 1 ? '' : 's'} required`
                : ex?.verified ? 'Field verified' : 'Field verification required'}
            </span>
            <button type="button" data-testid="svc-verify" disabled={locked} onClick={() => setVerifyOpen(true)}
                    className="ml-auto rounded bg-sky-600 px-2 py-0.5 text-[11px] font-bold text-white hover:bg-sky-500 disabled:opacity-40">
              Verify
            </button>
          </ExistingServiceLine>
          {/* Unchecked is also what the graph holds when nobody has said anything, so it is worded as
              the question it may still be — with what SolarPro does meanwhile — never as a decision. */}
          {!ex ? (
            <span data-testid="svc-existing-new" className="text-slate-400">
              Existing or new? Unchecked, SolarPro designs the service equipment as new — check it if the
              equipment is already on the wall.
            </span>
          ) : null}
        </div>
      ) : null}

      {t && ex ? (
        <SystemConfigModal open={verifyOpen} onClose={() => setVerifyOpen(false)} titleId={verifyTitleId} testid="svc-verify-dialog">
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Existing Electrical Service · Field verification</div>
                <h2 id={verifyTitleId} className="mt-0.5 text-sm font-extrabold text-slate-100">
                  Verify the existing service equipment{ex.manufacturer ? ` — ${ex.manufacturer}` : ''}
                </h2>
                <p className="mt-1 text-[11px] text-slate-400">
                  Read off the equipment on site, never assumed. SolarPro connects to existing equipment; it does not
                  replace or price it.
                </p>
              </div>
              <button type="button" data-testid="svc-verify-close" aria-label="Close" onClick={() => setVerifyOpen(false)}
                      className="rounded px-2 py-0.5 text-lg leading-none text-slate-400 hover:bg-slate-800 hover:text-slate-200">×</button>
            </div>
            {notice}
            <ExistingServiceVerifyForm t={t} apply={apply} busy={locked} needed={needFields}
                                       onSaved={() => setVerifyOpen(false)} />
          </div>
        </SystemConfigModal>
      ) : null}
    </div>
  );
}

export default ExistingElectricalServiceCard;
