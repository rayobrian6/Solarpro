import React from 'react';

type CardVariant = 'default' | 'highlight' | 'success' | 'warning' | 'danger' | 'ghost';

interface CardProps {
  children: React.ReactNode;
  variant?: CardVariant;
  className?: string;
  hover?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  onClick?: () => void;
  style?: React.CSSProperties;
}

const paddingClasses = {
  none: '',
  sm:   'p-3',
  md:   'p-5',
  lg:   'p-6',
};

// Variant → CSS class (defined in globals.css using CSS vars)
const variantClass: Record<CardVariant, string> = {
  default:   'card',
  highlight: 'card-highlight',
  success:   'card-success',
  warning:   'card-warning',
  danger:    'card-danger',
  ghost:     'bg-transparent border border-[var(--border-color)] rounded-[var(--radius-card)]',
};

export function Card({
  children,
  variant = 'default',
  className = '',
  hover = false,
  padding = 'md',
  onClick,
  style,
}: CardProps) {
  const hoverClass = hover ? 'card-hover' : '';
  const clickClass = onClick ? 'cursor-pointer' : '';

  return (
    <div
      className={`${variantClass[variant]} ${paddingClasses[padding]} ${hoverClass} ${clickClass} ${className}`}
      onClick={onClick}
      style={style}
    >
      {children}
    </div>
  );
}

export default Card;