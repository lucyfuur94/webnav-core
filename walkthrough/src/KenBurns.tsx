import React from 'react';
import {AbsoluteFill, Img, interpolate, useCurrentFrame} from 'remotion';
import {colors} from './theme';

// Slow zoom/pan over the chapter's duration — classic Ken Burns.
export const KenBurns: React.FC<{src: string; durationInFrames: number}> = ({
	src,
	durationInFrames,
}) => {
	const frame = useCurrentFrame();
	const scale = interpolate(frame, [0, durationInFrames], [1.06, 1.16], {
		extrapolateRight: 'clamp',
	});
	const translateX = interpolate(frame, [0, durationInFrames], [0, -18], {
		extrapolateRight: 'clamp',
	});
	const translateY = interpolate(frame, [0, durationInFrames], [0, 12], {
		extrapolateRight: 'clamp',
	});

	return (
		<AbsoluteFill
			style={{
				overflow: 'hidden',
				borderRadius: 20,
				boxShadow: '0 40px 120px rgba(0,0,0,0.55)',
				border: `1px solid ${colors.border}`,
			}}
		>
			<Img
				src={src}
				style={{
					width: '100%',
					height: '100%',
					objectFit: 'cover',
					transform: `scale(${scale}) translate(${translateX}px, ${translateY}px)`,
				}}
			/>
		</AbsoluteFill>
	);
};
