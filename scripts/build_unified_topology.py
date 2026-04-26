#!/usr/bin/env python3
"""
Injects SolarPro pipeline sections into the partner PIPELINE_TOPOLOGY.html
to produce a unified end-to-end topology document.
"""

import os

INPUT  = os.path.join(os.path.dirname(__file__), '../public/partner-pipeline-topology.html')
OUTPUT = os.path.join(os.path.dirname(__file__), '../public/partner-pipeline-topology.html')

INJECT_BEFORE = '      <footer>'

SOLARPRO_SECTIONS = '''
      <!-- ═══════════════════════════════════════════════════════════════════
           SOLARPRO PIPELINE — injected by build_unified_topology.py
           Steps 8-14: SolarPro ingest → transform → DB → engineering
           ═══════════════════════════════════════════════════════════════ -->

      <!-- Divider -->
      <div style="margin-top:36px; margin-bottom:28px; border-top:1px solid #ffffff18; padding-top:28px;">
        <h2 style="margin:0 0 6px; font-size:clamp(18px,3vw,28px); letter-spacing:0.2px; color:#e8eeff;">
          SolarPro Pipeline — Steps 8–14
        </h2>
        <p style="margin:0; color:#9fb0e8; font-size:14px;">
          Full ingest, transform, DB write, and downstream engineering consumption inside SolarPro.
        </p>
      </div>

      <div class="grid">

        <!-- SolarPro Ingest Panel -->
        <section class="panel" style="grid-column:span 12; border-color:#22d3ee44; background:#0f1e2ecc;">
          <h2 style="color:#22d3ee;">⚡ SolarPro — Ingest Layer</h2>

          <div class="card" style="border-color:#22d3ee33;">
            <div class="title" style="color:#22d3ee;">8) Webhook Receiver + HMAC Verify</div>
            <div class="path">app/api/webhooks/survey-complete/route.ts</div>
            <div class="path" style="margin-top:4px;">
              Reads raw body bytes (bytes-exact for HMAC). Verifies
              <span style="color:#c7d2fe;">HMAC-SHA256("${timestamp}.${rawBody}")</span>
              against <span style="color:#c7d2fe;">SURVEY_WEBHOOK_SECRET</span>.
              Checks idempotency via event_id in webhook_deliveries.
              Inserts delivery row with status=<span style="color:#34d399;">verified</span>.
            </div>
            <span class="pill" style="background:#22d3ee18; border-color:#22d3ee44; color:#22d3ee;">POST /api/webhooks/survey-complete</span>
            <span class="pill" style="background:#22d3ee18; border-color:#22d3ee44; color:#22d3ee; margin-left:6px;">SURVEY_WEBHOOK_SECRET</span>
          </div>

          <div class="card" style="border-color:#22d3ee33;">
            <div class="title" style="color:#22d3ee;">9) Full Payload Fetch from Partner API</div>
            <div class="path">lib/survey/ingest/payloadFetcher.ts</div>
            <div class="path" style="margin-top:4px;">
              <span style="color:#c7d2fe;">GET ${PARTNER_BASE_URL}/api/surveys/${surveyId}</span>
              with <span style="color:#c7d2fe;">Authorization: Bearer ${PARTNER_API_BEARER_TOKEN}</span>.
              Returns full survey JSON including category metadata
              (RoofMountMetadata | GroundMountMetadata | SolarFencingMetadata).
              Falls back to degraded mode on failure — pipeline continues.
            </div>
            <span class="pill" style="background:#22d3ee18; border-color:#22d3ee44; color:#22d3ee;">PARTNER_BASE_URL</span>
            <span class="pill" style="background:#22d3ee18; border-color:#22d3ee44; color:#22d3ee; margin-left:6px;">PARTNER_API_BEARER_TOKEN</span>
          </div>

          <div class="card" style="border-color:#22d3ee33;">
            <div class="title" style="color:#22d3ee;">10) Field Mapping + Enum Normalization</div>
            <div class="path">lib/survey/ingest/transformLayer.ts</div>
            <div class="path" style="margin-top:4px;">
              v1.0 transformer maps partner <span style="color:#4fd1c5;">metadata.*</span> fields
              to SolarPro <span style="color:#22d3ee;">project_physical_data.*</span> columns
              through explicit normalizers. No raw values pass through unvalidated.
            </div>
            <div style="margin-top:10px; display:grid; grid-template-columns:1fr 14px 1fr; gap:6px; font-family:Consolas,monospace; font-size:11px; color:#9fb0e8;">
              <div style="color:#4fd1c5;">metadata.roof_material</div><div style="text-align:center;">→</div><div style="color:#22d3ee;">roof_material</div>
              <div style="color:#4fd1c5;">metadata.rafter_size/spacing</div><div style="text-align:center;">→</div><div style="color:#22d3ee;">rafter_spacing_in (int)</div>
              <div style="color:#4fd1c5;">metadata.roof_age_years</div><div style="text-align:center;">→</div><div style="color:#22d3ee;">roof_age_years</div>
              <div style="color:#4fd1c5;">metadata.azimuth</div><div style="text-align:center;">→</div><div style="color:#22d3ee;">survey_meta JSONB</div>
              <div style="color:#4fd1c5;">site_address</div><div style="text-align:center;">→</div><div style="color:#22d3ee;">projects.address</div>
              <div style="color:#4fd1c5;">latitude / longitude</div><div style="text-align:center;">→</div><div style="color:#22d3ee;">projects.lat / lng</div>
              <div style="color:#4fd1c5;">inspector_name</div><div style="text-align:center;">→</div><div style="color:#22d3ee;">inspector_name</div>
              <div style="color:#4fd1c5;">photos[].remote_url</div><div style="text-align:center;">→</div><div style="color:#22d3ee;">project_files</div>
            </div>
          </div>
        </section>

        <!-- SolarPro DB Panel -->
        <section class="panel" style="grid-column:span 6; border-color:#fbbf2444; background:#1a140acc;">
          <h2 style="color:#fbbf24;">🗄 SolarPro — DB Write</h2>

          <div class="card" style="border-color:#fbbf2433;">
            <div class="title" style="color:#fbbf24;">11) projects Upsert</div>
            <div class="path">lib/survey/ingest/ingestPipeline.ts → _upsertProject()</div>
            <div class="path" style="margin-top:4px;">
              ON CONFLICT (user_id, survey_external_id) DO UPDATE.
              Creates project with <span style="color:#c7d2fe;">origin=&#39;survey&#39;</span>.
              Re-deliveries are fully idempotent.
            </div>
            <span class="pill" style="background:#fbbf2418; border-color:#fbbf2444; color:#fbbf24;">origin='survey'</span>
          </div>

          <div class="card" style="border-color:#fbbf2433;">
            <div class="title" style="color:#fbbf24;">12) project_physical_data Upsert</div>
            <div class="path">lib/survey/ingest/ingestPipeline.ts → _upsertPhysicalData()</div>
            <div class="path" style="margin-top:4px;">
              Writes all 20 physical_data fields. ON CONFLICT (project_id) DO UPDATE —
              idempotent on replay. Best-effort: failure does NOT fail the ingest,
              project was already created.
            </div>
            <span class="pill" style="background:#fbbf2418; border-color:#fbbf2444; color:#fbbf24;">20 fields · source='survey'</span>
          </div>

          <div class="card" style="border-color:#fbbf2433;">
            <div class="title" style="color:#fbbf24;">13) project_files Insert</div>
            <div class="path">lib/survey/ingest/ingestPipeline.ts → _insertFiles()</div>
            <div class="path" style="margin-top:4px;">
              ON CONFLICT (project_id, external_id) DO NOTHING.
              Photo URLs from partner <span style="color:#4fd1c5;">photos[].remote_url</span>
              stored as pending files. Bearer-authenticated fetch on worker pickup.
            </div>
            <span class="pill" style="background:#fbbf2418; border-color:#fbbf2444; color:#fbbf24;">status='pending'</span>
          </div>
        </section>

        <!-- SolarPro Engineering Panel -->
        <section class="panel" style="grid-column:span 6; border-color:#34d39944; background:#0a1e0ecc;">
          <h2 style="color:#34d399;">🔬 SolarPro — Engineering Consumption</h2>

          <div class="card" style="border-color:#34d39933; background:#0d2214;">
            <div class="title" style="color:#34d399;">14) Engineering Report Generator</div>
            <div class="path">lib/engineering/reportGenerator.ts</div>
            <div class="path" style="margin-top:4px;">
              Reads <strong style="color:#34d399;">4 of 20</strong> physical_data fields for NEC 705.12(B) calc,
              structural analysis, and electrical diagram generation.
              16 fields are captured but not yet consumed.
            </div>
            <div style="margin-top:10px; font-family:Consolas,monospace; font-size:11px;">
              <div style="color:#34d399; margin-bottom:3px;">✓ panel_rating_amps — NEC 705.12(B) backfeed calc</div>
              <div style="color:#34d399; margin-bottom:3px;">✓ rafter_spacing_in — structural load analysis</div>
              <div style="color:#34d399; margin-bottom:3px;">✓ roof_material — load type classification</div>
              <div style="color:#34d399; margin-bottom:3px;">✓ interconnection_point — SLD diagram</div>
              <div style="color:#9fb0e8; margin-top:6px; opacity:0.5;">✗ roof_pitch, panel_brand, attic_access,</div>
              <div style="color:#9fb0e8; opacity:0.5;">  breaker_slots, + 12 more — captured, not consumed</div>
            </div>
            <span class="pill" style="background:#34d39918; border-color:#34d39944; color:#34d399;">4/20 fields LIVE</span>
          </div>

          <div class="card" style="border-color:#ffffff18; background:#0f1a20;">
            <div class="title" style="color:#9fb0e8;">NOT WIRED — Built, Zero Callers</div>
            <div class="path" style="color:#9fb0e860; font-size:11px;">
              lib/siteSurvey/applyToSystemDefinition.ts — 0 callers in app/<br/>
              lib/siteSurvey/buildCADFromSurvey.ts — 0 callers in app/<br/>
              lib/siteSurvey/permitIntegration.ts — 0 callers in app/<br/>
              lib/siteSurvey/electricalFromSurvey.ts — 0 callers in app/
            </div>
            <span class="pill">Phase 1-10 built · not wired to routes</span>
          </div>
        </section>

        <!-- End-to-end flow extension -->
        <section class="panel flow" style="border-color:#f472b644; background:#1a0a1acc;">
          <h2 style="color:#f472b6;">🔄 Extended End-to-End Flow (Steps 1–14)</h2>
          <div class="flowline">
            <div class="steps" style="grid-template-columns: repeat(14, 1fr); min-width:1400px;">
              <div class="step" style="border-color:#4fd1c544;">
                <strong style="color:#4fd1c5;">1) Mobile Sync</strong>
                <small>SyncManager syncs survey + photos to backend.</small>
              </div>
              <div class="arrow"></div>
              <div class="step" style="border-color:#7aa2ff44;">
                <strong style="color:#7aa2ff;">2) Complete Trigger</strong>
                <small>POST /api/surveys/:id/complete — auto-called after sync.</small>
              </div>
              <div class="arrow"></div>
              <div class="step" style="border-color:#fbbf2444;">
                <strong style="color:#fbbf24;">3) Queue Enqueue</strong>
                <small>webhook_deliveries row created, status=pending.</small>
              </div>
              <div class="arrow"></div>
              <div class="step" style="border-color:#f472b644;">
                <strong style="color:#f472b6;">4) HMAC Delivery</strong>
                <small>Worker signs + POSTs to SolarPro every 30s. 5-tier retry.</small>
              </div>
              <div class="arrow" style="background:linear-gradient(90deg,#f472b6,#22d3ee);"></div>
              <div class="step" style="border-color:#22d3ee88; background:#0a1e2e;">
                <strong style="color:#22d3ee;">5) HMAC Verify</strong>
                <small>SolarPro verifies signature + idempotency. 202 accepted.</small>
              </div>
              <div class="arrow" style="background:linear-gradient(90deg,#22d3ee,#22d3ee);"></div>
              <div class="step" style="border-color:#22d3ee44; background:#0a1e2e;">
                <strong style="color:#22d3ee;">6) Payload Fetch</strong>
                <small>GET /api/surveys/:id + Bearer token → full JSON.</small>
              </div>
              <div class="arrow" style="background:linear-gradient(90deg,#22d3ee,#22d3ee);"></div>
              <div class="step" style="border-color:#22d3ee44; background:#0a1e2e;">
                <strong style="color:#22d3ee;">7) Transform</strong>
                <small>metadata.* → project_physical_data columns. Enum normalization.</small>
              </div>
              <div class="arrow" style="background:linear-gradient(90deg,#22d3ee,#fbbf24);"></div>
              <div class="step" style="border-color:#fbbf2444; background:#1a140a;">
                <strong style="color:#fbbf24;">8) DB Upsert</strong>
                <small>projects + project_physical_data + project_files. Idempotent ON CONFLICT.</small>
              </div>
              <div class="arrow" style="background:linear-gradient(90deg,#fbbf24,#34d399);"></div>
              <div class="step" style="border-color:#34d39944; background:#0a1e0e;">
                <strong style="color:#34d399;">9) Engineering</strong>
                <small>4/20 fields consumed. panel_rating_amps, rafter_spacing_in, roof_material, interconnection_point.</small>
              </div>
            </div>
          </div>

          <div class="health" style="margin-top:20px;">
            <div class="item"><div><strong>Partner runtime</strong></div><div class="cmd"><a href="https://site-survey-api-bpyz.onrender.com" target="_blank" rel="noopener noreferrer">site-survey-api-bpyz.onrender.com</a></div></div>
            <div class="item"><div><strong>SolarPro webhook receiver</strong></div><div class="cmd">POST /api/webhooks/survey-complete → 202</div></div>
            <div class="item"><div><strong>Partner payload endpoint</strong></div><div class="cmd">GET ${PARTNER_BASE_URL}/api/surveys/:id + Bearer</div></div>
            <div class="item"><div><strong>Shared secret</strong></div><div class="cmd">SURVEY_WEBHOOK_SECRET (both sides)</div></div>
            <div class="item"><div><strong>Physical data fields</strong></div><div class="cmd">20 captured · 4 consumed by engineering</div></div>
            <div class="item"><div><strong>Not wired (Phase 1-10)</strong></div><div class="cmd">CAD · SystemDef · Permit · Proposal</div></div>
          </div>
        </section>

      </div>

'''

with open(INPUT, 'r') as f:
    content = f.read()

if 'SOLARPRO PIPELINE' in content:
    print("Already injected — skipping.")
else:
    idx = content.find(INJECT_BEFORE)
    if idx == -1:
        raise RuntimeError(f"Could not find injection point: {repr(INJECT_BEFORE)}")
    new_content = content[:idx] + SOLARPRO_SECTIONS + content[idx:]
    # Also update footer text
    new_content = new_content.replace(
        'Topology refreshed for current main branch integration state (webhook receiver + auto-complete sync + admin portal).',
        'Unified topology: Partner App (steps 1–7) + SolarPro Ingest → Engineering (steps 8–14) · ca2c709'
    )
    with open(OUTPUT, 'w') as f:
        f.write(new_content)
    print(f"Injected SolarPro sections. Output: {OUTPUT}")
    print(f"New file size: {len(new_content)} bytes")