-- ============================================
-- SolarDog Knowledge Base Schema + Seed
-- Populates solarpro_knowledge_items with:
-- - All pages and their routes
-- - All buttons and what they do
-- - All workflows
-- - All key equipment brands/features
-- ============================================

-- Create the table if it doesn't exist
CREATE TABLE IF NOT EXISTS solarpro_knowledge_items (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL,              -- 'page', 'button', 'workflow', 'warning', 'equipment', 'mode', 'workflow'
  label TEXT NOT NULL,             -- Display name
  route TEXT,                      -- URL route (for pages/buttons), nullable
  description TEXT NOT NULL,       -- What it does / explanation
  aliases TEXT[],                  -- Alternative names the user might say
  user_id TEXT,                    -- NULL = global (available to all users)
  is_global BOOLEAN DEFAULT FALSE, -- TRUE = available to all users
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Clear existing data (safe to re-run)
TRUNCATE TABLE solarpro_knowledge_items CASCADE;

-- ============================================
-- PAGES
-- ============================================

INSERT INTO solarpro_knowledge_items (type, label, route, description, aliases, is_global) VALUES
('page', 'Dashboard', '/dashboard', 'Main dashboard showing project pipeline, key metrics, and quick actions', ARRAY['home', 'projects'], TRUE),
('page', 'Engineering', '/engineering', 'System design page for panel layout, string sizing, inverter selection, and NEC validation', ARRAY['system design', 'stringing', 'layout', 'validation'], TRUE),
('page', 'Proposals', '/proposals', 'Financial proposal creation with offset, savings, ROI, and PDF generation', ARRAY['proposals', 'financials'], TRUE),
('page', 'Plan Sets', '/plansets', 'Permit plan set generator with single-line diagrams, panel layout, and compliance docs', ARRAY['permit', 'sld', 'plan set'], TRUE),
('page', 'Projects', '/projects', 'Project list and management view', ARRAY['projects list'], TRUE),
('page', 'Clients', '/clients', 'Client management and lead intake', ARRAY['customers', 'leads'], TRUE),
('page', 'Settings', '/settings', 'Organization settings, branding, pricing config', ARRAY['config'], TRUE);

-- ============================================
-- ENGINEERING PAGE - MAIN BUTTONS
-- ============================================

INSERT INTO solarpro_knowledge_items (type, label, route, description, aliases, is_global) VALUES
('button', 'Apply Recommended Configuration', '/engineering', 'Applies the auto-config engine''s calculated optimal system: panels, inverter, battery, strings', ARRAY['auto config', 'recommended', 'fix system'], TRUE),
('button', 'Generate SLD', '/engineering', 'Creates a single-line diagram showing electrical topology and connections', ARRAY['single line diagram', 'sld', 'topology'], TRUE),
('button', 'Generate BOM', '/engineering', 'Creates a bill of materials with all equipment needed for the system', ARRAY['bill of materials', 'equipment list'], TRUE),
('button', 'Get to Pass', '/engineering', 'Auto-fixes common compliance issues to get system validation passing', ARRAY['auto fix', 'fix warnings', 'validate'], TRUE),
('button', 'Run NEC Validation', '/engineering', 'Runs full NEC 690.7/690.8/705.12 compliance check on current system', ARRAY['validate', 'check compliance', 'nec check'], TRUE),
('button', 'Auto Fix String', '/engineering', 'Automatically adjusts string sizing to fix voltage/current limits', ARRAY['fix strings', 'auto string'], TRUE),
('button', 'Auto Fix Wire', '/engineering', 'Automatically calculates and sets wire sizes for all circuits', ARRAY['fix wire', 'wire sizing'], TRUE),
('button', 'Flag for Review', '/engineering', 'Flags the project for engineer review', ARRAY['flag', 'request review', 'review'], TRUE);

-- ============================================
-- ENGINEERING PAGE - CONTROL MODES
-- ============================================

INSERT INTO solarpro_knowledge_items (type, label, route, description, aliases, is_global) VALUES
('workflow', 'Auto Mode', '/engineering', 'Engine automatically applies recommended config. User edits disable mode.', ARRAY['auto mode', 'automatic'], TRUE),
('workflow', 'Guided Mode', '/engineering', 'Engine suggests updates but waits for user approval. Field locking available.', ARRAY['guided'], TRUE),
('workflow', 'Manual Mode', '/engineering', 'Fully manual. Engine provides read-only recommendations.', ARRAY['manual mode', 'manual'], TRUE);

-- ============================================
-- ENGINEERING PAGE - DISPLAY MODES
-- ============================================

INSERT INTO solarpro_knowledge_items (type, label, route, description, aliases, is_global) VALUES
('mode', 'Panel Count Mode', '/engineering', 'Enter total panels, engine calculates layout and strings', ARRAY['panel mode'], TRUE),
('mode', 'Area Mode', '/engineering', 'Draw roof area, engine maximizes panel fit within constraints', ARRAY['area mode', 'roof drawing'], TRUE),
('mode', 'String Mode', '/engineering', 'Manually define strings per MPPT', ARRAY['string mode', 'manual strings'], TRUE),
('mode', 'Rapid Sizing', '/engineering', 'Quick input panel/orientation count, engine auto-completes rest', ARRAY['rapid mode', 'quick'], TRUE);

-- ============================================
-- PROPOSALS PAGE
-- ============================================

INSERT INTO solarpro_knowledge_items (type, label, route, description, aliases, is_global) VALUES
('button', 'Generate Proposal', '/proposals', 'Creates full financial proposal with offset, savings, cash flow, and ROI', ARRAY['create proposal', 'proposal pdf'], TRUE),
('button', 'Update Utility Rates', '/proposals', 'Updates utility rate data for more accurate savings calculations', ARRAY['utility rates', 'rates'], TRUE),
('button', 'Preview Proposal', '/proposals', 'Shows proposal preview before generation', ARRAY['review proposal', 'preview'], TRUE);

-- ============================================
-- PLAN SETS PAGE
-- ============================================

INSERT INTO solarpro_knowledge_items (type, label, route, description, aliases, is_global) VALUES
('button', 'Generate Plan Set', '/plansets', 'Creates full permit package:封面, SLD, panel layout, equipment schedules, compliance calc', ARRAY['permit package', 'permit set'], TRUE),
('button', 'Download PDF', '/plansets', 'Downloads generated plan set as PDF', ARRAY['download'], TRUE);

-- ============================================
-- WARNING TYPES
-- ============================================

INSERT INTO solarpro_knowledge_items (type, label, description, aliases, is_global) VALUES
('warning', 'STRING_VOC_VOLTAGE_CLAMP', 'System exceeds inverter max voltage at cold temps. Reduce panels per string or select higher-voltage inverter.', ARRAY['voc clamp', 'over voltage', 'voltage limit'], TRUE),
('warning', 'STRING_OVERCURRENT', 'String current exceeds MPPT max current.', ARRAY['over current', 'current limit'], TRUE),
('warning', 'DC_AC_RATIO_HIGH', 'DC-to-AC ratio above 1.3 — some power clipping expected. Normal for oversizing, but check if acceptable.', ARRAY['clipping', 'oversizing'], TRUE),
('warning', 'STRING_IMBALANCE', 'Strings have mismatched panel counts. Check if intentional or fix to optimize.', ARRAY['string mismatch', 'imbalance'], TRUE),
('warning', 'INVERTER_OVERLOAD_RISK', 'Total DC power exceeds inverter capacity. Consider adding another inverter.', ARRAY['inverter overload'], TRUE),
('warning', 'BATTERY_OVERSIZE', 'Battery storage oversized for system load.', ARRAY['battery size', 'oversize battery'], TRUE);

-- ============================================
-- KEY EQUIPMENT BRANDS
-- ============================================

INSERT INTO solarpro_knowledge_items (type, label, description, is_global) VALUES
('equipment', 'Jinko Solar', 'Common 440W+ residential panels, TOPCon N-type, 30-year warranty', TRUE),
('equipment', 'SunPower', 'Premium efficiency panels, maxeon cells, 25-year warranty', TRUE),
('equipment', 'SMA', 'German inverters, known for reliability and 10-year warranty', TRUE),
('equipment', 'Solaredge', 'Power optimizer-based inverters, module-level monitoring', TRUE),
('equipment', 'Enphase', 'Microinverter system, module-level MPPT, good for complex roofs', TRUE),
('equipment', 'EcoFlow', 'Hybrid inverters with built-in battery management, good for backup systems', TRUE),
('equipment', 'Tesla Powerwall', '13.5kWh battery, wall-mounted storage', TRUE),
('equipment', 'LG Chem RESU', 'Home battery solutions, various sizes', TRUE),
('equipment', 'SolarEdge Power Optimizer', 'Module-level power electronics for SolarEdge systems', TRUE),
('equipment', 'IronRidge', 'Racking system, roof attachments, rails', TRUE),
('equipment', 'QuickMount PV', 'Flashing and mounting hardware', TRUE);

-- ============================================
-- COMMON WORKFLOWS (PASSES)
-- ============================================

INSERT INTO solarpro_knowledge_items (type, label, route, description, aliases, is_global) VALUES
('workflow', 'Pass Engineering', '/engineering', 'Get system from any state to compliance-passing. Steps: 1) Apply recommended config, 2) Run NEC validation, 3) Fix any remaining warnings, 4) Generate SLD/BOM', ARRAY['get to pass', 'compliance', 'pass validation'], TRUE),
('workflow', 'New System Design', '/engineering', 'Start from scratch on a new system. Steps: 1) Select panel and inverter, 2) Enter panel count or draw area, 3) Auto-string, 4) Validate', ARRAY['new design', 'start fresh'], TRUE),
('workflow', 'Create Proposal', '/proposals', 'Generate customer-facing financial proposal. Steps: 1) Verify system is compliant, 2) Update utility rates, 3) Generate proposal PDF', ARRAY['proposal workflow'], TRUE),
('workflow', 'Generate Permit Set', '/plansets', 'Create permit-ready documentation. Steps: 1) Confirm SLD is generated, 2) Verify panel layout, 3) Generate plan set, 4) Download PDF', ARRAY['permit workflow'], TRUE);

-- ============================================
-- COMPLETED
-- ============================================

SELECT COUNT(*) as knowledge_items_count FROM solarpro_knowledge_items;