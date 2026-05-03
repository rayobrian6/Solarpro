# Full Audit: Why 44×1 Strings Appear in config.inverters

## Summary of Findings

The 44 × panelCount=1 strings originate from the **panel count fix path** inside the
sync-pipeline effect, combined with a **stale auto-saved engineeringConfig** that
freezes the broken state permanently in the DB.

---

## Root Cause Chain

### Step 1 — Panel count fix path: micro-type fallback creates N×1 strings

**File**: `app/engineering/page.tsx` lines 4694–4735 (inside sync-pipeline useEffect)

The fix path reads:
```javascript
const _pcInvType = _pcInv0?.type ?? 'string';   // 'ecoflow', 'micro', 'hybrid', etc.
const _pcInverterId = _pcInv0?.inverterId ?? ''; // can be '' if config is defaultProject
```

Then calls the sizing engine:
```javascript
sizeSystemFromBrand({ selectedInverterId: _pcInverterId, ... })
```

**If `_pcInverterId` is empty** (`''`) or unrecognized:
```
sizeSystemFromBrand({ selectedInverterId: '' }) → topology: 'micro', strings: []
```

Since `strings.length === 0`, `_pcEngStrings` stays null. Falls to fallback:
```javascript
const _pcPps = _pcInvType === 'micro' ? 1 : Math.min(_pcPc, 14);
const _pcSc  = _pcInvType === 'micro' ? _pcPc : Math.ceil(_pcPc / _pcPps);
```

**If `_pcInvType === 'micro'`** (user previously selected micro topology, or config loaded
from a saved EcoFlow config that maps to 'ecoflow'/'micro'):
- `_pcPps = 1` (1 panel per string)
- `_pcSc = 44` (44 strings)
- Result: **44 strings × panelCount=1 each** → THE BUG

The EcoFlow case: `type === 'ecoflow'` does NOT hit the micro branch (condition is `=== 'micro'`)
so for EcoFlow it creates `Math.min(44, 14) = 14` panels/string → 4 strings. But for any
project that ever had `type === 'micro'` and then loaded 44 panels, this creates 44×1.

### Step 2 — Panel count fix path: ALL strings go into inverters[0] only

```javascript
const newInverters = prev.inverters.map((inv, ii) => {
  if (ii === 0) {
    const newStrings = _pcFinalStrings.map((s, si) => {
      const existing = inv.strings[si] || inv.strings[0];
      return { ...existing, id: existing?.id || `str-sync-${si}`, panelCount: s.panelCount };
    });
    return { ...inv, strings: newStrings };
  }
  return inv;  // ← other inverters UNTOUCHED (stale)
});
```

- Completely ignores `inverterIndex` from sizing engine output
- For EcoFlow recommended config (3 inverters: [8+8, 7+7, 7+7]), ALL 6 engine strings
  go into `prev.inverters[0]`, while `prev.inverters[1]` and `[2]` keep their OLD (stale) strings
- For EcoFlow OCEAN Pro single-inverter (8 strings: 6+6+6+6+5+5+5+5), it works correctly
  since there's only 1 inverter anyway

### Step 3 — storedStrings panelCount=0 fallback (Path C secondary issue)

**File**: `app/engineering/page.tsx` line 1256

```javascript
panelCount: s.panelCount || s.panel_count || 1,
```

If the engineering report in DB has string_config entries with `panelCount: 0` (generated
from micro or panel-swap migrations), the `|| 1` fallback fires and creates strings with
panelCount=1. For 44 stored strings, this produces 44×1.

### Step 4 — Auto-save locks in the corrupt state forever

Auto-save fires 800ms after any config change:
```javascript
useEffect(() => {
  if (!isHydrated) return;
  // Saves entire config to DB
  fetch('/api/engineering/save-config', { body: JSON.stringify(config) });
}, [config, currentProjectId, isHydrated]);
```

Once 44×1 strings are written to `config.inverters` by either Step 1 or Step 3,
they are immediately auto-saved to the DB as `engineeringConfig`.

On the next page load:
- **Path D (savedConfig)** runs: `setConfig({ ...prev, ...savedConfig })`
- Restores the corrupt 44×1 state from DB
- The reconciliation (v61.2 fix) only runs when `stringsPerInverter` metadata is set
  on inverters — strings from the panel count fix path or storedStrings path NEVER have
  `stringsPerInverter` set, so reconciliation does nothing
- The panel count fix path then runs AGAIN, potentially re-corrupting the state

**This is why every attempted fix has been ineffective**: the corrupt state is baked into
the DB and the load path restores it before any fix can run.

### Step 5 — Auto-apply is blocked by user lock

The auto-apply watcher checks `config.userHasEditedInverters`:
```javascript
if (config.userHasEditedInverters) {
  console.log('blocked — user config is source of truth');
  return;
}
```

Any prior user interaction sets `userHasEditedInverters = true`. So even when the sizing
engine correctly recommends `8 strings × [6,6,6,6,5,5,5,5]` for a single EcoFlow inverter,
auto-apply never fires and the corrupt 44×1 state persists.

---

## All Config.inverters Write Paths

| Path | ID | Multi-inverter? | inverterIndex aware? | Bug risk |
|------|-----|-----------------|---------------------|----------|
| A: engineeringSeed | inv-seed-0 | NO (1 inverter) | NO | Medium |
| B: layout fallback | inv-auto-0 | NO (1 inverter) | NO | Low |
| C: fileId reverse hydration | inv-restored-0 | NO (1 inverter) | NO | **HIGH** — panelCount\|\|1 |
| D: savedConfig (DB restore) | from DB | Whatever was saved | N/A | **HIGH** — perpetuates corruption |
| E: applySizingRecommendation | inv-applied-* | YES | YES ✓ | None (correct) |
| F: panel count fix path | inline | NO (inverters[0] only) | NO | **CRITICAL** |
| G: updateInverter (dropdown) | existing IDs | per-inverter | N/A | Fixed in cada02f |
| H: addInverter | inv-{ts} | 1 new card | N/A | Low |
| I: DC/AC auto-heal | calls apply | YES (via E) | YES ✓ | None |

---

## Sizing Engine Test Results

For 44 panels + EcoFlow:

```
selectedInverterId: 'ecoflow-ocean-pro-11kw'
→ topology: hybrid, inverterCount: 1
→ strings: [6,6,6,6,5,5,5,5] (8 strings, all inverterIndex:0)

selectedBrand: 'ecoflow'  (auto-tier)
→ topology: hybrid, inverterCount: 3
→ strings: [8,8] (inv0), [7,7] (inv1), [7,7] (inv2) — uses legacy PowerOcean 5kW

selectedInverterId: ''  (empty)
→ topology: micro, inverterCount: 44, strings: []  ← TRIGGERS THE BUG
```

---

## Definitive Fix Plan

### Fix 1 (CRITICAL): Replace panel count fix path with applySizingRecommendation call

The cleanest fix: instead of the panel count fix path's hand-rolled sizing logic,
call `applySizingRecommendation` when layout.panelCount differs AND user hasn't locked:

```javascript
if (layout.panelCount > 0 && currentTotal !== layout.panelCount) {
  if (!config.userHasEditedInverters) {
    // Let the sizing engine + applySizingRecommendation handle it correctly
    const brand = config.selectedBrand || 'ecoflow';
    const rec = sizeSystemFromBrand({ selectedBrand: brand, panelCount: layout.panelCount, ... });
    applySizingRecommendation(rec);
  } else {
    // User has locked — just show mismatch banner, don't auto-fix
    console.warn('[PANEL COUNT MISMATCH] user lock active, not auto-fixing');
  }
}
```

But `applySizingRecommendation` is a useCallback defined AFTER the sync-pipeline effect,
so the cleanest path is to move the panel count fix INTO the auto-apply watcher, or
to extract a `rebuildInvertersFromRec(rec)` helper.

### Fix 2 (CRITICAL): Guard the micro fallback in panel count fix path

Immediate surgical fix — add `type !== 'micro'` guard to prevent the 1-panel-per-string fallback:

```javascript
// BEFORE fallback:
if (!_pcEngStrings) {
  if (_pcInvType === 'micro') {
    // Micro: update total panel count on existing single string
    setConfig(prev => ({
      ...prev,
      inverters: prev.inverters.map((inv, ii) => ii === 0
        ? { ...inv, strings: [{ ...inv.strings[0], panelCount: _pcPc }] }
        : inv
      ),
    }));
    return; // Don't fall through
  }
  // String/optimizer/hybrid fallback:
  const _pcPps = Math.min(_pcPc, 14);
  const _pcSc  = Math.max(1, Math.ceil(_pcPc / _pcPps));
  _pcEngStrings = Array.from(...);
}
```

### Fix 3 (CRITICAL): Add inverterIndex grouping to panel count fix path

The panel count fix must group strings by `inverterIndex`, mirroring `applySizingRecommendation`:

```javascript
// Group _pcEngStrings (which have inverterIndex) by inverter
const stringsByInv = new Map();
for (const s of _pcFinalStrings) {
  const idx = s.inverterIndex ?? 0;
  if (!stringsByInv.has(idx)) stringsByInv.set(idx, []);
  stringsByInv.get(idx).push(s);
}
setConfig(prev => {
  const invCount = Math.max(prev.inverters.length, stringsByInv.size);
  const newInverters = Array.from({ length: invCount }, (_, idx) => {
    const inv = prev.inverters[idx] ?? prev.inverters[0];
    const assigned = stringsByInv.get(idx) ?? [];
    const strings = assigned.map((s, si) => ({
      ...(inv.strings[si] ?? inv.strings[0]),
      id: `str-sync-${idx}-${si}`,
      panelCount: s.panelCount,
    }));
    return { ...inv, strings: strings.length ? strings : inv.strings };
  });
  return { ...prev, inverters: newInverters };
});
```

### Fix 4 (MEDIUM): Path C — guard storedStrings panelCount=0

```javascript
// Line 1256: replace
panelCount: s.panelCount || s.panel_count || 1,
// with:
panelCount: Number(s.panelCount ?? s.panel_count ?? 0) || 1,
```
And add a post-load check: if ALL strings have panelCount=1 AND total < systemPanelCount,
the stored strings are corrupt — fall through to sizing-engine reconstruction.

### Fix 5 (MEDIUM): Reconciliation without stringsPerInverter

Add a corruption detector to the savedConfig hydration path:

```javascript
// After loading savedConfig, detect 1-panel-per-string corruption:
const hasCorruptStrings = merged.inverters?.every(inv =>
  inv.strings?.every(s => s.panelCount === 1)
) && merged.inverters?.flatMap(i => i.strings).length > 4;

if (hasCorruptStrings && systemPanelCount > 0) {
  // Trigger rebuild via applySizingRecommendation on next tick
  setNeedsRebuild(true);
}
```

---

## Why Previous Fixes Failed

1. **cada02f (stringsPerInverter resize)**: Fixed the UI dropdown not resizing arrays,
   but the 44×1 state was already saved in DB. Next load restored it from DB.

2. **73371f6 (reconciliation on load)**: Reconciliation only triggers when `inv.stringsPerInverter`
   is explicitly set. Strings from the panel count fix path or storedStrings NEVER have this
   metadata, so reconciliation never fired for the corrupt state.

3. **No fix has poisoned the auto-save loop**: After any fix runs on the in-memory state,
   the correct state would auto-save over the corrupt DB record — but only if the fix runs
   BEFORE the corrupt state is written. The panel count fix path runs AFTER savedConfig hydration
   and potentially re-corrupts the just-loaded state, auto-saving the bad state again.

## Recommended Implementation Order

1. Apply Fix 2 (micro guard) — prevents new 44×1 from being generated
2. Apply Fix 3 (inverterIndex grouping) — correct multi-inverter panel count fix
3. Apply Fix 5 (corruption detector) — cleans up existing DB records
4. Optionally apply Fix 4 (Path C panelCount guard)
5. Consider Fix 1 (use applySizingRecommendation directly) as the cleanest long-term approach