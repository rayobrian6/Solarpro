import re

content = open('lib/version.ts').read()
content = content.replace("'v40.0'", "'v40.1'")
content = re.sub(
    r"export const BUILD_DESCRIPTION = '[^']*';",
    "export const BUILD_DESCRIPTION = 'STABLE: Role stripped from JWT - DB is sole source of truth for RBAC';",
    content
)
open('lib/version.ts', 'w').write(content)

# Verify
lines = open('lib/version.ts').readlines()
for i, line in enumerate(lines[:8]):
    print(f"{i+1}: {line}", end='')