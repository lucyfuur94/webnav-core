// §5.4 Close (<=5s): where to learn more + the provenance line (small).
import React from 'react';
import {AbsoluteFill, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {colors, fontFamily} from './theme';
import {STATES, displayName} from './mapData';

export const Close: React.FC = () => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	const p = spring({frame, fps, config: {damping: 200, stiffness: 100, mass: 0.9}});
	const sub = spring({frame: frame - 12, fps, config: {damping: 200, stiffness: 100, mass: 0.9}});
	// "where to learn more" — the product's own Help Center (map heading).
	const help = displayName('help-center');
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
					transform: `translateY(${(1 - p) * 22}px)`,
					fontSize: 56,
					fontWeight: 800,
					color: colors.text,
					letterSpacing: -0.6,
					textAlign: 'center',
				}}
			>
				Learn more in the {help}
			</div>
			<div
				style={{
					opacity: sub,
					transform: `translateY(${(1 - sub) * 14}px)`,
					fontSize: 22,
					color: colors.textDim,
					marginTop: 40,
				}}
			>
				generated from the product&rsquo;s webnav map &middot; {stateCount} states, built by observation
			</div>
		</AbsoluteFill>
	);
};
