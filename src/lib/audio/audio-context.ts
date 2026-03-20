/**
 * Shared AudioContext management.
 *
 * Web Audio requires a user gesture to start. Tone.js wraps this
 * via Tone.start(). We share Tone's AudioContext with smplr so
 * both use the same timeline for scheduling.
 */

type ToneModule = typeof import('tone');

let tone: ToneModule | null = null;
let initialized = false;

async function getTone(): Promise<ToneModule> {
	if (!tone) {
		tone = await import('tone');
	}
	return tone;
}

/**
 * Initialize the audio engine. Must be called from a user gesture (click/tap).
 * Idempotent — safe to call multiple times.
 */
export async function initAudio(): Promise<AudioContext> {
	const Tone = await getTone();
	if (!initialized) {
		await Tone.start();

		// Make the scheduling worker tick more frequently (every 25 ms
		// instead of the default 50 ms). This gives the scheduler twice
		// as many chances to pre-schedule events within the lookAhead
		// window, reducing beat jitter without the side-effect of firing
		// Transport.schedule callbacks too far ahead of time.
		Tone.getContext().updateInterval = 0.025;

		initialized = true;
	}
	return Tone.getContext().rawContext as AudioContext;
}

/**
 * Get the raw AudioContext (for passing to smplr).
 * Throws if initAudio() hasn't been called.
 */
export async function getAudioContext(): Promise<AudioContext> {
	const Tone = await getTone();
	return Tone.getContext().rawContext as AudioContext;
}

/** Check whether audio has been initialized */
export function isAudioInitialized(): boolean {
	return initialized;
}
