'use client';

// ═══════════════════════════════════════════════════════════════════════════
// PROJECT-SELECTED COMBINER — the installer's answer, on the project.
//
// "The SLD is currently showing an IQ Combiner 6C. I am still installing IQ
// Combiner 5C."
//
// There WAS already a combiner control: a bare <select> in the SLD tab's toolbar
// writing `config.combinerId` into `projects.engineering_config` — the
// engineering page's private workspace. The canonical store every other consumer
// reads (`projects.selected_equipment`) never received it, so the drawing could
// be corrected while the BOM, the schedule and the permit package went on naming
// whatever a resolver had guessed. This control writes the canonical record.
//
// 🚨 ONE PICK, NO QUESTIONS (Ray, 2026-09-25). "I don't like that I have to be
// questioned why I choose whatever Envoy I want to. It's ridiculous." Choosing a
// combiner records it — no reason field, no authority field, no "(not
// declared)" labels. What the catalogue pairs with the inverter is shown as a
// quiet note, never a gate, and nothing is ever substituted for the pick.
//
// 🚨 IT DOES NOT RECOMMEND BY DEFAULT. With nothing selected the control says
// so, in those words. An unanswered question must look unanswered.
// ═══════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useRef, useState } from 'react';

interface Candidate { id: string; brand: string; model: string }

interface SelectionRecord {
  combinerDeviceId: string;
  manufacturer: string;
  model: string;
  basis: string | null;
  selectedBy: string;
  selectedAtIso: string;
}

interface Pairing { inverterLabel: string; combinerIds: string[] }

export interface CombinerSelectorProps {
  projectId: string | null | undefined;
  /** Combiners are an Enphase-microinverter concept today; hidden otherwise. */
  visible: boolean;
  /** The microinverter the design uses — only for the catalogue-pairing note. */
  inverterId?: string | null;
  /** Told the new device id (or null) so the page can drop a stale SLD. */
  onSelectionChanged?: (deviceId: string | null) => void;
}

/** A closed <select> fires `change` on every arrow key in some browsers; wait
 *  for the pick to settle so browsing the list does not write a history entry
 *  per option. */
const SETTLE_MS = 450;

/** A pick the operator made that the server has not yet answered for. The
 *  project and inverter are captured AT THE PICK, so a save that runs later —
 *  from the settle timer or from the unmount flush — records exactly what was
 *  chosen, where it was chosen. */
interface UnsavedPick { projectId: string; id: string; inverterId: string | null }

/** The one request that records a pick — the settle timer and the unmount flush
 *  send the same body, so neither can grow a field the other lacks. */
function postPick(pick: UnsavedPick, init?: { keepalive?: boolean }) {
  return fetch(`/api/projects/${pick.projectId}/combiner-selection`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ combinerDeviceId: pick.id, inverterId: pick.inverterId }),
    ...(init?.keepalive ? { keepalive: true } : {}),
  });
}

// 🚨 A READ MUST NOT OVERTAKE A WRITE. Module scope, not component scope,
// because the write that matters outlives the instance that sent it: leave the
// tab mid-save (or inside the settle window) and come straight back, and the
// NEW instance's GET could reach the database before the old instance's POST
// committed. It would read the old device, show it, and report it; the page
// would send it on every SLD and BOM payload while the project recorded the new
// one — and the permit route, which reads the record, would draw that one.
//
// Per project, the writes whose answer has not been handled yet. Each entry is
// chained onto the one before it and never rejects, so a load awaits the lot.
const unsettledWrites = new Map<string, Promise<void>>();

/** Opens a write on `projectId`. Call the returned function once its answer has
 *  been HANDLED — not merely received — so a failure an unmounted selector
 *  records (below) is in place before any load that waited on it reads. */
function openWrite(projectId: string): () => void {
  let close!: () => void;
  const answered = new Promise<void>(res => { close = res; });
  const prior = unsettledWrites.get(projectId);
  const all = prior ? prior.then(() => answered) : answered;
  unsettledWrites.set(projectId, all);
  void all.then(() => { if (unsettledWrites.get(projectId) === all) unsettledWrites.delete(projectId); });
  return close;
}

// A write the page was told about at unmount (see the flush in the component)
// and the server then refused or never received. The unmounted selector cannot
// say so — nothing is reported after unmount — so the next visible load for
// that project says it, next to the device the project actually records.
const unseenFailures = new Map<string, string>();

function noteUnseenFailure(projectId: string, what: 'pick' | 'clear', reason: unknown) {
  const why = typeof reason === 'string' && reason ? reason : 'the request did not complete';
  unseenFailures.set(projectId, what === 'clear'
    ? `The Clear made as you left this tab did not go through (${why}). Shown below is what the project records.`
    : `The combiner chosen as you left this tab was not saved (${why}). Shown below is what the project records.`);
}

export default function CombinerSelector({ projectId, visible, inverterId, onSelectionChanged }: CombinerSelectorProps) {
  // Held in a ref so `load` does not re-create on every parent render, which
  // would re-fire the effect and re-fetch on every keystroke elsewhere.
  const onSelectionChangedRef = useRef(onSelectionChanged);
  onSelectionChangedRef.current = onSelectionChanged;
  // The project a response belongs to. A POST or GET that lands after the
  // operator switched projects must not write another project's answer here.
  const projectRef = useRef(projectId);
  projectRef.current = projectId;
  // 🚨 A HIDDEN SELECTOR HAS NOTHING TO SAY. The page mounts this for every
  // design and hides it for non-micro ones; the page's own loader owns the
  // value then, and a hidden instance reporting null would erase it.
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  // 🚨 AN UNMOUNTED SELECTOR SAYS NOTHING EITHER. A response that lands after
  // unmount cannot tell whether the page has since moved to another project —
  // `projectRef` froze at unmount — so anything it reported could put one
  // project's device on another's permit. What the page needs to know at
  // unmount is told AT unmount (see the flush below), never afterwards.
  const mountedRef = useRef(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The pick waiting on the settle timer, and the answer whose request is in
  // flight — a pick (POST) or, with `id: null`, a Clear (DELETE).
  const pendingPick = useRef<UnsavedPick | null>(null);
  const inFlight = useRef<{ projectId: string; id: string | null } | null>(null);
  // The project the reset below last ran for. Seeded with the MOUNT project so a
  // remount — every return to the System Configuration tab — is not mistaken
  // for a project change.
  const resetForProject = useRef(projectId);

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<SelectionRecord | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [draftId, setDraftId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    const forProject = projectId;
    setLoading(true);
    try {
      // Wait out every write on this project that has not answered — the last
      // visit's flush or in-flight save, or this instance's own save when an
      // inverter change re-loads mid-write. A write opened while waiting is
      // waited for too. Every write settles: a response, a network failure, or
      // the platform's function timeout.
      for (let w = unsettledWrites.get(forProject); w; w = unsettledWrites.get(forProject)) {
        await w;
        if (!mountedRef.current || projectRef.current !== forProject) return;
      }
      const q = inverterId ? `?inverterId=${encodeURIComponent(inverterId)}` : '';
      const res = await fetch(`/api/projects/${projectId}/combiner-selection${q}`, { cache: 'no-store' });
      const j = await res.json();
      if (!mountedRef.current || projectRef.current !== forProject) return;
      if (j?.success) {
        setSelected(j.selected ?? null);
        setCandidates(Array.isArray(j.candidates) ? j.candidates : []);
        setPairing(j.pairing && Array.isArray(j.pairing.combinerIds) ? j.pairing : null);
        setDraftId(j.selected?.combinerDeviceId ?? '');
        // Report on LOAD as well as on change. Without this the page holds null
        // until the operator touches the control, and the first SLD of a session
        // would be drawn without the selection the project already carries.
        if (visibleRef.current) onSelectionChangedRef.current?.(j.selected?.combinerDeviceId ?? null);
        // The report above has just put the page back on the recorded device;
        // this says why the select no longer shows what was chosen.
        const lost = unseenFailures.get(forProject);
        if (lost) { unseenFailures.delete(forProject); setError(lost); }
      }
      // A refused or failed read reports NOTHING. "We could not find out" is not
      // "nobody has chosen", and a null here would overwrite the value the
      // page's own loader already read from the project.
    } catch { /* the panel stays empty rather than asserting anything */ }
    finally { if (mountedRef.current && projectRef.current === forProject) setLoading(false); }
  }, [projectId, inverterId]);

  // Declared first so every effect below — and every response that lands later —
  // sees an accurate `mountedRef`. React runs effects in declaration order and
  // StrictMode's mount→unmount→mount rehearsal runs this cleanup too, so the
  // flag is set in the body rather than at `useRef`.
  //
  // 🚨 A PICK MADE JUST BEFORE LEAVING THE TAB IS STILL A PICK. This selector
  // mounts only under the System Configuration tab. Cancelling the settle timer
  // at unmount — which is all this cleanup used to do — silently discarded any
  // pick made in the last SETTLE_MS before the operator clicked away: the
  // select showed it, the server never heard of it. So a pending pick is sent
  // NOW, and the page is told NOW, synchronously, while this component still
  // knows which project it belongs to. Nothing is reported after unmount (see
  // `mountedRef`); `keepalive` lets the request outlive a closing tab.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (settleTimer.current) { clearTimeout(settleTimer.current); settleTimer.current = null; }
      const pending = pendingPick.current;
      pendingPick.current = null;
      if (pending) {
        // Registered as unsettled so a return to the tab reads AFTER it lands.
        const close = openWrite(pending.projectId);
        void postPick(pending, { keepalive: true })
          .then(res => res.json())
          .then(
            j => { if (!j?.success) noteUnseenFailure(pending.projectId, 'pick', j?.refusals?.[0]?.message ?? j?.error); },
            e => noteUnseenFailure(pending.projectId, 'pick', (e as Error)?.message),
          )
          .finally(close);
      }
      // The page's copy drives every SLD / BOM / permit payload. A pick that was
      // pending, or a pick or Clear whose request is still in flight, would
      // otherwise reach the server and never the page — the Diagram tab would
      // draw the old device the moment after the installer chose a new one.
      //
      // ⚠ KNOWN DIVERGENCE, BOUNDED. This is told before the server answers. If
      // the write is then refused (a 409, a 429 from the shared `engineering`
      // rate-limit bucket) or never arrives, the page's SLD and BOM payloads carry
      // the chosen device while the project record — which the permit route
      // reads — does not, until the operator next opens System Configuration:
      // that load waits for the write, re-reports the record, and says why the
      // select changed. Correcting the page sooner needs a late answer the PAGE
      // can reject when it belongs to another project (a `forProjectId` on
      // `onSelectionChanged`, checked in app/engineering/page.tsx); reporting a
      // late answer without that check could put one project's device on
      // another's drawings, which is worse than this.
      const told = pending ?? inFlight.current;
      if (told && told.projectId === projectRef.current) onSelectionChangedRef.current?.(told.id);
    };
  }, []);

  // 🚨 A SELECTION IS NOT PORTABLE BETWEEN PROJECTS. Drop it BEFORE the fetch.
  //
  // `load` reports the new project's answer only once the request lands. Until
  // then this component would go on DISPLAYING the previous project's device and
  // the page would go on SENDING it — and a reported `selectedCombinerId`
  // outranks every other authority downstream. Reset first, then load: a moment
  // of "nothing selected" is true, where a moment of the wrong device is not.
  //
  // 🚨 ONLY WHEN THE PROJECT ACTUALLY CHANGES. This used to run on EVERY mount —
  // every return to the System Configuration tab — and report null; the page
  // then dropped the combiner its own loader had read from the project, and the
  // SLD with it. A pick still settling for the OLD project is the one case that
  // is cancelled rather than flushed: the operator moved to another project
  // mid-browse, and nothing about the old project may be sent or reported from
  // under the new one.
  useEffect(() => {
    if (resetForProject.current === projectId) return;
    resetForProject.current = projectId;
    if (settleTimer.current) { clearTimeout(settleTimer.current); settleTimer.current = null; }
    pendingPick.current = null; inFlight.current = null;
    setSelected(null); setCandidates([]); setPairing(null); setDraftId(''); setError(null); setBusy(false);
    if (visibleRef.current) onSelectionChangedRef.current?.(null);
  }, [projectId]);

  useEffect(() => { if (visible) void load(); }, [visible, load]);

  if (!visible) return null;

  const save = async (pick: UnsavedPick) => {
    const forProject = pick.projectId;
    if (projectRef.current !== forProject || pick.id === selected?.combinerDeviceId) return;
    inFlight.current = pick;
    setBusy(true); setError(null);
    const close = openWrite(forProject);
    try {
      const res = await postPick(pick);
      const j = await res.json();
      // Unmounted mid-save: if the page was told this pick at unmount (it was
      // still `inFlight` — a project change would have dropped it), a refusal
      // is recorded for the next load to state rather than silently dropped.
      if (!mountedRef.current) {
        if (!j?.success && inFlight.current === pick) {
          noteUnseenFailure(forProject, 'pick', j?.refusals?.[0]?.message ?? j?.error);
        }
        return;
      }
      if (projectRef.current !== forProject) return;
      if (j?.success) {
        setSelected(j.selected ?? null);
        onSelectionChangedRef.current?.(j.selected?.combinerDeviceId ?? null);
      } else {
        setDraftId(selected?.combinerDeviceId ?? '');
        setError(j?.refusals?.[0]?.message ?? j?.error ?? 'The selection could not be saved.');
      }
    } catch (e) {
      if (!mountedRef.current) {
        if (inFlight.current === pick) noteUnseenFailure(forProject, 'pick', (e as Error)?.message);
      } else if (projectRef.current === forProject) {
        setDraftId(selected?.combinerDeviceId ?? '');
        setError((e as Error).message || 'The selection could not be saved.');
      }
    } finally {
      if (inFlight.current === pick) inFlight.current = null;
      if (mountedRef.current && projectRef.current === forProject) setBusy(false);
      close();
    }
  };

  const choose = (id: string) => {
    setDraftId(id); setError(null);
    if (settleTimer.current) { clearTimeout(settleTimer.current); settleTimer.current = null; }
    pendingPick.current = null;
    const forProject = projectRef.current;
    // Settling back on the device already recorded is not a change: nothing to
    // send, and nothing for the unmount flush to send either.
    if (!id || !forProject || id === selected?.combinerDeviceId) return;
    const pick: UnsavedPick = { projectId: forProject, id, inverterId: inverterId ?? null };
    pendingPick.current = pick;
    settleTimer.current = setTimeout(() => {
      settleTimer.current = null;
      if (pendingPick.current === pick) pendingPick.current = null;
      void save(pick);
    }, SETTLE_MS);
  };

  const clear = async () => {
    const forProject = projectRef.current;
    if (!forProject) return;
    if (settleTimer.current) { clearTimeout(settleTimer.current); settleTimer.current = null; }
    pendingPick.current = null;
    const clearing = { projectId: forProject, id: null };
    inFlight.current = clearing;
    setBusy(true); setError(null);
    const close = openWrite(forProject);
    try {
      const res = await fetch(`/api/projects/${forProject}/combiner-selection`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Equipment decision reopened from System Configuration.' }),
      });
      const j = await res.json();
      if (!mountedRef.current) {
        if (!j?.success && inFlight.current === clearing) {
          noteUnseenFailure(forProject, 'clear', j?.refusals?.[0]?.message ?? j?.error);
        }
        return;
      }
      if (projectRef.current !== forProject) return;
      if (j?.success) { setSelected(null); setDraftId(''); onSelectionChangedRef.current?.(null); }
      else setError(j?.refusals?.[0]?.message ?? j?.error ?? 'The selection could not be cleared.');
    } catch (e) {
      if (!mountedRef.current) {
        if (inFlight.current === clearing) noteUnseenFailure(forProject, 'clear', (e as Error)?.message);
      } else if (projectRef.current === forProject) setError((e as Error).message);
    } finally {
      if (inFlight.current === clearing) inFlight.current = null;
      if (mountedRef.current && projectRef.current === forProject) setBusy(false);
      close();
    }
  };

  const pairedNames = pairing
    ? pairing.combinerIds
        .map(id => candidates.find(c => c.id === id))
        .filter((c): c is Candidate => !!c)
        .map(c => `${c.brand} ${c.model}`)
    : [];

  return (
    <div className="col-span-2 rounded-lg border border-slate-700/60 bg-slate-900/40 p-3 mb-2.5">
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <label className="eng-label !mb-0">AC Combiner / Envoy — what you are installing</label>
        {loading ? <span className="text-[10px] text-slate-500">loading…</span>
          : busy ? <span className="text-[10px] text-slate-500">saving…</span> : null}
      </div>

      {/* WHAT IS SELECTED — or, deliberately, that nothing is. */}
      {selected ? (
        <div className="text-xs text-emerald-300 font-semibold mb-2">
          {selected.manufacturer} {selected.model}
          <span className="block text-[10px] font-normal text-slate-400 mt-0.5">
            Selected by {selected.selectedBy}
            {selected.basis ? <span className="text-slate-500"> · {selected.basis}</span> : null}
          </span>
        </div>
      ) : (
        <div className="text-xs text-amber-300 font-semibold mb-2">
          No combiner selected
          <span className="block text-[10px] font-normal text-slate-400 mt-0.5">
            The drawings will show a device derived from compatibility, marked as not yet selected.
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select
          className="eng-select flex-1 min-w-[180px]"
          value={draftId}
          disabled={busy}
          onChange={e => choose(e.target.value)}
        >
          <option value="">— choose a combiner —</option>
          {candidates.map(c => (
            <option key={c.id} value={c.id}>{c.brand} {c.model}</option>
          ))}
        </select>
        {selected ? (
          <button className="btn-ghost btn-sm" onClick={clear} disabled={busy} title="Reopen the equipment decision">
            Clear
          </button>
        ) : null}
      </div>

      <p className="text-[10px] text-slate-500 mt-1.5">
        Each IQ Combiner has the IQ Gateway (Envoy) built in. Any one can be selected
        {pairedNames.length > 0 && pairing
          ? ` — the catalogue pairs ${pairing.inverterLabel} with ${pairedNames.join(', ')} (information only).`
          : '.'}
      </p>

      {error ? <p className="mt-1.5 text-[11px] text-rose-300">{error}</p> : null}
    </div>
  );
}
