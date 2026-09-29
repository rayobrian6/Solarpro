# Render / Vercel deployment mapping — why a `dev` push reaches production

Status: **investigation only — no deployment setting has been changed.**
Branch: `fix/audit-remediation` (from `origin/dev` @ `9f4ee8b4`).

File:line references are to `origin/dev` @ `9f4ee8b4` (this branch adds
`VISION_SERVICE_TOKEN` entries to both `render.yaml` files, which shifts
`render.yaml`'s worker block down; no `branch:` value is changed).

Everything marked **[repo]** is read from this repository. Everything marked
**[dashboard]** can only be confirmed in the Render / Vercel dashboards — a
Blueprint file does not prove what a live service is configured to do.

---

## 1. Service → branch → environment → database → consumer

| Service (yaml name) | Defined at | Builds from | Auto-deploy | Database it writes | Who calls it | Same instance for prod **and** dev website? | Auth on its endpoints |
|---|---|---|---|---|---|---|---|
| `solarpro` — OpenCV / YOLO / OCR photo-vision worker (docker, standard, oregon) | `render.yaml:3-49` **[repo]** | `rayobrian6/Solarpro` **`branch: dev`** (`render.yaml:9`), rootDir `external-workers/opencv-photo-vision` **[repo]** | not set in yaml → Render default is *on* **[dashboard]** | **website database (Neon)** via `DATABASE_URL` (`sync:false`) — writes `photo_vision_jobs` **[repo]** | website server code via `OPEN_SOURCE_PHOTO_VISION_WORKER_URL`, hard-coded fallback `https://solarpro.onrender.com` (`externalOpenCvPhotoVisionClient.ts:43`, `featureMatching.ts:42`, `homographyPipeline.ts:69`) **[repo]** | **Yes** — one URL / one fallback, no per-environment split in code **[repo]**; env values **[dashboard]** | none on `origin/dev` → bearer `VISION_SERVICE_TOKEN` on this branch |
| `geometry-reconstruction-worker` (docker background worker, starter) | `render.yaml:58-83` **[repo]** | `rayobrian6/Solarpro` **`branch: dev`** (`render.yaml:64`), rootDir `.` — the **whole repo** **[repo]** | default (on) **[dashboard]** | **website database (Neon)** via `DATABASE_URL`; polls and claims queued Pipeline-B jobs with **no environment filter** (`lib/db/geometryReconstruction.ts:585`) **[repo]** | not called by URL: website routes queue jobs (`…/geometry-reconstruction/start` → 202) and the worker polls the DB **[repo]** | **Yes, if both Vercel projects point at the same Neon database** **[dashboard]** | no inbound port |
| `sam2-segmentation` — SAM2 + MiDaS (docker, standard) | `sam2-service/render.yaml:2-47` **[repo]** | `rayobrian6/Solarpro` **`branch: dev`** (`sam2-service/render.yaml:6`), rootDir `sam2-service` **[repo]** | default (on); docs disagree (`HANDOFF.md:25` says off, `HANDOFF_PASS3C.md:227` says on) **[dashboard]** | none | `SAM2_SERVICE_URL` (no fallback; unset → Canny backend) and `MIDAS_SERVICE_URL ?? SAM2_SERVICE_URL`; callers `…/geometry-reconstruction/execute` route and `worker/main.ts` **[repo]** | **Yes** **[repo]** | none on `origin/dev` (CORS `*`) → bearer `VISION_SERVICE_TOKEN` on this branch |
| app backend `site-survey-api-bpyz` (not defined here) | `rayobrian6/site_survey-app-1` | `main` (AI-AGENT-README §9) | — | app database (Render PG) + website Neon via `WEBSITE_DATABASE_URL` | website via `PARTNER_BASE_URL` + `PARTNER_API_BEARER_TOKEN` | **Yes** (`PARTNER_BASE_URL` documented as "plain, all envs") | bearer JWT |

Vercel side **[repo + dashboard]**: two projects — `solarpro-v31` (production,
`solarpro.solutions`, deploys from `master`) and `solarpro-dev`
(`solarpro-dev.vercel.app`, deploys from `dev`). Whether they share one Neon
database, and what each sets for `OPEN_SOURCE_PHOTO_VISION_WORKER_URL`,
`SAM2_SERVICE_URL` and `MIDAS_SERVICE_URL`, is **[dashboard]**.

## 2. Blast radius of a push to `origin/dev` (if the dashboards match the yaml)

- **Any commit** rebuilds `geometry-reconstruction-worker` (rootDir `.`), which
  bundles `lib/**` from `dev` and executes the Pipeline-B jobs that
  **production** queues. A mid-job SIGTERM re-queues the job (`worker/main.ts:348-407`).
- **Commits under `external-workers/opencv-photo-vision/**`** redeploy
  `solarpro`, which serves production photo-vision passes, feature matching and
  homography. Its job state is in memory, so in-flight production jobs lose
  their status on redeploy.
- **Commits under `sam2-service/**`** redeploy `sam2-segmentation`, which serves
  production segmentation and depth; requests during the model cold start fall
  back to Canny or fail.
- Not affected: the app backend (separate repo, `main`).

**Consequence for this branch:** it changes `sam2-service/**`,
`external-workers/opencv-photo-vision/**` and `lib/**`. Merging it into `dev`
redeploys **all three** services that production uses — and the vision
services will then answer **401** to any caller without `VISION_SERVICE_TOKEN`.

## 3. What only the dashboards can answer

1. The branch and auto-deploy setting each Render service **actually** uses (the
   dashboard can override the yaml; services may not have been created from the
   Blueprint at all — `sam2-service/render.yaml` uses `type: web_service`, which
   is not a valid Blueprint type, and sits outside the repo root).
2. The `DATABASE_URL` on both workers, and whether it equals the one on
   `solarpro-v31` and/or `solarpro-dev`.
3. `OPEN_SOURCE_PHOTO_VISION_WORKER_URL` / `SAM2_SERVICE_URL` / `MIDAS_SERVICE_URL`
   on each Vercel project.
4. Whether a second SAM2 service exists — two service ids are documented
   (`.env.example:397` vs `AUDIT_2025.md:40`).
5. Build filters (rootDir `.` rebuilds the worker on every commit).
6. `compliance/policies/26-virtual-environment-security.md:46-57` describes a
   production `solarpro-sam2` on `master` plus a `solarpro-sam2-staging` — nothing
   in the repo corresponds to that; the compliance doc may be describing a
   control that does not exist.

## 4. Options to decouple (not applied — decision needed)

| Option | What changes | Pros | Cons |
|---|---|---|---|
| **A. Prod services on `master`, staging services on `dev`** | Point the three production Render services at `master`; create `*-staging` copies on `dev` with their own Neon branch; give `solarpro-dev` the staging URLs | Real isolation; a `dev` push can never reach production workers; matches the compliance doc | ~2× Render cost; job tables per database; needs a Neon branch for dev |
| **B. Auto-deploy off + manual promotion** | Turn auto-deploy off on the three services; deploy a pinned commit only on sign-off | Cheapest, fastest to do | Dev still has no staging workers; relies on people remembering to promote |
| **C. Environment-scoped URLs only** | Different `*_URL` values per Vercel project; remove the hard-coded `solarpro.onrender.com` fallbacks so an unset var fails closed | Stops the dev website calling production vision services | Does nothing for the DB-polling worker or shared-DB writes unless combined with A |

**Recommended sequence, for decision:** B immediately (stop the silent
coupling) → C in the same change (remove the hard-coded fallbacks) → A when
there is budget for staging workers. Nothing here was changed on this branch.

## 5. Rollout order for this branch's vision-service auth (whichever option)

1. Generate one value (`openssl rand -hex 32`).
2. Set `VISION_SERVICE_TOKEN` on **every** Render vision service (`solarpro`,
   `sam2-segmentation`, and on `geometry-reconstruction-worker`, which calls SAM2)
   **and** on both Vercel projects.
3. Redeploy the website first (it sends the header; the old services ignore it).
4. Only then let the service code that enforces it deploy (i.e. merge to `dev`
   under today's coupling). Reversing 2 and 4 = every vision call answers 401.
