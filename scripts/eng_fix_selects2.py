#!/usr/bin/env python3
"""
Fix <select> elements that have className="eng-input" → className="eng-select"
Uses regex to find <select ...> blocks spanning multiple lines.
"""
import re

TARGET = 'app/engineering/page.tsx'

with open(TARGET, 'r', encoding='utf-8') as f:
    src = f.read()

original = src

# Match <select followed by any content including newlines until >
# and replace eng-input inside it with eng-select
# Strategy: find all <select...> opening tags (potentially multi-line)
# Pattern: <select followed by anything until the closing >

def fix_select_classnames(text):
    """Replace eng-input with eng-select when inside a <select ...> opening tag."""
    result = []
    i = 0
    changes = 0
    while i < len(text):
        # Find next <select
        sel_start = text.find('<select', i)
        if sel_start == -1:
            result.append(text[i:])
            break
        
        # Append everything up to <select
        result.append(text[i:sel_start])
        
        # Find the closing > of this select tag (not </select>)
        # We need to find the end of the opening tag
        j = sel_start + 7  # after '<select'
        depth = 0
        tag_end = -1
        while j < len(text):
            c = text[j]
            if c == '>' and depth == 0:
                tag_end = j
                break
            elif c == '{':
                depth += 1
            elif c == '}':
                depth -= 1
            j += 1
        
        if tag_end == -1:
            # Didn't find closing, just append from sel_start
            result.append(text[sel_start:])
            break
        
        # Get the opening tag content
        opening_tag = text[sel_start:tag_end+1]
        
        # Replace eng-input with eng-select inside this opening tag
        if 'eng-input' in opening_tag:
            new_tag = opening_tag.replace('className="eng-input"', 'className="eng-select"')
            # also handle className="eng-input text-xs" etc
            new_tag = re.sub(r'className="eng-input([^"]*)"', r'className="eng-select\1"', new_tag)
            if new_tag != opening_tag:
                changes += 1
            result.append(new_tag)
        else:
            result.append(opening_tag)
        
        i = tag_end + 1
    
    return ''.join(result), changes

src, changes = fix_select_classnames(src)

with open(TARGET, 'w', encoding='utf-8') as f:
    f.write(src)

remaining = src.count('className="eng-input"')
eng_sel = src.count('className="eng-select"')
print(f"Fixed {changes} <select> elements: eng-input -> eng-select")
print(f"  Remaining eng-input: {remaining}")
print(f"  eng-select count:    {eng_sel}")