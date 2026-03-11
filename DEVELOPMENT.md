# SolarPro — Local Development Guide

## Overview

SolarPro is a Next.js 14 application. All development should happen **locally** with hot reload.
Push to GitHub (`master`) only when the feature is stable and tested.

**Vercel deploys automatically on every push to `master`.** Do not push broken code.

---

## Quick Start

### 1. Clone the repo

```bash
git clone https://github.com/rayobrian6/Solarpro.git
cd Solarpro
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Copy `.env.example` to `.env.local` and fill in your values:

```bash
cp .env.example .env.local
```

Edit `.env.local`:

| Variable | Where to get it | Required? |
|---|---|---|
| `DATABASE_URL` | [Neon Console](https://console.neon.tech) → your project → Connection string (pooled) | ✅ Yes |
| `JWT_SECRET` | Any long random string. Run: `node -e "console.log(require('crypto').randomBytes(64).toString('base64'))"` | ✅ Yes |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | [Google Cloud Console](https://console.cloud.google.com) → Maps JavaScript API | ✅ Yes (for map features) |
| `GOOGLE_MAPS_API_KEY` | Same as above (server-side) | ✅ Yes (for geocoding) |
| `NEXT_PUBLIC_CESIUM_ION_TOKEN` | [Cesium Ion](https://cesium.com/ion/tokens) | Optional |
| `NREL_API_KEY` | [NREL Developer](https://developer.nrel.gov/signup/) — use `DEMO_KEY` for dev | Optional |
| `OPENAI_API_KEY` | [OpenAI Platform](https://platform.openai.com/api-keys) | Optional (bill OCR) |
| `STRIPE_SECRET_KEY` | [Stripe Dashboard](https://dashboard.stripe.com/apikeys) — use `sk_test_*` keys | Optional (billing) |

### 4. Start the development server

```bash
npm run dev
```

The app runs at **http://localhost:3000** with hot reload.

---

## Development Workflow

```
Edit code locally
      ↓
Test at http://localhost:3000
      ↓
All APIs work locally (SLD, plan-set, projects, auth)
      ↓
Satisfied with the change?
      ↓
git add . && git commit -m "descriptive message"
      ↓
git push origin master
      ↓
GitHub Actions triggers Vercel deployment automatically
      ↓
Live at https://solarpro-v31.vercel.app
```

**Key rule: Never push to master for experimental changes.** Use local dev for all iteration.

---

## Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start dev server at http://localhost:3000 (hot reload) |
| `npm run dev:3008` | Start dev server at http://localhost:3008 (alternate port) |
| `npm run build` | Production build (catches TypeScript errors) |
| `npm run start` | Start production build locally |
| `npm run type-check` | Run TypeScript compiler check without building |
| `npm run lint` | Run ESLint |
| `npm run dev:debug` | Start with Node.js inspector (for Chrome DevTools debugging) |

---

## API Routes (all work locally)

All API routes run as local Node.js functions — no Vercel dependencies:

| Endpoint | Description |
|---|---|
| `POST /api/engineering/sld` | Generate Single-Line Diagram SVG |
| `POST /api/engineering/plan-set` | Generate full permit plan set PDF |
| `GET/POST /api/projects` | Project CRUD |
| `GET /api/projects/:id` | Get single project |
| `POST /api/auth/login` | User authentication |
| `GET /api/health` | Health check (DB + version) |
| `GET /api/version` | Build version info |

---

## PDF Generation (wkhtmltopdf)

The permit plan set uses `wkhtmltopdf` for PDF rendering. Install it if not present:

**macOS:**
```bash
brew install wkhtmltopdf
```

**Ubuntu/Debian:**
```bash
sudo apt-get install wkhtmltopdf
```

**Windows:** Download from https://wkhtmltopdf.org/downloads.html

Verify installation:
```bash
wkhtmltopdf --version
# Should output: wkhtmltopdf 0.12.x
```

If `wkhtmltopdf` is not available, the plan-set route automatically falls back to returning HTML instead of PDF.

---

## Engineering Engine (computeSystem)

The core NEC calculation engine runs entirely locally — no external services:

- **`lib/computed-system.ts`** — Single source of truth for all NEC 690/705 calculations
- **`lib/plan-set/`** — Permit plan set sheet builders
- **`lib/equipment-db.ts`** — Equipment registry (panels, inverters, racking)

To test the engine directly:
```bash
# Run a quick engine test
npx tsx scripts/test-computed-system.ts
```

---

## Database

The app uses **Neon PostgreSQL** (serverless). The same database is shared between local dev and production. If you need a separate dev database:

1. Create a new project at [console.neon.tech](https://console.neon.tech)
2. Run migrations: `node run_migration.js`
3. Update `DATABASE_URL` in `.env.local`

---

## GitHub Actions / Vercel Deployment

**Automatic deployment** triggers on every push to `master` via `.github/workflows/main.yml`.

The workflow:
1. Triggers a Vercel production build via API
2. Waits for the build to complete (READY state)
3. Assigns the `solarpro-v31.vercel.app` alias
4. Runs a health check

**Required GitHub Secret:** `VERCEL_TOKEN` — set at https://github.com/rayobrian6/Solarpro/settings/secrets/actions

**To disable automatic deployment** (e.g., for a long feature branch): add `[skip ci]` to your commit message:
```bash
git commit -m "wip: experimenting with new feature [skip ci]"
```

---

## Troubleshooting

### Port already in use
```bash
# Kill whatever is on port 3000
lsof -ti:3000 | xargs kill -9
npm run dev
```

### TypeScript errors
```bash
npm run type-check 2>&1 | head -50
```

### Database connection errors
- Verify `DATABASE_URL` in `.env.local` is the **pooled** Neon connection string
- Check Neon console for connection limits
- Neon free tier: 10 concurrent connections max

### "JWT_SECRET is not set" error
- Make sure `.env.local` exists and has `JWT_SECRET` set
- Restart the dev server after editing `.env.local`

### wkhtmltopdf not found
- Install it (see PDF Generation section above)
- The plan-set route falls back to HTML if wkhtmltopdf is missing

---

## Project Structure

```
solarpro/
├── app/                    # Next.js App Router pages + API routes
│   ├── api/
│   │   ├── engineering/
│   │   │   ├── plan-set/   # Permit plan set generation
│   │   │   └── sld/        # Single-line diagram SVG
│   │   ├── projects/       # Project CRUD
│   │   └── auth/           # Authentication
│   └── engineering/        # Design Studio UI (page.tsx)
├── lib/
│   ├── computed-system.ts  # NEC calculation engine (single source of truth)
│   ├── equipment-db.ts     # Equipment registry
│   ├── version.ts          # Build version (bump on each release)
│   └── plan-set/           # Plan set sheet builders
├── components/             # Shared React components
├── .env.local              # Local environment variables (NOT in git)
├── .env.example            # Template for .env.local
├── DEVELOPMENT.md          # This file
└── .github/workflows/
    └── main.yml            # Auto-deploy to Vercel on master push
```

---

## Versioning

Bump `lib/version.ts` when making significant changes:

```typescript
export const BUILD_VERSION = 'v45.4';   // ← increment this
export const BUILD_DATE    = '2026-03-11';
export const BUILD_DESCRIPTION = 'Brief description of what changed';
```

Use semantic-style versioning: `v{major}.{minor}` — e.g., `v45.4`, `v46.0`.