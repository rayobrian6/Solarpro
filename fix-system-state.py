import re

content = open('lib/system-state.ts').read()

# 1. Add import for TopologyType from equipment-registry
old_import = "import { SolarPanel, StringInverter, Microinverter, Optimizer, RackingSystem } from './equipment-db';"
new_import = (
    "import { SolarPanel, StringInverter, Microinverter, Optimizer, RackingSystem } from './equipment-db';\n"
    "import { TopologyType } from './equipment-registry';\n"
    "export type { TopologyType };"
)
content = content.replace(old_import, new_import, 1)

# 2. Remove the local TopologyType definition block
# Find the section between the Topology Types comment and the semicolon ending the type
pattern = r'// ─+ Topology Types ─+\n\nexport type TopologyType =\n(?:[^\n]*\n)*?  \| \'ROOF_RAIL_LESS\';\s*// Rail-less roof mount \(Ecofasten, S-5, etc\.\)\n'
content = re.sub(pattern, '// TopologyType — imported from equipment-registry.ts\n\n', content)

open('lib/system-state.ts', 'w').write(content)
print('Done')
print('First 30 lines:')
for i, line in enumerate(content.split('\n')[:30], 1):
    print(f'{i:3}: {line}')