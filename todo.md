# SolarPro — Overnight Build (Phase G + Campaign Infrastructure)
# Branch: dev only — NO push to master

## 1. Phase G — Public Intake API
- [ ] /api/intake/[source]/route.ts — main intake endpoint
- [ ] HMAC signature verification (Meta, Google, generic)
- [ ] Rate limiting + deduplication + validation
- [ ] Write to network_opportunities + intake_events
- [ ] GET handler for Meta webhook verification challenge

## 2. Phase G — Enrichment Worker
- [ ] lib/enrichment/attom.ts — ATTOM property data lookup
- [ ] lib/enrichment/openei.ts — OpenEI utility rate lookup
- [ ] /api/admin/network/enrichment/worker/route.ts — trigger worker
- [ ] Process enrichment_queue, write back to network_opportunities

## 3. Migration 060 — Campaign + Funnel Seeds
- [ ] lib/migrations/060_campaign_seeds.sql (funnels + campaigns seed data)

## 4. Admin UI — Campaigns Tab
- [ ] app/api/admin/network/campaigns/route.ts — CRUD API
- [ ] Add CampaignsSection to app/admin/network/page.tsx

## 5. Campaign Brief Document
- [ ] Full Google + Meta + TikTok campaign brief as HTML report

## 6. Final QA + Commit
- [ ] tsc --noEmit
- [ ] eslint check
- [ ] git commit + push dev (NO master)
