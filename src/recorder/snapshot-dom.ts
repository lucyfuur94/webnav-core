// src/recorder/snapshot-dom.ts
// Serialize an accessibility tree to the playwright-parity snapshot text that
// src/playwright/snapshot.ts::parseSnapshot reads. Pure + deterministic; the
// in-repo test oracle for the extension's browser-side twin.
// TWIN of webnav-recorder/serialize.ts::serialize — MUST stay in sync (same
// ~15-line algorithm, duplicated deliberately; see the ponytail note there).

export interface SerializableNode {
  role: string;
  name: string | null;
  url?: string | null;
  children?: SerializableNode[];
}

// Assign a sequential synthetic ref (e1, e2, …) to EVERY node in pre-order, so
// even nameless icon nodes carry a bracketed attr and survive parseSnapshot
// (which drops a line that has neither a quoted name nor a [attr]).
export function serializeSnapshot(root: SerializableNode): string {
  const lines: string[] = [];
  let counter = 0;
  const walk = (node: SerializableNode, depth: number): void => {
    const ref = `e${++counter}`;
    const indent = '  '.repeat(depth);
    const namePart = node.name !== null ? ` "${node.name}"` : '';
    lines.push(`${indent}${node.role}${namePart} [ref=${ref}]`);
    if (node.url) lines.push(`${indent}  /url: ${node.url}`);
    for (const child of node.children ?? []) walk(child, depth + 1);
  };
  walk(root, 0);
  return lines.join('\n');
}
