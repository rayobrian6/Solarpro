'use client';

/**
 * MonitoringLinkEditor
 * ─────────────────────────────────────────────────────────────
 * Allows the installer (in the project Operations tab) to set the
 * monitoring platform and dashboard URL for a project.
 *
 * This data is surfaced in the homeowner portal's MonitoringFoundation
 * section so the homeowner can click through to view live production data.
 *
 * Supported platforms:
 *   Enphase Enlighten, SolarEdge, APsystems EMA, Hoymiles HMS,
 *   Generac PWRview, SMA Sunny Portal, Fronius Solar.web, Solis Cloud, Other
 */

import React, { useState, useEffect, useCallback } from 'react';
import { ExternalLink, Zap, Check, Loader2, AlertCircle } from 'lucide-react';

type MonitoringPlatform =
  | 'enphase' | 'solaredge' | 'apsystems' | 'hoymiles'
  | 'generac' | 'sma' | 'fronius' | 'solis' | 'other';

interface MonitoringLinkEditorProps {
  projectId: string;
}

const PLATFORMS: { value: MonitoringPlatform; label: string; placeholder: string }[] = [
  { value: 'enphase',   label: 'Enphase Enlighten',   placeholder: 'https://enlighten.enphaseenergy.com/systems/12345' },
  { value: 'solaredge', label: 'SolarEdge Monitoring', placeholder: 'https://monitoring.solaredge.com/solaredge-web/p/site/12345' },
  { value: 'apsystems', label: 'APsystems EMA',        placeholder: 'https://ema2.apsystemsema.com/...' },
  { value: 'hoymiles',  label: 'Hoymiles HMS',         placeholder: 'https://global.hoymiles.com/platform/...' },
  { value: 'generac',   label: 'Generac PWRview',      placeholder: 'https://pwrview.generac.com/...' },
  { value: 'sma',       label: 'SMA Sunny Portal',     placeholder: 'https://www.sunnyportal.com/...' },
  { value: 'fronius',   label: 'Fronius Solar.web',    placeholder: 'https://www.solarweb.com/...' },
  { value: 'solis',     label: 'Solis Cloud',          placeholder: 'https://www.soliscloud.com/...' },
  { value: 'other',     label: 'Other / Custom',       placeholder: 'https://your-monitoring-dashboard.com/...' },
];

export default function MonitoringLinkEditor({ projectId }: MonitoringLinkEditorProps) {
  const [platform, setPlatform] = useState<MonitoringPlatform | ''>('');
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Load existing values
  useEffect(() => {
    let active = true;
    fetch(`/api/projects/${projectId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!active || !data?.data) return;
        const p = data.data;
        if (p.monitoringPlatform) setPlatform(p.monitoringPlatform as MonitoringPlatform);
        if (p.monitoringUrl) setUrl(p.monitoringUrl);
      })
      .catch(() => {/* non-fatal */})
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId]);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          monitoringPlatform: platform || null,
          monitoringUrl: url.trim() || null,
        }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(`Failed to save: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }, [projectId, platform, url]);

  const selectedPlatform = PLATFORMS.find(p => p.value === platform);
  const urlPlaceholder = selectedPlatform?.placeholder ?? 'https://your-monitoring-dashboard.com/...';

  if (loading) return null;

  return (
    <div className="rounded-xl border p-4 space-y-3"
      style={{ borderColor: 'var(--border-color)', background: 'var(--bg-secondary)' }}>
      {/* Header */}
      <div className="flex items-center gap-2">
        <Zap size={14} className="text-amber-400" />
        <span className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: 'var(--text-secondary)' }}>
          Monitoring Link
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
          style={{ background: 'rgba(251,191,36,0.08)', color: 'rgba(251,191,36,0.7)' }}>
          Homeowner Portal
        </span>
      </div>

      <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
        Add the monitoring dashboard URL so the homeowner can view live production data from their portal.
      </p>

      {/* Platform selector */}
      <div className="space-y-1">
        <label className="text-[10px] uppercase tracking-wider font-semibold"
          style={{ color: 'var(--text-muted)' }}>
          Monitoring Platform
        </label>
        <select
          value={platform}
          onChange={e => setPlatform(e.target.value as MonitoringPlatform | '')}
          className="w-full text-sm rounded px-3 py-1.5 border"
          style={{
            background: 'var(--bg-primary)',
            color: 'var(--text-primary)',
            borderColor: 'var(--border-color)',
          }}
        >
          <option value="">— Select platform —</option>
          {PLATFORMS.map(p => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </div>

      {/* URL input */}
      <div className="space-y-1">
        <label className="text-[10px] uppercase tracking-wider font-semibold"
          style={{ color: 'var(--text-muted)' }}>
          Dashboard URL
        </label>
        <input
          type="url"
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder={urlPlaceholder}
          className="w-full text-sm rounded px-3 py-1.5 border"
          style={{
            background: 'var(--bg-primary)',
            color: 'var(--text-primary)',
            borderColor: 'var(--border-color)',
          }}
        />
      </div>

      {/* Preview link */}
      {url.trim() ? (
        <a
          href={url.trim()}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-[11px] hover:underline"
          style={{ color: 'var(--color-accent, rgb(251,191,36))' }}>
          <ExternalLink size={10} />
          Preview monitoring dashboard
        </a>
      ) : null}

      {/* Save button */}
      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={save}
          disabled={saving || (!platform && !url.trim())}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-40"
          style={{
            background: 'rgba(251,191,36,0.12)',
            color: 'rgba(251,191,36,0.9)',
            border: '1px solid rgba(251,191,36,0.2)',
          }}>
          {saving ? <Loader2 size={10} className="animate-spin" /> : saved ? <Check size={10} /> : null}
          {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Monitoring Link'}
        </button>
        {error ? (
          <span className="flex items-center gap-1 text-[11px] text-red-400">
            <AlertCircle size={10} />
            {error}
          </span>
        ) : null}
      </div>
    </div>
  );
}
