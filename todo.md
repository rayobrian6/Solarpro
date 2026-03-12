# Bill OCR Extraction Repair + Dev Branch Workflow

## Phase 1: Audit (read-only)
- [ ] Read current route.ts parsing pipeline end-to-end
- [ ] Read billParser.ts extractors (printed table, handwritten, bar graph, utility, rate)
- [ ] Read billOcr.ts parseBillText() — address, customer, account, charges
- [ ] Read billOcrEngine.ts — OCR engine, confidence scoring
- [ ] Read /api/ocr/route.ts — Tesseract WASM/CLI path
- [ ] Identify exact failure point: OCR producing text? Parser failing on text?

## Phase 2: Dev branch setup
- [ ] Create dev branch from master
- [ ] Configure vercel.json: dev=preview, master=production (manual only)
- [ ] Update main.yml: require manual approval before production deploy

## Phase 3: OCR fixes
- [ ] Add raw OCR text logging before any parsing
- [ ] Add image preprocessing (grayscale, contrast, threshold, upscale) via sharp/jimp
- [ ] Add multi-pass OCR (PSM 4 standard + PSM 6 document layout)
- [ ] Merge best text from both passes

## Phase 4: Parser fixes
- [ ] Audit each extractor against real CMP bill patterns
- [ ] Fix utility detection (flexible header scan)
- [ ] Fix kWh extraction (flexible patterns, no rigid label requirement)
- [ ] Fix address/customer/rate/total extraction
- [ ] Add AI extraction fallback when 0 fields parsed

## Phase 5: Confidence + UI
- [ ] Fix confidence scoring (not "0 fields" when text exists)
- [ ] Confirm UI shows partial results + manual correction path

## Phase 6: Commit + push to dev only
- [ ] TypeScript check
- [ ] Commit to dev branch
- [ ] Push dev → preview only (NOT master)