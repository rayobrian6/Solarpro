/**
 * Is this deployment allowed to expose developer-only diagnostics?
 *
 * 🚨 GATED ON `VERCEL_ENV`, NOT `NODE_ENV`. `NODE_ENV` is always 'production' on Vercel — including
 * on PREVIEW deployments — so gating on it would leave every preview URL serving diagnostics. The
 * `NODE_ENV` check below is only the fallback for non-Vercel hosting, where `VERCEL_ENV` is unset.
 * Same reasoning as `app/api/dev-check/route.ts`, which is where this pattern comes from.
 *
 * 🚨 AND IT LIVES HERE RATHER THAN IN THE ROUTE. A Next.js route module may export only its HTTP
 * handlers and the known config keys; any other export fails the generated route-type check at build
 * time ("does not satisfy the constraint '{ [x: string]: never; }'"). Exporting this from the route
 * so a test could reach it would have broken `next build` — found by running the dev server, which
 * generates `.next/types`, and not by `tsc` on a clean tree.
 */
export function devDiagnosticsAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  // ══════════════════════════════════════════════════════════════════════════
  // 🚨 `VERCEL_ENV === 'production'` IS TRUE ON THE DEV DEPLOYMENT TOO, AND THAT LOCKED RAY OUT.
  //
  // There are three Vercel projects. `solarpro-dev` builds the `dev` branch, and Vercel labels a
  // project's own production-branch deployment `VERCEL_ENV=production` — so the branch Ray actually
  // tests served a 404 for every developer diagnostic. Rule Fifteen asks that he be able to inspect
  // his project's electrical state; on the deployment he uses, he could not open the inspector at
  // all.
  //
  // The real question is not "is this environment called production" but "is this the PRODUCTION
  // APPLICATION" — the one customers reach, built from the release branch. `VERCEL_GIT_COMMIT_REF`
  // answers that and nothing in the dashboard can pin it (the same property that made it the
  // trustworthy deploy identity in `/api/health`).
  //
  // This widens nothing else: every diagnostic route still requires authentication and still scopes
  // its read to the caller's own project. A deployment of a working branch may tell its owner what
  // their own project's state is.
  // ══════════════════════════════════════════════════════════════════════════
  const RELEASE_BRANCHES = ['master', 'main'];
  const ref = (env.VERCEL_GIT_COMMIT_REF ?? '').trim().toLowerCase();

  if (env.VERCEL_ENV === 'preview') return false;
  if (env.VERCEL_ENV === 'production') {
    // The production application: never. A non-release branch deployed as its project's production
    // alias is a working deployment, and its owner may inspect it. An ABSENT ref is treated as the
    // release case — an unidentifiable deployment gets the strict answer.
    return ref.length > 0 && !RELEASE_BRANCHES.includes(ref);
  }
  if (!env.VERCEL_ENV && env.NODE_ENV === 'production') return false;
  return true;
}
