#!/usr/bin/env python3
"""
Fix catch blocks without type annotations: } catch (err) { -> } catch (err: unknown) {
and replace 500 returns with handleRouteDbError.
"""

import os
import re

base = "/workspace/solarpro"

routes = [
    "app/api/projects/route.ts",
    "app/api/projects/[id]/layout/route.ts",
    "app/api/projects/[id]/versions/route.ts",
    "app/api/projects/[id]/versions/[versionId]/route.ts",
    "app/api/clients/route.ts",
    "app/api/clients/[id]/route.ts",
    "app/api/stats/route.ts",
    "app/api/auth/register/route.ts",
    "app/api/auto-design/route.ts",
    "app/api/auto-size/route.ts",
]

for rel_path in routes:
    full_path = os.path.join(base, rel_path)
    if not os.path.exists(full_path):
        print(f"SKIP (missing): {rel_path}")
        continue
    
    with open(full_path, 'r') as f:
        content = f.read()
    
    if 'status: 500' not in content:
        print(f"NO 500s: {rel_path}")
        continue
    
    original = content
    
    # Add handleRouteDbError import if not present
    if 'handleRouteDbError' not in content:
        if "from '@/lib/db-neon'" in content:
            content = re.sub(
                r"(import \{[^}]+)\} from '@/lib/db-neon';",
                r"\1, handleRouteDbError } from '@/lib/db-neon';",
                content, count=1
            )
        elif "from '@/lib/auth'" in content:
            content = re.sub(
                r"(import \{[^}]+\} from '@/lib/auth';)",
                r"\1\nimport { handleRouteDbError } from '@/lib/db-neon';",
                content, count=1
            )
    
    # Step 1: Normalize untyped catch vars: } catch (err) { -> } catch (err: unknown) {
    content = re.sub(
        r'\} catch \((\w+)\) \{',
        r'} catch (\1: unknown) {',
        content
    )
    
    # Step 2: Replace catch blocks containing status: 500
    # Multi-line approach: find "} catch (xxx: yyy) {" ... "status: 500" ... "}"
    def replace_catch_block(m):
        block = m.group(0)
        if 'status: 500' not in block:
            return block
        if 'handleRouteDbError' in block:
            return block
        
        # Get variable name
        var_match = re.search(r'catch \((\w+)(?:: \w+)?\)', block)
        var_name = var_match.group(1) if var_match else 'err'
        
        # Get route label from console.error
        label_match = re.search(r"console\.\w+\(['&quot;]([^'&quot;]+)['&quot;]", block)
        if label_match:
            label = label_match.group(1).strip()
            if not label.startswith('['):
                label = f'[{label}]'
        else:
            label = f'[{rel_path}]'
        
        # Get leading indent of "  } catch"
        indent_match = re.match(r'^(\s*)', block)
        indent = indent_match.group(1) if indent_match else '  '
        
        return f"{indent}}} catch ({var_name}: unknown) {{\n{indent}  return handleRouteDbError('{label}', {var_name});\n{indent}}}"
    
    # Match all catch blocks (with or without nested braces at one level)
    new_content = re.sub(
        r'[ \t]*\} catch \(\w+(?:: \w+)?\) \{(?:[^{}]|\{[^{}]*\})*\}',
        replace_catch_block,
        content,
        flags=re.DOTALL
    )
    
    if new_content != original:
        with open(full_path, 'w') as f:
            f.write(new_content)
        remaining = new_content.count('status: 500')
        print(f"FIXED: {rel_path} (remaining 500s: {remaining})")
    else:
        remaining = content.count('status: 500')
        print(f"NO CHANGE: {rel_path} ({remaining} 500s still present)")

print("\nDone!")