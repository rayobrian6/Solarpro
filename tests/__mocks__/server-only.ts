// Mock for 'server-only' package in Vitest test environment.
// In Next.js, this package throws when imported from a Client Component.
// In Vitest (Node.js), we want it to be a no-op so server-side modules
// (db-ready, db-neon, etc.) can be imported and tested directly.
export {};