# SolarPro Full Subscription System

## Phase 1: Foundation
- [ ] Add Enterprise tier to Stripe lib + plan config
- [ ] Update database migration with new statuses
- [ ] Update /api/auth/me to return full subscription state

## Phase 2: Subscribe Page (/subscribe)
- [ ] Build new /subscribe page with 4 tiers
- [ ] Wire Starter → free trial flow
- [ ] Wire Pro/Contractor → Stripe checkout
- [ ] Wire Enterprise → /enterprise contact form

## Phase 3: Enterprise Contact Page (/enterprise)
- [ ] Build /enterprise form page
- [ ] Create API route to send email to sales@underthesun.solutions

## Phase 4: Billing Page (/account/billing)
- [ ] Build /account/billing page
- [ ] Stripe customer portal integration
- [ ] Plan comparison + upgrade/downgrade

## Phase 5: Permission System
- [ ] Create lib/permissions.ts with plan-based feature gates
- [ ] Add subscription check middleware/hook
- [ ] Lock /engineering, /permit-package, /bom, /structural pages
- [ ] Build upgrade modal component

## Phase 6: Dashboard Subscription Banner
- [ ] Add trial/status banner to AppShell header
- [ ] Show days remaining for trial users
- [ ] Show expired/past_due warning

## Phase 7: Navigation Updates
- [ ] Add Billing + Upgrade Plan to user dropdown in AppShell
- [ ] Redirect expired trial users to /subscribe

## Phase 8: Build + Push
- [ ] Run build, fix errors
- [ ] Push to mainnet
