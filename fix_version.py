content = open('lib/version.ts').read()
content = content.replace("export const BUILD_VERSION = 'v39.10';", "export const BUILD_VERSION = 'v40.0';")
# Replace description line
import re
content = re.sub(
    r"export const BUILD_DESCRIPTION = '[^']*';",
    "export const BUILD_DESCRIPTION = 'STABLE: Admin portal RBAC fully operational - DB role checks, constraint fix, clean build';",
    content
)
open('lib/version.ts', 'w').write(content)
print('Done')
print(open('lib/version.ts').read()[:300])