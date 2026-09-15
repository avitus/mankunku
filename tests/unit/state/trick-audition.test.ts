import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Phrase } from '$lib/types/music';

const mocks = vi.hoisted(() => ({
	settings: { instrumentId: 'tenor-sax', masterVolume: 0.7, swing: 0.6, metronomeVolume: 0.35 },
	setMasterVolume: vi.fn(),
	importGate: undefined as Promise<void> | undefined,
	onImport: vi.fn(),
	loadInstrument: vi.fn(),
	isInstrumentLoaded: vi.fn(),
	playPhrase: vi.fn(),
	stopPlayback: vi.fn()
}));

vi.mock('$lib/state/settings.svelte', () => ({ settings: mocks.settings }));
vi.mock('$lib/audio/audio-context', () => ({ setMasterVolume: mocks.setMasterVolume }));

/** Pause one async stage so cancellation is exercised before it completes. */
function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => { resolve = done; });
	return { promise, resolve };
}

const phrase = { id: 'selected-arrival' } as Phrase;

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

describe('page-owned trick audition', () => {
	it('cancels before the lazy playback import completes', async () => {
		const imported = deferred();
		const entered = deferred();
		mocks.importGate = imported.promise;
		mocks.onImport.mockImplementationOnce(entered.resolve);
		const { createTrickAudition } = await import('$lib/state/trick-audition.svelte');
		const audition = createTrickAudition();
		const pending = audition.play(phrase, 90);
		await entered.promise;
		await audition.stop();
		imported.resolve();
		await pending;
		expect(audition.state.playing).toBe(false);
		expect(mocks.loadInstrument).not.toHaveBeenCalled();
		expect(mocks.playPhrase).not.toHaveBeenCalled();
	});

	it('cancels an instrument download without playing the old arrival afterward', async () => {
		const loaded = deferred();
		const entered = deferred();
		mocks.loadInstrument.mockImplementation(() => { entered.resolve(); return loaded.promise; });
		const { createTrickAudition } = await import('$lib/state/trick-audition.svelte');
		const audition = createTrickAudition();
		const pending = audition.play(phrase, 90);
		await entered.promise;
		await audition.stop();
		loaded.resolve();
		await pending;
		expect(mocks.stopPlayback).toHaveBeenCalledOnce();
		expect(mocks.playPhrase).not.toHaveBeenCalled();
		expect(audition.state).toEqual({ playing: false, error: '' });
	});

	it('fences delayed setup and future play calls after the page unmounts', async () => {
		const loaded = deferred();
		const entered = deferred();
		mocks.loadInstrument.mockImplementation(() => { entered.resolve(); return loaded.promise; });
		const { createTrickAudition } = await import('$lib/state/trick-audition.svelte');
		const audition = createTrickAudition();
		const pending = audition.play(phrase, 90);
		await entered.promise;
		audition.dispose();
		loaded.resolve();
		await pending;
		await audition.play(phrase, 120);
		expect(mocks.loadInstrument).toHaveBeenCalledOnce();
		expect(mocks.playPhrase).not.toHaveBeenCalled();
		expect(audition.state.playing).toBe(false);
	});

	it('keeps a newer audition active when an older cancelled download finishes', async () => {
		const firstLoaded = deferred();
		const secondLoaded = deferred();
		const firstEntered = deferred();
		const secondEntered = deferred();
		const played = deferred();
		mocks.loadInstrument
			.mockImplementationOnce(() => { firstEntered.resolve(); return firstLoaded.promise; })
			.mockImplementationOnce(() => { secondEntered.resolve(); return secondLoaded.promise; });
		mocks.playPhrase.mockReturnValue(played.promise);
		const { createTrickAudition } = await import('$lib/state/trick-audition.svelte');
		const audition = createTrickAudition();
		const first = audition.play(phrase, 90);
		await firstEntered.promise;
		await audition.stop();
		const second = audition.play(phrase, 120);
		await secondEntered.promise;
		firstLoaded.resolve();
		await first;
		expect(audition.state.playing).toBe(true);
		secondLoaded.resolve();
		await vi.waitFor(() => expect(mocks.playPhrase).toHaveBeenCalledOnce());
		expect(mocks.playPhrase.mock.calls[0][1].tempo).toBe(120);
		played.resolve();
		await second;
		expect(audition.state.playing).toBe(false);
	});

	it('surfaces a load failure, then clears it when Hear is retried', async () => {
		mocks.loadInstrument.mockRejectedValueOnce(new Error('instrument unavailable'));
		const { createTrickAudition } = await import('$lib/state/trick-audition.svelte');
		const audition = createTrickAudition();
		await audition.play(phrase, 90);
		expect(audition.state.error).toContain('Try Hear again');
		expect(audition.state.playing).toBe(false);
		expect(mocks.playPhrase).not.toHaveBeenCalled();
		await audition.play(phrase, 90);
		expect(audition.state.error).toBe('');
		expect(mocks.loadInstrument).toHaveBeenCalledTimes(2);
		expect(mocks.playPhrase).toHaveBeenCalledWith(phrase, {
			tempo: 90, swing: 0.6, countInBeats: 0, metronomeEnabled: true, metronomeVolume: 0.35
		});
		expect(mocks.setMasterVolume).toHaveBeenCalledWith(0.7);
	});
});
