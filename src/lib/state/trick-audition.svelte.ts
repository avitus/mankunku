import type { Phrase } from '$lib/types/music';
import { settings } from '$lib/state/settings.svelte';
import { setMasterVolume } from '$lib/audio/audio-context';

/** A page-owned audition; cancelling also fences off pending audio downloads. */
export function createTrickAudition() {
	const state = $state({ playing: false, error: '' });
	let player: typeof import('$lib/audio/playback') | undefined;
	let generation = 0;
	let disposed = false;
	let loadedInstrument: string | undefined;

	/** Stop only this page's active preview, including asynchronous setup. */
	async function stop(): Promise<void> {
		generation++;
		const active = state.playing;
		state.playing = false;
		if (active && player) await player.stopPlayback();
	}

	/** Play the selected arrival gesture with the same instrument and pulse as practice. */
	async function play(phrase: Phrase, tempo: number): Promise<void> {
		if (disposed) return;
		if (state.playing) {
			await stop();
			return;
		}
		const request = ++generation;
		state.playing = true;
		state.error = '';
		try {
			player ??= await import('$lib/audio/playback');
			if (disposed || request !== generation) return;
			const instrument = settings.instrumentId;
			if (!player.isInstrumentLoaded() || loadedInstrument !== instrument) {
				await player.loadInstrument(instrument, settings.masterVolume);
				if (disposed || request !== generation) return;
				loadedInstrument = instrument;
			}
			setMasterVolume(settings.masterVolume);
			await player.playPhrase(phrase, {
				tempo,
				swing: settings.swing,
				countInBeats: 0,
				metronomeEnabled: true,
				metronomeVolume: settings.metronomeVolume
			});
		} catch {
			if (!disposed && request === generation) {
				state.error = 'The preview could not play. Try Hear again.';
				await player?.stopPlayback();
			}
		} finally {
			if (request === generation) state.playing = false;
		}
	}

	/** Release the page's audio before navigation can start another session. */
	function dispose(): void {
		disposed = true;
		void stop();
	}

	return { state, play, stop, dispose };
}
