# Bill Upload Fix + Dashboard Integration

## Phase 1: Fix PDF Extraction
- [ ] Debug exact error from bill-upload API (check via test)
- [ ] Fix pdf-parse extraction — test with real bill PDF
- [ ] Add better fallback chain (pdftotext CLI → Vision API)

## Phase 2: Dashboard Bill Upload Button
- [ ] Add "Upload Bill" button to dashboard next to "Add Client"
- [ ] Wire button to open BillUploadFlow modal

## Phase 3: Auto-create Client + Proposal on Upload
- [ ] On bill upload complete: auto-create client from bill data (name + address)
- [ ] Auto-create project linked to that client
- [ ] Auto-create proposal with system sizing data
- [ ] Auto-generate semi-complete engineering report

## Phase 4: Build & Push
- [ ] Commit and push
- [ ] Provide zip