// A brief SHARED stills-only beat for Help Center + Announcements (§4-5 allowance, IF
// total still-time stays < 40%). Two framed stills side by side with heading + one-line
// purpose beneath each. Stills are CONTAINED via DeviceFrame (asserts framing). A gentle
// Ken Burns (<=4% drift) on each, always fully containing the window.
import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {colors, fontFamily} from './theme';
import {DeviceFrame, Rect, MIN_MARGIN, FRAME_BORDER} from './frame';
import {displayName, purposeSentence} from './mapData';

type Panel = {file: string; state: string};

const PanelView: React.FC<{panel: Panel; box: Rect; delay: number}> = ({panel, box, delay}) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	const p = spring({frame: frame - delay, fps, config: {damping: 200, stiffness: 110, mass: 0.8}});

	// Ken Burns on the still: <=4% scale drift, no translate (stays fully contained).
	const scale = interpolate(frame, [0, 300], [1.0, 1.04], {extrapolateRight: 'clamp'});

	// Still 1280x720 in a 16:9 box.
	const boxH = Math.round((box.w * 720) / 1280);
	const mediaRect: Rect = {x: box.x, y: box.y, w: box.w, h: boxH};
	const capY = box.y + boxH + 30;

	return (
		<>
			<div style={{opacity: p}}>
				<DeviceFrame
					kind="still"
					file={panel.file}
					mediaRect={mediaRect}
					label={`still:${panel.file}`}
					scale={scale}
				/>
			</div>
			<div
				style={{
					position: 'absolute',
					left: mediaRect.x,
					width: mediaRect.w,
					top: capY,
					opacity: p,
				}}
			>
				<div style={{fontSize: 36, fontWeight: 700, color: colors.text}}>{displayName(panel.state)}</div>
				<div style={{fontSize: 22, color: colors.textDim, marginTop: 8, lineHeight: 1.4}}>
					{purposeSentence[panel.state]}
				</div>
			</div>
		</>
	);
};

export const StillsBeat: React.FC = () => {
	const frame = useCurrentFrame();
	const heading = interpolate(frame, [0, 14], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

	const panels: Panel[] = [
		{file: '4-help-center.png', state: 'help-center'},
		{file: '5-announcements.png', state: 'announcements'},
	];

	// Two boxes side by side, generous gutter. The MEDIA is inset by MIN_MARGIN+FRAME_BORDER
	// on the outer edges so the device CHROME (media grown by FRAME_BORDER) still lands
	// inside the safe area — otherwise assertContained throws.
	const inset = MIN_MARGIN + FRAME_BORDER;
	const topY = 190;
	const gutter = 80;
	const usableW = 1920 - inset * 2 - gutter;
	const boxW = Math.floor(usableW / 2);
	const boxes: Rect[] = [
		{x: inset, y: topY, w: boxW, h: 0},
		{x: inset + boxW + gutter, y: topY, w: boxW, h: 0},
	];

	return (
		<AbsoluteFill style={{background: colors.bg, fontFamily}}>
			<div
				style={{
					position: 'absolute',
					top: 70,
					left: 0,
					right: 0,
					textAlign: 'center',
					fontSize: 44,
					fontWeight: 800,
					color: colors.text,
					opacity: heading,
					letterSpacing: -0.5,
				}}
			>
				Support &amp; updates, always one click away
			</div>
			{panels.map((panel, i) => (
				<PanelView key={panel.file} panel={panel} box={boxes[i]} delay={8 + i * 8} />
			))}
		</AbsoluteFill>
	);
};
