import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tune } from '$lib/types/tune';
import { settings } from '$lib/state/settings.svelte';
import { TunePlayer } from '$lib/state/tune-player.svelte';

const audio = vi.hoisted(() => ({
	loadInstrument: vi.fn(), playPhrase: vi.fn(), stopPlayback: vi.fn(), getAudibleTransportSeconds: vi.fn(() => 0)
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
	player = new TunePlayer();
});
afterEach(() => player.dispose());

describe('tune desk playback', () => {
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
