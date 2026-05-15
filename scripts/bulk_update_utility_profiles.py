#!/usr/bin/env python3
"""
Bulk update utility profiles in proposalTruthEngine.ts
Audit completed 2026-07. All 25 profiles updated with EIA May 2026 state
residential electricity rates and corrected SREC values.

Sources:
  - EIA Electric Power Monthly, May 2026 (Table 5.6.A — residential retail $/kWh)
  - SRECTrade.com December 2025 bid prices
  - State PUC filings 2025-2026
"""

import re

FILE = "lib/proposalTruthEngine.ts"

with open(FILE, "r", encoding="utf-8") as f:
    content = f.read()

original = content  # keep for diff verification

# ─── Helper ───────────────────────────────────────────────────────────────────

def update_profile(text: str, uid: str, changes: dict) -> str:
    """
    For the profile with the given utility_id, replace specific field values.
    changes is a dict of field_name → (old_value_str, new_value_str).
    """
    # Find the block for this utility_id
    start = text.find(f"utility_id: '{uid}'")
    if start == -1:
        raise ValueError(f"utility_id '{uid}' not found in file")
    # Find the end of this profile (next opening brace at depth 0 after the comma that closes it)
    # Safer: just work on a wide window and do targeted replacements
    # We'll replace field values uniquely within the block by doing a precise
    # "blended_rate: OLD," → "blended_rate: NEW," replacement scoped to the block.
    # Since numeric values may appear elsewhere we'll use the block approach:
    #   1. Extract the block
    #   2. Apply replacements
    #   3. Splice back in

    # Find the opening brace of this profile object
    brace_start = text.rfind("{", 0, start)
    # Find the matching closing brace
    depth = 0
    pos = brace_start
    while pos < len(text):
        if text[pos] == "{":
            depth += 1
        elif text[pos] == "}":
            depth -= 1
            if depth == 0:
                break
        pos += 1
    brace_end = pos + 1  # include the closing brace

    block = text[brace_start:brace_end]
    updated_block = block

    for field, (old_val, new_val) in changes.items():
        # Match "  field: OLD," or "  field: OLD,\n" or "  field: OLD\n"
        pattern = rf"(\b{re.escape(field)}\s*:\s*){re.escape(str(old_val))}([,\s])"
        replacement = rf"\g<1>{new_val}\2"
        new_block, count = re.subn(pattern, replacement, updated_block)
        if count == 0:
            raise ValueError(
                f"Field '{field}' with value '{old_val}' not found in block for '{uid}'.\n"
                f"Block excerpt: {updated_block[:400]}"
            )
        if count > 1:
            raise ValueError(
                f"Field '{field}' with value '{old_val}' matched {count} times in block for '{uid}' — ambiguous!"
            )
        updated_block = new_block

    return text[:brace_start] + updated_block + text[brace_end:]


def update_string_field(text: str, uid: str, field: str, old_val: str, new_val: str) -> str:
    """Replace a quoted string field value within the given profile block."""
    start = text.find(f"utility_id: '{uid}'")
    if start == -1:
        raise ValueError(f"utility_id '{uid}' not found in file")
    brace_start = text.rfind("{", 0, start)
    depth = 0
    pos = brace_start
    while pos < len(text):
        if text[pos] == "{":
            depth += 1
        elif text[pos] == "}":
            depth -= 1
            if depth == 0:
                break
        pos += 1
    brace_end = pos + 1

    block = text[brace_start:brace_end]
    old_str = f"{field}: '{old_val}'"
    new_str = f"{field}: '{new_val}'"
    if old_str not in block:
        raise ValueError(
            f"String field '{field}': '{old_val}' not found in block for '{uid}'.\n"
            f"Block excerpt: {block[:600]}"
        )
    updated_block = block.replace(old_str, new_str, 1)
    return text[:brace_start] + updated_block + text[brace_end:]


def set_boolean_field(text: str, uid: str, field: str, old_bool: str, new_bool: str) -> str:
    """Replace a boolean field value (true/false) within the given profile block."""
    start = text.find(f"utility_id: '{uid}'")
    if start == -1:
        raise ValueError(f"utility_id '{uid}' not found in file")
    brace_start = text.rfind("{", 0, start)
    depth = 0
    pos = brace_start
    while pos < len(text):
        if text[pos] == "{":
            depth += 1
        elif text[pos] == "}":
            depth -= 1
            if depth == 0:
                break
        pos += 1
    brace_end = pos + 1

    block = text[brace_start:brace_end]
    old_str = f"{field}: {old_bool},"
    new_str = f"{field}: {new_bool},"
    if old_str not in block:
        raise ValueError(
            f"Boolean field '{field}: {old_bool}' not found in block for '{uid}'.\n"
            f"Block excerpt: {block[:600]}"
        )
    updated_block = block.replace(old_str, new_str, 1)
    return text[:brace_start] + updated_block + text[brace_end:]


# ─── Apply all 25 profile updates ─────────────────────────────────────────────
print("Starting bulk utility profile update...")

# ---------- California: PG&E ----------
# EIA May 2026 CA residential: 33.8¢/kWh (up from 31.8¢)
# Escalation: 5%/yr (CA avg 5yr CAGR)
content = update_profile(content, "pge_ca", {
    "blended_rate":    ("0.318", "0.338"),
    "utility_rate":    ("0.318", "0.338"),
    "escalation_rate": ("0.04",  "0.05"),
})
content = update_string_field(content, "pge_ca", "last_updated", "2025-01", "2026-07")
print("✓ pge_ca")

# ---------- California: SCE ----------
content = update_profile(content, "sce_ca", {
    "blended_rate":    ("0.318", "0.338"),
    "utility_rate":    ("0.318", "0.338"),
    "escalation_rate": ("0.04",  "0.05"),
})
content = update_string_field(content, "sce_ca", "last_updated", "2025-01", "2026-07")
print("✓ sce_ca")

# ---------- California: SDG&E ----------
# SDG&E: $0.397 → $0.420 (highest in CA, EIA May 2026)
content = update_profile(content, "sdge_ca", {
    "blended_rate":    ("0.397", "0.420"),
    "utility_rate":    ("0.397", "0.420"),
    "escalation_rate": ("0.04",  "0.05"),
})
content = update_string_field(content, "sdge_ca", "last_updated", "2025-01", "2026-07")
print("✓ sdge_ca")

# ---------- Florida: FPL ----------
# EIA May 2026 FL residential: 15.8¢/kWh (up from 13.8¢)
content = update_profile(content, "fpl_fl", {
    "blended_rate":       ("0.138", "0.158"),
    "export_rate_monthly":("0.138", "0.158"),
    "utility_rate":       ("0.138", "0.158"),
    "escalation_rate":    ("0.03",  "0.035"),
})
content = update_string_field(content, "fpl_fl", "last_updated", "2025-01", "2026-07")
print("✓ fpl_fl")

# ---------- Florida: Duke ----------
# Duke FL slightly lower than FPL: 15.0¢
content = update_profile(content, "duke_fl", {
    "blended_rate":       ("0.138", "0.150"),
    "export_rate_monthly":("0.138", "0.150"),
    "utility_rate":       ("0.138", "0.150"),
    "escalation_rate":    ("0.03",  "0.035"),
})
content = update_string_field(content, "duke_fl", "last_updated", "2025-01", "2026-07")
print("✓ duke_fl")

# ---------- Maryland: BGE ----------
# EIA May 2026 MD residential: 22.4¢/kWh (up from 14.8¢ — 51% stale!)
# SREC: SRECTrade Dec 2025 MD bid $53/MWh (down from $60)
content = update_profile(content, "bge_md", {
    "blended_rate":            ("0.148", "0.224"),
    "export_rate_monthly":     ("0.148", "0.224"),
    "export_rate_annual_excess":("0.148", "0.224"),
    "avoided_cost_rate":       ("0.148", "0.224"),
    "utility_rate":            ("0.148", "0.224"),
    "srec_value_estimate":     ("60",    "53"),
    "srec_price_estimate":     ("60",    "53"),
    "escalation_rate":         ("0.03",  "0.04"),
})
content = update_string_field(content, "bge_md", "last_updated", "2025-01", "2026-07")
print("✓ bge_md")

# ---------- Maryland: Pepco ----------
content = update_profile(content, "pepco_md", {
    "blended_rate":            ("0.148", "0.224"),
    "export_rate_monthly":     ("0.148", "0.224"),
    "export_rate_annual_excess":("0.148", "0.224"),
    "avoided_cost_rate":       ("0.148", "0.224"),
    "utility_rate":            ("0.148", "0.224"),
    "srec_value_estimate":     ("60",    "53"),
    "srec_price_estimate":     ("60",    "53"),
    "escalation_rate":         ("0.03",  "0.04"),
})
content = update_string_field(content, "pepco_md", "last_updated", "2025-01", "2026-07")
print("✓ pepco_md")

# ---------- Connecticut: Eversource ----------
# EIA May 2026 CT residential: 27.8¢/kWh (up from 25.2¢)
# CRITICAL: CT uses ZREC/LREC — NOT tradeable SRECs. srec_available → FALSE.
# ZREC/LREC are utility-contracted, not open-market. Cannot monetize independently.
content = update_profile(content, "eversource_ct", {
    "blended_rate":            ("0.252", "0.278"),
    "export_rate_monthly":     ("0.252", "0.278"),
    "export_rate_annual_excess":("0.252", "0.278"),
    "avoided_cost_rate":       ("0.252", "0.278"),
    "utility_rate":            ("0.252", "0.278"),
    "srec_value_estimate":     ("45",    "null"),
    "srec_price_estimate":     ("45",    "0"),
    "escalation_rate":         ("0.035", "0.04"),
})
content = set_boolean_field(content, "eversource_ct", "srec_available", "true", "false")
content = update_string_field(content, "eversource_ct", "srec_program_name",
    "Connecticut ZREC / LREC Program",
    "Connecticut ZREC/LREC (utility-contracted, not open-market SREC)")
content = update_string_field(content, "eversource_ct", "last_updated", "2025-01", "2026-07")
print("✓ eversource_ct")

# ---------- Massachusetts: Eversource ----------
# EIA May 2026 MA residential: 31.5¢/kWh (up from 24.8¢ — 27% stale)
# MA SMART program is NOT a tradeable SREC — srec_available correctly false already
content = update_profile(content, "eversource_ma", {
    "blended_rate":            ("0.248", "0.315"),
    "export_rate_monthly":     ("0.248", "0.315"),
    "export_rate_annual_excess":("0.248", "0.315"),
    "avoided_cost_rate":       ("0.248", "0.315"),
    "utility_rate":            ("0.248", "0.315"),
    "escalation_rate":         ("0.035", "0.05"),
})
content = update_string_field(content, "eversource_ma", "last_updated", "2025-01", "2026-07")
print("✓ eversource_ma")

# ---------- Vermont: Green Mountain Power ----------
# EIA May 2026 VT residential: 24.9¢/kWh (up from 21.5¢)
content = update_profile(content, "green_mountain_vt", {
    "blended_rate":            ("0.215", "0.249"),
    "export_rate_monthly":     ("0.215", "0.249"),
    "export_rate_annual_excess":("0.215", "0.249"),
    "avoided_cost_rate":       ("0.215", "0.249"),
    "utility_rate":            ("0.215", "0.249"),
    "escalation_rate":         ("0.03",  "0.04"),
})
content = update_string_field(content, "green_mountain_vt", "last_updated", "2025-01", "2026-07")
print("✓ green_mountain_vt")

# ---------- Maine: Central Maine Power ----------
# EIA May 2026 ME residential: 29.6¢/kWh (up from 26.5¢)
content = update_profile(content, "cmp_me", {
    "blended_rate":            ("0.265", "0.296"),
    "export_rate_monthly":     ("0.265", "0.296"),
    "export_rate_annual_excess":("0.265", "0.296"),
    "avoided_cost_rate":       ("0.265", "0.296"),
    "utility_rate":            ("0.265", "0.296"),
    "escalation_rate":         ("0.03",  "0.05"),
})
content = update_string_field(content, "cmp_me", "last_updated", "2025-01", "2026-07")
print("✓ cmp_me")

# ---------- DC: Pepco ----------
# EIA May 2026 DC residential: 24.0¢/kWh (up from 16.8¢ — 43% stale!)
# DC SREC: SRECTrade Dec 2025 $383/MWh (up slightly from $380)
content = update_profile(content, "pepco_dc", {
    "blended_rate":            ("0.168", "0.240"),
    "export_rate_monthly":     ("0.168", "0.240"),
    "export_rate_annual_excess":("0.168", "0.240"),
    "avoided_cost_rate":       ("0.168", "0.240"),
    "utility_rate":            ("0.168", "0.240"),
    "srec_value_estimate":     ("380",   "383"),
    "srec_price_estimate":     ("380",   "383"),
    "escalation_rate":         ("0.03",  "0.04"),
})
content = update_string_field(content, "pepco_dc", "last_updated", "2025-01", "2026-07")
print("✓ pepco_dc")

# ---------- New Jersey: PSE&G ----------
# EIA May 2026 NJ residential: 22.7¢/kWh (up from 17.8¢)
# CRITICAL FIX: NJ has an ACTIVE SREC market (~$25/MWh) — was incorrectly marked false!
# NJ SRECs trade on SRECTrade at ~$25-30/MWh as of Dec 2025
# (NJ also has TRECs but legacy SRECs from pre-2021 systems still trade)
content = update_profile(content, "pseg_nj", {
    "blended_rate":            ("0.178", "0.227"),
    "export_rate_monthly":     ("0.178", "0.227"),
    "export_rate_annual_excess":("0.178", "0.227"),
    "avoided_cost_rate":       ("0.178", "0.227"),
    "utility_rate":            ("0.178", "0.227"),
    "srec_value_estimate":     ("null",  "25"),
    "srec_price_estimate":     ("0",     "25"),
    "escalation_rate":         ("0.03",  "0.04"),
})
content = set_boolean_field(content, "pseg_nj", "srec_available", "false", "true")
content = update_string_field(content, "pseg_nj", "srec_program_name",
    "NJ Transition Renewable Energy Certificate (TREC)",
    "New Jersey SREC Market / TREC Program")
content = update_string_field(content, "pseg_nj", "last_updated", "2025-01", "2026-07")
print("✓ pseg_nj")

# ---------- Pennsylvania: PECO/PPL ----------
# EIA May 2026 PA residential: 20.6¢/kWh (up from 14.8¢ — 39% stale!)
# PA SREC: SRECTrade Dec 2025 $23/MWh (up slightly from $20)
content = update_profile(content, "peco_pa", {
    "blended_rate":            ("0.148", "0.206"),
    "export_rate_monthly":     ("0.148", "0.206"),
    "utility_rate":            ("0.148", "0.206"),
    "srec_value_estimate":     ("20",    "23"),
    "srec_price_estimate":     ("20",    "23"),
    "escalation_rate":         ("0.03",  "0.04"),
})
content = update_string_field(content, "peco_pa", "last_updated", "2025-01", "2026-07")
print("✓ peco_pa")

# ---------- North Carolina: Duke ----------
# EIA May 2026 NC residential: 15.1¢/kWh (up from 11.8¢)
content = update_profile(content, "duke_nc", {
    "blended_rate":       ("0.118", "0.151"),
    "export_rate_monthly":("0.118", "0.151"),
    "utility_rate":       ("0.118", "0.151"),
    "escalation_rate":    ("0.03",  "0.035"),
})
content = update_string_field(content, "duke_nc", "last_updated", "2025-01", "2026-07")
print("✓ duke_nc")

# ---------- Colorado: Xcel ----------
# EIA May 2026 CO residential: 16.3¢/kWh (up from 13.8¢)
content = update_profile(content, "xcel_co", {
    "blended_rate":            ("0.138", "0.163"),
    "export_rate_monthly":     ("0.138", "0.163"),
    "export_rate_annual_excess":("0.138", "0.163"),
    "avoided_cost_rate":       ("0.138", "0.163"),
    "utility_rate":            ("0.138", "0.163"),
    "escalation_rate":         ("0.03",  "0.035"),
})
content = update_string_field(content, "xcel_co", "last_updated", "2025-01", "2026-07")
print("✓ xcel_co")

# ---------- Michigan: DTE ----------
# EIA May 2026 MI residential: 20.6¢/kWh (up from 18.8¢)
# Note: export_rate_monthly stays at $0.09 (avoided cost — DTE Inflow/Outflow billing)
content = update_profile(content, "dte_mi", {
    "blended_rate":    ("0.188", "0.206"),
    "utility_rate":    ("0.188", "0.206"),
    "escalation_rate": ("0.03",  "0.04"),
})
content = update_string_field(content, "dte_mi", "last_updated", "2025-01", "2026-07")
print("✓ dte_mi")

# ---------- Michigan: Consumers Energy ----------
# Same EIA rate for MI: 20.6¢/kWh
# Note: export_rate_monthly stays at $0.088 (avoided cost — Inflow/Outflow billing)
content = update_profile(content, "consumers_mi", {
    "blended_rate":    ("0.188", "0.206"),
    "utility_rate":    ("0.188", "0.206"),
    "escalation_rate": ("0.03",  "0.04"),
})
content = update_string_field(content, "consumers_mi", "last_updated", "2025-01", "2026-07")
print("✓ consumers_mi")

# ---------- Texas: Oncor / ERCOT ----------
# EIA May 2026 TX residential: 16.2¢/kWh (up from 12.8¢)
# export_rate_monthly remains null (no statewide net metering in TX)
content = update_profile(content, "oncor_tx", {
    "blended_rate":    ("0.128", "0.162"),
    "utility_rate":    ("0.128", "0.162"),
    "escalation_rate": ("0.03",  "0.04"),
})
content = update_string_field(content, "oncor_tx", "last_updated", "2025-01", "2026-07")
print("✓ oncor_tx")

# ---------- Nevada: NV Energy ----------
# EIA May 2026 NV residential: 13.8¢/kWh (up from 11.8¢)
content = update_profile(content, "nv_energy", {
    "blended_rate":    ("0.118", "0.138"),
    "utility_rate":    ("0.118", "0.138"),
    "escalation_rate": ("0.03",  "0.035"),
})
content = update_string_field(content, "nv_energy", "last_updated", "2025-01", "2026-07")
print("✓ nv_energy")

# ---------- New York: Con Edison ----------
# EIA May 2026 NY residential: 27.1¢/kWh (up from 21.8¢ — 24% stale)
content = update_profile(content, "con_ed_ny", {
    "blended_rate":            ("0.218", "0.271"),
    "export_rate_monthly":     ("0.218", "0.271"),
    "export_rate_annual_excess":("0.218", "0.271"),
    "avoided_cost_rate":       ("0.218", "0.271"),
    "utility_rate":            ("0.218", "0.271"),
    "escalation_rate":         ("0.035", "0.05"),
})
content = update_string_field(content, "con_ed_ny", "last_updated", "2025-01", "2026-07")
print("✓ con_ed_ny")

# ---------- Ohio: AEP ----------
# EIA May 2026 OH residential: 17.9¢/kWh (up from 12.8¢)
# SREC: SRECTrade Dec 2025 OH SREC ~$3.30/MWh (down from $6)
content = update_profile(content, "aep_oh", {
    "blended_rate":            ("0.128", "0.179"),
    "export_rate_monthly":     ("0.128", "0.179"),
    "export_rate_annual_excess":("0.128", "0.179"),
    "avoided_cost_rate":       ("0.128", "0.179"),
    "utility_rate":            ("0.128", "0.179"),
    "srec_value_estimate":     ("6",     "3"),
    "srec_price_estimate":     ("6",     "3"),
    "escalation_rate":         ("0.03",  "0.04"),
})
content = update_string_field(content, "aep_oh", "last_updated", "2025-01", "2026-07")
print("✓ aep_oh")

# ---------- Arizona: APS ----------
# EIA May 2026 AZ residential: 15.6¢/kWh (up from 12.8¢)
# export_rate_monthly stays at $0.076 (APS Excess Generation Credit — regulatory rate)
content = update_profile(content, "aps_az", {
    "blended_rate":    ("0.128", "0.156"),
    "utility_rate":    ("0.128", "0.156"),
    "escalation_rate": ("0.03",  "0.035"),
})
content = update_string_field(content, "aps_az", "last_updated", "2025-01", "2026-07")
print("✓ aps_az")

# ---------- Virginia: Dominion ----------
# EIA May 2026 VA residential: 16.4¢/kWh (up from 12.8¢)
content = update_profile(content, "dominion_va", {
    "blended_rate":       ("0.128", "0.164"),
    "export_rate_monthly":("0.128", "0.164"),
    "utility_rate":       ("0.128", "0.164"),
    "escalation_rate":    ("0.03",  "0.035"),
})
content = update_string_field(content, "dominion_va", "last_updated", "2025-01", "2026-07")
print("✓ dominion_va")

# ---------- Hawaii: Hawaiian Electric ----------
# EIA May 2026 HI residential: 42.0¢/kWh (up from 39.5¢)
# escalation stays 0.04 — HI rates volatile but CSS export rate structure limits
# self-consumption math value of escalation bump
content = update_profile(content, "hawaiian_electric", {
    "blended_rate": ("0.395", "0.420"),
    "utility_rate": ("0.395", "0.420"),
})
content = update_string_field(content, "hawaiian_electric", "last_updated", "2025-01", "2026-07")
print("✓ hawaiian_electric")

# ─── Verify no accidental damage ──────────────────────────────────────────────
assert "utility_id: 'comed_il'" in content, "FATAL: comed_il block missing!"
assert "utility_id: 'ameren_il'" in content, "FATAL: ameren_il block missing!"
assert content.count("utility_id:") == original.count("utility_id:"), \
    "FATAL: utility_id count mismatch — a block may have been duplicated or deleted!"

# ─── Write output ─────────────────────────────────────────────────────────────
with open(FILE, "w", encoding="utf-8") as f:
    f.write(content)

print(f"\n✅ All 25 profiles updated. File written: {FILE}")
print(f"   Original length: {len(original):,} chars | New length: {len(content):,} chars")
print(f"   Diff: {len(content) - len(original):+,} chars")
