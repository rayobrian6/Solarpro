with open('app/api/projects/route.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix body destructuring
old_body = "    const { clientId, name, systemType, notes, address } = body;"
new_body = "    const { clientId, name, systemType, notes, address, stateCode, city, county, zip, utilityName, utilityRatePerKwh } = body;"

if old_body in content:
    content = content.replace(old_body, new_body, 1)
    with open('app/api/projects/route.ts', 'w', encoding='utf-8') as f:
        f.write(content)
    print("✓ Updated body destructuring")
else:
    print("✗ Not found")
    idx = content.find('const {')
    print(repr(content[idx:idx+200]))