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
let masterGain: GainNode | null = null;

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
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(Tone.getContext() as any).updateInterval = 0.025;

		// Create master gain node for global volume control
		const ctx = Tone.getContext().rawContext as AudioContext;
		masterGain = ctx.createGain();
		masterGain.connect(ctx.destination);

		initialized = true;
	}
	return Tone.getContext().rawContext as AudioContext;
}

/**
 * Get the master gain node. All audio output (instrument + metronome)
 * should route through this node for global volume control.
 * Must call initAudio() first.
 */
export function getMasterGain(): GainNode {
	if (!masterGain) {
		throw new Error('Audio not initialized. Call initAudio() first.');
	}
	return masterGain;
}

/** Set master volume (0-1). */
export function setMasterVolume(volume: number): void {
	if (masterGain) {
		masterGain.gain.value = Math.max(0, Math.min(1, volume));
	}
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

/**
 * Get the native AudioContext, unwrapping Tone.js's standardized-audio-context
 * wrapper if present. Needed for APIs that check `instanceof BaseAudioContext`
 * (e.g. the native AudioWorkletNode constructor).
 */
export async function getNativeAudioContext(): Promise<AudioContext> {
	const ctx = await getAudioContext();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return (ctx as any)._nativeAudioContext ?? ctx;
}
