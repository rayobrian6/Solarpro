-- ============================================================
-- SolarPro Platform — Migration 006
-- Users table, subscription management, free-pass accounts,
-- and white-label branding fields
-- Run against Neon DB
-- ============================================================

-- ============================================================
-- USERS TABLE (core auth table)
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  email               TEXT NOT NULL UNIQUE,
  password_hash       TEXT NOT NULL,
  company             TEXT,
  phone               TEXT,
  role                TEXT NOT NULL DEFAULT 'user',   -- 'user' | 'admin'
  email_verified      BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ============================================================
-- ADD SUBSCRIPTION + TRIAL + FREE-PASS COLUMNS TO USERS
-- (safe to run even if columns already exist)
-- ============================================================

-- Subscription plan: 'starter' | 'professional' | 'contractor' | 'free_pass'
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan              TEXT NOT NULL DEFAULT 'starter';

-- Subscription status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'free_pass'
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'trialing';

-- Trial dates
ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_starts_at   TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_ends_at     TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '3 days');

-- Stripe integration (for future payment processing)
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id    TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;

-- Free pass: bypasses all subscription checks permanently
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_free_pass      BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS free_pass_note    TEXT;   -- reason / who granted it

-- ============================================================
-- WHITE-LABEL / BRANDING COLUMNS
-- ============================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS company_logo_url  TEXT;   -- uploaded logo URL
ALTER TABLE users ADD COLUMN IF NOT EXISTS company_website   TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS company_address   TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS company_phone     TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS brand_primary_color TEXT DEFAULT '#f59e0b';  -- amber
ALTER TABLE users ADD COLUMN IF NOT EXISTS brand_secondary_color TEXT DEFAULT '#0f172a'; -- slate-900
ALTER TABLE users ADD COLUMN IF NOT EXISTS proposal_footer_text TEXT;  -- custom footer on proposals

-- ============================================================
-- GRANT FREE PASS TO SPECIFIED USERS
-- These users get permanent free access to all features.
-- Uses UPSERT so it's safe to run multiple times.
-- ============================================================

-- NOTE: Replace placeholder emails below with actual emails.
-- The ON CONFLICT clause updates existing users; INSERT creates new placeholder rows
-- if the user hasn't registered yet (they'll set their password on first login).

-- 1. raymond.obrian (owner / admin)
INSERT INTO users (id, name, email, password_hash, company, role, plan, subscription_status, is_free_pass, free_pass_note, trial_ends_at)
VALUES (
  gen_random_uuid(),
  'Raymond O''Brian',
  'raymond.obrian@yahoo.com',
  '$2a$12$placeholder_hash_change_on_first_login',
  'SolarPro',
  'admin',
  'contractor',
  'free_pass',
  true,
  'Owner / Founder',
  '2099-12-31 23:59:59+00'
)
ON CONFLICT (email) DO UPDATE SET
  plan = 'contractor',
  subscription_status = 'free_pass',
  is_free_pass = true,
  free_pass_note = 'Owner / Founder',
  trial_ends_at = '2099-12-31 23:59:59+00',
  role = 'admin',
  updated_at = NOW();

-- 2. james
INSERT INTO users (id, name, email, password_hash, company, role, plan, subscription_status, is_free_pass, free_pass_note, trial_ends_at)
VALUES (
  gen_random_uuid(),
  'James',
  'carpenterjames88@gmail.com',
  '$2a$12$placeholder_hash_change_on_first_login',
  'SolarPro',
  'user',
  'contractor',
  'free_pass',
  true,
  'Team member — free pass granted by owner',
  '2099-12-31 23:59:59+00'
)
ON CONFLICT (email) DO UPDATE SET
  plan = 'contractor',
  subscription_status = 'free_pass',
  is_free_pass = true,
  free_pass_note = 'Team member — free pass granted by owner',
  trial_ends_at = '2099-12-31 23:59:59+00',
  updated_at = NOW();

-- 3. cody
INSERT INTO users (id, name, email, password_hash, company, role, plan, subscription_status, is_free_pass, free_pass_note, trial_ends_at)
VALUES (
  gen_random_uuid(),
  'Cody',
  'cody@underthesun.solutions',
  '$2a$12$placeholder_hash_change_on_first_login',
  'SolarPro',
  'user',
  'contractor',
  'free_pass',
  true,
  'Team member — free pass granted by owner',
  '2099-12-31 23:59:59+00'
)
ON CONFLICT (email) DO UPDATE SET
  plan = 'contractor',
  subscription_status = 'free_pass',
  is_free_pass = true,
  free_pass_note = 'Team member — free pass granted by owner',
  trial_ends_at = '2099-12-31 23:59:59+00',
  updated_at = NOW();

-- 4. ang (LMD Solar)
INSERT INTO users (id, name, email, password_hash, company, role, plan, subscription_status, is_free_pass, free_pass_note, trial_ends_at)
VALUES (
  gen_random_uuid(),
  'Ang',
  'angelique@lmdsolarllc.com',
  '$2a$12$placeholder_hash_change_on_first_login',
  'LMD Solar',
  'user',
  'contractor',
  'free_pass',
  true,
  'LMD Solar partner — free pass granted by owner',
  '2099-12-31 23:59:59+00'
)
ON CONFLICT (email) DO UPDATE SET
  plan = 'contractor',
  subscription_status = 'free_pass',
  is_free_pass = true,
  free_pass_note = 'LMD Solar partner — free pass granted by owner',
  trial_ends_at = '2099-12-31 23:59:59+00',
  updated_at = NOW();

-- 5. utsmarketing
INSERT INTO users (id, name, email, password_hash, company, role, plan, subscription_status, is_free_pass, free_pass_note, trial_ends_at)
VALUES (
  gen_random_uuid(),
  'UTS Marketing',
  'utsmarketing25@gmail.com',
  '$2a$12$placeholder_hash_change_on_first_login',
  'UTS Marketing',
  'user',
  'contractor',
  'free_pass',
  true,
  'Marketing partner — free pass granted by owner',
  '2099-12-31 23:59:59+00'
)
ON CONFLICT (email) DO UPDATE SET
  plan = 'contractor',
  subscription_status = 'free_pass',
  is_free_pass = true,
  free_pass_note = 'Marketing partner — free pass granted by owner',
  trial_ends_at = '2099-12-31 23:59:59+00',
  updated_at = NOW();
-- 6. sarah (Solfence Solar partner)
INSERT INTO users (id, name, email, password_hash, company, role, plan, subscription_status, is_free_pass, free_pass_note, trial_ends_at)
VALUES (
  gen_random_uuid(),
  'Sarah',
  'sarah@solfence.solar',
  '$2a$12$placeholder_hash_change_on_first_login',
  'Solfence Solar',
  'user',
  'contractor',
  'free_pass',
  true,
  'Partner — free pass granted by owner',
  '2099-12-31 23:59:59+00'
)
ON CONFLICT (email) DO UPDATE SET
  plan = 'contractor',
  subscription_status = 'free_pass',
  is_free_pass = true,
  free_pass_note = 'Partner — free pass granted by owner',
  trial_ends_at = '2099-12-31 23:59:59+00',
  updated_at = NOW();

-- ============================================================
-- HELPER: Update all existing users to 3-day trial
-- (replaces any old 14-day trial windows)
-- ============================================================
UPDATE users
SET trial_ends_at = created_at + INTERVAL '3 days'
WHERE subscription_status = 'trialing'
  AND is_free_pass = false;

-- ============================================================
-- SUBSCRIPTION CHECK FUNCTION
-- Returns true if user has active access (trial, active, or free_pass)
-- ============================================================
CREATE OR REPLACE FUNCTION user_has_access(p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_user RECORD;
BEGIN
  SELECT plan, subscription_status, trial_ends_at, is_free_pass
  INTO v_user
  FROM users
  WHERE id = p_user_id;

  IF NOT FOUND THEN RETURN FALSE; END IF;

  -- Free pass always has access
  IF v_user.is_free_pass THEN RETURN TRUE; END IF;

  -- Active subscription
  IF v_user.subscription_status = 'active' THEN RETURN TRUE; END IF;

  -- Trial still valid
  IF v_user.subscription_status = 'trialing'
     AND v_user.trial_ends_at > NOW() THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_users_plan ON users(plan);
CREATE INDEX IF NOT EXISTS idx_users_subscription_status ON users(subscription_status);
CREATE INDEX IF NOT EXISTS idx_users_is_free_pass ON users(is_free_pass);