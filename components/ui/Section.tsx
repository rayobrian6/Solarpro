import React from 'react';

interface SectionProps {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
  titleClassName?: string;
  action?: React.ReactNode;
  spacing?: 'sm' | 'md' | 'lg';
  divider?: boolean;
}

const spacingClasses = {
  sm: 'space-y-3',
  md: 'space-y-5',
  lg: 'space-y-6',
};

export function Section({
  title,
  subtitle,
  children,
  className = '',
  titleClassName = '',
  action,
  spacing = 'md',
  divider = false,
}: SectionProps) {
  return (
    <section
      className={`${spacingClasses[spacing]} ${className}`}
      style={divider ? { borderTop: '1px solid var(--border-color)', paddingTop: '1.5rem' } : undefined}
    >
      {(title || action) ? (
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            {title ? (
              <h2 className={`section-title ${titleClassName}`}>
                {title}
              </h2>
            ) : null}
            {subtitle ? (
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{subtitle}</p>
            ) : null}
          </div>
          {action ? (
            <div className="flex-shrink-0">{action}</div>
          ) : null}
        </div>
      ) : null}
      <div>{children}</div>
    </section>
  );
}

export default Section;