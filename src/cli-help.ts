// Pure string builders for help text, driven entirely by the COMMANDS registry
// so help and parsing never drift. No I/O here — main() does the printing.

import { COMMANDS, CONSUMER_COMMANDS, DEV_COMMANDS, VERSION, type CommandSpec } from './cli-spec.js';

const GLOBAL_FLAGS = [
  { name: '--help, -h', description: 'Show help (this menu, or per-command help).' },
  { name: '--version, -V', description: 'Print the webnav version and exit.' },
  { name: '--json', description: 'Emit machine-readable JSON to stdout only (suppress human prose).' },
];

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

export function topLevelHelp(): string {
  const lines: string[] = [];
  lines.push('webnav — a navigation memory for AI agents: record a site once, then walk routes to your goals deterministically (zero-LLM). Read pages and search the web too.');
  lines.push('');
  lines.push('Usage: webnav <command> [args...] [flags]');
  lines.push(`Version: ${VERSION}`);
  lines.push('');
  lines.push('use — drive the browser + query the map:');
  lines.push('');
  const GROUPS: { key: 'find' | 'read' | 'navigate'; header: string }[] = [
    { key: 'find', header: 'Find:      (where is it)' },
    { key: 'read', header: 'Read:      (get content / evidence)' },
    { key: 'navigate', header: 'Navigate:  (drive a page)' },
  ];
  const nameWidth = Math.max(...CONSUMER_COMMANDS.map((c) => c.name.length));
  for (const g of GROUPS) {
    const cmds = CONSUMER_COMMANDS.filter((c) => c.group === g.key);
    if (cmds.length === 0) continue;
    lines.push(g.header);
    for (const c of cmds) {
      lines.push(`  ${pad(c.name, nameWidth)}  ${c.summary}`);
    }
    lines.push('');
  }
  // dev — the authoring/inspection verbs. Shown here too (not just under
  // `webnav dev --help`) so a single `webnav --help` is a complete tool list;
  // they stay a separate CATEGORY (invoked as `webnav dev <cmd>`) because they
  // build/inspect the map rather than drive it at runtime.
  lines.push('dev — teach & inspect the map (run as `webnav dev <command>`):');
  lines.push('');
  const devWidth = Math.max(...DEV_COMMANDS.map((c) => c.name.length));
  for (const c of DEV_COMMANDS) {
    lines.push(`  ${pad(c.name, devWidth)}  ${c.summary}`);
  }
  lines.push('');
  lines.push('Global flags:');
  const flagWidth = Math.max(...GLOBAL_FLAGS.map((f) => f.name.length));
  for (const f of GLOBAL_FLAGS) {
    lines.push(`  ${pad(f.name, flagWidth)}  ${f.description}`);
  }
  lines.push('');
  lines.push('Run `webnav <command> --help` (or `webnav dev <command> --help`) for details.');
  return lines.join('\n');
}

export function devHelp(): string {
  const lines: string[] = [];
  lines.push('webnav dev — teaching & inspection tools (not needed for normal use).');
  lines.push('');
  lines.push('Usage: webnav dev <command> [args...]');
  lines.push('');
  lines.push('Commands:');
  const nameWidth = Math.max(...DEV_COMMANDS.map((c) => c.name.length));
  for (const c of DEV_COMMANDS) {
    lines.push(`  ${pad(c.name, nameWidth)}  ${c.summary}`);
  }
  lines.push('');
  lines.push('Run `webnav dev <command> --help` for details.');
  return lines.join('\n');
}

function usageLine(c: CommandSpec): string {
  const parts = ['Usage: webnav', c.name];
  for (const a of c.args) {
    parts.push(a.required ? `<${a.name}>` : `[${a.name}]`);
  }
  if (c.flags.length > 0) parts.push('[flags]');
  return parts.join(' ');
}

export function commandHelp(name: string): string {
  const c = COMMANDS.find((cmd) => cmd.name === name);
  if (!c) {
    return `Unknown command: ${name}\nRun \`webnav --help\` to see available commands.`;
  }
  const lines: string[] = [];
  lines.push(usageLine(c));
  lines.push('');
  lines.push(c.summary);
  if (c.args.length > 0) {
    lines.push('');
    lines.push('Arguments:');
    const w = Math.max(...c.args.map((a) => a.name.length));
    for (const a of c.args) {
      const req = a.required ? 'required' : 'optional';
      lines.push(`  ${pad(a.name, w)}  (${req}) ${a.description}`);
    }
  }
  if (c.flags.length > 0) {
    lines.push('');
    lines.push('Flags:');
    for (const f of c.flags) {
      const sig = f.takesValue ? `${f.name} <value>` : f.name;
      const def = f.default !== undefined ? ` (default: ${f.default})` : '';
      lines.push(`  ${sig}${def} — ${f.description}`);
    }
  }
  lines.push('');
  lines.push(`Example: ${c.example}`);
  return lines.join('\n');
}
