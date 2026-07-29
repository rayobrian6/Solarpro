'use client';

// Migration Operator Console (Commit 7).
//
// The usable operator control surface for the canonical migration governance API
// (/api/admin/migrations). Super_admin only — every mutation is enforced
// server-side (super_admin + fresh MFA/TOTP + env authorization + bounded
// activation); this page never bypasses those controls and never sends SQL.
//
// Workflow, gated by the readiness snapshot:
//   Bootstrap → Generate evidence → Reviewed baseline batch → Verify baseline →
//   Temporarily enable execution (bounded, countdown) → Reviewed single/batch
//   execution (success read back from the ledger). Dry-run + inventory always
//   available.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Json = Record<string, any>;

// A mutation runner receives the confirmed TOTP/reason plus a per-submission
// idempotency key. Duplicate concurrent requests that share this key collapse
// to one server-side mutation and one idempotent response.
type MutationRunParams = { totpCode: string; reason: string; productionConfirmation?: string; idempotencyKey: string };

const API = '/api/admin/migrations';

async function call(action: string, body: Json = {}): Promise<Json> {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...body }),
  });
  const data = await res.json().catch(() => ({ success: false, error: 'Bad response' }));
  return { httpStatus: res.status, ...data };
}

function Pill({ ok, children }: { ok: boolean | null; children: React.ReactNode }) {
  const cls = ok === null ? 'bg-slate-500/20 text-slate-300 border-slate-500/30'
    : ok ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
      : 'bg-red-500/15 text-red-300 border-red-500/30';
  return <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold border ${cls}`}>{children}</span>;
}

export default function MigrationConsolePage() {
  const [readiness, setReadiness] = useState<Json | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [log, setLog] = useState<Array<{ t: string; msg: string; ok: boolean }>>([]);
  const [busy, setBusy] = useState<string | null>(null);

  // Mutation modal (TOTP + reason + optional production confirmation).
  const [modal, setModal] = useState<{ title: string; run: (p: MutationRunParams) => Promise<void>; needsProd: boolean } | null>(null);
  const [totp, setTotp] = useState('');
  const [reason, setReason] = useState('');
  const [prodConfirm, setProdConfirm] = useState('');
  // Synchronous in-flight guard. State updates (setBusy) are async and only
  // disable the button on the NEXT render, leaving a window where a fast double
  // click fires the same mutation twice. This ref blocks re-entry immediately.
  const submittingRef = useRef(false);

  // Baseline evidence + reviewed batch.
  const [evidence, setEvidence] = useState<Json | null>(null);
  const [reviews, setReviews] = useState<Record<string, { status: string; notes: string; selected: boolean; recorded?: boolean }>>({});
  const [batchDigest, setBatchDigest] = useState<string | null>(null);

  // Activation countdown.
  const [secondsLeft, setSecondsLeft] = useState<number>(0);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

  // Targeted authority-registry deployment (migrations 113 + 114) — per-migration
  // verified state, shown after a successful run.
  const [registry, setRegistry] = useState<Record<string, { ok: boolean; alreadyApplied: boolean; tablesPresent: boolean; ledger: string | null; detail: string }>>({});

  const logMsg = useCallback((msg: string, ok: boolean) => {
    setLog((l) => [{ t: new Date().toLocaleTimeString(), msg, ok }, ...l].slice(0, 40));
  }, []);

  const refresh = useCallback(async () => {
    const r = await call('inspect-readiness');
    if (r.httpStatus === 403) { setForbidden(true); setLoading(false); return; }
    if (r.success) {
      setReadiness(r.readiness);
      setSecondsLeft(r.readiness?.activation?.secondsRemaining ?? 0);
    }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Live countdown for the activation window.
  useEffect(() => {
    if (tick.current) clearInterval(tick.current);
    if (secondsLeft > 0) {
      tick.current = setInterval(() => setSecondsLeft((s) => (s <= 1 ? 0 : s - 1)), 1000);
    }
    return () => { if (tick.current) clearInterval(tick.current); };
  }, [secondsLeft > 0]);

  const run = useCallback(async (label: string, fn: () => Promise<Json>) => {
    setBusy(label);
    try {
      const r = await fn();
      logMsg(`${label}: ${r.success ? 'OK' : (r.error || 'failed')}`, !!r.success);
      await refresh();
      return r;
    } finally { setBusy(null); }
  }, [logMsg, refresh]);

  // ── Mutation modal submit ──
  const submitModal = useCallback(async () => {
    if (!modal) return;
    // Case/whitespace-insensitive so a browser-capitalized "Production" is not a
    // silent dead-end. The gate still requires typing the word.
    if (modal.needsProd && prodConfirm.trim().toLowerCase() !== 'production') return;
    // Immediate, synchronous re-entry guard (see submittingRef).
    if (submittingRef.current) return;
    submittingRef.current = true;
    // One idempotency key per confirmed submission — stable across any
    // accidental duplicate send of THIS click.
    const idempotencyKey =
      (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
        ? crypto.randomUUID()
        : `idem_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    setBusy('mutation');
    try {
      await modal.run({ totpCode: totp.trim(), reason: reason.trim(), productionConfirmation: modal.needsProd ? prodConfirm.trim().toLowerCase() : undefined, idempotencyKey });
    } finally {
      submittingRef.current = false;
      setBusy(null); setModal(null); setTotp(''); setReason(''); setProdConfirm('');
      await refresh();
    }
  }, [modal, totp, reason, prodConfirm, refresh]);

  const openMutation = (title: string, needsProd: boolean, runner: (p: MutationRunParams) => Promise<void>) =>
    setModal({ title, needsProd, run: runner });

  // ── Evidence + baseline batch ──
  const genEvidence = () => run('Generate baseline evidence', async () => {
    const r = await call('generate-baseline-evidence');
    if (r.success) {
      setEvidence(r);
      const init: Record<string, { status: string; notes: string; selected: boolean; recorded?: boolean }> = {};
      for (const p of r.proposals ?? []) {
        // Rows already RECORDED in the baseline ledger are LOCKED — shown with
        // their recorded status, excluded from the next batch. Regenerating
        // evidence previously re-proposed them as UNKNOWN and silently wiped
        // the operator's recorded work (the "recorded 82 then everything reset"
        // loop, 2026-07-20).
        const rec = r.recorded?.[p.identifier];
        init[p.identifier] = rec && rec !== 'UNKNOWN'
          ? { status: rec, notes: '', selected: false, recorded: true }
          : { status: p.proposedStatus, notes: '', selected: !p.manualReviewRequired };
      }
      setReviews(init);
      setBatchDigest(null);
    }
    return r;
  });

  const prepareBatch = () => run('Prepare baseline batch', async () => {
    const selected = Object.entries(reviews).filter(([, v]) => v.selected).map(([identifier, v]) => ({ identifier, status: v.status, notes: v.notes }));
    const r = await call('prepare-baseline-batch', { reviews: selected });
    if (r.success) setBatchDigest(r.digest);
    return r;
  });

  const recordBatch = () => {
    if (!batchDigest) return;
    openMutation('Record baseline batch', !!readiness?.isProduction, async ({ totpCode, reason, productionConfirmation, idempotencyKey }) => {
      const selected = Object.entries(reviews).filter(([, v]) => v.selected).map(([identifier, v]) => ({ identifier, status: v.status, notes: v.notes }));
      const r = await call('record-baseline-batch', { reviews: selected, confirmedDigest: batchDigest, reason, totpCode, productionConfirmation, idempotencyKey });
      logMsg(`Record baseline batch: ${r.success ? `recorded ${r.recorded}` : r.error}`, !!r.success);
    });
  };

  const rd = readiness;

  const activationLabel = useMemo(() => {
    if (!rd?.activation) return '—';
    if (rd.activation.active) return `ACTIVE — ${secondsLeft}s remaining`;
    if (rd.activation.expired) return 'EXPIRED';
    if (rd.lifecycleState === 'EXECUTION_ENABLED') return 'ENABLED WITHOUT WINDOW (fails closed)';
    return 'INACTIVE';
  }, [rd, secondsLeft]);

  if (loading) return <div className="p-8 text-slate-300">Loading migration governance state…</div>;
  if (forbidden) return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-xl font-bold text-white mb-2">Migration Console</h1>
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-200 text-sm">
        This console is restricted to platform <b>super_admin</b>. Your account is not authorized.
      </div>
    </div>
  );

  return (
    <div className="p-6 max-w-6xl mx-auto text-slate-200">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Migration Operator Console</h1>
          <p className="text-sm text-slate-400">Canonical governance workflow — <code>/api/admin/migrations</code>. Super_admin + fresh MFA required for every mutation. No SQL is entered here.</p>
        </div>
        <button onClick={refresh} className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-sm">Refresh</button>
      </div>

      {/* Readiness dashboard */}
      <section className="rounded-xl border border-slate-700 bg-slate-900/60 p-4 mb-4">
        <div className="flex items-center gap-3 mb-3">
          <h2 className="text-lg font-semibold text-white">Readiness</h2>
          <Pill ok={rd?.canExecuteNow ?? null}>{rd?.canExecuteNow ? 'READY TO EXECUTE' : 'NOT READY'}</Pill>
          {rd?.isProduction ? <Pill ok={false}>PRODUCTION</Pill> : <Pill ok={true}>{rd?.environment}</Pill>}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <Field label="Operator role" value={rd?.operatorRole} good={rd?.operatorRole === 'super_admin'} />
          <Field label="MFA enrolled" value={rd?.mfaEnrolled ? 'yes' : 'no'} good={rd?.mfaEnrolled} />
          <Field label="Lifecycle" value={rd?.lifecycleState} />
          <Field label="Ledger" value={rd?.ledgerExists ? 'present' : 'missing'} good={rd?.ledgerExists} />
          <Field label="Manifest" value={`${rd?.manifestCount} (highest ${rd?.highestIdentifier})`} />
          <Field label="Applied / Pending" value={`${rd?.appliedCount} / ${rd?.pendingCount}`} />
          <Field label="Checksum conflicts" value={rd?.conflictCount} good={(rd?.conflictCount ?? 0) === 0} />
          <Field label="Baseline reconciled" value={`${rd?.baselineReconciledCount} / ${rd?.manifestCount}`} good={rd?.baselineUnresolvedCount === 0} />
          <Field label="Baseline unresolved" value={rd?.baselineUnresolvedCount} good={rd?.baselineUnresolvedCount === 0} />
          <Field label="Execution activation" value={activationLabel} good={rd?.activation?.active} />
          <Field label="Env allowlisted" value={rd?.environmentAllowed ? 'yes' : 'no'} good={rd?.environmentAllowed} />
          <Field label="Prod exec allowed" value={rd?.productionExecutionAllowedByEnv ? 'yes' : 'no'} />
        </div>
        <div className="mt-3 rounded-lg bg-slate-800/60 border border-slate-700 p-3">
          <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Next action</div>
          <div className="text-amber-300 font-medium">{rd?.nextAction}</div>
          {(rd?.blockers ?? []).length > 0 && (
            <ul className="mt-2 space-y-1 text-sm text-slate-300 list-disc list-inside">
              {rd.blockers.map((b: string, i: number) => <li key={i}>{b}</li>)}
            </ul>
          )}
        </div>
      </section>

      {/* Targeted authority-registry deployment (current priority) — migrations 113 + 114 */}
      <section className="rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-4 mb-4">
        <div className="flex items-center gap-3 mb-1">
          <h2 className="text-lg font-semibold text-white">Deploy authority registries — migrations 113 + 114 + 115</h2>
          <Pill ok={null}>SCOPED</Pill>
        </div>
        <div className="rounded-lg bg-amber-500/10 border border-amber-500/40 text-amber-200 text-sm font-semibold px-3 py-2 mb-3">
          Run <b>113 first</b>, verify it applied, <b>then 114</b>, <b>then 115</b>. Each is idempotent (a second run is a safe
          no-op). Targeted deployment only — the historical baseline remains incomplete and is NOT advanced.
        </div>
        <p className="text-xs text-slate-400 mb-3">
          Each button runs <b>only</b> its one migration through the canonical runner under a bounded, identifier-scoped
          permit. <b>113</b> creates <code>manufacturer_document_registry</code> (the versioned authority-document store).
          <b> 114</b> creates <code>equipment_reconciliation_audit</code> + <code>snapshot_digest_invalidations</code> (the
          immutable reconciliation-audit tables). <b>115</b> creates <code>personnel_roles</code> +
          <code>project_personnel_assignments</code> (the designer / preparer / reviewer / engineer-of-record / approving-engineer
          roles of record — until it exists the planset asks for the designer on every project).
          Server-side each is statically verified <b>idempotent CREATE-TABLE-only</b>
          and <b>non-destructive</b> (no DROP / DELETE / TRUNCATE / ALTER / UPDATE / INSERT), creates exactly the expected
          table(s), success is read back from the ledger + run history + the actual tables, and the window auto-relocks.
          Neither runs any other migration, and neither marks the historical baseline verified. Requires super_admin + MFA +
          fresh TOTP + reason + typed production confirmation + production allowlist +
          <code>MIGRATION_ALLOW_PRODUCTION_EXECUTION=true</code>.
        </p>
        <div className="flex flex-wrap gap-2">
          <RegistryButton id="113" label="Run migration 113…" tables="manufacturer_document_registry"
            busy={!!busy} isProd={!!rd?.isProduction} openMutation={openMutation} logMsg={logMsg}
            action="execute-registry-113" onResult={(v) => setRegistry((s) => ({ ...s, ['113']: v }))} result={registry['113']} />
          <RegistryButton id="114" label="Run migration 114…" tables="equipment_reconciliation_audit + snapshot_digest_invalidations"
            busy={!!busy} isProd={!!rd?.isProduction} openMutation={openMutation} logMsg={logMsg}
            action="execute-reconciliation-114" onResult={(v) => setRegistry((s) => ({ ...s, ['114']: v }))} result={registry['114']} />
          <RegistryButton id="115" label="Run migration 115…" tables="personnel_roles + project_personnel_assignments"
            busy={!!busy} isProd={!!rd?.isProduction} openMutation={openMutation} logMsg={logMsg}
            action="execute-personnel-115" onResult={(v) => setRegistry((s) => ({ ...s, ['115']: v }))} result={registry['115']} />
          <RegistryButton id="116" label="Run migration 116…" tables="engineering_review_records"
            busy={!!busy} isProd={!!rd?.isProduction} openMutation={openMutation} logMsg={logMsg}
            action="execute-engineering-review-116" onResult={(v) => setRegistry((s) => ({ ...s, ['116']: v }))} result={registry['116']} />
        </div>
      </section>

      {/* Step actions */}
      <section className="grid md:grid-cols-2 gap-4 mb-4">
        {/* Bootstrap */}
        {(!rd?.ledgerExists || rd?.lifecycleState === 'UNBOOTSTRAPPED') && (
          <Card title="1 · Bootstrap governance" desc="Create the ledger tables. Idempotent. No migration SQL runs.">
            <button disabled={!!busy} onClick={() => openMutation('Bootstrap migration governance', !!rd?.isProduction, async ({ totpCode, reason, productionConfirmation, idempotencyKey }) => {
              const r = await call('bootstrap', { totpCode, reason, productionConfirmation, idempotencyKey });
              const cid = r.correlationId ? ` [${r.correlationId}]` : '';
              logMsg(`Bootstrap: ${r.success ? (r.alreadyExisted ? 'already existed' : 'created') : r.error}${cid}`, !!r.success);
            })} className={btn}>Bootstrap…</button>
          </Card>
        )}

        {/* Baseline evidence + batch */}
        {rd?.ledgerExists && (rd?.baselineUnresolvedCount ?? 0) > 0 && (
          <Card title="2 · Historical baseline" desc="Generate read-only evidence, review, then record the whole batch under one TOTP.">
            <div className="flex flex-wrap gap-2">
              <button disabled={!!busy} onClick={genEvidence} className={btn}>Generate evidence</button>
              <button disabled={!!busy || !evidence} onClick={prepareBatch} className={btnAlt}>Prepare batch</button>
              <button disabled={!!busy || !batchDigest} onClick={recordBatch} className={btnDanger}>Record batch…</button>
            </div>
            {batchDigest && <div className="mt-2 text-xs text-slate-400">Batch digest: <code className="text-slate-300">{batchDigest.slice(0, 24)}…</code></div>}
          </Card>
        )}

        {/* Verify baseline */}
        {rd?.ledgerExists && rd?.baselineUnresolvedCount === 0 && rd?.lifecycleState !== 'BASELINE_VERIFIED' && rd?.lifecycleState !== 'EXECUTION_ENABLED' && (
          <Card title="3 · Verify baseline" desc="Advance to BASELINE_VERIFIED. Does NOT enable execution.">
            <button disabled={!!busy} onClick={() => run('Verify baseline', () => call('verify-baseline'))} className={btn}>Verify historical baseline</button>
          </Card>
        )}

        {/* Temporary activation */}
        {(rd?.lifecycleState === 'BASELINE_VERIFIED' || rd?.lifecycleState === 'EXECUTION_ENABLED') && (
          <Card title="4 · Temporarily enable execution" desc="Bounded window (max 15 min). Expired or indefinite activation fails closed.">
            <div className="flex items-center gap-2">
              <span className="text-sm">Activation: <b className={rd?.activation?.active ? 'text-emerald-300' : 'text-slate-400'}>{activationLabel}</b></span>
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              <button disabled={!!busy} onClick={() => openMutation('Temporarily enable execution', !!rd?.isProduction, async ({ totpCode, reason, productionConfirmation, idempotencyKey }) => {
                const r = await call('enable-execution-temporary', { totpCode, reason, productionConfirmation, durationMinutes: 10, idempotencyKey });
                logMsg(`Enable execution: ${r.success ? `${r.grantedMinutes}m window` : r.error}`, !!r.success);
              })} className={btn}>Enable 10 min…</button>
              {rd?.activation?.active && (
                <button disabled={!!busy} onClick={() => openMutation('Disable execution', false, async ({ totpCode, reason, idempotencyKey }) => {
                  const r = await call('disable-execution', { totpCode, reason, idempotencyKey });
                  logMsg(`Disable execution: ${r.success ? 'relocked' : r.error}`, !!r.success);
                })} className={btnAlt}>Disable now…</button>
              )}
            </div>
          </Card>
        )}

        {/* Single execution */}
        {rd?.activation?.active && (rd?.pendingCount ?? 0) > 0 && (
          <SingleExecution readiness={rd} logMsg={logMsg} refresh={refresh} openMutation={openMutation} />
        )}
      </section>

      {/* Evidence review table */}
      {evidence && (
        <section className="rounded-xl border border-slate-700 bg-slate-900/60 p-4 mb-4">
          <h2 className="text-lg font-semibold text-white mb-2">Baseline evidence — review ({evidence.manifestCount} migrations)</h2>
          <div className="text-xs text-slate-400 mb-2">Read-only schema introspection. High-confidence proposals are pre-selected. UNKNOWN / PARTIALLY_APPLIED require an explicit note.</div>
          <div className="overflow-x-auto max-h-96">
            <table className="w-full text-xs">
              <thead className="text-slate-400 sticky top-0 bg-slate-900"><tr>
                <th className="text-left p-1">✓</th><th className="text-left p-1">ID</th><th className="text-left p-1">Proposed</th>
                <th className="text-left p-1">Conf.</th><th className="text-left p-1">Status (final)</th><th className="text-left p-1">Notes</th>
              </tr></thead>
              <tbody>
                {(evidence.proposals ?? []).map((p: Json) => {
                  const rev = reviews[p.identifier];
                  const needsNote = rev && !rev.recorded && (rev.status === 'UNKNOWN' || rev.status === 'PARTIALLY_APPLIED') && !rev.notes.trim();
                  if (rev?.recorded) {
                    // Already recorded in the baseline ledger — locked row.
                    return (
                      <tr key={p.identifier} className="border-t border-slate-800 opacity-70">
                        <td className="p-1 text-emerald-400">✓</td>
                        <td className="p-1 font-mono">{p.identifier}</td>
                        <td className="p-1"><Pill ok={true}>RECORDED</Pill></td>
                        <td className="p-1">—</td>
                        <td className="p-1 text-slate-300">{rev.status}</td>
                        <td className="p-1 text-slate-500 text-[10px]">recorded in baseline ledger — no action needed</td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={p.identifier} className={`border-t border-slate-800 ${needsNote ? 'bg-red-500/5' : ''}`}>
                      <td className="p-1"><input type="checkbox" checked={rev?.selected ?? false} onChange={(e) => setReviews((s) => ({ ...s, [p.identifier]: { ...s[p.identifier], selected: e.target.checked } }))} /></td>
                      <td className="p-1 font-mono">{p.identifier}</td>
                      <td className="p-1"><Pill ok={p.manualReviewRequired ? false : null}>{p.proposedStatus}</Pill></td>
                      <td className="p-1">{Math.round((p.confidence ?? 0) * 100)}%</td>
                      <td className="p-1">
                        <select value={rev?.status} onChange={(e) => setReviews((s) => ({ ...s, [p.identifier]: { ...s[p.identifier], status: e.target.value } }))} className="bg-slate-800 border border-slate-700 rounded px-1 py-0.5">
                          {['CONFIRMED_APPLIED', 'CONFIRMED_NOT_APPLIED', 'NOT_APPLICABLE', 'PARTIALLY_APPLIED', 'UNKNOWN'].map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                      <td className="p-1"><input value={rev?.notes ?? ''} onChange={(e) => setReviews((s) => ({ ...s, [p.identifier]: { ...s[p.identifier], notes: e.target.value } }))} placeholder={needsNote ? 'note required' : ''} className={`bg-slate-800 border rounded px-1 py-0.5 w-48 ${needsNote ? 'border-red-500/60' : 'border-slate-700'}`} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Activity log */}
      <section className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
        <h2 className="text-sm font-semibold text-slate-300 mb-2">Activity</h2>
        <div className="space-y-1 max-h-56 overflow-y-auto text-xs font-mono">
          {log.length === 0 ? <div className="text-slate-500">No actions yet.</div> :
            log.map((e, i) => <div key={i} className={e.ok ? 'text-emerald-300' : 'text-red-300'}>[{e.t}] {e.msg}</div>)}
        </div>
      </section>

      {/* Mutation modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setModal(null)}>
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-white mb-3">{modal.title}</h3>
            {readiness?.isProduction && <div className="mb-3 rounded bg-red-500/10 border border-red-500/30 text-red-200 text-xs p-2">PRODUCTION environment — this action affects production.</div>}
            <label className="block text-xs text-slate-400 mb-1">Reason (required)</label>
            <input value={reason} onChange={(e) => setReason(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 mb-3 text-sm" placeholder="Why are you doing this?" />
            <label className="block text-xs text-slate-400 mb-1">Fresh TOTP code (required)</label>
            <input value={totp} onChange={(e) => setTotp(e.target.value)} inputMode="numeric" className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 mb-3 text-sm font-mono tracking-widest" placeholder="123456" />
            {modal.needsProd && (<>
              <label className="block text-xs text-slate-400 mb-1">Type <code>production</code> to confirm</label>
              <input value={prodConfirm} onChange={(e) => setProdConfirm(e.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false} className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 mb-3 text-sm" placeholder="production" />
            </>)}
            <div className="flex justify-end gap-2">
              <button onClick={() => setModal(null)} className="px-3 py-1.5 rounded bg-slate-700 text-sm">Cancel</button>
              <button disabled={busy === 'mutation' || !reason.trim() || totp.trim().length < 6 || (modal.needsProd && prodConfirm.trim().toLowerCase() !== 'production')} onClick={submitModal} className={btnDanger}>Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const btn = 'px-3 py-1.5 rounded bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-sm font-medium';
const btnAlt = 'px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-sm';
const btnDanger = 'px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-sm font-medium';

// One targeted-registry migration button (113 or 114) with its own confirm flow
// (reason + TOTP + typed production confirmation via openMutation) and a
// per-migration verified-state readout after a successful run.
function RegistryButton({ id, label, tables, action, busy, isProd, openMutation, logMsg, onResult, result }: {
  id: string; label: string; tables: string; action: string;
  busy: boolean; isProd: boolean;
  openMutation: (title: string, needsProd: boolean, run: (p: MutationRunParams) => Promise<void>) => void;
  logMsg: (m: string, ok: boolean) => void;
  onResult: (v: { ok: boolean; alreadyApplied: boolean; tablesPresent: boolean; ledger: string | null; detail: string }) => void;
  result?: { ok: boolean; alreadyApplied: boolean; tablesPresent: boolean; ledger: string | null; detail: string };
}) {
  return (
    <div className="flex flex-col gap-1">
      <button disabled={busy} onClick={() => openMutation(`Deploy migration ${id} (${tables})`, isProd, async ({ totpCode, reason, productionConfirmation, idempotencyKey }) => {
        const r = await call(action, { totpCode, reason, productionConfirmation, idempotencyKey });
        const cid = r.correlationId ? ` [${r.correlationId}]` : '';
        const detail = r.success
          ? (r.alreadyApplied ? 'table(s) already present (no-op)' : `APPLIED · tables=${r.tablesPresentAfter ? 'present' : '?'} · ledger=${r.ledger?.status ?? '—'} · relock=${r.relock?.lifecycleState ?? '—'}`)
          : (r.error || 'failed');
        logMsg(`Migration ${id}: ${detail}${cid}`, !!r.success);
        onResult({
          ok: !!r.success,
          alreadyApplied: !!r.alreadyApplied,
          tablesPresent: !!r.tablesPresentAfter,
          ledger: r.ledger?.status ?? null,
          detail,
        });
      })} className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-sm font-medium">{label}</button>
      {result && (
        <div className="flex items-center gap-1 text-[11px]">
          <Pill ok={result.ok}>{result.ok ? (result.alreadyApplied ? 'ALREADY PRESENT' : 'APPLIED') : 'FAILED'}</Pill>
          {result.ok && <span className="text-slate-400">tables {result.tablesPresent ? 'present' : '—'} · ledger {result.ledger ?? '—'}</span>}
        </div>
      )}
    </div>
  );
}

function Field({ label, value, good }: { label: string; value: React.ReactNode; good?: boolean }) {
  return (
    <div className="rounded-lg bg-slate-800/50 border border-slate-700 p-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-sm font-medium ${good === undefined ? 'text-slate-200' : good ? 'text-emerald-300' : 'text-amber-300'}`}>{value ?? '—'}</div>
    </div>
  );
}

function Card({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
      <h3 className="font-semibold text-white">{title}</h3>
      <p className="text-xs text-slate-400 mb-3">{desc}</p>
      {children}
    </div>
  );
}

// Single reviewed execution: prepare (read-only digest + eligibility) then
// execute (TOTP-confirmed), with the result verified from the ledger.
function SingleExecution({ readiness, logMsg, refresh, openMutation }: {
  readiness: Json; logMsg: (m: string, ok: boolean) => void; refresh: () => Promise<void>;
  openMutation: (title: string, needsProd: boolean, run: (p: MutationRunParams) => Promise<void>) => void;
}) {
  const [identifier, setIdentifier] = useState('');
  const [prep, setPrep] = useState<Json | null>(null);

  const prepare = async () => {
    const r = await call('prepare-execution-single', { identifier: identifier.trim() });
    setPrep(r);
    logMsg(`Prepare ${identifier}: ${r.success ? (r.eligible ? 'eligible' : `blocked (${(r.blockReasons || []).join(',')})`) : r.error}`, !!r.success && r.eligible);
  };

  const execute = () => {
    if (!prep?.digest) return;
    openMutation(`Execute migration ${prep.identifier}`, !!readiness?.isProduction, async ({ totpCode, reason, productionConfirmation, idempotencyKey }) => {
      const r = await call('execute-reviewed-single', { identifier: prep.identifier, confirmedDigest: prep.digest, reason, totpCode, productionConfirmation, idempotencyKey });
      logMsg(`Execute ${prep.identifier}: ${r.success ? `APPLIED (ledger=${r.ledger?.status})` : (r.error || 'failed')} · relock=${r.relock?.lifecycleState ?? '—'}`, !!r.success);
      setPrep(null); setIdentifier('');
      await refresh();
    });
  };

  return (
    <Card title="5 · Reviewed single execution" desc="Prepare a digest, then execute through the canonical runner. Success is read back from the ledger; the window auto-relocks after.">
      <div className="flex flex-wrap gap-2 items-center">
        <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="migration id (e.g. 108)" className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm w-40" />
        <button onClick={prepare} disabled={!identifier.trim()} className={btnAlt}>Prepare</button>
        <button onClick={execute} disabled={!prep?.eligible} className={btnDanger}>Execute…</button>
      </div>
      {prep && (
        <div className="mt-2 text-xs">
          {prep.success ? (
            <div className={prep.eligible ? 'text-emerald-300' : 'text-amber-300'}>
              {prep.filename} · {prep.transactionMode} · status={prep.currentStatus} · {prep.eligible ? 'ELIGIBLE' : `BLOCKED: ${(prep.blockReasons || []).join(', ')}`}
              {prep.digest && <div className="text-slate-400">digest {prep.digest.slice(0, 24)}…</div>}
            </div>
          ) : <div className="text-red-300">{prep.error}</div>}
        </div>
      )}
    </Card>
  );
}
