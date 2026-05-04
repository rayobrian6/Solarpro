# Context Injection Layer — Implementation

## Phase 1: Core files
- [x] Create lib/solardog/uiMap.ts — canonical UI_MAP with engineering actions/panels
- [x] Create lib/solardog/workflow.ts — WORKFLOW graph for all major flows
- [x] Create lib/solardog/buildContext.ts — buildContext() assembling full CONTEXT_JSON

## Phase 2: API layer
- [x] Update AssistantRequest type in route.ts to accept uiContext + recentEvents
- [x] Add suggestedActions[] to AssistantResponse type (id, label, confidence)
- [x] Inject CONTEXT_JSON as second system message in the LLM call
- [x] Add recentEvents support (UI_EVENTs posted from frontend)

## Phase 3: System prompt patch
- [x] Add CONTEXT_JSON truth rules to system prompt
- [x] Update JSON schema in prompt to include suggestedActions[] + nextStep

## Phase 4: Frontend — SolarDog.tsx
- [x] Add suggestedActions rendering (clickable action buttons from LLM response)
- [x] Add postUIEvent() helper to send actionId events back on button click
- [x] Accept recentEvents in sendMessage() context payload + clear after send
- [x] Add nextStep pill display under assistant messages
- [x] ChatMessage interface: suggestedActions[], nextStep fields

## Phase 5: Verify
- [x] TypeScript compile (tsc --noEmit) — 0 errors
- [x] Commit + push to dev (e8249e2)