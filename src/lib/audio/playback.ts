/**
 * Phrase playback engine.
 *
 * Uses Tone.js Transport for scheduling and smplr Soundfont for instrument samples.
 * Both share the same AudioContext (via audio-context.ts).
 *
 * Jazz expression features:
 * - MusyngKite soundfont for warmer, more expressive samples
 * - Subtle vibrato via LFO-driven detune
 * - Warm low-pass filtering to tame harsh digital edges
 * - Swing feel via Tone.js Transport swing
 * - Humanized velocity and timing for authentic jazz phrasing
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

/** Web Audio nodes for jazz expression effects */
let vibratoLfo: OscillatorNode | null = null;
let vibratoGain: GainNode | null = null;
let warmthFilter: BiquadFilterNode | null = null;

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
 * Set up jazz expression effects on the instrument's output channel.
 *
 * Creates a subtle vibrato (LFO modulating detune) and a warmth filter
 * that rolls off harsh high frequencies, giving the soundfont samples
 * a more natural, breath-driven saxophone character.
 */
function setupJazzExpression(audioCtx: AudioContext, instrumentId: string): void {
	cleanupJazzExpression();

	if (!instrument) return;

	// Only apply saxophone-specific expression to sax instruments
	const isSax = instrumentId.includes('sax');

	// --- Warmth filter ---
	// Roll off harsh highs to simulate the natural warmth of a real horn.
	// Tenor sax is darker; alto and trumpet get a slightly brighter cutoff.
	warmthFilter = audioCtx.createBiquadFilter();
	warmthFilter.type = 'lowpass';
	warmthFilter.frequency.value = isSax ? 4500 : 6000;
	warmthFilter.Q.value = 0.7; // Gentle slope, no resonance peak

	// --- Vibrato via LFO ---
	// A slow, subtle pitch wobble (4.8 Hz, ~12 cents depth) emulates
	// the natural vibrato a saxophonist produces with jaw/airstream.
	// This is more restrained than classical vibrato — jazz players
	// tend to use vibrato selectively, mainly on sustained notes.
	vibratoLfo = audioCtx.createOscillator();
	vibratoLfo.type = 'sine';
	vibratoLfo.frequency.value = 4.8; // ~5 Hz, natural vibrato rate

	vibratoGain = audioCtx.createGain();
	// Depth in cents — 12 cents is subtle enough to add life without
	// sounding like a pitch-bent synth. On trumpet, reduce further.
	vibratoGain.gain.value = isSax ? 12 : 6;

	vibratoLfo.connect(vibratoGain);
	vibratoLfo.start();

	// Connect the warmth filter as an insert on the instrument output.
	// smplr's Channel.addInsert expects { input, output } for two-node chains.
	instrument.output.addInsert({
		input: warmthFilter,
		output: warmthFilter
	});

	// The vibrato LFO modulates the detune of the warmth filter node.
	// BiquadFilterNode.detune is an AudioParam that shifts the filter
	// frequency in cents — but when placed in the signal chain, this
	// creates a subtle pitch-shifting effect on the signal passing through.
	// For a more direct approach, we'll use the filter's detune param
	// which creates micro pitch modulation on the filtered signal.
	vibratoGain.connect(warmthFilter.detune);
}

/**
 * Clean up jazz expression audio nodes.
 */
function cleanupJazzExpression(): void {
	if (vibratoLfo) {
		vibratoLfo.stop();
		vibratoLfo.disconnect();
		vibratoLfo = null;
	}
	if (vibratoGain) {
		vibratoGain.disconnect();
		vibratoGain = null;
	}
	if (warmthFilter) {
		warmthFilter.disconnect();
		warmthFilter = null;
	}
}

/**
 * Load a SoundFont instrument with jazz expression processing.
 * Uses MusyngKite soundfont for warmer, more expressive samples.
 * Cached after first load (smplr uses CacheStorage).
 */
export async function loadInstrument(instrumentId: string = 'tenor-sax'): Promise<void> {
	const audioCtx = await initAudio();
	const { Soundfont } = await import('smplr');

	// Disconnect previous instrument if switching
	if (instrument) {
		cleanupJazzExpression();
		instrument.disconnect();
	}

	const gmName = GM_INSTRUMENT_NAMES[instrumentId] ?? 'tenor_sax';

	// MusyngKite has richer, more expressive samples than FluidR3_GM,
	// particularly for wind instruments. The tenor sax samples have
	// more natural breath and tonal variation across the velocity range.
	instrument = new Soundfont(audioCtx, {
		instrument: gmName,
		kit: 'MusyngKite',
		// Load loop data so sustained notes can ring naturally
		loadLoopData: true
	});
	await instrument.loaded();

	// Apply jazz expression effects to the loaded instrument
	setupJazzExpression(audioCtx, instrumentId);
}

/**
 * Check if an instrument is loaded and ready.
 */
export function isInstrumentLoaded(): boolean {
	return instrument !== null;
}

/**
 * Apply subtle humanization to velocity values.
 * Jazz musicians naturally vary their dynamics — this adds small random
 * fluctuations to avoid the "machine gun" effect of identical velocities.
 *
 * @param baseVelocity - The original velocity (0-127)
 * @param range - Maximum deviation in either direction (default: 8)
 * @returns Humanized velocity clamped to 1-127
 */
function humanizeVelocity(baseVelocity: number, range: number = 8): number {
	const deviation = (Math.random() - 0.5) * 2 * range;
	return Math.max(1, Math.min(127, Math.round(baseVelocity + deviation)));
}

/**
 * Apply subtle timing humanization in ticks.
 * Real players don't land exactly on the grid — this adds micro-timing
 * variations that give the phrase a more organic, "in the pocket" feel.
 *
 * @param ticks - Exact grid position in ticks
 * @param ppq - Pulses per quarter note (for scaling)
 * @returns Humanized tick value (never negative)
 */
function humanizeTiming(ticks: number, ppq: number): number {
	// Max deviation of ~15ms worth of ticks at the current PPQ.
	// At 480 PPQ / 120 BPM, one tick = ~1ms, so this is ~15 ticks.
	const maxDeviationTicks = Math.round(ppq * 0.03);
	const deviation = (Math.random() - 0.5) * 2 * maxDeviationTicks;
	return Math.max(0, Math.round(ticks + deviation));
}

/**
 * Compute a breath-like attack envelope for a note.
 * Saxophone notes don't all start the same way — lower notes and softer
 * dynamics tend to have a slightly softer, more gradual onset.
 *
 * Returns a detune offset (in cents) to simulate the slight pitch scoop
 * that saxophonists naturally produce at the start of a phrase.
 */
function getBreathDetune(midi: number, isFirstNote: boolean): number {
	// First note of a phrase often has a slight upward scoop
	if (isFirstNote) return -15;
	// Lower notes get a subtle scoop; higher notes are more precise
	if (midi < 60) return -8;
	return 0;
}

/**
 * Convert phrase note offsets to Tone.js tick-based times.
 * Uses PPQ (Pulses Per Quarter note) for exact subdivision timing.
 * Applies humanization for authentic jazz feel.
 */
function phraseToEvents(phrase: Phrase, tempo: number, ppq: number) {
	const pitched = phrase.notes.filter((n) => n.pitch !== null);
	return pitched.map((note, index) => {
		const quarterNotesFromStart = fractionToFloat(note.offset) * 4;
		const rawTicks = Math.round(quarterNotesFromStart * ppq);
		const ticks = humanizeTiming(rawTicks, ppq);
		const durationBeats = fractionToFloat(note.duration) * 4;
		const durationSeconds = durationBeats * (60 / tempo);

		return {
			time: `${ticks}i`,
			midi: note.pitch!,
			duration: durationSeconds,
			velocity: humanizeVelocity(note.velocity ?? 100),
			detune: getBreathDetune(note.pitch!, index === 0)
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
 * Applies swing feel via Tone.js Transport when the swing option
 * is greater than 0.5 (straight). Jazz swing is applied to 8th notes,
 * pushing the off-beat 8ths later to create the characteristic
 * "long-short" subdivision feel.
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

	// Apply swing feel to the Transport.
	// Tone.js swing ranges from 0 (straight) to 1 (dotted-8th + 16th).
	// The PlaybackOptions.swing ranges from 0.5 (straight) to 0.8 (heavy).
	// Convert: when options.swing = 0.5  -> transport swing = 0
	//          when options.swing = 0.67 -> transport swing ≈ 0.34 (triplet feel)
	//          when options.swing = 0.75 -> transport swing = 0.5
	//          when options.swing = 0.8  -> transport swing = 0.6 (heavy)
	if (options.swing > 0.5) {
		transport.swing = (options.swing - 0.5) * 2;
		transport.swingSubdivision = '8n';
	} else {
		transport.swing = 0;
	}

	const ppq = transport.PPQ;
	const events = phraseToEvents(phrase, options.tempo, ppq);

	// Schedule phrase notes with jazz expression
	currentPart = new Tone.Part((time, event) => {
		instrument!.start({
			note: event.midi,
			velocity: event.velocity,
			duration: event.duration,
			time,
			// Apply breath-scoop detune per note
			detune: event.detune
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
