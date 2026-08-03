'use client';
// components/project/RouteMeasurementPanel.tsx
// WS-5 — THE OPERATOR SURFACE for field route measurements.
//
// FOUR RULES THIS COMPONENT EXISTS TO OBEY, all of them about not overstating:
//
//   1. AN UNVERIFIED REPORT NEVER GETS A GREEN VERIFIED BADGE. The states are
//      visually distinct and the amber "FIELD REPORTED — AWAITING VERIFICATION"
//      is deliberately not reassuring. A report is a claim.
//
//   2. WHO MEASURED AND WHO VERIFIED ARE SHOWN SEPARATELY, always, even when
//      they are the same person — especially then, because a self-verification
//      is the case a reviewer most needs to see.
//
//   3. AN ACTION IS HIDDEN WHEN THE CAPABILITY IS ABSENT, and that is a
//      COURTESY, not the control. Every write is re-authorised server-side; this
//      component's opinion about permissions is never load-bearing.
//
//   4. THE VOLTAGE-DROP GRADE IS PRINTED WITH ITS QUALIFIER. "PROVISIONAL PASS"
//      is not "PASS" with extra words — it is a different conclusion, and the
//      bare checkmark is reserved for VERIFIED PASS.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Ruler, ShieldCheck, AlertTriangle, XCircle, History, Loader2,
  CheckCircle2, Ban, Plus, RefreshCw,
} from 'lucide-react';

// ── shapes mirrored from the API (kept narrow: the panel renders, it does not
//    re-derive authority) ─────────────────────────────────────────────────────

interface RouteFact {
  segmentId: string;
  exists: boolean;
  routeOwnership: 'PROJECT_OWNED' | 'UTILITY_OWNED';
  routeAuthorityApplicability: 'REQUIRED' | 'EXCLUDED' | 'NOT_APPLICABLE';
  routeApplicabilityReason: string | null;
  electricalFunction: string | null;
  from: string | null;
  to: string | null;
  cadEstimatedLengthFt: number | null;
  cadRoutedLengthFt: number | null;
  currentLengthSource: string | null;
  currentVerificationState: string | null;
}

interface Measurement {
  id: string;
  routeSegmentId: string;
  measuredLengthFt: number;
  measurementMethod: string;
  measuredByUserId: string;
  measuredAt: string;
  recordedAt: string;
  evidenceAttachmentIds: string[];
  notes: string | null;
  verificationState: 'REPORTED_UNVERIFIED' | 'VERIFIED' | 'REJECTED' | 'SUPERSEDED';
  verificationMode: string | null;
  verifiedByUserId: string | null;
  verifiedAt: string | null;
  verificationNotes: string | null;
  evidenceExceptionReason: string | null;
  rejectedByUserId: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  supersedesMeasurementId: string | null;
  supersededByMeasurementId: string | null;
}

interface RouteRow {
  route: RouteFact;
  measurements: Measurement[];
  active: Measurement | null;
  hasOnlyRetiredRecords: boolean;
}

interface RollUp {
  routes: RouteRow[];
  capabilities: string[];
  accessBasis: string;
  allowAuthorizedSelfVerification: boolean;
  currentUserId: string;
  methods: string[];
}

// ── the six operator-facing states, and their presentation ──────────────────
// Named exactly as WS-5 §9 requires so a screenshot can be checked against the
// spec without interpretation.

type PanelState =
  | 'NO FIELD MEASUREMENT'
  | 'FIELD REPORTED — AWAITING VERIFICATION'
  | 'FIELD VERIFIED'
  | 'FIELD MEASUREMENT REJECTED'
  | 'FIELD MEASUREMENT SUPERSEDED'
  | 'UTILITY-OWNED — EXCLUDED';

function panelState(row: RouteRow): PanelState {
  if (row.route.routeAuthorityApplicability !== 'REQUIRED') return 'UTILITY-OWNED — EXCLUDED';
  if (row.active?.verificationState === 'VERIFIED') return 'FIELD VERIFIED';
  if (row.active?.verificationState === 'REPORTED_UNVERIFIED') return 'FIELD REPORTED — AWAITING VERIFICATION';
  if (row.hasOnlyRetiredRecords) {
    const latest = row.measurements[0];
    return latest?.verificationState === 'SUPERSEDED'
      ? 'FIELD MEASUREMENT SUPERSEDED'
      : 'FIELD MEASUREMENT REJECTED';
  }
  return 'NO FIELD MEASUREMENT';
}

const STATE_STYLE: Record<PanelState, { cls: string; icon: React.ReactNode }> = {
  'NO FIELD MEASUREMENT': { cls: 'bg-slate-700/40 text-slate-300 border-slate-600', icon: <Ruler className="w-3.5 h-3.5" /> },
  // Amber, and worded so it cannot be skimmed as "done".
  'FIELD REPORTED — AWAITING VERIFICATION': { cls: 'bg-amber-500/15 text-amber-300 border-amber-500/40', icon: <AlertTriangle className="w-3.5 h-3.5" /> },
  // The ONLY green in this component.
  'FIELD VERIFIED': { cls: 'bg-green-500/15 text-green-300 border-green-500/40', icon: <ShieldCheck className="w-3.5 h-3.5" /> },
  'FIELD MEASUREMENT REJECTED': { cls: 'bg-red-500/15 text-red-300 border-red-500/40', icon: <XCircle className="w-3.5 h-3.5" /> },
  'FIELD MEASUREMENT SUPERSEDED': { cls: 'bg-slate-600/30 text-slate-400 border-slate-500', icon: <History className="w-3.5 h-3.5" /> },
  'UTILITY-OWNED — EXCLUDED': { cls: 'bg-slate-800 text-slate-400 border-slate-700', icon: <Ban className="w-3.5 h-3.5" /> },
};

/** The authority label a sheet would print for this route's CURRENT source. The
 *  panel and the planset must say the same words. */
function authorityLabel(row: RouteRow): string {
  if (row.route.routeAuthorityApplicability !== 'REQUIRED') return 'UTILITY-OWNED — EXCLUDED';
  const st = row.active?.verificationState;
  if (st === 'VERIFIED') return 'FIELD VERIFIED';
  if (st === 'REPORTED_UNVERIFIED') return 'FIELD REPORTED — UNVERIFIED';
  if (row.route.currentLengthSource === 'cad-route') return 'CAD ROUTE — GEOMETRY DERIVED';
  return 'CAD-DERIVED ESTIMATE';
}

/** The release impact, stated rather than implied. */
function releaseImpact(row: RouteRow): { text: string; cls: string } {
  if (row.route.routeAuthorityApplicability !== 'REQUIRED') {
    return { text: 'Excluded from project route authority — no field measurement is owed.', cls: 'text-slate-400' };
  }
  if (row.active?.verificationState === 'VERIFIED') {
    return { text: 'Closes the field-verification requirement for this run.', cls: 'text-green-300' };
  }
  if (row.active?.verificationState === 'REPORTED_UNVERIFIED') {
    return {
      text: 'Supports PROVISIONAL calculations only — this run still holds ROUTE-LENGTH-ESTIMATE open until an authorised reviewer verifies it.',
      cls: 'text-amber-300',
    };
  }
  if (row.route.currentLengthSource === 'cad-route') {
    return { text: 'Geometry-derived: satisfies ROUTE-LENGTH-ESTIMATE, but never produces a VERIFIED PASS voltage drop.', cls: 'text-slate-300' };
  }
  return { text: 'Holds ROUTE-LENGTH-ESTIMATE open — a field-measured route length is owed for this run.', cls: 'text-amber-300' };
}

const num = (v: number | null | undefined): string => (v == null ? '—' : `${v} ft`);
const shortId = (v: string | null): string => (v ? `${v.slice(0, 8)}…` : '—');
const when = (v: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
};

export default function RouteMeasurementPanel({ projectId }: { projectId: string }) {
  const [data, setData] = useState<RollUp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [openForm, setOpenForm] = useState<string | null>(null);
  const [openHistory, setOpenHistory] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/route-measurements`);
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error ?? 'Could not load route measurements.');
        setData(null);
      } else {
        setData(json as RollUp);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load route measurements.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const can = useCallback(
    (cap: string) => !!data?.capabilities?.includes(cap),
    [data],
  );

  const post = useCallback(async (url: string, body: unknown, label: string) => {
    setBusy(label);
    setError(null);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        // The policy's reasons are the useful part of a refusal — show them all.
        const reasons = json?.details?.decision?.reasons as string[] | undefined;
        setError(reasons?.length ? reasons.join(' · ') : (json.error ?? 'The operation was refused.'));
        return false;
      }
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The operation failed.');
      return false;
    } finally {
      setBusy(null);
    }
  }, [load]);

  const applicable = useMemo(
    () => (data?.routes ?? []).filter(r => r.route.routeAuthorityApplicability === 'REQUIRED'),
    [data],
  );
  const verifiedCount = applicable.filter(r => r.active?.verificationState === 'VERIFIED').length;

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-slate-400">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading route measurements…
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4" data-testid="route-measurement-panel">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Ruler className="w-4 h-4 text-amber-400" /> Field Route Measurements
          </h3>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl">
            Recording a measurement is <span className="text-amber-300 font-medium">not</span> verification. A field
            report becomes the calculation length immediately and supports <span className="font-medium">provisional</span> results
            only; an authorised reviewer must verify it before it can support a final, permit-grade conclusion.
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="text-xs text-slate-400 hover:text-white flex items-center gap-1 shrink-0"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {data ? (
        <div className="text-xs text-slate-400" data-testid="route-measurement-summary">
          {verifiedCount} of {applicable.length} applicable project-owned route(s) hold a FIELD-VERIFIED length.
          {' '}Access: {data.accessBasis}.
          {data.allowAuthorizedSelfVerification
            ? ' This tenant permits authorized self-verification (it is recorded as such).'
            : ' Self-verification is not permitted in this tenant — the verifier must not be the recorder.'}
        </div>
      ) : null}

      {error ? (
        <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300" role="alert">
          {error}
        </div>
      ) : null}

      {!data || data.routes.length === 0 ? (
        <div className="rounded border border-slate-700 bg-slate-800/40 px-3 py-6 text-center text-xs text-slate-400"
             data-testid="route-measurement-empty">
          No electrical route segments are available for this project yet. Generate the permit set first — routes come
          from the canonical design, not from this panel.
        </div>
      ) : (
        <div className="space-y-3">
          {data.routes.map(row => {
            const st = panelState(row);
            const style = STATE_STYLE[st];
            const excluded = row.route.routeAuthorityApplicability !== 'REQUIRED';
            const impact = releaseImpact(row);
            const historyOpen = openHistory.has(row.route.segmentId);
            return (
              <div key={row.route.segmentId}
                   className="rounded border border-slate-700 bg-slate-800/40 overflow-hidden"
                   data-testid={`route-row-${row.route.segmentId}`}>
                <div className="px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-700/70">
                  <span className="font-mono text-xs text-amber-400">{row.route.segmentId}</span>
                  <span className="text-xs text-slate-300">
                    {row.route.from || '—'} → {row.route.to || '—'}
                  </span>
                  {row.route.electricalFunction ? (
                    <span className="text-[11px] text-slate-500">{row.route.electricalFunction}</span>
                  ) : null}
                  <span className={`ml-auto inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-semibold ${style.cls}`}
                        data-testid={`route-state-${row.route.segmentId}`}>
                    {style.icon}{st}
                  </span>
                </div>

                <div className="px-3 py-2 grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 text-[11px]">
                  <Field label="Ownership" value={row.route.routeOwnership} />
                  <Field label="Applicability" value={row.route.routeAuthorityApplicability} />
                  <Field label="CAD estimated" value={num(row.route.cadEstimatedLengthFt)} />
                  <Field label="CAD routed" value={num(row.route.cadRoutedLengthFt)} />
                  <Field label="Calculation length" value={num(row.active?.measuredLengthFt ?? row.route.cadEstimatedLengthFt ?? null)} />
                  <Field label="Length source" value={authorityLabel(row)} />
                  <Field label="Evidence" value={`${row.active?.evidenceAttachmentIds.length ?? 0} attachment(s)`} />
                  <Field label="History" value={`${row.measurements.length} record(s)`} />
                </div>

                {/* WHO MEASURED and WHO VERIFIED, separately — always. */}
                {row.active ? (
                  <div className="px-3 pb-2 grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 text-[11px]"
                       data-testid={`route-identities-${row.route.segmentId}`}>
                    <Field label="Measured by" value={`${shortId(row.active.measuredByUserId)} · ${when(row.active.measuredAt)} · ${row.active.measurementMethod}`} />
                    <Field
                      label="Verified by"
                      value={row.active.verifiedByUserId
                        ? `${shortId(row.active.verifiedByUserId)} · ${when(row.active.verifiedAt)} · ${row.active.verificationMode}`
                        : 'NOT VERIFIED'}
                      emphasis={row.active.verifiedByUserId ? 'ok' : 'warn'}
                    />
                  </div>
                ) : null}

                <div className={`px-3 py-2 text-[11px] border-t border-slate-700/70 ${impact.cls}`}
                     data-testid={`route-impact-${row.route.segmentId}`}>
                  {impact.text}
                  {excluded && row.route.routeApplicabilityReason ? (
                    <span className="block text-slate-500 mt-0.5">{row.route.routeApplicabilityReason}</span>
                  ) : null}
                </div>

                {!excluded ? (
                  <div className="px-3 py-2 flex flex-wrap gap-2 border-t border-slate-700/70">
                    {can('route.measurement.record') && !row.active ? (
                      <ActionButton onClick={() => setOpenForm(openForm === row.route.segmentId ? null : row.route.segmentId)}
                                    testId={`record-${row.route.segmentId}`}>
                        <Plus className="w-3 h-3" /> Record measurement
                      </ActionButton>
                    ) : null}

                    {row.active?.verificationState === 'REPORTED_UNVERIFIED' && can('route.measurement.verify') ? (
                      <ActionButton
                        variant="verify"
                        busy={busy === `verify-${row.active.id}`}
                        testId={`verify-${row.route.segmentId}`}
                        onClick={() => {
                          const notes = window.prompt('Verification notes — what did you check?') ?? '';
                          void post(
                            `/api/projects/${projectId}/routes/${encodeURIComponent(row.route.segmentId)}/measurements/${row.active!.id}/verify`,
                            { verificationNotes: notes },
                            `verify-${row.active!.id}`,
                          );
                        }}
                      >
                        <ShieldCheck className="w-3 h-3" /> Verify
                      </ActionButton>
                    ) : null}

                    {row.active && can('route.measurement.reject') ? (
                      <ActionButton
                        variant="reject"
                        busy={busy === `reject-${row.active.id}`}
                        testId={`reject-${row.route.segmentId}`}
                        onClick={() => {
                          // A reason is REQUIRED — the server refuses without
                          // one, and asking here avoids a pointless round trip.
                          const reason = window.prompt('Rejection reason (required):') ?? '';
                          if (!reason.trim()) { setError('A written rejection reason is required.'); return; }
                          void post(
                            `/api/projects/${projectId}/routes/${encodeURIComponent(row.route.segmentId)}/measurements/${row.active!.id}/reject`,
                            { rejectionReason: reason },
                            `reject-${row.active!.id}`,
                          );
                        }}
                      >
                        <XCircle className="w-3 h-3" /> {row.active.verificationState === 'VERIFIED' ? 'Withdraw verification' : 'Reject'}
                      </ActionButton>
                    ) : null}

                    {row.active && can('route.measurement.supersede') ? (
                      <ActionButton
                        busy={busy === `supersede-${row.active.id}`}
                        testId={`supersede-${row.route.segmentId}`}
                        onClick={() => setOpenForm(openForm === `sup:${row.route.segmentId}` ? null : `sup:${row.route.segmentId}`)}
                      >
                        <History className="w-3 h-3" /> Supersede with a new measurement
                      </ActionButton>
                    ) : null}

                    {row.measurements.length > 0 ? (
                      <button
                        className="ml-auto text-[11px] text-slate-400 hover:text-white"
                        data-testid={`history-toggle-${row.route.segmentId}`}
                        onClick={() => setOpenHistory(prev => {
                          const next = new Set(prev);
                          if (next.has(row.route.segmentId)) next.delete(row.route.segmentId);
                          else next.add(row.route.segmentId);
                          return next;
                        })}
                      >
                        {historyOpen ? 'Hide' : 'Show'} history ({row.measurements.length})
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {openForm === row.route.segmentId || openForm === `sup:${row.route.segmentId}` ? (
                  <MeasurementForm
                    methods={data.methods}
                    superseding={openForm.startsWith('sup:') ? row.active?.id ?? null : null}
                    busy={busy != null}
                    testIdPrefix={row.route.segmentId}
                    onCancel={() => setOpenForm(null)}
                    onSubmit={async (form) => {
                      const base = `/api/projects/${projectId}/routes/${encodeURIComponent(row.route.segmentId)}/measurements`;
                      const url = openForm!.startsWith('sup:') && row.active
                        ? `${base}/${row.active.id}/supersede`
                        : base;
                      const ok = await post(url, form, `record-${row.route.segmentId}`);
                      if (ok) setOpenForm(null);
                    }}
                  />
                ) : null}

                {historyOpen ? (
                  <MeasurementHistory rows={row.measurements} testId={`history-${row.route.segmentId}`} />
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Field({ label, value, emphasis }: { label: string; value: string; emphasis?: 'ok' | 'warn' }) {
  const cls = emphasis === 'ok' ? 'text-green-300' : emphasis === 'warn' ? 'text-amber-300' : 'text-slate-200';
  return (
    <div className="flex gap-1.5">
      <span className="text-slate-500 shrink-0">{label}:</span>
      <span className={`${cls} truncate`} title={value}>{value}</span>
    </div>
  );
}

function ActionButton({
  children, onClick, variant, busy, testId,
}: {
  children: React.ReactNode; onClick: () => void;
  variant?: 'verify' | 'reject'; busy?: boolean; testId?: string;
}) {
  const cls = variant === 'verify'
    ? 'border-green-500/40 text-green-300 hover:bg-green-500/10'
    : variant === 'reject'
      ? 'border-red-500/40 text-red-300 hover:bg-red-500/10'
      : 'border-slate-600 text-slate-300 hover:bg-slate-700/50';
  return (
    <button
      type="button"
      data-testid={testId}
      disabled={busy}
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-medium disabled:opacity-50 ${cls}`}
    >
      {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : null}{children}
    </button>
  );
}

function MeasurementForm({
  methods, superseding, busy, onSubmit, onCancel, testIdPrefix,
}: {
  methods: string[];
  superseding: string | null;
  busy: boolean;
  testIdPrefix: string;
  onSubmit: (form: Record<string, unknown>) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [lengthFt, setLengthFt] = useState('');
  const [method, setMethod] = useState(methods[0] ?? 'TAPE');
  const [measuredAt, setMeasuredAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [notes, setNotes] = useState('');
  const [evidence, setEvidence] = useState('');

  return (
    <form
      className="px-3 py-3 border-t border-slate-700/70 bg-slate-900/40 space-y-2"
      data-testid={`measurement-form-${testIdPrefix}`}
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit({
          measuredLengthFt: Number(lengthFt),
          measurementMethod: method,
          measuredAt: new Date(measuredAt).toISOString(),
          evidenceAttachmentIds: evidence.split(',').map(s => s.trim()).filter(Boolean),
          notes: notes.trim() || null,
        });
      }}
    >
      {superseding ? (
        <p className="text-[11px] text-amber-300">
          This creates a NEW measurement and links the current one as superseded. The replacement starts
          UNVERIFIED — superseding a verified record does not inherit its verification.
        </p>
      ) : null}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <label className="text-[11px] text-slate-400 space-y-1">
          <span>Measured length (ft)</span>
          <input required type="number" step="0.1" min="0.5" max="2000" value={lengthFt}
                 data-testid={`form-length-${testIdPrefix}`}
                 onChange={e => setLengthFt(e.target.value)}
                 className="w-full rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-white" />
        </label>
        <label className="text-[11px] text-slate-400 space-y-1">
          <span>Method</span>
          <select value={method} onChange={e => setMethod(e.target.value)}
                  data-testid={`form-method-${testIdPrefix}`}
                  className="w-full rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-white">
            {methods.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className="text-[11px] text-slate-400 space-y-1">
          <span>Measured at</span>
          <input required type="datetime-local" value={measuredAt}
                 data-testid={`form-measuredat-${testIdPrefix}`}
                 onChange={e => setMeasuredAt(e.target.value)}
                 className="w-full rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-white" />
        </label>
        <label className="text-[11px] text-slate-400 space-y-1">
          <span>Evidence attachment ids</span>
          <input value={evidence} placeholder="comma-separated survey file ids"
                 data-testid={`form-evidence-${testIdPrefix}`}
                 onChange={e => setEvidence(e.target.value)}
                 className="w-full rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-white" />
        </label>
      </div>
      <label className="block text-[11px] text-slate-400 space-y-1">
        <span>Notes</span>
        <textarea value={notes} rows={2} onChange={e => setNotes(e.target.value)}
                  className="w-full rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-white" />
      </label>
      <p className="text-[11px] text-slate-500">
        This is filed as <span className="text-amber-300 font-medium">FIELD REPORTED — UNVERIFIED</span>. It becomes the
        calculation length straight away and closes nothing until an authorised reviewer verifies it.
      </p>
      <div className="flex gap-2">
        <button type="submit" disabled={busy}
                data-testid={`form-submit-${testIdPrefix}`}
                className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-300 disabled:opacity-50">
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
          Submit field report
        </button>
        <button type="button" onClick={onCancel}
                className="rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-300">Cancel</button>
      </div>
    </form>
  );
}

function MeasurementHistory({ rows, testId }: { rows: Measurement[]; testId: string }) {
  return (
    <div className="px-3 py-2 border-t border-slate-700/70 bg-slate-900/30" data-testid={testId}>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-slate-500 text-left">
            <th className="py-1 pr-2">State</th>
            <th className="py-1 pr-2">Length</th>
            <th className="py-1 pr-2">Method</th>
            <th className="py-1 pr-2">Measured by / at</th>
            <th className="py-1 pr-2">Verified by / at</th>
            <th className="py-1">Outcome</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(m => (
            <tr key={m.id} className="border-t border-slate-800" data-testid={`history-row-${m.id}`}>
              <td className="py-1 pr-2">
                <span className={
                  m.verificationState === 'VERIFIED' ? 'text-green-300'
                  : m.verificationState === 'REPORTED_UNVERIFIED' ? 'text-amber-300'
                  : m.verificationState === 'REJECTED' ? 'text-red-300' : 'text-slate-500'
                }>{m.verificationState}</span>
              </td>
              <td className="py-1 pr-2 text-slate-200">{m.measuredLengthFt} ft</td>
              <td className="py-1 pr-2 text-slate-400">{m.measurementMethod}</td>
              <td className="py-1 pr-2 text-slate-400">{shortId(m.measuredByUserId)} · {when(m.measuredAt)}</td>
              <td className="py-1 pr-2 text-slate-400">
                {m.verifiedByUserId ? `${shortId(m.verifiedByUserId)} · ${when(m.verifiedAt)}` : '—'}
              </td>
              <td className="py-1 text-slate-400">
                {m.rejectionReason ? `Rejected: ${m.rejectionReason}` : null}
                {m.supersededByMeasurementId ? `Superseded by ${shortId(m.supersededByMeasurementId)}` : null}
                {m.verificationNotes && !m.rejectionReason ? m.verificationNotes : null}
                {!m.rejectionReason && !m.supersededByMeasurementId && !m.verificationNotes ? '—' : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
