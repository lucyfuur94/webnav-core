// `dev pattern-propose` (extension-loop plan Task 3): turn one `unknowns[]` entry from a
// `graph-analyse --draft` JSON report into a SCAFFOLDED pattern-pack proposal in
// `packs/patterns/proposed/<slug>.json` — the agent's on-ramp for closing an inference gap without
// touching core code (docs/EXTENDING.md is the full process). This module is pure (no fs) so it's
// unit-testable; cli.ts does the file read/write + prints the checklist + PR command.
import type { PatternPack, PackType, TriggerContext } from './patterns.js';
import { lintPackEntry } from './patterns.js';

// The minimal shape this reads from a graph-analyse --draft JSON file — just the one field this
// verb needs, never the whole DraftGraph type (keeps this module decoupled from draft.ts).
export interface UnknownLike {
  kind: string;
  evidence: string;
  context: string;
  extensionPoint: 'overlay-open' | 'value-domain' | 'core-design';
}

export interface ProposeResult {
  pack: PatternPack | null;          // null iff the unknown is core-design (no pack schema fits)
  lintReasons: string[];             // lintPackEntry(pack) — non-empty is EXPECTED (TODO trigger)
  coreDesignBoundary?: string;       // set instead of `pack` when extensionPoint === 'core-design'
}

// `evidence` is a flat, un-indented list of raw snapshot lines (draft.ts's evidenceOf — readable,
// not necessarily a valid nesting). Wrapped as a rootless depth-0 fixture: every line becomes a
// top-level `- <line>` so parseSnapshot accepts it; the agent adjusts nesting/root by hand if the
// real trigger needs to scope containment (documented in the printed checklist).
function evidenceToFixtureSnapshot(evidence: string): string {
  return evidence.split('\n').filter((l) => l.trim()).map((l) => `- ${l.trim()}`).join('\n');
}

// The context a pack's trigger should evaluate in, inferred from the unknown kind. Only the two
// pack-scaffoldable extensionPoints reach here (core-design returns before this is called).
const CONTEXT_BY_EXTENSION_POINT: Record<'overlay-open' | 'value-domain', TriggerContext> = {
  'overlay-open': 'diff.added',
  'value-domain': 'overlay',
};

/** Scaffold a PatternPack from one unknown. Pure — never touches disk. The returned pack's trigger
 *  is a deliberate TODO (empty `contains`) so lintPackEntry FAILS on it (loud, expected) until the
 *  agent fills in real predicates from the evidence. `core-design` unknowns get no pack at all —
 *  the honest boundary: file a core-design issue with the fixture instead (docs/EXTENDING.md). */
export function proposeFromUnknown(unknown: UnknownLike, name: string): ProposeResult {
  if (unknown.extensionPoint === 'core-design') {
    return {
      pack: null, lintReasons: [],
      coreDesignBoundary: `this unknown (kind: ${unknown.kind}) is NOT expressible as a pattern pack — `
        + `its extensionPoint is "core-design", meaning no existing pack TYPE (overlay-open | value-domain) can fix it. `
        + `File a core-design issue upstream with this unknown's evidence + context attached as the reproducing fixture; `
        + `do not hand-patch the engine.`,
    };
  }
  const type: PackType = unknown.extensionPoint;
  const pack: PatternPack = {
    name,
    version: 1,
    type,
    trigger: {
      context: CONTEXT_BY_EXTENSION_POINT[unknown.extensionPoint],
      // TODO(agent): narrow this — e.g. { role: 'generic' } for a role-less div-soup portal/grid.
      contains: [],   // TODO(agent): add >=1 { role, min?, attr? } predicate from the evidence below.
    },
    fixture: {
      snapshot: evidenceToFixtureSnapshot(unknown.evidence),
      expect: 'matched',
    },
    evidence: `${unknown.context} (scaffolded by dev pattern-propose from a graph-analyse unknown, kind=${unknown.kind})`,
  };
  return { pack, lintReasons: lintPackEntry(pack) };
}

/** Parse `--from-unknown <path>#<index>` into its two parts. Throws a plain Error with a usage
 *  hint on malformed input (cli.ts turns that into the standard {status:'error'} envelope). */
export function parseFromUnknownArg(raw: string): { path: string; index: number } {
  const hashIdx = raw.lastIndexOf('#');
  if (hashIdx < 0) throw new Error(`--from-unknown must be "<analyse-json-path>#<index>" (got ${JSON.stringify(raw)})`);
  const path = raw.slice(0, hashIdx);
  const index = Number(raw.slice(hashIdx + 1));
  if (!path || !Number.isInteger(index) || index < 0)
    throw new Error(`--from-unknown must be "<analyse-json-path>#<index>" with a non-negative integer index (got ${JSON.stringify(raw)})`);
  return { path, index };
}

/** Generate the `gh pr create` command an agent runs once the pack lints clean, re-analyse
 *  resolves the unknown, and a grammar fixture test is added. Cites the unknown's evidence in the
 *  PR body per the plan ("a generated body citing the evidence"). Prints only — NEVER auto-run. */
export function ghPrCommand(pack: PatternPack, unknown: UnknownLike): string {
  const title = `pattern pack: ${pack.name}`;
  const body = [
    `## Pattern pack: \`${pack.name}\` (${pack.type})`,
    '',
    `Resolves an extension-loop unknown (kind: \`${unknown.kind}\`) that the core's structural inference could not classify:`,
    '',
    '```',
    unknown.context,
    '```',
    '',
    '### Evidence',
    '```',
    unknown.evidence,
    '```',
    '',
    `Pack file: \`packs/patterns/core/${pack.name}.json\` (moved from \`proposed/\` after review). Lints clean, fixture passes, and a grammar test proves the resolved shape.`,
  ].join('\n');
  return `gh pr create --title ${JSON.stringify(title)} --body ${JSON.stringify(body)}`;
}
