// §5.2 Orientation (<=10s): the global navigation, shown ONCE with a LIVE clip of moving
// between two sections (clip-nav: lands on Reports, clicks Dashboards). Not a bullet list.
// A small label strip beneath names the five areas (map fact) — that's the "shown once".
import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {colors, fontFamily} from './theme';
import {DeviceFrame, Rect, CANVAS_W, MIN_MARGIN} from './frame';
import {shellDestinations} from './mapData';

// clip-nav is 800x450; trim leading dead time (lands, then moves). Show ~from 1s.
export const Orientation: React.FC<{startFrom: number; endAt: number}> = ({startFrom, endAt}) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	const enter = spring({frame, fps, config: {damping: 200, stiffness: 110, mass: 0.8}});
	const areas = shellDestinations().map((d) => d.label);

	const boxW = 1200;
	const boxH = Math.round((boxW * 450) / 800);
	const x = Math.round((CANVAS_W - boxW) / 2);
	const y = 110;
	const mediaRect: Rect = {x, y, w: boxW, h: boxH};
	const stripY = y + boxH + 52;

	return (
		<AbsoluteFill style={{background: colors.bg, fontFamily}}>
			<div style={{opacity: enter}}>
				<DeviceFrame
					kind="clip"
					file="clip-nav.webm"
					mediaRect={mediaRect}
					label="clip:clip-nav.webm"
					startFrom={startFrom}
					endAt={endAt}
				/>
			</div>
			<div
				style={{
					position: 'absolute',
					left: MIN_MARGIN,
					right: MIN_MARGIN,
					top: stripY,
					display: 'flex',
					gap: 22,
					justifyContent: 'center',
					flexWrap: 'wrap',
					opacity: interpolate(frame, [8, 24], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
				}}
			>
				{areas.map((a) => (
					<span
						key={a}
						style={{
							fontSize: 24,
							color: colors.text,
							fontWeight: 600,
							background: colors.card,
							border: `1px solid ${colors.border}`,
							borderRadius: 999,
							padding: '10px 22px',
						}}
					>
						{a}
					</span>
				))}
			</div>
		</AbsoluteFill>
	);
};
