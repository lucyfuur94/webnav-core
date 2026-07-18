<!-- webnav-extension/README.md -->
# webnav recorder (Chrome MV3)

Sensor: `chrome.debugger` → CDP `Accessibility.getFullAXTree` (real native accessibility
tree, same source real assistive tech and Chrome DevTools use). The extension stays
DUMB — it POSTs the raw AX node array; the webnav server (`/ingest-ax`) adapts it into
the same `SnapNode[]` shape playwright produces and reconstructs fingerprints/diffs with
tested code. Loading the extension shows Chrome's "webnav recorder is debugging this
browser" banner — that's the `debugger` permission at work, expected and accepted (the
only way a content script's page can hand over `getFullAXTree`).

Increment B builds a single **"Capture this page"** action only (not the full
click→settle record loop — that's a later increment).

## Build

```
cd webnav-extension && npm i && npm run build
```

## Load and test

1. `webnav dev ingest --port 7778` (in the webnav repo — starts the local receiver).
2. `chrome://extensions` → Developer mode → Load unpacked → select this folder.
3. Open any page you want to map. Click the extension icon.
4. Set the session name (default `human-1`) and confirm the ingest URL
   (`http://127.0.0.1:7778/ingest-ax`).
5. Click **Capture this page**. Chrome shows the debugging banner while it captures,
   then it detaches automatically. The popup reports how many steps were ingested.
6. Back in the webnav repo: `webnav dev graph-analyse <session> --draft --skip-review-gate`
   — this should show the captured page's controls (buttons/links/inputs), matching what
   a playwright snapshot of the same page would show.

Secret rule: password / credit-card field *values* are never read — only role/name/url
structure is captured.
