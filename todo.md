# SolarPro Utility Bill Upload Functional Fix

## Implement
- [x] Update storage helper to store arbitrary utility bill files safely.
- [x] Add best-effort type detection for known PDFs/images without blocking unknown file types.
- [x] Update homeowner form file input hint to allow any file type.
- [x] Fix diagnostics so file-bytes-received storage failures are not labeled JSON metadata-only.

## Tests
- [x] Add/update tests for .jiff/.jfif, unknown MIME, octet-stream, and arbitrary file upload behavior.
- [x] Add/update route coverage proving multipart file bytes can persist stored metadata.

## Validate + Deliver
- [x] Run targeted tests and typecheck.
- [ ] Commit directly on `dev`.
- [ ] Push `dev`.
- [ ] Report exact fix and QA evidence.
