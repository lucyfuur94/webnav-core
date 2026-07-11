import React from 'react';
import {AbsoluteFill, Sequence, staticFile, interpolate, useCurrentFrame} from 'remotion';
import {colors} from './theme';
import {TitleCard} from './TitleCard';
import {ShellChapter} from './ShellChapter';
import {ScreenshotChapter} from './ScreenshotChapter';
import {ReportBuilderChapter} from './ReportBuilderChapter';
import {OutroCard} from './OutroCard';
import {screenshotChapters, FPS} from './chapters';

const sec = (n: number) => n * FPS;

const TITLE_DUR = sec(8);
const SHELL_DUR = sec(10);
const REPORT_DUR = sec(12);
const OUTRO_DUR = sec(7);
const CROSSFADE = sec(0.6);

// Fades a child sequence in and out at its edges — avoids hard cuts without a transitions dep.
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

export const ProgneoWalkthrough: React.FC = () => {
	let cursor = 0;
	const segments: {from: number; duration: number; node: React.ReactNode}[] = [];

	segments.push({from: cursor, duration: TITLE_DUR, node: <TitleCard />});
	cursor += TITLE_DUR;

	segments.push({from: cursor, duration: SHELL_DUR, node: <ShellChapter />});
	cursor += SHELL_DUR;

	for (const ch of screenshotChapters) {
		segments.push({
			from: cursor,
			duration: ch.durationInFrames,
			node: (
				<ScreenshotChapter
					src={staticFile(ch.file)}
					title={ch.title}
					blurb={ch.blurb}
					actions={ch.actions}
					durationInFrames={ch.durationInFrames}
				/>
			),
		});
		cursor += ch.durationInFrames;
	}

	segments.push({from: cursor, duration: REPORT_DUR, node: <ReportBuilderChapter />});
	cursor += REPORT_DUR;

	segments.push({from: cursor, duration: OUTRO_DUR, node: <OutroCard />});
	cursor += OUTRO_DUR;

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

export const TOTAL_DURATION =
	TITLE_DUR +
	SHELL_DUR +
	screenshotChapters.reduce((acc, c) => acc + c.durationInFrames, 0) +
	REPORT_DUR +
	OUTRO_DUR;
