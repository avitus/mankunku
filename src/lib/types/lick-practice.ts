import type { PitchClass, PhraseCategory, ChordQuality } from './music';
import type { Score } from './scoring';

export type ChordProgressionType =
	| 'minor-vamp'
	| 'major-vamp'
	| 'ii-V-I-major'
	| 'ii-V-I-minor'
	| 'ii-V-I-major-long'
	| 'ii-V-I-minor-long'
	| 'turnaround'
	| 'blues';

/**
 * Practice mode:
 * - 'continuous': no demo. The user plays the lick continuously across all
 *   12 keys. Each key lasts exactly `lengthBars` bars; the beat never stops.
 * - 'call-response': the app plays the lick for `lengthBars` bars, then the
 *   user responds in the next `lengthBars` bars, then the app plays the
 *   next key, etc. Continuous backing.
 */
export type LickPracticeMode = 'continuous' | 'call-response';

export interface LickPracticeConfig {
	progressionType: ChordProgressionType;
	durationMinutes: number;
	/** Practice mode — see LickPracticeMode */
	practiceMode: LickPracticeMode;
	/** Backing track musical style */
	backingStyle: import('./instruments').BackingStyle;
	/**
	 * When true, include licks whose category can substitute over a compatible
	 * chord in the progression (e.g. a minor lick played a semitone above a
	 * dominant chord for altered/diminished color). See `CHORD_SUBSTITUTION_RULES`.
	 */
	enableSubstitutions?: boolean;
}

/**
 * A harmonic substitution rule: licks curated for `sourceCategory` can be
 * transposed over chords of `targetQuality` by shifting the chord root up
 * by `semitoneOffset` semitones.
 *
 * Example: `minor-chord` lick (rooted on `Cm7`) played over a `G7` with
 * `semitoneOffset = 1` becomes `Abm7` over `G7` — the classic "minor a
 * half-step up" device that yields b9/#11/b13 altered sonority.
 */
export interface ChordSubstitutionRule {
	id: string;
	name: string;
	sourceCategory: PhraseCategory;
	targetQuality: ChordQuality;
	semitoneOffset: number;
}

export interface LickPracticeKeyProgress {
	currentTempo: number;
	lastPracticedAt: number;
	passCount: number;
}

/** Per-lick, per-key progress stored in localStorage */
export type LickPracticeProgress = Record<string, Partial<Record<PitchClass, LickPracticeKeyProgress>>>;

export interface LickPracticePlanItem {
	phraseId: string;
	phraseName: string;
	phraseNumber: number;
	category: PhraseCategory;
	keys: PitchClass[];
}

export type LickPracticePhase =
	| 'setup'
	| 'count-in'
	| 'lick-running'
	| 'inter-lick-rest'
	| 'complete';

export interface LickPracticeKeyResult {
	key: PitchClass;
	passed: boolean;
	score: number;
	pitchAccuracy: number;
	rhythmAccuracy: number;
	attempts: number;
	tempo: number;
	/**
	 * IndexedDB recording key for the per-key window. Optional because legacy
	 * archived results may not carry it; new recordings always do.
	 */
	sessionId?: string;
}

// ── Session report (end-of-session summary) ────────────────

export interface LickReport {
	lickId: string;
	lickName: string;
	tempo: number;
	/** Tempo after auto-adjust/increment (null if no change was applied) */
	newTempo: number | null;
	keys: {
		key: PitchClass;
		score: number;
		pitchAccuracy: number;
		rhythmAccuracy: number;
		passed: boolean;
		/**
		 * IndexedDB recording key for the per-key window. Optional for backward
		 * compatibility with sessions persisted before this field was introduced.
		 */
		sessionId?: string;
	}[];
	averageScore: number;
	passedCount: number;
}

export interface SessionReport {
	licks: LickReport[];
	overallAverage: number;
	totalAttempts: number;
	totalPassed: number;
	elapsedMinutes: number;
}
