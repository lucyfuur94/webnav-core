export interface SnapNode {
  role: string;
  name: string | null;
  ref: string | null;
  url: string | null;
  raw: string;
}

const NODE_RE = /^(\w[\w-]*)\s*(?:"([^"]*)")?/;
const REF_RE = /\[ref=(e\d+)\]/;
const URL_RE = /^\/url:\s*(.+)$/;

export function parseSnapshot(yml: string): SnapNode[] {
  const lines = yml.split('\n');
  const nodes: SnapNode[] = [];
  for (const line of lines) {
    const trimmed = line.trim().replace(/^-\s*/, '');
    if (!trimmed) continue;

    const urlMatch = trimmed.match(URL_RE);
    if (urlMatch && nodes.length > 0) {
      nodes[nodes.length - 1].url = urlMatch[1].trim();
      continue;
    }
    const m = trimmed.match(NODE_RE);
    if (!m || !m[1]) continue;
    // Skip pure-text continuation lines (no recognizable role token)
    if (!/^[a-z]/.test(m[1])) continue;
    const refMatch = trimmed.match(REF_RE);
    nodes.push({
      role: m[1], name: m[2] ?? null, ref: refMatch ? refMatch[1] : null, url: null, raw: trimmed,
    });
  }
  return nodes;
}

export function findByRoleAndName(
  nodes: SnapNode[], role: string, name?: string,
): SnapNode | undefined {
  return nodes.find(
    (n) => n.role === role && (name === undefined || n.name === name),
  );
}
