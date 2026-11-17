/**
 * Shared AudioContext management.
 *
 * Web Audio requires a user gesture to start. Tone.js wraps this
 * via Tone.start(). We share Tone's AudioContext with smplr so
 * both use the same timeline for scheduling.
 */

import { createMixer, getMixerLevels, setMixerLevels, subscribeMixer } from './mixer';
import { guardTickRedelivery } from './tick-redelivery';

type ToneModule = typeof import('tone');

let tone: ToneModule | null = null;
let initialized = false;
let mixer: ReturnType<typeof createMixer> | null = null;
let initializing: Promise<AudioContext> | null = null;

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
async function initializeAudio(): Promise<AudioContext> {
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

		// Tone's clock can hand one tick to two consecutive passes, firing
		// every non-once transport event on it twice (tick-redelivery.ts).
		// Nothing sounds before this point: every voice routes through the
		// master gain created below, which throws until initAudio has run.
		guardTickRedelivery(Tone.getTransport());

		// Create master gain node for global volume control
		const ctx = Tone.getContext().rawContext as AudioContext;
		mixer = createMixer(ctx, ctx.destination, getMixerLevels());
		subscribeMixer(levels => mixer?.setLevels(levels));

		initialized = true;
	}
	return Tone.getContext().rawContext as AudioContext;
}

/** Start one shared graph even when several instruments initialize concurrently. */
export function initAudio(): Promise<AudioContext> {
 return initializing ??= initializeAudio().catch(error => { initializing=null; throw error; });
}

/** Reject source connections until the shared graph is initialized. */
function activeMixer() {
 if (!mixer) throw new Error('Audio not initialized. Call initAudio() first.');
 return mixer;
}
/** Listening master output. Recording and instruments must use the named inputs below. */
export function getMasterGain(): GainNode { return activeMixer().master; }
/** Generated program before listening master, also the accompaniment recording tap. */
export function getProgramGain(): GainNode { return activeMixer().program; }
/** Melody input, controlled by the shared Melody fader. */
export function getMelodyGain(): GainNode { return activeMixer().melody; }
/** Click/count-off input, controlled independently of the band's fader. */
export function getClickGain(): GainNode { return activeMixer().click; }
/** Replay input receives output protection and Master, without entering recordings. */
export function getReplayGain(): GainNode { return activeMixer().output; }
/** Remember the level before initialization as well as changing active output. */
export function setMasterVolume(volume: number): void { setMixerLevels({ master: volume }); }

/**
 * Get the raw AudioContext (for passing to smplr).
 * Does not throw before initAudio(): it returns Tone's context either way,
 * possibly still suspended until initAudio() runs (only getMasterGain throws).
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
