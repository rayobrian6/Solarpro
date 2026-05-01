#!/usr/bin/env python3
"""Refactor bom route: remove mergeBOM path, use injectStructuralIntoV4 instead."""

import re

filepath = 'app/api/engineering/bom/route.ts'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Remove structuralToGeometryBOM function (from its start to the closing brace before POST)
pattern1 = r'// [\u2500\u2550]+ Helper: Convert structural profile output.*?generatedAt: new Date\(\)\.toISOString\(\),\n  \};\n\}\n\nexport async function POST'
replacement1 = 'export async function POST'

match1 = re.search(pattern1, content, re.DOTALL)
if match1:
    content = content[:match1.start()] + replacement1 + content[match1.end():]
    print(f"1. Removed structuralToGeometryBOM ({match1.end() - match1.start()} chars)")
else:
    print("1. structuralToGeometryBOM not found")

# 2. Replace the merge section (from "let mergedResult" through the mergedResult response handling)
# Find the start and end markers
start_marker = '    // \u2500\u2500 STEP 2: Structural BOM'
end_marker = '    // V4-only path (roof systems or merge failure fallback)'

start_idx = content.find(start_marker)
end_idx = content.find(end_marker)

if start_idx >= 0 and end_idx >= 0:
    new_block = """    // \u2500\u2500 STEP 2: Structural BOM \u2014 fence/ground geometry (if applicable) \u2500\u2500
    // MASTER TASK: Inject structural items directly into V4 result, preserving
    // manufacturer/model/partNumber. V4 still owns electrical. Structural comes
    // from bom-system-profiles.ts (canonical SolFence/Unirac specs).
    const sysType = (input.systemType || 'roof') as BOMSystemType;
    let finalResult = v4Result;
    let structuralCount = 0;
    let overlapsSkipped: string[] = [];

    if (sysType !== 'roof') {
      try {
        const structuralResult = deriveStructuralBOM({
          systemType: sysType,
          moduleCount: input.moduleCount,
          fence: input.fenceData || undefined,
          ground: input.groundData || undefined,
        });

        console.log(`[BOM MERGE] ${sysType}: ${structuralResult.items.length} structural items from profile`);

        // Capture overlaps for response
        const v4Categories = new Set(v4Result.items.map(i => i.category));
        for (const si of structuralResult.items) {
          if (V4_OWNED_CATEGORIES.has(si.category)) overlapsSkipped.push(`${si.category}: V4 wins (electrical authority)`);
          else if (v4Categories.has(si.category)) overlapsSkipped.push(`${si.category}: V4 wins (existing item)`);
        }

        // Inject structural into V4 (preserves manufacturer/model/partNumber)
        finalResult = injectStructuralIntoV4(v4Result, structuralResult.items);
        structuralCount = finalResult.totalLineItems - v4Result.totalLineItems;
        console.log(`[BOM MERGE] Final: ${finalResult.totalLineItems} items (V4=${v4Result.totalLineItems}, structural added=${structuralCount})`);
      } catch (mergeErr) {
        console.error('[BOM MERGE] Structural injection failed, returning V4-only:', mergeErr);
      }
    }

    // \u2500\u2500 Format & Return \u2500\u2500
    const format = body.format ?? 'json';

    if (format === 'csv') {
      return new NextResponse(bomToCSV(finalResult), {
        headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename=\"bom.csv\"' },
      });
    }
    if (format === 'markdown') {
      return new NextResponse(bomToMarkdown(finalResult), {
        headers: { 'Content-Type': 'text/markdown' },
      });
    }

    return NextResponse.json({
      success: true,
      bom: finalResult,
      summary: {
        topology: finalResult.topology,
        topologyLabel: finalResult.topologyLabel,
        totalLineItems: finalResult.totalLineItems,
        stageCount: finalResult.stages.filter(s => s.itemCount > 0).length,
        complianceNotes: finalResult.complianceNotes,
        warnings: [...finalResult.warnings, ...validation.warnings],
      },
      merge: sysType !== 'roof' ? {
        v4ItemCount: v4Result.totalLineItems,
        structuralItemCount: structuralCount,
        totalItemCount: finalResult.totalLineItems,
        overlapsSkipped,
      } : undefined,
      validation: {
        warnings: validation.warnings,
        checks: validation.checks,
      },
    });

  } catch (err: unknown) {
    return handleRouteDbError('[app/api/engineering/bom/route.ts]', err);
  }
}
"""
    # Find the true end of the function (the final }) to replace everything
    # Actually, we need to replace from start_marker to the end of the file's try block
    # Let's find the final closing brace
    end_of_try = content.find("  } catch (err: unknown) {\n    return handleRouteDbError('[app/api/engineering/bom/route.ts]', err);\n  }\n}")
    if end_of_try > 0:
        # Replace from start_idx to the end of the file
        content = content[:start_idx] + new_block
        print(f"2. Replaced merge path (from {start_idx} to end)")
    else:
        print("2. Could not find end of try block")
else:
    print(f"2. Markers not found: start={start_idx}, end={end_idx}")

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print("Done")