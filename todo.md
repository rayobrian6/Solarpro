# SolarPro Full Subscription System — v27.6

## Phase 1: Foundation ✅
- [x] Add Enterprise tier to Stripe lib + plan config
- [x] Update database migration with new statuses
- [x] Update /api/auth/me to return full subscription state

## Phase 2: Subscribe Page (/subscribe) ✅
- [x] Build new /subscribe page with 4 tiers
- [x] Wire Starter → free trial flow
- [x] Wire Pro/Contractor → Stripe checkout
- [x] Wire Enterprise → /enterprise contact form

## Phase 3: Enterprise Contact Page (/enterprise) ✅
- [x] Build /enterprise form page
- [x] Create API route to send email to sales@underthesun.solutions

## Phase 4: Billing Page (/account/billing) ✅
- [x] Build /account/billing page
- [x] Stripe customer portal integration
- [x] Plan comparison + upgrade/downgrade

## Phase 5: Permission System ✅
- [x] Create lib/permissions.ts with plan-based feature gates
- [x] Add subscription check middleware/hook
- [x] Build upgrade modal component
- [ ] Lock /engineering, /permit-package, /bom, /structural pages (optional next step)

## Phase 6: Dashboard Subscription Banner ✅
- [x] Add trial/status banner to AppShell header
- [x] Show days remaining for trial users
- [x] Show expired/past_due warning

## Phase 7: Navigation Updates ✅
- [x] Add Billing + Upgrade Plan to user dropdown in AppShell
- [x] Redirect expired trial users to /subscribe

## Phase 8: Build + Push ✅
- [x] Run build, fix errors (0 errors)
- [x] Push to mainnet (v27.6)

## Post-Deployment Tasks (Manual)
- [ ] Run /api/migrate on live DB to create enterprise_leads table
- [ ] Add Stripe env vars to production: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
- [ ] Add Stripe Price IDs: STRIPE_STARTER_PRICE_ID, STRIPE_PRO_PRICE_ID, STRIPE_CONTRACTOR_PRICE_ID
- [ ] Set NEXT_PUBLIC_APP_URL in production env
- [ ] Add email provider to /api/enterprise/contact (currently logs to console)