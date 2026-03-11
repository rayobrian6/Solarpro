# SolarPro — Local Development Guide

## Branch Strategy

| Branch | Purpose | Deploys to |
|--------|---------|-----------|
| `dev` | Active development — all day-to-day work | Vercel **preview** URL only |
| `master` | Stable, production-ready code | **https://solarpro-v31.vercel.app** (production) |

**Rule: Never commit directly to `master` during development.**
Work on `dev`, test locally, then merge to `master` when stable.

---

## Quick Start

### 1. Clone and switch to dev branch

```bash
git clone https://github.com/rayobrian6/Solarpro.git
cd Solarpro
git checkout dev
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

```bash
cp .env.example .env.local
```

Edit `.env.local` — see the **Environment Variables** section below.

### 4. Start local development server

```bash
npm run dev
```

App runs at **http://localhost:3000** with full hot reload.
All APIs work locally: SLD generation, plan-set PDF, projects, auth.

---

## Daily Development Workflow

```
git checkout dev              # Always work on dev branch
      ↓
npm run dev                   # Start local server at localhost:3000
      ↓
Edit code → hot reload        # Instant feedback, no deploys
      ↓
Test locally at localhost:3000
      ↓
git add . && git commit -m "feat: description"
git push origin dev           # Push to dev → Vercel preview URL only
      ↓
Feature complete + tested?
      ↓
git checkout master
git merge dev                 # Merge stable code to master
git push origin master        # → GitHub Actions deploys to production
      ↓
Live at https://solarpro-v31.vercel.app
```

---

## What Triggers a Vercel Build

| Action | Result |
|--------|--------|
| Push to `dev` | Vercel preview URL (no production change) |
| Push to `master` | **Production deployment** via GitHub Actions |
| `npm run dev` locally | **Nothing** — 100% local, zero cloud builds |

---

## Merging dev → master (Production Release)

When your feature is ready for production:

```bash
# Make sure dev is up to date
git checkout dev
git pull origin dev

# Switch to master and merge
git checkout master
git pull origin master
git merge dev

# Push — this triggers production deployment
git push origin master

# Switch back to dev for next feature
git checkout dev
```

Or use a **Pull Request** on GitHub:
- Open PR: `dev → master`
- Review changes
- Merge → automatic production deployment

---

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Local dev server at **http://localhost:3000** (hot reload) |
| `npm run dev:3008` | Local dev server at http://localhost:3008 |
| `npm run build` | Production build — catches TypeScript errors before pushing |
| `npm run type-check` | TypeScript check only (fast) |
| `npm run lint` | ESLint check |
| `npm run dev:debug` | Dev server with Node.js inspector for Chrome DevTools |

**Always run `npm run build` before merging to master** to catch TypeScript errors early.

---

## Environment Variables

Copy `.env.example` to `.env.local` and fill in:

| Variable | Where to get it | Required? |
|----------|----------------|-----------|
| `DATABASE_URL` | [Neon Console](https://console.neon.tech) → Connection string (pooled) | ✅ Yes |
| `JWT_SECRET` | Run: `node -e "console.log(require('crypto').randomBytes(64).toString('base64'))"` | ✅ Yes |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | [Google Cloud Console](https://console.cloud.google.com) → Maps JS API | ✅ Maps |
| `GOOGLE_MAPS_API_KEY` | Same as above (server-side geocoding) | ✅ Maps |
| `NEXT_PUBLIC_CESIUM_ION_TOKEN` | [Cesium Ion](https://cesium.com/ion/tokens) | Optional |
| `NREL_API_KEY` | [NREL Developer](https://developer.nrel.gov/signup/) — use `DEMO_KEY` for dev | Optional |
| `OPENAI_API_KEY` | [OpenAI Platform](https://platform.openai.com/api-keys) | Optional (bill OCR) |
| `STRIPE_SECRET_KEY` | [Stripe Dashboard](https://dashboard.stripe.com/apikeys) — `sk_test_*` for dev | Optional (billing) |
| `STRIPE_WEBHOOK_SECRET` | Stripe Dashboard → Webhooks | Optional (billing) |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | [Mapbox](https://account.mapbox.com/access-tokens/) | Optional (maps) |

`.env.local` is **gitignored** — it never gets committed.

---

## API Routes (all work locally)

| Endpoint | Description |
|----------|-------------|
| `POST /api/engineering/sld` | Generate Single-Line Diagram SVG |
| `POST /api/engineering/plan-set` | Generate permit plan set PDF |
| `GET/POST /api/projects` | Project CRUD |
| `POST /api/auth/login` | Authentication |
| `GET /api/health` | Health check |
| `GET /api/version` | Build version |

---

## PDF Generation (wkhtmltopdf)

Required for permit plan set generation:

```bash
# macOS
brew install wkhtmltopdf

# Ubuntu/Debian
sudo apt-get install wkhtmltopdf

# Verify
wkhtmltopdf --version
```

Falls back to HTML output if wkhtmltopdf is not installed.

---

## Preventing Accidental Production Deployments

The GitHub Actions workflow (`main.yml`) **only triggers on push to `master`**.

Pushing to `dev` never triggers a production deployment.

To skip GitHub Actions even on master (e.g., for a hotfix you want to test first):

```bash
git commit -m "wip: testing something [skip ci]"
git push origin master  # workflow skipped
```

---

## Project Structure

```
solarpro/
├── app/
│   ├── api/
│   │   ├── engineering/
│   │   │   ├── plan-set/   # Permit plan set PDF generation
│   │   │   └── sld/        # Single-line diagram SVG
│   │   ├── projects/       # Project CRUD
│   │   └── auth/           # Authentication
│   └── engineering/        # Design Studio (page.tsx)
├── lib/
│   ├── computed-system.ts  # NEC calculation engine
│   ├── equipment-db.ts     # Equipment registry
│   ├── version.ts          # Build version
│   └── plan-set/           # Plan set sheet builders
├── .env.local              # Local env vars (gitignored — never commit)
├── .env.example            # Template for .env.local
├── DEVELOPMENT.md          # This file
└── .github/workflows/
    └── main.yml            # Auto-deploy to production on master push ONLY
```

---

## Versioning

Bump `lib/version.ts` before merging to master:

```typescript
export const BUILD_VERSION = 'v45.4';
export const BUILD_DATE    = '2026-03-11';
export const BUILD_DESCRIPTION = 'What changed in this release';
```