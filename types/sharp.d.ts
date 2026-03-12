// Type stub for sharp — silences "Cannot find module 'sharp'" TS errors.
// Real types come from sharp's own bundled declarations on Vercel (sharp is in package.json).
// This stub is only needed for local environments where sharp native bindings aren't installed.
declare module 'sharp' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sharp: any;
  export = sharp;
}