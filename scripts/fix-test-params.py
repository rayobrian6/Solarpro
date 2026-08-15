#!/usr/bin/env python3
"""
Mechanical fix for test files that pass { params: { id: '...' } } to Next 15
route handlers which now expect { params: Promise.resolve({ id: '...' }) }.

Strategy:
- Find `params: {`
- Replace with `params: Promise.resolve({`
- Find the matching `}` (track braces, skip those inside strings)
- Replace the matching `}` with `})`

This converts `params: { ... }` -> `params: Promise.resolve({ ... })`.
"""
import re
from pathlib import Path


def transform(text: str) -> tuple[str, int]:
    count = 0
    out = []
    i = 0
    n = len(text)
    while i < n:
        # Find next `params: {` (or `params:{`)
        m = re.search(r"\bparams\s*:\s*\{", text[i:])
        if not m:
            out.append(text[i:])
            break
        # Check we haven't already wrapped this one (skip if `Promise.resolve(` precedes)
        # Heuristic: look at the 20 chars before to see if "Promise.resolve" is there.
        prefix_start = max(0, i + m.start() - 20)
        prefix = text[prefix_start : i + m.start()]
        if "Promise.resolve" in prefix:
            # Already wrapped — skip this match
            out.append(text[i : i + m.end()])
            i = i + m.end()
            continue
        # Append everything up to `params: ` (keep the `params: ` literal)
        out.append(text[i : i + m.start()])
        # Emit `params: Promise.resolve({` instead of `params: {`
        out.append("params: Promise.resolve({")
        # Now find matching `}` starting AFTER the `{` we just consumed.
        brace_start = i + m.end()  # position right after the `{`
        depth = 1
        j = brace_start
        in_str = None
        while j < n and depth > 0:
            c = text[j]
            if in_str:
                if c == "\\":
                    j += 2
                    continue
                if c == in_str:
                    in_str = None
            else:
                if c in ("'", '"', "`"):
                    in_str = c
                elif c == "{":
                    depth += 1
                elif c == "}":
                    depth -= 1
            j += 1
        if depth != 0:
            # Unbalanced — give up, append rest as-is.
            out.append(text[brace_start - 1 :])  # include the `{`
            break
        # text[brace_start:j-1] is the params value, text[j-1] is the `}`.
        # Emit the value, then `})` (which closes Promise.resolve). The closing
        # `}` has already been consumed (i is set to j, which is past the `}`).
        out.append(text[brace_start : j - 1])
        out.append("})")
        count += 1
        i = j  # j points past the `}`
    return "".join(out), count


def main():
    root = Path(r"C:\Users\carpe\Solarpro")
    targets = []
    for p in root.rglob("*.test.ts"):
        rel = p.relative_to(root).as_posix()
        if rel.startswith("node_modules/") or "/.next/" in rel:
            continue
        if rel.startswith("tests/") or rel.startswith("lib/") or "/__tests__/" in rel or "/test/" in rel:
            targets.append(p)

    print(f"Found {len(targets)} test files")
    total_count = 0
    for p in targets:
        text = p.read_text(encoding="utf-8")
        new, count = transform(text)
        if count > 0:
            p.write_text(new, encoding="utf-8")
            print(f"  {p.relative_to(root)}: {count} sites")
            total_count += count
    print(f"Total sites wrapped: {total_count}")


if __name__ == "__main__":
    main()
