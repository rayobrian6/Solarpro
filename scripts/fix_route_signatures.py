import re

files_to_fix = [
    'app/api/projects/[id]/versions/[versionId]/route.ts',
    'app/api/projects/[id]/versions/route.ts',
    'app/api/projects/[id]/site-conditions/route.ts',
    'app/api/projects/[id]/route.ts',
    'app/api/proposals/[id]/route.ts',
]

for filepath in files_to_fix:
    try:
        with open(filepath, 'r') as f:
            content = f.read()
        
        original = content
        
        # Replace multi-line function signatures with old params pattern
        # Pattern: function NAME(\n  req: NextRequest,\n  { params }: { params: { ... } }\n)
        content = re.sub(
            r'(export async function \w+)\(\s*\n\s*req: NextRequest,\s*\n\s*\{ params \}: \{ params: \{[^}]+\} \}\s*\n\)',
            lambda m: m.group(1) + '(req: NextRequest, context: RouteContext)',
            content
        )
        
        # Also replace single-line function signatures
        content = re.sub(
            r'(export async function \w+)\(req: NextRequest, \{ params \}: \{ params: \{[^}]+\} \}\)',
            lambda m: m.group(1) + '(req: NextRequest, context: RouteContext)',
            content
        )
        
        if content != original:
            with open(filepath, 'w') as f:
                f.write(content)
            print(f"✓ Fixed signatures in {filepath}")
        else:
            print(f"  No signature changes needed in {filepath}")
            
    except FileNotFoundError:
        print(f"  File not found: {filepath}")