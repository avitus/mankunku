/**
 * Listening-lab progression presets for /diagnostics/backing-mixer.
 *
 * Pure data + builders, Node-testable. Each preset is a melody-less Phrase
 * whose harmony drives the backing engine. The AABA preset carries a
 * sectionMap spanning three choruses because loop mode replays ONE generated
 * pass — section-final setup figures and chorus-to-chorus variation are
 * inaudible on a short loop, so the lab needs them written out in full.
 *
 * Seed control: generation streams are seeded from the phrase id
 * (`seedFrom(phraseId, tempo, role, index)`), so a variation suffix on the
 * id re-rolls every stream with zero engine changes.
 */

import type { Phrase, HarmonicSegment } from '$lib/types/music';

/** Tempi the listening protocol samples: ballad-ish, medium, burner. */
export const LAB_TEMPO_PRESETS = [90, 160, 240] as const;

export interface BackingLabPreset {
	id: string;
	label: string;
	/** One-line description shown in the picker. */
	hint: string;
	phrase: Phrase;
	bars: number;
}

function labPhrase(
	id: string,
	name: string,
	key: Phrase['key'],
	bars: number,
	harmony: HarmonicSegment[],
	sectionMap?: Phrase['sectionMap']
): Phrase {
	return {
		id,
		name,
		timeSignature: [4, 4],
		key,
		notes: [],
		harmony,
		sectionMap,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: bars },
		category: 'user',
		tags: [],
		source: 'generated'
	};
}

/** Shift a section's segments right by `barOffset` bars (4/4: 1 bar = 1 whole note). */
function shiftSegments(segments: HarmonicSegment[], barOffset: number): HarmonicSegment[] {
	return segments.map((seg) => ({
		...seg,
		startOffset: [seg.startOffset[0] + barOffset * seg.startOffset[1], seg.startOffset[1]]
	}));
}

/**
 * Concatenate sections into `choruses` passes of the full form, producing the
 * flattened harmony plus the sectionMap `buildBarInfos` expects: sourceSection
 * counts up within a chorus and restarts at the next one (the restart is what
 * marks a chorus boundary).
 */
export function buildChorusedForm(
	sections: Array<{ harmony: HarmonicSegment[]; bars: number }>,
	choruses: number
): { harmony: HarmonicSegment[]; sectionMap: NonNullable<Phrase['sectionMap']>; bars: number } {
	const harmony: HarmonicSegment[] = [];
	const sectionMap: NonNullable<Phrase['sectionMap']> = [];
	let barOffset = 0;
	for (let chorus = 0; chorus < choruses; chorus++) {
		for (let s = 0; s < sections.length; s++) {
			sectionMap.push({ sourceSection: s, barOffset });
			harmony.push(...shiftSegments(sections[s].harmony, barOffset));
			barOffset += sections[s].bars;
		}
	}
	return { harmony, sectionMap, bars: barOffset };
}

// ── ii-V-I-VI loop (the original mixer loop) ─────────────────

const II_V_I_VI_LOOP: HarmonicSegment[] = [
	{ chord: { root: 'D', quality: 'min7' }, scaleId: 'major.dorian', startOffset: [0, 1], duration: [1, 1] },
	{ chord: { root: 'G', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [1, 1], duration: [1, 1] },
	{ chord: { root: 'C', quality: 'maj7' }, scaleId: 'major.ionian', startOffset: [2, 1], duration: [1, 1] },
	{ chord: { root: 'A', quality: '7b9' }, scaleId: 'harmonic-minor.phrygian-dominant', startOffset: [3, 1], duration: [1, 1] }
];

// ── 12-bar jazz blues in F ───────────────────────────────────

const BLUES_F: HarmonicSegment[] = [
	{ chord: { root: 'F', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [0, 1], duration: [1, 1] },
	{ chord: { root: 'Bb', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [1, 1], duration: [1, 1] },
	{ chord: { root: 'F', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [2, 1], duration: [1, 1] },
	{ chord: { root: 'C', quality: 'min7' }, scaleId: 'major.dorian', startOffset: [3, 1], duration: [1, 2] },
	{ chord: { root: 'F', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [7, 2], duration: [1, 2] },
	{ chord: { root: 'Bb', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [4, 1], duration: [1, 1] },
	{ chord: { root: 'B', quality: 'dim7' }, scaleId: 'harmonic-minor.super-locrian-bb7', startOffset: [5, 1], duration: [1, 1] },
	{ chord: { root: 'F', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [6, 1], duration: [1, 1] },
	{ chord: { root: 'D', quality: '7b9' }, scaleId: 'harmonic-minor.phrygian-dominant', startOffset: [7, 1], duration: [1, 1] },
	{ chord: { root: 'G', quality: 'min7' }, scaleId: 'major.dorian', startOffset: [8, 1], duration: [1, 1] },
	{ chord: { root: 'C', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [9, 1], duration: [1, 1] },
	{ chord: { root: 'F', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [10, 1], duration: [1, 2] },
	{ chord: { root: 'D', quality: '7b9' }, scaleId: 'harmonic-minor.phrygian-dominant', startOffset: [21, 2], duration: [1, 2] },
	{ chord: { root: 'G', quality: 'min7' }, scaleId: 'major.dorian', startOffset: [11, 1], duration: [1, 2] },
	{ chord: { root: 'C', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [23, 2], duration: [1, 2] }
];

// ── Rhythm changes A section in Bb ───────────────────────────

const RHYTHM_A_BB: HarmonicSegment[] = [
	{ chord: { root: 'Bb', quality: 'maj7' }, scaleId: 'major.ionian', startOffset: [0, 1], duration: [1, 2] },
	{ chord: { root: 'G', quality: '7' }, scaleId: 'melodic-minor.mixolydian-b6', startOffset: [1, 2], duration: [1, 2] },
	{ chord: { root: 'C', quality: 'min7' }, scaleId: 'major.dorian', startOffset: [1, 1], duration: [1, 2] },
	{ chord: { root: 'F', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [3, 2], duration: [1, 2] },
	{ chord: { root: 'Bb', quality: 'maj7' }, scaleId: 'major.ionian', startOffset: [2, 1], duration: [1, 2] },
	{ chord: { root: 'G', quality: '7' }, scaleId: 'melodic-minor.mixolydian-b6', startOffset: [5, 2], duration: [1, 2] },
	{ chord: { root: 'C', quality: 'min7' }, scaleId: 'major.dorian', startOffset: [3, 1], duration: [1, 2] },
	{ chord: { root: 'F', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [7, 2], duration: [1, 2] },
	{ chord: { root: 'F', quality: 'min7' }, scaleId: 'major.dorian', startOffset: [4, 1], duration: [1, 2] },
	{ chord: { root: 'Bb', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [9, 2], duration: [1, 2] },
	{ chord: { root: 'Eb', quality: 'maj7' }, scaleId: 'major.ionian', startOffset: [5, 1], duration: [1, 2] },
	{ chord: { root: 'E', quality: 'dim7' }, scaleId: 'harmonic-minor.super-locrian-bb7', startOffset: [11, 2], duration: [1, 2] },
	{ chord: { root: 'C', quality: 'min7' }, scaleId: 'major.dorian', startOffset: [6, 1], duration: [1, 2] },
	{ chord: { root: 'F', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [13, 2], duration: [1, 2] },
	{ chord: { root: 'Bb', quality: 'maj7' }, scaleId: 'major.ionian', startOffset: [7, 1], duration: [1, 2] },
	{ chord: { root: 'G', quality: '7' }, scaleId: 'melodic-minor.mixolydian-b6', startOffset: [15, 2], duration: [1, 2] }
];

// ── 32-bar AABA in C, three choruses ─────────────────────────

const AABA_A: HarmonicSegment[] = [
	{ chord: { root: 'C', quality: 'maj7' }, scaleId: 'major.ionian', startOffset: [0, 1], duration: [1, 1] },
	{ chord: { root: 'D', quality: 'min7' }, scaleId: 'major.dorian', startOffset: [1, 1], duration: [1, 2] },
	{ chord: { root: 'G', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [3, 2], duration: [1, 2] },
	{ chord: { root: 'C', quality: 'maj7' }, scaleId: 'major.ionian', startOffset: [2, 1], duration: [1, 1] },
	{ chord: { root: 'C', quality: 'min7' }, scaleId: 'major.dorian', startOffset: [3, 1], duration: [1, 2] },
	{ chord: { root: 'F', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [7, 2], duration: [1, 2] },
	{ chord: { root: 'F', quality: 'maj7' }, scaleId: 'major.ionian', startOffset: [4, 1], duration: [1, 1] },
	{ chord: { root: 'F', quality: 'min7' }, scaleId: 'major.dorian', startOffset: [5, 1], duration: [1, 2] },
	{ chord: { root: 'Bb', quality: '7' }, scaleId: 'melodic-minor.lydian-dominant', startOffset: [11, 2], duration: [1, 2] },
	{ chord: { root: 'C', quality: 'maj7' }, scaleId: 'major.ionian', startOffset: [6, 1], duration: [1, 2] },
	{ chord: { root: 'A', quality: '7' }, scaleId: 'melodic-minor.mixolydian-b6', startOffset: [13, 2], duration: [1, 2] },
	{ chord: { root: 'D', quality: 'min7' }, scaleId: 'major.dorian', startOffset: [7, 1], duration: [1, 2] },
	{ chord: { root: 'G', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [15, 2], duration: [1, 2] }
];

const AABA_B: HarmonicSegment[] = [
	{ chord: { root: 'E', quality: '7' }, scaleId: 'harmonic-minor.phrygian-dominant', startOffset: [0, 1], duration: [2, 1] },
	{ chord: { root: 'A', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [2, 1], duration: [2, 1] },
	{ chord: { root: 'D', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [4, 1], duration: [2, 1] },
	{ chord: { root: 'D', quality: 'min7' }, scaleId: 'major.dorian', startOffset: [6, 1], duration: [1, 1] },
	{ chord: { root: 'G', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [7, 1], duration: [1, 1] }
];

const AABA_FORM = buildChorusedForm(
	[
		{ harmony: AABA_A, bars: 8 },
		{ harmony: AABA_A, bars: 8 },
		{ harmony: AABA_B, bars: 8 },
		{ harmony: AABA_A, bars: 8 }
	],
	3
);

// ── Preset registry ──────────────────────────────────────────

export const BACKING_LAB_PRESETS: BackingLabPreset[] = [
	{
		id: 'backing-mixer-loop',
		label: 'ii-V-I-VI loop (4 bars)',
		hint: 'Dm7 – G7 – Cmaj7 – A7b9, the original mixer loop',
		phrase: labPhrase('backing-mixer-loop', 'Mixer Loop', 'C', 4, II_V_I_VI_LOOP),
		bars: 4
	},
	{
		id: 'lab-blues-f',
		label: 'Jazz blues in F (12 bars)',
		hint: 'Full jazz blues changes incl. #IVdim and VI7b9',
		phrase: labPhrase('lab-blues-f', 'Lab Blues in F', 'F', 12, BLUES_F),
		bars: 12
	},
	{
		id: 'lab-rhythm-a-bb',
		label: 'Rhythm changes A in Bb (8 bars)',
		hint: 'I-VI-ii-V cycles with the IV / #IVdim bar',
		phrase: labPhrase('lab-rhythm-a-bb', 'Lab Rhythm Changes A', 'Bb', 8, RHYTHM_A_BB),
		bars: 8
	},
	{
		id: 'lab-aaba-c',
		label: 'AABA in C — 3 choruses (96 bars)',
		hint: 'Full form with sectionMap: hears setups, fills and chorus arc',
		phrase: labPhrase('lab-aaba-c', 'Lab AABA 3 Choruses', 'C', AABA_FORM.bars, AABA_FORM.harmony, AABA_FORM.sectionMap),
		bars: AABA_FORM.bars
	}
];

/**
 * Preset phrase with an optional variation seed. Generation seeds derive
 * from the phrase id, so a suffix re-rolls all streams; seed 0 is the
 * canonical id (baseline fixtures and the report use it).
 */
export function labPhraseWithSeed(preset: BackingLabPreset, seed: number): Phrase {
	if (!Number.isInteger(seed) || seed <= 0) return preset.phrase;
	return { ...preset.phrase, id: `${preset.phrase.id}#v${seed}` };
}
