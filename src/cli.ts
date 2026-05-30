export type ParsedArgs =
  | { cmd: 'recall'; query: string; top: number }
  | { cmd: 'capture'; url: string; out: string };

export function parseArgs(argv: string[]): ParsedArgs {
  const [cmd, ...rest] = argv;
  if (cmd === 'capture') return { cmd, url: rest[0], out: rest[1] };
  if (cmd === 'recall') {
    const query = rest[0];
    const top = rest.includes('--top') ? Number(rest[rest.indexOf('--top') + 1]) : 10;
    return { cmd, query, top };
  }
  throw new Error(`usage: webnav recall "<use-case>" [--top N]\n       webnav capture <url> <out.yml>`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.cmd === 'capture') {
    const { capture } = await import('./playwright/capture.js');
    await capture(args.url, args.out);
    console.log(`captured ${args.url} -> ${args.out}`);
    return;
  }
  // recall: open GitHub search for the query, then drive recall() over the live
  // browser. Prints a RecallResponse JSON for the calling agent. Wired in Task 13.
  const { runRecallLive } = await import('./router/live.js');
  const response = await runRecallLive(args.query, args.top);
  console.log(JSON.stringify(response, null, 2));
}

// Only run when invoked directly, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
