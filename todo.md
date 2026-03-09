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

## In Progress 🔄
- [ ] Fix Sarah's free pass not showing in UI
  - Root cause: useSubscription defaults to plan='starter'/isFreePass=false while loading
  - proposals/page.tsx: isPreviewOnly=true during load → shows upgrade wall
  - projects/page.tsx: atProjectLimit may trigger during load if 2+ projects
  - Fix: guard all plan-gating with subLoading check
- [ ] Fix project creation failing for new clients (can't open 3D design)

## Pending 📋
- [ ] Engineering report auto-generation on bill upload (original request)