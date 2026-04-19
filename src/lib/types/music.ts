/** Pitch classes in chromatic order (concert pitch) */
export type PitchClass = 'C' | 'Db' | 'D' | 'Eb' | 'E' | 'F' | 'F#' | 'G' | 'Ab' | 'A' | 'Bb' | 'B';

/** All 12 pitch classes in order */
export const PITCH_CLASSES: PitchClass[] = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

export type ChordQuality =
	| 'maj7' | 'min7' | '7' | 'min7b5' | 'dim7'
	| 'maj6' | 'min6' | 'aug7' | 'sus4' | 'sus2'
	| '7alt' | '7#11' | '7b9' | '7#9' | '7b13'
	| 'minMaj7' | 'aug' | 'dim';

export type PhraseCategory =
	| 'ii-V-I-major' | 'ii-V-I-minor' | 'blues' | 'bebop-lines'
	| 'short-ii-V-I-major' | 'short-ii-V-I-minor'
	| 'long-ii-V-I-major' | 'long-ii-V-I-minor'
	| 'V-I-major' | 'V-I-minor'
	| 'major-chord' | 'dominant-chord' | 'minor-chord' | 'diminished-chord'
	| 'pentatonic' | 'enclosures' | 'digital-patterns' | 'approach-notes'
	| 'turnarounds' | 'rhythm-changes' | 'ballad' | 'modal'
	| 'user';

/** Canonical display labels for every PhraseCategory value */
export const CATEGORY_LABELS: Record<PhraseCategory, string> = {
	'ii-V-I-major': 'ii-V-I (Maj)',
	'ii-V-I-minor': 'ii-V-I (Min)',
	'short-ii-V-I-major': 'Short ii-V-I (Maj)',
	'short-ii-V-I-minor': 'Short ii-V-I (Min)',
	'long-ii-V-I-major': 'Long ii-V-I (Maj)',
	'long-ii-V-I-minor': 'Long ii-V-I (Min)',
	'V-I-major': 'V-I (Maj)',
	'V-I-minor': 'V-I (Min)',
	'major-chord': 'Major Chord',
	'dominant-chord': 'Dominant Chord',
	'minor-chord': 'Minor Chord',
	'diminished-chord': 'Diminished Chord',
	'blues': 'Blues',
	'bebop-lines': 'Bebop',
	'pentatonic': 'Pentatonic',
	'enclosures': 'Enclosures',
	'digital-patterns': 'Digital Patterns',
	'approach-notes': 'Approach Notes',
	'turnarounds': 'Turnarounds',
	'rhythm-changes': 'Rhythm Changes',
	'ballad': 'Ballad',
	'modal': 'Modal',
	'user': 'Uncategorized'
};

export type Articulation = 'normal' | 'accent' | 'ghost' | 'bend-up' | 'staccato' | 'legato';

/** Fraction as [numerator, denominator] — avoids floating-point for triplets */
export type Fraction = [number, number];

export interface Note {
	/** MIDI note number (concert pitch), null = rest */
	pitch: number | null;
	/** Duration as fraction of whole note, e.g. [1,4] = quarter note */
	duration: Fraction;
	/** Beat offset from phrase start as fraction */
	offset: Fraction;
	velocity?: number;
	articulation?: Articulation;
	/** Scale degree string, e.g. '1', 'b3', '#4' */
	scaleDegree?: string;
	/** Override enharmonic spelling for notation display */
	spelling?: 'sharp' | 'flat';
}

export interface HarmonicSegment {
	chord: {
		root: PitchClass;
		quality: ChordQuality;
		bass?: PitchClass;
	};
	/** References a ScaleDefinition.id */
	scaleId: string;
	startOffset: Fraction;
	duration: Fraction;
}

export interface DifficultyMetadata {
	/** Overall difficulty rating from 1 (easiest) to 100 (hardest) */
	level: number;
	/** Pitch complexity from 1-100 */
	pitchComplexity: number;
	/** Rhythm complexity from 1-100 */
	rhythmComplexity: number;
	lengthBars: number;
}

export interface Phrase {
	id: string;
	name: string;
	timeSignature: [number, number];
	/** Concert pitch key */
	key: PitchClass;
	notes: Note[];
	harmony: HarmonicSegment[];
	difficulty: DifficultyMetadata;
	category: PhraseCategory;
	tags: string[];
	source: 'curated' | 'generated' | string;
}

export type ScaleFamily =
	| 'major' | 'melodic-minor' | 'harmonic-minor'
	| 'symmetric' | 'pentatonic' | 'bebop' | 'blues';

export interface ScaleDefinition {
	id: string;
	name: string;
	family: ScaleFamily;
	/** Mode number (1-based) within family, null for non-modal scales */
	mode: number | null;
	/** Semitone steps between consecutive degrees — must sum to 12 */
	intervals: number[];
	/** Scale degree labels: '1', 'b2', '2', 'b3', '#4', etc. */
	degrees: string[];
	/** Chord qualities this scale typically applies to */
	chordApplications: ChordQuality[];
	/** Degrees to avoid as sustained notes */
	avoidNotes?: string[];
	/** Chord tones the generator should land on */
	targetNotes: string[];
}
