import type { PitchClass, PhraseCategory } from './music.ts';
import type { Score } from './scoring.ts';

export type ChordProgressionType =
	| 'ii-V-I-major'
	| 'ii-V-I-minor'
	| 'ii-V-I-major-long'
	| 'ii-V-I-minor-long'
	| 'turnaround'
	| 'blues';

export interface LickPracticeConfig {
	progressionType: ChordProgressionType;
	durationMinutes: number;
	tempoIncrement: number;
	/** If true, play a demo of the lick before user attempts */
	playDemo: boolean;
}

export interface LickPracticeKeyProgress {
	currentTempo: number;
	lastPracticedAt: number;
	passCount: number;
}

/** Per-lick, per-key progress stored in localStorage */
export type LickPracticeProgress = Record<string, Record<string, LickPracticeKeyProgress>>;

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
	| 'playing-demo'
	| 'listening'
	| 'scored'
	| 'complete';

export interface LickPracticeKeyResult {
	key: PitchClass;
	passed: boolean;
	score: number;
	attempts: number;
}
