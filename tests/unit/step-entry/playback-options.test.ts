import { describe, it, expect } from 'vitest';
import { buildEntryPlaybackOptions } from '$lib/step-entry/playback-options';

describe('buildEntryPlaybackOptions', () => {
	it('uses the user swing setting so swung licks preview swung, not straight', () => {
		// The bug: the entry/edit-lick page hardcoded swing to 0.5 (straight),
		// so a lick previewed there played straight even when the user had
		// swing turned on everywhere else.
		const options = buildEntryPlaybackOptions({ tempo: 120, swing: 0.67, metronomeVolume: 0.7 });
		expect(options.swing).toBe(0.67);
	});

	it('passes straight swing through unchanged', () => {
		expect(buildEntryPlaybackOptions({ tempo: 90, swing: 0.5, metronomeVolume: 0.7 }).swing).toBe(
			0.5
		);
	});

	it('carries the tempo through', () => {
		expect(buildEntryPlaybackOptions({ tempo: 144, swing: 0.6, metronomeVolume: 0.7 }).tempo).toBe(
			144
		);
	});

	it('previews without a count-in or metronome', () => {
		const options = buildEntryPlaybackOptions({ tempo: 120, swing: 0.6, metronomeVolume: 0.7 });
		expect(options.countInBeats).toBe(0);
		expect(options.metronomeEnabled).toBe(false);
	});

	it('carries the metronome volume from settings (used if a click is ever added)', () => {
		expect(
			buildEntryPlaybackOptions({ tempo: 120, swing: 0.6, metronomeVolume: 0.7 }).metronomeVolume
		).toBe(0.7);
	});
});
