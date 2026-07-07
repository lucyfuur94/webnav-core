<!-- webnav-recorder/README.md -->
# webnav recorder (Chrome MV3)
1. `cd webnav-recorder && npm i -D typescript @types/chrome && npm run build`
2. `webnav dev ingest --port 7778` (in the webnav repo)
3. chrome://extensions → Developer mode → Load unpacked → select this folder
4. Open a site, click the extension → set session name → **Record** → do the flow → **Stop & send**
5. Back in webnav: `webnav dev graph-analyse <session> --draft` → `graph-edit` → `walk`
Secret rule: password / credit-card fields are never read for their value.
