// webnav-recorder/popup.ts
const $ = (id: string) => document.getElementById(id) as HTMLInputElement;
const btn = (id: string) => document.getElementById(id) as HTMLButtonElement;
const dot = () => document.getElementById('dot')!;
const statusEl = () => document.getElementById('status')!;

// Reflect current state on every popup open (the popup is transient — it must READ
// the persisted flag + live step count, not assume it's fresh).
function render(recording: boolean, steps: number): void {
  dot().classList.toggle('on', recording);
  btn('rec').disabled = recording;
  statusEl().innerHTML = recording
    ? `recording — <b>${steps}</b> step${steps === 1 ? '' : 's'} captured`
    : (steps ? `stopped — <b>${steps}</b> step${steps === 1 ? '' : 's'} buffered` : 'idle');
}

async function refresh(): Promise<void> {
  const { recording } = await chrome.storage.local.get('recording');
  const st = await chrome.runtime.sendMessage({ type: 'status' }).catch(() => ({ steps: 0 }));
  render(!!recording, st?.steps ?? 0);
}

$('rec').onclick = async () => {
  await chrome.storage.local.set({ recording: true });
  await chrome.runtime.sendMessage({ type: 'reset' });  // fresh buffer for a new recording
  refresh();
};
$('stop').onclick = async () => {
  await chrome.storage.local.set({ recording: false });
  statusEl().textContent = 'sending…';
  const r = await chrome.runtime.sendMessage(
    { type: 'stop', sessionId: $('sid').value, ingestUrl: $('url').value }).catch((e) => ({ ok: false, error: String(e) }));
  statusEl().innerHTML = r?.ok
    ? `✓ sent <b>${r.appended}</b> step${r.appended === 1 ? '' : 's'} to webnav`
    : `✗ ${r?.error ?? 'failed'}`;
  dot().classList.remove('on');
  btn('rec').disabled = false;
};

// live count while the popup is open
refresh();
setInterval(refresh, 1000);
