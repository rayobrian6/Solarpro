# Phase 1A Architecture Decision — Authoritative Migration Model

> Branch: `dev` at `d7b8e400`. This document records the architecture decision for
> Phase 1A (MIGRATION-GOV-01) and the historical migration reconciliation inventory.
> It is the authoritative reference for all implementation that follows.

## 1. Decision: One Authoritative Migration Execution Model

### 1.1 The Chosen Model

The canonical migration model for SolarPro is:

**Versioned migration files (from `lib/migrations/`) + `schema_migrations` database
ledger + mandatory SHA-256 checksums + single execution service + transactional
execution + PostgreSQL advisory locks + environment-aware authorization +
append-only application history.**

### 1.2 Rationale

The audit (see `AUDIT-MIGRATION-SYSTEM.md`) confirmed three non-authoritative
execution paths, no ledger, no locks, no transactions, and optional-only
checksums. The chosen model eliminates every one of these defects:

1. **Single source of SQL:** Migration SQL lives exclusively in versioned files
   under `lib/migrations/`. The inline SQL in `app/api/migrate/route.ts` is legacy
   drift and must NOT be treated as authoritative going forward.
2. **`schema_migrations` ledger:** A new database table records every migration
   attempt with full provenance (actor, environment, checksum, duration, status).
   This is the single source of truth for applied state.
3. **Mandatory checksums:** Every migration file's SHA-256 is computed over its
   exact bytes at discovery time and recorded in the ledger. A file whose checksum
   does not match the ledger's recorded value for an `applied` migration is
   flagged as `conflict.detected` and refused. No silent override.
4. **Single execution service:** `lib/migrations/runner.ts` is the only module
   permitted to apply schema migrations. Both legacy runners are restricted to
   delegate or to diagnostics-only.
5. **Transactional execution:** Each migration is applied within a single Neon
   transaction (synchronous callback returning an array of statement promises).
   On failure, the entire migration rolls back; the ledger records `failed`.
6. **Advisory locks:** A PostgreSQL session-level advisory lock guards migration
   execution so concurrent invocations cannot interleave.
7. **Environment-aware authorization:** Production migration execution is disabled
   by default. An explicit environment allowlist (`MIGRATION_RUN_ALLOWED_ENVS`)
   must include the current environment for execution to proceed. Dry-run
   (inspection) is permitted everywhere.
8. **Append-only history:** Ledger rows for `applied` migrations are never
   deleted or mutated. A migration that is re-run after being `applied` is
   refused (idempotent at the ledger level). `superseded` is a terminal state
   used only for explicit administrative deprecation.

### 1.3 Legacy Runner Disposition (NOT deletion)

Per the spec, legacy runners are NOT deleted in Phase 1A. Their dispositions:

- **`app/api/migrate/route.ts` (inline runner):** The mutation path is gated
  behind a feature flag (`MIGRATION_LEGACY_INLINE_ENABLED`, default `false`).
  When invoked, it emits a `migration.legacy.invoked` audit event and returns a
  deprecation notice directing operators to the canonical API. The health-check
  / read-only portions (table stats, row counts) remain functional for the admin
  database page. This preserves the admin UI's diagnostic value without allowing
  ungoverned DDL.
- **`app/api/admin/system-tools/route.ts` (`run_migration` case):** The
  `run_migration` case is converted to delegate to the canonical runner's
  `runSinglePendingMigration()` (which provides ledger, checksum, transaction,
  lock). `list_migrations` continues to list files but sources from the canonical
  manifest. `set_user_password` (emergency tool) is untouched — it is a separate
  concern outside migration governance.
- **`app/api/admin/prospects/seed/route.ts` (direct file read bypass):**
  Documented as a known non-canonical bypass. It is outside the Phase 1A scope to
  refactor, but it is recorded in the audit and flagged for future deprecation.
  No code change in Phase 1A.

## 2. Historical Migration Reconciliation Inventory

### 2.1 Policy

- **No renumbering.** Historical migration files are NOT renumbered or modified.
- **Gaps remain reserved.** Prefixes 009, 012, 013, 014 have no file and are
  reserved. The canonical manifest treats a missing prefix as a reserved gap, not
  an error.
- **Duplicate 074 is a historical anomaly.** Two files share prefix 074. The
  canonical manifest assigns each a distinct `migration_identifier` that
  disambiguates them (see §2.3). Both are treated as valid, independent
  migrations. The ledger records each by its unique identifier + filename, so
  there is no collision.
- **The legacy `migrations/` directory is excluded** from the canonical manifest.
  It is a frozen duplicate not referenced by active runners.

### 2.2 Migration Identifier Scheme

The `migration_identifier` is the numeric prefix zero-padded to 3 digits,
EXCEPT for duplicate prefixes, where a suffix disambiguates:

- Normal: `073` → identifier `073`
- Duplicate 074: `074a` (`074_photo_vision_jobs_dedup_index.sql`) and `074b`
  (`074_photo_vision_jobs_render_job_id.sql`)

The suffix is determined deterministically by sorting the duplicate-prefixed
filenames alphabetically and assigning `a`, `b`, … This is stable and
reproducible.

### 2.3 Full Inventory (101 files, `lib/migrations/`)

Each row: prefix, filename, SHA-256 (over exact file bytes at audit time),
git introduction commit, introduction date. Applied-state is unknown (no ledger
exists pre-Phase-1A); the ledger will be bootstrapped with all rows in `pending`
status unless explicitly marked `applied` by an administrative act.

| Prefix | Filename | SHA-256 | Git Intro | Intro Date |
|--------|----------|---------|-----------|------------|
| 001 | 001_initial_schema.sql | cba3408c785f723dacf6f7709222e19a9620a63c5993880ea9c3dd58ae3e1920 | 612226e2 | 2026-04-26 16:18:24 +0000 |
| 002 | 002_project_coordinates.sql | 14e6ec0c48ca3420e0c2524ce758794f5db13efdc6f4c0b627ad160e0190b70d | 612226e2 | 2026-04-26 16:18:24 +0000 |
| 003 | 003_productions_enhancements.sql | 77fd6d32b4005b9393e328c6b23aabe872cf675b4a6e3b270238810a6542bf0d | 612226e2 | 2026-04-26 16:18:24 +0000 |
| 004 | 004_pricing_config.sql | f5d2a7ec9ca922ce8f04c4345bd737139e2daad2274d05b5e2cb513e49ef478f | 612226e2 | 2026-04-26 16:18:24 +0000 |
| 005 | 005_user_equipment_library.sql | 1885bb0277a848c80eda38b4e672c6653c3d99eafa34df00359ee8a0d4a55754 | 612226e2 | 2026-04-26 16:18:24 +0000 |
| 006 | 006_users_subscriptions_whitelabel.sql | 31a3066971f5400a622502ce591d4690e43b3da8d95df10ed11e189eaa9164de | 612226e2 | 2026-04-26 16:18:24 +0000 |
| 007 | 007_bill_data.sql | 423b700beb3f028b607ada0be5d51222a9584cc2dd9af7b4581b16042e642e7b | 612226e2 | 2026-04-26 16:18:24 +0000 |
| 008 | 008_admin_activity_log.sql | bd6cefeed615b1726a537c14041be658e4436c986cb985f1810c6c486b24fb7b | 612226e2 | 2026-04-26 16:18:24 +0000 |
| 010 | 010_tos_acceptance.sql | 12610e236503bbdf90dc74460f920223b392cbd32d4568501bf38d0c78c0dc5f | 612226e2 | 2026-04-26 16:18:24 +0000 |
| 011 | 011_password_reset_tokens.sql | 15f04380d155720bfab3de40a559927fd4316e8e1a708b5a9b68e8049fc524a0 | 612226e2 | 2026-04-26 16:18:24 +0000 |
| 015 | 015_distributor_prices.sql | ca6c68994698440635a3afa3e29ef2634797fa2b53bbd57743423f979e939c70 | 612226e2 | 2026-04-26 16:18:24 +0000 |
| 016 | 016_organizations.sql | 08139d1201ce4233a9bb00006c778b31c25a8dda6a5ec11bae7083a1dac8c30e | 33e68d81 | 2026-04-30 20:31:53 +0000 |
| 017 | 017_perf_indexes.sql | fa16d2130680c06a7507b2dacf94b77168109805d31191dd7a8139094c836bb6 | a7df5cec | 2026-05-04 12:50:34 +0000 |
| 018 | 018_site_aliases.sql | 6e8a1a2c298b93312e1be3333f0ce495d74adab6c2a609c9f0f86865c261544d | 94490436 | 2026-05-04 18:29:19 +0000 |
| 019 | 019_query_perf_indexes.sql | c291640fecb3517a921e5ffc5c43ae29dc71cebf191ffa5e1165b5c91909be1d | b8fc2729 | 2026-05-12 22:41:14 +0000 |
| 020 | 020_digital_signatures.sql | 6f3e2a9cc7ea8e6be2d043e20116f1187b93a1581e4fdc9fbc8b982cee79a862 | 4b85daa3 | 2026-05-12 23:15:03 +0000 |
| 021 | 021_portal_otp.sql | dfe6b77f5ee2ee1ef4bc1367a3323ef94febe0e6aa47086ce9835f6f8d8fc7e5 | 6fdaaf41 | 2026-05-16 01:57:06 +0000 |
| 022 | 022_utility_policies_expanded.sql | 08e308bdd024efb3d43812a5df09982b98e03a7711df6341464b8fc65ea25f31 | 1f1a7150 | 2026-05-16 05:34:56 +0000 |
| 023 | 023_solardog_conversations.sql | cf64f3d420e629d5c0351809af4ed960eab566c296ce16f80b442c212a828ea1 | 1f1a7150 | 2026-05-16 05:34:56 +0000 |
| 024 | 024_knowledge_base.sql | 6960eacbf38fe506cf88c225e3c846797e6d09561c880dc979b4821a962ac50d | 1f1a7150 | 2026-05-16 05:34:56 +0000 |
| 025 | 025_knowledge_seed.sql | 961dde3732fbba66d09c4a3a125692c921ff2469df7c71ea8b06163aca0bf94c | 1f1a7150 | 2026-05-16 05:34:56 +0000 |
| 026 | 026_project_control_mode.sql | f8bab3fae141c937ea5bf199a85bba36fc2a9ac4074395ebfd2de28646561ea2 | 1f1a7150 | 2026-05-16 05:34:56 +0000 |
| 027 | 027_project_micro_stages.sql | b27165017f02156ed27c66ee1594c1a188d5fdc751aa7313501d72569d1bb4ee | 1f1a7150 | 2026-05-16 05:34:56 +0000 |
| 028 | 028_tour_tracking.sql | c3a1e810275c65f49468be6cbf1c86ebcc5bf62f91fb99428fb799d09135a142 | 1f1a7150 | 2026-05-16 05:34:56 +0000 |
| 029 | 029_fix_sentinel_hashes.sql | 65a2ca5c8a4d5a0a35c4156a59a8e1b8e7e02068e501f2e540679e9f4c664b7d | 1f1a7150 | 2026-05-16 05:34:56 +0000 |
| 030 | 030_perf_indexes_dashboard.sql | 3818646904eefc05be41180715862ab466202a8584e6f8cb7931d374d37f39d2 | 1f1a7150 | 2026-05-16 05:34:56 +0000 |
| 031 | 031_proposal_esigning.sql | 1df756a96a7809247c49dcb5fb11710447eff1ba38cfd57be122096eed426a54 | 1f1a7150 | 2026-05-16 05:34:56 +0000 |
| 032 | 032_portal_otp_tokens.sql | d5fc441f16f0c58135feb24df6f498ee197e74fbb85f4c13eb6f03be87a5ceac | 1f1a7150 | 2026-05-16 05:34:56 +0000 |
| 033 | 033_proposal_send_to_client.sql | a8a78d9fdcc7e4af16937327cb142cc87b8b0395ef2f789a8d0e800aa3b9fb5f | 1f1a7150 | 2026-05-16 05:34:56 +0000 |
| 034 | 034_client_notes.sql | ad30d414e30a6f45c9a95da37ffaf7b6f702558953526457cb0e09fc7c915b01 | 1f1a7150 | 2026-05-16 05:34:56 +0000 |
| 035 | 035_lead_source.sql | b3fd66d82abd80872ea7367093bd77e009893f6f49b626aeb8fba65b3dfe235c | 1f1a7150 | 2026-05-16 05:34:56 +0000 |
| 036 | 036_notification_prefs.sql | 21ddaf3edefec07ae1adc038bcee60f9d7b79762727eaf61e5a5e98d33663426 | 1f1a7150 | 2026-05-16 05:34:56 +0000 |
| 037 | 037_proposal_share_token.sql | 8421303134b2d4264b7c1b1c4b8f2483f622f29fe4125c0f3032ddb4fd0d3533 | 1f1a7150 | 2026-05-16 05:34:56 +0000 |
| 038 | 038_email_verification.sql | 97e8dfcdf3ef386461a3f70f60bb401a4144ec8738abcd4f4658d4e05e1869f1 | 1f1a7150 | 2026-05-16 05:34:56 +0000 |
| 039 | 039_fix_admin_password.sql | d9da0db707ad6a6d10fedfee61dc61f6064bbac146063e0284a8a8ca49deb4b5 | 1f1a7150 | 2026-05-16 05:34:56 +0000 |
| 040 | 040_proposal_signatures_table.sql | ef947f18c7dc05bbac7394a50d3e01f5543e370c88ec32a3b4b469c05117d94a | ded0f32f | 2026-05-17 18:25:05 +0000 |
| 041 | 041_crew_members.sql | 6dc8e6f4fef770676e39ecd8e8fe64295e3a298b25b569e4777ed5cd80cbff31 | a46532e7 | 2026-05-17 21:45:52 +0000 |
| 042 | 042_utility_unique_site_aliases.sql | b745cfcc89674ec1b43776c6317a0fa23b82de379dd2e94148a35685afb673eb | a47c1a34 | 2026-05-17 23:00:52 +0000 |
| 043 | 043_project_monitoring_link.sql | 7818bb878a3e68f259470a7e64998a1568e7492a8fa9ac748c44af9d21f45639 | 1be6fafb | 2026-05-17 23:12:39 +0000 |
| 044 | 044_contractor_profiles.sql | 3eacf493745759a625b1c24c6b896cebab3d609f51026351bd42ed6b5d9a3e97 | 4c4f8f53 | 2026-05-18 02:24:10 +0000 |
| 045 | 045_opportunities.sql | 911b751c6fbb1128caa693c0967bbe9520711d91e5d835bdd339e3f278a5ac27 | 4c4f8f53 | 2026-05-18 02:24:10 +0000 |
| 046 | 046_opportunity_claims.sql | 58dafe9ede347e3fc5a1cd5e1923069ea69e14f8d6db2976b23605b86de73949 | 4c4f8f53 | 2026-05-18 02:24:10 +0000 |
| 047 | 047_network_opportunities.sql | dd014adfd2655b07a83d2835bafd084142c4d9c810818220d06be72d43b64db4 | 3c2b595c | 2026-05-18 03:12:07 +0000 |
| 048 | 048_opportunity_sources.sql | 8447833645658adc61ab1bf256e906f81e2f501b5576d2bdd31f5a587bd53109 | 3c2b595c | 2026-05-18 03:12:07 +0000 |
| 049 | 049_opportunity_screening_queue.sql | ca4c4dc1f3e1b9ec8b3ad9afe52f2b3c06c1fb67de45976e563a54bc02fa87e9 | 3c2b595c | 2026-05-18 03:12:07 +0000 |
| 050 | 050_opportunity_intelligence.sql | 1038ca8ebe1a569729c7bdf37b65f6fa7a1741a3e06fdcbf7a00bb08dfbfbdaa | 3c2b595c | 2026-05-18 03:12:07 +0000 |
| 051 | 051_opportunity_assignments.sql | c42c4cf3e825923c3fdb9766646fd014f790f15df554d63d09759ea19da9b36e | 3c2b595c | 2026-05-18 03:12:07 +0000 |
| 052 | 052_campaign_analytics.sql | 137db99cf2a1c684bbe679310023f3cdce32f5b33fd2e0f6cd826daa4fabb422 | 3c2b595c | 2026-05-18 03:12:07 +0000 |
| 053 | 053_network_events.sql | 8e10255cd6fd5f46ab31a4a4a43bb22b492674833b80d0746590314aa0069af8 | 3c2b595c | 2026-05-18 03:12:07 +0000 |
| 054 | 054_alter_network_opportunities_intake_columns.sql | bf183d69d20e8a46bbe28436d27f160362d39a406658420681a2b28a9f4ed252 | b0a4e85f | 2026-05-18 05:30:12 +0000 |
| 055 | 055_intake_events.sql | 5d7d6cb3397c0fcbe93e151ed46d93d394fb0df52a59d43465aedfef2671e907 | b0a4e85f | 2026-05-18 05:30:12 +0000 |
| 056 | 056_enrichment_queue.sql | ad8ce86306fd409d67f525d44811b21567b4c6169e1b45fc20e78758c39cff95 | b0a4e85f | 2026-05-18 05:30:12 +0000 |
| 057 | 057_webhook_ingestion_log.sql | 33b7916a564b7ca3dd5894f8e2840d88e237ea651a81289b1868526cb1e5798e | b0a4e85f | 2026-05-18 05:30:12 +0000 |
| 058 | 058_intake_funnels.sql | 8a9248dccc93484b80f11f23903132244903ede3cfd5636d0ffef5d9e0f62307 | b0a4e85f | 2026-05-18 05:30:12 +0000 |
| 059 | 059_acquisition_campaigns.sql | 085f16ba36058508761a90a59f80e92af5698db605f5a510c44cbe6aed2904a6 | b0a4e85f | 2026-05-18 05:30:12 +0000 |
| 060 | 060_campaign_seeds.sql | 4086d60abf97b34531980e6c8eefb3231a2ce1c788967d494a7edecb873ea60a | fb3c9964 | 2026-05-18 05:52:07 +0000 |
| 061 | 061_intelligence_observations.sql | db6d8682e3ea39beac4d1b3a1e60e216e956435f43a97519ada742ce26fc7ce2 | db3f290f | 2026-05-18 12:18:30 +0000 |
| 062 | 062_network_opportunities_canonical_column_harmonization.sql | 0511707c139f3a969c722f5befc64c39184be3b1d17c452d292916212c7cd728 | 7dd0c64a | 2026-05-19 03:34:28 +0000 |
| 063 | 063_opportunity_screening_queue_repair.sql | 754bd1ddc9b551b038259dee8c60c34fd5296ed2f040f09b162662ddc9e0f2dc | 3c2b595c | 2026-05-18 03:12:07 +0000 |
| 064 | 064_opportunity_intelligence_repair.sql | 0a7b5f7c7c358cbf2e9aa41a80545fa0f99e7e2ed7436c0e176364a4b31ca2a9 | d68ea419 | 2026-05-19 04:56:55 +0000 |
| 065 | 065_network_events_repair.sql | 3eff01374a204a291bd4d00a3b3499d1f82c943229b59ce4e98056d07462ceab | 3c2b595c | 2026-05-18 03:12:07 +0000 |
| 066 | 066_intake_events_repair.sql | 9aaa8e2e4cf9c186725e084920214a34ce2572d71d82a95a669009f76e2c1ed8 | b0a4e85f | 2026-05-18 05:30:12 +0000 |
| 067 | 067_opportunity_assignments_repair.sql | 0e3343ce9ab446e1bc517c467f831d374d8c36707df0dfb640d155b62d3caace | 3c2b595c | 2026-05-18 03:12:07 +0000 |
| 068 | 068_contractor_profiles_repair.sql | ca9a743982c650cb5d0337f1683f06c0df472a536d52c028d0528748f63de784 | 4c4f8f53 | 2026-05-18 02:24:10 +0000 |
| 069 | 069_opportunity_sources_repair.sql | 8ff8c14e508f381c05107a7fd50f2b904782330d6290585eb4f03dcf9bae2502 | 3c2b595c | 2026-05-18 03:12:07 +0000 |
| 070 | 070_opportunity_intelligence_enrichment.sql | 7967d3240bf77dba4bd753351c0ad374cf38bf75e7d99863c068eb9940b5ce2d | 249dc67f | 2026-05-19 19:09:46 +0000 |
| 071 | 071_canonical_homeowner_intake_funnel.sql | ea5d4547ed2b1603285bd29f2ce93eecf6c97448d7b8c0fdbb85594d9a6c542f | 249dc67f | 2026-05-19 19:09:46 +0000 |
| 072 | 072_marketplace_inventory_claim_v1.sql | 6ca1447a54fc4f3fd2fb2c9c255f87411056b67ce142d8d5537d7aabed7c9cb4 | 4154f825 | 2026-05-20 18:24:31 +0000 |
| 073 | 073_photo_vision_jobs.sql | 84ce303bd0537d2314e2e2208fabab7d5d798c6e3be22fdc169a836791e85b10 | 3442c1dd | 2026-05-25 21:21:11 +0000 |
| 074 | 074_photo_vision_jobs_dedup_index.sql | fe85c6b4b4dbeb09c5559f8e364566bf3dedaab62306a87d8b64bc1158d92492 | 22134a88 | 2026-05-25 23:34:44 +0000 |
| 074 | 074_photo_vision_jobs_render_job_id.sql | 4fb24aa73adb310efd612f7ade99bc647a71adcc64c1c776c470c3500709775c | 6767fd4f | 2026-05-26 01:12:44 +0000 |
| 075 | 075_photo_vision_jobs_finalization.sql | 3e435e1afef907e6dd6fbe2e25a2ce52685381552d6f4af1f2177d2644c47822 | 5c6e3e82 | 2026-05-27 20:44:02 +0000 |
| 076 | 076_photo_vision_jobs_finalization_stage.sql | dff6a0914561722d96e540532362971e60c215e4bcc922c93d0c560e03132871 | 9df2e887 | 2026-05-28 00:05:13 +0000 |
| 077 | 077_geometry_reconstruction_artifacts.sql | 9fe9821a255324345a03da7304957a40669f05c2dcda908cd918491f4e56dd4a | 1c940ba7 | 2026-05-28 05:22:35 +0000 |
| 078 | 078_geometry_reconstruction_heartbeat.sql | 8e965740f9e276fd8d37b483f83321e6db476a92afa704224dd7bab53249215c | 5e1939e2 | 2026-05-28 07:48:33 +0000 |
| 079 | 079_unified_geometry_foundation.sql | c453ffd9022160edd5f59944dd86be71126f115139eddcce1c1cee3ab25b820d | b4977a9f | 2026-05-28 23:53:17 +0000 |
| 080 | 080_backfill_unified_geometry_artifacts.sql | d021f5bd81104bd14667082b7b5fb7a2e3923d8ff3cc0f2e00778066d5028dda | b4977a9f | 2026-05-28 23:53:17 +0000 |
| 081 | 081_obstruction_metadata_column.sql | 5ae02cf9b103e35cdc691694e27e936e7bcde146c085038b675444dca0ad350a | b4977a9f | 2026-05-28 23:53:17 +0000 |
| 082 | 082_obstruction_metadata_backfill.sql | 721f40c045225bb4db133531cc795ae31427637ac87736f8fe7be5dc6fc66647 | b4977a9f | 2026-05-28 23:53:17 +0000 |
| 083 | 083_physical_data_engineering_columns.sql | f4bf0bcf6ec05d5c421eff1d84cfc964e5329c462c28a9474ed735e0486e6a08 | c8c40e5e | 2026-06-02 21:49:48 +0000 |
| 084 | 084_geometry_reconstruction_stage_durations.sql | 3a5c6abbc65d39ddb58e61b4ec2350d218eee709d4836589a5d2cabcae0b767d | 772389a4 | 2026-06-03 02:03:32 +0000 |
| 085 | 085_geometry_reconstruction_worker_ownership.sql | 8bae7c0099cb3569489611be31bf274651e578f152e50931cca310162d68707c | 3882e4c7 | 2026-06-03 03:31:39 +0000 |
| 086 | 086_depth_contradiction_reports.sql | b0953b76af6603e03c965aff34d76c8d924856eab26c8930b2c646eab987319a | b366ea3e | 2026-06-04 21:17:01 +0000 |
| 087 | 087_canonical_building_model.sql | 8aaaad53fca267cb0c86a8f05074b443c0ed9d427c7dd491ccae54b5357383da | 70c7ddaf | 2026-06-06 22:25:05 -0500 |
| 088 | 088_network_opportunities_county_fips.sql | 11c6cbfe94805b1d038b9285e5c72961c63497b43119784dff9ec4625071f373 | 6286b65f | 2026-06-16 01:25:45 -0500 |
| 089 | 089_intake_idempotency_key.sql | 5379485b1e5b8b6a005847fc75eb93ab45bb6dc21ecf2cec40ca01cb5324f7eb | 75a4ee85 | 2026-06-16 16:53:19 -0500 |
| 090 | 090_proposal_reminder_sent_at.sql | b1ad8c51589d1e1bd3b9ef2e9e454333081612089d8a35fe07808a6845f28869 | dfd4ef34 | 2026-06-16 22:28:34 -0500 |
| 091 | 091_subcontractors_and_cert_vault.sql | a5e083c274cafd93c607448aa181f4177f49709d8c5f02e0412d6c3840a33352 | 07622c82 | 2026-06-17 15:22:19 -0500 |
| 092 | 092_installer_prospects.sql | 0a4589f15f57f95b835c4f7f699faf19a56314ec2c3036eb13975ca6bc0ec5b4 | 1ae7d85b | 2026-06-17 15:50:24 -0500 |
| 093 | 093_seed_installer_prospects_batch1.sql | 61df1e3c8a7382f56145a4e546e42b4473d6965d27885dc4c096f61c9f83fb75 | 0fe31583 | 2026-06-17 15:57:41 -0500 |
| 094 | 094_password_changed_at.sql | b6585199c69fa6343e41965903c08996acbc01b2187ac622ae068b50fe02c137 | 6da3a4e1 | 2026-06-17 22:17:55 -0500 |
| 095 | 095_eagleview_orders.sql | 56bdd98831fd4a0d001dddd0edb879f9dca08ab3bf8b6be0f62e56361815b97d | 8d67f758 | 2026-06-19 11:12:17 -0500 |
| 096 | 096_layout_design_electrical.sql | d13a1b292ad4bf16d60bcc385d2031096ff1344bb00845f94e697074fb46f75d | 2176e4d3 | 2026-06-28 02:53:14 -0500 |
| 097 | 097_physical_data_setback_notes.sql | a195004cfdca26d2c3109bb40d0a51fac2e5b83a9ca4a417672c6596dafa10ec | 4a473ba3 | 2026-06-30 02:34:21 +0000 |
| 098 | 098_repair_cross_project_layout_coords.sql | 43a83c42680c6b62703bc833d7e768f85d6bad2021b36eb0762f1ba857f85660 | 03f90bb5 | 2026-06-30 11:51:13 -0500 |
| 099 | 099_site_survey_files_gps.sql | 58b58cab339ff9f03285c283fb33e897e32f00e3dec4911fcc61cf17ea6ce4de | 706368f2 | 2026-07-02 01:37:29 -0500 |
| 100 | 100_compliance_audit_mfa_consent.sql | ebb13c83766d171754a7875651673f2774c29845ce3322b5671650b4fa03dc08 | efafa6b7 | 2026-07-03 15:14:16 +0000 |
| 101 | 101_projects_selected_equipment.sql | 84dae5f8bcf6e5862c408dd7ca49c9a3f58550475fd0cf10555a2d45080e055c | 081e2f90 | 2026-07-07 17:17:29 -0500 |
| 102 | 102_nearmap_ai_cache.sql | 9d5b29f5b9036bdc1a5012c182122fb11d69c03a00b2659c4da6f0fe824a0bd1 | 5aafcebc | 2026-07-08 12:15:35 -0500 |
| 103 | 103_manufacturer_assets.sql | e33e2d16512fb42a49c094ed9e44dad47960a04f9d243cede8c1551c98681974 | f93aa7dd | 2026-07-08 20:25:51 -0500 |
| 104 | 104_seed_manufacturer_assets.sql | 3f9fae160a933ea0991d9fde04632358a6bbfea8384893cdfe058c6bcadd1f53 | f93aa7dd | 2026-07-08 20:25:51 -0500 |

### 2.4 Duplicate Prefix 074 — Explicit Compatibility Treatment

The two files sharing prefix 074 are genuine, independent schema changes
introduced at different times:

| Identifier | Filename | SHA-256 | Git Intro | Intro Date |
|---|---|---|---|---|
| `074a` | `074_photo_vision_jobs_dedup_index.sql` | `fe85c6b4b4dbeb09c5559f8e364566bf3dedaab62306a87d8b64bc1158d92492` | `22134a88` | 2026-05-25 23:34:44 +0000 |
| `074b` | `074_photo_vision_jobs_render_job_id.sql` | `4fb24aa73adb310efd612f7ade99bc647a71adcc64c1c776c470c3500709775c` | `6767fd4f` | 2026-05-26 01:12:44 +0000 |

Treatment:
- Both files remain in `lib/migrations/` unchanged (no renumbering).
- The canonical manifest assigns identifiers `074a` and `074b` (alphabetical
  filename sort → a/b).
- The ledger records each by its unique identifier + full filename, preventing
  collision.
- `validateMigrationManifest()` explicitly detects duplicate numeric prefixes
  and, rather than rejecting, assigns the disambiguated identifiers and emits a
  `manifest.duplicate_prefix` informational event. This makes the historical
  anomaly explicit and visible rather than silently tolerated.

### 2.5 Reserved Gaps

| Prefix | Status |
|---|---|
| 009 | Reserved — no file. Not an error. |
| 012 | Reserved — no file. Not an error. |
| 013 | Reserved — no file. Not an error. |
| 014 | Reserved — no file. Not an error. |

### 2.6 Legacy `migrations/` Directory (Excluded from Canonical Manifest)

The repository-root `migrations/` directory contains 17 SQL files (prefixes
009–023) plus `add_is_global_column.js` and `seed_solardog_knowledge.sql`. It is
a frozen older duplicate of a subset of the primary migrations and is NOT
referenced by either active runner. It is excluded from the canonical manifest.
No files are deleted in Phase 1A. A note in the documentation marks it as a
frozen historical artifact to avoid future confusion.

## 3. Module Architecture (Canonical Runner)

The canonical model is implemented across these modules:

| Module | Responsibility |
|---|---|
| `lib/migrations/types.ts` | All type definitions: `MigrationFile`, `MigrationManifest`, `MigrationLedgerRow`, `MigrationStatus`, `MigrationExecutionResult`, `MigrationAuthorization`, audit event types. |
| `lib/migrations/manifest.ts` | `discoverMigrationFiles()` — scan `lib/migrations/`, parse prefixes, detect duplicates, assign identifiers; `validateMigrationManifest()` — check ordering, reserved gaps, duplicate handling, no path traversal. |
| `lib/migrations/validation.ts` | `calculateMigrationChecksum()` — SHA-256 over exact file bytes; `verifyMigrationChecksum()` — compare computed vs ledger-recorded; checksum conflict detection. |
| `lib/migrations/ledger.ts` | `bootstrapMigrationLedger()` — create `schema_migrations` if absent (fixed bootstrap DDL); `recordMigrationResult()` — insert/update ledger rows; `inspectMigrationState()` — read ledger; advisory lock acquire/release. |
| `lib/migrations/runner.ts` | `acquireMigrationLock()` — PostgreSQL advisory lock; `runPendingMigrations()` — sequential pending → applied; `runSinglePendingMigration()` — single migration with transaction; `inspectMigrationState()` — public inspection; dry-run mode (no mutation). |
| Authorization (in runner/ledger) | `platform.migrations.execute` / `platform.migrations.inspect` permission checks; environment allowlist; production disabled by default; fresh TOTP for human execution. |

### 3.1 `schema_migrations` Ledger Schema

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  id                      SERIAL PRIMARY KEY,
  migration_identifier    TEXT NOT NULL,
  filename                TEXT NOT NULL,
  checksum_sha256         TEXT NOT NULL,
  description             TEXT,
  status                  TEXT NOT NULL DEFAULT 'pending',
  started_at              TIMESTAMPTZ,
  applied_at              TIMESTAMPTZ,
  failed_at               TIMESTAMPTZ,
  execution_duration_ms   INTEGER,
  environment             TEXT,
  applied_by_actor_type   TEXT,
  applied_by_actor_id     TEXT,
  execution_id            TEXT,
  error_code              TEXT,
  error_summary           TEXT,
  rollback_reference      TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS schema_migrations_identifier_env_idx
  ON schema_migrations (migration_identifier, environment);
CREATE INDEX IF NOT EXISTS schema_migrations_status_idx
  ON schema_migrations (status);
```

Statuses: `pending`, `running`, `applied`, `failed`, `superseded`.

### 3.2 Bootstrap Problem Resolution

The ledger does not exist yet. The runner cannot record ordinary migrations
until the ledger exists. Resolution: `bootstrapMigrationLedger()` executes a
small, fixed bootstrap DDL (the `CREATE TABLE IF NOT EXISTS schema_migrations`
above plus its indexes) OUTSIDE the normal migration transaction flow. This
bootstrap is:
- Idempotent (`IF NOT EXISTS`).
- Executed via a dedicated call before any pending-migration logic.
- Recorded as an audit event (`bootstrap.started` / `bootstrap.completed` /
  `bootstrap.failed`) but NOT as a ledger row (the ledger is the thing being
  created).
- Guarded by the advisory lock and by the same authorization as execution.

### 3.3 Advisory Lock Strategy

- Lock key: a fixed 64-bit integer constant (e.g. `0x534f4c504d474452` =
  "SOLPMGDR" in hex) used with `pg_advisory_lock` (session-level, blocking).
- Acquired before bootstrap and before any migration execution. Released in a
  `finally` block.
- Neon serverless consideration: Neon's serverless driver uses short-lived HTTP
  connections. The advisory lock is session-scoped, so it must be acquired and
  released within the same connection/transaction sequence. The runner will use
  `neon(process.env.DATABASE_URL!)` for lock acquisition and hold it across the
  migration transaction within a single logical operation. If the connection
  drops mid-operation, the lock is automatically released (session-scoped), which
  is the safe failure mode (no permanent lock). A re-run will re-acquire.

### 3.4 Transactional Execution (Neon Constraint)

Neon's `sql.transaction(txn => [ ...queries ])` requires a synchronous callback
returning an array of query promises — no `await` inside. The runner therefore:
1. Reads the migration file.
2. Verifies the checksum.
3. Pre-splits the SQL into statements (respecting the fragile split-by-semicolon
   limitation, with awareness of dollar-quoting — Phase 1A will use a defensive
   splitter that handles `$$` blocks).
4. Passes the array of statement promises into `sql.transaction`.
5. On success, records `applied` in the ledger (in the same transaction if
   possible, or immediately after). On failure, the transaction rolls back and
   the ledger records `failed`.

### 3.5 Authorization & MFA

- **Permissions:** `platform.migrations.execute` (run), `platform.migrations.inspect`
  (inspect/dry-run). These are checked alongside the existing `requireAdminApi`
  role model. Only `super_admin` is granted `platform.migrations.execute` by
  default.
- **Environment allowlist:** Execution requires
  `MIGRATION_RUN_ALLOWED_ENVS` (comma-separated) to contain the current
  environment name. If unset, the default allowlist is empty (production never
  included by default). Dry-run/inspect is allowed in all environments.
- **Production disabled by default:** Even with the allowlist, the literal
  environment value `production` is excluded unless
  `MIGRATION_ALLOW_PRODUCTION_EXECUTION=true` is set explicitly. This is a
  two-key requirement (allowlist + explicit production flag).
- **Fresh MFA for human execution:** Human-initiated execution (as opposed to
  an automated/migration-actor execution) requires a fresh TOTP code submitted in
  the request body, verified server-side via `verifyTOTPCode()`. This is the new
  mechanism identified in the audit (no existing "recent MFA" tracking). The code
  is verified against the user's stored TOTP secret. A `migration-actor`
  (automated, identified by a dedicated service token) is exempt from TOTP but
  still subject to the environment allowlist and production flag.
- **No client-supplied SQL:** The API never accepts raw SQL. It accepts only a
  migration identifier or "run all pending". SQL is always read from the
  canonical manifest files.
- **No arbitrary filename input:** Filenames are derived from the manifest, not
  from user input. Path traversal is impossible because the manifest is built
  from a directory scan with `path.basename` containment checks.
- **No execution of modified applied files:** If a file's checksum differs from
  the ledger's recorded checksum for an `applied` migration, execution is refused
  with `conflict.detected` / `checksum_mismatch`.
- **No silent checksum override:** A checksum mismatch never auto-updates the
  ledger. It requires explicit administrative intervention (a future phase;
  Phase 1A only refuses and audits).

## 4. Status of Migration 105 and NEXT_ENTERPRISE_AUTHORITY_MIGRATION

- **Migration 105:** Does NOT exist. It is NOT authorized for creation in
  Phase 1A. The spec explicitly forbids creating 105 merely because it is the
  next sequential candidate. The highest existing prefix remains 104.
- **NEXT_ENTERPRISE_AUTHORITY_MIGRATION:** Remains a placeholder. It cannot be
  assigned a numeric value until the org-authority schema migration work begins
  (outside Phase 1A). Phase 1A establishes the governance foundation that will
  govern that future migration, but does not create it.

## 5. Commit Strategy

Implementation will be committed in small, reviewable boundaries:
1. **Manifest + checksum + validation + types** (`types.ts`, `manifest.ts`, `validation.ts`)
2. **Ledger bootstrap + locking** (`ledger.ts`)
3. **Canonical runner** (`runner.ts`) + legacy restriction/wrapping
4. **Authorization + audit + API route**
5. **Tests + documentation**

All commits land on `dev` directly.
