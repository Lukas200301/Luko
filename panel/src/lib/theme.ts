import { useEffect, useState } from 'react';

type Theme = 'dark' | 'light';

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem('luko-theme');
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    // Storage can be unavailable (private mode); fall back to the system preference.
  }
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function applyStoredTheme(): void {
  document.documentElement.classList.toggle('dark', readTheme() === 'dark');
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readTheme);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      localStorage.setItem('luko-theme', theme);
    } catch {
      // Ignore, the theme just won't be remembered.
    }
  }, [theme]);

  return { theme, toggle: () => setTheme(t => (t === 'dark' ? 'light' : 'dark')) };
}
