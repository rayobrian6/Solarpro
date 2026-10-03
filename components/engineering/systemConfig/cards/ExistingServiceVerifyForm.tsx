'use client';

// ═══════════════════════════════════════════════════════════════════════════
// VERIFY THE EXISTING SERVICE EQUIPMENT — what was read off the assembly, recorded in one answer.
//
// Ray, on the real job: "existing Eaton meter/service equipment visible on site — exact internal
// breaker/distribution configuration still needs field/model verification." The Service card shows
// "Existing service equipment · Eaton · Field verification 5 items required [Verify]"; [Verify] opens
// this form, and so does [Answer Next] for any of those five items — the same editor wherever asked.
//
// Every field arrives separately (the catalog number off the door label, the arrangement off the
// deadfront, the AIC off the nameplate), so every field may stay blank: blank is "not read yet", and
// the engine keeps naming it. "Confirmed read on site" is the installer's statement, never derived
// from the fields being full. One Save, one write, through `answerExistingService` → `apply`.
// ═══════════════════════════════════════════════════════════════════════════

import React, { useRef, useState } from 'react';
import type { ServiceTopology } from '@/lib/electrical/serviceTopology';
import { existingServiceReading } from '@/lib/electrical/serviceTopology';
import type { AnswerResult } from '@/lib/electrical/systemConfigAnswers';
import { answerExistingService } from '@/lib/electrical/systemConfigAnswers';
import type { ExistingServiceField } from '@/lib/electrical/systemConfigServiceCard';

const box = 'rounded bg-slate-800 px-2 py-1 text-xs text-slate-100 border border-slate-700';

export interface ExistingServiceVerifyFormProps {
  t: ServiceTopology;
  /** The page's one write path (or a dialog's wrapper of it). True ⇔ accepted and persisted. */
  apply: (r: AnswerResult) => Promise<boolean>;
  busy: boolean;
  /** The fields the engine still names as owed — marked "needed" beside their control. */
  needed?: ReadonlyArray<ExistingServiceField>;
  /** Told after a successful save. */
  onSaved?: () => void;
}

const kaOf = (a: number | null | undefined) => (a == null ? '' : String(a / 1000));

export function ExistingServiceVerifyForm({ t, apply, busy, needed = [], onSaved }: ExistingServiceVerifyFormProps) {
  const ex = existingServiceReading(t.service);
  const [catalogNumber, setCatalogNumber] = useState(ex?.catalogNumber ?? '');
  const [mainArrangement, setMainArrangement] = useState(ex?.mainArrangement ?? '');
  const [feederArrangement, setFeederArrangement] = useState(ex?.feederArrangement ?? '');
  const [sccrKa, setSccrKa] = useState(kaOf(ex?.sccrA));
  const [verified, setVerified] = useState(ex?.verified ?? false);
  const sccrRef = useRef<HTMLInputElement>(null);

  const need = (f: ExistingServiceField) => (needed.includes(f) ? (
    <span data-testid={`svc-verify-needed-${f}`} className="ml-1 rounded-full border border-amber-500/40 px-1 text-[9px] font-semibold text-amber-300">needed</span>
  ) : null);

  const save = async () => {
    // Something typed that is not a number reads as '' — that is not a deliberate blank.
    if (sccrRef.current?.validity?.badInput) {
      await apply({ ok: false, refused: 'AIC / SCCR: enter the number of kiloamperes on the nameplate, or leave it blank until it is read.' });
      return;
    }
    const ka = sccrKa.trim() === '' ? null : Number(sccrKa);
    const ok = await apply(answerExistingService(t, {
      existing: true,
      catalogNumber, mainArrangement, feederArrangement,
      sccrA: ka === null ? null : Number.isFinite(ka) ? Math.round(ka * 1000) : NaN,
      verified,
    }));
    if (ok) onSaved?.();
  };

  return (
    <div data-testid="svc-verify-form" className="space-y-2 text-[11px] text-slate-400">
      <label className="block">Model / catalog number{need('catalogNumber')}
        <input data-testid="svc-verify-catalogNumber" className={`mt-0.5 block w-full ${box}`} disabled={busy}
               value={catalogNumber} placeholder="Off the door label" onChange={e => setCatalogNumber(e.target.value)} />
      </label>
      <label className="block">Internal disconnect / main arrangement{need('mainArrangement')}
        <input data-testid="svc-verify-mainArrangement" className={`mt-0.5 block w-full ${box}`} disabled={busy}
               value={mainArrangement} placeholder="e.g. meter-main, two 200 A main breakers"
               onChange={e => setMainArrangement(e.target.value)} />
      </label>
      <label className="block">Outgoing feeder arrangement{need('feederArrangement')}
        <input data-testid="svc-verify-feederArrangement" className={`mt-0.5 block w-full ${box}`} disabled={busy}
               value={feederArrangement} placeholder="e.g. one 200 A feeder to each MSP"
               onChange={e => setFeederArrangement(e.target.value)} />
      </label>
      <label className="block">AIC / SCCR{need('sccrA')}
        <span className="mt-0.5 flex items-center gap-1.5">
          <input ref={sccrRef} type="number" min={0} step={0.5} data-testid="svc-verify-sccrA" className={`w-24 ${box}`}
                 disabled={busy} value={sccrKa} placeholder="kA" onChange={e => setSccrKa(e.target.value)} />
          kA — from its nameplate, never inferred from the rating
        </span>
      </label>
      <label className="flex items-center gap-1.5 text-slate-300">
        <input type="checkbox" data-testid="svc-verify-verified" checked={verified} disabled={busy}
               onChange={e => setVerified(e.target.checked)} />
        Confirmed read on site — not assumed{need('verified')}
      </label>
      <div className="flex justify-end">
        <button type="button" data-testid="svc-verify-save" disabled={busy} onClick={() => void save()}
                className="rounded bg-sky-600 px-3 py-1 text-xs font-bold text-white hover:bg-sky-500 disabled:opacity-40">
          Save
        </button>
      </div>
    </div>
  );
}

export default ExistingServiceVerifyForm;
