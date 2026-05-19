import type { PitchClass, PhraseCategory, ChordQuality, Phrase } from './music';
import type { Score } from './scoring';

export type ChordProgressionType =
	| 'minor-vamp'
	| 'major-vamp'
	| 'dominant-vamp'
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
	/**
	 * When true, the session drills a single lick endlessly: cycles through the
	 * circle of 4ths, drops keys mastered at score ≥ 0.95, and bumps tempo by
	 * `tempoBumpBpm` once all 12 are cleared.
	 */
	singleLickMode?: boolean;
	/** Phrase id of the lick to drill (only meaningful when singleLickMode is true). */
	singleLickId?: string;
	/** BPM added to currentTempo each time all 12 keys are mastered. Default 5. */
	tempoBumpBpm?: number;
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
	/**
	 * The chord progression this lick is played under for the duration of its
	 * slot in the plan. Standard sessions stamp every item with the user's
	 * single selection on the setup page. Daily Practice sessions assign each
	 * lick its own least-recently-practiced compatible progression, which is
	 * why this is per-plan-item rather than read from config.
	 */
	progressionType: ChordProgressionType;
	/**
	 * Resolved Phrase captured at plan-build time. Used as a lookup fallback
	 * for `getLickById` so user/community licks survive cache misses (e.g.
	 * the lick was deleted from the local cache mid-session, or the entry
	 * point passed in a Phrase that's not yet in `getAllLicks()`).
	 */
	phrase?: Phrase;
}

/**
 * Single-lick mode end-of-round summary: which keys cleared at score ≥ 0.95
 * during the round, captured for the session report.
 */
export interface SingleLickRoundEntry {
	round: number;
	tempo: number;
	keys: PitchClass[];
}

export type LickPracticePhase =
	| 'setup'
	| 'count-in'
	| 'lick-running'
	| 'inter-lick-rest'
	| 'round-complete'
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
	/** Single-lick mode only: how many full rounds (12-key cycles) the user completed. */
	roundsCompleted?: number;
	/** Single-lick mode only: tempo at session end (after any tempo bumps). */
	finalTempo?: number;
	/** Single-lick mode only: which keys cleared in each round and at what tempo. */
	keysMasteredByRound?: SingleLickRoundEntry[];
}
