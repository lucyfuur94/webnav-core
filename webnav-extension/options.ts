// webnav-extension/options.ts — full-page settings.
// Reads/writes the SAME chrome.storage.local keys the panel reads (sid/base/token),
// so the panel's storage.onChanged listener updates the live panel with no reload.
export {}; // isolate this file's top-level scope from sidepanel.ts (both are ES modules at runtime)
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const baseEl = byId<HTMLInputElement>('base');
const tokenEl = byId<HTMLInputElement>('token');
const sidEl = byId<HTMLInputElement>('sid');
const savedEl = byId<HTMLSpanElement>('saved');

chrome.storage.local.get(['sid', 'base', 'token']).then((s) => {
  if (s.base) baseEl.value = s.base as string;
  if (s.token) tokenEl.value = s.token as string;
  if (s.sid) sidEl.value = s.sid as string;
});

let savedTimer: ReturnType<typeof setTimeout> | undefined;
function flashSaved(): void {
  savedEl.classList.add('show');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => savedEl.classList.remove('show'), 1200);
}

// Persist on change; token is trimmed to match the panel's handling.
baseEl.onchange = () => { chrome.storage.local.set({ base: baseEl.value.trim() }); flashSaved(); };
tokenEl.onchange = () => { chrome.storage.local.set({ token: tokenEl.value.trim() }); flashSaved(); };
sidEl.onchange = () => { chrome.storage.local.set({ sid: sidEl.value.trim() }); flashSaved(); };
