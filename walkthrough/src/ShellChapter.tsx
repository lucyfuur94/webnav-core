import React from 'react';
import {AbsoluteFill, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {colors, fontFamily} from './theme';
import {shellDestinations} from './mapData';

export const ShellChapter: React.FC = () => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	const heading = spring({frame, fps, config: {damping: 200, stiffness: 110, mass: 0.8}});
	const destinations = shellDestinations();

	return (
		<AbsoluteFill
			style={{
				background: colors.bg,
				fontFamily,
				alignItems: 'center',
				justifyContent: 'center',
				flexDirection: 'column',
				padding: '0 120px',
			}}
		>
			<div
				style={{
					opacity: heading,
					transform: `translateY(${(1 - heading) * 20}px)`,
					fontSize: 52,
					fontWeight: 700,
					color: colors.text,
					marginBottom: 60,
					textAlign: 'center',
				}}
			>
				One global navigation, five main areas
			</div>
			<div style={{display: 'flex', gap: 28, flexWrap: 'wrap', justifyContent: 'center'}}>
				{destinations.map((d, i) => {
					const delay = 10 + i * 8;
					const p = spring({
						frame: frame - delay,
						fps,
						config: {damping: 200, stiffness: 120, mass: 0.7},
					});
					return (
						<div
							key={d.label}
							style={{
								opacity: p,
								transform: `translateY(${(1 - p) * 30}px) scale(${0.92 + p * 0.08})`,
								background: colors.card,
								border: `1px solid ${colors.border}`,
								borderRadius: 16,
								padding: '32px 40px',
								minWidth: 220,
								textAlign: 'center',
							}}
						>
							<div
								style={{
									width: 12,
									height: 12,
									borderRadius: 999,
									background: colors.accent,
									margin: '0 auto 18px',
								}}
							/>
							<div style={{fontSize: 34, fontWeight: 600, color: colors.text}}>{d.label}</div>
						</div>
					);
				})}
			</div>
		</AbsoluteFill>
	);
};
