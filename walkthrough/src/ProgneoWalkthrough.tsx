import React from 'react';
import {AbsoluteFill, Sequence, interpolate, useCurrentFrame} from 'remotion';
import {colors} from './theme';
import {sec} from './timing';
import {ColdOpen} from './ColdOpen';
import {Orientation} from './Orientation';
import {Chapter, ClipSpec, chapterDuration} from './Chapter';
import {StillsBeat} from './StillsBeat';
import {Close} from './Close';
import {tiersFor, purposeSentence, displayName} from './mapData';

const CROSSFADE = sec(0.4); // §4: quick 300-450ms, one style, no bounce.

// Fade a segment in/out at its edges — the single consistent transition.
const FadeWrap: React.FC<{children: React.ReactNode; durationInFrames: number}> = ({
	children,
	durationInFrames,
}) => {
	const frame = useCurrentFrame();
	const opacity = interpolate(
		frame,
		[0, CROSSFADE, durationInFrames - CROSSFADE, durationInFrames],
		[0, 1, 1, 0],
		{extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}
	);
	return <AbsoluteFill style={{opacity}}>{children}</AbsoluteFill>;
};

// ── clip trim windows (source frames @ 30fps of the 800x450 recordings) ────────────────
// Every recording has a LEAD-IN we must skip: a Chrome DNS-error placeholder frame (whose
// URL text would leak the internal clip name) + a "Preparing your workspace" splash, before
// the real product UI renders. startFrom is set PAST that lead-in for each clip (verified
// per-clip: real UI appears ~3-4s in). Clip motion is kept the DOMINANT share of runtime
// (still-time < 40% per §6); the builder additionally skips its ~11s query-settle.
const CLIP: Record<string, {startFrom: number; endAt: number}> = {
	reports: {startFrom: 120, endAt: 420}, //   4s  -> 14s   (type "Device", clear)  = 10s
	openReport: {startFrom: 90, endAt: 345}, //  3s  -> 11.5s (click a report -> open)= 8.5s
	builder: {startFrom: 330, endAt: 840}, //   11s  -> 28s   (settled report + chips)= 17s
	dashboards: {startFrom: 90, endAt: 570}, //  3s  -> 19s   (open dashboard -> chart)= 16s
	downloads: {startFrom: 90, endAt: 480}, //   3s  -> 16s   (Owned -> Shared tab)   = 13s
	nav: {startFrom: 90, endAt: 450}, //         3s  -> 15s   (Reports -> Dashboards) = 12s
};
const clipLen = (k: keyof typeof CLIP) => CLIP[k].endAt - CLIP[k].startFrom;

const c = (
	file: string,
	trim: {startFrom: number; endAt: number},
	caption: string
): ClipSpec => ({file, srcW: 800, srcH: 450, startFrom: trim.startFrom, endAt: trim.endAt, caption});

const CARD = sec(4.5);

// Chapter definitions, in shell-nav order (Reports, Builder, Dashboards, Downloads).
const chapters = [
	{
		index: 1,
		state: 'report-list',
		clips: [
			c('clip-reports.webm', CLIP.reports, 'Searching for a report by name'),
			c('clip-open-report.webm', CLIP.openReport, 'Opening a report'),
		],
		clipDurations: [clipLen('reports'), clipLen('openReport')],
	},
	{
		index: 2,
		state: 'report',
		clips: [c('clip-builder.webm', CLIP.builder, 'Adjusting a report’s dimensions')],
		clipDurations: [clipLen('builder')],
	},
	{
		index: 3,
		state: 'dashboard-list',
		clips: [c('clip-dashboards.webm', CLIP.dashboards, 'Opening a dashboard')],
		clipDurations: [clipLen('dashboards')],
	},
	{
		index: 4,
		state: 'download-list',
		clips: [c('clip-downloads.webm', CLIP.downloads, 'Switching to files shared with you')],
		clipDurations: [clipLen('downloads')],
	},
];

export const ProgneoWalkthrough: React.FC = () => {
	let cursor = 0;
	const segments: {from: number; duration: number; node: React.ReactNode}[] = [];
	const push = (duration: number, node: React.ReactNode) => {
		segments.push({from: cursor, duration, node});
		cursor += duration;
	};

	push(sec(6.5), <ColdOpen />); // §5.1
	push(clipLen('nav'), <Orientation startFrom={CLIP.nav.startFrom} endAt={CLIP.nav.endAt} />); // §5.2

	for (const ch of chapters) {
		const dur = chapterDuration(ch.clipDurations, CARD);
		push(
			dur,
			<Chapter
				index={ch.index}
				title={displayName(ch.state)}
				purpose={purposeSentence[ch.state]}
				tiers={tiersFor(ch.state)}
				clips={ch.clips}
				clipDurations={ch.clipDurations}
				cardDuration={CARD}
			/>
		);
	}

	push(sec(8), <StillsBeat />); // §4-5 shared stills-only beat (Help Center + Announcements)
	push(sec(5), <Close />); // §5.4

	return (
		<AbsoluteFill style={{background: colors.bg}}>
			{segments.map((s, i) => (
				<Sequence key={i} from={s.from} durationInFrames={s.duration}>
					<FadeWrap durationInFrames={s.duration}>{s.node}</FadeWrap>
				</Sequence>
			))}
		</AbsoluteFill>
	);
};

// Total duration = sum of all segments (computed the same way the loop pushes them).
const clipTotal =
	clipLen('nav') +
	chapters.reduce((a, ch) => a + chapterDuration(ch.clipDurations, CARD), 0);
export const TOTAL_DURATION = sec(6.5) + clipTotal + sec(8) + sec(5);
