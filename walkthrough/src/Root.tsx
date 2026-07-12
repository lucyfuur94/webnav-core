import React from 'react';
import {Composition} from 'remotion';
import {ProgneoWalkthrough, TOTAL_DURATION} from './ProgneoWalkthrough';
import {FPS} from './timing';

export const Root: React.FC = () => {
	return (
		<Composition
			id="ProgneoWalkthrough"
			component={ProgneoWalkthrough}
			durationInFrames={TOTAL_DURATION}
			fps={FPS}
			width={1920}
			height={1080}
		/>
	);
};
