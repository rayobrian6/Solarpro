#!/usr/bin/env python3
"""
Auto-increment BUILD_VERSION by 0.1 before every push.
Usage: python scripts/increment_version.py
"""
import re
import sys
from datetime import datetime

VERSION_FILE = "lib/version.ts"

def increment_version():
    """Read version file, increment BUILD_VERSION by 0.1, and write back."""
    
    with open(VERSION_FILE, 'r') as f:
        content = f.read()
    
    # Extract current BUILD_VERSION (e.g., 'v24', 'v24.1', 'v24.2')
    version_match = re.search(r"export const BUILD_VERSION = '([^']+)'", content)
    
    if not version_match:
        print("❌ ERROR: BUILD_VERSION not found in version.ts")
        sys.exit(1)
    
    current_version = version_match.group(1)
    print(f"📋 Current BUILD_VERSION: {current_version}")
    
    # Parse version number (remove 'v' prefix)
    version_num_str = current_version.replace('v', '')
    
    # Increment by 0.1
    try:
        version_num = float(version_num_str)
        new_version_num = round(version_num + 0.1, 1)
        new_version = f"v{new_version_num}"
    except ValueError:
        print(f"❌ ERROR: Invalid version format: {current_version}")
        sys.exit(1)
    
    print(f"🚀 New BUILD_VERSION: {new_version}")
    
    # Replace in content
    new_content = re.sub(
        r"export const BUILD_VERSION = '[^']+'",
        f"export const BUILD_VERSION = '{new_version}'",
        content
    )
    
    # Update BUILD_DATE to today
    today = datetime.now().strftime('%Y-%m-%d')
    new_content = re.sub(
        r"export const BUILD_DATE = '[^']+'",
        f"export const BUILD_DATE = '{today}'",
        new_content
    )
    
    # Write back
    with open(VERSION_FILE, 'w') as f:
        f.write(new_content)
    
    print(f"✅ Updated {VERSION_FILE}")
    print(f"   BUILD_VERSION: {current_version} → {new_version}")
    print(f"   BUILD_DATE: {today}")
    
    return new_version

if __name__ == "__main__":
    increment_version()