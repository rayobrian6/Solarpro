// ── Utility Programs Panel (v48.29) ──────────────────────────────────────────────────────────────
// Status badge for program lifecycle state
function ProgramStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    active:   { label: 'Active',   cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
    pilot:    { label: 'Pilot',    cls: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30' },
    limited:  { label: 'Limited',  cls: 'bg-orange-500/20 text-orange-300 border-orange-500/30' },
    waitlist: { label: 'Waitlist', cls: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
    expired:  { label: 'Expired',  cls: 'bg-slate-500/20 text-slate-400 border-slate-500/30' },
  };
  const cfg = map[status] ?? map.active;
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

// Individual expandable program row — shows name, status, value, enroll link, and collapsible Pro Tip
function ProgramRow({
  icon, title, subtitle, value, status, enrollUrl, note, lastVerified, accent,
}: {
  icon: string; title: string; subtitle?: string; value?: string;
  status?: string; enrollUrl?: string; note: string; lastVerified?: string; accent: string;
}) {
  const [tipOpen, setTipOpen] = React.useState(false);
  return (
    <div className={`rounded-lg border ${accent} bg-white/[0.02] overflow-hidden`}>
      <div className="flex items-start gap-2 px-2.5 pt-2 pb-1.5">
        <span className="text-sm flex-shrink-0 mt-0.5">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
            <span className="text-xs font-semibold text-white leading-tight">{title}</span>
            {status && <ProgramStatusBadge status={status} />}
          </div>
          {subtitle && <p className="text-[11px] text-slate-400 leading-snug">{subtitle}</p>}
          {value && (
            <p className="text-[11px] text-emerald-300 font-medium mt-0.5 leading-snug">{value}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0 ml-1">
          {enrollUrl && (
            <a
              href={enrollUrl} target="_blank" rel="noopener noreferrer"
              className="text-[10px] text-violet-400 hover:text-violet-300 underline whitespace-nowrap transition-colors"
            >
              Enroll →
            </a>
          )}
          <button
            onClick={() => setTipOpen(o => !o)}
            title="Toggle Pro Tip"
            className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
              tipOpen
                ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                : 'bg-white/5 border-white/10 text-slate-400 hover:text-amber-300 hover:border-amber-500/30'
            }`}
          >
            💡 {tipOpen ? 'Hide' : 'Pro Tip'}
          </button>
        </div>
      </div>
      {tipOpen && (
        <div className="mx-2.5 mb-2 px-2.5 py-2 bg-amber-500/[0.08] border border-amber-500/20 rounded-lg">
          <div className="flex gap-1.5">
            <span className="text-amber-400 text-xs flex-shrink-0 mt-0.5">💡</span>
            <div>
              <p className="text-[11px] text-amber-100/90 leading-relaxed">{note}</p>
              {lastVerified && (
                <p className="text-[10px] text-slate-500 mt-1">Last verified: {lastVerified}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Collapsible section wrapper (TOU / Battery / Solar / NEM)
function ProgramSection({
  sectionIcon, title, count, children, defaultOpen = true,
}: {
  sectionIcon: string; title: string; count: number; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.015] overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-2.5 py-1.5 hover:bg-white/5 transition-colors text-left"
      >
        <div className="flex items-center gap-1.5">
          <span className="text-sm">{sectionIcon}</span>
          <span className="text-[11px] font-semibold text-slate-200">{title}</span>
          <span className="text-[10px] text-slate-500 bg-white/5 border border-white/10 rounded px-1">{count}</span>
        </div>
        <span className="text-slate-500 text-xs">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="px-2 pb-2 space-y-1.5 border-t border-white/5 pt-1.5">
          {children}
        </div>
      )}
    </div>
  );
}

// Top-level panel — takes a resolved UtilityProgramBundle + utility display name
function UtilityProgramsPanel({ programs, utilityName }: { programs: UtilityProgramBundle; utilityName: string }) {
  const [panelOpen, setPanelOpen] = React.useState(true);
  const touCount = programs.tou_plans.length;
  const batteryCount = programs.battery_incentives.length;
  const solarCount = programs.solar_rebates.length;
  const nemCount = programs.nem_programs.length;
  const totalCount = touCount + batteryCount + solarCount + nemCount;
  if (totalCount === 0) return null;

  return (
    <div className="mt-2 rounded-xl border border-violet-500/25 bg-violet-500/[0.04] overflow-hidden">
      <button
        onClick={() => setPanelOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/5 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm">⚡</span>
          <span className="text-xs font-bold text-violet-300">{utilityName} — Programs & Rate Plans</span>
          <span className="text-[10px] text-violet-400/70 bg-violet-500/10 border border-violet-500/20 rounded px-1.5 py-0.5">
            {totalCount} program{totalCount !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500">tap 💡 for rep guidance</span>
          <span className="text-slate-500 text-xs">{panelOpen ? '▾' : '▸'}</span>
        </div>
      </button>

      {panelOpen && (
        <div className="px-2.5 pb-3 pt-1 space-y-2 border-t border-violet-500/15">

          {touCount > 0 && (
            <ProgramSection sectionIcon="🕐" title="TOU Rate Plans" count={touCount}>
              {programs.tou_plans.map((p: TouRatePlan) => (
                <ProgramRow
                  key={p.plan_id}
                  icon={p.type === 'hourly_pricing' ? '📊' : p.solar_friendly ? '☀️' : p.battery_optimized ? '🔋' : '🕐'}
                  title={p.plan_name}
                  subtitle={p.plan_description}
                  value={undefined}
                  status={undefined}
                  enrollUrl={p.enrollment_url}
                  note={p.solar_pro_note}
                  lastVerified={p.last_verified}
                  accent={
                    p.type === 'hourly_pricing'
                      ? 'border-amber-500/25'
                      : p.solar_friendly
                      ? 'border-emerald-500/25'
                      : p.battery_optimized
                      ? 'border-blue-500/25'
                      : 'border-slate-500/20'
                  }
                />
              ))}
            </ProgramSection>
          )}

          {batteryCount > 0 && (
            <ProgramSection sectionIcon="🔋" title="Battery Incentives" count={batteryCount}>
              {programs.battery_incentives.map((p: BatteryIncentiveProgram) => (
                <ProgramRow
                  key={p.program_id}
                  icon={p.type === 'vpp' ? '🌐' : p.type === 'demand_response' ? '⚡' : '💰'}
                  title={p.program_name}
                  subtitle={p.program_description}
                  value={p.value_description}
                  status={p.status}
                  enrollUrl={p.enrollment_url}
                  note={p.solar_pro_note}
                  lastVerified={p.last_verified}
                  accent="border-green-500/25"
                />
              ))}
            </ProgramSection>
          )}

          {solarCount > 0 && (
            <ProgramSection sectionIcon="🌞" title="Solar Rebates & Incentives" count={solarCount}>
              {programs.solar_rebates.map((p: SolarRebateProgram) => (
                <ProgramRow
                  key={p.program_id}
                  icon="🌞"
                  title={p.program_name}
                  subtitle={p.program_description}
                  value={p.value_description}
                  status={p.status}
                  enrollUrl={p.enrollment_url}
                  note={p.solar_pro_note}
                  lastVerified={p.last_verified}
                  accent="border-yellow-500/25"
                />
              ))}
            </ProgramSection>
          )}

          {nemCount > 0 && (
            <ProgramSection sectionIcon="📋" title="Net Metering Policy" count={nemCount}>
              {programs.nem_programs.map((p: NemSpecialProgram) => (
                <ProgramRow
                  key={p.program_id}
                  icon={p.type === 'community_solar' ? '🏘️' : '📋'}
                  title={p.program_name}
                  subtitle={p.program_description}
                  value={p.export_rate_per_kwh != null ? `Export credit: $${p.export_rate_per_kwh.toFixed(3)}/kWh` : undefined}
                  status={p.status}
                  enrollUrl={p.enrollment_url}
                  note={p.solar_pro_note}
                  lastVerified={p.last_verified}
                  accent="border-cyan-500/25"
                />
              ))}
            </ProgramSection>
          )}

        </div>
      )}
    </div>
  );
}

