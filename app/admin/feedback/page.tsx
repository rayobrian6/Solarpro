'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { Bug, Lightbulb, Clock, CheckCircle, Eye, ChevronLeft, ExternalLink, Image, Monitor, Globe } from 'lucide-react';

interface FeedbackItem {
  id: string;
  type: 'bug' | 'suggestion';
  message: string;
  page_url: string | null;
  user_id: string;
  user_email: string | null;
  screenshot_name: string | null;
  screenshot_mime: string | null;
  has_screenshot: boolean;
  browser_info: string | null;
  screen_size: string | null;
  app_version: string | null;
  status: 'new' | 'reviewed' | 'resolved';
  created_at: string;
  updated_at: string;
}

interface Counts {
  new_count: number;
  reviewed_count: number;
  resolved_count: number;
  total: number;
}

const STATUS_CONFIG = {
  new:      { label: 'New',      bg: 'bg-blue-500/15 border-blue-500/30 text-blue-400',    icon: Clock },
  reviewed: { label: 'Reviewed', bg: 'bg-amber-500/15 border-amber-500/30 text-amber-400', icon: Eye },
  resolved: { label: 'Resolved', bg: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400', icon: CheckCircle },
};

const TYPE_CONFIG = {
  bug:        { label: 'Bug',        bg: 'bg-red-500/15 border-red-500/30 text-red-400',    icon: Bug },
  suggestion: { label: 'Suggestion', bg: 'bg-amber-500/15 border-amber-500/30 text-amber-400', icon: Lightbulb },
};

export default function AdminFeedbackPage() {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [counts, setCounts] = useState<Counts>({ new_count: 0, reviewed_count: 0, resolved_count: 0, total: 0 });
  const [filter, setFilter] = useState<string>('');
  const [selected, setSelected] = useState<FeedbackItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [error, setError] = useState('');

  const fetchFeedback = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (filter) params.set('status', filter);
      params.set('limit', '100');
      const res = await fetch(`/api/admin/feedback?${params}`);
      const data = await res.json();
      if (data.success) {
        setItems(data.data || []);
        setCounts(data.counts || { new_count: 0, reviewed_count: 0, resolved_count: 0, total: 0 });
      } else {
        setError(data.error || 'Failed to load');
      }
    } catch (err: unknown) {
      setError((err as Error).message || 'Network error');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { fetchFeedback(); }, [fetchFeedback]);

  async function updateStatus(id: string, status: string) {
    setUpdating(id);
    try {
      const res = await fetch('/api/admin/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      const data = await res.json();
      if (data.success) {
        // Update local state
        setItems(prev => prev.map(item =>
          item.id === id ? { ...item, status: status as FeedbackItem['status'], updated_at: data.data.updated_at } : item
        ));
        if (selected?.id === id) {
          setSelected(prev => prev ? { ...prev, status: status as FeedbackItem['status'] } : null);
        }
        // Refresh counts
        fetchFeedback();
      }
    } catch (err: unknown) {
      console.error('Update failed:', (err as Error).message);
    } finally {
      setUpdating(null);
    }
  }

  function formatDate(dateStr: string) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  // ── Detail View ──
  if (selected) {
    const typeCfg = TYPE_CONFIG[selected.type];
    const statusCfg = STATUS_CONFIG[selected.status];
    const TypeIcon = typeCfg.icon;
    const StatusIcon = statusCfg.icon;

    return (
      <div className="p-6 max-w-4xl mx-auto">
        {/* Back button */}
        <button
          onClick={() => setSelected(null)}
          className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white mb-6 transition-colors"
        >
          <ChevronLeft size={16} /> Back to list
        </button>

        <div className="bg-slate-900/50 border border-slate-700 rounded-2xl overflow-hidden">
          {/* Header */}
          <div className="px-6 py-5 border-b border-slate-700 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg border text-xs font-bold ${typeCfg.bg}`}>
                <TypeIcon size={13} /> {typeCfg.label}
              </span>
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg border text-xs font-bold ${statusCfg.bg}`}>
                <StatusIcon size={13} /> {statusCfg.label}
              </span>
            </div>
            <div className="text-xs text-slate-500">{formatDate(selected.created_at)}</div>
          </div>

          {/* Content */}
          <div className="px-6 py-5 space-y-5">
            {/* Message */}
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1.5 block">Message</label>
              <div className="text-sm text-white leading-relaxed bg-slate-800/50 rounded-xl p-4 border border-slate-700/50 whitespace-pre-wrap">
                {selected.message}
              </div>
            </div>

            {/* Screenshot */}
            {selected.has_screenshot ? (
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1.5 flex items-center gap-1.5 block">
                  <Image size={12} /> Screenshot
                </label>
                <div className="rounded-xl border border-slate-700 overflow-hidden bg-slate-800/50">
                  <img
                    src={`/api/admin/feedback/screenshot?id=${selected.id}`}
                    alt="Feedback screenshot"
                    className="max-w-full max-h-96 object-contain mx-auto"
                  />
                  <div className="px-3 py-2 text-xs text-slate-500 border-t border-slate-700">
                    {selected.screenshot_name}
                  </div>
                </div>
              </div>
            ) : null}

            {/* Metadata */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-slate-800/30 rounded-xl p-3 border border-slate-700/30">
                <label className="text-xs text-slate-500 flex items-center gap-1.5 mb-1">
                  User
                </label>
                <div className="text-sm text-white">{selected.user_email || selected.user_id}</div>
              </div>

              {selected.page_url ? (
                <div className="bg-slate-800/30 rounded-xl p-3 border border-slate-700/30">
                  <label className="text-xs text-slate-500 flex items-center gap-1.5 mb-1">
                    <Globe size={11} /> Page URL
                  </label>
                  <a
                    href={selected.page_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-amber-400 hover:underline flex items-center gap-1 truncate"
                  >
                    {selected.page_url.replace(/https?:\/\/[^/]+/, '')} <ExternalLink size={11} />
                  </a>
                </div>
              ) : null}

              {selected.app_version ? (
                <div className="bg-slate-800/30 rounded-xl p-3 border border-slate-700/30">
                  <label className="text-xs text-slate-500 mb-1 block">App Version</label>
                  <div className="text-sm text-white font-mono">{selected.app_version}</div>
                </div>
              ) : null}

              {selected.screen_size ? (
                <div className="bg-slate-800/30 rounded-xl p-3 border border-slate-700/30">
                  <label className="text-xs text-slate-500 flex items-center gap-1.5 mb-1">
                    <Monitor size={11} /> Screen Size
                  </label>
                  <div className="text-sm text-white font-mono">{selected.screen_size}</div>
                </div>
              ) : null}
            </div>

            {selected.browser_info ? (
              <div className="bg-slate-800/30 rounded-xl p-3 border border-slate-700/30">
                <label className="text-xs text-slate-500 mb-1 block">Browser Info</label>
                <div className="text-xs text-slate-400 font-mono break-all">{selected.browser_info}</div>
              </div>
            ) : null}
          </div>

          {/* Actions */}
          <div className="px-6 py-4 border-t border-slate-700 flex gap-3">
            {selected.status !== 'reviewed' ? (
              <button
                onClick={() => updateStatus(selected.id, 'reviewed')}
                disabled={updating === selected.id}
                className="px-4 py-2 text-sm font-medium bg-amber-600/20 text-amber-400 border border-amber-500/30 rounded-lg hover:bg-amber-600/30 transition-colors disabled:opacity-50"
              >
                Mark as Reviewed
              </button>
            ) : null}
            {selected.status !== 'resolved' ? (
              <button
                onClick={() => updateStatus(selected.id, 'resolved')}
                disabled={updating === selected.id}
                className="px-4 py-2 text-sm font-medium bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 rounded-lg hover:bg-emerald-600/30 transition-colors disabled:opacity-50"
              >
                Mark as Resolved
              </button>
            ) : null}
            {selected.status === 'resolved' ? (
              <button
                onClick={() => updateStatus(selected.id, 'new')}
                disabled={updating === selected.id}
                className="px-4 py-2 text-sm font-medium bg-blue-600/20 text-blue-400 border border-blue-500/30 rounded-lg hover:bg-blue-600/30 transition-colors disabled:opacity-50"
              >
                Reopen
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  // ── List View ──
  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-white">User Feedback</h1>
        <div className="text-xs text-slate-500">{counts.total} total</div>
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-2 mb-6">
        {[
          { key: '', label: 'All', count: counts.total },
          { key: 'new', label: 'New', count: counts.new_count },
          { key: 'reviewed', label: 'Reviewed', count: counts.reviewed_count },
          { key: 'resolved', label: 'Resolved', count: counts.resolved_count },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              filter === tab.key
                ? 'bg-amber-500/15 border-amber-500/30 text-amber-400'
                : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:border-slate-600'
            }`}
          >
            {tab.label} ({tab.count})
          </button>
        ))}
      </div>

      {/* Error */}
      {error ? (
        <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 mb-4">
          {error}
        </div>
      ) : null}

      {/* Loading */}
      {loading ? (
        <div className="text-center py-12 text-slate-500">Loading feedback...</div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          {filter ? `No ${filter} feedback` : 'No feedback yet'}
        </div>
      ) : (
        /* List */
        <div className="space-y-2">
          {items.map(item => {
            const typeCfg = TYPE_CONFIG[item.type];
            const statusCfg = STATUS_CONFIG[item.status];
            const TypeIcon = typeCfg.icon;
            const StatusIcon = statusCfg.icon;

            return (
              <div
                key={item.id}
                onClick={() => setSelected(item)}
                className="bg-slate-900/50 border border-slate-700/50 rounded-xl px-5 py-4 hover:border-slate-600 cursor-pointer transition-colors group"
              >
                <div className="flex items-start gap-4">
                  {/* Type + Status badges */}
                  <div className="flex flex-col gap-1.5 flex-shrink-0 pt-0.5">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-xs font-medium ${typeCfg.bg}`}>
                      <TypeIcon size={11} /> {typeCfg.label}
                    </span>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-xs font-medium ${statusCfg.bg}`}>
                      <StatusIcon size={11} /> {statusCfg.label}
                    </span>
                  </div>

                  {/* Message preview */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white group-hover:text-amber-100 truncate">
                      {item.message.length > 120 ? item.message.substring(0, 120) + '...' : item.message}
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-500">
                      <span>{item.user_email || item.user_id.substring(0, 8)}</span>
                      <span>{formatDate(item.created_at)}</span>
                      {item.has_screenshot ? (
                        <span className="flex items-center gap-1 text-slate-400">
                          <Image size={10} /> Screenshot
                        </span>
                      ) : null}
                      {item.app_version ? <span className="font-mono">{item.app_version}</span> : null}
                    </div>
                  </div>

                  {/* Quick actions */}
                  <div className="flex-shrink-0 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    {item.status === 'new' ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); updateStatus(item.id, 'reviewed'); }}
                        className="px-2.5 py-1 text-xs bg-amber-600/20 text-amber-400 rounded-md hover:bg-amber-600/30 transition-colors"
                        title="Mark as Reviewed"
                      >
                        Review
                      </button>
                    ) : null}
                    {item.status !== 'resolved' ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); updateStatus(item.id, 'resolved'); }}
                        className="px-2.5 py-1 text-xs bg-emerald-600/20 text-emerald-400 rounded-md hover:bg-emerald-600/30 transition-colors"
                        title="Mark as Resolved"
                      >
                        Resolve
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}