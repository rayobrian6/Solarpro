# Marketplace Operations Evolution — Attachments + Operator Workflow + Lead Advancement

## Audit First
- [x] Inspect repo status, branch, remotes, and latest commit.
- [x] Audit existing file/storage/upload patterns before implementing attachments.
- [x] Audit current homeowner intake form/API payload handling for utility bill files.
- [x] Audit Admin Intake Feed UI/API operator action and attachment rendering paths.
- [x] Audit marketplace release, visibility, conversion, claim, and archive behavior.

## Attachment Persistence
- [x] Choose canonical storage approach by reusing existing patterns or documenting absence.
- [x] Implement real utility bill attachment upload/persistence without raw DB binaries or fake links.
- [x] Persist attachment metadata/reference into intake event payload/source-of-truth projection.
- [x] Render Admin Intake Feed attachment status, Open Bill, Download Bill only when real URLs exist.
- [x] Add required attachment structured logs.

## Operator Workflow + Hygiene
- [x] Add active Intake Feed operator controls for required lifecycle actions.
- [x] Ensure each action appends immutable event history and updates current projection safely.
- [x] Add soft archive/test-lead hygiene filtering without destructive deletes.
- [x] Add operational intelligence projections: attachment/qualification completeness, contact attempts, action history, last updated.

## Marketplace Release Maturity
- [x] Verify/reinforce release gating: operator reviewed, qualification completed, validation passed, financing checked, explicit approval.
- [x] Verify/reinforce contractor visibility and claim behavior for vetted opportunities only.

## QA + Delivery
- [x] Run touched-file validation.
- [x] Run TypeScript type-check.
- [x] Run ESLint.
- [x] Run full Vitest suite.
- [x] Run full regression suite.
- [x] Perform/manual-equivalent validation or document sandbox blockers.
- [x] Clearly separate existing repo failures from newly introduced failures.
- [x] Commit and push branch if validation is acceptable. Commit completed locally and GitHub authentication is available for push.
- [x] Deliver findings, implementation details, files changed, QA results, blockers, and next milestone.
