#!/usr/bin/env python3
"""
Find routes where req.json() / req.formData() is called BEFORE checkRateLimit
within the same exported async function body.
This means a malformed body can throw before the rate limit check runs.
"""

import os
import re

api_dir = 'app/api'
issues = []

for root, dirs, files in os.walk(api_dir):
    dirs[:] = [d for d in dirs if d != 'node_modules']
    for fname in files:
        if not fname.endswith('.ts'): continue
        fpath = os.path.join(root, fname)
        with open(fpath) as f:
            content = f.read()

        # Find each exported async function
        fn_pattern = re.compile(r'export async function (GET|POST|PUT|PATCH|DELETE|HEAD)\b')
        for m in fn_pattern.finditer(content):
            fn_start = m.start()
            # Find function body start (opening brace)
            brace_pos = content.find('{', fn_start)
            if brace_pos == -1:
                continue

            # Extract function body (balanced braces)
            depth = 0
            fn_end = brace_pos
            for i in range(brace_pos, len(content)):
                if content[i] == '{':
                    depth += 1
                elif content[i] == '}':
                    depth -= 1
                    if depth == 0:
                        fn_end = i
                        break

            fn_body = content[brace_pos:fn_end]

            # Find positions of req.json() and checkRateLimit in the function body
            json_match = re.search(r'req\.(?:json|formData|text)\s*\(', fn_body)
            rl_match = re.search(r'checkRateLimit\s*\(', fn_body)

            if json_match and rl_match:
                if json_match.start() < rl_match.start():
                    # req.json() appears before checkRateLimit — potential issue
                    method = m.group(1)
                    # Get line numbers
                    json_line = content[:brace_pos + json_match.start()].count('\n') + 1
                    rl_line = content[:brace_pos + rl_match.start()].count('\n') + 1
                    issues.append((fpath, method, json_line, rl_line))

for fpath, method, json_line, rl_line in sorted(issues):
    print(f'{fpath}: {method} — req.json() at line {json_line} before checkRateLimit at line {rl_line}')

print(f'\nTotal: {len(issues)} functions with body-parse before rate limit')