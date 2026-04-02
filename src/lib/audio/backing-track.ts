/**
 * Jazz backing track engine.
 *
 * Generates and schedules walking bass lines and piano/organ comping
 * from a phrase's HarmonicSegment data. Uses the same Tone.js Transport
 * and smplr SoundFont loading as the melody playback engine.
 *
 * Instruments:
 * - Upright bass (acoustic_bass GM SoundFont)
 * - Piano or organ (acoustic_grand_piano / drawbar_organ, configurable)
 *
 * Both route through a dedicated gain node → master gain for volume control.
 */

import type { Phrase, HarmonicSegment } from '$lib/types/music.ts';
import type { PlaybackOptions } from '$lib/types/audio.ts';
import { fractionToFloat } from '$lib/music/intervals.ts';
import { initAudio, getMasterGain } from './audio-context.ts';
import { pitchClassToNumber, shellVoicing, voiceLead } from './voicings.ts';

type ToneModule = typeof import('tone');
type SmplrSoundfont = import('smplr').Soundfont;

let tone: ToneModule | null = null;
let bassInstrument: SmplrSoundfont | null = null;
let chordInstrument: SmplrSoundfont | null = null;
let loadedChordType: 'piano' | 'organ' | null = null;
let backingGain: GainNode | null = null;
/* eslint-disable @typescript-eslint/no-explicit-any */
let bassPart: any = null;
let compPart: any = null;
/* eslint-enable @typescript-eslint/no-explicit-any */
let currentLoadId = 0;

async function getTone(): Promise<ToneModule> {
	if (!tone) tone = await import('tone');
	return tone;
}

const GM_CHORD_INSTRUMENTS: Record<string, string> = {
	piano: 'acoustic_grand_piano',
	organ: 'drawbar_organ'
};

/**
 * Load backing track instruments (bass + chord instrument).
 * Idempotent for the same chord instrument type.
 */
export async function loadBackingInstruments(
	chordType: 'piano' | 'organ' = 'piano'
): Promise<void> {
	const loadId = ++currentLoadId;
	const audioCtx = await initAudio();
	if (loadId !== currentLoadId) return;

	// Create gain node if needed
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
		await bass.loaded();
		if (loadId !== currentLoadId) {
			bass.disconnect();
			return;
		}
		bassInstrument = bass;
	}

	// Load chord instrument if type changed or not loaded
	if (!chordInstrument || loadedChordType !== chordType) {
		if (chordInstrument) {
			chordInstrument.disconnect();
			chordInstrument = null;
		}
		const gmName = GM_CHORD_INSTRUMENTS[chordType] ?? 'acoustic_grand_piano';
		const chord = new Soundfont(audioCtx, {
			instrument: gmName,
			kit: 'MusyngKite',
			destination: backingGain
		});
		await chord.loaded();
		if (loadId !== currentLoadId) {
			chord.disconnect();
			return;
		}
		chordInstrument = chord;
		loadedChordType = chordType;
	}
}

/** Check if backing instruments are loaded and ready */
export function isBackingLoaded(): boolean {
	return bassInstrument !== null && chordInstrument !== null;
}

/** Set backing track volume (0-1) */
export function setBackingVolume(volume: number): void {
	if (backingGain) {
		backingGain.gain.value = Math.max(0, Math.min(1, volume));
	}
}

/**
 * Generate walking bass notes for a chord segment.
 * Returns MIDI note + timing events for quarter-note walking bass.
 *
 * Uses: root, 5th, chord tones, chromatic approach notes to next root.
 */
function generateWalkingBass(
	harmony: HarmonicSegment[],
	beatsPerBar: number,
	tempo: number,
	ppq: number
): Array<{ time: string; midi: number; duration: number; velocity: number }> {
	const events: Array<{ time: string; midi: number; duration: number; velocity: number }> = [];
	const BASS_REGISTER = 40; // E2 — center of upright bass range
	const beatDuration = 60 / tempo;

	for (let segIdx = 0; segIdx < harmony.length; segIdx++) {
		const seg = harmony[segIdx];
		const rootPc = pitchClassToNumber(seg.chord.root);
		const rootMidi = nearestBassNote(rootPc, BASS_REGISTER);

		const segStartBeats = fractionToFloat(seg.startOffset) * 4;
		const segDurationBeats = fractionToFloat(seg.duration) * 4;
		const totalBeats = Math.round(segDurationBeats);

		// Determine next segment's root for approach notes
		const nextSeg = harmony[(segIdx + 1) % harmony.length];
		const nextRootPc = pitchClassToNumber(nextSeg.chord.root);
		const nextRootMidi = nearestBassNote(nextRootPc, BASS_REGISTER);

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
				// Beat 2: 3rd or 5th of chord
				midi = chordToneForBass(rootPc, seg.chord.quality, BASS_REGISTER, 1);
			} else {
				// Beat 3+: 5th, passing tone, or scalar movement
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

/**
 * Generate comping events (piano/organ) for the chord progression.
 * Classic jazz comping: hits primarily on beats 2 and 4 with
 * occasional rhythmic variations.
 */
function generateComping(
	harmony: HarmonicSegment[],
	beatsPerBar: number,
	tempo: number,
	ppq: number
): Array<{ time: string; notes: number[]; duration: number; velocity: number }> {
	const events: Array<{ time: string; notes: number[]; duration: number; velocity: number }> = [];
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
			// Comp on beats 2 and 4 (indices 1 and 3 in 0-based)
			const isCompBeat = beatInBar === 1 || beatInBar === 3;
			// Occasional extra hit on the "and" of 1 or 3 for variety (~25% chance)
			const extraHit = (beatInBar === 0 || beatInBar === 2) && Math.random() < 0.25;

			if (!isCompBeat && !extraHit) continue;

			const beatOffset = segStartBeats + beat;
			const ticks = Math.round(beatOffset * ppq);

			// Staccato on 2 & 4, slightly longer on extra hits
			const noteDuration = isCompBeat ? beatDuration * 0.4 : beatDuration * 0.6;
			const velocity = isCompBeat ? 60 + Math.round(Math.random() * 10) : 50;

			events.push({
				time: `${humanizeBeatTicks(ticks, ppq, tempo)}i`,
				notes: voicing,
				duration: noteDuration,
				velocity
			});
		}
	}

	return events;
}

/**
 * Schedule the backing track on the Tone.js Transport.
 *
 * @param phrase - The phrase whose harmony drives the backing track
 * @param options - Playback options (tempo, backing track settings)
 * @param tickOffset - Transport tick offset (e.g. count-in bar)
 * @param loop - If true, backing track loops for recording phase
 */
export async function scheduleBackingTrack(
	phrase: Phrase,
	options: PlaybackOptions,
	tickOffset: number,
	loop: boolean = false
): Promise<void> {
	if (!isBackingLoaded() || !phrase.harmony || phrase.harmony.length === 0) return;

	const Tone = await getTone();
	const transport = Tone.getTransport();
	const ppq = transport.PPQ;
	const beatsPerBar = phrase.timeSignature[0];

	setBackingVolume(options.backingTrackVolume);

	// Generate events
	const bassEvents = generateWalkingBass(phrase.harmony, beatsPerBar, options.tempo, ppq);
	const compEvents = generateComping(phrase.harmony, beatsPerBar, options.tempo, ppq);

	// Dispose previous parts
	disposeBackingParts();

	const phraseDurationBeats = getHarmonyDurationBeats(phrase.harmony);

	// Schedule bass — offset by tickOffset (count-in bar)
	const newBassPart = new Tone.Part((time: number, event: { midi: number; velocity: number; duration: number }) => {
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
	newBassPart.start(0);
	newBassPart.loop = loop;
	if (loop) {
		newBassPart.loopEnd = `${Math.round(phraseDurationBeats * ppq)}i`;
	}
	bassPart = newBassPart;

	// Schedule comping — offset by tickOffset
	const newCompPart = new Tone.Part((time: number, event: { notes: number[]; velocity: number; duration: number }) => {
		for (const midi of event.notes) {
			chordInstrument?.start({
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
	newCompPart.start(0);
	newCompPart.loop = loop;
	if (loop) {
		newCompPart.loopEnd = `${Math.round(phraseDurationBeats * ppq)}i`;
	}
	compPart = newCompPart;
}

/** Dispose only the scheduled parts (not the instruments) */
export function disposeBackingParts(): void {
	if (bassPart) {
		bassPart.dispose();
		bassPart = null;
	}
	if (compPart) {
		compPart.dispose();
		compPart = null;
	}
	bassInstrument?.stop();
	chordInstrument?.stop();
}

/** Full cleanup: dispose parts and instruments */
export function disposeBackingTrack(): void {
	disposeBackingParts();
	if (bassInstrument) {
		bassInstrument.disconnect();
		bassInstrument = null;
	}
	if (chordInstrument) {
		chordInstrument.disconnect();
		chordInstrument = null;
		loadedChordType = null;
	}
	if (backingGain) {
		backingGain.disconnect();
		backingGain = null;
	}
}

// ─── Helpers ──────────────────────────────────────────────

/** Get total harmony duration in quarter-note beats */
function getHarmonyDurationBeats(harmony: HarmonicSegment[]): number {
	let maxEnd = 0;
	for (const seg of harmony) {
		const start = fractionToFloat(seg.startOffset) * 4;
		const dur = fractionToFloat(seg.duration) * 4;
		maxEnd = Math.max(maxEnd, start + dur);
	}
	return maxEnd;
}

/** Find nearest bass-register MIDI note for a pitch class */
function nearestBassNote(pc: number, center: number): number {
	const centerPc = ((center % 12) + 12) % 12;
	let midi = center + ((pc - centerPc + 6 + 12) % 12 - 6);
	// Clamp to reasonable bass range (E1=28 to G3=55)
	if (midi < 28) midi += 12;
	if (midi > 55) midi -= 12;
	return midi;
}

/** Pick a chord tone for bass on a given beat index */
function chordToneForBass(rootPc: number, quality: string, center: number, beatIndex: number): number {
	// Common chord tones: root, 3rd, 5th
	const offsets = beatIndex % 2 === 1 ? [7, 4, 3] : [5, 7, 3]; // 5th preferred on even beats, 3rd on odd
	const offset = offsets[beatIndex % offsets.length];
	const pc = (rootPc + offset) % 12;
	return nearestBassNote(pc, center);
}

/** Chromatic approach note (half step below or above target) */
function approachNote(targetMidi: number): number {
	return Math.random() < 0.6 ? targetMidi - 1 : targetMidi + 1;
}

/** Subtle timing humanization for backing track (less than melody) */
function humanizeBeatTicks(ticks: number, ppq: number, tempo: number): number {
	const baseMs = 3; // Tighter than melody humanization
	const tempoScale = 120 / tempo;
	const maxDeviationMs = baseMs * tempoScale;
	const msPerTick = (60 / tempo / ppq) * 1000;
	const maxDeviationTicks = Math.round(maxDeviationMs / msPerTick);
	const deviation = (Math.random() - 0.5) * 2 * maxDeviationTicks;
	return Math.max(0, Math.round(ticks + deviation));
}
