// §5.1 Cold open (<=5s): product name + one-line what-it-is, derived from the map's
// sections (the five shell destinations). No marketing superlatives.
import React from 'react';
import {AbsoluteFill, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {colors, fontFamily} from './theme';
import {shellDestinations} from './mapData';

export const ColdOpen: React.FC = () => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	const title = spring({frame, fps, config: {damping: 200, stiffness: 100, mass: 0.9}});
	const sub = spring({frame: frame - 12, fps, config: {damping: 200, stiffness: 100, mass: 0.9}});

	// One-line what-it-is: names the sections the product is made of (map fact).
	const areas = shellDestinations().map((d) => d.label);
	const oneLiner = `Reporting for publishers — ${areas.join(', ')}.`;

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
					fontSize: 108,
					fontWeight: 800,
					color: colors.text,
					letterSpacing: -1.5,
				}}
			>
				Prog Neo
			</div>
			<div
				style={{
					opacity: sub,
					transform: `translateY(${(1 - sub) * 16}px)`,
					fontSize: 32,
					color: colors.textDim,
					marginTop: 26,
					maxWidth: 1100,
					textAlign: 'center',
					lineHeight: 1.4,
				}}
			>
				{oneLiner}
			</div>
		</AbsoluteFill>
	);
};
