# Audit: Pipeline C vs Existing 3D Design Solar API Usage

## Goal
Ensure the new Pipeline C (googleSolarApi module) does NOT touch or degrade
the existing 3D design pipeline that already uses Google Solar API.

## Tasks
- [ ] Find ALL existing Google Solar API usage in the codebase (3D design pipeline)
- [ ] Catalog every file, function, env var, and API route in the existing usage
- [ ] Compare with new Pipeline C code — identify any shared state, shared env vars, shared routes, shared DB tables, shared types
- [ ] Check for conflicts: env var collisions, route collisions, type collisions, DB write collisions
- [ ] Fix any conflicts found — ensure complete isolation between pipelines
- [ ] Run three-check suite after any fixes
- [ ] Commit and push if changes needed
