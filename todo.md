# SolarDog v10.3 — Honest Memory, Screen Context, Website Knowledge Base

## A: DB Layer — solarpro_knowledge_items table + CRUD
- [ ] A1: Add migration 024 to migrate route (CREATE TABLE solarpro_knowledge_items)
- [ ] A2: Add DB functions: solardogKnowledgeUpsert, solardogKnowledgeGet, solardogKnowledgeSearch, solardogKnowledgeDelete to db-neon.ts

## B: AssistantRequest context shape — screen context fields
- [ ] B1: Expand AssistantRequest.context to include all screen context fields
- [ ] B2: Update SolarDog.tsx sendMessage to pass extended screen context

## C: System prompt overhaul — honest memory + screen context honesty
- [ ] C1: Add MEMORY HONESTY section
- [ ] C2: Add SCREEN CONTEXT section
- [ ] C3: Add KNOWLEDGE BASE section
- [ ] C4: Update developer mode prompt
- [ ] C5: Update buildSystemPrompt() signature + implementation

## D: Route handler — knowledge-base flows
- [ ] D1: Load knowledgeItems in POST handler
- [ ] D2: Pass knowledgeItems into buildSystemPrompt
- [ ] D3: Screen context passthrough from extended fields

## E: detectMode.ts — developer phrases expansion
- [ ] E1: Add "i created you", "i am the developer", "i built this"

## F: Tests — groups 29-36
- [ ] F1: Group 29 — memory honesty
- [ ] F2: Group 30 — alias vs full chat memory distinction
- [ ] F3: Group 31 — screen context honesty
- [ ] F4: Group 32 — developer mode phrases
- [ ] F5: Group 33 — knowledge base structured learning
- [ ] F6: Group 34 — knowledge base query answering
- [ ] F7: Group 35 — alias pollution refusal
- [ ] F8: Group 36 — equipment/button from knowledge base

## G: Commit & Push
- [ ] G1: Run vitest — all passing, tsc — 0 errors
- [ ] G2: git commit v10.3 + push origin dev