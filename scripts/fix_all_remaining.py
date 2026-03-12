#!/usr/bin/env python3
"""
Fix ALL remaining catch blocks with status: 500 across all API routes.
"""

import os
import re
import glob

base = "/workspace/solarpro"

# All remaining routes with 500s
route_files = glob.glob(f"{base}/app/api/**/*.ts", recursive=True)

fixed = 0
skipped = 0
errors = []

for full_path in sorted(route_files):
    rel_path = full_path.replace(base + '/', '')
    
    # Skip routes where 500 is intentional/correct
    skip_patterns = [
        'auth/debug-login',
        'auth/register',  # Already has proper handling with isTransientDbError
        'tile/',          # Proxy error
        'elevation/',     # External API
        'dsm/',           # External API
        'geocode/',       # External API
        'bill-upload/',   # OCR/parsing error
        'ocr/',           # OCR error
    ]
    if any(p in rel_path for p in skip_patterns):
        continue
    
    try:
        with open(full_path, 'r') as f:
            content = f.read()
    except Exception as e:
        errors.append(f"READ ERROR {rel_path}: {e}")
        continue
    
    if 'status: 500' not in content:
        continue
    
    original = content
    
    # Add handleRouteDbError import if not present
    if 'handleRouteDbError' not in content:
        if "from '@/lib/db-neon'" in content:
            # Add to existing db-neon import
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
        else:
            # Add after first import line
            first_import_end = content.find('\n', content.find('import'))
            if first_import_end > 0:
                content = content[:first_import_end+1] + "import { handleRouteDbError } from '@/lib/db-neon';\n" + content[first_import_end+1:]
    
    # Normalize: "} catch (x) {" -> "} catch (x: unknown) {"
    content = re.sub(
        r'\} catch \((\w+)\) \{',
        r'} catch (\1: unknown) {',
        content
    )
    
    def fix_catch(m):
        block = m.group(0)
        if 'status: 500' not in block:
            return block
        if 'handleRouteDbError' in block:
            return block
        
        var_match = re.search(r'catch \((\w+)(?:: \w+)?\)', block)
        var_name = var_match.group(1) if var_match else 'err'
        
        label_match = re.search(r"console\.\w+\(['&quot;]([^'&quot;]+)['&quot;]", block)
        if label_match:
            label = label_match.group(1).strip()
            if not label.startswith('['):
                label = f'[{label}]'
        else:
            label = f'[{rel_path}]'
        
        indent_match = re.match(r'^(\s*)', block)
        indent = indent_match.group(1) if indent_match else '  '
        
        return f"{indent}}} catch ({var_name}: unknown) {{\n{indent}  return handleRouteDbError('{label}', {var_name});\n{indent}}}"
    
    new_content = re.sub(
        r'[ \t]*\} catch \(\w+(?:: \w+)?\) \{(?:[^{}]|\{[^{}]*\})*\}',
        fix_catch,
        content,
        flags=re.DOTALL
    )
    
    if new_content != original:
        try:
            with open(full_path, 'w') as f:
                f.write(new_content)
            remaining = new_content.count('status: 500')
            print(f"FIXED: {rel_path} (remaining: {remaining})")
            fixed += 1
        except Exception as e:
            errors.append(f"WRITE ERROR {rel_path}: {e}")

print(f"\nFixed: {fixed}, Skipped: {skipped}")
if errors:
    print(f"Errors: {len(errors)}")
    for e in errors:
        print(f"  {e}")