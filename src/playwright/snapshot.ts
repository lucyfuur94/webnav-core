export interface SnapNode {
  role: string;
  name: string | null;
  ref: string | null;
  url: string | null;
  raw: string;
  depth: number;   // indentation depth = leading-space count of the raw line (structure for `near` anchoring)
}

// We parse line-by-line with regex rather than the `yaml` dependency on purpose:
// playwright-cli's snapshot output is YAML-ISH but not valid YAML. Lines carry
// non-YAML trailing tokens (`link "Learn more" [ref=e6] [cursor=pointer]`) and
// bare keys like `/url:`, which would make `yaml.parse` choke. Do NOT swap this
// for the yaml dep without first confirming it handles those trailing tokens.

// Role token is matched case-insensitively (`\w[\w-]*`): playwright-cli emits
// both lowercase roles (`link`, `searchbox`) and capitalized ones
// (`StaticText`, `RootWebArea`, `WebArea`).
const NODE_RE = /^(\w[\w-]*)\s*(?:"([^"]*)")?/;
const REF_RE = /\[ref=(e\d+)\]/;
// Any bracketed attribute, e.g. [ref=e6], [level=1], [cursor=pointer].
const ATTR_RE = /\[[^\]]+\]/;
const URL_RE = /^\/url:\s*(.+)$/;

export function parseSnapshot(yml: string): SnapNode[] {
  const lines = yml.split('\n');
  const nodes: SnapNode[] = [];
  for (const line of lines) {
    const depth = line.length - line.replace(/^ */, '').length;   // leading-space count, BEFORE trim
    const trimmed = line.trim().replace(/^-\s*/, '');
    if (!trimmed) continue;

    // A `/url:` line declares the destination of the node ON THE LINE BEFORE it.
    // We attach it to the most-recently-pushed node, assuming the `/url:` line
    // immediately follows its owning node (true for playwright-cli output).
    const urlMatch = trimmed.match(URL_RE);
    if (urlMatch && nodes.length > 0) {
      nodes[nodes.length - 1].url = urlMatch[1].trim();
      continue;
    }
    const m = trimmed.match(NODE_RE);
    if (!m || !m[1]) continue;
    // A line is a real node only if it carries structure: a quoted "name", a
    // bracketed attribute (`[ref=eN]`, `[level=N]`, `[cursor=...]`), or both. A
    // bare word with none of those is wrapped prose continuation -> skip it.
    // (Capitalization is NOT a signal: capitalized roles are valid nodes.)
    const hasName = m[2] !== undefined;
    const hasAttr = ATTR_RE.test(trimmed);
    if (!hasName && !hasAttr) continue;
    const refMatch = trimmed.match(REF_RE);
    // NOTE: names with escaped quotes (e.g. `"say \"hi\""`) are not handled;
    // NODE_RE stops the name at the first inner quote. Out of scope for v1.
    nodes.push({
      role: m[1], name: m[2] ?? null, ref: refMatch ? refMatch[1] : null, url: null, raw: trimmed, depth,
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
