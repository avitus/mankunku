import type { PitchClass, PhraseCategory } from './music.ts';
import type { Score } from './scoring.ts';

export type ChordProgressionType =
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
	backingStyle: import('./instruments.ts').BackingStyle;
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
