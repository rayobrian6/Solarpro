#!/usr/bin/env python3
"""Add hasEnphaseIQSC3 to SLDProfessionalInput interface in renderer."""

with open('lib/sld-professional-renderer.ts', 'r', encoding='utf-8') as f:
    src = f.read()

print(f"Loaded: {len(src)} chars")

old_tail = """  backupInterfaceIsATS?:   boolean;
  scale:                   string;"""

new_tail = """  backupInterfaceIsATS?:   boolean;
  // BUILD v24: IQ SC3 IS the ATS — suppress standalone renderATS() when true
  hasEnphaseIQSC3?:        boolean;
  scale:                   string;"""

assert old_tail in src, "interface tail not found"
src = src.replace(old_tail, new_tail, 1)
print("OK: hasEnphaseIQSC3 added to SLDProfessionalInput")

with open('lib/sld-professional-renderer.ts', 'w', encoding='utf-8') as f:
    f.write(src)

print(f"Done: {len(src)} chars")