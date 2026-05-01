-- ============================================================
-- Migration 010: User Feedback System
-- Allows users to submit bugs and suggestions with screenshots.
-- ============================================================

CREATE TABLE IF NOT EXISTS feedback (
  id              VARCHAR(36)   PRIMARY KEY DEFAULT gen_random_uuid()::text,
  type            VARCHAR(20)   NOT NULL CHECK (type IN ('bug', 'suggestion')),
  message         TEXT          NOT NULL,
  page_url        TEXT,
  user_id         VARCHAR(36)   NOT NULL,
  user_email      VARCHAR(255),
  screenshot_data BYTEA,
  screenshot_name VARCHAR(255),
  screenshot_mime VARCHAR(100),
  browser_info    TEXT,
  screen_size     VARCHAR(50),
  app_version     VARCHAR(50),
  status          VARCHAR(20)   NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewed', 'resolved')),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Index for admin queries
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback(user_id);