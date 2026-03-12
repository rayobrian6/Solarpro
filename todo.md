# Bill Parser Pipeline Audit — v47.4

## Root Causes Identified & Fixed

### 1. Utility Detection (billParser.ts — extractUtility)
- U1 header search expanded: 500 → 1000 chars (OCR noise pushes utility name past 500)
- U3 generic pattern: removed `[A-Z]` anchor → now handles all-caps OCR text
- Added debug log of first 300 OCR chars + match snippet for every detection

### 2. Rate Detection (billParser.ts — extractRate)
- Hardened "@" pattern: now handles OCR-mangled variants (©, a, 4, at)
- Added 7 new patterns: inline rate, rate before kWh, line-item rates, word "at"
- Collect ALL candidates, prefer residential range ($0.08–$0.45) for best pick
- CMP test: correctly detects $0.12534/kWh from "kWh @ $0.12534"

### 3. P2 Handwritten List (billParser.ts)
- Minimum monthly value raised: 10 → 50 kWh
- Prevents day numbers (1–31) and small values from matching as monthly usage

### 4. New England Utilities (utility-rules.ts)
- Added to UTILITY_REGISTRY: Central Maine Power, Versant Power, Eversource,
  National Grid, Green Mountain Power, Unitil (with full interconnection rules)
- Added to UTILITY_RETAIL_RATES: CMP $0.198, Versant $0.198, Eversource $0.248,
  National Grid $0.248, GMP $0.198, Unitil $0.228
- Added getUtilityRules() aliases: all CMP/Versant/Eversource/NationalGrid variants

### 5. OpenAI Vision Prompt (billOcrEngine.ts)
- Expanded prompt: explicitly mentions CMP utility name, monthly usage table format,
  rate line format, service address — all critical for CMP bill extraction

## Verified Test Results
- parseBill(cmpText): utility="Central Maine Power" (U1, conf=0.97) ✓
- parseBill(cmpText): rate=$0.1253/kWh (kwh_at_rate pattern) ✓
- parseBill(cmpText): 12 months extracted, annual=5895 kWh ✓
- getUtilityRules("Central Maine Power") → id=central-maine-power ✓
- getUtilityRules("CENTRAL MAINE POWER") → id=central-maine-power ✓
- getUtilityRules("Central Maine Power Co.") → id=central-maine-power ✓
- validateAndCorrectUtilityRate(null, "CMP") → $0.198 from utility_db ✓
- validateAndCorrectUtilityRate(0.03, "CMP") → $0.198 corrected ✓
- TypeScript: zero errors ✓

## Tasks
- [x] Audit all pipeline files
- [x] Fix 1: billParser.ts — expand U1 to 1000 chars; fix U3 case-insensitive
- [x] Fix 2: billParser.ts — harden rate extraction (OCR-robust, multi-candidate)
- [x] Fix 3: billParser.ts — raise P2 minimum from 10 → 50 kWh
- [x] Fix 4: billParser.ts — debug log utility candidate snippet
- [x] Fix 5: utility-rules.ts — add CMP + all NE utilities to UTILITY_REGISTRY
- [x] Fix 6: utility-rules.ts — add NE rates to UTILITY_RETAIL_RATES + getUtilityRules aliases
- [x] Fix 7: billOcrEngine.ts — improve Vision prompt for CMP-style bills
- [x] TypeScript check — zero errors
- [x] Bump to v47.4, git commit + push