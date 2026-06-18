'use client';
/**
 * AddressAutocomplete
 * ─────────────────────────────────────────────────────────────────────────────
 * A reusable address typeahead input backed by /api/geocode?mode=autocomplete.
 * Debounces at 300 ms, shows up to 5 suggestions, keyboard-navigable.
 *
 * Props
 *   value          – controlled input value
 *   onChange       – fires on every keystroke (string)
 *   onSelect       – fires when user picks a suggestion { display_name, short_name, lat, lng }
 *   onSubmit       – fires when user hits Enter or clicks the action button (optional)
 *   placeholder    – input placeholder (default "Enter any address…")
 *   className      – extra classes for the wrapper div
 *   inputClassName – extra classes for the <input>
 *   loading        – show spinner overlay (e.g. during geocoding)
 *   autoFocus      – auto-focus input on mount
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MapPin, Loader2, Search } from 'lucide-react';

export interface AddressSuggestion {
  display_name: string;
  short_name: string;
  lat: number;
  lng: number;
}

interface Props {
  value: string;
  onChange: (val: string) => void;
  onSelect: (suggestion: AddressSuggestion) => void;
  onSubmit?: (value: string) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  loading?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
}

export default function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  onSubmit,
  placeholder = 'Enter any address…',
  className = '',
  inputClassName = '',
  loading = false,
  autoFocus = false,
  disabled = false,
}: Props) {
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // ── Auto-focus ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // ── Debounced autocomplete fetch ───────────────────────────────────────────
  const fetchSuggestions = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < 3) {
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setFetching(true);
      try {
        const res = await fetch(
          `/api/geocode?q=${encodeURIComponent(q)}&mode=autocomplete`,
          { cache: 'no-store' }
        );
        const data = await res.json();
        if (data.success && Array.isArray(data.data) && data.data.length > 0) {
          setSuggestions(data.data.slice(0, 5));
          setShowDropdown(true);
          setActiveIndex(-1);
        } else {
          setSuggestions([]);
          setShowDropdown(false);
        }
      } catch {
        setSuggestions([]);
        setShowDropdown(false);
      } finally {
        setFetching(false);
      }
    }, 300);
  }, []);

  // ── Input change ───────────────────────────────────────────────────────────
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    onChange(v);
    fetchSuggestions(v);
  };

  // ── Keyboard navigation ────────────────────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showDropdown || suggestions.length === 0) {
      if (e.key === 'Enter' && onSubmit) {
        onSubmit(value);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => Math.max(i - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && suggestions[activeIndex]) {
        handleSelect(suggestions[activeIndex]);
      } else if (onSubmit) {
        setShowDropdown(false);
        onSubmit(value);
      }
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
      setActiveIndex(-1);
    }
  };

  // ── Select suggestion ──────────────────────────────────────────────────────
  const handleSelect = (s: AddressSuggestion) => {
    onChange(s.short_name || s.display_name);
    setSuggestions([]);
    setShowDropdown(false);
    setActiveIndex(-1);
    onSelect(s);
  };

  // ── Close on outside click ─────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        inputRef.current && !inputRef.current.contains(e.target as Node) &&
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className={`relative ${className}`}>
      {/* Input */}
      <div className="relative">
        <MapPin
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-amber-400/70 pointer-events-none z-10"
        />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => suggestions.length > 0 && setShowDropdown(true)}
          placeholder={placeholder}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          disabled={disabled || loading}
          className={`input pl-8 pr-8 text-sm w-full ${inputClassName}`}
        />
        {/* Right icon: spinner while fetching/loading */}
        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
          {(fetching || loading) ? (
            <Loader2 size={13} className="animate-spin text-amber-400/60" />
          ) : null}
        </div>
      </div>

      {/* Dropdown */}
      {showDropdown && suggestions.length > 0 ? (
        <div
          ref={dropdownRef}
          className="absolute top-full left-0 right-0 mt-1.5 z-[200] rounded-xl overflow-hidden shadow-2xl border border-slate-600/80"
          style={{ background: 'rgba(15,20,35,0.98)', backdropFilter: 'blur(12px)' }}
        >
          {suggestions.map((s, i) => (
            <button
              key={i}
              type="button"
              onMouseDown={e => { e.preventDefault(); handleSelect(s); }}
              onMouseEnter={() => setActiveIndex(i)}
              className={`w-full text-left px-3 py-2.5 flex items-start gap-2.5 transition-colors border-b border-slate-700/40 last:border-0 ${
                i === activeIndex
                  ? 'bg-amber-500/15 text-white'
                  : 'hover:bg-slate-700/60 text-slate-200'
              }`}
            >
              <Search
                size={12}
                className={`mt-0.5 shrink-0 ${i === activeIndex ? 'text-amber-400' : 'text-slate-500'}`}
              />
              <div className="min-w-0">
                <div className="text-xs font-semibold truncate">{s.short_name || s.display_name}</div>
                {s.display_name && s.display_name !== s.short_name ? (
                  <div className="text-[11px] text-slate-500 truncate mt-0.5">{s.display_name}</div>
                ) : null}
              </div>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
