# SolarPro Fix Tracker

## Completed ✅
- [x] Fix pdf-parse cold-start crash (wrapped in try/catch)
- [x] Fix PDF extraction on Vercel (OpenAI Files API)
- [x] Fix image extraction (GPT-4o Vision)
- [x] Fix TypeScript Buffer→Blob error
- [x] Fix client creation email slug (empty string fallback)
- [x] Fix client creation address (multi-level fallback, >=5 chars)
- [x] Fix project creation address (use safeAddress not clientAddress)
- [x] Push v36.6
- [x] Fix "Could not extract text from file" on Vercel (DOMMatrix error)
- [x] Fix wrong kWh extracted (31 instead of 4,993)
- [x] Fix wrong address ("1016 FRANKLIN ST, HOME Servi...")
- [x] Fix wrong utility name ("A charge used to recover...")
- [x] Fix customer name extraction
- [x] Fix rate validation minimum (0.04 → 0.01)
- [x] Push v37.7 with all OCR fixes
- [x] Grant free pass to sarah@solfence.solar (DB confirmed correct)
- [x] Add Quick Launch 3D design (v37.8) - bypass project requirement
- [x] Fix subscription loading flash (v38.0)
  - proposals/page.tsx: canGenerate=true while subLoading (no preview-only flash)
  - projects/page.tsx: maxProjects=null while subLoading (no project limit flash)
  - clients/page.tsx: maxClients=null while subLoading (no client limit flash)
  - engineering/page.tsx: canSLD/canPermit/canBOM=true while subLoading

## Pending 📋
- [ ] Engineering report auto-generation on bill upload (original request)