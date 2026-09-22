'use client';

// ═══════════════════════════════════════════════════════════════════════════
// PROJECT-SELECTED COMBINER — the installer's answer, on the project.
//
// "The SLD is currently showing an IQ Combiner 6C. I am still installing IQ
// Combiner 5C."
//
// There WAS already a combiner control: a bare <select> in the SLD tab's toolbar
// writing `config.combinerId` into `projects.engineering_config` — the
// engineering page's private workspace. It had no actor, no reason, no history
// and no compatibility statement, and the canonical store every other consumer
// reads (`projects.selected_equipment`) never received it. So the drawing could
// be corrected while the BOM, the schedule and the permit package went on naming
// whatever a resolver had guessed.
//
// This control writes the canonical record instead. It states what the catalogue
// declares, it makes the installer say WHY, and it never substitutes: a device
// the inverter's declaration excludes is REFUSED with its reason shown, and
// selecting it anyway requires stated engineering authority.
//
// 🚨 IT DOES NOT RECOMMEND BY DEFAULT. With nothing selected the control says
// so, in those words. An unanswered question must look unanswered — that is the
// entire defect this replaces.
// ═══════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useState } from 'react';

interface Candidate { id: string; brand: string; model: string }

interface SelectionRecord {
  combinerDeviceId: string;
  manufacturer: string;
  model: string;
  basis: string;
  selectedBy: string;
  selectedAtIso: string;
  compatibility: { declaredCompatibleIds: string[] | null; declaredCompatible: boolean; source: string };
  compatibilityOverride: { reason: string; authority: string } | null;
}

interface Refusal { code: string; message: string }

export interface CombinerSelectorProps {
  projectId: string | null | undefined;
  /** Combiners are an Enphase-microinverter concept today; hidden otherwise. */
  visible: boolean;
  /** Told the new device id (or null) so the page can drop a stale SLD. */
  onSelectionChanged?: (deviceId: string | null) => void;
}

export default function CombinerSelector({ projectId, visible, onSelectionChanged }: CombinerSelectorProps) {
  // Held in a ref so `load` does not re-create on every parent render, which
  // would re-fire the effect and re-fetch on every keystroke elsewhere.
  const onSelectionChangedRef = React.useRef(onSelectionChanged);
  onSelectionChangedRef.current = onSelectionChanged;
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<SelectionRecord | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [declared, setDeclared] = useState<string[] | null>(null);
  const [refusals, setRefusals] = useState<Refusal[]>([]);
  const [draftId, setDraftId] = useState('');
  const [basis, setBasis] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideAuthority, setOverrideAuthority] = useState('');

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/combiner-selection`, { cache: 'no-store' });
      const j = await res.json();
      if (j?.success) {
        setSelected(j.selected ?? null);
        setCandidates(Array.isArray(j.candidates) ? j.candidates : []);
        setDeclared(Array.isArray(j.declaredCompatibleIds) ? j.declaredCompatibleIds : null);
        setDraftId(j.selected?.combinerDeviceId ?? '');
        // Report on LOAD as well as on change. Without this the page holds null
        // until the operator touches the control, and the first SLD of a session
        // would be drawn without the selection the project already carries.
        onSelectionChangedRef.current?.(j.selected?.combinerDeviceId ?? null);
      }
    } catch { /* the panel stays empty rather than asserting anything */ }
    finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { if (visible) void load(); }, [visible, load]);

  if (!visible) return null;

  // A conflict is shown BEFORE the operator submits, so the override fields are
  // offered rather than sprung on them by a refusal.
  const conflict = Boolean(draftId && declared && declared.length > 0 && !declared.includes(draftId));

  const submit = async () => {
    if (!projectId || !draftId) return;
    setBusy(true); setRefusals([]);
    try {
      const res = await fetch(`/api/projects/${projectId}/combiner-selection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          combinerDeviceId: draftId,
          basis,
          compatibilityOverride: conflict ? { reason: overrideReason, authority: overrideAuthority } : null,
        }),
      });
      const j = await res.json();
      if (j?.success) {
        setSelected(j.selected ?? null);
        setBasis(''); setOverrideReason(''); setOverrideAuthority('');
        onSelectionChanged?.(j.selected?.combinerDeviceId ?? null);
      } else {
        setRefusals(Array.isArray(j?.refusals) ? j.refusals : [{ code: 'ERROR', message: j?.error ?? 'Refused.' }]);
      }
    } catch (e) {
      setRefusals([{ code: 'NETWORK', message: (e as Error).message }]);
    } finally { setBusy(false); }
  };

  const clear = async () => {
    if (!projectId) return;
    setBusy(true); setRefusals([]);
    try {
      const res = await fetch(`/api/projects/${projectId}/combiner-selection`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Equipment decision reopened from System Configuration.' }),
      });
      const j = await res.json();
      if (j?.success) { setSelected(null); setDraftId(''); onSelectionChanged?.(null); }
      else setRefusals(Array.isArray(j?.refusals) ? j.refusals : [{ code: 'ERROR', message: j?.error ?? 'Refused.' }]);
    } catch (e) {
      setRefusals([{ code: 'NETWORK', message: (e as Error).message }]);
    } finally { setBusy(false); }
  };

  return (
    <div className="col-span-2 rounded-lg border border-slate-700/60 bg-slate-900/40 p-3 mb-2.5">
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <label className="eng-label !mb-0">AC Combiner — what you are installing</label>
        {loading ? <span className="text-[10px] text-slate-500">loading…</span> : null}
      </div>

      {/* WHAT IS SELECTED — or, deliberately, that nothing is. */}
      {selected ? (
        <div className="text-xs text-emerald-300 font-semibold mb-2">
          {selected.manufacturer} {selected.model}
          <span className="block text-[10px] font-normal text-slate-400 mt-0.5">
            Selected by {selected.selectedBy} · {selected.basis}
            {selected.compatibilityOverride
              ? ` · override: ${selected.compatibilityOverride.authority}`
              : ''}
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
          onChange={e => { setDraftId(e.target.value); setRefusals([]); }}
        >
          <option value="">— choose a combiner —</option>
          {candidates.map(c => (
            <option key={c.id} value={c.id}>
              {c.brand} {c.model}
              {declared && declared.length > 0 ? (declared.includes(c.id) ? '  (declared compatible)' : '  (not declared)') : ''}
            </option>
          ))}
        </select>
        <input
          className="eng-input flex-1 min-w-[180px]"
          placeholder="Why this device (required)"
          value={basis}
          disabled={busy}
          onChange={e => setBasis(e.target.value)}
        />
        <button className="btn-primary btn-sm" onClick={submit} disabled={busy || !draftId}>
          {busy ? 'Saving…' : selected ? 'Change' : 'Select'}
        </button>
        {selected ? (
          <button className="btn-ghost btn-sm" onClick={clear} disabled={busy} title="Reopen the equipment decision">
            Clear
          </button>
        ) : null}
      </div>

      {/* The catalogue's own statement, said plainly in both directions. */}
      <p className="text-[10px] text-slate-500 mt-1.5">
        {declared && declared.length > 0
          ? `This inverter declares: ${declared.join(', ')}. A declaration is a compatibility statement, not a selection.`
          : 'The catalogue declares no combiner pairing for this inverter. That is missing data, not incompatibility — Enphase documents IQ6/IQ7/IQ8 support on both the 5/5C and the 6C.'}
      </p>

      {conflict ? (
        <div className="mt-2 rounded border border-amber-500/40 bg-amber-500/10 p-2">
          <p className="text-[11px] text-amber-300 font-semibold mb-1.5">
            This inverter&apos;s declaration does not name that combiner. It will not be substituted — state the
            authority that admits the pairing.
          </p>
          <div className="flex flex-wrap gap-2">
            <input className="eng-input flex-1 min-w-[160px]" placeholder="Reason" value={overrideReason}
              disabled={busy} onChange={e => setOverrideReason(e.target.value)} />
            <input className="eng-input flex-1 min-w-[160px]" placeholder="Authority (datasheet / brief / letter)"
              value={overrideAuthority} disabled={busy} onChange={e => setOverrideAuthority(e.target.value)} />
          </div>
        </div>
      ) : null}

      {refusals.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {refusals.map((r, i) => (
            <li key={`${r.code}-${i}`} className="text-[11px] text-rose-300">
              <span className="font-mono text-rose-400">{r.code}</span> — {r.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
