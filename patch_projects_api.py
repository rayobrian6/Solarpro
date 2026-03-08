with open('app/api/projects/route.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the body destructuring to add new fields
old_body = "    const { clientId, name, systemType, notes } = await req.json();"
new_body = "    const { clientId, name, systemType, notes, address: bodyAddress, lat: bodyLat, lng: bodyLng, stateCode, city, county, zip, utilityName, utilityRatePerKwh } = await req.json();"

if old_body in content:
    content = content.replace(old_body, new_body, 1)
    print("✓ Updated body destructuring")
else:
    print("✗ Could not find body destructuring")
    idx = content.find('await req.json()')
    if idx >= 0:
        print(repr(content[max(0,idx-100):idx+100]))

# Update createProject call to pass new fields
old_create_call = """    const project = await createProject({
      userId: user.id,
      clientId: resolvedClientId,
      name: name.trim(),
      status: 'lead',
      systemType,
      notes: notes || '',
      address: projectAddress,
      lat,
      lng,
    });"""

new_create_call = """    const project = await createProject({
      userId: user.id,
      clientId: resolvedClientId,
      name: name.trim(),
      status: 'lead',
      systemType,
      notes: notes || '',
      address: projectAddress,
      lat,
      lng,
      stateCode: stateCode || undefined,
      city: city || undefined,
      county: county || undefined,
      zip: zip || undefined,
      utilityName: utilityName || undefined,
      utilityRatePerKwh: utilityRatePerKwh || undefined,
    });"""

if old_create_call in content:
    content = content.replace(old_create_call, new_create_call, 1)
    print("✓ Updated createProject call")
else:
    print("✗ Could not find createProject call")
    idx = content.find('createProject({')
    if idx >= 0:
        print(repr(content[idx:idx+300]))

with open('app/api/projects/route.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print(f"Done. Lines: {len(content.splitlines())}")