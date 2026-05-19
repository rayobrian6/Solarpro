-- Migration 065: repair missing canonical network_events table
-- Idempotent copy of migration 053 for shared DBs that missed the original event-log migration.

-- ============================================================
-- Migration 053: network_events
--
-- Immutable event log for everything that happens in the
-- Network Intelligence OS.
--
-- This is the system of record. Every state change, admin action,
-- contractor interaction, pipeline step, and scoring event
-- is written here as an append-only event.
--
-- NEVER update or delete rows in this table.
-- Use this for auditing, debugging, and analytics.
-- ============================================================

CREATE TABLE IF NOT EXISTS network_events (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id              TEXT UNIQUE,   -- human-readable: NET-{YYYYMMDD}-{seq}

  -- ── Event Classification ────────────────────────────────────
  event_type            TEXT NOT NULL,
  -- OPPORTUNITY events:
  --   opportunity.created           — new opportunity ingested
  --   opportunity.screening_started — entered screening pipeline
  --   opportunity.screening_step    — individual step completed
  --   opportunity.screening_passed  — all steps passed
  --   opportunity.screening_failed  — failed one or more steps
  --   opportunity.scored            — scoring engine ran
  --   opportunity.published         — made live in marketplace
  --   opportunity.unpublished       — removed from marketplace
  --   opportunity.expired           — TTL expired, no claims
  --   opportunity.status_changed    — generic status change
  --
  -- ASSIGNMENT events:
  --   assignment.offered            — shown to contractor
  --   assignment.viewed             — contractor viewed detail
  --   assignment.claimed            — contractor claimed/paid
  --   assignment.contacted          — contractor contacted homeowner
  --   assignment.appointment        — appointment scheduled
  --   assignment.proposal           — proposal delivered
  --   assignment.won                — deal closed won
  --   assignment.lost               — deal closed lost
  --   assignment.expired            — offer expired unclaimed
  --   assignment.released           — admin released back to pool
  --   assignment.disputed           — dispute filed
  --   assignment.refunded           — refund issued
  --
  -- SCREENING events:
  --   screening.step_passed         — individual step passed
  --   screening.step_failed         — individual step failed
  --   screening.override            — admin override decision
  --
  -- ADMIN events:
  --   admin.opportunity_edited      — admin edited opportunity data
  --   admin.score_override          — admin overrode score/grade
  --   admin.contractor_blacklisted  — contractor removed from matching
  --   admin.campaign_paused         — campaign paused
  --   admin.market_closed           — market closed to new leads
  --   admin.bulk_action             — bulk admin operation
  --
  -- SYSTEM events:
  --   system.scorer_ran             — scoring engine batch run
  --   system.matcher_ran            — matching engine batch run
  --   system.analytics_computed     — analytics job completed
  --   system.migration_ran          — database migration applied
  --   system.health_check           — health check result

  event_category        TEXT NOT NULL,
  -- opportunity | assignment | screening | admin | system | payment

  -- ── Entity References ───────────────────────────────────────
  opportunity_id        UUID REFERENCES network_opportunities(id) ON DELETE SET NULL,
  assignment_id         UUID REFERENCES opportunity_assignments(id) ON DELETE SET NULL,
  contractor_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  admin_user_id         UUID REFERENCES users(id) ON DELETE SET NULL,

  -- ── Event Data ──────────────────────────────────────────────
  data                  JSONB NOT NULL DEFAULT '{}',
  -- Flexible payload. Examples:
  -- opportunity.created:  {source_type, address, homeowner_name, score}
  -- screening.step_passed: {step_number, step_name, result, duration_ms}
  -- assignment.claimed:   {contractor_id, amount_paid, payment_intent}
  -- admin.score_override: {old_score, new_score, old_grade, new_grade, reason}

  -- ── State Transitions ───────────────────────────────────────
  from_status           TEXT,         -- status before event
  to_status             TEXT,         -- status after event

  -- ── Scores Snapshot ─────────────────────────────────────────
  score_at_event        NUMERIC(5,2), -- overall score at time of event
  grade_at_event        TEXT,         -- grade at time of event

  -- ── Source ──────────────────────────────────────────────────
  triggered_by          TEXT NOT NULL DEFAULT 'system',
  -- system | admin | contractor | homeowner | webhook | cron

  ip_address            INET,
  user_agent            TEXT,
  session_id            TEXT,

  -- ── Error Tracking ──────────────────────────────────────────
  is_error              BOOLEAN DEFAULT false,
  error_code            TEXT,
  error_message         TEXT,
  error_details         JSONB DEFAULT '{}',

  -- ── Timestamps ──────────────────────────────────────────────
  occurred_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ DEFAULT NOW()
  -- NOTE: NO updated_at — this table is append-only
);

-- Indexes (optimized for common admin queries)
CREATE INDEX IF NOT EXISTS idx_network_events_opportunity_id  ON network_events(opportunity_id) WHERE opportunity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_network_events_assignment_id   ON network_events(assignment_id) WHERE assignment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_network_events_contractor_id   ON network_events(contractor_id) WHERE contractor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_network_events_event_type      ON network_events(event_type);
CREATE INDEX IF NOT EXISTS idx_network_events_category        ON network_events(event_category);
CREATE INDEX IF NOT EXISTS idx_network_events_occurred_at     ON network_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_network_events_triggered_by    ON network_events(triggered_by);
CREATE INDEX IF NOT EXISTS idx_network_events_errors          ON network_events(occurred_at DESC) WHERE is_error = true;
