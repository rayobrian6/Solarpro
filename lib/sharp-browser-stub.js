// Browser stub for sharp — the real sharp module has native Node bindings
// and must never be included in client-side bundles.
// This stub is aliased via webpack resolve.alias in next.config.js
// so that any accidental client-side import resolves to this noop instead
// of crashing with "ReferenceError: sharp is not defined".
module.exports = {};
