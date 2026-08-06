'use client';
// components/project/RailSelectionPanel.tsx
// D12 — THE OPERATOR SURFACE for the racking rail selection.
//
// WHAT THIS PANEL IS FOR. WS-8 established that for a mixed-manufacturer mount
// the rail is genuinely unselected and the engine may not pick one — but it also
// established what automation still owes: the operator must not be asked to
// RESEARCH. The server derives the required span, every rail the mount's own
// compatibility statement admits, and which of them cover that span. This panel
// renders that shortlist so the remaining act is ONE choice.
//
// FOUR RULES IT EXISTS TO OBEY:
//
//   1. IT NEVER RANKS BY PRICE OR BRAND, and never marks a "recommended" rail.
//      The screen is span coverage — an engineering fact. Which admitted rail to
//      buy is the operator's decision and the panel does not lean on it.
//
//   2. A REFUSED CANDIDATE IS SHOWN, WITH ITS REASON, rather than hidden. An
//      operator who cannot see why their preferred rail is not offered will
//      conclude the tool is broken; one who reads "published maximum span 48in is
//      below the mount's 64in attachment spacing" learns something true.
//
//   3. PINNING A SHORT-SPAN RAIL REQUIRES TYPING THE AUTHORITY, not ticking a
//      box. There is no "override" checkbox anywhere in this file, because an
//      override that cannot name its authority is indistinguishable from a
//      mistake.
//
//   4. NO PART NUMBER IS EVER SHOWN. mounting-hardware-db carries none, and a
//      blank where a SKU would go is more honest than a plausible-looking string.
//      The panel says so out loud.
//
// The capability check hides actions the actor cannot perform. That is a
// COURTESY, not the control: every write is re-authorised server-side.

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, Link2, Link2Off, AlertTriangle, CheckCircle2, Info } from 'lucide-react';

interface Candidate {
  systemId: string;
  manufacturer: string;
  railModel: string;
  maxSpanIn: number;
  maxCantileverIn: number;
  momentCapacityInLbs: number;
  spliceIntervalIn: number;
  ul2703Listed: boolean;
  iccEsReport: string | null;
  spanCovers: boolean;
  requiredSpanIn: number | null;
  refusedReason: string | null;
  partNumber: null;
}

interface Pinned {
  railSystemId: string;
  manufacturer: string;
  railModel: string;
  railSku: string | null;
  selectedBy: string;
  selectedAtIso: string;
  basis: string;
  coversSpan: boolean;
  spanOverrideAuthority: string | null;
}

interface RailSelectionResponse {
  success: boolean;
  state: 'inherent' | 'selected' | 'unselected' | 'no-rail-required';
  mountingSystemId: string | null;
  compatibilityStatement: string | null;
  requiredSpanIn: number | null;
  candidates: Candidate[];
  eligibleCandidateCount: number;
  pinned: Pinned | null;
  basis: string;
  operatorAction: string | null;
  partNumberAvailability: string;
  history: Array<{ railModel: string; manufacturer: string; selectedBy: string; selectedAtIso: string; supersededReason?: string }>;
  capabilities: string[];
  accessBasis: string;
}

export default function RailSelectionPanel({ projectId }: { projectId: string }) {
  const [data, setData] = useState<RailSelectionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refusals, setRefusals] = useState<Array<{ code: string; message: string }>>([]);
  const [choice, setChoice] = useState<string | null>(null);
  const [basis, setBasis] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideAuthority, setOverrideAuthority] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/rail-selection`);
      const json = await res.json();
      if (!json.success) { setError(json.error ?? 'Failed to load the rail selection.'); setData(null); }
      else setData(json as RailSelectionResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load the rail selection.');
    } finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const selected = data?.candidates.find(c => c.systemId === choice) ?? null;
  const needsAuthority = !!selected && selected.refusedReason != null;

  const pin = async () => {
    if (!choice) return;
    setBusy(true); setRefusals([]); setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/rail-selection`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          railSystemId: choice, basis,
          spanOverride: needsAuthority ? { reason: overrideReason, authority: overrideAuthority } : null,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        if (Array.isArray(json.refusals)) setRefusals(json.refusals);
        else setError(json.error ?? 'The rail could not be pinned.');
      } else {
        setChoice(null); setBasis(''); setOverrideReason(''); setOverrideAuthority('');
        await load();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The rail could not be pinned.');
    } finally { setBusy(false); }
  };

  const unpin = async () => {
    const reason = window.prompt('Why is the rail selection being retired? This is recorded with the design history.');
    if (!reason?.trim()) return;
    setBusy(true); setRefusals([]); setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/rail-selection?reason=${encodeURIComponent(reason)}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.success) {
        if (Array.isArray(json.refusals)) setRefusals(json.refusals);
        else setError(json.error ?? 'The rail selection could not be retired.');
      } else await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The rail selection could not be retired.');
    } finally { setBusy(false); }
  };

  if (loading) {
    return (
      <div className="rounded-lg border border-slate-200 p-4 flex items-center gap-2 text-sm text-slate-600">
        <Loader2 className="w-4 h-4 animate-spin" /> Deriving the rail shortlist…
      </div>
    );
  }
  if (error && !data) {
    return <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">{error}</div>;
  }
  if (!data) return null;

  const canPin = data.capabilities.includes('rail.selection.pin');
  const canUnpin = data.capabilities.includes('rail.selection.unpin');

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <Link2 className="w-4 h-4 text-slate-500" />
          <h3 className="font-semibold text-slate-800 text-sm">RACKING RAIL SELECTION</h3>
        </div>
        <button onClick={() => void load()} className="text-slate-500 hover:text-slate-800" title="Reload">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* ── the derived state, in the server's own words ── */}
        <p className="text-xs text-slate-600 leading-relaxed">{data.basis}</p>

        {data.state === 'no-rail-required' && (
          <div className="flex items-start gap-2 rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
            <Info className="w-4 h-4 mt-0.5 shrink-0" />
            <span>No rail is part of this assembly, so there is nothing to select.</span>
          </div>
        )}

        {data.state === 'inherent' && (
          <div className="flex items-start gap-2 rounded border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
            <span>The rail comes with the selected mount. It was not chosen separately, so there is no selector, no actor and no basis to record.</span>
          </div>
        )}

        {/* ── the selection in force ── */}
        {data.pinned && (
          <div className={`rounded border p-3 text-xs ${data.pinned.coversSpan ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-amber-400 bg-amber-50 text-amber-900'}`}>
            <div className="font-semibold">
              {data.pinned.coversSpan ? 'RAIL SPECIFIED' : 'RAIL SPECIFIED UNDER STATED SPAN AUTHORITY'}
              {' — '}{data.pinned.manufacturer} {data.pinned.railModel}
            </div>
            <div className="mt-1">Pinned by {data.pinned.selectedBy} at {data.pinned.selectedAtIso}.</div>
            <div className="mt-1">Basis: {data.pinned.basis}</div>
            {data.pinned.spanOverrideAuthority && (
              <div className="mt-1">Span authority: {data.pinned.spanOverrideAuthority}</div>
            )}
            <div className="mt-1 text-[11px] opacity-80">
              No orderable part number: the hardware catalog carries none for any rail. The SKU comes from the distributor line item.
            </div>
            {canUnpin && (
              <button onClick={() => void unpin()} disabled={busy}
                className="mt-2 inline-flex items-center gap-1 rounded border border-current px-2 py-1 font-medium disabled:opacity-50">
                <Link2Off className="w-3 h-3" /> Retire this selection
              </button>
            )}
          </div>
        )}

        {/* ── the shortlist ── */}
        {data.state === 'unselected' && (
          <>
            {data.compatibilityStatement && (
              <p className="text-[11px] text-slate-500">
                The mount&apos;s documented compatibility statement: “{data.compatibilityStatement}”
                {data.requiredSpanIn != null && <> · attachment spacing {data.requiredSpanIn}&quot;</>}
              </p>
            )}
            <div className="space-y-2">
              {data.candidates.map(c => {
                const refused = c.refusedReason != null;
                return (
                  <label key={c.systemId}
                    className={`flex items-start gap-3 rounded border p-3 cursor-pointer ${
                      choice === c.systemId ? 'border-blue-500 bg-blue-50' : refused ? 'border-slate-200 bg-slate-50' : 'border-slate-200'}`}>
                    <input type="radio" name="rail" className="mt-1" disabled={!canPin}
                      checked={choice === c.systemId} onChange={() => setChoice(c.systemId)} />
                    <div className="text-xs">
                      <div className="font-semibold text-slate-800">{c.manufacturer} {c.railModel}</div>
                      <div className="text-slate-600">
                        max span {c.maxSpanIn}&quot; · cantilever {c.maxCantileverIn}&quot; · moment {c.momentCapacityInLbs} in-lb ·
                        splice every {c.spliceIntervalIn}&quot;{c.ul2703Listed ? ' · UL 2703 listed' : ''}
                        {c.iccEsReport ? ` · ${c.iccEsReport}` : ''}
                      </div>
                      {refused
                        ? <div className="mt-1 flex items-start gap-1 text-amber-800">
                            <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" /><span>{c.refusedReason}</span>
                          </div>
                        : <div className="mt-1 text-emerald-800">Covers the mount&apos;s attachment spacing.</div>}
                    </div>
                  </label>
                );
              })}
              {data.candidates.length === 0 && (
                <div className="rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                  No catalog rail matches this mount&apos;s documented compatibility statement. The rail must be selected
                  outside the catalog and its span authority supplied.
                </div>
              )}
            </div>

            {canPin && choice && (
              <div className="space-y-2 rounded border border-slate-300 p-3">
                <label className="block text-xs font-medium text-slate-700">
                  Why this rail? <span className="font-normal text-slate-500">(recorded with the selection)</span>
                  <input value={basis} onChange={e => setBasis(e.target.value)}
                    placeholder="e.g. distributor stocks this rail and its splice hardware"
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs" />
                </label>
                {needsAuthority && (
                  <div className="space-y-2 rounded border border-amber-400 bg-amber-50 p-2">
                    <p className="text-[11px] text-amber-900">
                      This rail&apos;s published span does not cover the mount&apos;s attachment spacing. It can still be
                      specified — naming the engineering authority that admits it.
                    </p>
                    <input value={overrideReason} onChange={e => setOverrideReason(e.target.value)}
                      placeholder="What changed? e.g. attachment spacing reduced to 32in on this roof"
                      className="w-full rounded border border-amber-400 px-2 py-1 text-xs" />
                    <input value={overrideAuthority} onChange={e => setOverrideAuthority(e.target.value)}
                      placeholder="The document or stamped record — e.g. PE letter 2026-08-04, J. Rivera PE IL-062-041234"
                      className="w-full rounded border border-amber-400 px-2 py-1 text-xs" />
                  </div>
                )}
                <button onClick={() => void pin()} disabled={busy}
                  className="inline-flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
                  {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />} Pin this rail
                </button>
              </div>
            )}

            {!canPin && (
              <p className="text-[11px] text-slate-500">
                Pinning the rail closes a release requirement and requires admin-or-above. Your access: {data.accessBasis}.
              </p>
            )}
          </>
        )}

        {/* ── refusals, verbatim from the service ── */}
        {refusals.length > 0 && (
          <div className="rounded border border-red-300 bg-red-50 p-3 text-xs text-red-900 space-y-1">
            {refusals.map(r => <div key={r.code}><span className="font-semibold">{r.code}</span> — {r.message}</div>)}
          </div>
        )}
        {error && <div className="rounded border border-red-300 bg-red-50 p-3 text-xs text-red-900">{error}</div>}

        {/* ── superseded selections ── */}
        {data.history.length > 0 && (
          <details className="text-[11px] text-slate-500">
            <summary className="cursor-pointer">Previous selections ({data.history.length})</summary>
            <ul className="mt-1 space-y-1">
              {data.history.map((h, i) => (
                <li key={i}>
                  {h.manufacturer} {h.railModel} — pinned by {h.selectedBy} at {h.selectedAtIso}
                  {h.supersededReason ? ` · retired: ${h.supersededReason}` : ''}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
