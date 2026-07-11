import React from 'react';
import {AbsoluteFill, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {KenBurns} from './KenBurns';
import {ActionList} from './ActionList';
import {colors, fontFamily} from './theme';

export const ScreenshotChapter: React.FC<{
	src: string;
	title: string;
	blurb: string;
	actions: string[];
	durationInFrames: number;
}> = ({src, title, blurb, actions, durationInFrames}) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	const enter = spring({frame, fps, config: {damping: 200, stiffness: 110, mass: 0.8}});

	return (
		<AbsoluteFill style={{background: colors.bg, padding: '70px 90px', fontFamily}}>
			<div style={{display: 'flex', height: '100%', gap: 70, alignItems: 'center'}}>
				<div style={{flex: '0 0 58%', height: '100%', display: 'flex', alignItems: 'center'}}>
					<div
						style={{
							width: '100%',
							aspectRatio: '16 / 9',
							opacity: enter,
							transform: `scale(${0.96 + enter * 0.04})`,
						}}
					>
						<KenBurns src={src} durationInFrames={durationInFrames} />
					</div>
				</div>
				<div style={{flex: 1, display: 'flex', flexDirection: 'column', gap: 26}}>
					<div
						style={{
							opacity: enter,
							transform: `translateY(${(1 - enter) * 20}px)`,
						}}
					>
						<div style={{fontSize: 46, fontWeight: 700, color: colors.text, letterSpacing: -0.5}}>
							{title}
						</div>
						<div style={{fontSize: 26, color: colors.textDim, marginTop: 10, lineHeight: 1.4}}>
							{blurb}
						</div>
					</div>
					<div
						style={{
							height: 1,
							background: colors.border,
							opacity: enter,
						}}
					/>
					<ActionList items={actions} startFrame={8} />
				</div>
			</div>
		</AbsoluteFill>
	);
};
