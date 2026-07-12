// §2 Hierarchy — a capability card with THREE visibly distinct tiers.
// Tier 1: large (44px), accent. Tier 2: medium (26px), grouped under tiny uppercase group
// labels. Tier 3: one quiet summary line (18px, dim). The three text sizes are the visible
// proof that not all actions are equal. Data comes from tiersFor() in mapData.ts.
import React from 'react';
import {spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {colors, fontFamily} from './theme';
import {Tiers} from './mapData';

const useEnter = (delay: number) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	return spring({frame: frame - delay, fps, config: {damping: 200, stiffness: 120, mass: 0.7}});
};

export const CapabilityCard: React.FC<{
	title: string;
	purpose: string;
	tiers: Tiers;
	startFrame?: number;
}> = ({title, purpose, tiers, startFrame = 0}) => {
	const head = useEnter(startFrame);

	return (
		<div
			style={{
				fontFamily,
				display: 'flex',
				flexDirection: 'column',
				gap: 22,
				width: '100%',
			}}
		>
			<div style={{opacity: head, transform: `translateY(${(1 - head) * 16}px)`}}>
				<div style={{fontSize: 52, fontWeight: 800, color: colors.text, letterSpacing: -0.6}}>
					{title}
				</div>
				<div style={{fontSize: 25, color: colors.textDim, marginTop: 10, lineHeight: 1.4, maxWidth: 640}}>
					{purpose}
				</div>
			</div>

			<div style={{height: 1, background: colors.border, opacity: head}} />

			{/* Tier 1 — purpose actions: large, accent */}
			<div style={{display: 'flex', flexDirection: 'column', gap: 12}}>
				{tiers.tier1.map((label, i) => {
					const p = useEnter(startFrame + 8 + i * 7);
					return (
						<div
							key={label}
							style={{
								opacity: p,
								transform: `translateX(${(1 - p) * -22}px)`,
								display: 'flex',
								alignItems: 'center',
								gap: 16,
							}}
						>
							<span
								style={{
									width: 12,
									height: 12,
									borderRadius: 999,
									background: colors.accent,
									flexShrink: 0,
									boxShadow: `0 0 16px ${colors.accent}`,
								}}
							/>
							<span style={{fontSize: 44, fontWeight: 700, color: colors.accent, letterSpacing: -0.4}}>
								{label}
							</span>
						</div>
					);
				})}
			</div>

			{/* Tier 2 — working actions: medium, grouped under tiny group labels */}
			{tiers.tier2Groups.length > 0 ? (
				<div style={{display: 'flex', gap: 40, flexWrap: 'wrap', marginTop: 4}}>
					{tiers.tier2Groups.map((g, gi) => {
						const p = useEnter(startFrame + 24 + gi * 6);
						return (
							<div
								key={g.label}
								style={{opacity: p, transform: `translateY(${(1 - p) * 14}px)`}}
							>
								<div
									style={{
										fontSize: 15,
										color: colors.textDim,
										fontWeight: 700,
										letterSpacing: 2,
										textTransform: 'uppercase',
										marginBottom: 10,
									}}
								>
									{g.label}
								</div>
								<div style={{display: 'flex', flexDirection: 'column', gap: 7}}>
									{g.items.map((item) => (
										<div key={item} style={{fontSize: 26, color: colors.text, fontWeight: 500}}>
											{item}
										</div>
									))}
								</div>
							</div>
						);
					})}
				</div>
			) : null}

			{/* Tier 3 — one quiet summary line */}
			{tiers.tier3 ? (
				<TierThree text={tiers.tier3} delay={startFrame + 40} />
			) : null}
		</div>
	);
};

const TierThree: React.FC<{text: string; delay: number}> = ({text, delay}) => {
	const p = useEnter(delay);
	return (
		<div
			style={{
				opacity: p * 0.85,
				fontSize: 18,
				color: colors.textDim,
				fontStyle: 'italic',
				marginTop: 6,
			}}
		>
			{text}
		</div>
	);
};
