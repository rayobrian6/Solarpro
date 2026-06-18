import React from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  breadcrumb?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  subtitle,
  actions,
  breadcrumb,
  className = '',
}: PageHeaderProps) {
  return (
    <div className={`flex items-start justify-between gap-4 ${className}`}>
      <div className="min-w-0 flex-1">
        {breadcrumb ? (
          <div className="flex items-center gap-1 mb-1.5" style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
            {breadcrumb}
          </div>
        ) : null}
        <h1 className="page-title truncate">{title}</h1>
        {subtitle ? (
          <p className="page-subtitle">{subtitle}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex items-center gap-3 flex-shrink-0 mt-1">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

export default PageHeader;