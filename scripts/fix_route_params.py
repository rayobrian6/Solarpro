import os
import re

# Files to fix
files = [
    'app/api/projects/[id]/versions/[versionId]/route.ts',
    'app/api/projects/[id]/versions/route.ts',
    'app/api/projects/[id]/site-conditions/route.ts',
    'app/api/projects/[id]/route.ts',
    'app/api/projects/[id]/layout/route.ts',
    'app/api/proposals/[id]/route.ts',
]

def fix_route_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    original = content
    
    # Pattern 1: Single param { params }: { params: { id: string } }
    # Replace with context: { params: Promise<{ id: string }> }
    # and add const { id } = await context.params; at start of try block
    
    # First, detect what params are used
    # Find all unique param destructuring patterns
    patterns = re.findall(r'\{ params \}: \{ params: \{([^}]+)\} \}', content)
    
    if not patterns:
        print(f"  No patterns found in {filepath}")
        return False
    
    # Get unique param types
    param_types = set()
    for p in patterns:
        param_types.add(p.strip())
    
    # Use the most complex one (most fields)
    param_type = max(param_types, key=lambda x: len(x))
    
    # Extract param names
    param_names = re.findall(r'(\w+)\s*:', param_type)
    
    print(f"  Fixing {filepath}")
    print(f"  Param type: {param_type}")
    print(f"  Param names: {param_names}")
    
    # Add RouteContext type after imports
    route_context_type = f'\ntype RouteContext = {{ params: Promise<{{{param_type}}}> }};\n'
    
    # Find where to insert - after last import
    last_import_match = list(re.finditer(r'^import .+;$', content, re.MULTILINE))
    if last_import_match:
        insert_pos = last_import_match[-1].end()
        content = content[:insert_pos] + '\n' + route_context_type + content[insert_pos:]
    
    # Replace all function signatures
    # Pattern: (req: NextRequest, { params }: { params: { ... } })
    content = re.sub(
        r'\(req: NextRequest, \{ params \}: \{ params: \{[^}]+\} \}\)',
        '(req: NextRequest, context: RouteContext)',
        content
    )
    
    # Now fix the function bodies - add const { param1, param2 } = await context.params;
    # after each "try {" that follows a function signature we just changed
    param_destructure = ', '.join(param_names)
    await_params = f'    const {{ {param_destructure} }} = await context.params;'
    
    # Replace params.X with the local variable X in function bodies
    for name in param_names:
        content = content.replace(f'params.{name}', name)
    
    # Add await context.params after each try { in async functions
    # Find all try blocks and add the destructure at the start
    content = re.sub(
        r'(export async function \w+\([^)]+\) \{\s*try \{)',
        lambda m: m.group(0) + '\n' + await_params,
        content
    )
    
    if content != original:
        with open(filepath, 'w') as f:
            f.write(content)
        print(f"  ✓ Fixed {filepath}")
        return True
    else:
        print(f"  No changes needed for {filepath}")
        return False

for filepath in files:
    if os.path.exists(filepath):
        fix_route_file(filepath)
    else:
        print(f"  File not found: {filepath}")