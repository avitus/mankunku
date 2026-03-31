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

// ── Long-term tracking types ─────────────────────────────────────

export interface GradeDistribution {
	perfect: number;
	great: number;
	good: number;
	fair: number;
	tryAgain: number;
}

/** Compact daily summary — persists indefinitely, never pruned */
export interface DailySummary {
	date: string;                          // "YYYY-MM-DD"
	sessionCount: number;
	practiceMinutes: number;               // estimated ~2 min per session
	avgOverall: number;                    // 0-1
	avgPitch: number;                      // 0-1
	avgRhythm: number;                     // 0-1
	bestScore: number;                     // 0-1
	notesTotal: number;
	notesHit: number;
	grades: GradeDistribution;
	categories: Record<string, number>;    // category → session count
	xpEarned: number;
}

export interface ProgressMeta {
	version: number;
	lastAggregationTimestamp: number;
	longestStreak: number;
	longestStreakEndDate: string;
	allTimeSessionCount: number;
}

export interface PeriodStats {
	sessionCount: number;
	avgOverall: number;
	avgPitch: number;
	avgRhythm: number;
	practiceMinutes: number;
	practiceDays: number;
}

export interface PeriodComparison {
	current: PeriodStats;
	previous: PeriodStats;
	delta: PeriodDelta;
}

export interface PeriodDelta {
	sessionCount: number;
	avgOverall: number;
	avgPitch: number;
	avgRhythm: number;
	practiceMinutes: number;
	practiceDays: number;
}
