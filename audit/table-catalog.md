# SolarPro Database Table Catalog (Evidence-Based)

Generated from SQL migrations and route/source references. This catalog intentionally groups tables by current platform domain for the Topography reconciliation.

## Core project / CRM
- `users` — account/auth/role/subscription records; consumed by auth, admin, organizations, contractor profile, project ownership, portal invite, health.
- `clients` — homeowner/customer CRM record; upstream to projects, portal OTP login, proposals, client notes, portal dashboard.
- `projects` — canonical project entity; links clients, design/layout, engineering, proposals, portal stages, survey physical data, files, marketplace-origin projects.
- `layouts` — panel layout/design state; consumed by project layout APIs, design/engineering, production and proposal paths.
- `productions` — energy production results; created/read by production/PVWATTS-style APIs and proposals.
- `project_versions` — project snapshots/version history.
- `project_micro_stages` — project/customer stage details used by admin project, portal dashboard, proposal sharing.
- `project_homeowner_stage_history` — homeowner-visible stage history; written by portal bill upload and homeowner-stage APIs, read by portal dashboard/admin project.
- `project_activity` — operational activity timeline; read/write by dashboard/project activity APIs.
- `project_tasks`, `project_milestones`, `project_schedule`, `crews`, `crew_members` — operations/task/scheduling support tables referenced by dashboard/schedule/task APIs.

## Files / documents / generated artifacts
- `project_files` — file/artifact metadata for uploads, bill attachments, survey photos, engineering runs, permit/plan artifacts and project files UI.
- `proposals` — proposal records and shared proposal state; read/write by proposal routes and portal dashboard.
- `proposal_signatures` — e-signature metadata for proposal signing.
- `engineering_runs` — saved engineering run output metadata; consumed by latest-run/run-from-file/save-outputs.

## Marketplace / acquisition / intelligence
- `contractor_profiles` — contractor capability, territory, network active state; read by contractor profile and matching/discover routes.
- `opportunities` — legacy/contractor-shared opportunity table; still read by my-opportunities/my-claims and claim compatibility routes.
- `opportunity_claims` — legacy claim records for `opportunities`; compatibility with contractor claim flows.
- `network_opportunities` — canonical marketplace opportunity inventory; source of admin control center and contractor Discover marketplace.
- `opportunity_screening_queue` — admin screening/release readiness queue for network opportunities.
- `opportunity_intelligence` — structured intelligence payload/enrichment/scoring for opportunities.
- `opportunity_assignments` — contractor claims/assignments and claim lifecycle for network marketplace.
- `opportunity_sources` — source attribution for acquisition/opportunity records.
- `network_events` — marketplace/system event stream.
- `intake_events` — homeowner/acquisition intake event log feeding admin lead operations and marketplace projection.
- `intake_funnels` — intake funnel configuration and public form routing.
- `acquisition_campaigns` and `campaign_analytics` — paid/organic/referral campaign metadata and reporting.
- `enrichment_queue` — queued enrichment work for opportunities/intake records.
- `intelligence_observations` — intelligence observation stream/table from later marketplace intelligence migrations.
- `webhook_ingestion_log` — acquisition webhook ingestion logs for Google/Meta/generic sources.

## Survey / mobile / physical data
- `mobile_sso_used_jtis` — replay protection for mobile SSO handoff from `/api/auth/authorize`.
- `webhook_deliveries` — partner survey webhook idempotency/log table for `survey.completed` ingestion.
- `site_surveys` — normalized site survey records.
- `site_survey_files` — site survey photo/file metadata.
- `project_physical_data` — canonical physical survey/electrical/roof fields attached to projects.
- `site_conditions` — project environmental/site condition data referenced by auto-config/site condition APIs.

## Equipment / utilities / pricing
- `hardware_components` — hardware/admin equipment catalog.
- `user_equipment_panels`, `user_equipment_inverters`, `user_equipment_batteries`, `user_equipment_mounting` — user equipment library records.
- `distributor_prices` — distributor/material pricing used by engineering BOM/admin distributor pricing.
- `pricing_config` — pricing configuration used by pricing APIs/proposals.
- `utility_policies`, `site_aliases`, `state_nec_mapping`, `county_environmental_data`, `incentive_overrides` — utility, AHJ, incentive and policy data.

## Auth / org / portal / billing
- `password_reset_tokens` — auth password reset.
- `portal_otp_tokens` — homeowner portal OTP login.
- `organizations`, `org_invites` — org/team management.
- `admin_impersonation_tokens` — admin impersonation.
- `admin_activity_log` — admin audit/action log.

## Feedback / knowledge / assistant
- `feedback` — user/admin feedback and screenshots metadata.
- `solardog_conversations`, `solarpro_knowledge_items` — SolarDog/knowledge-base features.
