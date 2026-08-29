// ═══════════════════════════════════════════════════════════════════════════
// THE RAPID-SHUTDOWN NOTE STATED A DEVICE LOCATION IT HAD NO AUTHORITY FOR
//
// General note 12 was one hardcoded sentence carrying two wrong facts:
//
//   "Initiator shall be located at utility meter per NEC 690.56(B)."
//
// 690.56(B) is the plaque / disconnect-location DIRECTORY requirement — a
// labelling rule. Where the initiation device goes is 690.12(C). A plan reviewer
// who opens 690.56(B) looking for a device location finds a label spec, and the
// set goes back.
//
// And the design puts no initiator on the meter. `build.ts` has always emitted
// `svc-rsd-initiator` — "PV rapid-shutdown initiation device (NEC 690.12) at the
// service location" — wired between the combiner load-break and the fused AC
// disconnect. E-1's device schedule printed that on the same package, two sheets
// from the sentence that contradicted it. Nothing outside build.ts read the
// object, so the note asserted a location instead of projecting one.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';
import { projectRapidShutdownAuthority } from '@/lib/permit/snapshot/rapidShutdownAuthority';
import { necSection, necRequires } from '@/lib/nec/citations';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));
const input: any = clone(braidonOriginalAuditFixture);
input.plansetProfile = 'design-review';
const html = generatePermitHTML(input) as unknown as string;
const snap = input._snapshot as PermitDesignSnapshot;
const text = html.replace(/<[^>]+>/g, ' ').replace(/&mdash;/g, '—').replace(/\s+/g, ' ');

const RSD = projectRapidShutdownAuthority(snap, '2020');

describe('the initiation device is a DESIGN fact, projected — not asserted', () => {
  it('the design carries a discrete initiator object, and the authority finds it', () => {
    expect(RSD.required).toBe(true);
    expect(RSD.initiatorPresent).toBe(true);
    // 2026-08-29 (root 3) - the design does NOT buy a discrete initiator box.
    // The BOM buys only the 690.56 label, E-1 draws no such device, and E-1's
    // equipment schedule calls rapid shutdown INTEGRATED - so a separate
    // `svc-rsd-initiator` node was a device that existed nowhere but the object
    // model. The initiation ROLE now attaches to the device that performs it:
    // opening the fused AC disconnect is the documented initiation on an
    // integrated microinverter system. A dedicated node is emitted only when the
    // project explicitly specifies one.
    expect(RSD.initiatorObjectId).toBe('svc-fused-ocpd');
  });

  it('its location comes from that object, not from a sentence', () => {
    const obj = (snap.electrical?.serviceTopology ?? [])
      .find(o => o.objectId === RSD.initiatorObjectId);
    expect(obj, 'the object the note describes must exist').toBeTruthy();
    expect(obj!.rsdRole).toBe('initiator');
    expect(RSD.initiatorLocation).toBeTruthy();
    // whatever the object is called, the authority says - no independent wording.
    const words = RSD.initiatorLocation!.replace(/^at the /, '');
    expect(String(obj!.label).toLowerCase()).toContain(words.toLowerCase());
  });

  it('no phantom initiator device is modelled', () => {
    const phantom = (snap.electrical?.serviceTopology ?? [])
      .filter(o => o.type === 'rsd-initiator');
    expect(phantom).toEqual([]);
  });

  it('the package no longer places the initiator at the utility meter', () => {
    expect(text).not.toMatch(/[Ii]nitiator shall be located at utility meter/);
    expect(text).not.toMatch(/initiation device[^.]{0,60}utility meter/i);
  });
});

describe('the citation names what the section actually requires', () => {
  it('the rapid-shutdown requirement is 690.12 in every adoptable edition', () => {
    for (const ed of ['2017', '2020', '2023'] as const) {
      expect(necSection('pv-rapid-shutdown', ed)).toBe('690.12');
    }
  });

  it('690.56 is the LABEL requirement and is kept separate', () => {
    expect(RSD.labelSection).toBe('690.56(C)');
    expect(necRequires('pv-rapid-shutdown-plaque')).toMatch(/label|plaque/i);
    expect(RSD.labelSection).not.toBe(RSD.initiationDeviceSection);
  });

  it('the note cites 690.12(C) for the device and 690.56 only for labelling', () => {
    expect(RSD.noteText).toContain('NEC 690.12(C)');
    // the ONE thing 690.56 may appear for in this note
    const m = RSD.noteText.match(/690\.56[^\s.]*/g) ?? [];
    expect(m).toEqual(['690.56(C)']);
    expect(RSD.noteText).toMatch(/labelling per NEC 690\.56\(C\)/i);
  });

  it('and 690.56(B) never appears as a device-location authority anywhere', () => {
    // 690.56(B) is legitimately cited for the disconnect-location PLAQUE. What
    // may never recur is 690.56(B) attached to where a device is installed.
    expect(text).not.toMatch(/located[^.]{0,80}690\.56\(B\)/i);
    expect(text).not.toMatch(/690\.56\(B\)[^.]{0,40}(initiat|device location)/i);
  });
});

describe('a design without an initiator does not describe one', () => {
  it('no initiator object ⇒ no invented location', () => {
    const bare = projectRapidShutdownAuthority(
      { electrical: { serviceTopology: [] }, project: {} } as any, '2020');
    expect(bare.initiatorPresent).toBe(false);
    expect(bare.initiatorLocation).toBeNull();
    // the REQUIREMENT is still stated — only the placement is withheld.
    expect(bare.noteText).toContain('690.12');
    expect(bare.noteText).not.toMatch(/is located/);
  });
});
