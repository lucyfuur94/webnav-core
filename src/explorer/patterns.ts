// Declarative pattern packs (Phase 2 extension loop, 2026-07-11-future-proof-program.md §Phase 2 +
// 2026-07-12-extension-loop.md). An agent extends STRUCTURE coverage by adding a JSON data entry —
// NEVER by touching core code. Every safety property here is the whole point:
//
//  • The core's effect set is CLOSED. A pack maps a STRUCTURAL trigger onto exactly one of TWO
//    existing effects: `overlay-open` (feeds the openedOverlay detection) and `value-domain` (feeds
//    the folded/value exclusion sets). Both effects only make the engine MORE CONSERVATIVE about
//    what it STORES — a pack can gate storage, it can NEVER mint an affordance, edge, or state.
//  • The trigger schema is STRUCTURAL-ONLY: ARIA roles, containment (root/contains + min counts),
//    bracket-attribute presence, and an evaluation context. It has NO field for a hostname, URL, or
//    free text, and lint REJECTS any string value that is not a known ARIA role or attribute name.
//    That is what makes a site-rule impossible to express — a pack cannot say "on example.com".
//  • Zero LLM at runtime; packs are pure data; loads are deterministic (sorted filenames).
//  • A missing/invalid pack is a LOUD failure listing the lint reasons — never silently skipped.
//
// This module is PURE (no fs beyond the loader) and side-effect-free so draft.ts can inject packs
// for tests. loadPatternPacks reads the two shipped dirs by default.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SnapNode } from '../playwright/snapshot.js';
import { parseSnapshot } from '../playwright/snapshot.js';

// ── ALLOW-LISTS (documented constants — the ENTIRE structural vocabulary a trigger may name) ──
// A trigger string is legal iff it is one of these. Anything else (a hostname, a URL, a product
// word, a UI label) is a NAMED lint rejection. Keep these lists as the single source of truth;
// growing coverage = adding a role here + a pack entry, never a code branch.

// The WAI-ARIA role vocabulary our snapshots actually surface (playwright-cli accessibility tree).
// Superset of the roles the engine already switches on (CONTROL_ROLES, OVERLAY_ROLES,
// REVEAL_CHILD_ROLES, columnheader/table/main/option/…) plus the common landmark/structure roles
// from the WAI-ARIA Authoring Practices that a div-soup fixture is described in terms of. `generic`
// is IN on purpose: a role-less div-soup portal snapshots as `generic`, and matching it is exactly
// the coverage gap packs exist to close.
export const ARIA_ROLES: ReadonlySet<string> = new Set([
  // landmarks / document structure
  'main', 'navigation', 'banner', 'contentinfo', 'complementary', 'region', 'search', 'form',
  'article', 'document', 'application', 'group', 'generic', 'presentation', 'none',
  // widgets / interactive
  'button', 'link', 'textbox', 'searchbox', 'combobox', 'spinbutton', 'checkbox', 'radio',
  'switch', 'slider', 'option', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab',
  'treeitem', 'listbox', 'menu', 'menubar', 'tablist', 'tree', 'radiogroup',
  // overlays / dialogs / status
  'dialog', 'alertdialog', 'tooltip', 'alert', 'status', 'progressbar',
  // collections / tabular / grid
  'list', 'listitem', 'table', 'row', 'rowgroup', 'cell', 'gridcell', 'columnheader',
  'rowheader', 'grid', 'treegrid', 'heading', 'img', 'figure', 'separator',
  'paragraph', 'blockquote', 'code', 'time', 'definition', 'term',
]);

// ARIA state/property attribute NAMES a trigger may test for PRESENCE of (bracket attributes in a
// snapshot line, e.g. `[aria-sort=ascending]`). Names only — a trigger tests that the attribute is
// PRESENT, never its value (a value could smuggle in free text). The set mirrors the WAI-ARIA
// state/property vocabulary; `aria-sort` is the one the core already reads (sortable columnheader).
export const ARIA_ATTRS: ReadonlySet<string> = new Set([
  'aria-sort', 'aria-expanded', 'aria-selected', 'aria-checked', 'aria-pressed',
  'aria-current', 'aria-haspopup', 'aria-modal', 'aria-disabled', 'aria-hidden',
  'aria-readonly', 'aria-required', 'aria-multiselectable', 'aria-level', 'aria-orientation',
]);

// Evaluation CONTEXT: which node list the engine feeds a trigger. These are the two hook sites plus
// the interior-synthesis candidate set — closed enum, each a real hook in draft.ts.
export const TRIGGER_CONTEXTS = ['diff.added', 'overlay', 'landing'] as const;
export type TriggerContext = (typeof TRIGGER_CONTEXTS)[number];

// The CLOSED effect set (mirrors program-spec §Phase 2). A pack `type` picks the effect its trigger
// fires. Adding a third would be a deliberate CORE increment, never a pack.
export const PACK_TYPES = ['overlay-open', 'value-domain'] as const;
export type PackType = (typeof PACK_TYPES)[number];

// ── SCHEMA TYPES ──

// A single containment predicate: ≥`min` descendant nodes of role `role` (optionally bearing ARIA
// attribute `attr`) inside the matched root subtree. `min` defaults to 1.
export interface ContainsPredicate {
  role: string;      // must be in ARIA_ROLES
  min?: number;      // ≥1 integer; default 1
  attr?: string;     // must be in ARIA_ATTRS; tests bracket-attribute PRESENCE on the node
}

// The structural trigger: within `context`, find a `root` node (role match, default = whole list)
// and require every `contains` predicate to hold inside its subtree (nearest-lower-depth idiom).
export interface Trigger {
  context: TriggerContext;
  root?: { role: string; attr?: string };   // omit → the whole node list is the root
  contains: ContainsPredicate[];             // ≥1 predicate; ALL must hold
}

// The embedded fixture: a snapshot fragment + the effect it MUST produce. Lint runs it through the
// real evaluator so a pack cannot ship a trigger that doesn't do what its author claims.
export interface Fixture {
  snapshot: string;                 // YAML-ish snapshot literal (parseSnapshot format)
  expect: 'matched' | 'unmatched';  // running the trigger over the parsed snapshot must equal this
}

export interface PatternPack {
  name: string;        // slug (kebab); identifies the entry, never used as a trigger value
  version: number;     // integer ≥1
  type: PackType;
  trigger: Trigger;
  fixture: Fixture;
  evidence: string;    // one-line provenance (human prose; NOT a trigger value, never evaluated)
  source?: string;     // set by the loader: which file this came from (for loud error messages)
}

// ── LINT ──
// JSON-schema-style validation IN CODE (no new dep) + forbidden-value scan + fixture execution.
// Returns [] when clean; otherwise a list of NAMED reasons (the loud-failure message).

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Validate ONE pack entry. Pure. Every failure is a specific, named reason (no generic "invalid").
 *  Order: shape → forbidden-value scan (roles/attrs) → fixture execution. */
export function lintPackEntry(raw: unknown): string[] {
  const errs: string[] = [];
  if (!isPlainObject(raw)) return ['entry is not a JSON object'];

  // ── shape ──
  if (typeof raw.name !== 'string' || !SLUG_RE.test(raw.name))
    errs.push(`"name" must be a kebab-case slug (got ${JSON.stringify(raw.name)})`);
  if (typeof raw.version !== 'number' || !Number.isInteger(raw.version) || raw.version < 1)
    errs.push(`"version" must be an integer ≥1 (got ${JSON.stringify(raw.version)})`);
  if (typeof raw.type !== 'string' || !(PACK_TYPES as readonly string[]).includes(raw.type))
    errs.push(`"type" must be one of ${PACK_TYPES.join(' | ')} (got ${JSON.stringify(raw.type)})`);
  if (typeof raw.evidence !== 'string' || !raw.evidence.trim())
    errs.push('"evidence" must be a non-empty one-line provenance string');

  // ── trigger shape + forbidden-value scan ──
  const trig = raw.trigger;
  if (!isPlainObject(trig)) {
    errs.push('"trigger" must be an object');
  } else {
    if (typeof trig.context !== 'string' || !(TRIGGER_CONTEXTS as readonly string[]).includes(trig.context))
      errs.push(`trigger.context must be one of ${TRIGGER_CONTEXTS.join(' | ')} (got ${JSON.stringify(trig.context)})`);
    if (trig.root !== undefined) {
      if (!isPlainObject(trig.root) || typeof trig.root.role !== 'string') {
        errs.push('trigger.root, when present, must be { role, attr? }');
      } else {
        if (!ARIA_ROLES.has(trig.root.role))
          errs.push(`trigger.root.role ${JSON.stringify(trig.root.role)} is not a known ARIA role — hostnames/URLs/text are forbidden; only ARIA roles are allowed`);
        if (trig.root.attr !== undefined && (typeof trig.root.attr !== 'string' || !ARIA_ATTRS.has(trig.root.attr)))
          errs.push(`trigger.root.attr ${JSON.stringify(trig.root.attr)} is not a known ARIA attribute name`);
      }
    }
    if (!Array.isArray(trig.contains) || trig.contains.length === 0) {
      errs.push('trigger.contains must be a non-empty array of predicates');
    } else {
      trig.contains.forEach((p: unknown, i: number) => {
        if (!isPlainObject(p) || typeof p.role !== 'string') {
          errs.push(`trigger.contains[${i}] must be { role, min?, attr? }`);
          return;
        }
        if (!ARIA_ROLES.has(p.role))
          errs.push(`trigger.contains[${i}].role ${JSON.stringify(p.role)} is not a known ARIA role — hostnames/URLs/text are forbidden; only ARIA roles are allowed`);
        if (p.min !== undefined && (typeof p.min !== 'number' || !Number.isInteger(p.min) || p.min < 1))
          errs.push(`trigger.contains[${i}].min must be an integer ≥1 (got ${JSON.stringify(p.min)})`);
        if (p.attr !== undefined && (typeof p.attr !== 'string' || !ARIA_ATTRS.has(p.attr)))
          errs.push(`trigger.contains[${i}].attr ${JSON.stringify(p.attr)} is not a known ARIA attribute name`);
      });
    }
  }

  // ── fixture shape ──
  const fx = raw.fixture;
  if (!isPlainObject(fx)) {
    errs.push('"fixture" is required — { snapshot, expect }');
  } else {
    if (typeof fx.snapshot !== 'string' || !fx.snapshot.trim())
      errs.push('fixture.snapshot must be a non-empty snapshot literal');
    if (fx.expect !== 'matched' && fx.expect !== 'unmatched')
      errs.push('fixture.expect must be "matched" or "unmatched"');
  }

  // ── fixture EXECUTION (only when shape is otherwise clean, so we don't run a malformed trigger) ──
  if (errs.length === 0) {
    const pack = raw as unknown as PatternPack;
    const nodes = parseSnapshot((fx as Fixture).snapshot);
    const got = evaluateTrigger(pack.trigger, nodes) ? 'matched' : 'unmatched';
    if (got !== (fx as Fixture).expect)
      errs.push(`fixture failed: trigger evaluated to "${got}" but fixture.expect is "${(fx as Fixture).expect}"`);
  }
  return errs;
}

// ── TRIGGER EVALUATOR ──
// Pure: given a trigger + the evidence nodes for its context, return match/no-match. Uses the SAME
// nearest-lower-depth containment idiom as infer.ts (insideOverlay / subtreeFolds' parent walk) so a
// `contains` predicate counts only nodes genuinely INSIDE the matched root subtree.

const BRACKET = (raw: string, attr: string): boolean => new RegExp(`\\[${attr}(?:[=\\]])`).test(raw);
const attrOk = (n: SnapNode, attr?: string): boolean => attr === undefined || BRACKET(n.raw, attr);

/** Is node `desc` a descendant of node at index `rootIdx` in the flat depth-ordered list? A node is
 *  in the subtree iff it comes after rootIdx and every intervening depth stays > root depth (the
 *  moment depth drops back to ≤ root's, the subtree ended). Same nearest-lower-depth reasoning as
 *  insideOverlay, expressed forward. */
function subtreeEnd(nodes: SnapNode[], rootIdx: number): number {
  const rootDepth = nodes[rootIdx].depth;
  let end = rootIdx + 1;
  while (end < nodes.length && nodes[end].depth > rootDepth) end++;
  return end;   // exclusive
}

/** Count nodes matching a predicate within [lo, hi). */
function countMatches(nodes: SnapNode[], lo: number, hi: number, p: ContainsPredicate): number {
  let c = 0;
  for (let i = lo; i < hi; i++) if (nodes[i].role === p.role && attrOk(nodes[i], p.attr)) c++;
  return c;
}

/** Do ALL contains-predicates hold inside [lo, hi)? */
function allContain(nodes: SnapNode[], lo: number, hi: number, preds: ContainsPredicate[]): boolean {
  return preds.every((p) => countMatches(nodes, lo, hi, p) >= (p.min ?? 1));
}

export function evaluateTrigger(trigger: Trigger, nodes: SnapNode[]): boolean {
  if (!nodes.length) return false;
  const preds = trigger.contains;
  // No root declared → the whole list is one root subtree.
  if (!trigger.root) return allContain(nodes, 0, nodes.length, preds);
  // Root declared → try each node that matches the root role/attr; a match on ANY root subtree fires.
  const { role, attr } = trigger.root;
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].role !== role || !attrOk(nodes[i], attr)) continue;
    const end = subtreeEnd(nodes, i);
    // predicates count DESCENDANTS (exclude the root itself → i+1).
    if (allContain(nodes, i + 1, end, preds)) return true;
  }
  return false;
}

// ── LOADER ──
// Deterministic (sorted filenames) load of the two shipped dirs. A file that isn't valid JSON, or an
// entry that fails lint, throws a LOUD error naming the file + reasons — never silently skipped.

// The shipped pack dirs, resolved relative to THIS module so they work from src (tsx) and dist.
// src/explorer/patterns.ts → ../../packs/patterns/{core,proposed}; dist/explorer → same relative
// (packs is not compiled, it ships as data). readdir tolerates a missing dir (returns []).
function defaultPackDirs(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, '..', '..');   // repo root from src/explorer OR dist/explorer
  return [join(root, 'packs', 'patterns', 'core'), join(root, 'packs', 'patterns', 'proposed')];
}

/** Load every `*.json` pack entry from the given dirs (default = the two shipped dirs), sorted by
 *  filename for determinism. Each file holds ONE entry (object) OR an array of entries. Throws on the
 *  first invalid file/entry with a message listing the lint failures (loud, per the plan). */
export function loadPatternPacks(dirs: string[] = defaultPackDirs()): PatternPack[] {
  const out: PatternPack[] = [];
  for (const dir of dirs) {
    let files: string[];
    try { files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort(); }
    catch { continue; }   // missing dir → nothing to load (not an error)
    for (const file of files) {
      const path = join(dir, file);
      let parsed: unknown;
      try { parsed = JSON.parse(readFileSync(path, 'utf8')); }
      catch (e) { throw new Error(`pattern pack ${path}: not valid JSON — ${(e as Error).message}`); }
      const entries = Array.isArray(parsed) ? parsed : [parsed];
      entries.forEach((entry, i) => {
        const reasons = lintPackEntry(entry);
        if (reasons.length) {
          const where = Array.isArray(parsed) ? `${path}[${i}]` : path;
          throw new Error(`pattern pack ${where} failed lint:\n  - ${reasons.join('\n  - ')}`);
        }
        out.push({ ...(entry as PatternPack), source: path });
      });
    }
  }
  return out;
}

// ── DRAFT-SIDE HELPERS (thin, so draft.ts wiring stays a one-liner per hook) ──

/** Hook 1 (overlay-open): did ANY overlay-open pack trigger match these diff.added nodes? Called
 *  ONLY when the built-in openedOverlay detection declined — a match flips detection true. */
export function packDetectsOverlay(packs: PatternPack[], addedNodes: SnapNode[]): boolean {
  return packs.some((p) => p.type === 'overlay-open' && evaluateTrigger(p.trigger, addedNodes));
}

/** Hook 2 (value-domain): the set of NODE NAMES a value-domain pack marks as value data within the
 *  given candidate nodes. A node joins the excluded set iff it sits inside a firing trigger's matched
 *  subtree (the value grid), so its name never becomes an affordance / never anchors a fingerprint.
 *  Returns names (callers filter by name, matching enumeratedNames/templateFolds.gatedNames). */
export function packValueNames(packs: PatternPack[], nodes: SnapNode[]): Set<string> {
  const names = new Set<string>();
  for (const p of packs) {
    if (p.type !== 'value-domain') continue;
    for (const idx of matchedSubtreeIndices(p.trigger, nodes)) {
      const nm = nodes[idx].name;
      if (nm && nm.trim()) names.add(nm);
    }
  }
  return names;
}

/** Indices of every node inside a firing trigger's matched root subtree (empty when it doesn't
 *  fire). Rootless trigger → the whole list. Root trigger → every matching root's subtree. */
function matchedSubtreeIndices(trigger: Trigger, nodes: SnapNode[]): number[] {
  if (!nodes.length || !evaluateTrigger(trigger, nodes)) return [];
  if (!trigger.root) return nodes.map((_, i) => i);
  const { role, attr } = trigger.root;
  const acc: number[] = [];
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].role !== role || !attrOk(nodes[i], attr)) continue;
    const end = subtreeEnd(nodes, i);
    if (allContain(nodes, i + 1, end, trigger.contains)) for (let j = i + 1; j < end; j++) acc.push(j);
  }
  return acc;
}
