// §3 Framing — the product is the hero, never cropped.
// A single DeviceFrame that fit-INSIDE-contains a still or a live clip inside a device
// chrome, with a render-time assertion that the framed rect is strictly inside the safe
// area (uniform margin >= MIN_MARGIN on all sides). No edge of the app window may touch
// or exit the canvas. This assertion THROWS at render if any frame rect exits the safe
// area — so a regression fails the build, not the reviewer's eye.
import React from 'react';
import {AbsoluteFill, Img, OffthreadVideo, staticFile} from 'remotion';
import {colors} from './theme';

export const CANVAS_W = 1920;
export const CANVAS_H = 1080;
export const MIN_MARGIN = 48; // brief: uniform margin >= 48px on all sides

// A framed rect: where the device chrome will actually be drawn on the canvas.
export type Rect = {x: number; y: number; w: number; h: number};

// THE assertion. Called at render time by every framed surface. Throws if the rect is
// not strictly inside the safe area (canvas inset by MIN_MARGIN). This is §3's
// "add a render-time assertion" — containment guaranteed in code, not by inspection.
export function assertContained(rect: Rect, label: string): void {
	const left = rect.x;
	const top = rect.y;
	const right = rect.x + rect.w;
	const bottom = rect.y + rect.h;
	const safeR = CANVAS_W - MIN_MARGIN;
	const safeB = CANVAS_H - MIN_MARGIN;
	const bad =
		left < MIN_MARGIN || top < MIN_MARGIN || right > safeR || bottom > safeB || rect.w <= 0 || rect.h <= 0;
	if (bad) {
		throw new Error(
			`FRAMING VIOLATION (${label}): rect ${JSON.stringify(rect)} exits the safe area ` +
				`[${MIN_MARGIN},${MIN_MARGIN} .. ${safeR},${safeB}] on a ${CANVAS_W}x${CANVAS_H} canvas. ` +
				`Every screenshot/clip must be fit-inside contained with margin >= ${MIN_MARGIN}px.`
		);
	}
}

// Compute the largest 16:9 rect that fits inside a given box while respecting an
// aspect ratio and an upscale ceiling for the SOURCE media (so an 800px clip is never
// blown past 1.5x). Returns the on-canvas rect, centered in the box.
export function containRect(
	box: Rect,
	srcW: number,
	srcH: number,
	maxSrcScale: number
): Rect {
	const boxAspect = box.w / box.h;
	const srcAspect = srcW / srcH;
	let w: number;
	let h: number;
	if (srcAspect > boxAspect) {
		w = box.w;
		h = w / srcAspect;
	} else {
		h = box.h;
		w = h * srcAspect;
	}
	// Upscale ceiling on the media itself (frame border is added outside this rect).
	const maxW = srcW * maxSrcScale;
	if (w > maxW) {
		w = maxW;
		h = w / srcAspect;
	}
	const x = box.x + (box.w - w) / 2;
	const y = box.y + (box.h - h) / 2;
	return {x, y, w, h};
}

export const FRAME_BORDER = 10; // device chrome thickness (added OUTSIDE the media rect)

// DeviceFrame — renders a still (Img) or a clip (OffthreadVideo) fit-inside a device
// chrome positioned at `mediaRect`. The chrome (border + shadow + rounded corners) is
// drawn just outside the media, and the WHOLE chrome rect is asserted contained.
export const DeviceFrame: React.FC<{
	// media source
	kind: 'still' | 'clip';
	file: string;
	// where the MEDIA (inside the chrome) sits on the canvas
	mediaRect: Rect;
	label: string;
	// clip trim (frames), only for kind='clip'
	startFrom?: number;
	endAt?: number;
	// optional subtle scale for still Ken Burns (applied to media only, stays contained)
	scale?: number;
	translate?: {x: number; y: number};
}> = ({kind, file, mediaRect, label, startFrom, endAt, scale = 1, translate}) => {
	// The chrome rect is the media rect grown by the border on all sides.
	const chrome: Rect = {
		x: mediaRect.x - FRAME_BORDER,
		y: mediaRect.y - FRAME_BORDER,
		w: mediaRect.w + FRAME_BORDER * 2,
		h: mediaRect.h + FRAME_BORDER * 2,
	};
	assertContained(chrome, label);

	const tx = translate?.x ?? 0;
	const ty = translate?.y ?? 0;

	return (
		<AbsoluteFill>
			<div
				style={{
					position: 'absolute',
					left: chrome.x,
					top: chrome.y,
					width: chrome.w,
					height: chrome.h,
					borderRadius: 18,
					background: '#0a0c10',
					border: `1px solid ${colors.border}`,
					boxShadow: '0 40px 120px rgba(0,0,0,0.55), 0 8px 24px rgba(0,0,0,0.4)',
					overflow: 'hidden',
					padding: FRAME_BORDER,
					boxSizing: 'border-box',
				}}
			>
				<div
					style={{
						width: '100%',
						height: '100%',
						borderRadius: 10,
						overflow: 'hidden',
						background: '#fff',
					}}
				>
					{kind === 'still' ? (
						<Img
							src={staticFile(file)}
							style={{
								width: '100%',
								height: '100%',
								objectFit: 'contain', // §3: fit-inside, NEVER cover/crop
								transform: `scale(${scale}) translate(${tx}px, ${ty}px)`,
							}}
						/>
					) : (
						<OffthreadVideo
							src={staticFile(file)}
							startFrom={startFrom}
							endAt={endAt}
							muted
							style={{
								width: '100%',
								height: '100%',
								objectFit: 'contain', // §3: fit-inside, NEVER cover/crop
							}}
						/>
					)}
				</div>
			</div>
		</AbsoluteFill>
	);
};
