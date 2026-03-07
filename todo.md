# Auth + Free Pass Bug Fixes — v28.3

## Bugs Found
1. **useSubscription hook** — reads `user?.id` but API returns `{ success, data: { id } }` → should be `user?.data?.id`
2. **billing/page.tsx** — reads `data.id`, `data.plan` etc. but API returns `{ success, data: { ... } }` → should unwrap `data.data`
3. **AppShell trial redirect** — fires even for free_pass users because `checkAccess` is called with `user.subscriptionStatus` which may be `'free_pass'` but `isFreePass` flag from AppShell state may not be set correctly
4. **PlanGate** — `can()` function in useSubscription: free_pass users with plan='contractor' and status='free_pass' should bypass ALL feature gates
5. **isExpired edge case** — `trialDaysRemaining === 0` triggers expired even for free_pass users if isFreePass not read correctly
6. **Add free pass admin API** — need `/api/admin/free-pass` route to grant free passes to any email in future

## Tasks
- [x] Fix useSubscription — unwrap data.data from /api/auth/me response
- [ ] Fix billing/page.tsx — unwrap data.data correctly
- [ ] Fix AppShell trial redirect — ensure free_pass users never get redirected
- [ ] Harden checkAccess — free_pass status always returns allowed=true regardless of isFreePass flag
- [ ] Add /api/admin/free-pass route for future free pass grants
- [ ] Update lib/version.ts to v28.3
- [ ] Build + push