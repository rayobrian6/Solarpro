#!/usr/bin/env python3
"""Inject migrations 047-053 into /api/migrate/route.ts"""

import re

ROUTE_PATH = "app/api/migrate/route.ts"

# The marker we replace — right before the final return statement
MARKER = "    return NextResponse.json({ success: true, results });"

INJECTION = """
    // -- Migration 047: network_opportunities ----------------------------------
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS network_opportunities (
          id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          source_opportunity_id UUID,
          source_type           TEXT NOT NULL DEFAULT 'contractor_shared',
          status                TEXT NOT NULL DEFAULT 'intake',
          homeowner_first_name  TEXT,
          homeowner_last_name   TEXT,
          homeowner_email       TEXT,
          homeowner_phone       TEXT,
          address               TEXT,
          city                  TEXT,
          state                 TEXT,
          zip                   TEXT,
          lat                   NUMERIC(10,7),
          lng                   NUMERIC(10,7),
          monthly_bill          NUMERIC(10,2),
          annual_usage_kwh      NUMERIC(10,2),
          utility_name          TEXT,
          net_metering          BOOLEAN,
          roof_age_years        INTEGER,
          structure_type        TEXT,
          stories               INTEGER,
          usable_roof_pct       NUMERIC(5,4),
          shade_level           TEXT,
          system_size_kw        NUMERIC(6,2),
          annual_production_kwh NUMERIC(10,2),
          battery_interest      BOOLEAN,
          financing_preference  TEXT,
          opportunity_score     NUMERIC(5,2),
          opportunity_grade     TEXT,
          listing_price         NUMERIC(10,2),
          claim_count           INTEGER DEFAULT 0,
          max_claims            INTEGER DEFAULT 1,
          view_count            INTEGER DEFAULT 0,
          published_at          TIMESTAMPTZ,
          expires_at            TIMESTAMPTZ,
          claimed_at            TIMESTAMPTZ,
          closed_at             TIMESTAMPTZ,
          intake_notes          TEXT,
          admin_notes           TEXT,
          scoring_data          JSONB DEFAULT '{}',
          screening_data        JSONB DEFAULT '{}',
          enrichment_data       JSONB DEFAULT '{}',
          created_at            TIMESTAMPTZ DEFAULT NOW(),
          updated_at            TIMESTAMPTZ DEFAULT NOW()
        )
      \`;
      results.push('✅ Migration 047a: network_opportunities table — ready');
    } catch (e: unknown) {
      results.push(\`⚠️ Migration 047a (network_opportunities): \${(e as Error).message}\`);
    }
    try {
      await sql\`CREATE INDEX IF NOT EXISTS idx_net_opps_status ON network_opportunities(status, created_at DESC)\`;
      results.push('✅ Migration 047b: idx_net_opps_status — ready');
    } catch (e: unknown) {
      results.push(\`⚠️ Migration 047b: \${(e as Error).message}\`);
    }
    try {
      await sql\`CREATE INDEX IF NOT EXISTS idx_net_opps_source_type ON network_opportunities(source_type)\`;
      results.push('✅ Migration 047c: idx_net_opps_source_type — ready');
    } catch (e: unknown) {
      results.push(\`⚠️ Migration 047c: \${(e as Error).message}\`);
    }
    try {
      await sql\`CREATE INDEX IF NOT EXISTS idx_net_opps_state ON network_opportunities(state, status)\`;
      results.push('✅ Migration 047d: idx_net_opps_state — ready');
    } catch (e: unknown) {
      results.push(\`⚠️ Migration 047d: \${(e as Error).message}\`);
    }
    try {
      await sql\`CREATE INDEX IF NOT EXISTS idx_net_opps_score ON network_opportunities(opportunity_score DESC) WHERE opportunity_score IS NOT NULL\`;
      results.push('✅ Migration 047e: idx_net_opps_score — ready');
    } catch (e: unknown) {
      results.push(\`⚠️ Migration 047e: \${(e as Error).message}\`);
    }
    try {
      await sql\`CREATE INDEX IF NOT EXISTS idx_net_opps_published ON network_opportunities(published_at DESC) WHERE published_at IS NOT NULL\`;
      results.push('✅ Migration 047f: idx_net_opps_published — ready');
    } catch (e: unknown) {
      results.push(\`⚠️ Migration 047f: \${(e as Error).message}\`);
    }
    try {
      await sql\`CREATE INDEX IF NOT EXISTS idx_net_opps_source_opp ON network_opportunities(source_opportunity_id) WHERE source_opportunity_id IS NOT NULL\`;
      results.push('✅ Migration 047g: idx_net_opps_source_opp — ready');
    } catch (e: unknown) {
      results.push(\`⚠️ Migration 047g: \${(e as Error).message}\`);
    }

    // -- Migration 048: opportunity_sources ------------------------------------
    try {
      await sql\`
        CREATE TABLE IF NOT EXISTS opportunity_sources (
          id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          opportunity_id        UUID NOT NULL REFERENCES network_opportunities(id) ON DELETE CASCADE,
          source_type           TEXT NOT NULL,
          source_channel        TEXT,
          source_campaign_id    TEXT,
          source_campaign_name  TEXT,
          source_ad_set_id      TEXT,
          source_ad_id          TEXT,
          utm_source            TEXT,
          utm_medium            TEXT,
          utm_campaign          TEXT,
          utm_content           TEXT,
          utm_term              TEXT,
          platform              TEXT,
          platform_lead_id      TEXT,
          platform_campaign_id  TEXT,
          platform_ad_set_id    TEXT,
          platform_ad_id        TEXT,
          platform_form_id      TEXT,
          gclid                 TEXT,
          fbclid                TEXT,
          ttclid                TEXT,
          msclkid               TEXT,
          cost_per_lead         NUMERIC(10,2),
          cost_per_click        NUMERIC(10,2),
          attributed_spend      NUMERIC(12,2),
          currency              TEXT DEFAULT 'USD',
          referring_contractor_id UUID,
          referring_user_id     UUID,
          referral_code         TEXT,
          referral_payout       NUMERIC(10,2),
          partner_id            UUID,
          partner_name          TEXT,
          partner_lead_id       TEXT,
          landing_page_url      TEXT,
          landing_page_path     TEXT,
          landing_page_variant  TEXT,
          session_id            TEXT,
          ip_address            INET,
          user_agent            TEXT,
          device_type           TEXT,
          browser               TEXT,
          os                    TEXT,
          country               TEXT,
          region                TEXT,
          city                  TEXT,
          first_touch_at        TIMESTAMPTZ,
          form_submit_at        TIMESTAMPTZ,
          qualified_at          TIMESTAMPTZ,
          claimed_at            TIMESTAMPTZ,
          appointment_at        TIMESTAMPTZ,
          closed_at             TIMESTAMPTZ,
          funnel_stage          TEXT DEFAULT 'lead',
          conversion_value      NUMERIC(12,2),
          gross_margin          NUMERIC(12,2),
          revenue_share         NUMERIC(10,2),
          is_duplicate          BOOLEAN DEFAULT false,
          duplicate_of          UUID,
          duplicate_detected_at TIMESTAMPTZ,
          duplicate_detection   JSONB DEFAULT '{}',
          raw_payload           JSONB DEFAULT '{}',
          processed_at          TIMESTAMPTZ,
          processing_notes      TEXT,
          created_at            TIMESTAMPTZ DEFAULT NOW(),
          updated_at            TIMESTAMPTZ DEFAULT NOW()
        )
      \`;
      results.push('✅ Migration 048a: opportunity_sources table — ready');
    } catch (e: unknown) {
      results.push(\`⚠️ Migration 048a (opportunity_sources): \${(e as Error).message}\`);
    }
    try {
      await sql\`CREATE INDEX IF NOT EXISTS idx_opp_sources_opportunity_id ON opportunity_sources(opportunity_id)\`;
      results.push('✅ Migration 048b: idx_opp_sources_opportunity_id — ready');
    } catch (e: unknown) {
      results.push(\`⚠️ Migration 048b: \${(e as Error).message}\`);
    }
    try {
      await sql\`CREATE INDEX IF NOT EXISTS idx_opp_sources_source_type ON opportunity_sources(source_type)\`;
      results.push('✅ Migration 048c: idx_opp_sources_source_type — ready');
    } catch (e: unknown) {
      results.push(\`⚠️ Migration 048c: \${(e as Error).message}\`);
    }
    try {
      await sql\`CREATE INDEX IF NOT EXISTS idx_opp_sources_platform ON opportunity_sources(platform)\`;
      results.push('✅ Migration 048d: idx_opp_sources_platform — ready');
    } catch (e: unknown) {
      results.push(\`⚠️ Migration 048d: \${(e as Error).message}\`);
    }
    try {
      await sql\`CREATE INDEX IF NOT EXISTS idx_opp_sources_campaign_id ON opportunity_sources(source_campaign_id)\`;
      results.push('✅ Migration 048e: idx_opp_sources_campaign_id — ready');
    } catch (e: unknown) {
      results.push(\`⚠️ Migration 048e: \${(e as Error).message}\`);
    }
    try {
      await sql\`CREATE INDEX IF NOT EXISTS idx_opp_sources_created_at ON opportunity_sources(created_at DESC)\`;
      results.push('✅ Migration 048f: idx_opp_sources_created_at — ready');
    } catch (e: unknown) {
      results.push(\`⚠️ Migration 048f: \${(e as Error).message}\`);
    }

    // -- Migration 049: opportunity_screening_queue ----------------------------
    try {
      await sql\`
        CREATE TABLE IF NOT EXISTS opportunity_screening_queue (
          id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          opportunity_id        UUID NOT NULL REFERENCES network_opportunities(id) ON DELETE CASCADE,
          pipeline_status       TEXT NOT NULL DEFAULT 'pending',
          started_at            TIMESTAMPTZ,
          completed_at          TIMESTAMPTZ,
          duration_ms           INTEGER,
          auto_decision         TEXT,
          auto_decision_reason  TEXT,
          confidence_score      NUMERIC(5,2),
          override_decision     TEXT,
          override_by           UUID,
          override_reason       TEXT,
          override_at           TIMESTAMPTZ,
          step1_status          TEXT DEFAULT 'pending',
          step1_phone_valid     BOOLEAN,
          step1_email_valid     BOOLEAN,
          step1_phone_type      TEXT,
          step1_email_risk      TEXT,
          step1_data            JSONB DEFAULT '{}',
          step1_completed_at    TIMESTAMPTZ,
          step1_error           TEXT,
          step2_status          TEXT DEFAULT 'pending',
          step2_is_duplicate    BOOLEAN,
          step2_duplicate_of    UUID,
          step2_match_score     NUMERIC(5,2),
          step2_data            JSONB DEFAULT '{}',
          step2_completed_at    TIMESTAMPTZ,
          step2_error           TEXT,
          step3_status          TEXT DEFAULT 'pending',
          step3_address_valid   BOOLEAN,
          step3_formatted_address TEXT,
          step3_lat             NUMERIC(10,7),
          step3_lng             NUMERIC(10,7),
          step3_county          TEXT,
          step3_fips            TEXT,
          step3_census_tract    TEXT,
          step3_data            JSONB DEFAULT '{}',
          step3_completed_at    TIMESTAMPTZ,
          step3_error           TEXT,
          step4_status          TEXT DEFAULT 'pending',
          step4_in_service_area BOOLEAN,
          step4_matched_state   TEXT,
          step4_matched_market  TEXT,
          step4_nearest_contractor_mi NUMERIC(6,2),
          step4_active_contractors_nearby INTEGER,
          step4_data            JSONB DEFAULT '{}',
          step4_completed_at    TIMESTAMPTZ,
          step4_error           TEXT,
          step5_status          TEXT DEFAULT 'pending',
          step5_utility_name    TEXT,
          step5_utility_eia_id  TEXT,
          step5_rate_class      TEXT,
          step5_avg_rate_kwh    NUMERIC(6,4),
          step5_net_metering    BOOLEAN,
          step5_nem_type        TEXT,
          step5_data            JSONB DEFAULT '{}',
          step5_completed_at    TIMESTAMPTZ,
          step5_error           TEXT,
          step6_status          TEXT DEFAULT 'pending',
          step6_viable          BOOLEAN,
          step6_annual_kwh_m2   NUMERIC(8,2),
          step6_peak_sun_hours  NUMERIC(5,2),
          step6_shade_class     TEXT,
          step6_estimated_system_size_kw NUMERIC(6,2),
          step6_data            JSONB DEFAULT '{}',
          step6_completed_at    TIMESTAMPTZ,
          step6_error           TEXT,
          step7_status          TEXT DEFAULT 'pending',
          step7_is_owner        BOOLEAN,
          step7_owner_name      TEXT,
          step7_owner_match     NUMERIC(5,2),
          step7_year_purchased  INTEGER,
          step7_assessed_value  NUMERIC(12,2),
          step7_data            JSONB DEFAULT '{}',
          step7_completed_at    TIMESTAMPTZ,
          step7_error           TEXT,
          step8_status          TEXT DEFAULT 'pending',
          step8_credit_tier     TEXT,
          step8_median_income   NUMERIC(10,2),
          step8_home_value      NUMERIC(12,2),
          step8_debt_proxy      TEXT,
          step8_finance_eligible BOOLEAN,
          step8_data            JSONB DEFAULT '{}',
          step8_completed_at    TIMESTAMPTZ,
          step8_error           TEXT,
          step9_status          TEXT DEFAULT 'pending',
          step9_intent_score    NUMERIC(5,2),
          step9_intent_tier     TEXT,
          step9_data            JSONB DEFAULT '{}',
          step9_completed_at    TIMESTAMPTZ,
          step9_error           TEXT,
          step10_status         TEXT DEFAULT 'pending',
          step10_decision       TEXT,
          step10_score          NUMERIC(5,2),
          step10_grade          TEXT,
          step10_data           JSONB DEFAULT '{}',
          step10_completed_at   TIMESTAMPTZ,
          step10_error          TEXT,
          retry_count           INTEGER DEFAULT 0,
          last_retry_at         TIMESTAMPTZ,
          max_retries           INTEGER DEFAULT 3,
          error_log             JSONB DEFAULT '[]',
          created_at            TIMESTAMPTZ DEFAULT NOW(),
          updated_at            TIMESTAMPTZ DEFAULT NOW()
        )
      \`;
      results.push('✅ Migration 049a: opportunity_screening_queue table — ready');
    } catch (e: unknown) {
      results.push(\`⚠️ Migration 049a (opportunity_screening_queue): \${(e as Error).message}\`);
    }
    try {
      await sql\`CREATE UNIQUE INDEX IF NOT EXISTS idx_screening_queue_opp_id ON opportunity_screening_queue(opportunity_id)\`;
      results.push('✅ Migration 049b: idx_screening_queue_opp_id (unique) — ready');
    } catch (e: unknown) {
      results.push(\`⚠️ Migration 049b: \${(e as Error).message}\`);
    }
    try {
      await sql\`CREATE INDEX IF NOT EXISTS idx_screening_pipeline_status ON opportunity_screening_queue(pipeline_status)\`;
      results.push('✅ Migration 049c: idx_screening_pipeline_status — ready');
    } catch (e: unknown) {
      results.push(\`⚠️ Migration 049c: \${(e as Error).message}\`);
    }
    try {
      await sql\`CREATE INDEX IF NOT EXISTS idx_screening_auto_decision ON opportunity_screening_queue(auto_decision)\`;
      results.push('✅ Migration 049d: idx_screening_auto_decision — ready');
    } catch (e: unknown) {
      results.push(\`⚠️ Migration 049d: \${(e as Error).message}\`);
    }
    try {
      await sql\`CREATE INDEX IF NOT EXISTS idx_screening_created_at ON opportunity_screening_queue(created_at DESC)\`;
      results.push('✅ Migration 049e: idx_screening_created_at — ready');
    } catch (e: unknown) {
      results.push(\`⚠️ Migration 049e: \${(e as Error).message}\`);
    }

    // -- Migration 050: opportunity_intelligence -------------------------------
    try {
      await sql\`
        CREATE TABLE IF NOT EXISTS opportunity_intelligence (
          id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          opportunity_id          UUID NOT NULL REFERENCES network_opportunities(id) ON DELETE CASCADE,
          overall_score           NUMERIC(5,2) NOT NULL DEFAULT 0,
          overall_grade           TEXT NOT NULL DEFAULT 'C',
          score_version           TEXT DEFAULT 'v1.0',
          scored_at               TIMESTAMPTZ DEFAULT NOW(),
          scored_by               TEXT DEFAULT 'auto',
          property_score          NUMERIC(5,2),
          property_weight         NUMERIC(4,3) DEFAULT 0.25,
          property_factors        JSONB DEFAULT '{}',
          solar_score             NUMERIC(5,2),
          solar_weight            NUMERIC(4,3) DEFAULT 0.25,
          solar_factors           JSONB DEFAULT '{}',
          financial_score         NUMERIC(5,2),
          financial_weight        NUMERIC(4,3) DEFAULT 0.20,
          financial_factors       JSONB DEFAULT '{}',
          market_score            NUMERIC(5,2),
          market_weight           NUMERIC(4,3) DEFAULT 0.15,
          market_factors          JSONB DEFAULT '{}',
          intent_score            NUMERIC(5,2),
          intent_weight           NUMERIC(4,3) DEFAULT 0.15,
          intent_factors          JSONB DEFAULT '{}',
          grade_a_plus_threshold  NUMERIC(5,2) DEFAULT 90,
          grade_a_threshold       NUMERIC(5,2) DEFAULT 80,
          grade_b_threshold       NUMERIC(5,2) DEFAULT 65,
          grade_c_threshold       NUMERIC(5,2) DEFAULT 50,
          market_price            NUMERIC(10,2),
          price_min               NUMERIC(10,2),
          price_max               NUMERIC(10,2),
          pricing_rationale       TEXT,
          comparable_leads        JSONB DEFAULT '[]',
          total_eligible_contractors   INTEGER DEFAULT 0,
          top_match_contractor_id      UUID,
          top_match_score              NUMERIC(5,2),
          match_summary                JSONB DEFAULT '[]',
          risk_flags              TEXT[],
          opportunity_highlights  TEXT[],
          executive_summary       TEXT,
          contractor_pitch        TEXT,
          admin_notes             TEXT,
          score_history           JSONB DEFAULT '[]',
          created_at              TIMESTAMPTZ DEFAULT NOW(),
          updated_at              TIMESTAMPTZ DEFAULT NOW()
        )
      \`;
      results.push('✅ Migration 050a: opportunity_intelligence table — ready');
    } catch (e: unknown) {
      results.push(\`⚠️ Migration 050a (opportunity_intelligence): \${(e as Error).message}\`);
    }
    try {
      await sql\`CREATE UNIQUE INDEX IF NOT EXISTS idx_opp_intelligence_opp_id ON opportunity_intelligence(opportunity_id)\`;
      results.push('✅ Migration 050b: idx_opp_intelligence_opp_id (unique) — ready');
    } catch (e: unknown) {
      results.push(\`⚠️ Migration 050b: \${(e as Error).message}\`);
    }
    try {
      await sql\`CREATE INDEX IF NOT EXISTS idx_opp_intelligence_score ON opportunity_intelligence(overall_score DESC)\`;
      results.push('✅ Migration 050c: idx_opp_intelligence_score — ready');
    } catch (e: unknown) {
      results.push(\`⚠️ Migration 050c: \${(e as Error).message}\`);
    }
    try {
      await sql\`CREATE INDEX IF NOT EXISTS idx_opp_intelligence_grade ON opportunity_intelligence(overall_grade)\`;
      results.push('✅ Migration 050d: idx_opp_intelligence_grade — ready');
    } catch (e: unknown) {
      results.push(\`⚠️ Migration 050d: \${(e as Error).message}\`);
    }

    // -- Migration 051: opportunity_assignments --------------------------------
    try {
      await sql\`
        CREATE TABLE IF NOT EXISTS opportunity_assignments (
          id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          opportunity_id        UUID NOT NULL REFERENCES network_opportunities(id) ON DELETE CASCADE,
          contractor_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          status                TEXT NOT NULL DEFAULT 'offered',
          assignment_type       TEXT DEFAULT 'marketplace',
          assignment_rank       INTEGER,
          match_score           NUMERIC(5,2),
          match_factors         JSONB DEFAULT '{}',
          offered_at            TIMESTAMPTZ DEFAULT NOW(),
          offer_expires_at      TIMESTAMPTZ,
          offer_ttl_hours       INTEGER DEFAULT 72,
          claimed_at            TIMESTAMPTZ,
          claim_amount          NUMERIC(10,2),
          claim_currency        TEXT DEFAULT 'USD',
          payment_intent_id     TEXT,
          payment_status        TEXT,
          first_viewed_at       TIMESTAMPTZ,
          last_viewed_at        TIMESTAMPTZ,
          view_count            INTEGER DEFAULT 0,
          contact_attempts      INTEGER DEFAULT 0,
          first_contact_at      TIMESTAMPTZ,
          last_contact_at       TIMESTAMPTZ,
          appointment_at        TIMESTAMPTZ,
          appointment_type      TEXT,
          appointment_confirmed BOOLEAN DEFAULT false,
          appointment_notes     TEXT,
          proposal_at           TIMESTAMPTZ,
          proposal_amount       NUMERIC(12,2),
          system_size_kw        NUMERIC(6,2),
          panel_brand           TEXT,
          inverter_brand        TEXT,
          warranty_years        INTEGER,
          financing_offered     TEXT,
          closed_at             TIMESTAMPTZ,
          close_status          TEXT,
          contract_value        NUMERIC(12,2),
          lost_reason           TEXT,
          lost_to               TEXT,
          dispute_filed_at      TIMESTAMPTZ,
          dispute_reason        TEXT,
          dispute_status        TEXT,
          refund_amount         NUMERIC(10,2),
          refund_at             TIMESTAMPTZ,
          refund_reason         TEXT,
          admin_notes           TEXT,
          flagged               BOOLEAN DEFAULT false,
          flag_reason           TEXT,
          quality_score         NUMERIC(5,2),
          notifications         JSONB DEFAULT '[]',
          created_at            TIMESTAMPTZ DEFAULT NOW(),
          updated_at            TIMESTAMPTZ DEFAULT NOW()
        )
      \`;
      results.push('✅ Migration 051a: opportunity_assignments table — ready');
    } catch (e: unknown) {
      results.push(\`⚠️ Migration 051a (opportunity_assignments): \${(e as Error).message}\`);
    }
    try {
      await sql\`CREATE INDEX IF NOT EXISTS idx_opp_assignments_opportunity_id ON opportunity_assignments(opportunity_id)\`;
      results.push('✅ Migration 051b: idx_opp_assignments_opportunity_id — ready');
    } catch (e: unknown) {
      results.push(\`⚠️ Migration 051b: \${(e as Error).message}\`);
    }
    try {
      await sql\`CREATE INDEX IF NOT EXISTS idx_opp_assignments_contractor_id ON opportunity_assignments(contractor_id)\`;
      results.push('✅ Migration 051c: idx_opp_assignments_contractor_id — ready');
    } catch (e: unknown) {
      results.push(\`⚠️ Migration 051c: \${(e as Error).message}\`);
    }
    try {
      await sql\`CREATE INDEX IF NOT EXISTS idx_opp_assignments_status ON opportunity_assignments(status)\`;
      results.push('✅ Migration 051d: idx_opp_assignments_status — ready');
    } catch (e: unknown) {
      results.push(\`⚠️ Migration 051d: \${(e as Error).message}\`);
    }
    try {
      await sql\`CREATE INDEX IF NOT EXISTS idx_opp_assignments_offered_at ON opportunity_assignments(offered_at DESC)\`;
      results.push('✅ Migration 051e: idx_opp_assignments_offered_at — ready');
    } catch (e: unknown) {
      results.push(\`⚠️ Migration 051e: \${(e as Error).message}\`);
    }

    // -- Migration 052: campaign_analytics ------------------------------------
    try {
      await sql\`
        CREATE TABLE IF NOT EXISTS campaign_analytics (
          id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          period_date             DATE NOT NULL,
          period_type             TEXT NOT NULL DEFAULT 'daily',
          source_type             TEXT NOT NULL,
          platform                TEXT,
          campaign_id             TEXT,
          campaign_name           TEXT,
          state                   TEXT,
          market                  TEXT,
          leads_received          INTEGER DEFAULT 0,
          leads_screened          INTEGER DEFAULT 0,
          leads_passed            INTEGER DEFAULT 0,
          leads_failed            INTEGER DEFAULT 0,
          leads_manual_review     INTEGER DEFAULT 0,
          leads_duplicate         INTEGER DEFAULT 0,
          leads_published         INTEGER DEFAULT 0,
          leads_viewed            INTEGER DEFAULT 0,
          leads_claimed           INTEGER DEFAULT 0,
          leads_contacted         INTEGER DEFAULT 0,
          leads_appointment       INTEGER DEFAULT 0,
          leads_proposal          INTEGER DEFAULT 0,
          leads_won               INTEGER DEFAULT 0,
          leads_lost              INTEGER DEFAULT 0,
          screen_pass_rate        NUMERIC(5,4),
          publish_rate            NUMERIC(5,4),
          claim_rate              NUMERIC(5,4),
          contact_rate            NUMERIC(5,4),
          appointment_rate        NUMERIC(5,4),
          proposal_rate           NUMERIC(5,4),
          close_rate              NUMERIC(5,4),
          overall_conversion      NUMERIC(5,4),
          total_spend             NUMERIC(12,2) DEFAULT 0,
          total_revenue           NUMERIC(12,2) DEFAULT 0,
          total_contract_value    NUMERIC(14,2) DEFAULT 0,
          cost_per_lead           NUMERIC(10,2),
          cost_per_qualified_lead NUMERIC(10,2),
          cost_per_claim          NUMERIC(10,2),
          cost_per_appointment    NUMERIC(10,2),
          cost_per_acquisition    NUMERIC(10,2),
          revenue_per_lead        NUMERIC(10,2),
          revenue_per_claim       NUMERIC(10,2),
          gross_margin            NUMERIC(12,2),
          roas                    NUMERIC(8,4),
          roi_pct                 NUMERIC(8,4),
          avg_opportunity_score   NUMERIC(5,2),
          avg_grade_distribution  JSONB DEFAULT '{}',
          disputes_filed          INTEGER DEFAULT 0,
          refunds_issued          INTEGER DEFAULT 0,
          refund_rate             NUMERIC(5,4),
          avg_time_to_claim_hours NUMERIC(8,2),
          avg_time_to_close_days  NUMERIC(8,2),
          top_states              JSONB DEFAULT '[]',
          top_markets             JSONB DEFAULT '[]',
          computed_at             TIMESTAMPTZ DEFAULT NOW(),
          is_partial              BOOLEAN DEFAULT false,
          notes                   TEXT,
          created_at              TIMESTAMPTZ DEFAULT NOW(),
          updated_at              TIMESTAMPTZ DEFAULT NOW()
        )
      \`;
      results.push('✅ Migration 052a: campaign_analytics table — ready');
    } catch (e: unknown) {
      results.push(\`⚠️ Migration 052a (campaign_analytics): \${(e as Error).message}\`);
    }
    try {
      await sql\`CREATE INDEX IF NOT EXISTS idx_campaign_analytics_period ON campaign_analytics(period_date DESC, period_type)\`;
      results.push('✅ Migration 052b: idx_campaign_analytics_period — ready');
    } catch (e: unknown) {
      results.push(\`⚠️ Migration 052b: \${(e as Error).message}\`);
    }
    try {
      await sql\`CREATE INDEX IF NOT EXISTS idx_campaign_analytics_source ON campaign_analytics(source_type, platform)\`;
      results.push('✅ Migration 052c: idx_campaign_analytics_source — ready');
    } catch (e: unknown) {
      results.push(\`⚠️ Migration 052c: \${(e as Error).message}\`);
    }

    // -- Migration 053: network_events (immutable event log) ------------------
    try {
      await sql\`
        CREATE TABLE IF NOT EXISTS network_events (
          id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          event_id              TEXT UNIQUE,
          event_type            TEXT NOT NULL,
          event_category        TEXT NOT NULL,
          opportunity_id        UUID REFERENCES network_opportunities(id) ON DELETE SET NULL,
          assignment_id         UUID REFERENCES opportunity_assignments(id) ON DELETE SET NULL,
          contractor_id         UUID REFERENCES users(id) ON DELETE SET NULL,
          admin_user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
          data                  JSONB NOT NULL DEFAULT '{}',
          from_status           TEXT,
          to_status             TEXT,
          score_at_event        NUMERIC(5,2),
          grade_at_event        TEXT,
          triggered_by          TEXT NOT NULL DEFAULT 'system',
          ip_address            INET,
          user_agent            TEXT,
          session_id            TEXT,
          is_error              BOOLEAN DEFAULT false,
          error_code            TEXT,
          error_message         TEXT,
          error_details         JSONB DEFAULT '{}',
          occurred_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          created_at            TIMESTAMPTZ DEFAULT NOW()
        )
      \`;
      results.push('✅ Migration 053a: network_events table — ready');
    } catch (e: unknown) {
      results.push(\`⚠️ Migration 053a (network_events): \${(e as Error).message}\`);
    }
    try {
      await sql\`CREATE INDEX IF NOT EXISTS idx_network_events_opportunity_id ON network_events(opportunity_id) WHERE opportunity_id IS NOT NULL\`;
      results.push('✅ Migration 053b: idx_network_events_opportunity_id — ready');
    } catch (e: unknown) {
      results.push(\`⚠️ Migration 053b: \${(e as Error).message}\`);
    }
    try {
      await sql\`CREATE INDEX IF NOT EXISTS idx_network_events_assignment_id ON network_events(assignment_id) WHERE assignment_id IS NOT NULL\`;
      results.push('✅ Migration 053c: idx_network_events_assignment_id — ready');
    } catch (e: unknown) {
      results.push(\`⚠️ Migration 053c: \${(e as Error).message}\`);
    }
    try {
      await sql\`CREATE INDEX IF NOT EXISTS idx_network_events_contractor_id ON network_events(contractor_id) WHERE contractor_id IS NOT NULL\`;
      results.push('✅ Migration 053d: idx_network_events_contractor_id — ready');
    } catch (e: unknown) {
      results.push(\`⚠️ Migration 053d: \${(e as Error).message}\`);
    }
    try {
      await sql\`CREATE INDEX IF NOT EXISTS idx_network_events_event_type ON network_events(event_type)\`;
      results.push('✅ Migration 053e: idx_network_events_event_type — ready');
    } catch (e: unknown) {
      results.push(\`⚠️ Migration 053e: \${(e as Error).message}\`);
    }
    try {
      await sql\`CREATE INDEX IF NOT EXISTS idx_network_events_occurred_at ON network_events(occurred_at DESC)\`;
      results.push('✅ Migration 053f: idx_network_events_occurred_at — ready');
    } catch (e: unknown) {
      results.push(\`⚠️ Migration 053f: \${(e as Error).message}\`);
    }
    try {
      await sql\`CREATE INDEX IF NOT EXISTS idx_network_events_errors ON network_events(occurred_at DESC) WHERE is_error = true\`;
      results.push('✅ Migration 053g: idx_network_events_errors — ready');
    } catch (e: unknown) {
      results.push(\`⚠️ Migration 053g: \${(e as Error).message}\`);
    }

    return NextResponse.json({ success: true, results });"""

with open(ROUTE_PATH, 'r') as f:
    content = f.read()

if MARKER not in content:
    print(f"ERROR: Marker not found: {MARKER}")
    exit(1)

count = content.count(MARKER)
if count != 1:
    print(f"ERROR: Marker appears {count} times (expected 1)")
    exit(1)

# Replace the marker with the injected code (which ends with the return statement)
new_content = content.replace(MARKER, INJECTION.strip())

with open(ROUTE_PATH, 'w') as f:
    f.write(new_content)

print(f"✅ Injected migrations 047-053 into {ROUTE_PATH}")
print(f"   Original length: {len(content)} chars")
print(f"   New length: {len(new_content)} chars")
