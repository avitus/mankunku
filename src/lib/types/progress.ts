import type { Grade, NoteResult, TimingDiagnostics } from './scoring.ts';
import type { PhraseCategory, PitchClass } from './music.ts';
import type { ScaleType } from '$lib/tonality/tonality.ts';

export interface ScaleProficiency {
	level: number;              // 1-100 — the user's proficiency in this scale
	recentScores: number[];     // circular buffer, last 10 scores at current level
	attemptsAtLevel: number;
	attemptsSinceChange: number;
	totalAttempts: number;
}

export interface KeyProficiency {
	level: number;              // 1-100
	recentScores: number[];     // last 10 scores in this key
	attemptsAtLevel: number;
	attemptsSinceChange: number;
	totalAttempts: number;
}

export interface UnlockContext {
	scaleProficiency: Partial<Record<ScaleType, { level: number }>>;
	keyProficiency: Partial<Record<PitchClass, { level: number }>>;
}

export interface SessionResult {
	id: string;
	timestamp: number;
	phraseId: string;
	phraseName: string;
	category: PhraseCategory;
	key: PitchClass;
	/** Scale type for the session (e.g. 'dorian', 'major'). Optional for backward compat. */
	scaleType?: ScaleType;
	tempo: number;
	difficultyLevel: number;
	pitchAccuracy: number;
	rhythmAccuracy: number;
	overall: number;
	grade: Grade;
	notesHit: number;
	notesTotal: number;
	/** Per-note scoring breakdown for detail view */
	noteResults: NoteResult[];
	/** Timing diagnostics (early/late bias, spread). Optional for backward compat. */
	timing?: TimingDiagnostics;
}

export interface CategoryProgress {
	category: PhraseCategory;
	attemptsTotal: number;
	averageScore: number;
	bestScore: number;
	lastAttempt: number;
}

export interface AdaptiveState {
	currentLevel: number;
	pitchComplexity: number;
	rhythmComplexity: number;
	/** Circular buffer of last 10 scores */
	recentScores: number[];
	/** Total attempts at current level */
	attemptsAtLevel: number;
	/** Attempts since last difficulty change */
	attemptsSinceChange: number;
	xp: number;
}

export interface UserProgress {
	adaptive: AdaptiveState;
	sessions: SessionResult[];
	categoryProgress: Record<string, CategoryProgress>;
	/** Per-key accuracy tracking */
	keyProgress: Partial<Record<PitchClass, { attempts: number; averageScore: number }>>;
	/** Per-scale proficiency levels (1-100) */
	scaleProficiency: Partial<Record<ScaleType, ScaleProficiency>>;
	/** Per-key proficiency levels (1-100) */
	keyProficiency: Partial<Record<PitchClass, KeyProficiency>>;
	totalPracticeTime: number;
	streakDays: number;
	lastPracticeDate: string;
}
