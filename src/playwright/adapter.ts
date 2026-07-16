import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { throttleOpen } from './throttle.js';
import { classifyReadiness } from '../router/readiness.js';

const execFileAsync = promisify(execFile);

export type RunFn = (args: string[]) => Promise<string>;
export type ReadFileFn = (path: string) => string;

// How the browser is launched (applied ONLY on `open`; the rest of the verbs act
// on the already-open session). Defaults to HEADLESS, so existing callers behave
// exactly as before.
//   headed     — show a real browser window. Needed for interactive login
//                (OAuth/2FA/CAPTCHA) and gets past some headless-only bot-walls.
//   persistent — reuse a persistent browser profile (a real, logged-in session
//                survives across runs). With `profile`, store it at that dir.
//   browser    — chrome | firefox | webkit | msedge.
export interface BrowserOpts {
  headed?: boolean;
  persistent?: boolean;
  profile?: string;
  browser?: string;
  configPath?: string;   // playwright-cli --config (JSON): used to launch the window MAXIMIZED
                         // (launchOptions.args --start-maximized + contextOptions.viewport:null)
                         // for headed capture sessions. Ignored on headless (fixed viewport is fine).
}

const defaultRun: RunFn = async (args) => {
  const { stdout } = await execFileAsync('playwright-cli', args, { maxBuffer: 10 * 1024 * 1024 });
  return stdout;
};

// macOS caps a unix-socket path (sun_path) at 104 bytes. playwright-cli's socket is
// $TMPDIR/playwright-cli/<16-char-hash>/<session>.sock and the darwin TMPDIR prefix is
// ~82 chars — so a session NAME over ~16 chars can hit `listen EINVAL` (live crash:
// 'replay-report-builder', 21 chars). Deterministic cap: same input → same wire name,
// so reattach through this adapter keeps working; names ≤16 are untouched (every seed/
// walk/record name in use today).
const WIRE_MAX = 16;
// djb2 xor variant — cheap, deterministic, good-enough spread for a 6-hex-digit tag.
export function wireSessionName(name: string): string {
  if (name.length <= WIRE_MAX) return name;
  let h = 5381;
  for (let i = 0; i < name.length; i++) h = ((h * 33) ^ name.charCodeAt(i)) >>> 0;
  const head = name.slice(0, 9).replace(/[^\w.-]/g, '_');
  return head + '-' + h.toString(16).padStart(6, '0').slice(0, 6);
}

export class PlaywrightAdapter {
  callCount = 0;
  constructor(
    private session: string,
    private run: RunFn = defaultRun,
    private readFile: ReadFileFn = (p) => readFileSync(p, 'utf8'),
    private opts: BrowserOpts = { headed: true },   // HEADED by default; pass {headed:false} for CI/headless
  ) { this.session = wireSessionName(session); }

  private async exec(...args: string[]): Promise<string> {
    this.callCount++;
    return this.run([`-s=${this.session}`, ...args]);
  }

  /** The `open`-only launch flags from BrowserOpts (headed/persistent/profile/browser/config). */
  private openFlags(): string[] {
    const f: string[] = [];
    if (this.opts.headed) f.push('--headed');
    if (this.opts.persistent) f.push('--persistent');
    if (this.opts.profile) f.push('--profile', this.opts.profile);
    if (this.opts.browser) f.push('--browser', this.opts.browser);
    // --config launches the window MAXIMIZED (viewport follows the window). Headed only:
    // headless has no window to maximize and wants a fixed viewport, so skip it there.
    if (this.opts.configPath && this.opts.headed) f.push('--config', this.opts.configPath);
    return f;
  }

  // open/goto are the NEW-client / explicit-jump page loads — gate them with the per-host
  // politeness throttle so a burst can't hammer one site. Intra-session clicks (below) are
  // NOT throttled: a held session navigating its own pages isn't a new client.
  async open(url: string) { await throttleOpen(url); return this.exec('open', url, ...this.openFlags()); }
  async goto(url: string) { await throttleOpen(url); return this.exec('goto', url); }
  click(ref: string) { return this.exec('click', ref); }
  fill(ref: string, text: string) { return this.exec('fill', ref, text); }
  type(text: string) { return this.exec('type', text); }
  press(key: string) { return this.exec('press', key); }
  hover(ref: string) { return this.exec('hover', ref); }
  evalJs(func: string, ref?: string) { return this.exec('eval', func, ...(ref ? [ref] : [])); }
  network() { return this.exec('network'); }
  goBack() { return this.exec('go-back'); }
  reload() { return this.exec('reload'); }
  waitFor(condition: string) { return this.exec('wait-for', condition); }
  close() { return this.exec('close'); }

  /** Fire an action on a ref (alias for click — the agent decides what to fire). */
  act(ref: string) { return this.click(ref).then(() => undefined); }

  /** Current page URL. Extracts the value from playwright-cli's `### Result`
   *  wrapper (if present) and strips the surrounding quotes off the scalar. */
  async currentUrl(): Promise<string> {
    const raw = await this.evalJs('() => location.href');
    const m = raw.match(/###\s*Result\s*\n([\s\S]*?)(?:\n###|\s*$)/);
    const body = (m ? m[1] : raw).trim();
    return body.replace(/^"|"$/g, '');
  }

  /** Returns the snapshot YAML content (reads the file path printed by the CLI). */
  async snapshot(): Promise<string> {
    const out = await this.exec('snapshot');
    const m = out.match(/\(([^)]+\.yml)\)/);
    if (!m) throw new Error('snapshot: could not find YAML path in CLI output');
    return this.readFile(m[1]);
  }

  /** Session video: start/stop recording of the driven window. stop() writes to the
   *  given filename (playwright-cli --filename) — best-effort, never throws. */
  async videoStart(): Promise<void> { await this.exec('video-start'); }   // caller logs failure
  async videoStop(filename: string): Promise<boolean> {
    try { await this.exec('video-stop', '--filename', filename); return true; }
    catch { return false; }
  }

  /** Screenshot the current page; returns the .png path playwright-cli printed, or
   *  null if none was found (callers treat shots as optional decoration). */
  async screenshot(): Promise<string | null> {
    try {
      const out = await this.exec('screenshot');
      const m = out.match(/\(([^)]+\.png)\)/) ?? out.match(/(\/\S+\.png)/);
      return m ? m[1] : null;
    } catch { return null; }
  }

  /**
   * Snapshot, but RETRY until the page is `ready` (a JS-SPA renders after first paint, so an
   * immediate snapshot catches an unfinished shell). Re-snapshots up
   * to `tries` times, `gapMs` apart, returning as soon as `classifyReadiness === 'ready'`;
   * returns the last snapshot if the budget is exhausted (so the caller still classifies it —
   * a genuine interstitial/bot-wall is surfaced, never evaded). The one-shot verbs (read /
   * eval-on-page / search visits) use THIS instead of a bare snapshot.
   */
  async snapshotReady(tries = 6, gapMs = 800): Promise<string> {
    let snap = await this.snapshot();
    for (let i = 0; i < tries && classifyReadiness(snap) === 'loading'; i++) {
      await new Promise((r) => setTimeout(r, gapMs));
      snap = await this.snapshot();
    }
    return snap;
  }
}

/** A --profile value is either an absolute/relative PATH (has a slash) or a bare
 *  session NAME → ~/.webnav/profiles/<name> (the dir the dashboard's persistent
 *  recording writes; a hand-done login/2FA there carries into every walk). Pure. */
export function resolveProfile(value: string, profilesRoot: string): string {
  if (value.includes('/')) return value;
  return profilesRoot.replace(/\/$/, '') + '/' + value.replace(/[^\w.-]/g, '_');
}
