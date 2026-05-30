import { PlaywrightAdapter } from './adapter.js';

/** Dev helper: open a URL and save its snapshot YAML to `out` (spec §6 fixtures). */
export async function capture(url: string, out: string): Promise<void> {
  const a = new PlaywrightAdapter(`capture-${Date.now()}`);
  await a.open(url);
  const yml = await a.snapshot();
  const { writeFileSync } = await import('node:fs');
  writeFileSync(out, yml);
  await a.close();
}
