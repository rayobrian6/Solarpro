#!/usr/bin/env python3
"""
Patch layout route to auto-trigger engineering generation when layout is saved.
Adds async engineering trigger after saveProjectVersion call.
"""

SRC = 'app/api/projects/[id]/layout/route.ts'

with open(SRC, 'r', encoding='utf-8') as f:
    content = f.read()

# Add import for engineering trigger at the top
old_import = "import { getProjectById, getLayoutByProject, upsertLayout, saveProjectVersion } from '@/lib/db-neon';"
new_import = """import { getProjectById, getLayoutByProject, upsertLayout, saveProjectVersion } from '@/lib/db-neon';
import { buildDesignSnapshot } from '@/lib/engineering/designSnapshot';
import { generateEngineeringReport } from '@/lib/engineering/reportGenerator';
import { upsertEngineeringReport, generateReportId, isEngineeringReportStale } from '@/lib/engineering/db-engineering';"""

if old_import in content:
    content = content.replace(old_import, new_import)
    print("✅ Added engineering imports")
else:
    print("⚠️  Import line not found - skipping import patch")

# Add engineering trigger after saveProjectVersion call
old_trigger = """    // Save version snapshot (async, non-blocking for response)
    saveProjectVersion({
      projectId,
      userId: user.id,
      snapshot: {
        projectId,
        projectName: project.name,
        layout: savedLayout,
        savedAt: new Date().toISOString(),
      },
      panelsCount: totalPanels,
      systemSizeKw,
      changeSummary: changeSummary || `Saved ${totalPanels} panels (${systemSizeKw} kW)`,
    }).catch(err => console.error('[version snapshot]', err));"""

new_trigger = """    // Save version snapshot (async, non-blocking for response)
    saveProjectVersion({
      projectId,
      userId: user.id,
      snapshot: {
        projectId,
        projectName: project.name,
        layout: savedLayout,
        savedAt: new Date().toISOString(),
      },
      panelsCount: totalPanels,
      systemSizeKw,
      changeSummary: changeSummary || `Saved ${totalPanels} panels (${systemSizeKw} kW)`,
    }).catch(err => console.error('[version snapshot]', err));

    // Auto-trigger engineering report generation (async, non-blocking)
    // Engineering derives all data from the design engine — no manual entry needed
    if (totalPanels > 0) {
      (async () => {
        try {
          const snapshot = buildDesignSnapshot(project, savedLayout);
          const stale = await isEngineeringReportStale(projectId, snapshot.designVersionId);
          if (stale) {
            const reportId = generateReportId();
            const report = generateEngineeringReport(snapshot, reportId);
            await upsertEngineeringReport(report, projectId);
            console.log(`[engineering] Auto-generated report for project ${projectId}: ${totalPanels} panels, ${systemSizeKw}kW`);
          }
        } catch (engErr) {
          console.error('[engineering] Auto-generation failed (non-critical):', engErr);
        }
      })();
    }"""

if old_trigger in content:
    content = content.replace(old_trigger, new_trigger)
    print("✅ Added engineering auto-trigger")
else:
    print("⚠️  Trigger location not found - trying flexible match")
    # Try to find the saveProjectVersion call
    idx = content.find('saveProjectVersion({')
    if idx >= 0:
        print(f"  Found saveProjectVersion at index {idx}")
        # Find the end of the .catch() call
        catch_end = content.find('.catch(err => console.error(\'[version snapshot]\', err));', idx)
        if catch_end >= 0:
            insert_pos = catch_end + len('.catch(err => console.error(\'[version snapshot]\', err));')
            engineering_block = """

    // Auto-trigger engineering report generation (async, non-blocking)
    if (totalPanels > 0) {
      (async () => {
        try {
          const snapshot = buildDesignSnapshot(project, savedLayout);
          const stale = await isEngineeringReportStale(projectId, snapshot.designVersionId);
          if (stale) {
            const reportId = generateReportId();
            const report = generateEngineeringReport(snapshot, reportId);
            await upsertEngineeringReport(report, projectId);
            console.log(`[engineering] Auto-generated report for project ${projectId}: ${totalPanels} panels, ${systemSizeKw}kW`);
          }
        } catch (engErr) {
          console.error('[engineering] Auto-generation failed (non-critical):', engErr);
        }
      })();
    }"""
            content = content[:insert_pos] + engineering_block + content[insert_pos:]
            print("✅ Added engineering trigger via flexible match")

with open(SRC, 'w', encoding='utf-8') as f:
    f.write(content)
print(f"✅ Written {SRC}")