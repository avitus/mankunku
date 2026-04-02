/**
 * Jazz backing track module.
 *
 * Generates and schedules piano/organ comping, walking bass, and a drum
 * pattern synchronized to phrase harmony via the Tone.js Transport.
 * Module structure mirrors metronome.ts.
 */

import type { Phrase, HarmonicSegment, PitchClass, ChordQuality } from '$lib/types/music.ts';
import type { PlaybackOptions } from '$lib/types/audio.ts';
import type { BackingInstrument } from '$lib/types/instruments.ts';
import { PITCH_CLASSES } from '$lib/types/music.ts';
import { fractionToFloat } from '$lib/music/intervals.ts';
import { getMasterGain, getAudioContext } from './audio-context.ts';

type ToneModule = typeof import('tone');
type SmplrSoundfont = import('smplr').Soundfont;

// ── Module-level state ───────────────────────────────────────

let tone: ToneModule | null = null;

// Pitched instruments (loaded lazily via smplr Soundfont)
let compInstrument: SmplrSoundfont | null = null;
let bassInstrument: SmplrSoundfont | null = null;
let currentInstrumentType: BackingInstrument | null = null;

// Gain nodes for independent volume control
let compGainNode: GainNode | null = null;
let bassGainNode: GainNode | null = null;

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

async function loadBackingInstruments(instrumentType: BackingInstrument): Promise<void> {
	const audioCtx = await getAudioContext();
	const { Soundfont } = await import('smplr');
	const master = getMasterGain();

	// Create gain nodes if needed
	if (!compGainNode) {
		compGainNode = audioCtx.createGain();
		compGainNode.connect(master);
	}
	if (!bassGainNode) {
		bassGainNode = audioCtx.createGain();
		bassGainNode.connect(master);
	}

	// Reload comp instrument only when type changes
	if (currentInstrumentType !== instrumentType) {
		if (compInstrument) {
			compInstrument.stop();
			compInstrument.disconnect();
		}
		compInstrument = new Soundfont(audioCtx, {
			instrument: COMP_INSTRUMENT_NAMES[instrumentType],
			kit: 'MusyngKite',
			destination: compGainNode
		});
		await compInstrument.load;
		currentInstrumentType = instrumentType;
	}

	// Load bass once
	if (!bassInstrument) {
		bassInstrument = new Soundfont(audioCtx, {
			instrument: 'acoustic_bass',
			kit: 'MusyngKite',
			destination: bassGainNode
		});
		await bassInstrument.load;
	}
}

// ── Helpers ──────────────────────────────────────────────────

/** Convert a PitchClass + octave to a MIDI note number. */
function pitchClassToMidi(root: PitchClass, octave: number): number {
	return PITCH_CLASSES.indexOf(root) + (octave + 1) * 12;
}

/** Interval (in semitones) from root to the 3rd for a given chord quality. */
function thirdInterval(quality: ChordQuality): number {
	switch (quality) {
		case 'min7':
		case 'min7b5':
		case 'dim7':
		case 'min6':
		case 'minMaj7':
			return 3;
		default:
			return 4;
	}
}

/** Interval (in semitones) from root to the 7th for a given chord quality. */
function seventhInterval(quality: ChordQuality): number {
	switch (quality) {
		case 'maj7':
		case 'minMaj7':
			return 11;
		case 'dim7':
			return 9;
		case 'maj6':
		case 'min6':
			return 9; // 6th instead of 7th
		default:
			return 10; // dominant / minor 7th
	}
}

/**
 * Generate a shell voicing for a chord segment.
 * Returns MIDI note numbers: root (octave 3) + 3rd + 7th in mid register.
 */
function generatePianoVoicing(segment: HarmonicSegment): number[] {
	const root = pitchClassToMidi(segment.chord.root, 3);
	const third = root + thirdInterval(segment.chord.quality);
	const seventh = root + seventhInterval(segment.chord.quality);
	return [root, third, seventh];
}

interface BassEvent {
	time: string;
	midi: number;
	duration: number;
}

/**
 * Generate bass notes for a harmonic segment.
 * Root on beat 1 of the segment, fifth on beat 3 (if segment is long enough).
 */
function generateBassNotes(
	segment: HarmonicSegment,
	segStartTick: number,
	beatsPerBar: number,
	ppq: number,
	tempo: number
): BassEvent[] {
	const rootMidi = pitchClassToMidi(segment.chord.root, 2);
	const fifthMidi = rootMidi + 7;
	const halfNoteSec = 2 * (60 / tempo);
	const segDurationBeats = fractionToFloat(segment.duration) * 4;

	const events: BassEvent[] = [
		{ time: `${segStartTick}i`, midi: rootMidi, duration: halfNoteSec }
	];

	// Add fifth on beat 3 if segment spans at least 3 beats
	if (segDurationBeats >= beatsPerBar / 2 + 1) {
		const fifthTick = segStartTick + Math.round((beatsPerBar / 2) * ppq);
		events.push({ time: `${fifthTick}i`, midi: fifthMidi, duration: halfNoteSec });
	}

	return events;
}

interface CompEvent {
	time: string;
	notes: number[];
	duration: number;
}

/**
 * Generate comp (chord) events for a harmonic segment.
 * Places the voicing at the segment start.
 */
function generateCompEvents(
	segment: HarmonicSegment,
	segStartTick: number,
	tempo: number
): CompEvent[] {
	const voicing = generatePianoVoicing(segment);
	const durationBeats = fractionToFloat(segment.duration) * 4;
	const durationSec = durationBeats * (60 / tempo);

	return [{ time: `${segStartTick}i`, notes: voicing, duration: durationSec }];
}

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
	const wholeNotes = Math.ceil(maxEndBeat / 4);
	return [
		{
			chord: { root: phrase.key, quality: 'maj7' },
			scaleId: 'major.ionian',
			startOffset: [0, 1],
			duration: [wholeNotes, 1]
		}
	];
}

// ── Scheduling ───────────────────────────────────────────────

function disposeParts(): void {
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
}

async function scheduleBackingTrack(
	phrase: Phrase,
	options: PlaybackOptions,
	barTicks: number,
	bars: number | null
): Promise<void> {
	const Tone = await getTone();
	const transport = Tone.getTransport();
	const ppq = transport.PPQ;
	const beatsPerBar = phrase.timeSignature[0];

	const harmony = phrase.harmony.length > 0 ? phrase.harmony : inferTonicChord(phrase);

	// ── Bass + Comp events ──────────────────────────────────
	const allBassEvents: BassEvent[] = [];
	const allCompEvents: CompEvent[] = [];

	for (const seg of harmony) {
		const segOffsetTicks = Math.round(fractionToFloat(seg.startOffset) * 4 * ppq);
		const segStartTick = barTicks + segOffsetTicks;

		allBassEvents.push(...generateBassNotes(seg, segStartTick, beatsPerBar, ppq, options.tempo));
		allCompEvents.push(...generateCompEvents(seg, segStartTick, options.tempo));
	}

	// Schedule bass
	bassPart = new Tone.Part((time, event: BassEvent) => {
		bassInstrument?.start({ note: event.midi, velocity: 90, duration: event.duration, time });
	}, allBassEvents);
	bassPart.start(0);
	bassPart.loop = false;

	// Schedule comp
	compPart = new Tone.Part((time, event: CompEvent) => {
		for (const midi of event.notes) {
			compInstrument?.start({ note: midi, velocity: 70, duration: event.duration, time });
		}
	}, allCompEvents);
	compPart.start(0);
	compPart.loop = false;

	// If looping, set up Part looping over the phrase duration
	if (bars === null) {
		// Calculate phrase duration in ticks for loop length
		let maxEndBeat = 0;
		for (const note of phrase.notes) {
			const start = fractionToFloat(note.offset) * 4;
			const dur = fractionToFloat(note.duration) * 4;
			maxEndBeat = Math.max(maxEndBeat, start + dur);
		}
		const phraseTicks = Math.ceil(maxEndBeat / beatsPerBar) * beatsPerBar * ppq;
		const loopEnd = barTicks + phraseTicks;

		bassPart.loop = true;
		bassPart.loopStart = `${barTicks}i`;
		bassPart.loopEnd = `${loopEnd}i`;

		compPart.loop = true;
		compPart.loopStart = `${barTicks}i`;
		compPart.loopEnd = `${loopEnd}i`;
	}

	// ── Drums ───────────────────────────────────────────────
	const pattern = Array.from({ length: beatsPerBar }, (_, i) => i);

	if (bars !== null) {
		const totalBeats = beatsPerBar * bars;
		const allBeats = Array.from({ length: totalBeats }, (_, i) => i % beatsPerBar);

		drumSequence = new Tone.Sequence(
			(time, beat) => {
				if (beat === 0) {
					kickSynth!.triggerAttackRelease('C1', '16n', time, 0.5);
				}
				rideSynth!.triggerAttackRelease('16n', time, 0.4);
				if (beat === 1 || beat === 3) {
					hihatSynth!.triggerAttackRelease('32n', time, 0.5);
				}
			},
			allBeats,
			'4n'
		);
		drumSequence.start(0);
		drumSequence.loop = false;
	} else {
		drumSequence = new Tone.Sequence(
			(time, beat) => {
				if (beat === 0) {
					kickSynth!.triggerAttackRelease('C1', '16n', time, 0.5);
				}
				rideSynth!.triggerAttackRelease('16n', time, 0.4);
				if (beat === 1 || beat === 3) {
					hihatSynth!.triggerAttackRelease('32n', time, 0.5);
				}
			},
			pattern,
			'4n'
		);
		drumSequence.start(0);
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

	await loadBackingInstruments(options.backingInstrument);
	await ensureDrums();

	// Set volumes
	setBackingTrackVolume(options.backingTrackVolume);

	// Dispose previous parts
	disposeParts();

	const barTicks = beatsPerBar * ppq;

	if (keepLooping) {
		await scheduleBackingTrack(phrase, options, barTicks, null);
	} else {
		// Calculate phrase bars (same logic as playback.ts getPhraseBars)
		let maxEndBeat = 0;
		for (const note of phrase.notes) {
			const start = fractionToFloat(note.offset) * 4;
			const dur = fractionToFloat(note.duration) * 4;
			maxEndBeat = Math.max(maxEndBeat, start + dur);
		}
		const phraseBars = Math.ceil(maxEndBeat / beatsPerBar);
		await scheduleBackingTrack(phrase, options, barTicks, phraseBars + 1);
	}
}

/** Stop and dispose all backing track Parts/Sequences. */
export function disposeBackingTrack(): void {
	disposeParts();
	// Stop ringing notes on instruments
	compInstrument?.stop();
	bassInstrument?.stop();
}

/** Adjust backing track volume at runtime. */
export function setBackingTrackVolume(volume: number): void {
	const v = Math.max(0, Math.min(1, volume));
	if (compGainNode) compGainNode.gain.value = v;
	if (bassGainNode) bassGainNode.gain.value = v;
	if (drumGainNode) drumGainNode.gain.value = v * 0.6; // drums sit back in the mix
}
