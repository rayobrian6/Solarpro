# SolarDog v10.2 + Login Fix

## Task A: SolarDog v10.2 — Selective Learning + Real Conversation

### A1: Fix detectLearnIntent() — strict patterns + validation
- [ ] Rewrite detectLearnIntent() with strict "X is Y" / "X means Y" / "X = Y" only
- [ ] Add isValidLearnPhrase() / isValidLearnTarget() helpers (≤40 chars, ≤4 words, valid route)
- [ ] Add unlearn detection function detectUnlearnIntent()
- [ ] Add pendingLearnPhrase/pendingLearnRoute to AssistantResponse interface

### A2: Update db-neon — deleteAlias support
- [ ] Add solardogDeleteAlias() to db-neon.ts

### A3: Fix system prompt — platform identity + personality + learn discipline
- [ ] Add PLATFORM IDENTITY section
- [ ] Fix CONVERSATION personality (dry humor, not corporate)
- [ ] Add RESPONSE PRIORITY (Answer→Explain→Suggest→Offer→Execute)
- [ ] Strengthen LEARN RULES (strict patterns, confirmation before saving)
- [ ] Add UNLEARN section

### A4: Update route handler — confirmation flow + unlearn
- [ ] Add unlearn detection + deleteAlias call in pre-flight
- [ ] Add learn confirmation flow (pending state, confirm before saving)
- [ ] Add pendingLearnPhrase/pendingLearnRoute to response

### A5: Tests — v10.2 groups 24-28
- [ ] Group 24: detectLearnIntent strict mode (X is Y / X means Y / X = Y only)
- [ ] Group 25: Learn validation (phrase length/word count limits)
- [ ] Group 26: detectUnlearnIntent detection
- [ ] Group 27: System prompt platform identity + personality
- [ ] Group 28: Response priority in system prompt
- [ ] Run vitest — all passing, run tsc — 0 errors

## Task B: Login Fix — Auth System Audit + Debug Endpoint

### B1: Audit + fix auth issues
- [ ] Check migrate/register for password_hash mutation
- [ ] Verify cookie options correct
- [ ] Add auth failure logging

### B2: Add GET /api/admin/debug/auth-status endpoint
- [ ] Returns: userExists, passwordValid, jwtValid, cookiePresent

### B3: Commit & Push
- [ ] git commit v10.2 + login fix
- [ ] git push origin dev --force