import { useCallback, useEffect, useState } from 'react';

// Shared light/dark theme, PERSISTED in localStorage so it survives navigating
// between the map and an interior, reloads, and sessions. Both views use this so
// the theme is consistent everywhere.
const KEY = 'webnav.theme';

function read(): boolean {
  try { return localStorage.getItem(KEY) === 'dark'; } catch { return false; }
}

export function useTheme(): { dark: boolean; toggle: () => void } {
  const [dark, setDark] = useState<boolean>(read);

  useEffect(() => {
    try { localStorage.setItem(KEY, dark ? 'dark' : 'light'); } catch { /* ignore */ }
  }, [dark]);

  // Keep multiple mounted views (or other tabs) in sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setDark(e.newValue === 'dark');
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const toggle = useCallback(() => setDark((v) => !v), []);
  return { dark, toggle };
}
