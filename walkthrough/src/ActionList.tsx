import React from 'react';
import {spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {colors, fontFamily} from './theme';

// Animated list of key action labels, staggered spring-in, no bounce.
export const ActionList: React.FC<{items: string[]; startFrame?: number}> = ({
	items,
	startFrame = 0,
}) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();

	return (
		<div style={{display: 'flex', flexDirection: 'column', gap: 14}}>
			{items.map((item, i) => {
				const delay = startFrame + i * 6;
				const localFrame = frame - delay;
				const progress = spring({
					frame: localFrame,
					fps,
					config: {damping: 200, stiffness: 120, mass: 0.7},
				});
				const opacity = progress;
				const translateX = (1 - progress) * -24;
				const isReveal = item.startsWith('▸');
				const isRow = item.startsWith('×row');
				const label = item.replace(/^▸\s*/, '').replace(/^×row\s*/, '');

				return (
					<div
						key={item}
						style={{
							display: 'flex',
							alignItems: 'center',
							gap: 14,
							opacity,
							transform: `translateX(${translateX}px)`,
							fontFamily,
						}}
					>
						<span
							style={{
								width: 10,
								height: 10,
								borderRadius: 999,
								background: isReveal || isRow ? 'transparent' : colors.accent,
								border: isReveal || isRow ? `2px solid ${colors.accent}` : 'none',
								flexShrink: 0,
							}}
						/>
						<span style={{fontSize: 32, color: colors.text, fontWeight: 500}}>
							{label}
							{isReveal ? (
								<span style={{color: colors.accent, marginLeft: 10, fontSize: 24}}>▸ opens menu</span>
							) : null}
							{isRow ? (
								<span style={{color: colors.textDim, marginLeft: 10, fontSize: 24}}>per row</span>
							) : null}
						</span>
					</div>
				);
			})}
		</div>
	);
};
