content = open('lib/system-state.ts').read()

# Find and remove the duplicate TopologyType definition
# It starts at "// ─── Topology Types" and ends at the semicolon after ROOF_RAIL_LESS
start_marker = "// ─── Topology Types ─"
end_marker = "  | 'ROOF_RAIL_LESS';          // Rail-less roof mount\n"

start_idx = content.find(start_marker)
end_idx = content.find(end_marker)

if start_idx == -1:
    print("Start marker not found, trying alternate...")
    # Try finding the export type TopologyType directly
    start_marker = "\nexport type TopologyType ="
    start_idx = content.find(start_marker)

if start_idx != -1 and end_idx != -1:
    end_idx += len(end_marker)
    removed = content[start_idx:end_idx]
    print(f"Removing {len(removed)} chars from pos {start_idx} to {end_idx}")
    print("First 100 chars of removed:", repr(removed[:100]))
    content = content[:start_idx] + "// TopologyType — imported from equipment-registry.ts\n\n" + content[end_idx:]
    open('lib/system-state.ts', 'w').write(content)
    print("Done!")
else:
    print(f"start_idx={start_idx}, end_idx={end_idx}")
    # Show what's around line 10-30
    lines = content.split('\n')
    for i, line in enumerate(lines[8:32], 9):
        print(f"{i:3}: {repr(line)}")