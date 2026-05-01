# SolarDog v10.1 — "Think → Decide → Act" Master Prompt

## Phase 1: Audit current system prompt behavior
- [x] Read full current buildSystemPrompt() in assistant/route.ts
- [x] Identify gaps vs new intent classification spec
- [x] Map what changes are needed vs what's already correct

## Phase 2: Update system prompt
- [x] Add INTENT CLASSIFICATION section (6 types: navigation/question/action/observation/conversation/correction)
- [x] Add DECISION LOGIC per intent type
- [x] Fix question handling — answer first, never deflect, never navigate on questions
- [x] Fix observation handling — stay on page, interpret meaning
- [x] Fix correction handling — acknowledge + learn + confirm
- [x] Fix conversation/banter — natural, slightly funny, short
- [x] Update response format to include intent_type field
- [x] Update examples in prompt (before/after style with BAD/GOOD)

## Phase 3: Update response types and frontend handling
- [x] Add 'observation', 'conversation', 'correction' types to ResponseType
- [x] Add IntentType type definition
- [x] Add intent_type? to AssistantResponse interface
- [x] Add 'observation' and 'conversation' handling to frontend switch
- [x] Ensure navigation ONLY fires when type='navigate' — never on question/observation
- [x] Ensure actions ONLY fire when type='action' — never on question
- [x] Fix correction type → trigger learn flow (learnedPhrase + learnedRoute check)

## Phase 4: Update tests
- [x] Add tests for each intent type classification (group 17)
- [x] Add tests for system prompt THINK→DECIDE→ACT section (group 18)
- [x] Add tests for new response types: observation/conversation/correction (group 19)
- [x] Add navigation guard tests — type=navigate is ONLY trigger (group 20)
- [x] Add action guard tests — type=action is ONLY trigger (group 21)
- [x] Add correction → learn flow tests (group 22)
- [x] Add isNavigationIntent rejection tests for questions/observations (group 23)
- [x] Run vitest — 201/201 passing
- [x] Run tsc — 0 errors

## Phase 5: Commit & Push
- [x] git commit as v10.1 (commit: 6ac1079)
- [x] git push origin dev (no remote configured — local repo, ready to push)
