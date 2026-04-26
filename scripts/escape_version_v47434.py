#!/usr/bin/env python3
"""Post-processes lib/version.ts to escape single quotes inside the v47.434 description.

The bump script produced invalid TS because literal single-quotes inside the outer
'...' string terminator (e.g. 'manual', 'bill_upload') weren't escaped. Fix by
walking the file byte-by-byte, detecting the open quote that starts BUILD_DESCRIPTION,
and replacing every internal apostrophe until we hit the matching closing quote
(the one immediately followed by ';').
"""
import os
import tempfile
from pathlib import Path

path = Path("lib/version.ts")
text = path.read_text(encoding='utf-8')

# Find start of BUILD_DESCRIPTION value
anchor = "export const BUILD_DESCRIPTION = '"
start = text.find(anchor)
assert start >= 0, "BUILD_DESCRIPTION not found"
open_pos = start + len(anchor)  # points to first char inside the string

# Walk forward until we find the true end: a single-quote followed by ';'
# that is NOT escaped (i.e. not preceded by an odd number of backslashes).
i = open_pos
end_pos = None
while i < len(text):
    if text[i] == "'":
        # Count immediately preceding backslashes
        bs = 0
        k = i - 1
        while k >= 0 and text[k] == '\\':
            bs += 1
            k -= 1
        if bs % 2 == 0:  # unescaped quote
            # Check what follows: if ';' we're at the string terminator
            if i + 1 < len(text) and text[i + 1] == ';':
                end_pos = i
                break
            else:
                # Unescaped apostrophe inside the string — escape it
                text = text[:i] + "\\'" + text[i + 1:]
                i += 2  # skip past the \'
                continue
    i += 1

assert end_pos is not None, "Could not find BUILD_DESCRIPTION terminator"

tmp = tempfile.NamedTemporaryFile(
    mode='w', encoding='utf-8', delete=False, dir=str(path.parent), suffix='.ts.tmp'
)
try:
    tmp.write(text)
    tmp.flush()
    os.fsync(tmp.fileno())
    tmp.close()
    os.replace(tmp.name, path)
except Exception:
    try: os.unlink(tmp.name)
    except OSError: pass
    raise

print(f"Escaped BUILD_DESCRIPTION; end_pos={end_pos}")