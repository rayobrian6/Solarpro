import React from 'react';

type Cols = 1 | 2 | 3 | 4 | 5;

interface GridProps {
  children: React.ReactNode;
  cols?: Cols;
  colsSm?: Cols;
  colsMd?: Cols;
  colsLg?: Cols;
  gap?: 'sm' | 'md' | 'lg';
  className?: string;
}

const colsBase: Record<Cols, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
  5: 'grid-cols-5',
};

const colsSm_: Record<Cols, string> = {
  1: 'sm:grid-cols-1',
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-4',
  5: 'sm:grid-cols-5',
};

const colsMd_: Record<Cols, string> = {
  1: 'md:grid-cols-1',
  2: 'md:grid-cols-2',
  3: 'md:grid-cols-3',
  4: 'md:grid-cols-4',
  5: 'md:grid-cols-5',
};

const colsLg_: Record<Cols, string> = {
  1: 'lg:grid-cols-1',
  2: 'lg:grid-cols-2',
  3: 'lg:grid-cols-3',
  4: 'lg:grid-cols-4',
  5: 'lg:grid-cols-5',
};

const gapClasses = {
  sm: 'gap-3',
  md: 'gap-4',
  lg: 'gap-6',
};

export function Grid({
  children,
  cols = 1,
  colsSm,
  colsMd,
  colsLg,
  gap = 'md',
  className = '',
}: GridProps) {
  const classes = [
    'grid',
    colsBase[cols],
    colsSm ? colsSm_[colsSm] : '',
    colsMd ? colsMd_[colsMd] : '',
    colsLg ? colsLg_[colsLg] : '',
    gapClasses[gap],
    className,
  ].filter(Boolean).join(' ');

  return <div className={classes}>{children}</div>;
}

export default Grid;