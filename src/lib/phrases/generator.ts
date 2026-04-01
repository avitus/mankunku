/**
 * Algorithmic phrase generator — 5-stage pipeline.
 *
 * 1. Target note selection — chord tones on strong beats
 * 2. Approach patterns — fill between targets
 * 3. Rhythm cell selection — idiomatic jazz rhythms
 * 4. Contour validation — enforce musical constraints
 * 5. Articulation — ghost notes, accents, etc.
 *
 * Uses the scale catalog, chord definitions, and difficulty profiles.
 */

import type {
	Phrase, Note, HarmonicSegment, PitchClass, Fraction,
	PhraseCategory, Articulation
} from '$lib/types/music.ts';
import { PITCH_CLASSES } from '$lib/types/music.ts';
import { getScale } from '$lib/music/scales.ts';
import { chordTones } from '$lib/music/chords.ts';
import { realizeScaleMidi } from '$lib/music/keys.ts';
import { addFractions, fractionToFloat } from '$lib/music/intervals.ts';
import { getProfile, type DifficultyProfile } from '$lib/difficulty/params.ts';
import { validatePhrase, rulesForDifficulty } from './validator.ts';

export interface GeneratorOptions {
	key: PitchClass;
	category: PhraseCategory;
	difficulty: number;
	harmony: HarmonicSegment[];
	bars: number;
	timeSignature?: [number, number];
	rangeHigh?: number;
}

const TENOR_SAX_LOW = 44;
const TENOR_SAX_HIGH = 75;

/** Counter for generating unique IDs */
let idCounter = 0;

/**
 * Generate a phrase using the 5-stage pipeline.
 * Retries up to 5 times if validation fails.
 */
export function generatePhrase(options: GeneratorOptions): Phrase {
	const timeSig: [number, number] = options.timeSignature ?? [4, 4];
	const profile = getProfile(options.difficulty);
	const rules = rulesForDifficulty(options.difficulty);

	for (let attempt = 0; attempt < 5; attempt++) {
		const notes = buildNotes(options, profile, timeSig);
		const phrase: Phrase = {
			id: `gen-${Date.now()}-${idCounter++}`,
			name: `Generated ${options.category}`,
			timeSignature: timeSig,
			key: options.key,
			notes,
			harmony: options.harmony,
			difficulty: {
				level: options.difficulty,
				pitchComplexity: options.difficulty,
				rhythmComplexity: Math.min(options.difficulty, 80),
				lengthBars: options.bars
			},
			category: options.category,
			tags: ['generated'],
			source: 'generated'
		};

		const mergedRules = options.rangeHigh != null
			? { ...rules, range: [TENOR_SAX_LOW, options.rangeHigh] as [number, number] }
			: rules;
		const result = validatePhrase(phrase, mergedRules);
		if (result.valid) return phrase;
	}

	// Fallback: generate a simple scale fragment
	return generateScaleFragment(options, timeSig);
}

/**
 * Build notes through the 5-stage pipeline.
 */
function buildNotes(
	options: GeneratorOptions,
	profile: DifficultyProfile,
	timeSig: [number, number]
): Note[] {
	// Stage 1: Target notes on strong beats
	const targets = selectTargets(options, profile, timeSig);

	// Stage 2: Fill between targets with approach patterns
	const filled = fillApproaches(targets, options, profile);

	// Stage 3: Apply rhythm cells
	const rhythmed = applyRhythm(filled, profile, timeSig, options.bars);

	// Stage 5: Add articulation
	return addArticulation(rhythmed, profile);
}

// ─── Stage 1: Target Note Selection ─────────────────────────

interface TargetNote {
	midi: number;
	beatPosition: number; // in quarter notes from phrase start
	isStrong: boolean;
}

function selectTargets(
	options: GeneratorOptions,
	profile: DifficultyProfile,
	timeSig: [number, number]
): TargetNote[] {
	const beatsPerBar = timeSig[0];
	const totalBeats = beatsPerBar * options.bars;
	const targets: TargetNote[] = [];

	const rootMidi = PITCH_CLASSES.indexOf(options.key) + 60; // middle octave

	for (let beat = 0; beat < totalBeats; beat += 2) {
		// Find the active harmony at this beat
		const segment = findHarmonyAt(options.harmony, beat / (beatsPerBar * 4));
		if (!segment) continue;

		const chordRoot = PITCH_CLASSES.indexOf(segment.chord.root) + 60;
		const tones = chordTones(chordRoot, segment.chord.quality);

		// Pick a chord tone, voice-led from previous target
		const prev = targets.length > 0 ? targets[targets.length - 1].midi : rootMidi;
		const tone = pickClosest(tones, prev, TENOR_SAX_LOW, options.rangeHigh ?? TENOR_SAX_HIGH);

		targets.push({
			midi: tone,
			beatPosition: beat,
			isStrong: beat % beatsPerBar === 0
		});
	}

	// Ensure at least one target
	if (targets.length === 0) {
		targets.push({ midi: rootMidi, beatPosition: 0, isStrong: true });
	}

	return targets;
}

function findHarmonyAt(harmony: HarmonicSegment[], wholeNotePosition: number): HarmonicSegment | null {
	for (const seg of harmony) {
		const start = fractionToFloat(seg.startOffset);
		const end = start + fractionToFloat(seg.duration);
		if (wholeNotePosition >= start && wholeNotePosition < end) return seg;
	}
	return harmony[harmony.length - 1] ?? null;
}

function pickClosest(candidates: number[], target: number, low: number, high: number): number {
	let best = candidates[0];
	let bestDist = Infinity;

	for (const c of candidates) {
		// Check in multiple octaves
		for (let oct = -2; oct <= 2; oct++) {
			const note = c + oct * 12;
			if (note < low || note > high) continue;
			const dist = Math.abs(note - target);
			if (dist < bestDist) {
				bestDist = dist;
				best = note;
			}
		}
	}

	return best;
}

// ─── Stage 2: Approach Patterns ─────────────────────────────

interface PitchedBeat {
	midi: number;
	beatPosition: number;
	isTarget: boolean;
}

function fillApproaches(
	targets: TargetNote[],
	options: GeneratorOptions,
	profile: DifficultyProfile
): PitchedBeat[] {
	const result: PitchedBeat[] = [];

	for (let i = 0; i < targets.length; i++) {
		const target = targets[i];
		const prev = i > 0 ? targets[i - 1] : null;

		if (prev && target.beatPosition - prev.beatPosition >= 2) {
			// Fill between previous target and this one
			const fill = generateFill(prev.midi, target.midi, options, profile);
			// Place fill notes on the beats between
			const gap = target.beatPosition - prev.beatPosition;
			for (let j = 0; j < fill.length; j++) {
				const beatPos = prev.beatPosition + ((j + 1) * gap) / (fill.length + 1);
				result.push({ midi: fill[j], beatPosition: beatPos, isTarget: false });
			}
		}

		result.push({ midi: target.midi, beatPosition: target.beatPosition, isTarget: true });
	}

	return result;
}

function generateFill(
	from: number,
	to: number,
	options: GeneratorOptions,
	profile: DifficultyProfile
): number[] {
	const segment = options.harmony[0];
	if (!segment) return [];

	const scale = getScale(segment.scaleId);
	if (!scale) return [];

	const scaleMidi = realizeScaleMidi(options.key, scale.intervals, TENOR_SAX_LOW, options.rangeHigh ?? TENOR_SAX_HIGH);
	const direction = to > from ? 1 : -1;

	// Decide fill type based on difficulty
	const r = Math.random();

	if (profile.level <= 3 || r < 0.5) {
		// Scale run between notes
		return scaleRun(from, to, scaleMidi);
	} else if (r < 0.8) {
		// Chromatic approach (last 1-2 notes approach target chromatically)
		const approach: number[] = [];
		if (Math.abs(to - from) > 2) {
			approach.push(to - direction); // chromatic note below/above target
		}
		return approach;
	} else {
		// Arpeggio fill
		return arpeggioFill(from, to, options);
	}
}

function scaleRun(from: number, to: number, scaleMidi: number[]): number[] {
	if (scaleMidi.length === 0) return [];

	const direction = to > from ? 1 : -1;
	const result: number[] = [];
	const sorted = direction > 0
		? scaleMidi.filter((n) => n > from && n < to)
		: scaleMidi.filter((n) => n < from && n > to).reverse();

	// Limit fill length
	const maxFill = Math.min(sorted.length, 4);
	for (let i = 0; i < maxFill; i++) {
		result.push(sorted[direction > 0 ? i : sorted.length - 1 - i]);
	}

	return result;
}

function arpeggioFill(from: number, to: number, options: GeneratorOptions): number[] {
	const segment = options.harmony[0];
	if (!segment) return [];

	const chordRoot = PITCH_CLASSES.indexOf(segment.chord.root) + 60;
	const tones = chordTones(chordRoot, segment.chord.quality);

	// Get chord tones between from and to
	const direction = to > from ? 1 : -1;
	const result: number[] = [];

	for (let oct = -1; oct <= 1; oct++) {
		for (const t of tones) {
			const note = t + oct * 12;
			if (direction > 0 && note > from && note < to) result.push(note);
			if (direction < 0 && note < from && note > to) result.push(note);
		}
	}

	result.sort((a, b) => direction * (a - b));
	return result.slice(0, 3);
}

// ─── Stage 3: Rhythm Cell Selection ─────────────────────────

function applyRhythm(
	pitched: PitchedBeat[],
	profile: DifficultyProfile,
	timeSig: [number, number],
	bars: number
): Note[] {
	const notes: Note[] = [];
	const hasEighths = profile.rhythmTypes.includes('eighth');
	const hasTriplets = profile.rhythmTypes.includes('triplet');
	const hasSixteenths = profile.rhythmTypes.includes('sixteenth');

	for (let i = 0; i < pitched.length; i++) {
		const beat = pitched[i];
		const nextBeat = i < pitched.length - 1
			? pitched[i + 1].beatPosition
			: bars * timeSig[0];

		const gapBeats = nextBeat - beat.beatPosition;

		// Convert beat position to fraction of whole note
		const offset = beatToFraction(beat.beatPosition);

		// Choose duration based on available rhythm types and gap
		let duration: Fraction;

		if (i === pitched.length - 1) {
			// Last note: hold longer
			duration = gapBeats >= 4 ? [1, 1] : gapBeats >= 2 ? [1, 2] : [1, 4];
		} else if (gapBeats >= 2) {
			duration = [1, 4]; // quarter note
		} else if (gapBeats >= 1 && hasEighths) {
			duration = [1, 8]; // eighth note
		} else if (hasTriplets && Math.random() < 0.2) {
			duration = [1, 12]; // triplet eighth
		} else if (hasSixteenths && gapBeats >= 0.5) {
			duration = [1, 16]; // sixteenth
		} else {
			duration = [1, 8];
		}

		notes.push({
			pitch: beat.midi,
			duration,
			offset,
			velocity: beat.isTarget ? 100 : 80
		});
	}

	return notes;
}

function beatToFraction(beat: number): Fraction {
	// Convert quarter-note beats to whole-note fraction
	// beat 0 = [0, 1], beat 1 = [1, 4], beat 2 = [1, 2], etc.
	if (beat === 0) return [0, 1];

	// Use 16ths as smallest denomination
	const sixteenths = Math.round(beat * 4);
	const gcd = getGcd(sixteenths, 16);
	return [sixteenths / gcd, 16 / gcd];
}

function getGcd(a: number, b: number): number {
	a = Math.abs(a);
	b = Math.abs(b);
	while (b) { [a, b] = [b, a % b]; }
	return a;
}

// ─── Stage 5: Articulation ──────────────────────────────────

function addArticulation(notes: Note[], profile: DifficultyProfile): Note[] {
	if (profile.level < 4) return notes; // no articulation at low levels

	return notes.map((n, i) => {
		if (n.pitch === null) return n;

		let articulation: Articulation = 'normal';

		// Accent target notes (those with higher velocity)
		if (n.velocity && n.velocity >= 100 && Math.random() < 0.3) {
			articulation = 'accent';
		}

		// Ghost notes on weak-beat passing tones
		if (n.velocity && n.velocity < 90 && Math.random() < 0.2) {
			articulation = 'ghost';
		}

		// Legato on consecutive stepwise motion
		if (i > 0 && notes[i - 1].pitch !== null) {
			const interval = Math.abs(n.pitch! - notes[i - 1].pitch!);
			if (interval <= 2 && Math.random() < 0.3) {
				articulation = 'legato';
			}
		}

		return articulation !== 'normal' ? { ...n, articulation } : n;
	});
}

// ─── Fallback: Simple Scale Fragment ────────────────────────

function generateScaleFragment(
	options: GeneratorOptions,
	timeSig: [number, number]
): Phrase {
	const segment = options.harmony[0];
	const scaleId = segment?.scaleId ?? 'major.ionian';
	const scale = getScale(scaleId);
	const intervals = scale?.intervals ?? [2, 2, 1, 2, 2, 2, 1];

	const scaleMidi = realizeScaleMidi(options.key, intervals, TENOR_SAX_LOW, options.rangeHigh ?? TENOR_SAX_HIGH);
	const rootMidi = PITCH_CLASSES.indexOf(options.key) + 60;

	// Find the root in the scale
	const rootIdx = scaleMidi.indexOf(rootMidi);
	const start = rootIdx >= 0 ? rootIdx : 0;

	const beatsPerBar = timeSig[0];
	const totalBeats = beatsPerBar * options.bars;
	const noteCount = Math.min(totalBeats, scaleMidi.length - start);

	const notes: Note[] = [];
	for (let i = 0; i < noteCount; i++) {
		const idx = start + (i < noteCount / 2 ? i : noteCount - 1 - i);
		notes.push({
			pitch: scaleMidi[Math.min(idx, scaleMidi.length - 1)],
			duration: [1, 4],
			offset: beatToFraction(i)
		});
	}

	return {
		id: `gen-${Date.now()}-${idCounter++}`,
		name: `Scale Fragment in ${options.key}`,
		timeSignature: timeSig,
		key: options.key,
		notes,
		harmony: options.harmony,
		difficulty: {
			level: options.difficulty,
			pitchComplexity: 5,
			rhythmComplexity: 5,
			lengthBars: options.bars
		},
		category: options.category,
		tags: ['generated', 'scale-fragment'],
		source: 'generated'
	};
}

// ─── Convenience: Generate with default harmony ─────────────

/**
 * Common harmonic templates for generating phrases.
 */
export function getDefaultHarmony(
	category: PhraseCategory,
	key: PitchClass
): HarmonicSegment[] {
	const rootIdx = PITCH_CLASSES.indexOf(key);
	const pc = (offset: number) => PITCH_CLASSES[(rootIdx + offset) % 12];

	switch (category) {
		case 'ii-V-I-major':
			return [
				{
					chord: { root: pc(2), quality: 'min7' },
					scaleId: 'major.dorian',
					startOffset: [0, 1], duration: [1, 1]
				},
				{
					chord: { root: pc(7), quality: '7' },
					scaleId: 'major.mixolydian',
					startOffset: [1, 1], duration: [1, 1]
				},
				{
					chord: { root: key, quality: 'maj7' },
					scaleId: 'major.ionian',
					startOffset: [2, 1], duration: [1, 1]
				}
			];
		case 'ii-V-I-minor':
			return [
				{
					chord: { root: pc(2), quality: 'min7b5' },
					scaleId: 'melodic-minor.locrian-nat2',
					startOffset: [0, 1], duration: [1, 1]
				},
				{
					chord: { root: pc(7), quality: '7alt' },
					scaleId: 'melodic-minor.altered',
					startOffset: [1, 1], duration: [1, 1]
				},
				{
					chord: { root: key, quality: 'min7' },
					scaleId: 'major.aeolian',
					startOffset: [2, 1], duration: [1, 1]
				}
			];
		case 'blues':
			return [
				{
					chord: { root: key, quality: '7' },
					scaleId: 'blues.minor',
					startOffset: [0, 1], duration: [2, 1]
				}
			];
		case 'bebop-lines':
			return [
				{
					chord: { root: key, quality: 'maj7' },
					scaleId: 'major.ionian',
					startOffset: [0, 1], duration: [2, 1]
				}
			];
		default:
			return [
				{
					chord: { root: key, quality: 'maj7' },
					scaleId: 'major.ionian',
					startOffset: [0, 1], duration: [2, 1]
				}
			];
	}
}
