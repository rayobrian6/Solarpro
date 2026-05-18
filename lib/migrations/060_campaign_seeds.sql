-- Migration 060: Seed intake funnels and acquisition campaigns
-- Adds platform-specific intake funnels and 4 starter acquisition campaigns.
-- All inserts use ON CONFLICT DO NOTHING — safe to re-run.

-- ── Additional intake funnels (platform-specific) ─────────────────────────────

INSERT INTO intake_funnels (
  slug, name, description, funnel_type, source_channel,
  require_phone, require_address, require_monthly_bill, require_roof_type,
  rate_limit_per_hour
) VALUES
  (
    'google-lead-form',
    'Google Lead Form',
    'Leads captured via Google Ads Lead Form Extensions. Pre-filled from Google profile.',
    'lead_gen',
    'google_ads',
    true, false, false, false,
    500
  ),
  (
    'meta-lead-ad',
    'Meta Lead Ad',
    'Leads from Facebook and Instagram Lead Ads. Auto-filled from Meta profile.',
    'lead_gen',
    'facebook_ads',
    true, false, false, false,
    500
  ),
  (
    'tiktok-lead-gen',
    'TikTok Lead Generation',
    'Leads from TikTok Lead Generation campaigns targeting homeowners.',
    'lead_gen',
    'tiktok',
    true, false, false, false,
    200
  ),
  (
    'organic-estimate',
    'Organic Solar Estimate',
    'SEO-driven estimate requests from blog posts and landing pages.',
    'lead_gen',
    'seo',
    false, false, false, false,
    100
  ),
  (
    'referral-link',
    'Contractor Referral',
    'Homeowner referrals submitted by existing SolarPro contractors.',
    'lead_gen',
    'referral',
    true, true, false, false,
    50
  )
ON CONFLICT (slug) DO NOTHING;

-- ── Acquisition campaigns ─────────────────────────────────────────────────────

INSERT INTO acquisition_campaigns (
  name, description, campaign_type, status, platform,
  daily_budget_cents, monthly_budget_cents, total_budget_cents,
  cost_per_lead_target_cents, leads_target,
  utm_source, utm_medium, utm_campaign, utm_content, utm_term,
  geo_targeting, audience_targeting,
  notes
) VALUES
  (
    'Google — Solar Savings Search',
    'High-intent search campaign targeting homeowners actively searching for solar quotes and savings estimates.',
    'paid_search',
    'draft',
    'google_ads',
    5000,       -- $50/day
    150000,     -- $1,500/month
    NULL,
    2500,       -- $25 CPL target
    60,         -- 60 leads/month
    'google',
    'cpc',
    'solar-savings-search',
    'search-text-ad',
    'solar+quotes+near+me',
    '{"countries": ["US"], "states": ["CA","TX","FL","AZ","NC","NY","NJ","CO","GA","VA"], "radius_miles": null}',
    '{"homeowners": true, "age_range": "30-65", "income_bracket": "75k_plus", "interests": ["home_improvement","energy","sustainability"]}',
    'Primary Google Search campaign. Focus on bottom-of-funnel keywords: "solar quotes", "solar panel cost", "best solar companies near me". Use responsive search ads with 15 headlines / 4 descriptions. Enable lead form extensions.'
  ),
  (
    'Meta — Homeowner Solar Lead Ad',
    'Facebook and Instagram Lead Ad campaign targeting homeowners in high-solar-potential states.',
    'paid_social',
    'draft',
    'meta',
    3000,       -- $30/day
    90000,      -- $900/month
    NULL,
    3000,       -- $30 CPL target
    30,
    'facebook',
    'paid_social',
    'homeowner-solar-lead-ad',
    'lead-ad-v1',
    NULL,
    '{"countries": ["US"], "states": ["CA","TX","FL","AZ","NC","NJ","CO"], "exclude_renters": true}',
    '{"homeowners": true, "age_range": "28-60", "income_bracket": "65k_plus", "life_events": ["recently_moved","new_homeowner"], "interests": ["solar_energy","home_improvement","electric_vehicles","green_living"]}',
    'Meta Lead Ad using instant form. 3 questions: monthly electric bill, roof age, timeline to go solar. Use Lookalike Audience (1%) seeded from existing converted customers. Creative: before/after utility bill savings. Test carousel vs single image.'
  ),
  (
    'TikTok — Solar Awareness & Lead Gen',
    'TikTok In-Feed Lead Generation campaign targeting younger homeowners and first-time home buyers.',
    'paid_social',
    'draft',
    'tiktok',
    2000,       -- $20/day
    60000,      -- $600/month
    NULL,
    4000,       -- $40 CPL target
    15,
    'tiktok',
    'paid_social',
    'solar-awareness-lead-gen',
    'infeed-video-v1',
    NULL,
    '{"countries": ["US"], "states": ["CA","TX","FL","AZ","NC"], "dma_targeting": true}',
    '{"age_range": "25-45", "interests": ["home_improvement","sustainability","technology","personal_finance"], "behaviors": ["homeowner_signals","high_spend_capacity"]}',
    'TikTok In-Feed video + Lead Generation form. 15-30 second video hook: show dramatic utility bill vs $0 solar bill. CTA: "Get your free solar savings estimate." Test UGC-style vs polished video creative.'
  ),
  (
    'SEO — Organic Solar Content',
    'Content-driven organic lead generation via solar education blog posts, guides, and calculator landing pages.',
    'seo',
    'active',
    'organic',
    0,          -- no ad spend
    0,
    NULL,
    500,        -- $5 CPL target (content/ops cost only)
    20,
    'solarpro',
    'organic',
    'solar-education-content',
    'blog-calculator',
    NULL,
    '{"countries": ["US"], "national": true}',
    '{"intent": ["informational","commercial_investigation"], "keywords": ["how much do solar panels cost","solar panel roi calculator","best solar companies","solar incentives 2024"]}',
    'SEO content strategy: publish 2 articles/week targeting solar cost, savings, and incentive keywords. Build internal links to estimate calculator funnels. Track via UTM on all CTA buttons in content.'
  )
ON CONFLICT DO NOTHING;
