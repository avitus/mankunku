/**
 * Phrase playback engine.
 *
 * Uses Tone.js Transport for scheduling and either custom multi-sampled
 * instruments (via smplr Sampler) or GM SoundFont fallback (via smplr Soundfont).
 * Both share the same AudioContext (via audio-context.ts).
 *
 * Jazz expression features:
 * - Custom tenor sax samples (MTG Solo Sax, CC-BY 4.0) with velocity layers
 * - Subtle vibrato via LFO-driven detune
 * - Warm low-pass filtering to tame harsh digital edges
 * - Swing feel via Tone.js Transport swing
 * - Humanized velocity and timing for authentic jazz phrasing
 * - Per-note tuning corrections from SFZ mappings
 */

import type { Phrase } from '$lib/types/music.ts';
import type { PlaybackOptions } from '$lib/types/audio.ts';
import type { BackingInstrument } from '$lib/types/instruments.ts';
import { fractionToFloat } from '$lib/music/intervals.ts';
import { initAudio, getMasterGain, setMasterVolume } from './audio-context.ts';
import { scheduleMetronome, disposeMetronome, warmUpMetronome, setMetronomeVolume } from './metronome.ts';
import {
	loadBackingInstruments,
	startBackingTrack,
	scheduleBackingTrack,
	disposeBackingParts,
	disposeBackingTrack,
	isBackingLoaded
} from './backing-track.ts';
import { SAMPLE_MAPS, layerToBuffers, getTuneCorrection, type SampleMap } from './sample-maps.ts';

type ToneModule = typeof import('tone');
type SmplrSoundfont = import('smplr').Soundfont;
type SmplrSampler = import('smplr').Sampler;

let tone: ToneModule | null = null;
/** SoundFont instrument (used when no custom samples available) */
let instrument: SmplrSoundfont | null = null;
/** Custom sample layers for velocity switching */
let samplerPiano: SmplrSampler | null = null;
let samplerForte: SmplrSampler | null = null;
let activeSampleMap: SampleMap | null = null;
/** Shared mix node for routing both velocity layers through one effect chain */
let mixNode: GainNode | null = null;
let currentPart: InstanceType<ToneModule['Part']> | null = null;
let isPlaying = false;
let onStopCallback: (() => void) | null = null;
/** Transport event ID for the end-of-phrase cleanup callback.
 *  Cleared when a new phrase is scheduled so a stale callback from
 *  a previous playPhrase/scheduleNextPhrase can't dispose the new Part. */
let endPhraseEventId: number | null = null;
/** Monotonically increasing ID for cancelling stale loadInstrument calls. */
let currentLoadId = 0;

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
 * Set up jazz expression effects.
 *
 * Creates a subtle vibrato (LFO modulating detune) and a warmth filter
 * that rolls off harsh high frequencies, giving the samples a more
 * natural, breath-driven saxophone character.
 *
 * For custom samples: effects are inserted between the mix node and master gain.
 * For SoundFont: effects are added as inserts on the instrument's output channel.
 */
function setupJazzExpression(audioCtx: AudioContext, instrumentId: string): void {
	cleanupJazzExpression();

	const hasCustomSamples = mixNode !== null;
	if (!hasCustomSamples && !instrument) return;

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

	if (hasCustomSamples) {
		// Custom samples: insert effects between mix node and master gain.
		// Both velocity-layer samplers route to mixNode, so one effect
		// chain covers all notes regardless of which layer triggered.
		mixNode!.disconnect();
		mixNode!.connect(warmthFilter);
		warmthFilter.connect(getMasterGain());
	} else {
		// SoundFont: add as insert on the instrument's output channel.
		instrument!.output.addInsert({
			input: warmthFilter,
			output: warmthFilter
		});
	}

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
 * Clean up all instrument state (samplers and SoundFont).
 */
function cleanupInstruments(): void {
	cleanupJazzExpression();
	if (samplerPiano) {
		samplerPiano.disconnect();
		samplerPiano = null;
	}
	if (samplerForte) {
		samplerForte.disconnect();
		samplerForte = null;
	}
	if (mixNode) {
		mixNode.disconnect();
		mixNode = null;
	}
	activeSampleMap = null;
	if (instrument) {
		instrument.disconnect();
		instrument = null;
	}
}

/**
 * Load a custom multi-sampled instrument with velocity layers.
 * Returns true if samples loaded successfully, false to trigger fallback.
 */
async function loadCustomSamples(
	audioCtx: AudioContext,
	sampleMap: SampleMap,
	loadId: number
): Promise<boolean> {
	const { Sampler } = await import('smplr');
	if (loadId !== currentLoadId) return false;

	// Mix node: both velocity layers feed into this, then through effects to master gain
	const newMixNode = audioCtx.createGain();
	newMixNode.connect(getMasterGain());

	let newPiano: SmplrSampler | null = null;
	let newForte: SmplrSampler | null = null;

	try {
		// Explicit defaults required — smplr's samplerToSmplrJson puts
		// options.detune/decayTime/lpfCutoffHz into json.defaults, and
		// undefined values clobber PARAM_DEFAULTS via object spread.
		const samplerDefaults = { detune: 0, decayTime: 0.3, lpfCutoffHz: 20000 };
		newPiano = new Sampler(audioCtx, {
			buffers: layerToBuffers(sampleMap.piano),
			destination: newMixNode,
			...samplerDefaults
		});
		newForte = new Sampler(audioCtx, {
			buffers: layerToBuffers(sampleMap.forte),
			destination: newMixNode,
			...samplerDefaults
		});
		await Promise.all([newPiano.load, newForte.load]);

		// A newer load started while we were awaiting — discard our work
		if (loadId !== currentLoadId) {
			newPiano.disconnect();
			newForte.disconnect();
			newMixNode.disconnect();
			return false;
		}

		samplerPiano = newPiano;
		samplerForte = newForte;
		mixNode = newMixNode;
		activeSampleMap = sampleMap;
		return true;
	} catch (err) {
		console.warn('Custom samples failed to load, falling back to SoundFont:', err);
		// Clean up locally-created nodes (never touch globals — a newer load may own them)
		newPiano?.disconnect();
		newForte?.disconnect();
		newMixNode.disconnect();
		return false;
	}
}

/**
 * Load a SoundFont instrument (fallback when no custom samples available).
 */
async function loadSoundfont(audioCtx: AudioContext, instrumentId: string, loadId: number): Promise<void> {
	const { Soundfont } = await import('smplr');
	if (loadId !== currentLoadId) return;

	const gmName = GM_INSTRUMENT_NAMES[instrumentId] ?? 'tenor_sax';

	const newInstrument = new Soundfont(audioCtx, {
		instrument: gmName,
		kit: 'MusyngKite',
		loadLoopData: true,
		destination: getMasterGain()
	});
	await newInstrument.loaded();

	if (loadId !== currentLoadId) {
		newInstrument.disconnect();
		return;
	}

	instrument = newInstrument;
}

/**
 * Load an instrument with jazz expression processing.
 *
 * Uses custom multi-sampled recordings when available (tenor sax),
 * falling back to MusyngKite SoundFont for other instruments or on load error.
 */
export async function loadInstrument(
	instrumentId: string = 'tenor-sax',
	masterVolume?: number,
	backingInstrument?: BackingInstrument
): Promise<void> {
	const loadId = ++currentLoadId;
	const audioCtx = await initAudio();
	if (loadId !== currentLoadId) return;

	if (masterVolume !== undefined) {
		setMasterVolume(masterVolume);
	}

	cleanupInstruments();

	// Try custom samples first, fall back to SoundFont
	const sampleMap = SAMPLE_MAPS[instrumentId];
	if (sampleMap) {
		const loaded = await loadCustomSamples(audioCtx, sampleMap, loadId);
		if (loadId !== currentLoadId) return;
		if (!loaded) {
			await loadSoundfont(audioCtx, instrumentId, loadId);
			if (loadId !== currentLoadId) return;
		}
	} else {
		await loadSoundfont(audioCtx, instrumentId, loadId);
		if (loadId !== currentLoadId) return;
	}

	setupJazzExpression(audioCtx, instrumentId);

	// Load backing track instruments in parallel with metronome warmup
	// Backing track load is best-effort — failures must not block playback
	await Promise.all([
		warmUpMetronome(),
		...(backingInstrument
			? [loadBackingInstruments(backingInstrument).catch(err => {
				console.warn('Backing track preload failed (non-blocking):', err);
			})]
			: [])
	]);
}

/**
 * Check if an instrument is loaded and ready.
 */
export function isInstrumentLoaded(): boolean {
	return instrument !== null || (samplerPiano !== null && samplerForte !== null);
}

/**
 * Trigger a note on the active instrument.
 * Routes to the correct velocity layer when using custom samples,
 * and applies per-note tuning corrections from the SFZ mapping.
 */
function startNote(event: {
	midi: number;
	velocity: number;
	duration: number;
	time: number;
	detune: number;
}): void {
	if (activeSampleMap && samplerPiano && samplerForte) {
		const sampler = event.velocity > activeSampleMap.velocitySplit ? samplerForte : samplerPiano;
		const tuneCorrection = getTuneCorrection(activeSampleMap, event.midi, event.velocity);
		sampler.start({
			note: event.midi,
			velocity: event.velocity,
			duration: event.duration,
			time: event.time,
			detune: event.detune + tuneCorrection
		});
	} else if (instrument) {
		instrument.start({
			note: event.midi,
			velocity: event.velocity,
			duration: event.duration,
			time: event.time,
			detune: event.detune
		});
	}
}

/** Stop all ringing notes on the active instrument. */
function stopNotes(): void {
	samplerPiano?.stop();
	samplerForte?.stop();
	instrument?.stop();
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
 * @param tempo - Current tempo in BPM (jitter scales inversely with tempo)
 * @returns Humanized tick value (never negative)
 */
function humanizeTiming(ticks: number, ppq: number, tempo: number): number {
	// Base jitter of ~7ms, scaled by tempo: less jitter at fast tempos,
	// more room at slow tempos. Reference tempo is 120 BPM.
	const baseMs = 6;
	const tempoScale = 120 / tempo; // 1.0 at 120, 0.5 at 240, 2.0 at 60
	const maxDeviationMs = baseMs * tempoScale;
	// Convert ms to ticks: at `tempo` BPM, one beat = 60/tempo seconds = ppq ticks
	const msPerTick = (60 / tempo / ppq) * 1000;
	const maxDeviationTicks = Math.round(maxDeviationMs / msPerTick);
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
		const ticks = humanizeTiming(rawTicks, ppq, tempo);
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
 * Considers both the melody notes and the harmony segments — a phrase
 * intended for `skipMelody` playback may carry only harmony, so we can't
 * rely on note durations alone.
 */
function getPhraseBars(phrase: Phrase): number {
	const beatsPerBar = phrase.timeSignature[0];
	let maxEndBeat = 0;
	for (const note of phrase.notes) {
		const startBeat = fractionToFloat(note.offset) * 4;
		const durationBeat = fractionToFloat(note.duration) * 4;
		maxEndBeat = Math.max(maxEndBeat, startBeat + durationBeat);
	}
	for (const seg of phrase.harmony) {
		const startBeat = fractionToFloat(seg.startOffset) * 4;
		const durationBeat = fractionToFloat(seg.duration) * 4;
		maxEndBeat = Math.max(maxEndBeat, startBeat + durationBeat);
	}
	return Math.ceil(maxEndBeat / beatsPerBar);
}

/**
 * Options for fine-grained control of phrase scheduling.
 *
 * `skipMelody` — Skip creating the melody Tone.Part. Use when only the
 * backing track and metronome should sound (e.g. continuous lick-practice
 * mode where the app never plays the melody). Count-in, metronome, and
 * backing are still scheduled normally.
 *
 * `loopBacking` — Override whether the backing track's bass/comp/drums
 * loop after the phrase ends. Defaults to the caller's sensible default
 * (keepMetronome for playPhrase, true for scheduleNextPhrase). Pass
 * `false` when the caller plans to manually reschedule the next key's
 * backing at the next bar downbeat.
 *
 * `onStarted` — Fired synchronously after `transport.start()` is called.
 * Use this hook to register additional `transport.scheduleOnce` callbacks
 * that must survive `playPhrase`'s internal `stopPlayback()` (which cancels
 * any events queued before its setup runs). Anything scheduled inside
 * `onStarted` is added to the freshly-started transport and will fire.
 */
export interface PhrasePlaybackOpts {
	skipMelody?: boolean;
	loopBacking?: boolean;
	onStarted?: () => void;
	/** Override the computed start tick for scheduleNextPhrase (ensures
	 *  caller and playback agree on the exact bar boundary). */
	startTick?: number;
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
	keepMetronome = false,
	opts: PhrasePlaybackOpts = {}
): Promise<void> {
	if (!isInstrumentLoaded()) {
		throw new Error('Instrument not loaded. Call loadInstrument() first.');
	}

	const Tone = await getTone();
	const transport = Tone.getTransport();

	// Ensure AudioContext is active — the browser may have suspended it
	// between loadInstrument() and this call if no audio was playing.
	await Tone.start();

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
	const beatsPerBar = phrase.timeSignature[0];
	const barTicks = beatsPerBar * ppq;
	const skipMelody = opts.skipMelody ?? false;
	const loopBacking = opts.loopBacking ?? keepMetronome;

	// Schedule phrase notes with jazz expression.
	// Offset by 1 bar so the metronome plays a count-in first — this lets
	// the Transport's audio scheduling stabilise before the melody starts,
	// preventing the perceived tempo glitch on the first phrase.
	if (!skipMelody) {
		const events = phraseToEvents(phrase, options.tempo, ppq);
		currentPart = new Tone.Part((time, event) => {
			startNote({ ...event, time });
		}, events);
		currentPart.start(`${barTicks}i`);
	}

	// Schedule metronome if enabled
	if (options.metronomeEnabled) {
		await setMetronomeVolume(options.metronomeVolume);
		if (keepMetronome) {
			// Loop indefinitely — will keep playing during recording
			await scheduleMetronome(beatsPerBar, null);
		} else {
			const bars = getPhraseBars(phrase) + 1; // +1 for count-in bar
			await scheduleMetronome(beatsPerBar, bars);
		}
	}

	// Schedule backing track if enabled
	if (options.backingTrackEnabled && isBackingLoaded()) {
		await scheduleBackingTrack(phrase, options, barTicks, loopBacking);
	}

	// Schedule end-of-phrase notification. We always derive phrase length from
	// `getPhraseBars`, which considers both melody notes and harmony segments
	// (max of the two, rounded up to a whole bar). This is the right choice
	// for both:
	//   1. Phrases whose notes and harmony cover the same bar range — same
	//      result as the old getPhraseDuration-based math.
	//   2. Super phrases (continuous lick-practice mode with demo) where the
	//      notes cover only the demo cycle but the harmony spans 13 cycles —
	//      we need the endTick to cover the full harmony.
	const phraseTicks = getPhraseBars(phrase) * barTicks;
	const endTick = barTicks + phraseTicks + ppq;

	return new Promise<void>((resolve) => {
		isPlaying = true;

		if (keepMetronome) {
			// Resolve when phrase ends but keep transport + metronome alive
			endPhraseEventId = transport.scheduleOnce(() => {
				endPhraseEventId = null;
				if (currentPart) {
					currentPart.dispose();
					currentPart = null;
				}
				stopNotes();
				resolve();
			}, `${endTick}i`);
		} else {
			// Full stop after phrase ends
			endPhraseEventId = transport.scheduleOnce(() => {
				endPhraseEventId = null;
				stopPlayback();
				resolve();
			}, `${endTick}i`);
		}

		onStopCallback = resolve;

		// Start with a small lookahead so the Web Audio scheduler has time
		// to buffer the first events. Without this, the first few beats
		// can jitter — especially on the very first play when the audio
		// system is still settling after mic capture opens full-duplex mode.
		transport.start('+0.1');

		// Fire onStarted hook now that transport is running and the
		// internal stopPlayback() (which calls transport.cancel()) is
		// behind us. Callers can safely schedule additional events here.
		opts.onStarted?.();
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

	endPhraseEventId = null; // transport.cancel() already removed it
	if (currentPart) {
		currentPart.dispose();
		currentPart = null;
	}

	disposeMetronome();
	disposeBackingParts();

	// Stop all ringing notes
	stopNotes();

	if (isPlaying && onStopCallback) {
		onStopCallback();
		onStopCallback = null;
	}
	isPlaying = false;
}

/**
 * Schedule a phrase on an already-running transport (metronome keeps ticking).
 * Aligns to the next bar downbeat so the phrase starts on a natural boundary.
 * Returns a promise that resolves when the phrase finishes playing.
 *
 * Pass `opts.skipMelody` to reschedule only the backing track for a new
 * phrase's harmony (used by continuous lick-practice mode so the app never
 * plays the melody). Pass `opts.loopBacking: false` when the caller plans
 * to reschedule again before the backing would run out.
 */
export async function scheduleNextPhrase(
	phrase: Phrase,
	options: PlaybackOptions,
	opts: PhrasePlaybackOpts = {}
): Promise<void> {
	if (!isInstrumentLoaded()) {
		throw new Error('Instrument not loaded. Call loadInstrument() first.');
	}

	const Tone = await getTone();
	const transport = Tone.getTransport();
	const ppq = transport.PPQ;
	const skipMelody = opts.skipMelody ?? false;
	const loopBacking = opts.loopBacking ?? true;

	// Ensure BPM stays correct on the running transport
	transport.bpm.value = options.tempo;

	// Cancel the stale end-of-phrase callback from the previous
	// playPhrase / scheduleNextPhrase so it can't dispose the new Part
	// we're about to create.
	if (endPhraseEventId != null) {
		transport.clear(endPhraseEventId);
		endPhraseEventId = null;
	}

	// Dispose previous phrase part (metronome sequence is untouched)
	if (currentPart) {
		currentPart.dispose();
		currentPart = null;
	}
	disposeBackingParts();
	stopNotes();

	// Find the next bar downbeat with at least 1 beat of lead time.
	// When the caller supplies startTick, use it directly so the backing
	// track lands on the exact same bar boundary the caller computed
	// synchronously (before the await introduced by this async function).
	const beatsPerBar = phrase.timeSignature[0];
	const ticksPerBar = beatsPerBar * ppq;
	let nextBarTicks: number;
	if (opts.startTick != null) {
		nextBarTicks = opts.startTick;
	} else {
		const currentTicks = transport.ticks;
		nextBarTicks = Math.ceil(currentTicks / ticksPerBar) * ticksPerBar;
		if (nextBarTicks - currentTicks < ppq) {
			nextBarTicks += ticksPerBar;
		}
	}

	// Apply swing (transport already has swing configured from initial playPhrase)
	if (!skipMelody) {
		const events = phraseToEvents(phrase, options.tempo, ppq);
		currentPart = new Tone.Part((time, event) => {
			startNote({ ...event, time });
		}, events);
		currentPart.start(`${nextBarTicks}i`);
	}

	// Schedule backing track for the new phrase
	if (options.backingTrackEnabled && isBackingLoaded()) {
		await scheduleBackingTrack(phrase, options, nextBarTicks, loopBacking);
	}

	// Schedule end-of-phrase notification. See playPhrase for the rationale
	// behind always deriving the length from getPhraseBars.
	const phraseTicks = getPhraseBars(phrase) * ticksPerBar;
	const endTicks = nextBarTicks + phraseTicks + ppq;

	return new Promise<void>((resolve) => {
		endPhraseEventId = transport.scheduleOnce(() => {
			endPhraseEventId = null;
			if (currentPart) {
				currentPart.dispose();
				currentPart = null;
			}
			stopNotes();
			resolve();
		}, `${endTicks}i`);
		onStopCallback = resolve;
	});
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
