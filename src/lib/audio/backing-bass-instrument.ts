import type { SampleLoader, Smolken, SmolkenOptions, SmplrOptions } from 'smplr';
import { normalizeBackingBassPresetWithStatus } from './backing-bass-samples';

/** Equal-dB best-fit measured compensation after correcting layered selection. */
export const BACKING_BASS_SELECTION_GAIN = 7.74;

/**
 * Load a bass with the public sampler API and compensate only the source bank
 * whose selection was verified. The loader wrapper is per instrument, so a
 * shared piano loader cannot inherit this decision. Source dynamics and the
 * common 0.05 bass trim remain unchanged. The instrument's output owns its
 * insert, including disconnection when an outer caller cancels a stale load.
 */
export async function loadBackingBass(context: BaseAudioContext, Bass: typeof Smolken,
	options: SmolkenOptions & SmplrOptions & { loader: SampleLoader }): Promise<Smolken> {
	let recognized = false;
	const loader: SampleLoader = {
		load(preset, loadOptions) {
			recognized = normalizeBackingBassPresetWithStatus(preset).recognized;
			return typeof loadOptions === 'function'
				? options.loader.load(preset, loadOptions)
				: options.loader.load(preset, loadOptions);
		}
	};
	const bass = new Bass(context, { ...options, loader });
	let gain: GainNode | undefined;
	try {
		await bass.load;
		if (recognized) {
			gain = context.createGain();
			gain.gain.value = BACKING_BASS_SELECTION_GAIN;
			bass.output.addInsert(gain);
		}
		return bass;
	} catch (error) {
		// The gain may exist before a failed addInsert connected it. Neither a
		// failed decode nor a partially built insert may leave a live graph.
		// Disconnect the owned chain first: its cleanup targets individual
		// edges, which a gain.disconnect() call would otherwise remove early.
		try { bass.disconnect(); } catch { /* Preserve the original load/insert error. */ }
		try { gain?.disconnect(); } catch { /* A partial graph may already be disconnected. */ }
		throw error;
	}
}
