// A chapter (§5.3): title beat (1.5s) -> live clip with a caption line -> capability card.
// The clip is the motion spine; the card is the tiered summary. Clip and card are shown in
// sequence within the chapter so each gets full screen — clip framed left-of-centre with the
// caption beneath, then the card takes over.
import React from 'react';
import {AbsoluteFill, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {colors, fontFamily} from './theme';
import {DeviceFrame, Rect, MIN_MARGIN, CANVAS_W} from './frame';
import {CapabilityCard} from './CapabilityCard';
import {Tiers} from './mapData';
import {FPS} from './timing';

const sec = (n: number) => Math.round(n * FPS);

export type ClipSpec = {
	file: string;
	srcW: number;
	srcH: number;
	startFrom?: number; // frames into the source
	endAt?: number; // frames into the source
	caption: string;
};

// Title beat — 1.5s, big chapter number + name centred.
const TitleBeat: React.FC<{index: number; title: string}> = ({index, title}) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	const p = spring({frame, fps, config: {damping: 200, stiffness: 110, mass: 0.8}});
	return (
		<AbsoluteFill
			style={{
				background: colors.bg,
				fontFamily,
				alignItems: 'center',
				justifyContent: 'center',
				flexDirection: 'column',
			}}
		>
			<div
				style={{
					opacity: p,
					transform: `translateY(${(1 - p) * 18}px)`,
					fontSize: 26,
					color: colors.accent,
					fontWeight: 700,
					letterSpacing: 4,
					marginBottom: 18,
				}}
			>
				{String(index).padStart(2, '0')}
			</div>
			<div
				style={{
					opacity: p,
					transform: `translateY(${(1 - p) * 24}px)`,
					fontSize: 84,
					fontWeight: 800,
					color: colors.text,
					letterSpacing: -1,
				}}
			>
				{title}
			</div>
		</AbsoluteFill>
	);
};

// ClipStage — the live clip framed centre-upper with the caption beneath. The clip is
// contained (DeviceFrame asserts it) and sized so its media never exceeds 1.5x upscale
// (800 -> 1200). Caption occupies the space beneath.
const CLIP_MAX_W = 1200; // brief: <=1200px wide on the 1080p canvas

const ClipStage: React.FC<{clip: ClipSpec}> = ({clip}) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	const enter = spring({frame, fps, config: {damping: 200, stiffness: 110, mass: 0.8}});

	// Media box: centred horizontally, upper 66% of canvas (caption below). Fit a 16:9
	// clip into a box <= CLIP_MAX_W wide, leaving margin for the frame border + safe area.
	const boxW = CLIP_MAX_W;
	const boxH = Math.round((boxW * clip.srcH) / clip.srcW);
	const x = Math.round((CANVAS_W - boxW) / 2);
	const y = 120;
	const mediaRect: Rect = {x, y, w: boxW, h: boxH};

	const capY = y + boxH + 56;

	return (
		<AbsoluteFill style={{background: colors.bg, fontFamily}}>
			<div style={{opacity: enter, transform: `scale(${0.985 + enter * 0.015})`, transformOrigin: 'center 30%'}}>
				<DeviceFrame
					kind="clip"
					file={clip.file}
					mediaRect={mediaRect}
					label={`clip:${clip.file}`}
					startFrom={clip.startFrom}
					endAt={clip.endAt}
				/>
			</div>
			<div
				style={{
					position: 'absolute',
					left: MIN_MARGIN,
					right: MIN_MARGIN,
					top: capY,
					textAlign: 'center',
					opacity: interpolate(frame, [6, 20], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
				}}
			>
				<span
					style={{
						display: 'inline-flex',
						alignItems: 'center',
						gap: 14,
						fontSize: 34,
						color: colors.text,
						fontWeight: 600,
					}}
				>
					<span
						style={{
							width: 12,
							height: 12,
							borderRadius: 999,
							background: '#ff4d4f',
							boxShadow: '0 0 14px #ff4d4f',
						}}
					/>
					{clip.caption}
				</span>
			</div>
		</AbsoluteFill>
	);
};

// CardStage — the capability card, left-aligned with generous margins.
const CardStage: React.FC<{title: string; purpose: string; tiers: Tiers}> = ({title, purpose, tiers}) => {
	return (
		<AbsoluteFill
			style={{
				background: colors.bg,
				fontFamily,
				padding: '90px 120px',
				justifyContent: 'center',
			}}
		>
			<CapabilityCard title={title} purpose={purpose} tiers={tiers} startFrame={2} />
		</AbsoluteFill>
	);
};

export const Chapter: React.FC<{
	index: number;
	title: string;
	purpose: string;
	tiers: Tiers;
	clips: ClipSpec[];
	clipDurations: number[]; // frames, per clip
	cardDuration: number; // frames
}> = ({index, title, purpose, tiers, clips, clipDurations, cardDuration}) => {
	const titleDur = sec(1.5);
	let c = 0;
	const segs: {from: number; dur: number; node: React.ReactNode}[] = [];
	segs.push({from: c, dur: titleDur, node: <TitleBeat index={index} title={title} />});
	c += titleDur;
	clips.forEach((clip, i) => {
		segs.push({from: c, dur: clipDurations[i], node: <ClipStage clip={clip} />});
		c += clipDurations[i];
	});
	segs.push({from: c, dur: cardDuration, node: <CardStage title={title} purpose={purpose} tiers={tiers} />});
	c += cardDuration;

	return (
		<AbsoluteFill style={{background: colors.bg}}>
			{segs.map((s, i) => (
				<Sequence key={i} from={s.from} durationInFrames={s.dur}>
					{s.node}
				</Sequence>
			))}
		</AbsoluteFill>
	);
};

// Total frames a chapter occupies — used by the parent to lay chapters end-to-end.
export const chapterDuration = (
	clipDurations: number[],
	cardDuration: number
): number => sec(1.5) + clipDurations.reduce((a, b) => a + b, 0) + cardDuration;
