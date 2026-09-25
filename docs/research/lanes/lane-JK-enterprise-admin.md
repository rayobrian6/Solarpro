# Lane J + K — Enterprise / Multi-Tenant and Admin Center

Research worker output. UX mining, not a market report.
Date of research: 2026-09-25. Repo audited at `C:\Users\Ray\Solarpro Claude\repo`.

**Evidence rules honoured in this document.** Every row marked "watched" was downloaded with
`tools/watch.py`, frames read as images, captions read as text, and merged into a timeline before
concluding. Rows where only documentation was available say so. Two download failures are recorded
as ledger rows rather than dropped. Marketing pages are never cited as evidence on their own.

Raw capture directories (frames + transcripts) for anything claimed as watched:

| video id | local capture |
|---|---|
| `6LBnZaDirCg` | `C:\Users\Ray\Solarpro Claude\tools\watch\6LBnZaDirCg\` (36 frames, full captions) |
| `kOOS3vmYJFc` | `C:\Users\Ray\Solarpro Claude\tools\watch\kOOS3vmYJFc\` (36 frames, full captions) |
| `HAaDk49oTcY` | `C:\Users\Ray\Solarpro Claude\tools\watch\HAaDk49oTcY\` (30 frames, full captions) |
| `TeYJ0JHVZKE` | `C:\Users\Ray\Solarpro Claude\tools\watch\TeYJ0JHVZKE\` (30 frames, full captions) |
| `ZEIEmdNOy1Y` | `C:\Users\Ray\Solarpro Claude\tools\watch\ZEIEmdNOy1Y\` (captions only — video download failed) |

---
---

# HALF J — ENTERPRISE / MULTI-TENANT

## SUMMARY — transferable interaction principles

1. **Inheritance state is a column, not a tooltip.** Google Admin's service list has a literal column
   header `On/Off Inherit Status` whose every row reads `Inherited` or `Overridden`, sitting beside the
   value column. You can scan a whole scope and see what has drifted, without opening anything.
2. **The inverse list is the trap.** A screen that lists only what has been overridden hides the
   inheritable surface. You cannot override what you cannot see, and you cannot audit drift.
3. **Reverting must be a named, first-class action.** Google ships three buttons — `Override`, `Save`,
   `Inherit`. `Inherit` restores the parent value. Without it, the first local edit is permanent.
4. **Scope must be restated inside the content, not only in the nav.** Google prints
   "Showing status for apps in **Contractors**" above the table, and every setting sentence names the
   scope inline ("Files owned by users **in Contractors** cannot be shared…").
5. **Copy-down is not inheritance.** Solargraf's "Copy settings to dealers" snapshots parent values into
   children. After the copy the link is gone; a later parent change silently does not propagate.
6. **Rule-priority is a third model, and it fits regional variance better than a tree.** OpenSolar
   scopes pricing by state/zip with an explicit integer `Priority` and blank-means-everywhere.
7. **Any priority model owes the user a resolution explainer.** OpenSolar never shows which scheme
   actually won on a given project, or why. That is the missing half of the pattern.
8. **Immutable defaults + named clones beat in-place editing.** Salesforce forbids editing standard
   profiles; you clone and name. The override is always attributable.
9. **Deny-by-default floor plus additive, task-named grants.** "Minimum Access" + permission sets built
   "to correspond to a function or task" — not to an object.
10. **Enabling tenancy is usually a one-way door.** Solargraf states activating dealer configuration is
    irreversible. Design the switch before you flip it.
11. **Impersonation is the wrong-tenant catastrophe's favourite vector.** Solargraf documents full
    impersonation with no documented always-on indicator.
12. **Audit rows should record the authority path, not just the actor.** Stripe stamps
    `details.user_roles.source` = Dashboard / SCIM / SSO on every role change.

## LEDGER — Lane J

| category | product | title | URL/id | pub date | official-or-operator | duration watched | key timestamps | workflow | good behavior | bad behavior | user workaround | SolarPro current behavior | verdict | RE+ impact | user value | implementation risk | status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| enterprise SaaS | Google Workspace Admin | Organisational Unit Management on Google Admin Console: Full Guide | `6LBnZaDirCg` (youtube.com/watch?v=6LBnZaDirCg) | 2022-09-29 | operator (Damson Cloud — Google partner/reseller, not Google) | 10:36 of 10:36, 36 frames read | 00:47 default OU; 04:57 "it says inherited here"; 05:15 `Turn OFF Calendar` confirm dialog; 05:42 `On/Off Inherit Status` column showing Inherited/Overridden rows; 06:07 per-OU effect; 07:04 Drive sharing per OU; 07:31 "Sharing options / Overridden"; 08:01 access groups as an exception mechanism | Create sub-OU → move users → toggle services per OU → open a service's settings for that OU → override a specific setting → (groups for exceptions that cut across the tree) | Inherit state is a dedicated table column, scannable. OU tree is pinned on the left of every settings page, so scope is always visible. Content header restates scope: "Showing status for apps in Contractors". Setting copy names the scope inline. Confirm dialog states blast radius: "Calendar will be turned OFF for all users in Contractors" + propagation delay. `Inherit` button restores the parent value. Groups provide cross-cutting exceptions so the tree does not have to model every case. | Propagation is eventual ("up to 24 hours"), and nothing in the UI shows pending vs applied. Group settings silently beat OU settings — precedence is documented, not visualised. | Admins keep an out-of-band spreadsheet of which OUs were overridden; the video itself resorts to CSV export/re-upload to move users in bulk. | No org tree. No inheritance anywhere. `app/admin/AdminShell.tsx` has no scope indicator of any kind; the breadcrumb is always `Admin Portal / <PageLabel>`. | **STEAL** — the Inherited/Overridden column, the pinned scope tree, the scope-named confirm dialog | HIGH | HIGH | MED | Ready to spec |
| enterprise SaaS | Salesforce | Control Object Access with Profiles and Permission Sets — Who Sees What Ch. 3 | `kOOS3vmYJFc` | 2023-04-26 | official (Salesforce Support) | 6:57 of 6:57, 36 frames read | 01:11 standard profiles cannot be edited, clone them; 01:17 Minimum Access – Salesforce; 02:25 View All Data / Modify All Data "override all sharing rules"; 03:26 "build permission sets to correspond to a function or task"; 04:26 description field as the human summary; 05:13 Object Settings; 05:25–05:57 per-object C/R/E/D | Assign a minimum-access profile → create permission sets per job function → grant object CRUD → assign to the people who need it | Immutable system defaults; every override is a named clone with an owner. Deny-by-default floor. Explicit callout of the two permissions that bypass all other rules. Official guidance is that grants should be named after tasks. | The permission-set editor IA is the platform's own metadata model: a dropdown of ~18 internal categories (Apex Class Access, Visualforce Page Access, Custom Metadata Types, Named Credential Access, Service Presence Statuses Access). The training video tells you to hand-write a prose description of what the permission set does — i.e. the UI cannot summarise its own grant. | Admins maintain naming conventions and external permission matrices; whole consulting practices exist to answer "why can this user see this record". | `lib/organizations/permissions.ts` has 18 `OrgAction`s and a `PERMISSION_MATRIX` mapping each to a minimum role — but the entire resource half is four anonymous actions: `resource:create/read/update/delete` plus `resource:share`. Nothing distinguishes a design from a planset from a price book. | **ADAPT** — take the deny-by-default floor + task-named additive grants; **REJECT** the metadata-category IA | MED | MED | MED | Ready to spec |
| solar | Solargraf (Enphase) | Dealer configurations in Solargraf | https://www.solargraf.com/blog/dealer-configurations-in-solargraf/ | undated page, feature notes reference Sept 2024 billing change | official product documentation (no walkthrough video found — searched YouTube via 3 query sets) | n/a — documentation read in full | n/a | Account manager enables dealer config → nominate a "parent admin" → parent sees a new `Your dealers` nav section → `Settings` → `Copy settings to dealers` → two-column dialog (which settings × which dealers) → optionally impersonate a dealer user | Two-column copy dialog makes both axes explicit. The copyable list is domain-shaped, not schema-shaped: Materials, Pricing, Default design settings, Document templates, Loss templates, Proposal templates, Financing options, Proposal settings, **Custom AHJs (setbacks)**, Custom lead statuses, Utility settings. Parent can pause a dealer's subscription. `Your dealers` is a real nav destination. | **Copy is a snapshot, not a link** — documentation describes no resync, no drift view, no "this dealer differs from parent" indicator. **Enabling dealer configuration "is irreversible."** Impersonation grants the dealer user's full access including settings and user management, and the docs describe **no visual indicator** that you are impersonating. Copy takes minutes and is advised for "quieter work hours" — a background mutation with no progress surface. Deleting a dealer cannot transfer its data. | Copy during off-hours; re-copy manually after every parent change; keep a list of which dealers got which copy. | No parent/child concept at all. `app/admin/companies` is a `GROUP BY users.company` over a free-text column (`app/api/admin/companies/route.ts:54`) — two spellings of "Acme Solar" are two companies. | **ADAPT the copy dialog, REJECT the copy semantics.** Build live inheritance with an explicit "detach" rather than a one-shot copy. | HIGH | HIGH | MED | Ready to spec |
| solar | OpenSolar | Setting up Pricing & Payment Options in OpenSolar | `TeYJ0JHVZKE` | 2020-03-12 | official (OpenSolar channel) | 3:27 of 3:27, 30 frames read | 00:06 Control zone → Pricing Schemes; 00:25 four formulas; 00:58 `Auto-apply Enabled` toggle; 01:02 `Auto-apply Only to Specified States` = NSW; 01:13 `Priority`; 01:55 "if we leave these fields blank, it will apply to all states and zip codes"; 02:13 duplicate | List of named pricing schemes → create → pick formula → enter variables → auto-apply scoped by state and/or zip → set integer priority → save; duplicate to derive a variant | **A genuinely different and very transferable model for regional variance.** No tree, no tenant hierarchy: a flat list of *named rules*, each geographically scoped, with blank = applies everywhere (the corporate default) and a higher integer priority winning. `Duplicate` is the sanctioned way to derive a regional variant from a national one. Fits SolarPro's real variance driver (AHJ and pricing are regional, not org-chart-shaped). | **No resolution explainer.** Nothing anywhere shows which scheme won for a given project or why. Priority is a raw integer the user invents; there is no conflict detection between two schemes that both match. No preview of "for address X, this scheme applies". | Reps name schemes defensively ("NSW Price Per Watt") and hand-check proposals; priority numbers become tribal knowledge. | `app/admin/distributor-prices/page.tsx` already carries `scope?: 'global' \| 'company'` and a precedence note ("DB Overrides (highest priority — per-company or global)") — the only scoping primitive in the whole Admin Center, used in exactly one page. | **STEAL** the named-scoped-rule + blank-means-everywhere model; **add** the resolution explainer OpenSolar lacks | HIGH | HIGH | MED | Ready to spec |
| solar | Aurora Solar | Teams; Partners; Pricing Defaults; Advanced Roles (help centre) | help.aurorasolar.com articles 10010482960915, 18859540886675, 6828599323155, 11459813328787 | undated | official product documentation — **direct fetch returned HTTP 403 on every article; content here is from search-index excerpts only and is labelled as second-hand** | n/a — no video found, no direct page read | n/a | Settings → Teams (users only see projects assigned to their team) · Settings → Pricing defaults → Edit (account-wide baselines for price/W, starting price) · Partner Management for external sales orgs with per-partner logos and pricing | Three distinct concepts kept separate: Teams (visibility partition), Pricing defaults (account-wide baseline), Partners (external org with its own branding and pricing). Teams example in the docs is explicitly regional (Long Island / Westchester / Brooklyn). | Cannot be assessed first-hand — no walkthrough video located and the help centre blocks automated fetch. Do not treat this row as verified UX. | unknown | `pricing_config` is a **single global row** (`lib/migrations/004_pricing_config.sql`, seeded `WHERE NOT EXISTS`). There is no account-vs-project baseline concept. | **BACKLOG** — re-run with a real Aurora walkthrough before acting | MED | MED | — | Evidence incomplete |
| enterprise SaaS | Slack Enterprise Grid | Guide to the Enterprise Grid admin dashboard; org vs workspace settings | https://slack.com/help/articles/115005594006 ; https://trailhead.salesforce.com/content/learn/modules/org-and-workspace-settings-in-slack-quick-look/learn-about-policies-and-settings-in-slack | undated | official product documentation (no walkthrough video found) | n/a — documentation read | n/a | Org owner sets org-level policy → workspace admins may add to or override within it → migration of an existing workspace forces an explicit keep-or-override decision | Two named levels with an explicit relationship ("workspace policies and settings can add to or override org-level settings"). **Migration forces the decision**: by default org settings override pre-existing workspace settings, and keeping them is an opt-in choice made once, visibly. | Documentation only; the drift view (which workspaces deviate from org policy) is not described. | — | No equivalent. SolarPro has no second level to override from. | **STEAL** the migration-time keep-or-override prompt — SolarPro will face exactly this when existing user-owned data is adopted into an org | HIGH | MED | MED | Ready to spec |
| enterprise SaaS | OpenAI | Global Admin Console — override/inheritance semantics | https://help.openai.com/en/articles/12289294-global-admin-console | 2026 | official product documentation | n/a — **direct fetch returned HTTP 403**; only the search-index excerpt was available | n/a | workspace default → group override → user override | The documented semantic is exactly right and worth copying verbatim: *"Removing an override returns the user or group to the next applicable inherited limit."* Removal is a first-class operation with a defined result. | Not assessable — page not readable. | — | SolarPro has no remove-override operation anywhere (see `app/api/admin/feature-flags/route.ts`: GET and PUT only, no DELETE). | **STEAL** the semantic; **BACKLOG** the UI study | MED | MED | LOW | Evidence incomplete |
| commentary | — | Multi-tenant switcher failure modes (secondary sources, clearly labelled as commentary, not product walkthroughs) | fusionauth.io/blog/multi-tenant-hijack-2 ; workos.com/blog/developers-guide-saas-multi-tenant-architecture ; orbix.studio/blogs/multi-tenant-dashboard-design | 2025–2026 | third-party commentary — **not evidence of any product's UX** | n/a | n/a | n/a | Useful framing only: a tenant switch must update route state, server session, client cache scope, feature flags, permissions and analytics context together; and the UI should signal scope through branding and sidebar content rather than a text label. | These are blog posts. No product was observed. | — | — | **BACKLOG** as design checklist input, not as a citation | LOW | LOW | LOW | Context only |

## TOP CANDIDATES — Lane J

1. **Inheritance state as a first-class column plus a named `Inherit` action.**
   Source: Google Admin (`6LBnZaDirCg`, 05:42 and 07:31). Every scoped setting list gets a status column
   reading `Inherited` / `Overridden`, and every overridden setting gets a `Revert to inherited` control
   that states the value it will restore. SolarPro's nearest analogue today — the feature-flag panel in
   `app/admin/system-tools/page.tsx` — lists only rows that already have a DB override, and has no
   revert path at all. Fixing that one page is the cheapest possible proof of the pattern.

2. **Named, geographically-scoped rules with explicit priority, plus the resolution explainer OpenSolar
   omits.** Source: OpenSolar (`TeYJ0JHVZKE`, 00:58–01:55). SolarPro's variance is regional — AHJ,
   setbacks, code edition, incentives, pricing. A flat list of named rules ("NSW Price Per Watt";
   "Madison County setbacks") scoped by state/county/zip with blank = everywhere is a better fit than an
   org tree, and it already half-exists in `app/admin/distributor-prices/page.tsx`. Add what OpenSolar
   lacks: on any resolved value, a "why this value" popover naming the winning rule and the rules it beat.

3. **A two-column propagation dialog (which settings × which targets) — but wired to live inheritance,
   not a snapshot copy.** Source: Solargraf dealer configuration. The dialog shape is excellent and its
   setting list is domain-named, including Custom AHJs. The semantics are the trap: copy-once means the
   parent can never fix a mistake across its network. Ship the dialog as "apply to…" over a live link,
   with an explicit per-branch `Detach` that is recorded and visible.

4. **A scope indicator that lives in the content, restated in every destructive confirmation.**
   Source: Google Admin (`6LBnZaDirCg`, 05:15 — "Calendar will be turned OFF for all users in
   Contractors"). SolarPro has no scope surface at all today, and its confirm dialogs in
   `app/admin/system-tools/page.tsx` describe the tool, not the blast radius. This is the single
   cheapest defence against the wrong-tenant catastrophe and should land before any org switcher does.

## EXIT CRITERIA STATUS — Lane J

| # | criterion | status |
|---|---|---|
| 1 | ≥2 materially relevant products | **MET** — Google Admin, Salesforce, Solargraf, OpenSolar, Slack (5) |
| 2 | ≥1 official/training source | **MET** — Salesforce Support (`kOOS3vmYJFc`), OpenSolar (`TeYJ0JHVZKE`), Solargraf and Slack docs |
| 3 | ≥1 real user/operator source | **MET** — Damson Cloud (`6LBnZaDirCg`), a Google partner doing real admin work on a live tenant |
| 4 | core workflow end-to-end | **MET for the override workflow** — Google Admin is covered create-OU → move users → override → observe state. **NOT MET for tenant switching**: no product's switcher was observed in motion. Okta download failed; Slack and Aurora had no watchable walkthrough. |
| 5 | findings repeating | **PARTIALLY MET** — three independent solutions to one problem (tree inheritance, copy-push, priority rules) is divergence, not convergence. The *sub-findings* do repeat: every product that scopes values needs a revert, a scope indicator and a resolution explainer, and the products that skip one of those get bitten in the same way. |
| 6 | opportunities triaged | **MET** — every ledger row carries a verdict, impact, value and risk |
| 7 | SolarPro equivalent audited | **MET** — see "SolarPro today" below; read from code, not assumed |
| 8 | candidates shipped or backlogged | **NOT MET** — nothing shipped; four candidates specified, none implemented. This worker has write access to this file only. |

**Saturation is NOT declared.** Criteria 4 and 8 fail outright and 5 is soft. The specific gap to close
next: watch a real tenant/workspace switcher in motion (Slack Enterprise Grid, Notion, Vercel or Okta)
and a real per-branch drift view.

---
---

# HALF K — ADMIN CENTER

Ray's constraint governs every recommendation here: **do not turn SolarPro Admin into a developer
console.** The organising question for this half is therefore: what specifically makes an admin surface
*task-shaped* rather than *schema-shaped*?

Six mechanisms were observed doing that work:

- **Name the grant after the job, not the table** (Shopify: `Customer support`, `Merchandiser`, `Marketer`).
- **Ship a one-line consequence under every option**, so the operator never has to infer it.
- **Cascade prerequisites automatically** rather than making the operator satisfy the data model.
- **Address people by the identifier they actually have** — an email, not a UUID.
- **State blast radius in the confirmation**, in the scope's own name.
- **Render results as outcomes, not as `JSON.stringify(result, null, 2)`.**

## SUMMARY — transferable interaction principles

1. Roles named after jobs, with a one-line description of the job, are readable by a non-engineer;
   roles named after objects are not. Shopify's six built-ins each carry their own sentence.
2. Permission *categories* should be functional areas (Orders, Inventory, Discounts), never table names.
3. Prerequisite cascading — selecting an inventory permission auto-selects "View products" — moves
   referential integrity out of the operator's head.
4. Invite by email. `Add member by user ID` with placeholder `User ID (UUID)` is a developer console.
5. A raw key rendered as the primary label (`<code>{flag.flagKey}</code>`) is the single clearest tell
   that a page is schema-shaped.
6. The result surface is where task-shaped admin pages relapse: a good form followed by a `<pre>` JSON dump.
7. Separate the admin console from the end-user view, and let the admin see what the user will see.
8. Audit rows should carry the authority path (Dashboard vs SCIM vs SSO), not just the actor.
9. Dangerous operations deserve ceremony proportional to consequence — and exactly one implementation.
10. Empty states should describe the inherited/default behaviour that is currently in force.
11. A page that must expose raw identifiers can still be task-shaped if it demands a written reason.
12. Generic CRUD grids cluster around the highest-consequence data precisely because nobody modelled it.

## LEDGER — Lane K

| category | product | title | URL/id | pub date | official-or-operator | duration watched | key timestamps | workflow | good behavior | bad behavior | user workaround | SolarPro current behavior | verdict | RE+ impact | user value | implementation risk | status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| e-commerce | Shopify | How to Add an Admin User to Your Shopify Store (2026) — Staff Access Setup | `HAaDk49oTcY` | 2025-12-16 | operator (ECOM KNTRL, a third-party store operator) | 2:27 of 2:27, 30 frames read | 00:24 Settings; 00:28 `Users`; 00:44 `Add users`; 00:48 email field; 01:03–01:57 the six roles read aloud with their consequences; 01:59 two-step authentication; 02:09 `Save` sends the invite | Settings → Users → Add users → type email → pick role(s) from a searchable list → optionally require 2FA → Save sends an invitation | **The reference implementation of task-shaped admin.** Roles are job titles with a sentence each, verified in frame `t00098.jpg`: `Administrator — The administrator has full access to all settings and can manage all users and roles.` · `App developer — …full access to tools and development stores for building apps.` · `Online store editor — Can edit and publish themes for online store, including editing theme code.` · `Customer support — Can fulfil orders, edit order line items, process payment and returns.` · `Merchandiser — Can create, edit, and publish products, including editing product price and cost.` · `Marketer — Can create, edit, and launch campaigns.` Roles list is **searchable**. `Create new role` sits at the bottom of the same list, so the escape hatch is in the flow. Identity is an **email**, never an id. Settings nav is a flat list of 20 functional areas (General, Plan, Billing, Users, Payments, Checkout, Locations, Domains, Policies…) with no grouping ceremony. | Role-to-permission mapping is not visible at assignment time — you trust the sentence. Store-level vs organization-level (Plus) access lives in a separate place the video never reaches. | Operators keep a role-matrix doc; large merchants build custom roles and name them by department. | `components/settings/OrganizationAuthorityPanel.tsx:631` — **`Add member by user ID`, placeholder `User ID (UUID)`**. `app/admin/users/page.tsx` edits `u.company` as a plain free-text `<input>`. SolarPro role vocabulary is inconsistent across three places: DB CHECK allows `user/admin/super_admin`, `app/api/admin/users/route.ts:133` also accepts `sales`, `lib/mfa.ts:42` references `staff` that nothing ever sets. | **STEAL** wholesale: job-named roles + one-line consequence + searchable list + invite-by-email | HIGH | HIGH | LOW | Ready to spec |
| e-commerce | Shopify | Store permissions (reference) | https://help.shopify.com/en/manual/your-account/users/roles/permissions/store-permissions | undated | official product documentation | n/a — read in full | n/a | Building a custom role from granular permissions grouped by functional area | 18–19 functional groupings (Home, Orders, Draft orders, Products, Inventory, Catalogs, Gift cards, Customers, Analytics, Marketing, Discounts, Content, Files, Online store, Checkout and customer accounts, Companies, App development, Store settings, Finance). Permissions read as verbs: `Fulfil and ship`, `Manage order information`, `Refund to original payment method`, `Edit code`. **Automatic prerequisite cascading** — selecting inventory permissions auto-enables `View products`. | Org-level structure for Plus merchants is thin in the docs. | — | `lib/organizations/permissions.ts:80-84` — the entire resource vocabulary is `resource:create/read/update/delete/share`. Anonymous. Nothing names a design, a planset, a permit package, a price book or a catalog. | **STEAL** the functional grouping and verb naming; this is the shape SolarPro's `resource:*` actions should be refactored into before any org UI ships | HIGH | HIGH | MED | Ready to spec |
| enterprise SaaS | Salesforce | Permission-set editor IA (same capture as Lane J) | `kOOS3vmYJFc` | 2023-04-26 | official | 6:57 of 6:57 | 04:26 "For the description, it's a good idea to name the permissions and settings that will be enabled"; 05:13 `Object Settings`; frame `t00313.jpg` shows the category dropdown | Create permission set → choose a user license → pick a category from a dropdown → set checkboxes | Two clean top-level buckets (App Settings / System Settings). Per-object C/R/E/D grid is legible. | **The clearest schema-shaped failure captured in this study.** The category dropdown in frame `t00313.jpg` is the platform's own metadata taxonomy: Assigned Apps, Assigned Connected Apps, Object Settings, App Permissions, Apex Class Access, Visualforce Page Access, External Data Source Access, Flow Access, Named Credential Access, Data Category Visibility, Service Presence Statuses Access, Custom Permissions, Custom Metadata Types, Custom Setting Definitions, System Permissions, Service Providers. And the official training's remedy is to **hand-write a prose description**, because the UI cannot summarise what a permission set does. That is the definition of schema-shaped: the operator compensates for the IA in a free-text box. | Naming conventions; external permission matrices; a consulting industry. | SolarPro's nearest equivalent is `app/admin/engineering-intelligence/components.tsx` — 2,095 lines exporting ~40 `*Workspace` components (`CanonicalEvidenceWorkspace`, `SignalProvenanceWorkspace`, `FallbackChainInspectorWorkspace`, `SnapshotDeltaWorkspace`…), 27 of them stacked onto one route. One panel per internal type: the data model *is* the information architecture. | **REJECT** as an IA model. Keep as the cautionary exemplar for Ray's constraint. | MED | — | — | Cited as anti-pattern |
| enterprise SaaS | Google Workspace Admin | Admin console information architecture (same capture as Lane J) | `6LBnZaDirCg` | 2022-09-29 | operator | 10:36 of 10:36 | 05:15 confirm dialog; 05:42 service list; 07:04 settings page structure | Search bar → nav (Home, Dashboard, Directory, Devices, Apps, Security) → service → setting → scope | Persistent top search across "users, groups or settings" — one box that spans the whole admin surface. Settings pages open as collapsed accordions of named sections (Service status, Sharing settings, Approvals, Labels, Migration Settings, Manage shared drives) so the page is scannable before it is read. Confirm dialogs carry a consequence sentence and a propagation warning. Toast states the outcome ("Service status updated", "Your settings have been saved"). | Deep settings are several accordions down with no deep-link affordance shown. | — | `AdminShell.tsx`: **no search, no command palette, no collapse**, 30 nav items in 5 groups, a two-level synthetic breadcrumb. Two nav entries share one href (lines 44–45, both `/admin/engineering-intelligence`), colliding on `key={href}`. Seven live directories are unreachable from the nav, including a 766-line `pricing` page. | **STEAL** the global admin search and the accordion settings page | MED | HIGH | LOW | Ready to spec |
| fintech | Stripe | Activity logs | https://docs.stripe.com/activity-logs | 2026 (actions dated from 2026-04-01) | official product documentation | n/a — read in full | n/a | Query security history by action group or action type | Named action taxonomy rather than table diffs: `api_key_created`, `api_key_viewed`, `user_invite_created`, `user_invite_accepted`, `user_roles_updated`, `user_roles_deleted`. Every entry carries actor, timestamp, affected resources and contextual metadata. **`details.user_roles.source` records whether a role change came from Dashboard, SCIM or SSO** — the authority path, not just the actor. Retention stated plainly (6 months). Stated use cases are SOC 2 / PCI audit reporting. | API-only — no first-party UI for these logs. Events appear only after ~10 minutes. | Export to a SIEM. | SolarPro has **two disconnected audit tables**. `audit_log` is the good one: hash-chained, per-org chain partitioning designed in migration 107 (`actor_organization_id`, `resource_owner_organization_id`) — **but 107 is unapplied, and nothing reads `audit_log` in the UI.** `app/admin/activity-log` reads the *other* table, `admin_activity_log`, whose org field is a free-text `VARCHAR target_company`. | **STEAL** the named-action taxonomy and the change-source field; **then point the existing UI at the good table** | HIGH | HIGH | LOW | Ready to spec |
| identity | Okta | Okta Tutorial #2 — Dashboard Walkthrough (Users, Groups, Applications) | `ZEIEmdNOy1Y` | 2026-04-25 | operator (MATHS WALLAH SURAJ MAHTO) | **DOWNLOAD FAILED — yt-dlp HTTP 403 on the video stream. Captions were retrieved and read (4:09); no frames exist. Not watched.** | 01:27 Directory → users; 01:52–02:15 "basically we will use group" — assign an app to a group, not to each user; 02:20 Applications; 02:32 Security (policies, rules, identity providers); 03:05 Reports (who changed a password, who logged in); 03:28 the separate end-user dashboard | Directory → Applications → Security → Reports, with a distinct end-user dashboard showing only assigned apps | From captions only: group-based assignment is presented as the default practice rather than an advanced feature, and the admin console is separated from the end-user view so the admin can reason about what the user will actually see. | Cannot assess UI — no frames. Do not cite this row for anything visual. | — | SolarPro has no group concept; grants are per-user role strings. There is an end-user preview in `app/admin/portal-dashboard` (810 lines) — the right instinct, already present. | **BACKLOG** — re-attempt capture | LOW | MED | — | Capture failed |
| framework | Django | The Django admin site | https://docs.djangoproject.com/en/6.1/ref/contrib/admin/ | current docs | official documentation | n/a — read | n/a | `admin.site.register(Model)` → a CRUD grid appears, tuned with `list_display`, `TabularInline`, `StackedInline` | Zero-cost coverage of every model; genuinely correct for internal engineering use. | **The canonical schema-shaped admin, and worth naming explicitly in the SolarPro design principles.** The IA is generated from the model definition; `list_display` is a tuple of *field names*; inlines mirror foreign keys. Every screen answers "what rows exist" and none answers "what am I trying to do". Django's own docs position it as *"not intended for building your entire front end"* — the tool does not claim otherwise; products drift into it by default. | Teams bolt on custom admin actions and eventually build a separate ops tool. | SolarPro has independently reinvented this in several places. `app/admin/incentives/page.tsx` is a literal `.map()` over a field-descriptor array emitting one `<input>` per DB column (`program_name`, `country`, `state`, `utility`, `value`), with the grid header `['Program','Type','Value','State','Utility','Active','Actions']`. `app/admin/utilities/page.tsx` is titled "Utility Intelligence **Database**" — 8 `<th>`s, and its only text input in 459 lines is the search box. | **REJECT** — name it in the principles doc as the shape to avoid | MED | — | — | Cited as anti-pattern |
| SolarPro (self) | SolarPro | Migration Operator Console | `app/admin/system-tools/migrations/page.tsx` (626 lines) | in repo | first-party code read | n/a | n/a | Numbered gated wizard: `1 · Bootstrap governance` → `2 · Generate evidence` → `3 · Reviewed baseline batch` → `4 · Verify baseline` → bounded execution window with countdown → `5 · Reviewed single execution` | **This is SolarPro's own proof that Ray's constraint is achievable on the hardest possible surface.** A migration runner that deliberately refuses to be a SQL box: file header states *"this page never bypasses those controls and never sends SQL"*; subtitle states *"No SQL is entered here."* Every mutation demands a TOTP code, a free-text **reason**, and in production the literal typed word `production`. Individual migrations are named buttons carrying rationale prose, e.g. `Run migration 107… (repairs the audit trail — run FIRST)`. Idempotency keys; a `READY TO EXECUTE / NOT READY` pill. | — | — | — | **This is the internal benchmark.** Every other admin page should be measured against it. | HIGH | HIGH | — | Already shipped |
| SolarPro (self) | SolarPro | Database Maintenance | `app/admin/database/page.tsx` (160 lines) | in repo | first-party code read | n/a | n/a | View DB tiles → raw row counts → raw table sizes → run migrations | — | **Directly contradicts the page above, and ships beside it.** `const secret = prompt('Enter MIGRATE_SECRET to run migrations:')` — a native browser `prompt()` collecting an environment secret in plaintext, POSTed to `/api/migrate`. Row Counts is `Object.entries(rc).map(([table, count]) => …)` printing raw table names in `font-mono`. Table Sizes is truncated at 15 with no "show more". Success is routed through `toast.error('✓ Migration successful')`. | — | — | **REJECT / delete.** Two migration authorities with opposite ceremony is worse than either alone. | HIGH | — | LOW | Needs removal decision |

## TOP CANDIDATES — Lane K

1. **Rewrite the role and permission vocabulary before the org UI exists.**
   Source: Shopify (`HAaDk49oTcY` 01:03–01:57, frame `t00098.jpg`; plus the store-permissions
   reference). Replace `resource:create/read/update/delete/share` in
   `lib/organizations/permissions.ts` with SolarPro's own functional areas — Designs, Plansets, Permit
   packages, Equipment catalog, Pricing, AHJ registry, Field measurement — each with verb-named
   permissions and a one-line consequence. Then name the roles after solar jobs (Designer, Permit
   coordinator, Field tech, Sales rep, Branch manager) rather than `member` / `viewer`. This is the
   highest-leverage item in the whole study because the vocabulary is what gets frozen first, and
   `resource:*` is currently anonymous.

2. **Point the Activity Log page at the good audit table, and add the change-source field.**
   Source: Stripe activity logs. SolarPro already has the strongest artefact in this comparison — a
   hash-chained `audit_log` with per-org chain partitioning designed in migration 107. It has no UI, and
   the UI that exists reads a weaker table with a free-text company column. Apply 107, repoint
   `app/admin/activity-log`, and add Stripe's `source` concept so a role change records whether it came
   from the admin console, an invite acceptance, or an automated path.

3. **Make every "override" surface show the inherited value and offer a revert.**
   Source: Google Admin (`6LBnZaDirCg` 05:42). The concrete first target is the feature-flag panel in
   `app/admin/system-tools/page.tsx`, which today lists **only overridden flags** — its own empty state
   reads *"No feature flags have been overridden. Default behavior is in effect (env-var → off)"*, which
   is exactly right and exactly backwards: the inherited set is invisible. List every known flag with an
   `Inherited` / `Overridden` column, show the env default beside the current value, and add the missing
   revert (`lib/db/featureFlags.ts` exports no clear function; the route has GET and PUT only).

4. **Retire the second migration surface and adopt the Migration Operator Console's ceremony as the
   house style for dangerous actions.** Source: SolarPro's own `app/admin/system-tools/migrations`
   versus `app/admin/database`. Delete the `window.prompt('Enter MIGRATE_SECRET…')` path, and lift three
   of the console's devices into a shared component: a required written reason, a typed confirmation
   naming the scope, and a named button carrying rationale prose instead of a generic "Run".

## EXIT CRITERIA STATUS — Lane K

| # | criterion | status |
|---|---|---|
| 1 | ≥2 materially relevant products | **MET** — Shopify, Salesforce, Google Admin, Stripe, Django (5), plus two first-party surfaces |
| 2 | ≥1 official/training source | **MET** — Salesforce Support video, Shopify/Stripe/Django documentation |
| 3 | ≥1 real user/operator source | **MET** — ECOM KNTRL (`HAaDk49oTcY`), a third-party operator on a live store |
| 4 | core workflow end-to-end | **MET for user/role administration** — Shopify covered end-to-end from nav to sent invite. **NOT MET for equipment/catalog admin, pricing admin, integration admin, support tooling, feature flagging or data quality** — no walkthrough of any of those six was located or watched. |
| 5 | findings repeating | **MET** — the task-vs-schema split reproduced independently in Shopify (task), Salesforce (schema), Django (schema) and inside SolarPro itself (both). The same six mechanisms recur. |
| 6 | opportunities triaged | **MET** |
| 7 | SolarPro equivalent audited | **MET** — all 30 admin directories mapped and shape-classified; see below |
| 8 | candidates shipped or backlogged | **NOT MET** — nothing shipped |

**Saturation is NOT declared.** Criteria 4 and 8 fail. Six of the ten benchmark areas named in the brief
were not covered by any watched source: equipment/catalog admin, pricing admin, integration admin,
support tooling, feature flagging, data quality.

---
---

# SOLARPRO TODAY — what the code actually does

Read from source, not assumed. Two independent passes: a map of `app/admin/` and a tenancy audit.

### Is SolarPro single-tenant?

**Yes in practice. Ownership is `user_id`, everywhere.** But it is not greenfield — there are two
generations of org scaffolding on top, and both are inert.

- **Gen 1 (applied, shallow):** migration `016_organizations.sql` — `organizations`, `org_invites`,
  `users.org_id`, `users.org_role`. Touches nothing except billing and membership display.
- **Gen 2 (written, never applied, flag-gated off):** migrations 105 / 106 / 107 plus a 7-file
  `lib/organizations/` module — many-to-many memberships, four org roles, `active_organization_context`,
  per-org audit chains. Production code records the gap directly, at
  `lib/fieldMeasurement/permitAccess.ts:53`:
  `// 'organization_members' (migration 105) is ABSENT on production — 105 was never applied, while migration 118 (this feature's own table) was.`

Supporting facts, each read from code:

- The session carries no tenant. `lib/auth.ts:197` — `SessionUser` is `{id, name, email, company?}`, and
  `company` is a free-text string copied off `users.company`, not a foreign key.
- Of 302 `route.ts` files under `app/api`, 13 mention org at all and 8 of those are the
  `/api/organizations/*` routes themselves. **No domain read route filters by org.**
  `app/api/proposals/route.ts:68` is representative: `SELECT * FROM proposals WHERE user_id = ${user.id}`.
- Zero row-level-security policies exist in any migration.
- The only genuinely tenant-keyed feature is field route measurement (migration 118), with
  `TenantKey = 'org:<uuid>' | 'user:<uuid>'` and queries carrying `AND tenant_id = ${tenantId}`.
  Nothing else follows it.
- `pricing_config` is a **single global row for the entire platform**, seeded `WHERE NOT EXISTS`.
- Equipment catalogs are `user_equipment_panels` / `_inverters` / `_mounting` / `_batteries`, each keyed
  `user_id`. White-label branding is per-user columns on `users` — two people at the same company keep
  two independent logos.
- The four `ENTERPRISE_*` flags default false and appear in no `.env.example`, no `vercel.json` and no
  CI config — only in three prose documents under `docs/enterprise-multi-tenant/`.
- The one org switcher (`components/settings/OrganizationAuthorityPanel.tsx`, `switchOrg()` at line 201)
  is behind `ENTERPRISE_ORG_AUTHORITY_ENABLED` and would hit a table migration 105 never created.
- `app/admin/companies` is a `GROUP BY users.company` over free text
  (`app/api/admin/companies/route.ts:54`). Its project count is
  `SELECT COUNT(*) FROM projects WHERE company = ${companyName}` wrapped in `.catch(() => [{c:0}])` —
  `projects` has no `company` column, so that query always fails and always reports 0.

### Admin Center shape

30 nav destinations in 5 groups behind **one binary gate** (`app/admin/layout.tsx`: `admin` or
`super_admin`, checked once at the route boundary; `super_admin` only hides buttons in-page). Roughly
60/40 task-shaped to schema-shaped — **and the schema-shaped pages cluster on the highest-consequence
data**: structural adjustment factors, equipment identity reconciliation, incentive amounts, migrations.

Worst offenders, with evidence:

- `app/admin/document-registry/page.tsx` — a structural safety factor entered as hand-typed JSON in a
  single-line text input: `adjustmentFactors: '{"omega":1.5}'`, labelled `Adjustment factors (JSON)`.
  Alongside `SHA-256 (64 hex)` as a field the operator is expected to type.
- `app/admin/finalize-runner/page.tsx` — a debug harness that shipped, with a hardcoded developer
  fixture UUID as the default form value.
- `app/admin/incentives/page.tsx` — one `<input>` per DB column, no validation, no units.
- `app/admin/network/page.tsx` — 8,026 lines, 12 tabs, 71 `<th>`s, raw `JSON.stringify` dumps, and a
  "Webhook Log" tab.

Best instincts already present, worth protecting:

- The Migration Operator Console (reason + TOTP + typed `production` + named buttons with rationale).
- `app/admin/reconciliation/page.tsx` — `<textarea placeholder="reason (REQUIRED)">` with the header
  rule *"the operator selects a winner and MUST give a reason… No silent win."*
- The feature-flag empty state's correct use of the word "overridden".
- `components/ui/ImpersonationBanner.tsx`, mounted in the root layout — better than Solargraf documents.

---

# WHAT WOULD BECOME PERMANENT UX DEBT

Ranked by cost-to-undo. These are the specific single-org assumptions in SolarPro today, each with the
file that encodes it.

**1. Ownership is `user_id`, and it is load-bearing in ~300 API routes.**
`projects`, `clients`, `layouts`, `proposals`, `crews`, all four `user_equipment_*` catalogs and all
white-label branding are keyed to a person. The UX consequence is not "we need a migration" — it is that
**SolarPro has no concept of a company asset**. A branch manager cannot own a price book; a company
cannot own an equipment catalog; a colleague at the same company cannot open a project. When orgs
arrive, every one of those becomes a data-ownership transfer that a human must adjudicate ("whose
projects are these now?"), and users will have already built personal habits around personal ownership.
`lib/fieldMeasurement/postgresRepository.ts` shows the shape the rest of the app should have adopted.
**Cost of delay: grows linearly with every new table.**

**2. `pricing_config` is one global row, and the admin page hides that with a client-side fallback.**
`lib/migrations/004_pricing_config.sql` seeds exactly one row. The schema comment on the per-system-type
columns says `-- NULL = use price_per_watt`. But `app/admin/pricing/page.tsx` coalesces every field
against a hardcoded constant block in the page itself (`roofPricePerWatt: 3.10`,
`groundPricePerWatt: 2.35`, …) via `c.groundPricePerWatt ?? DEFAULTS.groundPricePerWatt`. So the operator
sees `2.35` and cannot tell whether that is stored, or the page's own constant — **and the page's
fallback disagrees with the schema's documented fallback** (schema says fall back to `price_per_watt`
= 3.10; the page falls back to 2.35). This is the derived-vs-typed confusion SolarPro already fights in
the engineering domain, reproduced in the admin surface, on money. It is also the exact place a
corporate-default-vs-branch-override control has to go. **Fix this page first — it is small, it is
already wrong, and it is the pattern's natural home.**

**3. There is no revert-to-inherited operation anywhere in the product — and the one override store
makes overrides permanent.** `app/api/admin/feature-flags/route.ts` exports `GET` and `PUT` only;
`lib/db/featureFlags.ts` exports `getFeatureFlag`, `listFeatureFlags`, `setFeatureFlag` — and nothing to
clear one. Once a flag has a DB row it can never return to inheriting from the environment. The UI
compounds it by listing only flags that already have a row, so the inheritable surface is invisible.
Every override mechanism SolarPro adds from here will copy this shape unless the pattern is fixed once,
centrally. **This is the cheapest high-value fix in the report.**

**4. The permission vocabulary is anonymous, and vocabularies freeze first.**
`lib/organizations/permissions.ts:80-84` — `resource:create`, `resource:read`, `resource:update`,
`resource:delete`, `resource:share`. Five actions covering designs, plansets, permit packages, pricing,
equipment and the AHJ registry indiscriminately, with `resource:delete` granted at `member`. Once roles
are sold to a customer they cannot be renamed without breaking their mental model and their contracts.
Compare Shopify's 18 functional areas with verb-named permissions. **Rewrite before the first
org-enabled customer, not after.**

**5. "Company" exists twice, and the free-text one is the one in production.**
`users.company TEXT` (free text, aggregated by `app/api/admin/companies/route.ts` with `GROUP BY`) and
`organizations` (a real table, barely referenced). Admins are already administering the free-text one:
`app/admin/users/page.tsx` edits it as a plain `<input>`, and company-wide actions are
`UPDATE users … WHERE company = ${company}`. Every day this runs, more typo-variants accumulate
("Acme Solar" / "Acme  Solar" / "ACME solar") that a future reconciliation must resolve by hand.
**This is actively accruing right now.**

**6. There is no scope indicator, and no place to put one.**
`app/admin/AdminShell.tsx` has a fixed sidebar, a 2-level synthetic breadcrumb, a decorative role badge
and no search. When an org switcher lands there is no slot for it, no scope line in any content header,
and no confirm dialog that names a scope. Retrofitting "which tenant am I in" into 30 pages after the
fact is far more expensive than reserving the slot now — and it is the mitigation for the one failure
mode that is unrecoverable (acting in the wrong tenant). **Reserve the slot before the switcher exists.**

**7. The impersonation signal is client-side and dismissible.**
`components/ui/ImpersonationBanner.tsx` detects impersonation from a `?impersonating=1` query param
persisted into `sessionStorage`, and offers a dismiss control titled
`Dismiss banner (impersonation still active)`. A new tab, a cleared session store, or one click and the
only indication that you are acting as someone else is gone — while the session continues. In a
single-tenant product this is a support-tooling wart. In a multi-tenant product it is the wrong-tenant
catastrophe with the airbag disabled. Solargraf documents the same gap; do not copy it.
**Make the indicator server-rendered and non-dismissible before orgs ship.**

**8. Two audit tables, and the UI reads the weaker one.**
`audit_log` is hash-chained with per-org chain partitioning designed in migration 107 — unapplied, and
**no page reads it**. `app/admin/activity-log` reads `admin_activity_log`, whose org field is a free-text
`VARCHAR target_company` and whose before/after is whatever a caller happened to put in `metadata`.
Every month this continues, the authoritative record of who-changed-what accumulates in the table that
cannot answer the question per-organisation. **Apply 107 and repoint the page.**

**9. Three feature-flag systems with three different precedence rules, none org-aware.**
Env-only `ENTERPRISE_*` (no UI, no runtime override); DB-backed `app_feature_flags` (migration 121
written but **not registered with the runner**, so the admin panel returns a 503 telling the operator to
run a migration that cannot be run); and plan gating via `users.plan`. None has an org column. A
per-branch feature decision has nowhere to live, and the operator has three places to look and no way to
know which won. **Consolidate to one resolver with a visible precedence chain — DB org override → DB
global override → env default → off — and show which level supplied the current value.**

---

## Method notes and honest limits

- Watched in full, frames read as images and merged with captions: `6LBnZaDirCg` (10:36),
  `kOOS3vmYJFc` (6:57), `HAaDk49oTcY` (2:27), `TeYJ0JHVZKE` (3:27). Total 23:27 of walkthrough.
- Capture failure recorded, not hidden: `ZEIEmdNOy1Y` — yt-dlp HTTP 403 on the video stream; captions
  read, no frames, row marked "not watched".
- Fetch failures recorded, not hidden: `help.aurorasolar.com` (403 on every article attempted) and
  `help.openai.com` (403). Both rows are labelled second-hand and are not used to support any
  recommendation.
- No walkthrough video was found for Solargraf dealer configuration, Slack Enterprise Grid org settings,
  or Aurora Teams/Partners despite targeted searching; those rows rest on official product
  documentation and say so.
- Nothing in this study was implemented. This worker has write access to this file only.
