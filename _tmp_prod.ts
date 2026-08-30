// ═══════════════════════════════════════════════════════════════════════════
// PRODUCTION-PARITY HARNESS.
//
// The previous harness (_tmp_truth.ts) called `runResolutionLifecycle` DIRECTLY
// and passed the returned bundle to generatePermitHTML. The POST export route
// does something different in one decisive way: it calls
// `resolveSnapshotAuthorityInputs`, which sets `authority.resolution = outcome`
// — and THAT is what makes buildPermitDesignSnapshot populate
// `opts.resolutionStates` and merge the resolver's operational state into every
// registry payload.
//
// So the old harness could never see the payload leak the real export shows.
// This one takes the same entry point the route takes.
// ═══════════════════════════════════════════════════════════════════════════
import { writeFileSync } from 'fs';
import { resolveSnapshotAuthorityInputs } from './lib/permit/snapshot/authorityInputs';
import { safeDbRead as defaultSafeDbRead } from './lib/permit/snapshot/resolution/registry';
import { generatePermitHTML } from './lib/permit';
import { braidonOriginalAuditFixture as F } from './tests/fixtures/braidon-original-audit-fixture';

const readable: any = async (label: string, run: any, failSoftTo: any) => {
  if (label.startsWith('findVerifiedDocument(module_datasheet')) return { value: null, ok: true, error: null };
  if (label.startsWith('listDocuments(module_datasheet')) return { value: [], ok: true, error: null };
  return defaultSafeDbRead(label, run, failSoftTo);
};

(async () => {
  const inp: any = JSON.parse(JSON.stringify(F));
  inp.plansetProfile = 'design-review';

  // ── What the REAL route does to the project record before resolving ───────
  // route.ts:477-479 backfills a BARE APN string from the hub, and route.ts:855
  // force-writes the mailing-city AHJ. Reproduce both, since they are what a
  // real project row carries and the fixture does not.
  if (process.argv.includes('--as-route')) {
    inp.project.apn = '22-2-19-30-11-401-014';                  // bare string, no parcel source
    inp.project.ahjName = 'City of Granite City Building & Zoning';
    inp.compliance = inp.compliance ?? {};
    inp.compliance.jurisdiction = { ...(inp.compliance.jurisdiction ?? {}), ahj: 'City of Granite City Building & Zoning' };
  }

  const authority = await resolveSnapshotAuthorityInputs(inp, { safeDbRead: readable, providers: {} } as any);
  const html = generatePermitHTML(inp, undefined, authority as any) as unknown as string;
  writeFileSync('_tmp_prod.html', html);

  const snap: any = inp._snapshot;
  console.log('DIGEST', snap?.meta?.digest?.slice(0, 24));
  console.log('authority.resolution set?', !!(authority as any).resolution);
  console.log('AHJ  ', snap?.codeAuthority?.ahjName);
  const reg: any[] = snap?.permitReadiness?.registry ?? [];
  console.log('OPEN ', reg.filter(r => !r.resolved).map(r => r.code).join(', ') || '(none)');
  const withPayload = reg.filter(r => r.payload && typeof r.payload === 'object');
  console.log('records carrying a payload:', withPayload.length);
  const keys = new Set<string>();
  for (const r of withPayload) for (const k of Object.keys(r.payload)) keys.add(k);
  console.log('payload keys:', [...keys].sort().join(', '));
})();
