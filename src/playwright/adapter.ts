import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';

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
}

const defaultRun: RunFn = async (args) => {
  const { stdout } = await execFileAsync('playwright-cli', args, { maxBuffer: 10 * 1024 * 1024 });
  return stdout;
};

export class PlaywrightAdapter {
  callCount = 0;
  constructor(
    private session: string,
    private run: RunFn = defaultRun,
    private readFile: ReadFileFn = (p) => readFileSync(p, 'utf8'),
    private opts: BrowserOpts = {},
  ) {}

  private async exec(...args: string[]): Promise<string> {
    this.callCount++;
    return this.run([`-s=${this.session}`, ...args]);
  }

  /** The `open`-only launch flags from BrowserOpts (headed/persistent/profile/browser). */
  private openFlags(): string[] {
    const f: string[] = [];
    if (this.opts.headed) f.push('--headed');
    if (this.opts.persistent) f.push('--persistent');
    if (this.opts.profile) f.push('--profile', this.opts.profile);
    if (this.opts.browser) f.push('--browser', this.opts.browser);
    return f;
  }

  open(url: string) { return this.exec('open', url, ...this.openFlags()); }
  goto(url: string) { return this.exec('goto', url); }
  click(ref: string) { return this.exec('click', ref); }
  fill(ref: string, text: string) { return this.exec('fill', ref, text); }
  type(text: string) { return this.exec('type', text); }
  press(key: string) { return this.exec('press', key); }
  evalJs(func: string) { return this.exec('eval', func); }
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
}
