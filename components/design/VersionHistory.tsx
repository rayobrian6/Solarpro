'use client';

/**
 * components/design/VersionHistory.tsx
 *
 * THE WAY BACK.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Every layout save has been writing a snapshot to `project_versions` for a long
 * time. `GET /api/projects/[id]/versions` lists them; `POST
 * /api/projects/[id]/versions/[versionId]` restores one, and that route carries
 * two hard-won repairs — it reconstructs panel elevations from the snapshot's own
 * roof planes rather than writing height-less panels nothing can draw, and it
 * carries `siteArchives` with the roof, because omitting it made a restore delete
 * the roof outright.
 *
 * 🚨 AND NOTHING IN THE PRODUCT EVER CALLED EITHER ROUTE. Snapshots accumulated
 * on every save, the restore was repaired twice by people reading the code, and
 * no user could get at any of it.
 *
 * That turned from wasteful into urgent when the stale-write refusal landed.
 * `LAYOUT_STALE_WRITE` tells a losing tab "this design was saved somewhere else —
 * reload", and nothing was written, so that tab's edit is discarded. Telling
 * somebody their work was discarded is only defensible if they can get the
 * previous state back. The refusal and this panel are one feature.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT DELIBERATELY DOES
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 🚨 IT SHOWS THE NUMBERS, NOT A COLUMN OF TIMESTAMPS. "Which version do I
 * want?" is answerable from the panel count and the system size, both of which
 * the list route already returns and neither of which anyone could see. A list
 * of dates makes the reader guess.
 *
 * 🚨 IT CONFIRMS. The studio reserves dialogs for what cannot be a slip, on the
 * grounds that an editor you are afraid to experiment in is unusable at any
 * level of correctness — see DeleteConfirm. Restoring qualifies: it replaces the
 * entire design from a snapshot and Undo does not reach across it.
 *
 * 🚨 IT STATES THE VERSION IT WAS BASED ON. A restore is a write like any other.
 * Without `expectedUpdatedAt`, a restore launched from a panel left open while
 * somebody else saved would overwrite their work — and would do it while the
 * operator believed they were undoing their own change. The server refuses that
 * with `LAYOUT_STALE_WRITE` and writes nothing.
 *
 * 🚨 IT HANDS THE NEW VERSION BACK TO THE STUDIO. A restore moves the row's
 * version. A tab that keeps its old token is refused on its very next autosave,
 * so a SUCCESSFUL restore would leave the studio unable to save — which reads as
 * the restore having broken the design. `onRestored` carries the new version up.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { History, RotateCcw, AlertTriangle, Loader, X } from 'lucide-react';

/** One row of the list route's response. `snapshot` is not loaded for a list. */
interface VersionRow {
  id: string;
  versionNumber: number;
  panelsCount: number | null;
  systemSizeKw: number | null;
  changeSummary: string | null;
  createdAt: string;
}

export interface VersionHistoryProps {
  open: boolean;
  projectId: string;
  /** The version this tab believes the row is at, sent as the precondition. */
  storedVersion: () => string | null;
  onClose: () => void;
  /**
   * A restore succeeded. `updatedAt` is the row's NEW version, which the studio
   * must adopt before its next autosave, and `panelsCount` is what was written.
   *
   * Typed as the version token's own union rather than `unknown`, so the studio
   * can hand it straight to `noteSavedVersion` — an `unknown` here just moves a
   * cast to the call site, where the reason for it is no longer visible.
   */
  onRestored: (result: {
    updatedAt?: string | number | Date | null;
    panelsCount?: number | null;
  }) => void;
}

function whenLabel(iso: string): string {
  // A date that will not parse is shown as nothing rather than as "Invalid
  // Date" — the same rule the portal's install date follows.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export function VersionHistory({
  open, projectId, storedVersion, onClose, onRestored,
}: VersionHistoryProps) {
  const [rows, setRows]         = useState<VersionRow[] | null>(null);
  const [loadError, setLoadErr] = useState<string | null>(null);
  const [confirming, setConfirm] = useState<VersionRow | null>(null);
  const [busy, setBusy]         = useState(false);
  const [refusal, setRefusal]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(null); setLoadErr(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/versions`);
      const body = await res.json().catch(() => null) as
        { success?: boolean; data?: VersionRow[]; error?: string } | null;
      if (!res.ok || !body?.success) {
        setLoadErr(body?.error || `Could not load the version history (${res.status}).`);
        setRows([]);
        return;
      }
      setRows(body.data ?? []);
    } catch (e) {
      setLoadErr((e as Error)?.message || 'Could not reach the server.');
      setRows([]);
    }
  }, [projectId]);

  useEffect(() => {
    if (!open) return;
    // Re-read on every open. A panel left mounted would otherwise show a list
    // from before the last twenty saves, and restoring from a stale list is how
    // you pick the wrong version confidently.
    void load();
    setRefusal(null);
    setConfirm(null);
  }, [open, load]);

  /**
   * 🚨 ESCAPE CLOSES IT, AND ESCAPE DOES NOT REACH THE TOOL UNDERNEATH.
   *
   * Escape is this product's invariant exit — the active-mode banner prints `ESC`
   * for that reason, and a separate fix made Escape LEAVE the armed tool rather
   * than merely clear the selection, because leaving the user armed meant their
   * next click planted a second tree. A grammar that holds everywhere except the
   * dialogs is not a grammar.
   *
   * CAPTURE PHASE, and `stopPropagation`. The studio binds Escape globally to
   * leave the placement mode. Without this, one keypress would dismiss the panel
   * AND disarm whatever the operator had selected behind it — two actions from one
   * intent, the second invisible.
   *
   * Bound only while OPEN, and removed on close: a listener that outlives the
   * dialog would swallow the studio's own Escape for the rest of the session,
   * which is a worse bug than the one being fixed.
   */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  const restore = useCallback(async (row: VersionRow) => {
    setBusy(true); setRefusal(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/versions/${row.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // 🚨 The precondition. Omitting it would let a restore from a stale
          // panel overwrite a newer save silently.
          expectedUpdatedAt: storedVersion() ?? undefined,
        }),
      });
      const body = await res.json().catch(() => null) as
        { success?: boolean; error?: string; data?: Record<string, unknown> } | null;

      if (res.status === 409) {
        // The route has two distinct refusals here and BOTH say nothing was
        // written: a snapshot whose panels cannot be placed, and a design that
        // has moved on since this panel was opened. Its sentence is better than
        // anything this component could compose, so show it verbatim.
        setRefusal(body?.error
          || 'The server refused this restore. Nothing has been written.');
        setConfirm(null);
        return;
      }
      if (!res.ok || !body?.success) {
        setRefusal(body?.error || `The restore failed (${res.status}).`);
        return;
      }

      const data = body.data as {
        updatedAt?: string | number | Date | null;
        panelsCount?: number | null;
      } | undefined;
      onRestored({
        updatedAt:   data?.updatedAt,
        panelsCount: data?.panelsCount ?? row.panelsCount,
      });
      setConfirm(null);
      onClose();
    } catch (e) {
      setRefusal((e as Error)?.message || 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }, [projectId, storedVersion, onRestored, onClose]);

  if (!open) return null;

  const shell: React.CSSProperties = {
    width: 'min(520px, calc(100vw - 32px))',
    maxHeight: 'min(70vh, 620px)',
    background: 'rgba(14,16,28,0.98)',
    border: '1px solid rgba(255,255,255,0.16)',
    borderRadius: 14, padding: '16px 16px 12px',
    boxShadow: '0 18px 60px rgba(0,0,0,0.65)',
    color: '#e6ecf5', fontSize: 13, lineHeight: 1.5,
    display: 'flex', flexDirection: 'column',
  };

  return (
    <div
      data-testid="version-history"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(3,6,14,0.62)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div onClick={e => e.stopPropagation()} style={shell}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <History size={15} style={{ opacity: 0.8 }} />
          <div style={{ fontWeight: 800, fontSize: 15, flex: 1 }}>Design history</div>
          <button
            type="button" aria-label="Close" data-testid="version-history-close"
            onClick={onClose}
            style={{
              background: 'transparent', border: 'none', color: '#9aa8bd',
              cursor: 'pointer', padding: 2, display: 'flex',
            }}
          ><X size={15} /></button>
        </div>

        <div style={{ color: '#9aa8bd', fontSize: 11.5, marginBottom: 12 }}>
          A snapshot is kept every time this design is saved. Restoring one
          replaces the design you have open now.
        </div>

        {refusal && (
          <div
            data-testid="version-history-refusal"
            style={{
              display: 'flex', gap: 8, alignItems: 'flex-start',
              background: 'rgba(255,70,70,0.14)', border: '1px solid rgba(255,90,90,0.5)',
              borderRadius: 8, padding: '8px 10px', fontSize: 11.5, color: '#ffc9c9',
              marginBottom: 10,
            }}
          >
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{refusal}</span>
          </div>
        )}

        <div style={{ overflowY: 'auto', flex: 1, marginRight: -6, paddingRight: 6 }}>
          {rows === null && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: '#9aa8bd', fontSize: 12 }}>
              <Loader size={13} className="animate-spin" /> Loading…
            </div>
          )}

          {loadError && (
            <div data-testid="version-history-error" style={{ color: '#ffc9c9', fontSize: 12 }}>
              {loadError}
            </div>
          )}

          {rows !== null && rows.length === 0 && !loadError && (
            <div style={{ color: '#9aa8bd', fontSize: 12 }}>
              No snapshots yet. One is kept each time this design is saved.
            </div>
          )}

          {(rows ?? []).map(row => {
            const isConfirming = confirming?.id === row.id;
            return (
              <div
                key={row.id}
                data-testid="version-history-row"
                style={{
                  border: `1px solid ${isConfirming ? 'rgba(255,190,90,0.55)' : 'rgba(255,255,255,0.10)'}`,
                  background: isConfirming ? 'rgba(255,190,90,0.08)' : 'rgba(255,255,255,0.035)',
                  borderRadius: 10, padding: '9px 10px', marginBottom: 7,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 12.5 }}>
                      Version {row.versionNumber}
                      <span style={{ color: '#7d8a9e', fontWeight: 500, marginLeft: 8, fontSize: 11 }}>
                        {whenLabel(row.createdAt)}
                      </span>
                    </div>
                    {/* 🚨 THE NUMBERS, NOT JUST THE DATE. This is what makes the
                        list a recovery tool rather than a log. */}
                    <div style={{ color: '#9aa8bd', fontSize: 11, marginTop: 1 }}>
                      {row.panelsCount ?? 0} module{(row.panelsCount ?? 0) === 1 ? '' : 's'}
                      {row.systemSizeKw != null && ` · ${Number(row.systemSizeKw).toFixed(2)} kW`}
                      {row.changeSummary && ` · ${row.changeSummary}`}
                    </div>
                  </div>

                  {!isConfirming && (
                    <button
                      type="button" data-testid="version-history-restore"
                      disabled={busy}
                      onClick={() => { setRefusal(null); setConfirm(row); }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 5,
                        padding: '5px 9px', borderRadius: 7,
                        background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.16)',
                        color: '#cfd8e6', fontWeight: 700, fontSize: 11,
                        cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1,
                      }}
                    ><RotateCcw size={12} /> Restore</button>
                  )}
                </div>

                {/* Confirmation, inline against the row it concerns — so the
                    thing being confirmed and its numbers stay on screen
                    together, rather than a second dialog saying "are you
                    sure?" about a version the reader can no longer see. */}
                {isConfirming && (
                  <div data-testid="version-history-confirm" style={{ marginTop: 9 }}>
                    <div style={{ fontSize: 11.5, color: '#ffe0b0', marginBottom: 8 }}>
                      Replace the design you have open with version {row.versionNumber}
                      {' '}({row.panelsCount ?? 0} module{(row.panelsCount ?? 0) === 1 ? '' : 's'})?
                      {' '}The current design is snapshotted first, so this is itself undoable
                      {' '}from this list.
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button" data-testid="version-history-cancel"
                        onClick={() => setConfirm(null)}
                        disabled={busy}
                        style={{
                          flex: 1, padding: '7px 0', borderRadius: 8,
                          background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.16)',
                          color: '#cfd8e6', fontWeight: 700, fontSize: 11.5,
                          cursor: busy ? 'default' : 'pointer',
                        }}
                      >Keep current</button>
                      <button
                        type="button" data-testid="version-history-confirm-ok"
                        onClick={() => void restore(row)}
                        disabled={busy}
                        style={{
                          flex: 1, padding: '7px 0', borderRadius: 8,
                          background: 'rgba(255,190,90,0.20)', border: '1px solid rgba(255,190,90,0.6)',
                          color: '#ffd9a0', fontWeight: 800, fontSize: 11.5,
                          cursor: busy ? 'default' : 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                        }}
                      >
                        {busy && <Loader size={12} className="animate-spin" />}
                        Restore version {row.versionNumber}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default VersionHistory;
