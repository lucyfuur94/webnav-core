import React from 'react';
import {AbsoluteFill, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {colors, fontFamily} from './theme';
import {STATES} from './mapData';

export const OutroCard: React.FC = () => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	const p = spring({frame, fps, config: {damping: 200, stiffness: 100, mass: 0.9}});
	const stateCount = Object.keys(STATES).length;

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
					transform: `translateY(${(1 - p) * 20}px)`,
					fontSize: 40,
					color: colors.textDim,
					marginBottom: 20,
				}}
			>
				map: {stateCount} states &middot; built by observation
			</div>
			<div
				style={{
					opacity: p,
					transform: `translateY(${(1 - p) * 20}px)`,
					fontSize: 64,
					fontWeight: 800,
					color: colors.accent,
					letterSpacing: -0.5,
				}}
			>
				webnav
			</div>
		</AbsoluteFill>
	);
};
