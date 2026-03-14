#!/usr/bin/env python3
"""Add PIPELINE_STAGE_START log calls before each major pipeline step's DB work."""

import re

with open('app/api/pipeline/run/route.ts', 'r') as f:
    content = f.read()

# Map of unique anchor strings to what to insert before them
insertions = [
    (
        '    const project = await getProjectById(projectId, user.id);',
        "    stageStart('load_project', 1);\n"
    ),
    (
        '    console.log(\'[LAYOUT_LOADED]\', { projectId, step: 2 });',
        "    stageStart('load_layout', 2);\n"
    ),
    (
        '    console.log(\'[ENGINEERING_REBUILD_STARTED]\', { projectId, panelCount, step: 4 });',
        "    stageStart('engineering_sync', 4, { panelCount });\n"
    ),
    (
        '    console.log(\'[ARTIFACT_GENERATION_STARTED]\', { projectId, step: \'6-8\' });',
        "    stageStart('artifact_generation', 6);\n"
    ),
    (
        '    console.log(\'[REGISTRY_READ_STARTED]\', { projectId, step: 10 });',
        "    stageStart('registry_read', 10);\n"
    ),
]

for anchor, insertion in insertions:
    if anchor in content:
        content = content.replace(anchor, insertion + anchor, 1)
        print(f'✓ Inserted stageStart before: {anchor[:60]}...')
    else:
        print(f'✗ ANCHOR NOT FOUND: {anchor[:60]}...')

with open('app/api/pipeline/run/route.ts', 'w') as f:
    f.write(content)

print('Done.')