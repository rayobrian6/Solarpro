/**
 * tests/healthDeployIdentity.test.ts
 *
 * "IS MY COMMIT DEPLOYED?" MUST HAVE A TRUSTWORTHY ANSWER.
 *
 * THE DEFECT THIS CLOSES
 * ----------------------
 * `/api/health` reported `version` from `NEXT_PUBLIC_BUILD_VERSION`, which
 * next.config.js injects from lib/version.ts at build time — and which a
 * project-level environment variable of the same name overrides at RUNTIME.
 * Production has one pinned.
 *
 * On 2026-09-20 production reported `v60.3` while serving code from commit
 * bdfba731, which had set that constant to `v60.5` five months earlier (proved
 * by the response carrying `elapsed_ms` and `env_details`, both of which that
 * commit added). Every check of "did master actually deploy?" had been asking a
 * field that cannot answer it, and getting a confident wrong number.
 *
 * That is not a cosmetic bug. The rule for shipping is that a merge is not
 * landed until the deployed artifact is shown to be the exact commit, and there
 * was no way to show it.
 *
 * `VERCEL_GIT_COMMIT_SHA` is set by the platform per deployment from the ref it
 * actually built. Nothing in the dashboard can pin it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'app/api/health/route.ts'), 'utf8');

describe('the health endpoint identifies the DEPLOYED COMMIT', () => {
  it('reports the commit sha from the platform, not from a build constant', () => {
    expect(SRC).toMatch(/commit:\s+process\.env\.VERCEL_GIT_COMMIT_SHA/);
  });

  it('reports the branch it was built from', () => {
    expect(SRC).toMatch(/ref:\s+process\.env\.VERCEL_GIT_COMMIT_REF/);
  });

  it('🚨 falls back to null, never to a value that looks like an answer', () => {
    // Off Vercel — local, CI — there is no deployment, and saying so is honest.
    // A placeholder string here would be the same defect wearing a new name.
    expect(SRC).toMatch(/VERCEL_GIT_COMMIT_SHA\?\.slice\(0, 8\) \?\? null/);
    expect(SRC).toMatch(/VERCEL_GIT_COMMIT_REF \?\? null/);
  });

  it('keeps `version`, and says in the source why it cannot be trusted alone', () => {
    // Removing it would break anything already reading it; the fix is to stop
    // it being the ONLY answer, and to leave a note where the next person looks.
    expect(SRC).toMatch(/version:\s+process\.env\.NEXT_PUBLIC_BUILD_VERSION/);
    expect(SRC).toMatch(/DOES NOT IDENTIFY THE DEPLOYED CODE/);
  });

  it('still leaks no infrastructure detail', () => {
    // The response was deliberately narrowed once already: no env var NAMES,
    // no missing-var lists, no node_env, no vercel_env. A short commit sha is a
    // public identifier in the owner's own repository, and is not that.
    const body = SRC.slice(SRC.indexOf('const body = {'), SRC.indexOf('console.log('));
    for (const leak of ['env_details', 'missing_env', 'warned_env', 'node_env', 'vercel_env']) {
      expect(body, `/api/health must not expose ${leak}`).not.toMatch(new RegExp(`\\b${leak}:`));
    }
  });
});
