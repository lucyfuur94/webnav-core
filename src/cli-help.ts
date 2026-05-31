// Pure string builders for help text, driven entirely by the COMMANDS registry
// so help and parsing never drift. No I/O here — main() does the printing.

import { COMMANDS, VERSION, type CommandSpec } from './cli-spec.js';

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
  lines.push('webnav — a map for the agent-internet: recall routes, locate places, search the web.');
  lines.push('');
  lines.push('Usage: webnav <command> [args...] [flags]');
  lines.push(`Version: ${VERSION}`);
  lines.push('');
  lines.push('Commands:');
  const nameWidth = Math.max(...COMMANDS.map((c) => c.name.length));
  for (const c of COMMANDS) {
    lines.push(`  ${pad(c.name, nameWidth)}  ${c.summary}`);
  }
  lines.push('');
  lines.push('Global flags:');
  const flagWidth = Math.max(...GLOBAL_FLAGS.map((f) => f.name.length));
  for (const f of GLOBAL_FLAGS) {
    lines.push(`  ${pad(f.name, flagWidth)}  ${f.description}`);
  }
  lines.push('');
  lines.push('Run `webnav <command> --help` for details.');
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
