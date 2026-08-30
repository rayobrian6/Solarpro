// ═══════════════════════════════════════════════════════════════════════════
// ONE PACKAGE, TWO RAPID-SHUTDOWN DEVICES
//
// The cover said the initiation device is the fused AC disconnect (NEC
// 690.12(C)). PV-5's disconnect directory said:
//
//     RAPID SHUTDOWN INITIATOR · MODULE-LEVEL (PVRSS) · Hosted by the IQ Combiner 5C
//
// — an identity assembled from the inverter topology and the monitoring gateway,
// with no reference to the initiation device the authority names. And the
// emergency procedure instructed:
//
//     TURN RAPID SHUTDOWN SWITCH TO THE "OFF" POSITION
//
// on a design that contains no such switch: an instruction a firefighter cannot
// carry out.
//
// E-1's methodology table stated BOTH methods at once ("Array-level ≤ 80V within
// 30s … Module-level per 690.12(B)(2)") without saying which one this design
// uses, and PV-1's setback note asserted module-level RSD on its own.
//
// A NOTE ON WHAT STAYS. The 690.54 / 690.56(C) PLACARD text still reads "TURN
// RAPID SHUTDOWN SWITCH TO THE 'OFF' POSITION" — that is the wording the NEC
// prescribes for the label, quoted with its citation, and a label may not be
// reworded because our device has a different name. What changed is that the
// package now states, beside it, which device that switch IS on this system.
//
// These are MUTATION tests: change the initiation device and every sheet follows.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import { projectRapidShutdownAuthority } from '@/lib/permit/snapshot/rapidShutdownAuthority';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

function build(mutate?: (i: any) => void) {
  const input: any = clone(braidonOriginalAuditFixture);
  input.plansetProfile = 'design-review';
  mutate?.(input);
  const html = generatePermitHTML(input) as unknown as string;
  const text = html.replace(/<[^>]+>/g, ' ')
    .replace(/&mdash;/g, '—').replace(/&quot;/g, '"').replace(/&middot;/g, '·')
    .replace(/&le;/g, '≤').replace(/\s+/g, ' ');
  return { input, text, rsd: projectRapidShutdownAuthority(input._snapshot) };
}

describe('one initiation device, named the same way everywhere', () => {
  const { text, rsd } = build();

  it('the authority publishes the full identity the sheets need', () => {
    expect(rsd.required).toBe(true);
    expect(rsd.systemType).toBe('MODULE-LEVEL');
    expect(rsd.initiatorObjectId).toBe('svc-fused-ocpd');
    expect(rsd.hostEquipmentId).toBe('svc-fused-ocpd');
    expect(rsd.operatingInstruction).toMatch(/OPEN THE FUSED AC DISCONNECT/);
    expect(rsd.initiationDeviceSection).toBe('690.12(C)');
    expect(rsd.placardBasis).toBe('690.56(C)');
  });

  it('the invented PV-5 identity is gone', () => {
    expect(text).not.toMatch(/MODULE-LEVEL \(PVRSS\)/);
    expect(text).not.toMatch(/RAPID SHUTDOWN INITIATOR/);
    expect(text).not.toMatch(/Hosted by the IQ Combiner/);
  });

  it('PV-5 names the real device in its directory', () => {
    expect(text).toMatch(/RAPID SHUTDOWN INITIATION DEVICE/);
    expect(text).toMatch(/INITIATED AT THE FUSED AC DISCONNECT/);
  });

  it('the emergency procedure gives an instruction that can be followed', () => {
    expect(text).toMatch(/OPEN THE FUSED AC DISCONNECT — IT IS THE RAPID-SHUTDOWN INITIATION DEVICE/);
  });

  it('E-1 states THIS design\'s method, not both at once', () => {
    expect(text).toMatch(/Module-level — conductors outside the array boundary ≤ 30V within 30s/);
    expect(text).not.toMatch(/Array-level: ≤ 80V within 30s/);
  });

  it('the code-prescribed PLACARD wording is preserved, with its citation', () => {
    // A label may not be reworded because our device has a different name.
    expect(text).toMatch(/TURN RAPID SHUTDOWN SWITCH TO THE "OFF" POSITION/);
    expect(text).toMatch(/690\.56\(C\)/);
  });
});

describe('MUTATION — change the device and every sheet follows', () => {
  it('a dedicated initiator makes every sheet name IT instead', () => {
    const { text, rsd } = build(i => {
      i.project.separateRsdInitiator = true;
      i.project.rapidShutdownInitiatorDevice = 'Dedicated RSD initiator';
    });
    expect(rsd.initiatorObjectId).toBe('svc-rsd-initiator');
    expect(rsd.hostEquipmentId, 'a dedicated device hosts itself').toBeNull();
    // PV-5's directory and the emergency step both move with it.
    expect(text).not.toMatch(/INITIATED AT THE FUSED AC DISCONNECT/);
    expect(text).toMatch(/RAPID SHUTDOWN INITIATION DEVICE/);
  });

  it('no rapid shutdown ⇒ no device, no instruction, no invented type', () => {
    const bare = projectRapidShutdownAuthority(
      { electrical: { serviceTopology: [] }, project: {} } as any, '2020');
    expect(bare.required).toBe(false);
    expect(bare.systemType).toBe('NONE');
    expect(bare.operatingInstruction).toBeNull();
    expect(bare.hostEquipmentId).toBeNull();
  });

  it('the authority is the ONLY producer of a device identity', async () => {
    const fs = await import('node:fs');
    for (const f of [
      'lib/permit/sections/compliancePages.ts',
      'lib/permit/sections/electricalPages.ts',
      'lib/permit/sections/arrayPages.ts',
    ]) {
      const src = fs.readFileSync(f, 'utf8');
      // the three literals each sheet used to compose on its own
      expect(src, f).not.toMatch(/'MODULE-LEVEL \(PVRSS\)'/);
      expect(src, f).not.toMatch(/name: 'RAPID SHUTDOWN INITIATOR'/);
      expect(src, f).not.toMatch(/steps\.push\('TURN RAPID SHUTDOWN SWITCH/);
    }
  });
});
