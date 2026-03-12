#!/usr/bin/env python3
"""
Fix catch blocks in admin API routes to use handleRouteDbError.
"""

import os
import re
import glob

base = "/workspace/solarpro"

# Find all admin route files
admin_routes = glob.glob(f"{base}/app/api/admin/**/*.ts", recursive=True)
# Also other remaining routes
other_routes = [
    f"{base}/app/api/engineering/plan-set/route.ts",
    f"{base}/app/api/engineering/preliminary/route.ts",
]

all_routes = admin_routes + other_routes

fixed = 0
skipped = 0

for path in sorted(all_routes):
    if not os.path.exists(path):
        continue
    
    with open(path, 'r') as f:
        content = f.read()
    
    if 'status: 500' not in content:
        continue
    
    original = content
    
    # Add handleRouteDbError import if not present
    if 'handleRouteDbError' not in content:
        # Add to db-neon import if exists
        if "from '@/lib/db-neon'" in content:
            # Check if it's a named import like { getDbReady } or { getDbReady, something }
            content = re.sub(
                r"from '@/lib/db-neon';",
                lambda m: m.group(0).replace(
                    "from '@/lib/db-neon';",
                    "from '@/lib/db-neon';"
                ),
                content
            )
            # Add handleRouteDbError to the first db-neon import
            content = re.sub(
                r"(import \{[^}]+)\} from '@/lib/db-neon';",
                r"\1, handleRouteDbError } from '@/lib/db-neon';",
                content, count=1
            )
        elif "from '@/lib/auth'" in content:
            # Add separate import
            content = re.sub(
                r"(import \{[^}]+\} from '@/lib/auth';)",
                r"\1\nimport { handleRouteDbError } from '@/lib/db-neon';",
                content, count=1
            )
        else:
            # Add at top after first import
            content = re.sub(
                r"(import [^\n]+\n)",
                r"\1import { handleRouteDbError } from '@/lib/db-neon';\n",
                content, count=1
            )
    
    # Now replace catch blocks that return 500
    # Pattern 1: } catch (err: any) { ... status: 500 ... }
    # Pattern 2: } catch (error: any) { ... status: 500 ... }
    # Pattern 3: } catch (e: any) { ... status: 500 ... }
    
    def fix_catch(m):
        block = m.group(0)
        if 'status: 500' not in block:
            return block
        if 'handleRouteDbError' in block:
            return block
        
        # Get variable name (err, error, e)
        var_match = re.search(r'catch \((\w+)(?:: \w+)?\)', block)
        var_name = var_match.group(1) if var_match else 'err'
        
        # Get route label from console.error if present
        label_match = re.search(r"console\.\w+\(['&quot;](\[[^\]]+\]|[A-Za-z][^'&quot;]*)['&quot;]", block)
        if label_match:
            label = label_match.group(1)
            if not label.startswith('['):
                label = f'[{label}]'
        else:
            # Use filename as label
            rel = path.replace(base + '/', '')
            label = f'[{rel}]'
        
        # Detect indentation (spaces before "} catch")
        indent_match = re.match(r'^(\s*)', block)
        indent = indent_match.group(1) if indent_match else '  '
        
        return f"{indent}}} catch ({var_name}: unknown) {{\n{indent}  return handleRouteDbError('{label}', {var_name});\n{indent}}}"
    
    # Match catch blocks: from "  } catch" to the closing "  }" 
    # This handles single-level catch blocks at function level
    content = re.sub(
        r'  \} catch \(\w+(?:: \w+)?\) \{[^}]*(?:\{[^}]*\}[^}]*)?\}',
        fix_catch,
        content
    )
    
    if content != original:
        with open(path, 'w') as f:
            f.write(content)
        print(f"FIXED: {path.replace(base+'/', '')}")
        fixed += 1
    else:
        print(f"NO CHANGE: {path.replace(base+'/', '')}")
        skipped += 1

print(f"\nFixed: {fixed}, Skipped: {skipped}")