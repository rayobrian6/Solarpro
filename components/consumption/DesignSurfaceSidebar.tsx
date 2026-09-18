'use client';
/**
 * components/consumption/DesignSurfaceSidebar.tsx
 *
 * Aurora-style left rail for the 3D design surface. Mirrors the
 * 3-item nav in aurora_frames/frame_0050.jpg:
 *
 *   Consumption  (active when on this page)
 *   Site Model
 *   Design
 *
 * Only Consumption is wired (this is the active view). Site Model
 * and Design are visual placeholders that link to /design — wiring
 * the in-design sidebar into DesignStudio.tsx is a sibling epic
 * (TIER 1 #5 in HANDOFF_2026-08-25_AURORA_ANALYSIS.md).
 *
 * Lives inside the consumption page so the visual parity is end-to-end
 * without touching app/design/ or components/design/*.
 */

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  LayoutGrid,
  Layers,
  FileSpreadsheet,
  Map,
  Home,
} from 'lucide-react';

interface NavEntry {
  id: string;
  label: string;
  href: string;
  icon: React.ReactNode;
  exact?: boolean;
}

const TOP_ITEMS: NavEntry[] = [
  { id: 'consumption', label: 'Consumption', href: '/consumption', icon: <Activity size={14} />, exact: true },
  { id: 'site-model',  label: 'Site Model',  href: '/design',      icon: <Map size={14} /> },
  { id: 'design',      label: 'Design',      href: '/design',      icon: <LayoutGrid size={14} /> },
];

const DESIGN_SUB_ITEMS = [
  { label: 'System Design',   icon: <Layers size={12} /> },
  { label: 'Performance',     icon: <Activity size={12} /> },
  { label: 'Pricing',         icon: <FileSpreadsheet size={12} /> },
  { label: 'Financing',       icon: <FileSpreadsheet size={12} /> },
  { label: 'Documents',       icon: <FileSpreadsheet size={12} /> },
];

export default function DesignSurfaceSidebar() {
  const pathname = usePathname();

  return (
    <aside
      className="w-[220px] flex-shrink-0 border-r border-slate-700/50 bg-slate-900 flex flex-col"
      aria-label="Design surface navigation"
    >
      {/* Project header — matches Aurora's "New UI Project" + avatar */}
      <div className="px-3 py-3 border-b border-slate-700/50">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          New UI Project
        </div>
        <div className="mt-2 flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-[11px] font-bold text-slate-900">
            JS
          </div>
          <div className="text-sm font-medium text-white">Joe Solar</div>
        </div>
      </div>

      {/* Top-level nav */}
      <nav className="px-2 py-3 space-y-0.5">
        {TOP_ITEMS.map((item) => {
          const isActive =
            item.exact ? pathname === item.href : pathname?.startsWith(item.href);
          return (
            <div key={item.id}>
              <Link
                href={item.href}
                className={`sidebar-item ${isActive ? 'active' : ''}`}
                data-testid={`sidebar-${item.id}`}
              >
                <span className={isActive ? 'text-amber-400' : 'text-slate-400'}>
                  {item.icon}
                </span>
                <span>{item.label}</span>
                {item.id === 'consumption' ? (
                  <span className="ml-auto text-[10px] font-semibold text-emerald-400">●</span>
                ) : null}
              </Link>

              {/* Design sub-items (visual placeholder) */}
              {item.id === 'design' ? (
                <div className="pl-7 pr-2 space-y-0.5 mt-0.5">
                  {DESIGN_SUB_ITEMS.map((sub) => (
                    <div
                      key={sub.label}
                      className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-slate-500 hover:text-slate-300 cursor-default"
                    >
                      <span className="text-slate-600">{sub.icon}</span>
                      <span>{sub.label}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>

      {/* Instructions panel — Aurora's left-sidebar helper text */}
      <div className="mt-auto px-3 py-3 border-t border-slate-700/50">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
          Instructions
        </div>
        <p className="text-[11px] text-slate-500 leading-relaxed">
          Hover the roof with your mouse to add a new design. Click on the
          floor plan to add a new open space.
        </p>
      </div>
    </aside>
  );
}
