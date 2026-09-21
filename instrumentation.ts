/**
 * instrumentation.ts — Next.js server startup hook.
 *
 * 🚨 THE ONLY THING THIS DOES IS OPT IN TO A LOCAL DATABASE FOR TESTING, AND IT
 * DOES NOTHING AT ALL UNLESS `SOLARPRO_LOCAL_PG=1`.
 *
 * With that flag set, `lib/dev/pgliteNeonBridge.ts` boots PostgreSQL compiled to
 * WebAssembly inside this process and points the Neon driver's transport at it,
 * so the real route handlers run against a real database with no credential.
 * Without the flag, the import never happens and neither PGlite nor the bridge
 * is loaded. The bridge additionally refuses to arm when `VERCEL_ENV` is
 * `production`.
 *
 * Why here rather than a webpack alias: this is Next's own supported startup
 * hook, it runs once per server instance before any request, and it leaves the
 * build configuration and the application's imports completely untouched.
 */
export async function register() {
  // 🚨 THE POSITIVE CHECK IS LOAD-BEARING, not style. Next replaces
  // `process.env.NEXT_RUNTIME` with a literal per bundle, so this form folds to
  // `false` in the edge bundle and the import below is dropped entirely. An
  // early `if (... !== 'nodejs') return;` does NOT fold, so the edge build still
  // followed the import and failed on `node:fs` / `node:path`:
  //
  //     UnhandledSchemeError: Reading from "node:fs" is not handled by plugins
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (process.env.SOLARPRO_LOCAL_PG !== '1') return;
    const { installPgliteNeonBridge } = await import('./lib/dev/pgliteNeonBridge');
    await installPgliteNeonBridge();
  }
}
