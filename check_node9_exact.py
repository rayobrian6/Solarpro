#!/usr/bin/env python3
with open('lib/sld-professional-renderer.ts', 'r', encoding='utf-8') as f:
    src = f.read()

# Find the NODE 9 block
idx = src.find('NODE 9: GENERATOR + GENERATOR ATS')
if idx < 0:
    print("NODE 9 not found by text")
else:
    # Get the full block from the comment to the closing brace
    block_start = src.rfind('\n', 0, idx) + 1  # start of the line
    # Find the closing brace of the if block
    # Look for the pattern: "  }\n\n  // ── NODE 7"
    end_marker = src.find('  // ── NODE 7:', idx)
    if end_marker < 0:
        end_marker = src.find('NODE 7:', idx)
    block_end = src.rfind('\n', 0, end_marker) + 1
    
    block = src[block_start:block_end]
    print(f"Block length: {len(block)} chars")
    print("--- EXACT BLOCK ---")
    print(repr(block))