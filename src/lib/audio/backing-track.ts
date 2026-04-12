/**
 * Jazz backing track engine.
 *
 * Generates and schedules walking bass, piano/organ comping, and a
 * drum pattern synchronized to phrase harmony via the Tone.js Transport.
 *
 * Instruments:
 * - Upright bass (acoustic_bass GM SoundFont)
 * - Piano or organ (acoustic_grand_piano / drawbar_organ, configurable)
 * - Drums: synthesized kick, ride, hi-hat (same approach as metronome.ts)
 */

import type { Phrase, HarmonicSegment } from '$lib/types/music.ts';
import type { PlaybackOptions } from '$lib/types/audio.ts';
import type { BackingInstrument, BackingStyle } from '$lib/types/instruments.ts';
import { fractionToFloat } from '$lib/music/intervals.ts';
import { initAudio, getMasterGain, getAudioContext } from './audio-context.ts';
import { pitchClassToNumber, shellVoicing, voiceLead } from './voicings.ts';
import { chordSymbol } from '$lib/music/chords.ts';
import { buildSchedule, type BackingTrackSchedule } from './backing-track-schedule.ts';
import { BACKING_STYLES, type StyleDefinition } from './backing-styles.ts';

// ── Diagnostics log ──────────────────────────────────────────

export interface BackingTrackBeat {
	beat: number;
	bassMidi: number;
	compMidi: number[] | null;
	compVelocity: number | null;
	drumParts: string[];
	melodyMidi: number | null;
}

export interface BackingTrackSegmentLog {
	chord: string;
	startBeat: number;
	durationBeats: number;
	beats: BackingTrackBeat[];
}

export interface BackingTrackLog {
	timestamp: number;
	phraseId: string;
	phraseName: string;
	key: string;
	tempo: number;
	timeSignature: [number, number];
	segments: BackingTrackSegmentLog[];
}

const MAX_LOG_ENTRIES = 30;
const LOG_STORAGE_KEY = 'backing-track-log';

function loadLog(): BackingTrackLog[] {
	if (typeof sessionStorage === 'undefined') return [];
	try {
		const raw = sessionStorage.getItem(LOG_STORAGE_KEY);
		return raw ? JSON.parse(raw) : [];
	} catch {
		return [];
	}
}

function saveLog(log: BackingTrackLog[]): void {
	if (typeof sessionStorage === 'undefined') return;
	try {
		sessionStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(log));
	} catch { /* quota exceeded — ignore */ }
}

const backingTrackLog: BackingTrackLog[] = loadLog();

/** Get the backing track diagnostics log (newest first). */
export function getBackingTrackLog(count = 20): BackingTrackLog[] {
	// Re-read from storage to handle SSR/hydration boundary
	if (backingTrackLog.length === 0 && typeof sessionStorage !== 'undefined') {
		const fresh = loadLog();
		backingTrackLog.push(...fresh);
	}
	return backingTrackLog.slice(0, count);
}

type ToneModule = typeof import('tone');
type SmplrSoundfont = import('smplr').Soundfont;

// ── Module-level state ───────────────────────────────────────

let tone: ToneModule | null = null;

// Pitched instruments (loaded lazily via smplr Soundfont)
let compInstrument: SmplrSoundfont | null = null;
let bassInstrument: SmplrSoundfont | null = null;
let currentInstrumentType: BackingInstrument | null = null;

// Gain nodes for independent volume control
let backingGain: GainNode | null = null;

// Drums: synthesized (same approach as metronome.ts)
let rideSynth: InstanceType<ToneModule['NoiseSynth']> | null = null;
let hihatSynth: InstanceType<ToneModule['NoiseSynth']> | null = null;
let kickSynth: InstanceType<ToneModule['MembraneSynth']> | null = null;
let rideFilter: InstanceType<ToneModule['Filter']> | null = null;
let hihatFilter: InstanceType<ToneModule['Filter']> | null = null;
let drumGainNode: InstanceType<ToneModule['Gain']> | null = null;

// Scheduled parts
let bassPart: InstanceType<ToneModule['Part']> | null = null;
let compPart: InstanceType<ToneModule['Part']> | null = null;
let drumSequence: InstanceType<ToneModule['Sequence']> | null = null;
let activeSchedule: BackingTrackSchedule | null = null;

/** Monotonically increasing ID for cancelling stale loads. */
let currentLoadId = 0;

// ── Lazy initialisation ──────────────────────────────────────

async function getTone(): Promise<ToneModule> {
	if (!tone) tone = await import('tone');
	return tone;
}

async function ensureDrums(): Promise<void> {
	if (rideSynth) return;
	const Tone = await getTone();

	const master = getMasterGain();
	drumGainNode = new Tone.Gain(0.4);
	drumGainNode.connect(master);

	// Ride cymbal: bright filtered noise
	rideFilter = new Tone.Filter({ frequency: 8000, type: 'highpass' }).connect(drumGainNode);
	rideSynth = new Tone.NoiseSynth({
		noise: { type: 'white' },
		envelope: { attack: 0.001, decay: 0.15, sustain: 0, release: 0.08 }
	}).connect(rideFilter);

	// Hi-hat chick: tight filtered noise
	hihatFilter = new Tone.Filter({ frequency: 6000, type: 'highpass' }).connect(drumGainNode);
	hihatSynth = new Tone.NoiseSynth({
		noise: { type: 'pink' },
		envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.02 }
	}).connect(hihatFilter);

	// Kick drum: short membrane thump
	kickSynth = new Tone.MembraneSynth({
		pitchDecay: 0.04,
		octaves: 6,
		envelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.1 }
	}).connect(drumGainNode);
}

const COMP_INSTRUMENT_NAMES: Record<BackingInstrument, string> = {
	piano: 'acoustic_grand_piano',
	organ: 'drawbar_organ'
};

/**
 * Load backing track instruments (bass + chord instrument).
 * Idempotent for the same chord instrument type.
 */
export async function loadBackingInstruments(
	instrumentType: BackingInstrument = 'piano'
): Promise<void> {
	const loadId = ++currentLoadId;
	const audioCtx = await initAudio();
	if (loadId !== currentLoadId) return;

	// Create shared gain node if needed
	if (!backingGain) {
		backingGain = audioCtx.createGain();
		backingGain.gain.value = 0.5;
		backingGain.connect(getMasterGain());
	}

	const { Soundfont } = await import('smplr');
	if (loadId !== currentLoadId) return;

	// Load bass if not already loaded
	if (!bassInstrument) {
		const bass = new Soundfont(audioCtx, {
			instrument: 'acoustic_bass',
			kit: 'MusyngKite',
			destination: backingGain
		});
		await bass.load;
		if (loadId !== currentLoadId) {
			bass.disconnect();
			return;
		}
		bassInstrument = bass;
	}

	// Reload comp instrument only when type changes
	if (!compInstrument || currentInstrumentType !== instrumentType) {
		const newComp = new Soundfont(audioCtx, {
			instrument: COMP_INSTRUMENT_NAMES[instrumentType],
			kit: 'MusyngKite',
			destination: backingGain
		});
		await newComp.load;
		if (loadId !== currentLoadId) {
			newComp.disconnect();
			return;
		}
		const oldComp = compInstrument;
		compInstrument = newComp;
		currentInstrumentType = instrumentType;
		if (oldComp) {
			oldComp.stop();
			oldComp.disconnect();
		}
	}
}

/** Check if backing instruments are loaded and ready. */
export function isBackingLoaded(): boolean {
	return bassInstrument !== null && compInstrument !== null;
}

// ── Bass generation ──────────────────────────────────────────

const BASS_REGISTER = 40; // E2 — center of upright bass range

/** Find nearest bass-register MIDI note for a pitch class. */
function nearestBassNote(pc: number, center: number): number {
	const centerPc = ((center % 12) + 12) % 12;
	let midi = center + ((pc - centerPc + 6 + 12) % 12 - 6);
	// Clamp to reasonable bass range (E1=28 to G3=55)
	if (midi < 28) midi += 12;
	if (midi > 55) midi -= 12;
	return midi;
}

/** Pick a chord tone for bass on a given beat index. */
function chordToneForBass(rootPc: number, quality: string, center: number, beatIndex: number): number {
	// Compute chord-tone intervals from quality
	const hasMinor3rd = quality.startsWith('min') || quality.includes('dim');
	const hasDim5th = quality.includes('dim') || quality.includes('b5');
	const hasAug5th = quality.includes('aug');

	const thirdInterval = hasMinor3rd ? 3 : 4;
	const fifthInterval = hasDim5th ? 6 : hasAug5th ? 8 : 7;

	// Chord tones ordered for melodic variety by beat position
	const tones = beatIndex % 2 === 1
		? [fifthInterval, thirdInterval, 0]
		: [thirdInterval, fifthInterval, 0];
	const offset = tones[beatIndex % tones.length];
	const pc = (rootPc + offset) % 12;
	return nearestBassNote(pc, center);
}

/** Chromatic approach note (half step below or above target). */
function approachNote(targetMidi: number): number {
	return Math.random() < 0.6 ? targetMidi - 1 : targetMidi + 1;
}

/** Subtle timing humanization for backing track (tighter than melody). */
function humanizeBeatTicks(ticks: number, ppq: number, tempo: number): number {
	const baseMs = 3;
	const tempoScale = 120 / tempo;
	const maxDeviationMs = baseMs * tempoScale;
	const msPerTick = (60 / tempo / ppq) * 1000;
	const maxDeviationTicks = Math.round(maxDeviationMs / msPerTick);
	const deviation = (Math.random() - 0.5) * 2 * maxDeviationTicks;
	return Math.max(0, Math.round(ticks + deviation));
}

interface BassEvent {
	time: string;
	midi: number;
	duration: number;
	velocity: number;
}

/**
 * Generate walking bass notes for the chord progression.
 * Uses chord tones on interior beats and chromatic approach notes
 * on the last beat of each segment to lead into the next root.
 */
function generateWalkingBass(
	harmony: HarmonicSegment[],
	beatsPerBar: number,
	tempo: number,
	ppq: number
): BassEvent[] {
	const events: BassEvent[] = [];
	const beatDuration = 60 / tempo;

	for (let segIdx = 0; segIdx < harmony.length; segIdx++) {
		const seg = harmony[segIdx];
		const rootPc = pitchClassToNumber(seg.chord.root);
		const rootMidi = nearestBassNote(rootPc, BASS_REGISTER);

		const segStartBeats = fractionToFloat(seg.startOffset) * 4;
		const segDurationBeats = fractionToFloat(seg.duration) * 4;
		const totalBeats = Math.round(segDurationBeats);

		// Next segment's root for approach notes (no wrapping on last segment)
		const hasNext = segIdx + 1 < harmony.length;
		const nextRootPc = hasNext ? pitchClassToNumber(harmony[segIdx + 1].chord.root) : rootPc;
		const nextRootMidi = hasNext ? nearestBassNote(nextRootPc, BASS_REGISTER) : rootMidi;

		for (let beat = 0; beat < totalBeats; beat++) {
			const beatOffset = segStartBeats + beat;
			const ticks = Math.round(beatOffset * ppq);
			let midi: number;

			if (beat === 0) {
				// Beat 1: always the root
				midi = rootMidi;
			} else if (beat === totalBeats - 1 && totalBeats > 1) {
				// Last beat: chromatic approach to next root
				midi = approachNote(nextRootMidi);
			} else if (beat === 1) {
				// Beat 2: chord tone (3rd or 5th)
				midi = chordToneForBass(rootPc, seg.chord.quality, BASS_REGISTER, 1);
			} else {
				// Beat 3+: alternate chord tones
				midi = chordToneForBass(rootPc, seg.chord.quality, BASS_REGISTER, beat);
			}

			// Subtle velocity humanization
			const velocity = 80 + Math.round((Math.random() - 0.5) * 10);

			events.push({
				time: `${humanizeBeatTicks(ticks, ppq, tempo)}i`,
				midi,
				duration: beatDuration * 0.85, // Slightly detached
				velocity
			});
		}
	}

	return events;
}

// ── Comping generation ───────────────────────────────────────

interface CompEvent {
	time: string;
	notes: number[];
	duration: number;
	velocity: number;
}

/**
 * Generate comp (chord) events with voice-led voicings.
 * Uses style definition to determine comping pattern.
 */
function generateComping(
	harmony: HarmonicSegment[],
	beatsPerBar: number,
	tempo: number,
	ppq: number,
	style: StyleDefinition
): CompEvent[] {
	const events: CompEvent[] = [];
	const beatDuration = 60 / tempo;

	// Voice-lead the chord sequence
	const chords = harmony.map(seg => ({ root: seg.chord.root, quality: seg.chord.quality }));
	const voicings = voiceLead(chords, shellVoicing, 54);

	for (let segIdx = 0; segIdx < harmony.length; segIdx++) {
		const seg = harmony[segIdx];
		const voicing = voicings[segIdx];
		if (!voicing || voicing.length === 0) continue;

		const segStartBeats = fractionToFloat(seg.startOffset) * 4;
		const segDurationBeats = fractionToFloat(seg.duration) * 4;
		const totalBeats = Math.round(segDurationBeats);

		for (let beat = 0; beat < totalBeats; beat++) {
			const beatInBar = Math.round(segStartBeats + beat) % beatsPerBar;
			const compResult = style.compPattern(beatInBar, beatsPerBar);

			if (!compResult.hit) continue;

			const beatOffset = segStartBeats + beat;
			const ticks = Math.round(beatOffset * ppq);

			const compDurationBeats = compResult.duration[0] / compResult.duration[1];
			events.push({
				time: `${humanizeBeatTicks(ticks, ppq, tempo)}i`,
				notes: voicing,
				duration: beatDuration * compDurationBeats,
				velocity: compResult.velocity
			});
		}
	}

	return events;
}

// ── Harmony fallback ─────────────────────────────────────────

/**
 * When phrase.harmony is empty, infer a tonic chord spanning the full phrase.
 */
function inferTonicChord(phrase: Phrase): HarmonicSegment[] {
	let maxEndBeat = 0;
	for (const note of phrase.notes) {
		const start = fractionToFloat(note.offset) * 4;
		const dur = fractionToFloat(note.duration) * 4;
		maxEndBeat = Math.max(maxEndBeat, start + dur);
	}
	// Express exact beat count as a whole-note fraction [beats, 4]
	const beats = Math.max(1, Math.ceil(maxEndBeat));
	return [
		{
			chord: { root: phrase.key, quality: 'maj7' },
			scaleId: 'major.ionian',
			startOffset: [0, 1],
			duration: [beats, 4]
		}
	];
}

/** Get total harmony duration in quarter-note beats. */
function getHarmonyDurationBeats(harmony: HarmonicSegment[]): number {
	let maxEnd = 0;
	for (const seg of harmony) {
		const start = fractionToFloat(seg.startOffset) * 4;
		const dur = fractionToFloat(seg.duration) * 4;
		maxEnd = Math.max(maxEnd, start + dur);
	}
	return maxEnd;
}

// ── Log capture ──────────────────────────────────────────────

function captureLog(
	phrase: Phrase,
	harmony: HarmonicSegment[],
	bassEvents: BassEvent[],
	compEvents: CompEvent[],
	beatsPerBar: number,
	ppq: number,
	tempo: number
): void {
	// Index bass events by their beat position
	const bassByBeat = new Map<number, BassEvent>();
	for (const e of bassEvents) {
		const ticks = parseInt(e.time);
		const beat = Math.round(ticks / ppq);
		bassByBeat.set(beat, e);
	}

	// Index comp events by their beat position
	const compByBeat = new Map<number, CompEvent>();
	for (const e of compEvents) {
		const ticks = parseInt(e.time);
		const beat = Math.round(ticks / ppq);
		compByBeat.set(beat, e);
	}

	// Index melody notes by beat position
	const melodyByBeat = new Map<number, number>();
	for (const note of phrase.notes) {
		if (note.pitch === null) continue;
		const beat = Math.round(fractionToFloat(note.offset) * 4);
		melodyByBeat.set(beat, note.pitch);
	}

	const segments: BackingTrackSegmentLog[] = [];
	for (const seg of harmony) {
		const startBeat = Math.round(fractionToFloat(seg.startOffset) * 4);
		const durationBeats = Math.round(fractionToFloat(seg.duration) * 4);
		const beats: BackingTrackBeat[] = [];

		for (let b = 0; b < durationBeats; b++) {
			const globalBeat = startBeat + b;
			const beatInBar = globalBeat % beatsPerBar;

			const bassEvent = bassByBeat.get(globalBeat);
			const compEvent = compByBeat.get(globalBeat);

			const drumParts: string[] = [];
			if (beatInBar === 0) drumParts.push('Kick');
			drumParts.push('Ride');
			if (beatInBar === 1 || beatInBar === 3) drumParts.push('HH');

			beats.push({
				beat: globalBeat + 1, // 1-based for display
				bassMidi: bassEvent?.midi ?? -1,
				compMidi: compEvent?.notes ?? null,
				compVelocity: compEvent?.velocity ?? null,
				drumParts,
				melodyMidi: melodyByBeat.get(globalBeat) ?? null
			});
		}

		segments.push({
			chord: chordSymbol(seg.chord.root, seg.chord.quality),
			startBeat: startBeat + 1,
			durationBeats,
			beats
		});
	}

	backingTrackLog.unshift({
		timestamp: Date.now(),
		phraseId: phrase.id,
		phraseName: phrase.name ?? phrase.id,
		key: phrase.key,
		tempo,
		timeSignature: phrase.timeSignature,
		segments
	});

	// Trim and persist
	if (backingTrackLog.length > MAX_LOG_ENTRIES) {
		backingTrackLog.length = MAX_LOG_ENTRIES;
	}
	saveLog(backingTrackLog);
}

// ── Scheduling ───────────────────────────────────────────────

/** Dispose only the scheduled parts (not the instruments). */
export function disposeBackingParts(): void {
	if (bassPart) {
		bassPart.dispose();
		bassPart = null;
	}
	if (compPart) {
		compPart.dispose();
		compPart = null;
	}
	if (drumSequence) {
		drumSequence.dispose();
		drumSequence = null;
	}
	bassInstrument?.stop();
	compInstrument?.stop();
	activeSchedule = null;
}

/** Return the backing track schedule built during the last scheduleBackingTrack() call. */
export function getActiveSchedule(): BackingTrackSchedule | null {
	return activeSchedule;
}

/**
 * Schedule the backing track on the Tone.js Transport.
 *
 * @param phrase - The phrase whose harmony drives the backing track
 * @param options - Playback options (tempo, backing track settings)
 * @param tickOffset - Transport tick offset (e.g. count-in bar)
 * @param loop - If true, backing track loops for recording phase
 * @param isStillCurrent - Optional predicate called after each internal
 *   await.  Returning false short-circuits setup so a superseded
 *   invocation can't install stale `activeSchedule` / Tone.Parts over
 *   a newer phrase's backing.
 */
export async function scheduleBackingTrack(
	phrase: Phrase,
	options: PlaybackOptions,
	tickOffset: number,
	loop: boolean = false,
	isStillCurrent: () => boolean = () => true
): Promise<void> {
	if (!isBackingLoaded()) return;

	const Tone = await getTone();
	if (!isStillCurrent()) return;
	const transport = Tone.getTransport();
	const ppq = transport.PPQ;
	const beatsPerBar = phrase.timeSignature[0];

	const harmony = phrase.harmony.length > 0 ? phrase.harmony : inferTonicChord(phrase);
	const style = BACKING_STYLES[options.backingStyle ?? 'swing'];

	disposeBackingParts();

	// ── Bass + Comp events ──────────────────────────────────
	const bassEvents = generateWalkingBass(harmony, beatsPerBar, options.tempo, ppq);
	const compEvents = generateComping(harmony, beatsPerBar, options.tempo, ppq, style);

	const harmonyDurationBeats = getHarmonyDurationBeats(harmony);
	const harmonyTicks = Math.ceil(harmonyDurationBeats / beatsPerBar) * beatsPerBar * ppq;

	// ── Capture diagnostics log ─────────────────────────────
	captureLog(phrase, harmony, bassEvents, compEvents, beatsPerBar, ppq, options.tempo);

	// ── Build queryable schedule for bleed filter ───────────
	activeSchedule = buildSchedule(bassEvents, compEvents, tickOffset, ppq, options.tempo);

	// Schedule bass — offset events by tickOffset (count-in bar)
	bassPart = new Tone.Part((time: number, event: BassEvent) => {
		bassInstrument?.start({
			note: event.midi,
			velocity: event.velocity,
			duration: event.duration,
			time
		});
	}, bassEvents.map(e => ({
		...e,
		time: `${parseInt(e.time) + tickOffset}i`
	})));
	bassPart.start(0);
	bassPart.loop = loop;
	if (loop) {
		bassPart.loopStart = `${tickOffset}i`;
		bassPart.loopEnd = `${tickOffset + harmonyTicks}i`;
	}

	// Schedule comp — offset events by tickOffset
	compPart = new Tone.Part((time: number, event: CompEvent) => {
		for (const midi of event.notes) {
			compInstrument?.start({
				note: midi,
				velocity: event.velocity,
				duration: event.duration,
				time
			});
		}
	}, compEvents.map(e => ({
		...e,
		time: `${parseInt(e.time) + tickOffset}i`
	})));
	compPart.start(0);
	compPart.loop = loop;
	if (loop) {
		compPart.loopStart = `${tickOffset}i`;
		compPart.loopEnd = `${tickOffset + harmonyTicks}i`;
	}

	// ── Drums ───────────────────────────────────────────────
	await ensureDrums();
	if (!isStillCurrent()) {
		// A newer schedule has taken over — clean up the parts we just
		// created so they don't leak onto the transport.
		disposeBackingParts();
		return;
	}
	setBackingTrackVolume(options.backingTrackVolume ?? 0.5);

	const drumCallback = (time: number, beat: number) => {
		const hits = style.drumPattern(beat, beatsPerBar);
		if (hits.kick) {
			kickSynth!.triggerAttackRelease('C1', '16n', time, hits.kickVelocity ?? 0.5);
		}
		if (hits.ride) {
			rideSynth!.triggerAttackRelease('16n', time, hits.rideVelocity ?? 0.4);
		}
		if (hits.hihat) {
			hihatSynth!.triggerAttackRelease('32n', time, hits.hihatVelocity ?? 0.5);
		}
	};

	const pattern = Array.from({ length: beatsPerBar }, (_, i) => i);

	if (!loop) {
		// Finite: phrase-length beats, aligned with pitched backing
		const phraseBars = Math.ceil(harmonyDurationBeats / beatsPerBar);
		const totalBeats = beatsPerBar * phraseBars;
		const allBeats = Array.from({ length: totalBeats }, (_, i) => i % beatsPerBar);

		drumSequence = new Tone.Sequence(drumCallback, allBeats, '4n');
		drumSequence.start(`${tickOffset}i`);
		drumSequence.loop = false;
	} else {
		drumSequence = new Tone.Sequence(drumCallback, pattern, '4n');
		drumSequence.start(`${tickOffset}i`);
		drumSequence.loop = true;
	}
}

// ── Exported API ─────────────────────────────────────────────

/**
 * Load instruments, schedule patterns, and prepare for playback.
 * Call before Transport.start().
 */
export async function startBackingTrack(
	phrase: Phrase,
	options: PlaybackOptions,
	keepLooping: boolean
): Promise<void> {
	const Tone = await getTone();
	const transport = Tone.getTransport();
	const ppq = transport.PPQ;
	const beatsPerBar = phrase.timeSignature[0];
	const barTicks = beatsPerBar * ppq;

	await loadBackingInstruments(options.backingInstrument);
	await scheduleBackingTrack(phrase, options, barTicks, keepLooping);
}

/** Full cleanup: dispose parts and instruments. */
export function disposeBackingTrack(): void {
	disposeBackingParts();
	if (bassInstrument) {
		bassInstrument.disconnect();
		bassInstrument = null;
	}
	if (compInstrument) {
		compInstrument.disconnect();
		compInstrument = null;
		currentInstrumentType = null;
	}
	if (backingGain) {
		backingGain.disconnect();
		backingGain = null;
	}
}

/** Adjust backing track volume at runtime. */
export function setBackingTrackVolume(volume: number): void {
	const v = Math.max(0, Math.min(1, volume));
	if (backingGain) backingGain.gain.value = v;
	if (drumGainNode) drumGainNode.gain.value = v * 0.6; // drums sit back in the mix
}
