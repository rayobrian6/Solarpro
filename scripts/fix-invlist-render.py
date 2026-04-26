path = 'app/engineering/page.tsx'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

old = "inv.type === 'string' ? ` (${(i as any).acOutputKw}kW)` : ` (${(i as any).acOutputW}W)`"
new = "(inv.type === 'string' || inv.type === 'ecoflow' || inv.type === 'optimizer') ? ` (${(i as any).acOutputKw}kW)` : ` (${(i as any).acOutputW}W)`"

if old not in content:
    print("MARKER NOT FOUND")
    exit(1)
content = content.replace(old, new, 1)
with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print("OK - patched invList render")