// The webnav map (map.json) is the SINGLE SOURCE OF TRUTH for every word on screen.
// This module turns raw map facts into (1) plain-English display names, (2) purpose
// sentences, and (3) a three-TIER action structure — all DERIVED, none invented.
// The trace of every on-screen sentence -> the map facts it derives from lives in
// walkthrough/copy-trace.md (kept in sync by hand; the derivation rules ARE the code here).
import mapJson from '../map.json';

export type Affordance = {
	kind: 'navigate' | 'reveal' | 'mutate' | 'input' | 'commit';
	label: string;
	toState: string | null;
	scope?: 'row' | 'widget' | null;
	children?: {label: string; kind?: string}[] | null;
};

export type MapState = {
	semanticName: string;
	role: string;
	urlPattern: string;
	fingerprint?: string[];
	affordances: Affordance[];
	declaredShadow?: {filters?: {field: string; control: string}[]} | null;
};

const raw = mapJson as unknown as {node: string; states: MapState[]};

export const NODE = raw.node;
export const STATES: Record<string, MapState> = Object.fromEntries(
	raw.states.map((s) => [s.semanticName, s])
);

// ── §1 Display names ────────────────────────────────────────────────────────────────
// The product's own heading is the display name. The map stores it as a fingerprint
// token "heading:Reports" / "heading:Dashboards" etc. A state with no heading gets a
// composed name from its parent + role (e.g. the report builder), still map-derived,
// never a technical id like `report-list` or `_shell`.
const headingFp = (s: MapState): string | null => {
	const h = (s.fingerprint ?? []).find((f) => f.startsWith('heading:'));
	return h ? h.slice('heading:'.length) : null;
};

// Composed names for states that carry no heading token — derived from parent + role.
// `report` (role: detail, parent: report-list "Reports") is the builder you land in when
// you open a report; `dashboard-category` (role: detail, parent: dashboard-list) is the
// dashboard viewer. Both names trace to map structure (parent heading + role: detail).
const composedNames: Record<string, string> = {
	report: 'The report builder',
	'dashboard-category': 'The dashboard viewer',
};

export const displayName = (stateRef: string): string => {
	// Accept either a bare semanticName ("report-list") or a full state id
	// ("progneo.analytics.mn:report-list"); STATES is keyed by semanticName.
	const key = stateRef.includes(':') ? stateRef.slice(stateRef.lastIndexOf(':') + 1) : stateRef;
	const s = STATES[key];
	if (!s) return key; // never leak the node-prefixed id, even on a miss
	return headingFp(s) ?? composedNames[key] ?? key;
};

// ── data-value vs structure guard ─────────────────────────────────────────────────────
// A few affordance labels are DATA values that leaked into the map (a specific dashboard
// row + timestamp, an OS-legend name). They are never shown as capabilities. ponytail:
// simple name-shape heuristic — the map's declaredShadow doesn't cover every state, so a
// pattern is the smallest correct guard here.
const looksLikeDataValue = (label: string) =>
	/\d{4}|IST|UTC|Legend item|Ad Impressions|Revenue|Merged Change/.test(label);

// Global shell chrome (sidebar nav, dark-mode toggle, close-sidebar) belongs to the
// Orientation beat, not a page's capabilities.
const shellLabels = new Set(STATES['_shell'].affordances.map((a) => a.label));
const isShellChrome = (a: Affordance) =>
	shellLabels.has(a.label) ||
	(a.kind === 'reveal' &&
		!!a.children?.length &&
		a.children.every((c) => shellLabels.has(c.label)));

// AG-grid widget chrome + pagination — Tier-3 material, folded into one summary line.
const isPagerOrWidget = (label: string) =>
	/^(First|Previous|Next|Last) Page$|^Page( Size)?$|Press Space|Column with Header Selection|Refresh list|Deselect All|Full screen|View All|Expand drilldown/.test(
		label
	);

// ── §2 Tier mapping (DERIVED FROM THE MAP, documented next to the data) ────────────────
// Tier 1 — the page's PURPOSE actions: navigate-to-creation (New X), the page's input
//          affordances (Search / build inputs), and reveal openers whose children are
//          build-verbs. 2-3 max, large + accent.
// Tier 2 — working actions: remaining named reveals/mutates, grouped by theme.
// Tier 3 — utility/chrome: scope:'row'/'widget' folds + pagination-shaped labels. ONE
//          quiet summary line, never bulleted with Tier 1.
export type Tiers = {
	tier1: string[];
	tier2Groups: {label: string; items: string[]}[];
	tier3: string | null;
};

// build-verb reveal = a reveal whose OWN label is a create/add/build action (its children
// are the build inputs, e.g. "Add dimensions" -> {Search}). These are the builder's reason
// to exist, so they belong in Tier 1.
const isBuildReveal = (a: Affordance) =>
	a.kind === 'reveal' && /^(Add|Create|New)\b/.test(a.label);

// A create/purpose action by label shape (New Report / New Dashboard).
const isCreateVerb = (label: string) => /^(New|Create)\b/.test(label);

// Theme buckets for Tier 2, matched by label — output, views, organisation. Order
// matters: "Owned/Shared"/"Favourites"/"Standard" are ORGANISE views (they contain the
// word "Shared" but are not export actions), so match Organise BEFORE Get-it-out.
const tier2Theme = (label: string): string => {
	if (/^(Favourites|Owned\/Shared|Standard)$/.test(label)) return 'Organise';
	if (/CSV|Download as|Save|Schedule|^Share$|Copy Link|^Copy$/.test(label)) return 'Get it out';
	if (/^(Table|Charts|Flat|Nested|Functions|Columns)$/.test(label)) return 'View it';
	return 'More';
};

export const tiersFor = (stateName: string): Tiers => {
	const s = STATES[stateName];
	if (!s) return {tier1: [], tier2Groups: [], tier3: null};

	const t1: string[] = [];
	const t2 = new Map<string, string[]>();
	let hasFold = false;
	const seen = new Set<string>();
	const push = (m: Map<string, string[]>, theme: string, v: string) => {
		if (!m.has(theme)) m.set(theme, []);
		m.get(theme)!.push(v);
	};

	for (const a of s.affordances) {
		if (a.label === stateName) continue; // self-loop tab
		if (looksLikeDataValue(a.label)) continue;
		if (isShellChrome(a)) continue;

		// Tier 3: row/widget-scoped + pager chrome → folded, not listed.
		if (a.scope === 'row' || a.scope === 'widget' || isPagerOrWidget(a.label)) {
			hasFold = true;
			continue;
		}
		if (seen.has(a.label)) continue;

		// Tier 1: create verbs, build reveals, and this page's Search input.
		if (isCreateVerb(a.label) || isBuildReveal(a) || (a.kind === 'input' && /^Search/.test(a.label))) {
			seen.add(a.label);
			if (t1.length < 3) t1.push(a.label);
			continue;
		}

		// Tier 2: remaining named reveals/mutates, grouped by theme.
		if ((a.kind === 'reveal' || a.kind === 'mutate') && a.label && a.label !== 'null') {
			seen.add(a.label);
			push(t2, tier2Theme(a.label), a.label);
		}
	}

	// Tier 3 summary line — only the affordances that actually fold.
	const rowLabels = s.affordances.some((a) => a.scope === 'row');
	const tier3 = hasFold
		? rowLabels
			? 'plus per-row actions and list controls (pagination, refresh, page size)'
			: 'plus list controls (pagination, refresh, page size)'
		: null;

	// Cap Tier 2 groups to keep cards legible; drop the catch-all "More" if it is empty
	// or would push the card past three themed groups.
	const order = ['Get it out', 'View it', 'Organise', 'More'];
	const tier2Groups = order
		.filter((t) => t2.has(t))
		.slice(0, 3)
		.map((t) => ({label: t, items: t2.get(t)!.slice(0, 4)}));

	return {tier1: t1, tier2Groups, tier3};
};

// ── purpose sentences (§1) ────────────────────────────────────────────────────────────
// Written like a human, but every noun/verb traces to a stored affordance / column /
// filter. Kept here so the copy-trace table can point at exactly one source line each.
export const purposeSentence: Record<string, string> = {
	// report-list: Search input + Standard/Owned-Shared/Favourites tabs + New Report + row link.
	'report-list':
		'Find any report by name, switch between Standard, owned and favourite views, or start a new one.',
	// report (builder): Add dimensions/metrics/filter reveals + Table/Charts + Download CSV / Save As.
	report:
		'Shape a view with dimensions, metrics and filters, read it as a table or charts, then download or schedule it.',
	// dashboard-list: Search input + row links + New Dashboard.
	'dashboard-list':
		'Browse your dashboards, open one to read its charts, or build a new one.',
	// dashboard-category (viewer): a live chart with a date range and Share/Customize.
	'dashboard-category':
		'Read a dashboard live, adjust its date range, and share it with your team.',
	// download-list: Owned/Shared tabs + Share reveal + Status column.
	'download-list':
		'Track your exported files, switch to ones shared with you, and share or re-download any of them.',
	// help-center: Search help + topic buttons (Working with Reports, Downloading Data, ...).
	'help-center':
		'Search the guides or jump to a topic — reports, downloads, dashboards and FAQs.',
	// announcements: Search + Feature release / Update filters + Read more.
	announcements: 'See product updates and feature releases, filtered by type.',
};

// ── Orientation (§5.2) ────────────────────────────────────────────────────────────────
// The five main areas, from _shell's navigate affordances (Logo dedup'd against Reports).
export const shellDestinations = (): {label: string; toState: string}[] => {
	const shell = STATES['_shell'];
	const seen = new Set<string>();
	const out: {label: string; toState: string}[] = [];
	for (const a of shell.affordances) {
		if (a.kind !== 'navigate' || !a.toState) continue;
		if (a.label === 'Logo Logo') continue; // logo also -> report-list; "Reports" is the real label
		if (seen.has(a.toState)) continue;
		seen.add(a.toState);
		out.push({label: displayName(a.toState), toState: a.toState});
	}
	return out;
};
