# Version Management System

## Overview
Every commit automatically increments the BUILD_VERSION by 0.1. This makes it easy to verify if a deployment includes your changes by checking the badge.

## How It Works

### Auto-Increment Mechanism
1. **Pre-commit Hook**: `.git/hooks/pre-commit` runs automatically before every commit
2. **Python Script**: `scripts/increment_version.py` increments BUILD_VERSION by 0.1
3. **Version File**: `lib/version.ts` is updated with new version and date

### Version Format
- Format: `v{major}.{minor}` (e.g., `v24.3`, `v24.4`)
- Increment: +0.1 on every commit
- Date: Auto-updated to current date (YYYY-MM-DD)

### Badge Display Locations
The BUILD_VERSION appears in two places:
1. **Engineering Schematics page header**: `BUILD v24.3`
2. **SLD renderer title block badge**: `BUILD v24.3 — NEC CONDUCTOR SIZING ENGINE`

## Usage

### Check Current Version
```bash
cat lib/version.ts
```

### Check Deployed Version
1. Visit the engineering page
2. Look at the green badge showing "BUILD v{version}"
3. Compare with your local version to verify deployment

### Manual Version Increment (if needed)
```bash
python3 scripts/increment_version.py
```

### Disable Auto-Increment (if needed)
To disable auto-increment temporarily:
```bash
chmod -x .git/hooks/pre-commit
```

To re-enable:
```bash
chmod +x .git/hooks/pre-commit
```

## Files

- `lib/version.ts` - Single source of truth for BUILD_VERSION
- `scripts/increment_version.py` - Python script to increment version
- `.git/hooks/pre-commit` - Git hook that runs before each commit

## Example Workflow

```bash
# Make code changes
vim lib/computed-system.ts

# Commit (version auto-increments from v24.3 to v24.4)
git add lib/computed-system.ts
git commit -m "fix: conductor callout formatting"
# Output:
# 🔁 Auto-incrementing BUILD_VERSION...
# 📋 Current BUILD_VERSION: v24.3
# 🚀 New BUILD_VERSION: v24.4
# ✅ Updated lib/version.ts
#    BUILD_VERSION: v24.3 → v24.4

# Push to trigger Vercel deployment
git push origin master

# Deployment badge will show: BUILD v24.4
```

## Troubleshooting

### Version not incrementing
Check if pre-commit hook is executable:
```bash
ls -la .git/hooks/pre-commit
```

Should show `-rwxr-xr-x` (executable).

### Version showing incorrectly on deployment
1. Check version.ts in deployed commit
2. Clear browser cache
3. Wait for Vercel deployment to complete
4. Check Vercel deployment logs for errors

### Need to skip version increment
Use `--no-verify` flag:
```bash
git commit --no-verify -m "message"
```

## History

| Version | Date | Description |
|---------|------|-------------|
| v24 | 2026-03-06 | Initial BUILD v24 |
| v24.1 | 2026-03-06 | Engineering page badge fix |
| v24.2 | 2026-03-06 | SLD conductor callout format fix |
| v24.3 | 2026-03-06 | Auto-increment version system added |