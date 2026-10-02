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
  if (env.VERCEL_ENV === 'production' || env.VERCEL_ENV === 'preview') return false;
  if (!env.VERCEL_ENV && env.NODE_ENV === 'production') return false;
  return true;
}
