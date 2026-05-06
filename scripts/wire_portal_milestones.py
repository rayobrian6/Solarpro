#!/usr/bin/env python3
"""
Wire micro stages + milestone feed + document checklist into portal dashboard page.
Targeted replacements — does NOT rewrite the whole file.
"""

import sys

fpath = "app/portal/dashboard/page.tsx"

with open(fpath, "r", encoding="utf-8") as f:
    src = f.read()

# ── 1. Add Activity to lucide imports ────────────────────────────────────────
old_imports = """  Sun, MapPin, LogOut, RefreshCw,
  CheckCircle2, Circle, Clock,
  Phone, Mail, AlertCircle, Zap,
  TrendingUp, Home, BarChart3,
  FileCheck,"""
new_imports = """  Sun, MapPin, LogOut, RefreshCw,
  CheckCircle2, Circle, Clock,
  Phone, Mail, AlertCircle, Zap,
  TrendingUp, Home, BarChart3,
  FileCheck, Activity,"""

if old_imports not in src:
    print("ERROR: lucide imports not found")
    sys.exit(1)
src = src.replace(old_imports, new_imports, 1)
print("OK: Added Activity to lucide imports")

# ── 2. Add MicroStageEvent interface after PortalDocument ────────────────────
old_interface_end = """interface Client {
  id: string;
  name: string;
  email: string;"""
new_interface_end = """interface MicroStageEvent {
  project_id: string;
  micro_stage: string;
  created_at: string;
}

interface Client {
  id: string;
  name: string;
  email: string;"""

if old_interface_end not in src:
    print("ERROR: Client interface anchor not found")
    sys.exit(1)
src = src.replace(old_interface_end, new_interface_end, 1)
print("OK: Added MicroStageEvent interface")

# ── 3. Add micro stage meta + STAGE_MICRO_MAP + STAGE_EXPECTED_DOCS constants
# Insert before the STAGE_CONTENT const
old_stage_content_anchor = "const STAGE_CONTENT: Record<HomeownerStage, StageContent> = {"
new_stage_content_anchor = """// ─── Micro stage display config ───────────────────────────────────────────────

const MICRO_STAGE_META: Record<string, { label: string; icon: string }> = {
  lead_created:             { label: 'Lead Created',           icon: '📋' },
  project_created:          { label: 'Project Created',        icon: '🏗️' },
  bill_uploaded:            { label: 'Utility Bill Uploaded',  icon: '📄' },
  bill_parsed:              { label: 'Bill Analyzed',          icon: '🔬' },
  usage_calculated:         { label: 'Usage Calculated',       icon: '📊' },
  pre_design_complete:      { label: 'Pre-Design Complete',    icon: '✅' },
  survey_scheduled:         { label: 'Survey Scheduled',       icon: '📅' },
  survey_started:           { label: 'Survey Started',         icon: '🚗' },
  survey_photos_uploaded:   { label: 'Photos Uploaded',        icon: '📸' },
  survey_submitted:         { label: 'Survey Submitted',       icon: '📤' },
  survey_reviewed:          { label: 'Survey Reviewed',        icon: '✅' },
  layout_started:           { label: 'Layout Started',         icon: '📐' },
  layout_completed:         { label: 'Layout Completed',       icon: '✅' },
  engineering_started:      { label: 'Engineering Started',    icon: '⚙️' },
  engineering_completed:    { label: 'Engineering Completed',  icon: '✅' },
  sld_generated:            { label: 'SLD Generated',          icon: '🗂️' },
  planset_generated:        { label: 'Plan Set Generated',     icon: '📑' },
  final_proposal_generated: { label: 'Proposal Generated',    icon: '📄' },
  proposal_sent:            { label: 'Proposal Sent',          icon: '📨' },
  proposal_viewed:          { label: 'Proposal Viewed',        icon: '👁️' },
  proposal_approved:        { label: 'Proposal Approved',      icon: '✅' },
  contract_sent:            { label: 'Contract Sent',          icon: '📬' },
  contract_viewed:          { label: 'Contract Viewed',        icon: '👁️' },
  contract_signed:          { label: 'Contract Signed',        icon: '✍️' },
  permit_submitted:         { label: 'Permit Submitted',       icon: '📋' },
  permit_approved:          { label: 'Permit Approved',        icon: '✅' },
  install_scheduled:        { label: 'Install Scheduled',      icon: '📅' },
  install_started:          { label: 'Installation Started',   icon: '🔧' },
  install_completed:        { label: 'Installation Completed', icon: '🏠' },
  inspection_passed:        { label: 'Inspection Passed',      icon: '✅' },
  pto_submitted:            { label: 'PTO Submitted',          icon: '📤' },
  pto_approved:             { label: 'PTO Approved',           icon: '⚡' },
  system_live:              { label: 'System Live',            icon: '🌟' },
  monitoring_active:        { label: 'Monitoring Active',      icon: '📡' },
};

const STAGE_MICRO_MAP: Record<HomeownerStage, string[]> = {
  lead_submitted: ['lead_created', 'project_created'],
  under_review:   ['bill_uploaded', 'bill_parsed', 'usage_calculated', 'pre_design_complete'],
  site_survey:    ['survey_scheduled', 'survey_started', 'survey_photos_uploaded', 'survey_submitted', 'survey_reviewed'],
  design:         ['layout_started', 'layout_completed', 'engineering_started', 'engineering_completed', 'sld_generated', 'planset_generated'],
  proposal:       ['final_proposal_generated', 'proposal_sent', 'proposal_viewed', 'proposal_approved', 'contract_sent', 'contract_viewed', 'contract_signed'],
  installation:   ['permit_submitted', 'permit_approved', 'install_scheduled', 'install_started', 'install_completed', 'inspection_passed', 'pto_submitted', 'pto_approved'],
  completed:      ['system_live', 'monitoring_active'],
};

const STAGE_EXPECTED_DOCS: Record<HomeownerStage, string[]> = {
  lead_submitted: [],
  under_review:   ['Utility Bill'],
  site_survey:    ['Site Survey', 'Roof Photos'],
  design:         ['Plan Set'],
  proposal:       ['Proposal', 'Contract'],
  installation:   ['Permit'],
  completed:      [],
};

const ROADMAP_STEPS_ALL: HomeownerStage[] = [
  'lead_submitted', 'under_review', 'site_survey', 'design',
  'proposal', 'installation', 'completed',
];

const STAGE_CONTENT: Record<HomeownerStage, StageContent> = {"""

if old_stage_content_anchor not in src:
    print("ERROR: STAGE_CONTENT anchor not found")
    sys.exit(1)
src = src.replace(old_stage_content_anchor, new_stage_content_anchor, 1)
print("OK: Added micro stage meta + maps before STAGE_CONTENT")

# ── 4. Add microStages state after documents state ───────────────────────────
old_state = "  const [documents,     setDocuments]     = useState<PortalDocument[]>([]);"
new_state = """  const [documents,     setDocuments]     = useState<PortalDocument[]>([]);
  const [microStages,   setMicroStages]   = useState<MicroStageEvent[]>([]);"""

if old_state not in src:
    print("ERROR: documents state not found")
    sys.exit(1)
src = src.replace(old_state, new_state, 1)
print("OK: Added microStages state")

# ── 5. Wire setMicroStages in load() after setDocuments ─────────────────────
old_setdocs = "      setDocuments(d.documents ?? []);"
new_setdocs = """      setDocuments(d.documents ?? []);
      setMicroStages(d.microStages ?? []);"""

if old_setdocs not in src:
    print("ERROR: setDocuments line not found")
    sys.exit(1)
src = src.replace(old_setdocs, new_setdocs, 1)
print("OK: Wired setMicroStages in load()")

with open(fpath, "w", encoding="utf-8") as f:
    f.write(src)
print("OK: File written (phase 1 — data layer)")
print("INFO: Phase 2 (UI rendering) will be done next")