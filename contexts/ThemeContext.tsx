'use client';
/**
 * ThemeContext.tsx
 *
 * Manages UI theme/appearance preference.
 *
 * Themes:
 *  'dark'   — Standard dark (default, current app look)
 *  'darker' — High-contrast OLED dark (deeper blacks, higher contrast)
 *  'dim'    — Slightly dimmed/warmer dark for low-light environments
 *
 * Stored in localStorage as 'solarpro-theme'.
 * Applied as a class on <html>: 'theme-dark' | 'theme-darker' | 'theme-dim'
 */

import React, { createContext, useContext, useEffect, useState } from 'react';

export type Theme = 'dark' | 'darker' | 'dim';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark',
  setTheme: () => {},
});

const STORAGE_KEY = 'solarpro-theme';
const VALID_THEMES: Theme[] = ['dark', 'darker', 'dim'];

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  // Remove all existing theme classes
  root.classList.remove('theme-dark', 'theme-darker', 'theme-dim');
  root.classList.add(`theme-${theme}`);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('dark');

  // Load saved theme on mount (client-only)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as Theme | null;
      const initial: Theme = VALID_THEMES.includes(saved as Theme) ? (saved as Theme) : 'dark';
      setThemeState(initial);
      applyTheme(initial);
    } catch {
      // localStorage not available — stay with default
    }
  }, []);

  const setTheme = (t: Theme) => {
    if (!VALID_THEMES.includes(t)) return;
    setThemeState(t);
    try { localStorage.setItem(STORAGE_KEY, t); } catch {}
    applyTheme(t);
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

export const THEME_CONFIG: Record<Theme, { label: string; description: string; icon: string }> = {
  dark:   { label: 'Dark',   description: 'Standard dark interface',          icon: '🌙' },
  darker: { label: 'OLED',   description: 'Pure black for OLED/battery life', icon: '⬛' },
  dim:    { label: 'Dim',    description: 'Warmer, dimmed for low-light use',  icon: '🌒' },
};
