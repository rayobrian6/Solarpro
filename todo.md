# v46.0 — Deterministic Bill Parser Wiring

## Tasks
- [x] Review current route.ts (calls parseBillTextWithLLM as final parser)
- [x] Review billParser.ts (698-line deterministic parseBill() complete)
- [x] Review BillExtractResult interface in billOcr.ts
- [ ] Wire route.ts: replace parseBillTextWithLLM() with parseBill() as final parser
- [ ] Map BillParseResult → BillExtractResult for response compatibility
- [ ] Add extraction evidence to API response (debugLog, source tags)
- [ ] Preserve non-usage fields (serviceAddress, customerName, etc.) from billOcr.parseBillText()
- [ ] Update version.ts to v46.0
- [ ] TypeScript check
- [ ] Git commit + push