export type ParsedArgs =
  | { cmd: 'list' }
  | { cmd: 'describe'; place: string }
  | { cmd: 'locate'; place: string }
  | { cmd: 'recall'; query: string; top: number }
  | { cmd: 'search'; query: string; top: number }
  | { cmd: 'capture'; url: string; out: string };

export function parseArgs(argv: string[]): ParsedArgs {
  const [cmd, ...rest] = argv;
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
  throw new Error(`usage: webnav list\n       webnav describe "<place>"\n       webnav locate "<place>"\n       webnav recall "<use-case>" [--top N]\n       webnav search "<query>" [--top N]\n       webnav capture <url> <out.yml>`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
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
    console.log(`captured ${args.url} -> ${args.out}`);
    return;
  }
  if (args.cmd === 'search') {
    // search: open-web search — search engine → top-N results → visit + extract
    // answer-evidence. Prints a SearchGatherResult JSON for the calling agent.
    const { runSearchLive } = await import('./router/search-live.js');
    const response = await runSearchLive(args.query, args.top);
    console.log(JSON.stringify(response, null, 2));
    return;
  }
  // recall: open GitHub search for the query, then drive recall() over the live
  // browser. Prints a RecallResponse JSON for the calling agent.
  const { runRecallLive } = await import('./router/live.js');
  const response = await runRecallLive(args.query, args.top);
  console.log(JSON.stringify(response, null, 2));
}

// Only run when invoked directly, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
