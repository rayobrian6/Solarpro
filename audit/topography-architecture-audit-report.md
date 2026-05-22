# SolarPro Topography Architecture Audit Report

Branch: `audit/topography-architecture-reconciliation`  
Mode: Audit-first, no feature work  
Scope: Admin Topography / SolarPro Mission Control reconciliation against verified repository routes, API handlers, migrations, and representative backend libraries.

## 1. Evidence Sources Reviewed

This audit is based on direct source inspection and generated static inventories, not inferred product intent. The primary Topography files reviewed were `app/admin/topography/page.tsx`, `app/api/topography/state/route.ts`, and `lib/topography/getTopographyState.ts`. The audit also reviewed route and API inventories generated into `audit/route-inventory.md` and `audit/dependency-inventory.md`, migration/table evidence in `audit/database-table-evidence.md`, curated domain grouping in `audit/table-catalog.md`, representative route excerpts in `audit/pipeline-route-excerpts.txt`, representative backend library excerpts in `audit/pipeline-lib-excerpts.txt`, and selected topology-adjacent engineering files including `app/api/engineering/topology/route.ts`, `lib/topology-engine.ts`, and `lib/topology-manager.ts`.

## 2. Current Topology Map Source Files

The live Admin Topography route is `app/admin/topography/page.tsx`. It is a client-side admin page with a split layout. The left side has tabs for `map`, `pipeline`, `partner`, and `surveys`; the right side renders a `System Integration Panel` for a selected project ID. The map tab embeds a fixed external iframe using `TOPO_URL`, currently `https://sites.super.myninja.ai/399ee147-1c47-4168-953c-039b63bf656e/a29238b9/index.html`. The partner tab points to `/partner-pipeline-topology.html`, but no substantive local HTML content was found during the audit. The pipeline tab is fully hardcoded inside `app/admin/topography/page.tsx` through `PIPELINE_STEPS`. The surveys tab contains live force-ingest and reassignment tooling.

The Topography state endpoint is `app/api/topography/state/route.ts`. It exposes `GET /api/topography/state?projectId=...`, requires a user from the request, verifies project ownership in `projects`, and delegates read-only project/survey/artifact inspection to `getTopographyState(projectId)`.

The Topography read layer is `lib/topography/getTopographyState.ts`. It returns a `TopographyState` with project metadata, survey status, field usage, system integration flags, engineering artifact status, permit artifact status, layout status, iframe status, and errors. It explicitly marks several survey integration outputs as not wired by static code analysis: `appliedToSystemDefinition`, `usedInCAD`, `usedInPermit`, and `usedInProposal` are false; engineering is partial because the engineering report consumes only four of twenty physical-data fields.

The engineering topology endpoint `app/api/engineering/topology/route.ts` is not the Admin Mission Control map. It is an authenticated POST endpoint that resolves equipment/electrical topology from selected inverter, optimizer, racking, battery, module count, string count, roof type, and system type. It delegates to `lib/topology-manager.ts` and returns topology label, accessory resolution, SLD stages, BOM stages, compliance flags, and labels. This should be represented as part of the engineering pipeline, but it is a distinct electrical/equipment topology engine, not the website/database architecture topology map.

## 3. Current Topology Data Model

The current Admin Topography page uses several local TypeScript types. `NodeStatus` is defined as `'green' | 'yellow' | 'red' | 'unknown'` for the live integration panel. The main pipeline model is `PipelineStep`, with fields `num`, `layer`, `layerLabel`, `title`, `detail`, `code`, optional `envVars`, and a status limited to `'live' | 'degraded' | 'blocked' | 'external'`. The `PIPELINE_STEPS` array is hardcoded in the page and currently describes only the partner mobile survey handoff into SolarPro survey ingest and partial engineering consumption.

The current `PIPELINE_STEPS` model is too narrow for the directive. It cannot express canonical platform domains such as public intake, bill upload, utility bill intelligence, admin lead operations, marketplace screening/release, contractor discovery/claim, homeowner portal, project/proposal lifecycle, equipment/pricing registries, generated document artifacts, external AI/OCR services, external maps/solar APIs, health/logging, and stale/planned/blocked system segments with nuanced evidence.

The current per-project live state model in `TopographyState` is valuable and should be preserved. It covers project ownership, survey presence, `project_physical_data`, `engineering_reports`/artifacts, permit artifacts, layout existence, and iframe state. It is not currently a canonical architecture model; it is a project-level live audit panel.

## 4. Existing Node Categories

The currently rendered pipeline categories are only color layers in `PIPELINE_STEPS`. They effectively represent mobile app, partner backend, webhook boundary, SolarPro ingest, SolarPro database, and engineering/report output. The status summary rows are similarly survey-specific: partner mobile, partner backend queue, outbound delivery worker, HMAC signing, SolarPro webhook receiver, full payload fetch, transform/upsert to `project_physical_data`, engineering report partial field usage, and SystemDefinition/CAD/Permit/Proposal not wired.

The current tabs create four surface categories: external map iframe, hardcoded pipeline, partner app topology, and live survey data/debug tools. These are UI categories, not canonical platform architecture domains.

## 5. Existing Edge Categories

The current pipeline edges are implicit through the numbered `PIPELINE_STEPS`; there is no explicit edge model. Relationships are visually inferred from step order. Edge types represented by the current copy include identity handoff, persisted survey capture, complete trigger, webhook queue, HMAC delivery, webhook receiver verification, full payload fetch, field normalization, `project_physical_data` upsert, and partial engineering report consumption.

The current model does not explicitly represent route-to-API, API-to-library, library-to-table, table-to-admin UI, table-to-contractor portal, artifact generation, external service calls, or planned/blocked edges. Those are required for a canonical SolarPro Mission Control map.

## 6. Copy / Export Behavior

A grep and source inspection of `app/admin/topography/page.tsx` found no existing `ChatGPT`, `navigator.clipboard`, download, or architecture export behavior. The user requirement that “Copy for ChatGPT output includes updated topology context” therefore appears to refer either to a missing/stale feature or an expected Topography capability not present in the current route. Implementation should add a targeted copy/export mechanism inside the Topography page rather than inventing a separate system.

## 7. Missing Systems in Current Map

The current map omits many live systems verified by route, API, migration, and library evidence. Missing systems include the public homeowner estimate/intake route `/free-solar-estimate` and API `POST /api/intake/homeowner`; post-submit qualification `POST /api/intake/homeowner/qualification`; canonical intake persistence in `intake_events` and funnel configuration in `intake_funnels`; utility bill attachment storage and bill metadata; utility bill OCR, parsing, Claude/AI extraction, enrichment, confidence, and insights; admin bill intelligence trigger `/api/admin/network/intake/bill-intelligence`; admin network control center routes and APIs; marketplace inventory, screening, release gate, contractor matching, opportunity assignment, opportunity intelligence, revenue projection, and event logging; contractor-facing `/network` discovery, profile, opportunity, claim, and my-claims flows; homeowner portal OTP and dashboard flows; core CRM/project/client/proposal/files flows; engineering calculation, topology resolution, BOM, SLD, permit, plan-set, PVWatts, structural, and output saving APIs; 3D/map/session/solar design surfaces; equipment/manufacturer/price registries; survey/mobile webhook and survey photo flows beyond the narrow partner handoff; and admin health/logging/analytics/observability surfaces.

## 8. Stale or Partial Systems in Current Map

The current hardcoded pipeline is not wrong as a survey-specific diagnostic, but it is stale as the canonical SolarPro platform topology. It over-represents Partner Mobile → SolarPro survey ingest and under-represents the marketplace and bill intelligence systems that now exist. The existing map iframe is external and not dynamically connected to repository/database evidence. The partner topology tab should remain available as legacy/reference partner documentation, but it should not be the canonical architecture map. The SystemDefinition/CAD/Permit/Proposal row is currently marked not wired in the survey field flow; this should remain explicit rather than hidden. Engineering report consumption from survey remains partial, not fully live.

## 9. Required New Nodes

The updated Topography should introduce a canonical architecture model with evidence-backed nodes. Required nodes include: public homeowner estimate form; homeowner intake API; `intake_events`; qualification API/event; utility bill upload/attachment storage; bill OCR/parser/Claude/enrichment/confidence/insights; bill intelligence admin trigger; admin intake feed and review; marketplace inventory/release service; `network_opportunities`; screening queue; opportunity intelligence; contractor matcher; assignments; network events; contractor discovery route; opportunity claim API; contractor profile and claim tables; homeowner portal OTP and dashboard; clients/projects/layouts/project files/proposals; survey capture/API/webhook; partner API and webhook queue; `project_physical_data`; engineering report generator; engineering topology resolver; BOM, SLD, permit, plan set, structural, PVWatts, and save-output APIs; 3D/map/solar design routes; equipment registries, user equipment tables, distributor prices, utility policies, pricing config; admin analytics/health/webhook logs/activity logs; external AI/OCR, Vercel Blob/local uploads, Google Maps/Solar, NREL/PVWATTS, Stripe, Resend, and partner Render API.

## 10. Required New Edges

The updated Topography should explicitly show these verified flows: `/free-solar-estimate` → `POST /api/intake/homeowner` → `lib/intake/homeownerEventIntake.ts` → `intake_events`; qualification → appended intake lifecycle event; bill upload → Vercel Blob/local fallback and bill attachment metadata → bill intelligence trigger → OCR/parser/Claude/enrichment/confidence/insights → opportunity enrichment; admin intake review → marketplace release service → `network_opportunities` + screening/release gate + intelligence + assignments/events; contractor `/network` → opportunities API → claim API → `opportunity_claims`/assignment; portal OTP → portal dashboard/bill upload → projects/files/proposals/stage history; survey submit/webhook → normalization/enrichment → `site_surveys`/`project_physical_data`/survey files → engineering report partial field use; project/layout/equipment selection → engineering topology resolver → BOM/SLD/permit/plan set/PVWatts/structural outputs → `project_files`/artifacts; 3D/maps/solar APIs → layout/design surfaces; admin health/logging → network events, webhook ingestion log, admin activity log, analytics.

## 11. Route → API → DB Relationship Summary

The public intake relationship is `/free-solar-estimate` to `POST /api/intake/homeowner`, backed by `lib/intake/homeownerEventIntake.ts`, `intake_funnels`, and `intake_events`. The qualification relationship is `POST /api/intake/homeowner/qualification`, which appends qualification intelligence into `intake_events` for admin review.

The bill intelligence relationship includes portal/admin upload surfaces, `POST /api/bill-upload`, OCR/parser endpoints, `lib/intake/utilityBillAttachment.ts`, `lib/intake/utilityBillIntelligence.ts`, `lib/billPipeline`, `lib/billClaudeExtractor`, `lib/billEnrichment`, `lib/billConfidence`, `lib/billParser`, `lib/billInsights`, and opportunity enrichment. Storage uses Vercel Blob when configured and local public uploads outside production. Database evidence includes `project_files`, `projects.bill_data`, `intake_events`, and marketplace intelligence/opportunity tables depending on conversion state.

The marketplace relationship includes admin APIs under `/api/admin/network/*`, including marketplace, opportunities, screening, enrichment, contractor-match, analytics, health, funnels, campaigns, webhooks, and intake bill intelligence. Core tables include `network_opportunities`, `opportunity_screening_queue`, `opportunity_intelligence`, `opportunity_assignments`, `opportunity_claims`, `contractor_profiles`, `network_events`, `opportunity_sources`, `enrichment_queue`, `webhook_ingestion_log`, `intake_funnels`, `acquisition_campaigns`, and `campaign_analytics`.

The contractor portal relationship includes `/network`, `/api/network/opportunities`, `/api/network/opportunities/[id]/claim`, `/api/network/my-opportunities`, `/api/network/my-claims`, and `/api/network/contractor-profile`. The verified persistence layer includes `network_opportunities`, `opportunity_claims`, `opportunity_assignments`, `contractor_profiles`, and `network_events`.

The homeowner portal relationship includes `/portal/dashboard`, `GET /api/portal/dashboard`, portal auth/logout/bill-upload routes, `portal_otp_tokens`, `projects`, `project_homeowner_stage_history`, `project_micro_stages`, `project_files`, proposals, and bill data/project metadata.

The survey relationship includes partner identity handoff `/api/auth/authorize`, survey submit/photo routes, `POST /api/webhooks/survey-complete`, admin webhook logs/reassignment/debug force ingest routes, `lib/survey/ingest/ingestPipeline.ts`, `site_surveys`, `site_survey_files`, `project_physical_data`, `webhook_deliveries`, and `webhook_ingestion_log`. The current live integration panel verifies only project-specific survey/engineering connections.

The engineering relationship includes `/engineering` and APIs such as `/api/engineering/topology`, `/api/engineering/bom`, `/api/engineering/sld`, `/api/engineering/sld/pdf`, `/api/engineering/permit`, `/api/engineering/plan-set`, `/api/engineering/pvwatts`, `/api/engineering/structural-v2`, `/api/engineering/sync-pipeline`, `/api/engineering/save-outputs`, and project layout/file APIs. Core evidence includes `layouts`, `project_hardware`, `project_files`, `engineering_runs`, `productions`, equipment tables, `pricing_config`, `utility_policies`, and registry libraries.

The 3D/topography/maps relationship includes map/session/solar APIs, design/layout surfaces, Google Maps/Solar external hints, Mapbox/Cesium/Three dependencies, and layout/project persistence. It should be represented as a design and visualization subsystem, while keeping the external map iframe marked as external/static and not dynamically connected.

The health/logging relationship includes admin network health, analytics, webhooks, admin activity logging, webhook ingestion logging, network events, campaign analytics, and system/API status surfaces.

## 12. Proposed Updated Topology Structure

The updated Topography should preserve the existing tabs and live project integration panel, but replace the narrow hardcoded survey-only pipeline view with a canonical architecture map section. The proposed model should use explicit node groups and edges. Node groups should include Entry & Intake, Bill Intelligence, Admin Lead Operations, Marketplace, Contractor Network, Homeowner Portal, Core Project/CRM, Survey & Physical Data, Engineering & Documents, 3D/Maps/Solar Design, Equipment/Pricing/Utility Data, Health/Logging/Observability, and External Services. Each node should carry an evidence-backed status such as live, partial, external, legacy, planned, or blocked, plus route/API/table/library references.

The canonical pipeline view should make the required end-to-end flows visible in the UI: Homeowner Intake → Bill Intelligence → Lead Operations → Marketplace Release → Contractor Discovery/Claim → Project/Portal/Engineering, and Survey → 3D → Engineering → SLD/BOM/Plan/Permit → Proposal/Portal. It should mark survey-to-engineering as partial, SystemDefinition/CAD/Permit/Proposal survey auto-application as blocked/not wired, and the external iframe/partner map as external or legacy reference.

The implementation should add a targeted Copy for ChatGPT/export button that copies a text snapshot of the updated topology context, including node groups, key edges, statuses, and evidence references. This is a Topography requirement and should not create unrelated features.
