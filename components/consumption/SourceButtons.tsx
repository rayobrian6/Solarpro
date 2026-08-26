'use client';
/**
 * components/consumption/SourceButtons.tsx
 *
 * The two top action buttons from Aurora's consumption page:
 *   - "Estimate Consumption using Electric Bill"
 *   - "Upload Green Button Data"
 *
 * Aurora's full flow wires these to PDF parsing + Green Button XML
 * ingestion. In this commit they are functional stubs that:
 *   1. Open a file picker (filtered to the right MIME types)
 *   2. Show a toast confirming the upload was received
 *   3. Set a "pending" visual state on the button until the user
 *      starts editing the form again
 *
 * Wiring to app/api/bill-upload (Electric Bill) and a future
 * Green Button parser is a follow-up — see DESIGN.md §9.
 */

import React, { useRef, useState } from 'react';
import { FileText, Leaf, Loader2, CheckCircle2 } from 'lucide-react';

interface Props {
  /** Notified when a file is "received" so the form can flip its source flag. */
  onSourceChange: (source: 'electric-bill' | 'green-button', fileName: string) => void;
}

type BusyState = 'idle' | 'electric-bill' | 'green-button';

export default function SourceButtons({ onSourceChange }: Props) {
  const [busy, setBusy] = useState<BusyState>('idle');
  const [lastUploaded, setLastUploaded] = useState<{ source: BusyState; fileName: string } | null>(null);

  const billInputRef = useRef<HTMLInputElement | null>(null);
  const greenInputRef = useRef<HTMLInputElement | null>(null);

  function handlePick(source: 'electric-bill' | 'green-button') {
    if (source === 'electric-bill') billInputRef.current?.click();
    else greenInputRef.current?.click();
  }

  function handleFile(source: 'electric-bill' | 'green-button', file?: File | null) {
    if (!file) return;
    setBusy(source);
    // Defer one tick so the spinner has a chance to render before the
    // toast feedback path runs.
    setTimeout(() => {
      setLastUploaded({ source, fileName: file.name });
      onSourceChange(source, file.name);
      setBusy('idle');
    }, 250);
  }

  const billUploaded = lastUploaded?.source === 'electric-bill';
  const greenUploaded = lastUploaded?.source === 'green-button';

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="source-buttons">
      <button
        type="button"
        onClick={() => handlePick('electric-bill')}
        className="btn-secondary"
        data-testid="btn-electric-bill"
        disabled={busy === 'electric-bill'}
      >
        {busy === 'electric-bill' ? (
          <Loader2 size={14} className="animate-spin" />
        ) : billUploaded ? (
          <CheckCircle2 size={14} className="text-emerald-400" />
        ) : (
          <FileText size={14} />
        )}
        <span>Estimate Consumption using Electric Bill</span>
      </button>

      <button
        type="button"
        onClick={() => handlePick('green-button')}
        className="btn-secondary"
        data-testid="btn-green-button"
        disabled={busy === 'green-button'}
      >
        {busy === 'green-button' ? (
          <Loader2 size={14} className="animate-spin" />
        ) : greenUploaded ? (
          <CheckCircle2 size={14} className="text-emerald-400" />
        ) : (
          <Leaf size={14} />
        )}
        <span>Upload Green Button Data</span>
      </button>

      {/* Hidden file pickers */}
      <input
        ref={billInputRef}
        type="file"
        accept="application/pdf,image/*,text/csv"
        className="hidden"
        onChange={(e) => handleFile('electric-bill', e.target.files?.[0])}
        data-testid="file-electric-bill"
      />
      <input
        ref={greenInputRef}
        type="file"
        accept="application/xml,application/json,text/xml"
        className="hidden"
        onChange={(e) => handleFile('green-button', e.target.files?.[0])}
        data-testid="file-green-button"
      />

      {lastUploaded ? (
        <span className="text-[11px] text-slate-400" data-testid="last-uploaded">
          Last: <span className="text-slate-200">{lastUploaded.fileName}</span>
        </span>
      ) : null}
    </div>
  );
}
