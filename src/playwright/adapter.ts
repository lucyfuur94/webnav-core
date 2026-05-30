import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type RunFn = (args: string[]) => Promise<string>;
export type ReadFileFn = (path: string) => string;

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
  ) {}

  private async exec(...args: string[]): Promise<string> {
    this.callCount++;
    return this.run([`-s=${this.session}`, ...args]);
  }

  open(url: string) { return this.exec('open', url); }
  goto(url: string) { return this.exec('goto', url); }
  click(ref: string) { return this.exec('click', ref); }
  fill(ref: string, text: string) { return this.exec('fill', ref, text); }
  type(text: string) { return this.exec('type', text); }
  press(key: string) { return this.exec('press', key); }
  close() { return this.exec('close'); }

  /** Returns the snapshot YAML content (reads the file path printed by the CLI). */
  async snapshot(): Promise<string> {
    const out = await this.exec('snapshot');
    const m = out.match(/\(([^)]+\.yml)\)/);
    if (!m) throw new Error('snapshot: could not find YAML path in CLI output');
    return this.readFile(m[1]);
  }
}
