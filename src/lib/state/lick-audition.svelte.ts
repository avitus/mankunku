import { captureException } from '@sentry/sveltekit';
import type { Phrase } from '$lib/types/music';
import { settings } from '$lib/state/settings.svelte';
import { setMasterVolume } from '$lib/audio/audio-context';

/** Page-owned lick previews: loading and playback share one cancellable request. */
export function createLickAudition() {
	const state = $state({ playingId: null as string | null, error: '' });
	let player: typeof import('$lib/audio/playback') | undefined;
	let generation = 0;
	let disposed = false;

	/** Toggle this lick, or replace the previous preview, including pending setup. */
	async function play(phrase: Phrase): Promise<void> {
		if (disposed) return;
		const previous = state.playingId;
		const request = ++generation;
		const cancelled = () => disposed || request !== generation;
		// Claim the button before the first await so Stop also cancels downloads.
		state.playingId = previous === phrase.id ? null : phrase.id;
		state.error = '';
		try {
			if (previous && player) await player.stopPlayback();
			if (cancelled() || previous === phrase.id) return;
			player ??= await import('$lib/audio/playback');
			if (cancelled()) return;
			if (!player.isInstrumentLoaded()) {
				await player.loadInstrument(settings.instrumentId, settings.masterVolume);
				if (cancelled()) return;
			}
			setMasterVolume(settings.masterVolume);
			await player.playPhrase(phrase, {
				tempo: settings.defaultTempo,
				swing: settings.swing,
				countInBeats: 0,
				metronomeEnabled: false,
				metronomeVolume: 0
			});
		} catch (error) {
			if (!cancelled()) {
				captureException(error);
				state.error = 'The preview could not play. Try Play again.';
				await player?.stopPlayback().catch(captureException);
			}
		} finally {
			// An old completion must not reset the newer lick's Stop button.
			if (request === generation) state.playingId = null;
		}
	}

	/** Invalidate unfinished work before the next route can take over the player. */
	function dispose(): void {
		disposed = true;
		generation++;
		const active = state.playingId !== null;
		state.playingId = null;
		if (active && player) void player.stopPlayback().catch(captureException);
	}

	return { state, play, dispose };
}
