import React from 'react';

type BadgeVariant =
  | 'default'
  | 'primary'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'lead'
  | 'design'
  | 'proposal'
  | 'approved'
  | 'installed'
  | 'roof'
  | 'ground'
  | 'fence';

type BadgeSize = 'xs' | 'sm' | 'md';

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  size?: BadgeSize;
  icon?: React.ReactNode;
  className?: string;
  dot?: boolean;
}

const variantClasses: Record<BadgeVariant, string> = {
  default:   'bg-slate-700/60 text-slate-300 border border-slate-600/40',
  primary:   'bg-amber-500/15 text-amber-300 border border-amber-500/30',
  success:   'bg-green-900/50 text-green-300 border border-green-700/40',
  warning:   'bg-amber-900/50 text-amber-300 border border-amber-700/40',
  danger:    'bg-red-900/50 text-red-300 border border-red-700/40',
  info:      'bg-blue-900/50 text-blue-300 border border-blue-700/40',
  // Status badges — match existing badge-* CSS classes for backward compat
  lead:      'bg-slate-700 text-slate-300',
  design:    'bg-blue-900/60 text-blue-300 border border-blue-700/40',
  proposal:  'bg-amber-900/60 text-amber-300 border border-amber-700/40',
  approved:  'bg-green-900/60 text-green-300 border border-green-700/40',
  installed: 'bg-emerald-900/60 text-emerald-300 border border-emerald-700/40',
  // Type badges
  roof:      'bg-orange-900/60 text-orange-300 border border-orange-700/40',
  ground:    'bg-teal-900/60 text-teal-300 border border-teal-700/40',
  fence:     'bg-purple-900/60 text-purple-300 border border-purple-700/40',
};

const sizeClasses: Record<BadgeSize, string> = {
  xs: 'px-1.5 py-0.5 text-[10px]',
  sm: 'px-2.5 py-0.5 text-xs',
  md: 'px-3 py-1 text-sm',
};

const dotColors: Record<BadgeVariant, string> = {
  default:   'bg-slate-400',
  primary:   'bg-amber-400',
  success:   'bg-green-400',
  warning:   'bg-amber-400',
  danger:    'bg-red-400',
  info:      'bg-blue-400',
  lead:      'bg-slate-400',
  design:    'bg-blue-400',
  proposal:  'bg-amber-400',
  approved:  'bg-green-400',
  installed: 'bg-emerald-400',
  roof:      'bg-orange-400',
  ground:    'bg-teal-400',
  fence:     'bg-purple-400',
};

export function Badge({
  children,
  variant = 'default',
  size = 'sm',
  icon,
  className = '',
  dot = false,
}: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-medium ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
    >
      {dot ? (
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotColors[variant]}`} />
      ) : null}
      {icon ? <span className="flex-shrink-0">{icon}</span> : null}
      {children}
    </span>
  );
}

export default Badge;