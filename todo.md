# Cleanup Tasks

## 1. Work Queue — user can dismiss/archive items [dashboard]
- [ ] Add "Dismiss from queue" option per WorkQueueRow (soft-archive via status or flag)
- [ ] API: PATCH /api/projects/[id] to support `action=dismiss` (set queue_dismissed=true in survey_meta or a flag)

## 2. Admin — delete survey projects [admin/projects]
- [ ] Add origin filter (show survey projects) + "Delete Survey" hard-delete button in admin projects page
- [ ] Admin projects API: add `filter=survey` support to GET

## 3. System size editable after set [projects/[id]]  
- [ ] Find where system size is displayed as locked and add an edit pencil/inline edit
- [ ] PATCH /api/projects/[id]/layout or direct project update to allow system size override

## 4. Company hierarchy (org seats) — DB migration + UI
- [ ] Migration: add organizations table + org_id to users
- [ ] Settings: owner can invite members to their org
- [ ] Admin: show org structure in companies page
