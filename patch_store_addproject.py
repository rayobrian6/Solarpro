with open('store/appStore.ts', 'r', encoding='utf-8') as f:
    content = f.read()

old = """  addProject: (data: {
    clientId?: string;
    name: string;
    systemType: string;
    notes?: string;
    address?: string;
  }) => Promise<Project>;"""

new = """  addProject: (data: {
    clientId?: string;
    name: string;
    systemType: string;
    notes?: string;
    address?: string;
    lat?: number;
    lng?: number;
    stateCode?: string;
    city?: string;
    county?: string;
    zip?: string;
    utilityName?: string;
    utilityRatePerKwh?: number;
  }) => Promise<Project>;"""

if old in content:
    content = content.replace(old, new, 1)
    with open('store/appStore.ts', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Done - store/appStore.ts updated")
else:
    print("ERROR: target string not found")
    idx = content.find('addProject: (data:')
    if idx >= 0:
        print(repr(content[idx:idx+200]))