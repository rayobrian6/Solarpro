/**
 * lib/db-neon.ts
 * Persistent database layer using Neon PostgreSQL.
 *
 * This file is the PUBLIC API for all database operations.
 * It re-exports everything from the domain modules in lib/db/*.
 * All 189 existing importers can continue to use '@/lib/db-neon' unchanged.
 *
 * CRITICAL NOTE ON NEON TAGGED TEMPLATE SQL:
 * Neon's sql`` tagged template automatically parameterizes all ${value} interpolations.
 * They become $1, $2, ... placeholders in the final query.
 * DO NOT append ::uuid after interpolated values — e.g. ${userId}::uuid is WRONG.
 * The ::uuid cast must only appear in static SQL parts, not after parameters.
 * Postgres infers UUID type from the column definition automatically.
 *
 * CORRECT:   WHERE user_id = ${userId}
 * INCORRECT: WHERE user_id = ${userId}::uuid  ← causes "invalid input syntax for type uuid"
 *
 * Domain modules:
 *   lib/db/core.ts        — DB connection, error handling, UUID validation, row mappers
 *   lib/db/clients.ts     — Client CRUD
 *   lib/db/projects.ts    — Project CRUD + Layout operations
 *   lib/db/versions.ts    — Project versions
 *   lib/db/production.ts  — Production results + getProjectWithDetails
 *   lib/db/bills.ts       — Bill storage
 *   lib/db/pricing.ts     — Pricing config
 *   lib/db/solardog.ts    — SolarDog AI (messages, aliases, knowledge, physical data)
 *   lib/db/surveys.ts     — Site surveys
 */

// ── Core (connection, error handling, UUID, type helpers, row mappers) ──────
export {
  getDb,
  getDbReady,
  DbConfigError,
  handleRouteDbError,
  isValidUUID,
  assertUUID,
  rowToProject,
  rowToLayout,
  rowToClient,
  parseDbFloat,
} from './db/core';

export type { PricingMode, DbPricingConfig } from './db/core';

// ── Clients ──────────────────────────────────────────────────────────────────
export {
  getClientsByUser,
  getClientById,
  createClient,
  updateClient,
  softDeleteClient,
} from './db/clients';

// ── Projects + Layouts ───────────────────────────────────────────────────────
export {
  getProjectsByUser,
  getProjectsByClient,
  getProjectById,
  createProject,
  updateProject,
  softDeleteProject,
  bulkSoftDeleteProjects,
  getLayoutByProject,
  upsertLayout,
} from './db/projects';

export type { UpsertLayoutData } from './db/projects';

// ── Project Versions ─────────────────────────────────────────────────────────
export {
  saveProjectVersion,
  getProjectVersions,
  getProjectVersion,
} from './db/versions';

export type { ProjectVersion } from './db/versions';

// ── Production + Project With Details ────────────────────────────────────────
export {
  upsertProduction,
  getProjectWithDetails,
} from './db/production';

// ── Bills ─────────────────────────────────────────────────────────────────────
export {
  saveBill,
  getBillsByProject,
} from './db/bills';

export type { DbBill } from './db/bills';

// ── Pricing Config ────────────────────────────────────────────────────────────
export {
  getPricingConfig,
  upsertPricingConfig,
} from './db/pricing';

// ── SolarDog (messages, aliases, knowledge, physical data) ───────────────────
export {
  getProjectPhysicalData,
  solardogSaveMessage,
  solardogGetHistory,
  solardogSaveAlias,
  solardogGetAliases,
  solardogDeleteAlias,
  solardogKnowledgeUpsert,
  solardogKnowledgeGet,
  solardogKnowledgeSearch,
  solardogKnowledgeDelete,
  solardogKnowledgeSeeded,
  solardogSeedKnowledge,
  SOLARPRO_KNOWLEDGE_SEED,
} from './db/solardog';

export type {
  SolardogMessage,
  SiteAlias,
  KnowledgeItem,
  SeedKnowledgeItem,
} from './db/solardog';

// ── Site Surveys ──────────────────────────────────────────────────────────────
export {
  getSiteSurveysByProject,
  getSiteSurveysByClient,
  getSiteSurveyById,
  createSiteSurvey,
  updateSiteSurvey,
  getSiteSurveyFiles,
  addSiteSurveyFile,
  bulkAddSiteSurveyFiles,
} from './db/surveys';

export type { SiteSurvey, SiteSurveyFile } from './db/surveys';
