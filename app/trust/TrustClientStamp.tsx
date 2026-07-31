// Tiny client-only "last updated" stamp. The page itself is a server
// component; this one file opts into client rendering just so the stamp can
// be re-computed in the visitor's browser from the ISO timestamp without
// shipping the whole page as a client component.
'use client';

import { useEffect, useState } from 'react';

interface Props {
  iso: string;
  fallback: string;
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Date.now() - then;
  const day = 24 * 60 * 60 * 1000;
  const days = Math.floor(diffMs / day);
  if (days < 0) return 'in the future';
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

export function TrustClientStamp({ iso, fallback }: Props) {
  const [relative, setRelative] = useState<string>('');

  useEffect(() => {
    setRelative(formatRelative(iso));
  }, [iso]);

  return (
    <span>
      Last updated {relative || fallback}
    </span>
  );
}
