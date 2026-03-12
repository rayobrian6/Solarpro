#!/usr/bin/env python3
"""
Fix catch blocks in API routes to use handleRouteDbError.
This script updates all catch blocks that return raw 500 errors
to properly handle DbConfigError -> 503 responses.
"""

import os
import re

# Routes to fix and their labels
ROUTES = {
    "app/api/proposals/route.ts": [
        ("[GET /api/proposals]", "Failed to fetch proposals"),
        ("[POST /api/proposals]", "Failed to create proposal"),
    ],
    "app/api/proposals/[id]/route.ts": [
        ("[GET /api/proposals/[id]]", None),
        ("[PUT /api/proposals/[id]]", None),
    ],
    "app/api/proposals/[id]/share/route.ts": [
        ("[GET /api/proposals/[id]/share]", None),
        ("[POST /api/proposals/[id]/share]", None),
    ],
    "app/api/settings/profile/route.ts": [
        ("[GET /api/settings/profile]", None),
        ("[PUT /api/settings/profile]", None),
    ],
    "app/api/settings/branding/route.ts": [
        ("[GET /api/settings/branding]", None),
        ("[PUT /api/settings/branding]", None),
    ],
    "app/api/settings/logo/route.ts": [
        ("[POST /api/settings/logo]", None),
        ("[DELETE /api/settings/logo]", None),
    ],
    "app/api/projects/[id]/site-conditions/route.ts": [
        ("[GET /api/projects/[id]/site-conditions]", None),
        ("[POST /api/projects/[id]/site-conditions]", None),
    ],
    "app/api/project-files/route.ts": [
        ("[GET /api/project-files]", None),
        ("[POST /api/project-files]", None),
        ("[DELETE /api/project-files]", None),
    ],
    "app/api/project-files/download/route.ts": [
        ("[GET /api/project-files/download]", None),
    ],
    "app/api/enterprise/contact/route.ts": [
        ("[POST /api/enterprise/contact]", None),
    ],
    "app/api/stripe/checkout/route.ts": [
        ("[POST /api/stripe/checkout]", None),
    ],
    "app/api/pricing/route.ts": [
        ("[GET /api/pricing]", None),
    ],
    "app/api/migrate/route.ts": [
        ("[POST /api/migrate]", None),
    ],
}

base = "/workspace/solarpro"

for rel_path, labels in ROUTES.items():
    full_path = os.path.join(base, rel_path)
    if not os.path.exists(full_path):
        print(f"SKIP (not found): {rel_path}")
        continue
    
    with open(full_path, 'r') as f:
        content = f.read()
    
    # Check if already has handleRouteDbError import
    needs_import = "handleRouteDbError" not in content
    
    # Check if imports from db-neon
    from_db_neon = "from '@/lib/db-neon'" in content
    from_auth = "from '@/lib/auth'" in content and "getDbReady" in content
    
    if needs_import and (from_db_neon or from_auth):
        if from_db_neon:
            # Add handleRouteDbError to the db-neon import
            content = re.sub(
                r"import \{([^}]+)\} from '@/lib/db-neon'",
                lambda m: f"import {{{m.group(1)}, handleRouteDbError}} from '@/lib/db-neon'",
                content, count=1
            )
        elif from_auth:
            # Add handleRouteDbError from db-neon as separate import
            first_import_end = content.find('\n', content.find('import'))
            # Find first import line end and add after it
            content = content.replace(
                "import { getUserFromRequest, getDbReady } from '@/lib/auth';",
                "import { getUserFromRequest, getDbReady } from '@/lib/auth';\nimport { handleRouteDbError } from '@/lib/db-neon';",
                1
            )
    
    # Replace generic 500 catch blocks with handleRouteDbError
    # Pattern: } catch (error: any/unknown) { \n    console.error(...); \n    return NextResponse.json(...500...); \n  }
    # We'll do a simple replacement of the catch body
    
    # Replace patterns like:
    # } catch (error: any) {
    #   console.error('[xxx]', error);
    #   return NextResponse.json({ success: false, error: '...' }, { status: 500 });
    # }
    
    # Use regex to find and replace catch blocks that end in status: 500
    pattern = r'(\s+\} catch \(error: (?:any|unknown)\) \{[^}]+?status: 500 \}[^}]*?\})'
    
    # Simpler approach: replace all generic catch blocks
    # Match: } catch (error: any/unknown) { ... status: 500 ... }
    def replace_catch(m):
        block = m.group(0)
        if 'status: 500' in block and 'handleRouteDbError' not in block:
            # Extract the route label from console.error if present
            label_match = re.search(r"console\.error\('(\[.*?\])", block)
            label = label_match.group(1) if label_match else rel_path
            
            indent = re.match(r'^(\s+)', block)
            ind = indent.group(1) if indent else '  '
            
            return f"{ind}}} catch (error: unknown) {{\n{ind}  return handleRouteDbError('{label}', error);\n{ind}}}"
        return block
    
    new_content = re.sub(
        r'  \} catch \(error: (?:any|unknown)\) \{.*?status: 500 \}[^)]*?\);\s*\}',
        replace_catch,
        content,
        flags=re.DOTALL
    )
    
    if new_content != content:
        with open(full_path, 'w') as f:
            f.write(new_content)
        print(f"FIXED: {rel_path}")
    else:
        print(f"NO CHANGE (pattern not matched): {rel_path}")

print("\nDone!")