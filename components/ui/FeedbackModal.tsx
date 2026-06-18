'use client';
import React, { useState, useRef } from 'react';
import { X, Bug, Lightbulb, Upload, Loader2, CheckCircle } from 'lucide-react';

interface FeedbackModalProps {
  open: boolean;
  onClose: () => void;
}

export default function FeedbackModal({ open, onClose }: FeedbackModalProps) {
  const [type, setType] = useState<'bug' | 'suggestion'>('bug');
  const [message, setMessage] = useState('');
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  function handleScreenshot(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError('Screenshot must be under 5MB');
      return;
    }
    if (!file.type.startsWith('image/')) {
      setError('Only image files are allowed');
      return;
    }
    setScreenshot(file);
    setError('');
    const reader = new FileReader();
    reader.onload = () => setScreenshotPreview(reader.result as string);
    reader.readAsDataURL(file);
  }

  function removeScreenshot() {
    setScreenshot(null);
    setScreenshotPreview(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!message.trim() || message.trim().length < 5) {
      setError('Please provide a detailed description (at least 5 characters)');
      return;
    }

    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('type', type);
      formData.append('message', message.trim());
      formData.append('pageUrl', window.location.href);
      formData.append('browserInfo', navigator.userAgent);
      formData.append('screenSize', `${window.innerWidth}x${window.innerHeight}`);
      if (screenshot) {
        formData.append('screenshot', screenshot);
      }

      const res = await fetch('/api/feedback', { method: 'POST', body: formData });
      let data: any;
      try {
        data = await res.json();
      } catch {
        setError(`Server error (${res.status}). Please try again.`);
        return;
      }

      if (!res.ok || !data.success) {
        console.error('[FeedbackModal] Submit failed:', res.status, data);
        setError(data.error || `Failed to submit feedback (${res.status})`);
        return;
      }

      setSubmitted(true);
      // Auto-close after showing success
      setTimeout(() => {
        handleClose();
      }, 2000);
    } catch (err: unknown) {
      setError((err as Error).message || 'Network error');
    } finally {
      setSubmitting(false);
    }
  }

  function handleClose() {
    setType('bug');
    setMessage('');
    setScreenshot(null);
    setScreenshotPreview(null);
    setError('');
    setSubmitting(false);
    setSubmitted(false);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />

      {/* Modal */}
      <div className="relative bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
          <h2 className="text-lg font-semibold text-white">Report a Bug or Suggestion</h2>
          <button onClick={handleClose} className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors">
            <X size={18} />
          </button>
        </div>

        {submitted ? (
          /* Success state */
          <div className="px-6 py-12 text-center">
            <CheckCircle size={48} className="text-emerald-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-white mb-2">Thank you!</h3>
            <p className="text-sm text-slate-400">Your feedback has been submitted and will be reviewed by our team.</p>
          </div>
        ) : (
          /* Form */
          <form onSubmit={handleSubmit}>
            <div className="px-6 py-5 space-y-5">
              {/* Type selector */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-2">Feedback Type</label>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setType('bug')}
                    className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border text-sm font-medium transition-all ${
                      type === 'bug'
                        ? 'bg-red-500/15 border-red-500/40 text-red-400'
                        : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:border-slate-600'
                    }`}
                  >
                    <Bug size={16} /> Bug Report
                  </button>
                  <button
                    type="button"
                    onClick={() => setType('suggestion')}
                    className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border text-sm font-medium transition-all ${
                      type === 'suggestion'
                        ? 'bg-amber-500/15 border-amber-500/40 text-amber-400'
                        : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:border-slate-600'
                    }`}
                  >
                    <Lightbulb size={16} /> Suggestion
                  </button>
                </div>
              </div>

              {/* Message */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-2">
                  {type === 'bug' ? 'Describe the bug' : 'Describe your suggestion'}
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={
                    type === 'bug'
                      ? 'What happened? What did you expect to happen?'
                      : 'What would you like to see improved or added?'
                  }
                  rows={4}
                  className="w-full bg-slate-800/50 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/25 resize-none"
                  autoFocus
                />
              </div>

              {/* Screenshot */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-2">
                  Screenshot <span className="text-slate-600">(optional)</span>
                </label>
                {screenshotPreview ? (
                  <div className="relative group">
                    <img
                      src={screenshotPreview}
                      alt="Screenshot preview"
                      className="w-full max-h-40 object-contain rounded-xl border border-slate-700 bg-slate-800"
                    />
                    <button
                      type="button"
                      onClick={removeScreenshot}
                      className="absolute top-2 right-2 bg-slate-900/80 text-slate-400 hover:text-white p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X size={14} />
                    </button>
                    <div className="text-xs text-slate-500 mt-1.5">{screenshot?.name}</div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="w-full py-4 border-2 border-dashed border-slate-700 rounded-xl text-sm text-slate-500 hover:border-slate-600 hover:text-slate-400 transition-colors flex items-center justify-center gap-2"
                  >
                    <Upload size={16} /> Click to attach screenshot
                  </button>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  onChange={handleScreenshot}
                  className="hidden"
                />
              </div>

              {/* Error */}
              {error ? (
                <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  {error}
                </div>
              ) : null}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-700 flex justify-end gap-3">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 text-sm text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-500 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {submitting ? (
                  <>
                    <Loader2 size={14} className="animate-spin" /> Submitting...
                  </>
                ) : (
                  'Submit Feedback'
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}