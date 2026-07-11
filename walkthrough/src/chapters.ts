import {keyActions} from './mapData';

// Chapter plan, in shell-nav order. Blurbs derive from state name + affordance labels only
// (COPY RULE): e.g. report-list's blurb names Search/sort tabs/row actions, all present in
// its keyActions below.
export const FPS = 30;

export type ScreenshotChapterDef = {
	file: string;
	title: string;
	blurb: string;
	actions: string[];
	durationInFrames: number;
};

const sec = (n: number) => n * FPS;

export const screenshotChapters: ScreenshotChapterDef[] = [
	{
		file: '1-report-list.png',
		title: 'Reports',
		blurb: 'Search, sort, and manage reports',
		actions: keyActions('report-list'),
		durationInFrames: sec(11),
	},
	{
		file: '2-dashboard-list.png',
		title: 'Dashboards',
		blurb: 'Browse dashboards and open one, or start a new one',
		actions: keyActions('dashboard-list'),
		durationInFrames: sec(11),
	},
	{
		file: '3-download-list.png',
		title: 'Downloads',
		blurb: 'Track and share exported data',
		actions: keyActions('download-list'),
		durationInFrames: sec(11),
	},
	{
		file: '4-help-center.png',
		title: 'Help Center',
		blurb: 'Guides for every part of the interface',
		actions: keyActions('help-center'),
		durationInFrames: sec(11),
	},
	{
		file: '5-announcements.png',
		title: 'Announcements',
		blurb: 'Product updates and feature releases',
		actions: keyActions('announcements'),
		durationInFrames: sec(11),
	},
];
