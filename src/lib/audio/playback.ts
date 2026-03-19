/**
 * Phrase playback engine.
 *
 * Uses Tone.js Transport for scheduling and smplr Soundfont for instrument samples.
 * Both share the same AudioContext (via audio-context.ts).
 */

import type { Phrase } from '$lib/types/music.ts';
import type { PlaybackOptions } from '$lib/types/audio.ts';
import { fractionToFloat } from '$lib/music/intervals.ts';
import { initAudio } from './audio-context.ts';
import { scheduleMetronome, disposeMetronome } from './metronome.ts';

type ToneModule = typeof import('tone');
type SmplrSoundfont = import('smplr').Soundfont;

let tone: ToneModule | null = null;
let instrument: SmplrSoundfont | null = null;
let currentPart: InstanceType<ToneModule['Part']> | null = null;
let isPlaying = false;
let onStopCallback: (() => void) | null = null;

async function getTone(): Promise<ToneModule> {
	if (!tone) tone = await import('tone');
	return tone;
}

/** GM instrument names for smplr */
const GM_INSTRUMENT_NAMES: Record<string, string> = {
	'tenor-sax': 'tenor_sax',
	'alto-sax': 'alto_sax',
	trumpet: 'trumpet'
};

/**
 * Load a SoundFont instrument. Cached after first load (smplr uses CacheStorage).
 */
export async function loadInstrument(instrumentId: string = 'tenor-sax'): Promise<void> {
	const audioCtx = await initAudio();
	const { Soundfont } = await import('smplr');

	const gmName = GM_INSTRUMENT_NAMES[instrumentId] ?? 'tenor_sax';
	instrument = new Soundfont(audioCtx, { instrument: gmName });
	await instrument.loaded();
}

/**
 * Check if an instrument is loaded and ready.
 */
export function isInstrumentLoaded(): boolean {
	return instrument !== null;
}

/**
 * Convert phrase note offsets to Tone.js tick-based times.
 * Uses PPQ (Pulses Per Quarter note) for exact subdivision timing.
 */
function phraseToEvents(phrase: Phrase, tempo: number, ppq: number) {
	return phrase.notes
		.filter((n) => n.pitch !== null)
		.map((note) => {
			const quarterNotesFromStart = fractionToFloat(note.offset) * 4;
			const ticks = Math.round(quarterNotesFromStart * ppq);
			const durationBeats = fractionToFloat(note.duration) * 4;
			const durationSeconds = durationBeats * (60 / tempo);

			return {
				time: `${ticks}i`,
				midi: note.pitch!,
				duration: durationSeconds,
				velocity: note.velocity ?? 100
			};
		});
}

/**
 * Calculate total phrase duration in seconds.
 */
export function getPhraseDuration(phrase: Phrase, tempo: number): number {
	let maxEndBeat = 0;
	for (const note of phrase.notes) {
		const startBeat = fractionToFloat(note.offset) * 4;
		const durationBeat = fractionToFloat(note.duration) * 4;
		maxEndBeat = Math.max(maxEndBeat, startBeat + durationBeat);
	}
	return maxEndBeat * (60 / tempo);
}

/**
 * Calculate total phrase length in bars.
 */
function getPhraseBars(phrase: Phrase): number {
	const beatsPerBar = phrase.timeSignature[0];
	let maxEndBeat = 0;
	for (const note of phrase.notes) {
		const startBeat = fractionToFloat(note.offset) * 4;
		const durationBeat = fractionToFloat(note.duration) * 4;
		maxEndBeat = Math.max(maxEndBeat, startBeat + durationBeat);
	}
	return Math.ceil(maxEndBeat / beatsPerBar);
}

/**
 * Play a phrase through the loaded instrument.
 * Returns a promise that resolves when phrase playback finishes.
 *
 * If keepMetronome is true, the transport and metronome keep running
 * after the phrase ends (for the recording phase). Call stopPlayback()
 * to stop everything.
 */
export async function playPhrase(
	phrase: Phrase,
	options: PlaybackOptions,
	keepMetronome = false
): Promise<void> {
	if (!instrument) {
		throw new Error('Instrument not loaded. Call loadInstrument() first.');
	}

	const Tone = await getTone();
	const transport = Tone.getTransport();

	// Clean up any previous playback
	await stopPlayback();

	// Configure transport
	transport.bpm.value = options.tempo;
	transport.timeSignature = phrase.timeSignature[0];

	const ppq = transport.PPQ;
	const events = phraseToEvents(phrase, options.tempo, ppq);

	// Schedule phrase notes
	currentPart = new Tone.Part((time, event) => {
		instrument!.start({
			note: event.midi,
			velocity: event.velocity,
			duration: event.duration,
			time
		});
	}, events);
	currentPart.start(0);

	// Schedule metronome if enabled
	if (options.metronomeEnabled) {
		if (keepMetronome) {
			// Loop indefinitely — will keep playing during recording
			await scheduleMetronome(phrase.timeSignature[0], null);
		} else {
			const bars = getPhraseBars(phrase);
			await scheduleMetronome(phrase.timeSignature[0], bars);
		}
	}

	// Schedule end-of-phrase notification
	const totalDuration = getPhraseDuration(phrase, options.tempo);
	const totalTicks = Math.round((totalDuration / (60 / options.tempo)) * ppq);

	return new Promise<void>((resolve) => {
		isPlaying = true;

		if (keepMetronome) {
			// Resolve when phrase ends but keep transport + metronome alive
			transport.schedule(() => {
				if (currentPart) {
					currentPart.dispose();
					currentPart = null;
				}
				instrument?.stop();
				resolve();
			}, `${totalTicks + ppq}i`);
		} else {
			// Full stop after phrase ends
			transport.schedule(() => {
				stopPlayback();
				resolve();
			}, `${totalTicks + ppq}i`);
		}

		onStopCallback = resolve;
		transport.start();
	});
}

/**
 * Stop current playback immediately (transport, metronome, everything).
 */
export async function stopPlayback(): Promise<void> {
	const Tone = await getTone();
	const transport = Tone.getTransport();

	transport.stop();
	transport.position = 0;
	transport.cancel();

	if (currentPart) {
		currentPart.dispose();
		currentPart = null;
	}

	disposeMetronome();

	// Stop all ringing notes
	instrument?.stop();

	if (isPlaying && onStopCallback) {
		onStopCallback();
		onStopCallback = null;
	}
	isPlaying = false;
}

/** Whether playback is currently active */
export function getIsPlaying(): boolean {
	return isPlaying;
}

/**
 * Get the Transport's current position in seconds.
 * Returns 0 if Tone hasn't been loaded yet.
 */
export function getTransportSeconds(): number {
	if (!tone) return 0;
	return tone.getTransport().seconds;
}
