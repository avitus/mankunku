import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Phrase } from '$lib/types/music';

const mocks = vi.hoisted(() => ({
	settings: { instrumentId: 'tenor-sax', masterVolume: 0.7, defaultTempo: 100, swing: 0.6 },
	setMasterVolume: vi.fn(),
	captureException: vi.fn(),
	importGate: undefined as Promise<void> | undefined,
	onImport: vi.fn(),
	loadInstrument: vi.fn(),
	isInstrumentLoaded: vi.fn(),
	playPhrase: vi.fn(),
	stopPlayback: vi.fn()
}));

vi.mock('$lib/state/settings.svelte', () => ({ settings: mocks.settings }));
vi.mock('$lib/audio/audio-context', () => ({ setMasterVolume: mocks.setMasterVolume }));
vi.mock('@sentry/sveltekit', () => ({ captureException: mocks.captureException }));

/** Hold an audio setup step until the test explicitly completes it. */
function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => { resolve = done; });
	return { promise, resolve };
}

const firstLick = { id: 'community-lick' } as Phrase;
const secondLick = { id: 'next-lick' } as Phrase;

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	mocks.loadInstrument.mockReset().mockResolvedValue(undefined);
	mocks.isInstrumentLoaded.mockReset().mockReturnValue(false);
	mocks.playPhrase.mockReset().mockResolvedValue(undefined);
	mocks.stopPlayback.mockReset().mockResolvedValue(undefined);
	mocks.importGate = undefined;
	vi.doMock('$lib/audio/playback', async () => {
		mocks.onImport();
		await mocks.importGate;
		return {
			loadInstrument: mocks.loadInstrument,
			isInstrumentLoaded: mocks.isInstrumentLoaded,
			playPhrase: mocks.playPhrase,
			stopPlayback: mocks.stopPlayback
		};
	});
});

describe('lick preview lifetime (MANKUNKU-1W)', () => {
	it('does not play after navigation cancels an unfinished instrument load', async () => {
		const loaded = deferred();
		const entered = deferred();
		mocks.loadInstrument.mockImplementation(() => { entered.resolve(); return loaded.promise; });
		const { createLickAudition } = await import('$lib/state/lick-audition.svelte');
		const audition = createLickAudition();
		const pending = audition.play(firstLick);
		await entered.promise;
		audition.dispose();
		loaded.resolve();
		await pending;
		expect(mocks.playPhrase).not.toHaveBeenCalled();
		expect(audition.state.playingId).toBeNull();
	});

	it('does not load or play when navigation wins the lazy import race', async () => {
		const imported = deferred();
		const entered = deferred();
		mocks.importGate = imported.promise;
		mocks.onImport.mockImplementationOnce(entered.resolve);
		const { createLickAudition } = await import('$lib/state/lick-audition.svelte');
		const audition = createLickAudition();
		const pending = audition.play(firstLick);
		await entered.promise;
		audition.dispose();
		imported.resolve();
		await pending;
		await audition.play(secondLick);
		expect(mocks.loadInstrument).not.toHaveBeenCalled();
		expect(mocks.playPhrase).not.toHaveBeenCalled();
	});

	it('a second click on the loading lick cancels instead of starting another load', async () => {
		const loaded = deferred();
		const entered = deferred();
		mocks.loadInstrument.mockImplementationOnce(() => { entered.resolve(); return loaded.promise; });
		const { createLickAudition } = await import('$lib/state/lick-audition.svelte');
		const audition = createLickAudition();
		const pending = audition.play(firstLick);
		await entered.promise;
		await audition.play(firstLick);
		loaded.resolve();
		await pending;
		expect(mocks.loadInstrument).toHaveBeenCalledOnce();
		expect(mocks.playPhrase).not.toHaveBeenCalled();
	});

	it('does not let the old download play or clear the newer lick selection', async () => {
		const loaded = deferred();
		const entered = deferred();
		const played = deferred();
		mocks.loadInstrument.mockImplementationOnce(() => { entered.resolve(); return loaded.promise; });
		mocks.playPhrase.mockReturnValue(played.promise);
		const { createLickAudition } = await import('$lib/state/lick-audition.svelte');
		const audition = createLickAudition();
		const first = audition.play(firstLick);
		await entered.promise;
		const second = audition.play(secondLick);
		await vi.waitFor(() => expect(mocks.playPhrase).toHaveBeenCalledOnce());
		loaded.resolve();
		// Flush the old handler before checking that the new preview still owns state.
		await Promise.resolve();
		await Promise.resolve();
		expect(mocks.playPhrase).toHaveBeenCalledOnce();
		expect(audition.state.playingId).toBe(secondLick.id);
		played.resolve();
		await Promise.all([first, second]);
		expect(audition.state.playingId).toBeNull();
	});

	it('reports a real load error, resets the button, and allows retry', async () => {
		const error = new Error('sample download failed');
		mocks.loadInstrument.mockRejectedValueOnce(error);
		const { createLickAudition } = await import('$lib/state/lick-audition.svelte');
		const audition = createLickAudition();
		await audition.play(firstLick);
		expect(audition.state.error).toContain('Try Play again');
		expect(audition.state.playingId).toBeNull();
		expect(mocks.captureException).toHaveBeenCalledWith(error);
		await audition.play(firstLick);
		expect(audition.state.error).toBe('');
		expect(mocks.playPhrase).toHaveBeenCalledWith(firstLick, {
			tempo: 100, swing: 0.6, countInBeats: 0, metronomeEnabled: false, metronomeVolume: 0
		});
	});

	it('does not restart a replacement after navigating away during stop', async () => {
		const played = deferred();
		const stopped = deferred();
		mocks.playPhrase.mockReturnValue(played.promise);
		mocks.stopPlayback.mockReturnValue(stopped.promise);
		const { createLickAudition } = await import('$lib/state/lick-audition.svelte');
		const audition = createLickAudition();
		const first = audition.play(firstLick);
		await vi.waitFor(() => expect(mocks.playPhrase).toHaveBeenCalledOnce());
		const second = audition.play(secondLick);
		audition.dispose();
		stopped.resolve();
		played.resolve();
		await Promise.all([first, second]);
		expect(mocks.playPhrase).toHaveBeenCalledOnce();
		expect(audition.state.playingId).toBeNull();
	});

	it('keeps the new Stop button when the previous playing phrase completes', async () => {
		const played = deferred();
		const nextPlayed = deferred();
		mocks.playPhrase.mockReturnValueOnce(played.promise).mockReturnValueOnce(nextPlayed.promise);
		const { createLickAudition } = await import('$lib/state/lick-audition.svelte');
		const audition = createLickAudition();
		const first = audition.play(firstLick);
		await vi.waitFor(() => expect(mocks.playPhrase).toHaveBeenCalledOnce());
		const second = audition.play(secondLick);
		await vi.waitFor(() => expect(mocks.playPhrase).toHaveBeenCalledTimes(2));
		played.resolve();
		await first;
		expect(audition.state.playingId).toBe(secondLick.id);
		nextPlayed.resolve();
		await second;
		expect(audition.state.playingId).toBeNull();
	});
});
