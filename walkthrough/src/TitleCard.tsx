import React from 'react';
import {AbsoluteFill, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {colors, fontFamily} from './theme';

export const TitleCard: React.FC = () => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	const title = spring({frame, fps, config: {damping: 200, stiffness: 100, mass: 0.9}});
	const subtitle = spring({
		frame: frame - 12,
		fps,
		config: {damping: 200, stiffness: 100, mass: 0.9},
	});

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
					opacity: title,
					transform: `translateY(${(1 - title) * 24}px)`,
					fontSize: 84,
					fontWeight: 800,
					color: colors.text,
					letterSpacing: -1,
				}}
			>
				Prog Neo <span style={{color: colors.accent}}>&mdash;</span> Product Walkthrough
			</div>
			<div
				style={{
					opacity: subtitle,
					transform: `translateY(${(1 - subtitle) * 16}px)`,
					fontSize: 32,
					color: colors.textDim,
					marginTop: 24,
				}}
			>
				generated from its webnav map
			</div>
		</AbsoluteFill>
	);
};
