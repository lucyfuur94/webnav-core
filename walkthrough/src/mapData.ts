// Reads the webnav map (map.json) — the single source of truth for all copy in this video.
// Every label/blurb below is derived from state names, affordance labels, or shadow filters.
// No invented marketing claims (per task COPY RULE).
import mapJson from '../map.json';

export type Affordance = {
	kind: 'navigate' | 'reveal' | 'mutate' | 'input' | 'commit';
	label: string;
	toState: string | null;
	scope?: 'row' | 'widget' | null;
	children?: {label: string}[] | null;
};

export type MapState = {
	semanticName: string;
	role: string;
	urlPattern: string;
	affordances: Affordance[];
	declaredShadow?: {filters?: {field: string; control: string}[]} | null;
};

const raw = mapJson as unknown as {node: string; states: MapState[]};

export const NODE = raw.node;
export const STATES: Record<string, MapState> = Object.fromEntries(
	raw.states.map((s) => [s.semanticName, s])
);

// A handful of per-row/per-record affordance labels are data VALUES that leaked into the
// map's labels (a specific dashboard name + timestamp), not structural actions. Screen them
// out of "key actions" lists — ponytail: simple name-shape heuristic, no shadow schema to
// lean on here since this map's declaredShadow doesn't cover dashboard-list/help-center/report.
const looksLikeDataValue = (label: string) => /\d{4}|IST|UTC/.test(label);

// Global shell chrome must not appear in a page chapter's key actions — it belongs to the
// Global-navigation chapter. A page affordance is shell chrome if its label is one of
// _shell's, or it's a reveal whose menu contains ONLY _shell labels (e.g. report-list's
// "Open sidebar" / "Light Mode" toggles — their children are all shell items).
const shellLabels = new Set(STATES['_shell'].affordances.map((a) => a.label));
const isShellChrome = (a: Affordance) =>
	shellLabels.has(a.label) ||
	(a.kind === 'reveal' &&
		!!a.children?.length &&
		a.children.every((c) => shellLabels.has(c.label)));

// ponytail: grid/pagination widget chrome (AG-grid a11y labels, pager buttons) crowds out
// real actions in a 6-slot list; simple label patterns, revisit if the map grows a scope for it.
const isWidgetChrome = (label: string) =>
	/^(First|Previous|Next|Last) Page$|^Page( Size)?$|Press Space|Column with Header Selection/.test(
		label
	);

export const keyActions = (stateName: string, limit = 6): string[] => {
	const state = STATES[stateName];
	if (!state) return [];
	const seen = new Set<string>();
	const out: string[] = [];
	for (const a of state.affordances) {
		if (looksLikeDataValue(a.label)) continue;
		if (a.label === stateName) continue; // e.g. report-list's own tab self-loop, not a distinct action
		if (isShellChrome(a)) continue;
		if (isWidgetChrome(a.label)) continue;
		if (seen.has(a.label)) continue;
		seen.add(a.label);
		const mark = a.kind === 'reveal' ? '▸ ' : a.scope === 'row' ? '×row ' : '';
		out.push(`${mark}${a.label}`);
		if (out.length >= limit) break;
	}
	return out;
};

export const shellDestinations = (): {label: string; toState: string}[] => {
	const shell = STATES['_shell'];
	const seen = new Set<string>();
	const out: {label: string; toState: string}[] = [];
	for (const a of shell.affordances) {
		if (a.kind !== 'navigate' || !a.toState) continue;
		if (a.label === 'Logo Logo') continue; // the logo also navigates to report-list; "Reports" is the real nav label
		if (seen.has(a.toState)) continue;
		seen.add(a.toState);
		out.push({label: a.label, toState: a.toState});
	}
	return out;
};

export const reportRepertoire = () => {
	const report = STATES['report'];
	const byKind = (labels: string[]) =>
		report.affordances.filter((a) => labels.includes(a.label)).map((a) => a.label);
	return {
		build: ['Add dimensions', 'Add metrics', 'Add filter'].filter((l) =>
			report.affordances.some((a) => a.label === l)
		),
		output: ['Download as formatted CSV', 'Share', 'Save As / Schedule'].filter((l) =>
			report.affordances.some((a) => a.label === l)
		),
		views: report.affordances
			.find((a) => a.label === 'Table')
			?.children?.map((c) => c.label)
			.filter((l) => l !== 'Search') ?? [],
	};
};
