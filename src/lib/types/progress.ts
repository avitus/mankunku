import type { Grade } from './scoring.ts';
import type { PhraseCategory, PitchClass } from './music.ts';

export interface SessionResult {
	id: string;
	timestamp: number;
	phraseId: string;
	category: PhraseCategory;
	key: PitchClass;
	tempo: number;
	difficultyLevel: number;
	pitchAccuracy: number;
	rhythmAccuracy: number;
	overall: number;
	grade: Grade;
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
	totalPracticeTime: number;
	streakDays: number;
	lastPracticeDate: string;
}
