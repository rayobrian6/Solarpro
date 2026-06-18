import React from 'react';

type MetricColor = 'blue' | 'green' | 'orange' | 'amber' | 'red' | 'purple' | 'teal' | 'slate';

interface MetricCardProps {
  label: string;
  value: string | number;
  subtext?: string;
  color?: MetricColor;
  icon?: React.ReactNode;
  trend?: string;
  trendUp?: boolean;
  className?: string;
  onClick?: () => void;
}

// Maps to CSS accent var + Tailwind icon color classes
const colorConfig: Record<MetricColor, {
  accentClass: string;
  iconColor: string;
  iconBg: string;
  trendColor: string;
  trendBg: string;
}> = {
  blue:   { accentClass: 'metric-accent-blue',   iconColor: 'text-blue-400',   iconBg: 'bg-blue-500/10',   trendColor: 'text-blue-400',   trendBg: 'bg-blue-500/10' },
  green:  { accentClass: 'metric-accent-green',  iconColor: 'text-green-400',  iconBg: 'bg-green-500/10',  trendColor: 'text-green-400',  trendBg: 'bg-green-500/10' },
  orange: { accentClass: 'metric-accent-orange', iconColor: 'text-orange-400', iconBg: 'bg-orange-500/10', trendColor: 'text-orange-400', trendBg: 'bg-orange-500/10' },
  amber:  { accentClass: 'metric-accent-amber',  iconColor: 'text-amber-400',  iconBg: 'bg-amber-500/10',  trendColor: 'text-amber-400',  trendBg: 'bg-amber-500/10' },
  red:    { accentClass: 'metric-accent-red',    iconColor: 'text-red-400',    iconBg: 'bg-red-500/10',    trendColor: 'text-red-400',    trendBg: 'bg-red-500/10' },
  purple: { accentClass: 'metric-accent-purple', iconColor: 'text-purple-400', iconBg: 'bg-purple-500/10', trendColor: 'text-purple-400', trendBg: 'bg-purple-500/10' },
  teal:   { accentClass: 'metric-accent-teal',   iconColor: 'text-teal-400',   iconBg: 'bg-teal-500/10',   trendColor: 'text-teal-400',   trendBg: 'bg-teal-500/10' },
  slate:  { accentClass: 'metric-accent-slate',  iconColor: 'text-slate-400',  iconBg: 'bg-slate-500/10',  trendColor: 'text-slate-400',  trendBg: 'bg-slate-700/40' },
};

export function MetricCard({
  label,
  value,
  subtext,
  color = 'slate',
  icon,
  trend,
  trendUp = true,
  className = '',
  onClick,
}: MetricCardProps) {
  const cfg = colorConfig[color];

  return (
    <div
      className={`card p-5 ${cfg.accentClass} ${onClick ? 'card-hover cursor-pointer' : ''} ${className}`}
      onClick={onClick}
    >
      <div className="flex flex-col gap-3">
        {/* Icon + trend row */}
        {(icon || trend) ? (
          <div className="flex items-start justify-between">
            {icon ? (
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${cfg.iconBg}`}>
                <span className={cfg.iconColor}>{icon}</span>
              </div>
            ) : null}
            {trend ? (
              <div className={`flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full ml-auto ${cfg.trendColor} ${cfg.trendBg}`}>
                <span>{trendUp ? '↑' : '↓'}</span>
                {trend}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Value + label */}
        <div className={icon || trend ? '' : 'pt-1'}>
          <div className="metric-value-xl">{value}</div>
          <div className="metric-label-sm mt-1">{label}</div>
          {subtext ? (
            <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{subtext}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default MetricCard;