with open('lib/sld-professional-renderer.ts', 'r') as f:
    content = f.read()

# Find the exact renderGenerator function block
import re

# Use regex to find and replace the function
pattern = r'(// Generator Symbol \(IEEE 315 / ANSI\) - circle with G inside\nfunction renderGenerator\(\n  cx: number, cy: number,\n  brand: string, model: string, kw: number, calloutN: number\n\): \{svg: string; lx: number; rx: number; ty: number; by: number\} \{)(.*?)(  return \{svg: p\.join\(''\), lx: cx - r, rx: cx \+ r \+ 10, ty: cy - r, by: cy \+ r\};\n\})'

replacement = r'''// Generator Symbol (IEEE 315 / ANSI) - circle with G inside
// Terminal GEN_OUT: right side lug — AC output connecting to ATS GEN or BUI GEN port
function renderGenerator(
  cx: number, cy: number,
  brand: string, model: string, kw: number, calloutN: number
): {svg: string; lx: number; rx: number; ty: number; by: number;
    genOutX: number; genOutY: number} {\2  // GEN_OUT terminal — right side lug (wire exits rightward to ATS GEN or BUI GEN port)
  const genOutX = cx + r + 10;
  const genOutY = cy;
  p.push(txt(cx + r + 2, cy - 7, 'GEN OUT', {sz: 4, anc: 'start', fill: GEN_CLR}));

  return {svg: p.join(''), lx: cx - r, rx: genOutX, ty: cy - r, by: cy + r,
          genOutX, genOutY};
}'''

new_content, count = re.subn(pattern, replacement, content, flags=re.DOTALL)
if count:
    print(f"✅ renderGenerator patched ({count} replacement)")
else:
    print("❌ Pattern not found, trying direct approach")
    # Direct approach: find the return line and replace it
    old_ret = "  return {svg: p.join(''), lx: cx - r, rx: cx + r + 10, ty: cy - r, by: cy + r};\n}\n\n// ATS Symbol"
    new_ret = """  // GEN_OUT terminal — right side lug (wire exits rightward to ATS GEN or BUI GEN port)
  const genOutX = cx + r + 10;
  const genOutY = cy;
  p.push(txt(cx + r + 2, cy - 7, 'GEN OUT', {sz: 4, anc: 'start', fill: GEN_CLR}));

  return {svg: p.join(''), lx: cx - r, rx: genOutX, ty: cy - r, by: cy + r,
          genOutX, genOutY};
}

// ATS Symbol"""
    if old_ret in content:
        new_content = content.replace(old_ret, new_ret)
        # Also fix the signature
        old_sig = '): {svg: string; lx: number; rx: number; ty: number; by: number} {\n  const GEN_CLR'
        new_sig = '): {svg: string; lx: number; rx: number; ty: number; by: number;\n    genOutX: number; genOutY: number} {\n  const GEN_CLR'
        new_content = new_content.replace(old_sig, new_sig, 1)
        print("✅ renderGenerator patched via direct approach")
    else:
        print("❌ Direct approach also failed")
        new_content = content

with open('lib/sld-professional-renderer.ts', 'w') as f:
    f.write(new_content)

print("Done.")