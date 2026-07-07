// webnav-recorder/popup.ts
const $ = (id: string) => document.getElementById(id) as HTMLInputElement;
$('rec').onclick = () => chrome.storage.local.set({ recording: true }, () => { $('out').textContent = 'recording…'; });
$('stop').onclick = () => {
  chrome.storage.local.set({ recording: false });
  chrome.runtime.sendMessage(
    { type: 'stop', sessionId: $('sid').value, ingestUrl: $('url').value },
    (r) => { $('out').textContent = JSON.stringify(r); });
};
