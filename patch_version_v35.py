#!/usr/bin/env python3
import re

VER = 'lib/version.ts'
with open(VER, 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace("export const BUILD_VERSION = 'v34.4';", "export const BUILD_VERSION = 'v35.0';")
content = content.replace("export const BUILD_DATE = '2026-03-09';", "export const BUILD_DATE = '2026-03-10';")

old_desc = re.search(r"export const BUILD_DESCRIPTION = '[^']*';", content)
if old_desc:
    new_desc = ("export const BUILD_DESCRIPTION = 'ENGINEERING AUTOMATION SYSTEM v1.0 — "
                "Full integrated engineering module: (1) /lib/engineering/ core module derives all data from design engine. "
                "(2) Auto-generates engineering report when layout is saved. "
                "(3) System Summary, Electrical Engineering (NEC 690), Structural Engineering (ASCE 7-22), "
                "Equipment Schedule, Panel Layout, Permit Package. "
                "(4) Engineering tab in project dashboard. "
                "(5) /api/engineering/generate + /api/engineering/report endpoints. "
                "(6) engineering_reports DB table with design_version_id for change detection. "
                "(7) Auto-regeneration when design changes. "
                "PRIMARY PATH 0-panel fix: filter against original boundary polygon only (v34.4).';")
    content = content[:old_desc.start()] + new_desc + content[old_desc.end():]
    print("✅ BUILD_DESCRIPTION updated")

with open(VER, 'w', encoding='utf-8') as f:
    f.write(content)
print("✅ Version bumped to v35.0")