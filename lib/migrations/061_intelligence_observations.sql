-- Migration 061: intelligence_observations
--
-- Canonical Intelligence Observations.
--
-- This table stores append-friendly, explainable derived facts attached to
-- existing canonical entities. It is NOT lifecycle authority and does NOT
-- replace network_opportunities, projects, users, contractor_profiles,
-- utility_policies, network_events, intake_events, project_activity, or any
-- other source-of-truth table.
--
-- Every observation must include source, confidence, timestamp, derivation,
-- payload, and schema_version.

CREATE TABLE IF NOT EXISTS intelligence_observations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Canonical entity attachment. entity_id is TEXT to support both UUID-backed
  -- entities and canonical string IDs such as utility or AHJ identifiers.
  entity_type       TEXT NOT NULL CHECK (entity_type IN (
                      'opportunity',
                      'project',
                      'contractor',
                      'client',
                      'utility',
                      'ahj',
                      'campaign',
                      'assignment',
                      'user'
                    )),
  entity_id         TEXT NOT NULL,

  -- Observation classification.
  observation_type  TEXT NOT NULL,
  source_system     TEXT NOT NULL,

  -- Explainability contract.
  confidence        NUMERIC(5,4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  observed_at       TIMESTAMPTZ NOT NULL,
  derivation        JSONB NOT NULL DEFAULT '{}',
  payload           JSONB NOT NULL DEFAULT '{}',
  schema_version    TEXT NOT NULL,

  -- Replay/correlation metadata.
  correlation_id    TEXT,
  causation_id      TEXT,
  idempotency_key   TEXT,

  -- Append-friendly timestamp. No updated_at column by design.
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Optional idempotency for replay/import safety. Multiple NULL values are allowed.
CREATE UNIQUE INDEX IF NOT EXISTS idx_intel_obs_idempotency_key
  ON intelligence_observations(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Required lookup indexes.
CREATE INDEX IF NOT EXISTS idx_intel_obs_entity
  ON intelligence_observations(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_intel_obs_observation_type
  ON intelligence_observations(observation_type);

CREATE INDEX IF NOT EXISTS idx_intel_obs_source_system
  ON intelligence_observations(source_system);

CREATE INDEX IF NOT EXISTS idx_intel_obs_observed_at
  ON intelligence_observations(observed_at DESC);

-- Common composite indexes for replay and explainability queries.
CREATE INDEX IF NOT EXISTS idx_intel_obs_entity_observed_at
  ON intelligence_observations(entity_type, entity_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_intel_obs_entity_type_source
  ON intelligence_observations(entity_type, observation_type, source_system);

CREATE INDEX IF NOT EXISTS idx_intel_obs_correlation
  ON intelligence_observations(correlation_id)
  WHERE correlation_id IS NOT NULL;

COMMENT ON TABLE intelligence_observations IS
  'Append-friendly explainable derived facts attached to canonical SolarPro entities. Not lifecycle authority and not a source-of-truth replacement.';
