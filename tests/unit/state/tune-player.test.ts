import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tune } from '$lib/types/tune';
import { settings } from '$lib/state/settings.svelte';
import { TunePlayer } from '$lib/state/tune-player.svelte';

const audio = vi.hoisted(() => ({
	loadInstrument: vi.fn(), playPhrase: vi.fn(), stopPlayback: vi.fn(), getAudibleTransportSeconds: vi.fn(() => 0),
	PHRASE_LEAD_IN_BARS: 1
}));
vi.mock('$lib/audio/playback', () => audio);
const tune: Tune = {
	id: 'song', title: 'Song', key: 'C', timeSignature: [4, 4], tags: [], source: 'user',
	sections: [{ label: 'A', bars: 2, repeatStart: true, repeatEnd: true, notes: [{ pitch: 60, offset: [0, 1], duration: [1, 4] }], harmony: [] }]
};
let player: TunePlayer;
beforeEach(() => {
	vi.clearAllMocks();
	audio.loadInstrument.mockResolvedValue(undefined);
	audio.playPhrase.mockResolvedValue(undefined);
	settings.backingStyle = 'swing';
	settings.swing = 0.62;
	settings.tuneTempos = {};
	player = new TunePlayer();
});
afterEach(() => { player.dispose(); vi.restoreAllMocks(); });

describe('tune desk tempo', () => {
	it('opens a tune at the tempo last chosen for it', async () => {
		settings.tuneTempos = { song: 176 };
		const saves: Array<[string, number]> = [];
		let id = 'song';
		const desk = new TunePlayer({ tuneId: () => id, save: (tuneId, tempo) => {
			saves.push([tuneId, tempo]);
			settings.tuneTempos = { ...settings.tuneTempos, [tuneId]: tempo };
		} });
		expect(desk.tempo).toBe(176);
		desk.setTempo(181);
		expect(saves).toEqual([['song', 181]]);
		// Reopening the tune (a fresh player) reads the saved choice back.
		expect(new TunePlayer({ tuneId: () => 'song', save: () => {} }).tempo).toBe(181);
		// Another tune does not inherit it.
		id = 'other';
		expect(desk.tempo).toBe(settings.defaultTempo);
		await desk.toggle(tune, 'swing');
		expect(audio.playPhrase.mock.calls[0][1]).toMatchObject({ tempo: settings.defaultTempo });
		desk.dispose();
		settings.tuneTempos = {};
	});
	it('keeps an unsaved preview tempo for the editor preview', () => {
		player.setTempo(150);
		expect(player.tempo).toBe(150);
		expect(settings.tuneTempos).toEqual({});
	});
});

describe('tune desk playback', () => {
	// 2026-10-22: Loop re-ran the phrase per pass, so every return to the top
	// stopped the transport, sat through a fresh lead-in bar and a trailing
	// beat, and replayed the pickup bar. The engine now loops the form on one
	// transport; the player hands it the region once and answers each pass.
	it('hands the engine one looping form that skips the pickup on the way round', async () => {
		const pickupTune: Tune = {
			...tune,
			sections: [
				{ label: '', bars: 1, pickupLength: [1, 4], notes: [{ pitch: 64, offset: [3, 4], duration: [1, 4] }], harmony: [] },
				{ label: 'A', bars: 2, notes: [{ pitch: 60, offset: [0, 1], duration: [1, 1] }], harmony: [] }
			]
		};
		let finish!: () => void;
		audio.playPhrase.mockImplementation(() => new Promise<void>(resolve => finish = resolve));
		player.loop = true;
		const started = player.toggle(pickupTune, 'swing');
		await vi.waitFor(() => expect(audio.playPhrase).toHaveBeenCalled());
		const { loop } = audio.playPhrase.mock.calls[0][3];
		expect(loop).toMatchObject({ startBar: 1, endBar: 3 });
		expect(loop.shouldContinue()).toBe(true);
		player.loop = false; // turning Loop off mid-pass ends at this pass's last bar
		expect(loop.shouldContinue()).toBe(false);
		player.loop = true;
		player.stop();
		expect(loop.shouldContinue()).toBe(false);
		finish();
		await started;
		expect(audio.playPhrase).toHaveBeenCalledTimes(1);
		expect(player.busy).toBe(false);
	});
	it('plays once and ends when Loop is off', async () => {
		await player.toggle(tune, 'swing');
		expect(audio.playPhrase).toHaveBeenCalledTimes(1);
		expect(audio.playPhrase.mock.calls[0][3].loop.shouldContinue()).toBe(false);
		expect(player.busy).toBe(false);
	});
	it('marks the top of the form, not the pickup, after looping round', async () => {
		const pickupTune: Tune = {
			...tune,
			sections: [
				{ label: '', bars: 1, pickupLength: [1, 4], notes: [{ pitch: 64, offset: [3, 4], duration: [1, 4] }], harmony: [] },
				{ label: 'A', bars: 2, notes: [{ pitch: 60, offset: [0, 1], duration: [1, 1] }], harmony: [] }
			]
		};
		let finish!: () => void;
		audio.playPhrase.mockImplementation(() => new Promise<void>(resolve => finish = resolve));
		player.setTempo(120); // one 4/4 bar = 2 s; the form starts after a 2 s lead-in
		player.loop = true;
		const started = player.toggle(pickupTune, 'swing');
		await vi.waitFor(() => expect(audio.playPhrase).toHaveBeenCalled());
		const callbacks = audio.playPhrase.mock.calls[0][3];
		/** The chart bar the marker shows when the audible transport reads `seconds`. */
		const at = (seconds: number): number | null => {
			audio.getAudibleTransportSeconds.mockReturnValue(seconds);
			callbacks.onStarted();
			return player.chartBar;
		};
		expect(at(7.8)).toBeCloseTo(2.9); // the form's last bar
		expect(at(8.2)).toBeCloseTo(1.1); // straight back to its first, never the pickup
		expect(at(12.2)).toBeCloseTo(1.1); // and again
		finish();
		await started;
	});
	it.each([['bossa-nova', 0.5], ['ballad', 0.55], ['straight', 0.5], ['swing', 0.62]] as const)(
		'passes saved %s to the production engine with matching melody feel', async (style, swing) => {
			player.backing = true;
			await player.toggle(tune, style);
			expect(audio.playPhrase).toHaveBeenCalledWith(
				expect.objectContaining({ notes: expect.any(Array) }),
				expect.objectContaining({ backingStyle: style, swing, backingTrackEnabled: true }),
				false, expect.objectContaining({ skipMelody: false })
			);
			expect(audio.playPhrase.mock.calls[0][0].notes).toHaveLength(2); // expanded repeat
			expect(settings.backingStyle).toBe('swing');
		}
	);
	it('keeps the saved feel with backing off and supports a backing-only pass', async () => {
		player.melody = false;
		await player.toggle(tune, 'bossa-nova');
		expect(audio.playPhrase.mock.calls[0][1]).toMatchObject({ backingStyle: 'bossa-nova', backingTrackEnabled: false, swing: 0.5 });
		expect(audio.playPhrase.mock.calls[0][3].skipMelody).toBe(true);
	});
	it('cancels a pending load without starting audio after navigation', async () => {
		let loaded!: () => void;
		audio.loadInstrument.mockImplementation(() => new Promise<void>(resolve => loaded = resolve));
		const started = player.toggle(tune, 'straight');
		await vi.waitFor(() => expect(audio.loadInstrument).toHaveBeenCalled());
		player.dispose();
		loaded();
		await started;
		expect(audio.playPhrase).not.toHaveBeenCalled();
		expect(player.busy).toBe(false);
	});
	// 2026-10-21, Black Orpheus: the gold bar ran one bar ahead of the melody.
	// playPhrase starts the form one bar into the transport, and the marker
	// read the raw transport bar. Not the pickup: it maps to chart bar 0.
	it('marks the bar the melody is in, not the transport bar', async () => {
		const pickupTune: Tune = {
			...tune,
			sections: [
				{ label: '', bars: 1, pickupLength: [1, 4], notes: [{ pitch: 64, offset: [3, 4], duration: [1, 4] }], harmony: [] },
				{ label: 'A', bars: 2, notes: [{ pitch: 60, offset: [0, 1], duration: [1, 1] }], harmony: [] }
			]
		};
		let finish!: () => void;
		audio.playPhrase.mockImplementation(() => new Promise<void>(resolve => finish = resolve));
		player.setTempo(120); // one 4/4 bar = 2 s
		const started = player.toggle(pickupTune, 'swing');
		await vi.waitFor(() => expect(audio.playPhrase).toHaveBeenCalled());
		const callbacks = audio.playPhrase.mock.calls[0][3];
		/** The chart bar the marker shows when the audible transport reads `seconds`. */
		const at = (seconds: number): number | null => {
			audio.getAudibleTransportSeconds.mockReturnValue(seconds);
			callbacks.onStarted();
			return player.chartBar;
		};
		expect(at(1)).toBeNull(); // the engine's silent lead-in bar
		expect(at(3.6)).toBeCloseTo(0.8); // the pickup note, beat 4 of the pickup bar
		expect(at(4.2)).toBeCloseTo(1.1); // the first full bar's downbeat
		expect(at(6.2)).toBeCloseTo(2.1); // A's second bar
		finish();
		await started;
	});
	// playPhrase's lead-in is timeSignature[0] QUARTER notes: in 6/8 that is
	// two printed bars, not one (CodeRabbit on #284).
	it('waits out the whole lead-in in compound meter', async () => {
		const sixEight: Tune = {
			...tune, timeSignature: [6, 8],
			sections: [{ label: 'A', bars: 2, notes: [{ pitch: 60, offset: [0, 1], duration: [3, 8] }], harmony: [] }]
		};
		let finish!: () => void;
		audio.playPhrase.mockImplementation(() => new Promise<void>(resolve => finish = resolve));
		player.setTempo(120); // lead-in = 6 quarters = 3 s; a 6/8 bar = 1.5 s
		const started = player.toggle(sixEight, 'swing');
		await vi.waitFor(() => expect(audio.playPhrase).toHaveBeenCalled());
		const callbacks = audio.playPhrase.mock.calls[0][3];
		/** The chart bar the marker shows when the audible transport reads `seconds`. */
		const at = (seconds: number): number | null => {
			audio.getAudibleTransportSeconds.mockReturnValue(seconds);
			callbacks.onStarted();
			return player.chartBar;
		};
		expect(at(2.5)).toBeNull();
		expect(at(3.3)).toBeCloseTo(0.2);
		expect(at(4.6)).toBeCloseTo(1.0667, 3);
		finish();
		await started;
	});
	it('maps repeated notes to the printed chart and ignores callbacks after stop', async () => {
		let finish!: () => void;
		audio.playPhrase.mockImplementation(() => new Promise<void>(resolve => finish = resolve));
		const started = player.toggle(tune, 'swing');
		await vi.waitFor(() => expect(audio.playPhrase).toHaveBeenCalled());
		const callbacks = audio.playPhrase.mock.calls[0][3];
		callbacks.onNote({ sourceIndex: 1 });
		expect(player.cursorIndex).toBe(0);
		player.stop();
		callbacks.onNote({ sourceIndex: 1 });
		expect(player.cursorIndex).toBeNull();
		finish();
		await started;
	});
});
