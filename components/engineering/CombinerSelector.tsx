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

export default function CombinerSelector({ projectId, visible, inverterId, onSelectionChanged }: CombinerSelectorProps) {
  // Held in a ref so `load` does not re-create on every parent render, which
  // would re-fire the effect and re-fetch on every keystroke elsewhere.
  const onSelectionChangedRef = useRef(onSelectionChanged);
  onSelectionChangedRef.current = onSelectionChanged;
  // The project a response belongs to. A POST or GET that lands after the
  // operator switched projects must not write another project's answer here.
  const projectRef = useRef(projectId);
  projectRef.current = projectId;
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      const q = inverterId ? `?inverterId=${encodeURIComponent(inverterId)}` : '';
      const res = await fetch(`/api/projects/${projectId}/combiner-selection${q}`, { cache: 'no-store' });
      const j = await res.json();
      if (projectRef.current !== forProject) return;
      if (j?.success) {
        setSelected(j.selected ?? null);
        setCandidates(Array.isArray(j.candidates) ? j.candidates : []);
        setPairing(j.pairing && Array.isArray(j.pairing.combinerIds) ? j.pairing : null);
        setDraftId(j.selected?.combinerDeviceId ?? '');
        // Report on LOAD as well as on change. Without this the page holds null
        // until the operator touches the control, and the first SLD of a session
        // would be drawn without the selection the project already carries.
        onSelectionChangedRef.current?.(j.selected?.combinerDeviceId ?? null);
      }
    } catch { /* the panel stays empty rather than asserting anything */ }
    finally { if (projectRef.current === forProject) setLoading(false); }
  }, [projectId, inverterId]);

  // 🚨 A SELECTION IS NOT PORTABLE BETWEEN PROJECTS. Drop it BEFORE the fetch.
  //
  // `load` reports the new project's answer only once the request lands. Until
  // then this component would go on DISPLAYING the previous project's device and
  // the page would go on SENDING it — and a reported `selectedCombinerId`
  // outranks every other authority downstream. Reset first, then load: a moment
  // of "nothing selected" is true, where a moment of the wrong device is not.
  useEffect(() => {
    if (settleTimer.current) { clearTimeout(settleTimer.current); settleTimer.current = null; }
    setSelected(null); setCandidates([]); setPairing(null); setDraftId(''); setError(null); setBusy(false);
    onSelectionChangedRef.current?.(null);
  }, [projectId]);

  useEffect(() => { if (visible) void load(); }, [visible, load]);

  useEffect(() => () => { if (settleTimer.current) clearTimeout(settleTimer.current); }, []);

  if (!visible) return null;

  const save = async (id: string) => {
    const forProject = projectRef.current;
    if (!forProject || !id || id === selected?.combinerDeviceId) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/projects/${forProject}/combiner-selection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ combinerDeviceId: id, inverterId: inverterId ?? null }),
      });
      const j = await res.json();
      if (projectRef.current !== forProject) return;
      if (j?.success) {
        setSelected(j.selected ?? null);
        onSelectionChangedRef.current?.(j.selected?.combinerDeviceId ?? null);
      } else {
        setDraftId(selected?.combinerDeviceId ?? '');
        setError(j?.refusals?.[0]?.message ?? j?.error ?? 'The selection could not be saved.');
      }
    } catch (e) {
      if (projectRef.current === forProject) {
        setDraftId(selected?.combinerDeviceId ?? '');
        setError((e as Error).message || 'The selection could not be saved.');
      }
    } finally { if (projectRef.current === forProject) setBusy(false); }
  };

  const choose = (id: string) => {
    setDraftId(id); setError(null);
    if (settleTimer.current) clearTimeout(settleTimer.current);
    if (!id) return;
    settleTimer.current = setTimeout(() => { settleTimer.current = null; void save(id); }, SETTLE_MS);
  };

  const clear = async () => {
    const forProject = projectRef.current;
    if (!forProject) return;
    if (settleTimer.current) { clearTimeout(settleTimer.current); settleTimer.current = null; }
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/projects/${forProject}/combiner-selection`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Equipment decision reopened from System Configuration.' }),
      });
      const j = await res.json();
      if (projectRef.current !== forProject) return;
      if (j?.success) { setSelected(null); setDraftId(''); onSelectionChangedRef.current?.(null); }
      else setError(j?.refusals?.[0]?.message ?? j?.error ?? 'The selection could not be cleared.');
    } catch (e) {
      if (projectRef.current === forProject) setError((e as Error).message);
    } finally { if (projectRef.current === forProject) setBusy(false); }
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
