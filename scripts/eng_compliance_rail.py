#!/usr/bin/env python3
"""
Replace ComplianceSummaryBar with premium precision rail v53.0
"""

TARGET = 'app/engineering/page.tsx'

with open(TARGET, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Find the ComplianceSummaryBar function (line 4641 = index 4640)
# Find exact start and end
start_idx = None
end_idx = None

for i, line in enumerate(lines):
    if 'const ComplianceSummaryBar = () => (' in line:
        start_idx = i
    if start_idx is not None and i > start_idx:
        # The function ends at the closing ); on its own line
        stripped = line.strip()
        if stripped == ');' and i > start_idx + 5:
            end_idx = i
            break

print(f"ComplianceSummaryBar: lines {start_idx+1}–{end_idx+1}")

NEW_BAR = r"""    const ComplianceSummaryBar = () => {
      const overallStatus = (() => {
        const a = compliance.overallStatus;
        const b = rulesResult?.overallStatus;
        if (!a && !b) return null;
        if (a === 'FAIL' || b === 'FAIL') return 'FAIL';
        if (a === 'WARNING' || b === 'WARNING') return 'WARNING';
        return a || b || 'PASS';
      })();
      const segCls = (s: string | null | undefined) => {
        if (s === 'FAIL') return 'fail';
        if (s === 'WARNING') return 'warn';
        if (s === 'PASS') return 'pass';
        return '';
      };
      return (
        <div className="compliance-rail">
          {/* Overall segment */}
          <div className={`compliance-segment ${segCls(overallStatus)}`}>
            <span className="compliance-segment-label">Overall</span>
            <span className="compliance-segment-value">
              {overallStatus ?? <span style={{color:'rgba(148,163,184,0.4)'}}>—</span>}
            </span>
            {overallStatus === 'FAIL' && <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />}
            {overallStatus === 'WARNING' && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse flex-shrink-0" />}
          </div>

          {/* Electrical segment */}
          <div className={`compliance-segment ${segCls(compliance.electrical?.status)}`}>
            <span className="compliance-segment-label">Elec</span>
            <span className="compliance-segment-value">
              {compliance.electrical?.status ?? <span style={{color:'rgba(148,163,184,0.4)'}}>—</span>}
            </span>
          </div>

          {/* Structural segment */}
          <div className={`compliance-segment ${segCls(compliance.structural?.status)}`}>
            <span className="compliance-segment-label">Struct</span>
            <span className="compliance-segment-value">
              {compliance.structural?.status ?? <span style={{color:'rgba(148,163,184,0.4)'}}>—</span>}
            </span>
          </div>

          {/* Rules engine counts */}
          {rulesResult && (
            <div className="compliance-segment">
              {rulesResult.errorCount > 0 && (
                <span className="text-[11px] font-bold text-red-400 tabular-nums">
                  {rulesResult.errorCount}E
                </span>
              )}
              {rulesResult.warningCount > 0 && (
                <span className="text-[11px] font-bold text-amber-400 tabular-nums ml-1">
                  {rulesResult.warningCount}W
                </span>
              )}
              {rulesResult.autoFixCount > 0 && (
                <span className="text-[11px] text-emerald-400 tabular-nums ml-1">
                  {rulesResult.autoFixCount} fixed
                </span>
              )}
              {overrides.length > 0 && (
                <span className="text-[11px] text-blue-400 ml-1">
                  {overrides.length} ovr
                </span>
              )}
              {rulesResult.errorCount === 0 && rulesResult.warningCount === 0 && (
                <span className="compliance-segment-value pass">✓ Clean</span>
              )}
            </div>
          )}

          {/* Jurisdiction segment */}
          {compliance.jurisdiction && (
            <div className="compliance-segment">
              <MapPin size={10} className="text-amber-400/70 flex-shrink-0" />
              <span className="compliance-segment-label">{compliance.jurisdiction.state}</span>
              <span className="text-[11px] text-slate-400 font-mono">NEC {compliance.jurisdiction.necVersion}</span>
            </div>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Config dirty indicator */}
          {configDirty && !calculating && (
            <div className="compliance-segment">
              <AlertCircle size={10} className="text-amber-400/70" />
              <span className="text-[11px] text-amber-400/70 font-semibold">Unsaved</span>
            </div>
          )}

          {/* Calculating / Recalculate */}
          {calculating ? (
            <div className="compliance-segment">
              <RefreshCw size={10} className="animate-spin text-blue-400" />
              <span className="text-[11px] text-blue-400">Running…</span>
            </div>
          ) : (
            <button
              onClick={runCalc}
              className="compliance-segment hover:bg-white/5 transition-colors cursor-pointer"
            >
              <RefreshCw size={10} className="text-slate-500" />
              <span className="text-[11px] text-slate-400 hover:text-white transition-colors">Recalc</span>
            </button>
          )}
        </div>
      );
    };
"""

new_lines = lines[:start_idx] + [NEW_BAR + '\n'] + lines[end_idx+1:]

with open(TARGET, 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

print(f"✅ ComplianceSummaryBar replaced ({end_idx - start_idx + 1} old lines → 1 block)")