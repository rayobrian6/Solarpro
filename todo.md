# SolarDog v11 — "Knows the Website"

## A: DB Layer — Migration 025 (schema upgrade + seed data)
- [ ] A1: Migration 025 — add steps[] column to solarpro_knowledge_items, add equipment type, seeded_global
- [ ] A2: Seed function solardogSeedKnowledge() — seed all pages, buttons, workflows, equipment
- [ ] A3: solardogKnowledgeSeeded() idempotent check
- [ ] A4: Call seed in migrate route after Migration 025

## B: DB functions — extend knowledge base CRUD
- [ ] B1: Update KnowledgeItem interface — add steps[], update type to include 'equipment'
- [ ] B2: solardogKnowledgeGet — include seeded global items merged with user items
- [ ] B3: solardogKnowledgeSearch — extend to search steps[] array too

## C: System prompt — v11 overhaul
- [ ] C1: Add GUIDED MODE section (workflow steps, step-by-step guidance)
- [ ] C2: Intent classification — enforce Understand→Explain→Suggest→Offer→Execute
- [ ] C3: Update KNOWLEDGE BASE section — workflows with steps, equipment comparisons
- [ ] C4: Update response format — add suggestedSteps[], currentStep, totalSteps, workflowKey
- [ ] C5: Update AssistantResponse type with guided workflow fields

## D: Knowledge seed data
- [ ] D1: Seed all 15 pages from SITE_MAP
- [ ] D2: Seed key buttons (generate_sld, run_nec, auto_fix, generate_bom, generate_proposal, etc.)
- [ ] D3: Seed workflows (pass_engineering, create_project, submit_permit, proposal_workflow)
- [ ] D4: Seed equipment brands (SolFence + major inverter/battery/panel brands)

## E: Tests — groups 37-44
- [ ] E1: Group 37 — intent classification (6 types)
- [ ] E2: Group 38 — guided mode triggers
- [ ] E3: Group 39 — knowledge base page explanations
- [ ] E4: Group 40 — button knowledge
- [ ] E5: Group 41 — workflow knowledge + steps
- [ ] E6: Group 42 — equipment knowledge
- [ ] E7: Group 43 — response format validation (guided fields)
- [ ] E8: Group 44 — forbidden behaviors

## F: Commit & Push
- [ ] F1: All tests passing | 0 TS errors
- [ ] F2: git commit v11 + push to origin/dev