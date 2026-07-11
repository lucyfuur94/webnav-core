import React from 'react';
import {AbsoluteFill, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {colors, fontFamily} from './theme';
import {reportRepertoire} from './mapData';

const Group: React.FC<{title: string; items: string[]; delay: number}> = ({
	title,
	items,
	delay,
}) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	const p = spring({frame: frame - delay, fps, config: {damping: 200, stiffness: 110, mass: 0.8}});

	return (
		<div
			style={{
				opacity: p,
				transform: `translateY(${(1 - p) * 24}px)`,
				background: colors.card,
				border: `1px solid ${colors.border}`,
				borderRadius: 16,
				padding: '28px 32px',
				flex: 1,
			}}
		>
			<div
				style={{
					fontSize: 22,
					color: colors.accent,
					fontWeight: 700,
					letterSpacing: 1.5,
					textTransform: 'uppercase',
					marginBottom: 18,
				}}
			>
				{title}
			</div>
			<div style={{display: 'flex', flexDirection: 'column', gap: 12}}>
				{items.map((item) => (
					<div key={item} style={{fontSize: 26, color: colors.text, fontWeight: 500}}>
						{item}
					</div>
				))}
			</div>
		</div>
	);
};

export const ReportBuilderChapter: React.FC = () => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	const heading = spring({frame, fps, config: {damping: 200, stiffness: 110, mass: 0.8}});
	const rep = reportRepertoire();

	return (
		<AbsoluteFill
			style={{
				background: colors.bg,
				fontFamily,
				padding: '80px 100px',
				display: 'flex',
				flexDirection: 'column',
			}}
		>
			<div
				style={{
					opacity: heading,
					transform: `translateY(${(1 - heading) * 20}px)`,
					marginBottom: 50,
				}}
			>
				<div style={{fontSize: 48, fontWeight: 700, color: colors.text}}>Report builder</div>
				<div style={{fontSize: 26, color: colors.textDim, marginTop: 10}}>
					Build a view, then get it out &mdash; as a table or as charts
				</div>
			</div>
			<div style={{display: 'flex', gap: 30, flex: 1}}>
				<Group title="Build" items={rep.build} delay={14} />
				<Group title="Output" items={rep.output} delay={22} />
				<Group title="Views" items={rep.views} delay={30} />
			</div>
		</AbsoluteFill>
	);
};
