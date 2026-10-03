'use client';

// ═══════════════════════════════════════════════════════════════════════════
// SYSTEM CONFIGURATION CARD — THE HIGH-LEVEL ARCHITECTURE, ASKED WHERE IT BELONGS.
//
// Ray (System Config UX correction V3): "The existing System Config sections must become smarter and
// absorb the engineering questions that naturally belong there… Engineering complexity should
// increase the intelligence of the controls, not the vertical length of the page."
//
// The right-column System Configuration card keeps its project settings (system type, utility meter,
// mounting, combiner, CT location, engineering mode) and absorbs the architecture questions the
// interview homes here (lib/electrical/systemConfigPlacement.ts → 'systemConfig'):
//
//   PV ARCHITECTURE      read-only — the PV connection is asked on the Inverters & Strings card
//   BACKUP               behavior.backup — whole / none / only the panels I choose (a small dialog)
//   SYSTEMS CONNECT      behavior.systems — only with more than one system
//   INTERCONNECTION      behavior.interconnection — ONE control over the service graph, replacing the
//                        old four-button "Interconnection Method" grid; it mirrors the legacy scalar
//                        (lib/electrical/systemConfigLegacyInterconnection.ts)
//   METER COLLAR         behavior.utility.meter-collar — beside the utility meter, only when relevant
//   UTILITY ISOLATION    behavior.isolation — required? · quantity · arrangement · utility / AHJ
//                        status · [Select Equipment] → the der-isolation disconnect editor
//
// Every choice list is the interview's own (already filtered to what the equipment and the utility
// allow), every write is one of the existing pure answer functions handed to `apply` — the page's one
// write path — and every detail below the decision (switch position, part, rating, SCCR) stays in
// the dialog, not on the card. Nothing here decides engineering.
// ═══════════════════════════════════════════════════════════════════════════

import React, { useId, useState } from 'react';
import type { DerArrangement, PoiRelationship, ServiceTopology } from '@/lib/electrical/serviceTopology';
import { governingArticleFor } from '@/lib/electrical/serviceTopology';
import type { InterviewItem, InterviewOption, SystemConfigInterview } from '@/lib/electrical/systemConfigInterview';
import {
  answerInterconnection, answerSystemsArrangement, answerIsolationRequired,
  answerIsolationArrangement, answerIsolationAccepted,
} from '@/lib/electrical/systemConfigAnswers';
import { answerBackupChoice } from '@/lib/electrical/systemConfigSystemEquipment';
import {
  METER_COLLAR_ITEM_ID, answerMeterCollarPermitted, disconnectItemId,
} from '@/lib/electrical/systemConfigUtilityDisconnects';
import { allInterviewItems, anchorOf, findInterviewItem } from '@/lib/electrical/systemConfigPlacement';
import {
  LOAD_SIDE_REMEDIES, legacyInterconnectionMirror, type LegacyInterconnectionToken,
} from '@/lib/electrical/systemConfigLegacyInterconnection';
import {
  ItemEditor, ProvenanceChip, QuestionDialog, type ApplyAnswer, type ItemEditorContext,
} from '@/components/engineering/systemConfig/ItemEditor';

export const DER_ISOLATION_ITEM_ID = disconnectItemId('der-isolation-disconnect');

export interface SystemConfigurationControlsProps extends ItemEditorContext {
  interview: Pick<SystemConfigInterview, 'sections' | 'summaryFacts'>;
  /** `config.interconnectionMethod` — the legacy scalar the compliance, CT and SLD requests read. */
  legacyInterconnectionMethod?: string | null;
  /** Bring the legacy scalar into step after a graph write (the page: `updateConfig`). */
  onLegacyInterconnection?: (token: LegacyInterconnectionToken) => void;
  /** The legacy compliance engine reports a 120% busbar FAIL on a load-side connection. */
  legacyBusbarFails?: boolean;
  /** Manual mode: the per-path and equipment detail expanded inline, still inside the card. */
  expanded?: boolean;
  /** The page's write error, shown inside a dialog opened from this card. */
  error?: string | null;
  /** Reveal another card (the page: `revealHomeCard`). */
  onGoToCard?: (itemId: string) => void;
  className?: string;
}

// ── One write path, with the legacy mirror and the refusal kept on the card ──

/**
 * The card's `apply`: a writer's refusal is shown on the card (and never written); an accepted
 * answer goes through the page's `apply`, and once the graph holds it the legacy interconnection
 * scalar is mirrored from that graph — so the two cannot disagree after an answer given here.
 */
function useCardApply(p: SystemConfigurationControlsProps): { apply: ApplyAnswer; refusal: string | null } {
  const [refusal, setRefusal] = useState<string | null>(null);
  const apply: ApplyAnswer = async r => {
    if (r.ok === false) { setRefusal(r.refused); return false; }
    setRefusal(null);
    const ok = await p.apply(r);
    if (ok) {
      const token = legacyInterconnectionMirror(r.topology, p.legacyInterconnectionMethod);
      if (token !== null) p.onLegacyInterconnection?.(token);
    }
    return ok;
  };
  return { apply, refusal };
}

// ── Small parts ─────────────────────────────────────────────────────────────

const DOT: Partial<Record<InterviewItem['state'], string>> = {
  'needs-answer': 'bg-sky-400',
  'needs-verification': 'bg-amber-400',
  'derived': 'bg-amber-400',
  'fails': 'bg-rose-500',
};

/** One compact row: a label, the control, and a dot when the item still owes something. */
function Field({ label, htmlFor, item, testid, children }: {
  label: string; htmlFor?: string; item?: InterviewItem | null; testid: string; children: React.ReactNode;
}) {
  const dot = item ? DOT[item.state] : undefined;
  return (
    <div data-testid={testid} data-state={item?.state} className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <label htmlFor={htmlFor} className="w-32 shrink-0 text-[10px] font-bold uppercase tracking-wide text-slate-500">
        {label}
      </label>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">{children}</div>
      {dot ? <span aria-hidden title={item?.state} className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} /> : null}
    </div>
  );
}

/**
 * A select over the interview's own options. A recorded value the options do not offer is shown by
 * its answer and not offered; with nothing recorded, the placeholder says so — never a default.
 */
function Choice({ id, testid, item, value, options, placeholder, onPick, busy }: {
  id?: string; testid: string; item?: InterviewItem | null; value: string | null | undefined;
  options: InterviewOption[]; placeholder: string; onPick: (v: string) => void; busy: boolean;
}) {
  const v = value ?? '';
  const listed = options.some(o => o.value === v);
  return (
    <select id={id} data-testid={testid} data-state={item?.state} disabled={busy} value={v}
            className="eng-select !w-auto min-w-0 flex-1 !py-1 !text-xs"
            onChange={e => { if (e.target.value) onPick(e.target.value); }}>
      {v === '' ? <option value="">{placeholder}</option> : null}
      {v !== '' && !listed ? <option value={v} disabled>{item?.answer ?? v}</option> : null}
      {options.map(o => <option key={o.value} value={o.value} title={o.detail}>{o.label}</option>)}
    </select>
  );
}

const linkBtn = 'text-[10px] font-bold text-sky-300 hover:text-sky-200 whitespace-nowrap';

/**
 * A link to the card an item is asked in (#sc-card-service, #sc-card-inverters…). With the page's
 * reveal it scrolls there and rings the card; without it, it is an ordinary in-page link.
 */
function CardLink({ itemId, testid, onGoToCard, children }: {
  itemId: string; testid: string; onGoToCard?: (itemId: string) => void; children: React.ReactNode;
}) {
  return (
    <a href={`#${anchorOf(itemId)}`} data-testid={testid} className={linkBtn}
       onClick={e => { if (onGoToCard) { e.preventDefault(); onGoToCard(itemId); } }}>
      {children}
    </a>
  );
}

/** Where the code comes from, for the relationship recorded. Derived — never stored, never chosen. */
function governedBy(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value === 'manufacturer-integrated') return 'Governed by the manufacturer’s listing';
  if (value === 'meter-collar') return 'Utility / AHJ authorisation';
  return governingArticleFor(value as PoiRelationship);
}

const LEGACY_WORDS: Readonly<Record<string, string>> = {
  LOAD_SIDE: 'Load-side backfeed',
  SUPPLY_SIDE_TAP: 'Supply-side tap',
};

// ── Meter collar — beside the utility meter ─────────────────────────────────

/**
 * "Meter collar permitted?" — the utility / AHJ ruling, shown only while it matters (the
 * interview's own relevance). "Not permitted" withdraws a collar already chosen and removes it from
 * the interconnection choices; the legacy scalar follows the graph.
 */
export function MeterCollarControl(props: SystemConfigurationControlsProps) {
  const id = useId();
  const { apply, refusal } = useCardApply(props);
  const t = props.topology;
  const item = findInterviewItem(props.interview, METER_COLLAR_ITEM_ID);
  if (!t || !item || !item.options) return null;
  return (
    <div className={props.className} data-testid="sys-meter-collar-row" data-state={item.state}>
      <label htmlFor={id} className="eng-label">Meter collar permitted?</label>
      <div className="flex items-center gap-2">
        <Choice id={id} testid="sys-meter-collar" item={item} value={item.value} options={item.options}
                placeholder="Not established" busy={props.busy}
                onPick={v => void apply(answerMeterCollarPermitted(t,
                  v === 'permitted' ? true : v === 'not-permitted' ? false : null))} />
        <ProvenanceChip source={item.source} compact />
      </div>
      {refusal ? <div data-testid="sys-meter-collar-refusal" className="mt-1 text-[10px] text-amber-300">{refusal}</div> : null}
    </div>
  );
}

// ── The architecture rows ───────────────────────────────────────────────────

export function SystemArchitectureControls(props: SystemConfigurationControlsProps) {
  const uid = useId();
  const { apply, refusal } = useCardApply(props);
  const [dialog, setDialog] = useState<'backup' | 'isolation' | null>(null);
  const { interview, busy, expanded = false } = props;
  const t: ServiceTopology | null = props.topology;

  const architecture = interview.summaryFacts.find(f => f.label === 'PV architecture') ?? null;
  const backup = findInterviewItem(interview, 'behavior.backup');
  const systems = findInterviewItem(interview, 'behavior.systems');
  const ic = findInterviewItem(interview, 'behavior.interconnection');
  const iso = findInterviewItem(interview, 'behavior.isolation');
  const isoEquipment = findInterviewItem(interview, DER_ISOLATION_ITEM_ID);

  const legacy = String(props.legacyInterconnectionMethod ?? '').trim().toUpperCase();
  const remedy = LOAD_SIDE_REMEDIES[legacy] ?? null;
  // The graph's own 120% verdicts (per panel, per generation panel), or the legacy engine's.
  const graphBusbarFails = allInterviewItems(interview).some(i => i.state === 'fails'
    && (i.id.startsWith('engineering.domain.busbar-705-12') || i.id.startsWith('engineering.aggregation.busbar')));
  const busbarFails = graphBusbarFails || !!props.legacyBusbarFails;

  const ctx: ItemEditorContext = { ...props, apply };
  const dialogItem = dialog === 'backup' && backup ? { ...backup, value: 'panels' }
    : dialog === 'isolation' ? isoEquipment : null;

  const isolators = t ? t.devices.filter(d => d.roles.includes('der-isolation-disconnect')) : [];
  const required = t?.interconnection.externalDerIsolationRequired ?? null;
  const perPath = isolators.length > 1 && isolators.every(d => !!d.inlineOnNodeId);
  const accepted = t?.interconnection.isolationArrangementAccepted ?? null;
  const pathAmps = t ? [...new Set(t.branches.map(b => b.ratedAmps))] : [];
  const partsChosen = isolators.filter(d => !!d.productId).length;

  return (
    <div className={`space-y-2 ${props.className ?? ''}`} data-testid="sys-architecture">
      <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Architecture</div>

      {/* PV ARCHITECTURE — stated here, asked on the Inverters & Strings card. */}
      {architecture ? (
        <Field label="PV architecture" testid="sys-pv-architecture-row">
          <span data-testid="sys-pv-architecture" className="text-xs font-semibold text-slate-200">{architecture.value}</span>
          <ProvenanceChip source={architecture.source} compact />
          <CardLink itemId="behavior.pv-connection" testid="sys-pv-architecture-link" onGoToCard={props.onGoToCard}>
            Inverters &amp; Strings →
          </CardLink>
        </Field>
      ) : null}

      {/* BACKUP — whole / none here; "only the panels I choose" opens the per-panel editor. */}
      {backup && t ? (
        <Field label="Backup" htmlFor={`${uid}-backup`} item={backup} testid="sys-backup-row">
          <Choice id={`${uid}-backup`} testid="sys-backup" item={backup} value={backup.value}
                  options={backup.options ?? []} placeholder="Not answered — choose…" busy={busy}
                  onPick={v => {
                    if (v === 'panels') { setDialog('backup'); return; }
                    void apply(answerBackupChoice(t, v as 'whole' | 'none', props.equipment));
                  }} />
          {backup.value === 'panels' ? (
            <button type="button" data-testid="sys-backup-panels" className={linkBtn} onClick={() => setDialog('backup')}>
              Choose panels
            </button>
          ) : null}
          {expanded && t.panels.length > 1 ? (
            <ul data-testid="sys-backup-detail" className="basis-full space-y-0.5 text-[10px] text-slate-400">
              {t.panels.map(p => {
                const sys = t.domains.find(d => d.backedUpPanelIds.includes(p.id));
                return <li key={p.id}>{p.label} — {sys ? `backed up by ${sys.label}` : 'not backed up'}</li>;
              })}
            </ul>
          ) : null}
        </Field>
      ) : null}

      {/* SYSTEMS CONNECT — only with more than one system (the interview's own relevance). */}
      {systems && t ? (
        <Field label="Systems connect" htmlFor={`${uid}-systems`} item={systems} testid="sys-systems-row">
          <Choice id={`${uid}-systems`} testid="sys-systems" item={systems} value={systems.value}
                  options={systems.options ?? []} placeholder="Not answered — choose…" busy={busy}
                  onPick={v => void apply(answerSystemsArrangement(t, v as DerArrangement))} />
        </Field>
      ) : null}

      {/* INTERCONNECTION — the graph's point(s) of interconnection; the code article is derived. */}
      <Field label="Interconnection" htmlFor={`${uid}-ic`} item={ic} testid="sys-interconnection-row">
        {!t ? (
          <CardLink itemId="service.rating" testid="sys-interconnection-set-service" onGoToCard={props.onGoToCard}>
            Set the existing service first →
          </CardLink>
        ) : !ic ? (
          <span data-testid="sys-interconnection-none" className="text-[11px] text-slate-500">
            Nothing to connect yet — no PV or storage on this project.
          </span>
        ) : (
          <>
            {/* Points recorded differently per system have no one value: said so, not "not established". */}
            <Choice id={`${uid}-ic`} testid="sys-interconnection" item={ic} value={ic.value}
                    options={ic.options ?? []} busy={busy}
                    placeholder={!ic.value && ic.answer ? 'Differs per system — choose one for all…' : 'Not established — choose…'}
                    onPick={v => void apply(answerInterconnection(t, v as Parameters<typeof answerInterconnection>[1]))} />
            {governedBy(ic.value) ? (
              <span data-testid="sys-interconnection-code" className="font-mono text-[10px] text-slate-500">{governedBy(ic.value)}</span>
            ) : null}
            {ic.state === 'needs-verification' || ic.state === 'fails' || (!ic.value && ic.answer) ? (
              <span data-testid="sys-interconnection-note"
                    className={`basis-full text-[10px] ${ic.state === 'answered' ? 'text-slate-400' : 'text-amber-300'}`}>{ic.answer}</span>
            ) : null}
          </>
        )}
        {busbarFails ? (
          <span className="basis-full text-[10px]">
            <span data-testid="sys-busbar-violation"
                  className="mr-1.5 rounded border border-red-500/30 bg-red-500/15 px-1 py-0.5 font-bold text-red-400">120% VIOLATION</span>
            <CardLink itemId="service.rating" testid="sys-busbar-remedies" onGoToCard={props.onGoToCard}>
              Remedies on Existing Electrical Service →
            </CardLink>
          </span>
        ) : null}
        {remedy ? (
          <span data-testid="sys-interconnection-remedy" className="basis-full text-[10px] text-slate-400">
            120% remedy recorded: {remedy}
          </span>
        ) : ic && !ic.value && LEGACY_WORDS[legacy] ? (
          <span data-testid="sys-interconnection-legacy" className="basis-full text-[10px] text-slate-500">
            Earlier pick, not on the service yet: {LEGACY_WORDS[legacy]} — choose above to record it.
          </span>
        ) : null}
      </Field>

      {/* UTILITY ISOLATION — the utility's requirement, the arrangement, its status, the switches. */}
      {iso && t && iso.options ? (
        <div data-testid="sys-isolation" data-state={iso.state} className="space-y-1.5 rounded-lg border border-slate-700/50 bg-slate-900/30 p-2">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Utility isolation</div>
          <Field label="External disconnect required?" htmlFor={`${uid}-iso-req`} item={iso} testid="sys-isolation-required-row">
            <Choice id={`${uid}-iso-req`} testid="sys-isolation-required" item={iso} value={iso.value ?? 'unknown'}
                    options={iso.options} placeholder="Not established" busy={busy}
                    onPick={v => void apply(answerIsolationRequired(t, v === 'yes' ? true : v === 'no' ? false : null))} />
            <ProvenanceChip source={iso.source} compact />
          </Field>
          {required === true ? (
            <Field label="Quantity" testid="sys-isolation-quantity-row">
              <span data-testid="sys-isolation-quantity" className="text-xs text-slate-200">
                {isolators.length > 0 ? isolators.length : 'None placed'}
              </span>
            </Field>
          ) : null}
          {required === true && t.branches.length > 1 ? (
            <Field label="Arrangement" htmlFor={`${uid}-iso-arr`} testid="sys-isolation-arrangement-row">
              <Choice id={`${uid}-iso-arr`} testid="sys-isolation-arrangement" busy={busy}
                      value={isolators.length === 0 ? null : perPath ? 'one-per-path' : 'common-service'}
                      placeholder="Not answered — choose…"
                      options={[
                        { value: 'one-per-path', label: pathAmps.length === 1 && pathAmps[0]
                          ? `One per ${pathAmps[0]} A system` : 'One per system',
                          detail: 'Each path isolated on its own, rated for that path.' },
                        { value: 'common-service', label: 'One for the whole service' },
                      ]}
                      onPick={v => void apply(answerIsolationArrangement(t, v as 'one-per-path' | 'common-service'))} />
            </Field>
          ) : null}
          {isolators.length > 0 ? (
            <Field label="Utility / AHJ status" htmlFor={`${uid}-iso-acc`} testid="sys-isolation-accepted-row">
              <Choice id={`${uid}-iso-acc`} testid="sys-isolation-accepted" busy={busy}
                      value={accepted === true ? 'yes' : accepted === false ? 'no' : 'unknown'}
                      placeholder="Requires confirmation"
                      options={[
                        { value: 'unknown', label: 'Requires confirmation' },
                        { value: 'yes', label: 'Utility / AHJ confirmed' },
                        { value: 'no', label: 'Not accepted' },
                      ]}
                      onPick={v => void apply(answerIsolationAccepted(t, v === 'yes' ? true : v === 'no' ? false : null))} />
            </Field>
          ) : null}
          {isoEquipment ? (
            expanded ? (
              <div data-testid="sys-isolation-equipment-inline" data-state={isoEquipment.state}
                   className="rounded border border-slate-800 bg-slate-950/40 p-1.5">
                <ItemEditor {...ctx} item={isoEquipment} />
              </div>
            ) : (
              <Field label="Equipment" item={isoEquipment} testid="sys-isolation-equipment-row">
                <button type="button" data-testid="sys-isolation-equipment" disabled={busy}
                        className="rounded bg-slate-700 px-2 py-0.5 text-[11px] font-bold text-slate-100 hover:bg-slate-600 disabled:opacity-40"
                        onClick={() => setDialog('isolation')}>
                  Select Equipment
                </button>
                <span data-testid="sys-isolation-equipment-summary" className="text-[10px] text-slate-400">
                  {isolators.length === 0 ? 'No switch placed yet'
                    : `${isolators.length} switch${isolators.length === 1 ? '' : 'es'} · `
                      + (partsChosen === 0 ? 'parts not selected'
                        : partsChosen === isolators.length ? 'parts selected'
                          : `${partsChosen} of ${isolators.length} parts selected`)}
                  {isoEquipment.state === 'fails' ? ' · FAILS — review the parts' : ''}
                </span>
              </Field>
            )
          ) : null}
        </div>
      ) : null}

      {refusal ? (
        <div data-testid="sys-refusal" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-200">
          {refusal}
        </div>
      ) : null}

      <QuestionDialog {...ctx} item={dialogItem} error={props.error} onClose={() => setDialog(null)}
                      onGoToCard={props.onGoToCard} />
    </div>
  );
}
