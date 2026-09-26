'use client';

/**
 * components/design/DeleteConfirm.tsx
 *
 * SAY WHAT WILL GO, THEN ASK.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A UX audit of the studio found ZERO confirmation of any kind on any
 * destructive control: the always-visible trash icon wiped every panel on one
 * click, "Draw Manually Instead" took hand-built sections with it, and Auto
 * Layout could remove a modelled detached garage. Every one of them was one
 * click from a design an installer had spent an hour on.
 *
 * 🚨 BUT NOT EVERYTHING GETS A MODAL. The opposite failure is real and worse
 * for a modelling tool: if deleting one traced face costs a dialog, people stop
 * trying things, and an editor you are afraid to experiment in is not usable at
 * any level of correctness. Undo is the safety net for the small removals. This
 * is reserved for the two that cannot be a slip — Clear Custom Building and
 * Start Over — plus clearing the whole layout, and that split is expressed as
 * data in `ceremonyFor`, not decided here.
 *
 * 🚨 AND IT LISTS THE OBJECTS, NOT AN ADJECTIVE. "Are you sure?" tells the
 * reader nothing they did not already know. The plan carries one line per class
 * of thing that will be removed — "4 roof faces", "2 building sections —
 * including its walls", "31 panels" — computed by walking the real ownership
 * graph, so what the dialog promises and what the deletion does are one answer.
 */

import React, { useEffect } from 'react';
import type { DeletionPlan } from '@/lib/design/deletionAuthority';

export interface DeleteConfirmProps {
  /** The planned deletion, or null when nothing is pending. */
  plan: DeletionPlan | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteConfirm({ plan, onConfirm, onCancel }: DeleteConfirmProps) {
  const showing = Boolean(plan && plan.ok);

  /**
   * 🚨 ESCAPE CANCELS. NEVER CONFIRMS.
   *
   * Escape is this product's invariant exit — the active-mode banner advertises it
   * — and it did not work here, on the dialog standing in front of the two
   * deletions that cannot be a slip. "Can I get out of this?" is the question a
   * person is actually asking at a confirmation, and Escape is how they ask it.
   *
   * The direction is not a judgement call: on a destructive confirmation the key
   * that means "get me out" must take the safe branch.
   *
   * Capture phase and `stopPropagation`, because the studio binds Escape globally
   * to leave the armed tool — otherwise dismissing this dialog would also disarm
   * whatever was selected behind it. Bound only while the dialog is showing, so a
   * stale listener cannot swallow the studio's own Escape afterwards.
   */
  useEffect(() => {
    if (!showing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      onCancel();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [showing, onCancel]);

  if (!plan || !plan.ok) return null;

  return (
    <div
      data-testid="delete-confirm"
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(3,6,14,0.62)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 'min(420px, calc(100vw - 32px))',
          background: 'rgba(14,16,28,0.98)',
          border: '1px solid rgba(255,90,90,0.45)',
          borderRadius: 14, padding: '18px 18px 14px',
          boxShadow: '0 18px 60px rgba(0,0,0,0.65)',
          color: '#e6ecf5', fontSize: 13, lineHeight: 1.5,
        }}
      >
        <div data-testid="delete-confirm-title" style={{ fontWeight: 800, fontSize: 15, marginBottom: 10 }}>
          {plan.title}?
        </div>

        <div style={{ color: '#9aa8bd', fontSize: 11.5, marginBottom: 6 }}>
          This removes:
        </div>
        <ul data-testid="delete-confirm-lines" style={{ margin: '0 0 12px', paddingLeft: 18 }}>
          {plan.lines.map(line => (
            <li key={line} style={{ marginBottom: 2 }}>{line}</li>
          ))}
        </ul>

        {/* 🚨 TELL THEM WHETHER IT COMES BACK. "Can I get out of this?" is the
            question a person is actually asking at a confirmation, and it is
            the one such dialogs almost never answer. */}
        <div style={{
          background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)',
          borderRadius: 8, padding: '7px 9px', fontSize: 11.5, color: '#b9c6d8', marginBottom: 14,
        }}>
          {plan.clearsProperty
            ? 'Undo brings it back in this session. Once you reload, it is gone for good — '
              + 'this property will stay empty until you build something new.'
            : 'Undo brings it back.'}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button" data-testid="delete-confirm-cancel"
            onClick={onCancel}
            style={{
              flex: 1, padding: '8px 0', borderRadius: 8,
              background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.16)',
              color: '#cfd8e6', fontWeight: 700, fontSize: 12, cursor: 'pointer',
            }}
          >Keep it</button>
          <button
            type="button" data-testid="delete-confirm-ok"
            onClick={onConfirm}
            style={{
              flex: 1, padding: '8px 0', borderRadius: 8,
              background: 'rgba(255,70,70,0.22)', border: '1px solid rgba(255,90,90,0.6)',
              color: '#ffb3b3', fontWeight: 800, fontSize: 12, cursor: 'pointer',
            }}
          >{plan.title}</button>
        </div>
      </div>
    </div>
  );
}

export default DeleteConfirm;
