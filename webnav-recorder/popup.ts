// webnav-recorder/popup.ts
const $ = (id: string) => document.getElementById(id) as HTMLInputElement;
const btn = (id: string) => document.getElementById(id) as HTMLButtonElement;
const statusEl = () => document.getElementById('status')!;

btn('capture').onclick = async () => {
  const button = btn('capture');
  button.disabled = true;
  statusEl().textContent = 'capturing…';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('no active tab');
    const r = await chrome.runtime.sendMessage({
      type: 'capture', tabId: tab.id, sessionId: $('sid').value, ingestUrl: $('url').value,
    });
    statusEl().innerHTML = r?.ok
      ? `✓ sent <b>${r.appended}</b> step${r.appended === 1 ? '' : 's'} to webnav`
      : `✗ ${r?.error ?? 'failed'}`;
  } catch (e) {
    statusEl().textContent = `✗ ${String(e)}`;
  }
  button.disabled = false;
};
