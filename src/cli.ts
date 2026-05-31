import { topLevelHelp, commandHelp } from './cli-help.js';
import { VERSION, COMMANDS } from './cli-spec.js';

export type ParsedArgs =
  | { cmd: 'help'; command?: string }
  | { cmd: 'version' }
  | { cmd: 'list' }
  | { cmd: 'describe'; place: string }
  | { cmd: 'locate'; place: string }
  | { cmd: 'recall'; query: string; top: number }
  | { cmd: 'search'; query: string; top: number }
  | { cmd: 'capture'; url: string; out: string };

const KNOWN_VERBS = new Set(COMMANDS.map((c) => c.name));

export function parseArgs(argv: string[]): ParsedArgs {
  // Global help/version and empty argv are checked BEFORE the verb switch.
  if (argv.length === 0) return { cmd: 'help' };
  const first = argv[0];
  if (first === '--help' || first === '-h') return { cmd: 'help' };
  if (first === '--version' || first === '-V') return { cmd: 'version' };

  const [cmd, ...rest] = argv;

  // Per-command trailing help: `webnav <verb> --help` → help for that verb.
  // Checked after identifying the verb so `recall --help` doesn't try to run.
  if (KNOWN_VERBS.has(cmd) && (rest.includes('--help') || rest.includes('-h'))) {
    return { cmd: 'help', command: cmd };
  }

  if (cmd === 'list') return { cmd };
  if (cmd === 'describe') return { cmd, place: rest[0] };
  if (cmd === 'locate') return { cmd, place: rest[0] };
  if (cmd === 'capture') return { cmd, url: rest[0], out: rest[1] };
  if (cmd === 'recall') {
    const query = rest[0];
    const top = rest.includes('--top') ? Number(rest[rest.indexOf('--top') + 1]) : 10;
    return { cmd, query, top };
  }
  if (cmd === 'search') {
    const query = rest[0];
    const top = rest.includes('--top') ? Number(rest[rest.indexOf('--top') + 1]) : 3;
    return { cmd, query, top };
  }
  throw new Error(`unknown command: ${cmd}\nRun \`webnav --help\` to see available commands.`);
}

async function main() {
  const rawArgs = process.argv.slice(2);
  // --json is a global output-mode flag detected directly in main() rather than
  // threaded through the ParsedArgs union (which would complicate every variant).
  // Under --json, ONLY pure JSON is written to stdout; all diagnostics → stderr.
  const json = rawArgs.includes('--json');
  const args = parseArgs(rawArgs);

  if (args.cmd === 'help') {
    // Help is informational: pure stdout, exit 0.
    console.log(args.command ? commandHelp(args.command) : topLevelHelp());
    return;
  }
  if (args.cmd === 'version') {
    console.log(VERSION);
    return;
  }
  if (args.cmd === 'list') {
    // "what's on this map?" — known sites, places, goals. No browser needed.
    const { listCoverage } = await import('./router/catalog.js');
    console.log(JSON.stringify(listCoverage(), null, 2));
    return;
  }
  if (args.cmd === 'describe') {
    // "what's at A / what can I do here?" — affordances + address. No browser.
    const { describePlace } = await import('./router/catalog.js');
    console.log(JSON.stringify(describePlace(args.place), null, 2));
    return;
  }
  if (args.cmd === 'locate') {
    // "where is A?" — return the coordinate WITHOUT navigating. No browser needed.
    const { locate } = await import('./router/locate.js');
    console.log(JSON.stringify(locate(args.place), null, 2));
    return;
  }
  if (args.cmd === 'capture') {
    const { capture } = await import('./playwright/capture.js');
    await capture(args.url, args.out);
    // Under --json, emit a clean JSON receipt instead of human prose so stdout
    // stays pure JSON. Otherwise the human-friendly progress line goes to stderr.
    if (json) {
      console.log(JSON.stringify({ captured: args.url, out: args.out }));
    } else {
      console.error(`captured ${args.url} -> ${args.out}`);
    }
    return;
  }
  if (args.cmd === 'search') {
    // search: open-web search — search engine → top-N results → visit + extract
    // answer-evidence. Prints a SearchGatherResult JSON for the calling agent.
    const { runSearchLive } = await import('./router/search-live.js');
    const response = await runSearchLive(args.query, args.top);
    console.log(JSON.stringify(response, null, 2));
    // "ran fine but found nothing / blocked" → exit 3 so an agent's shell can
    // distinguish a clean empty result from a crash.
    if (isEmptyOrFailed(response)) process.exitCode = 3;
    return;
  }
  // recall: open GitHub search for the query, then drive recall() over the live
  // browser. Prints a RecallResponse JSON for the calling agent.
  const { runRecallLive } = await import('./router/live.js');
  const response = await runRecallLive(args.query, args.top);
  console.log(JSON.stringify(response, null, 2));
  if (isEmptyOrFailed(response)) process.exitCode = 3;
}

// A result that "ran fine but found nothing/blocked/failed" → exit code 3.
function isEmptyOrFailed(response: unknown): boolean {
  if (!response || typeof response !== 'object') return false;
  const r = response as Record<string, unknown>;
  if (r.status === 'failed') return true;
  // search: zero results gathered.
  if (Array.isArray(r.results) && r.results.length === 0) return true;
  if (Array.isArray(r.evidence) && r.evidence.length === 0) return true;
  return false;
}

// Only run when invoked directly, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  // Thrown errors (bad args, unknown verb, crash) → stderr + exit code 2.
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  });
}
