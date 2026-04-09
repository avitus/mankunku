import type { PitchClass, Phrase } from '$lib/types/music.ts';
import type {
	LickPracticeConfig,
	LickPracticePhase,
	LickPracticePlanItem,
	LickPracticeProgress,
	LickPracticeKeyResult
} from '$lib/types/lick-practice.ts';
import type { Score } from '$lib/types/scoring.ts';
import { PITCH_CLASSES } from '$lib/types/music.ts';
import {
	loadLickPracticeProgress,
	saveLickPracticeProgress,
	getLickTempo,
	getLickLastPracticed,
	updateKeyProgress,
	getPracticeTaggedIds,
	isTaggedForProgression
} from '$lib/persistence/lick-practice-store.ts';
import { PROGRESSION_LICK_CATEGORIES } from '$lib/data/progressions.ts';
import { getAllLicks, transposeLick } from '$lib/phrases/library-loader.ts';
import { settings, getEffectiveHighestNote } from '$lib/state/settings.svelte';

const PASS_THRESHOLD = 0.80;
const SECONDS_PER_LICK_KEY = 30;

function shuffleArray<T>(arr: T[]): T[] {
	const result = [...arr];
	for (let i = result.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[result[i], result[j]] = [result[j], result[i]];
	}
	return result;
}

export const lickPractice = $state<{
	config: LickPracticeConfig;
	phase: LickPracticePhase;
	plan: LickPracticePlanItem[];
	currentLickIndex: number;
	currentKeyIndex: number;
	currentTempo: number;
	keyResults: LickPracticeKeyResult[];
	lastScore: Score | null;
	startTime: number;
	elapsedSeconds: number;
	progress: LickPracticeProgress;
}>({
	config: {
		progressionType: 'ii-V-I-major',
		durationMinutes: 15,
		tempoIncrement: 5,
		playDemo: false
	},
	phase: 'setup',
	plan: [],
	currentLickIndex: 0,
	currentKeyIndex: 0,
	currentTempo: 100,
	keyResults: [],
	lastScore: null,
	startTime: 0,
	elapsedSeconds: 0,
	progress: {}
});

/** Load persisted progress into state */
export function hydrateLickPracticeProgress(): void {
	lickPractice.progress = loadLickPracticeProgress();
}

/**
 * Get all licks tagged for practice that match the selected progression.
 * A lick must have the 'practice' tag, and then matches if:
 *   1. Its curated category is compatible with the progression, OR
 *   2. It has a user-assigned progression tag for the selected progression type.
 */
export function getPracticeLicks(): Phrase[] {
	const taggedIds = getPracticeTaggedIds();
	if (taggedIds.size === 0) return [];

	const progressionType = lickPractice.config.progressionType;
	const compatibleCategories = PROGRESSION_LICK_CATEGORIES[progressionType];
	const allLicks = getAllLicks();

	return allLicks.filter(lick => {
		if (!taggedIds.has(lick.id)) return false;
		const matchesByCategory = compatibleCategories.includes(lick.category);
		const matchesByProgressionTag = isTaggedForProgression(lick.id, progressionType);
		return matchesByCategory || matchesByProgressionTag;
	});
}

/** Build a session plan sorted by least-recently-practiced, filling the time budget */
export function buildSessionPlan(): void {
	const licks = getPracticeLicks();
	const progress = lickPractice.progress;

	const sorted = [...licks].sort((a, b) => {
		const aTime = getLickLastPracticed(progress, a.id);
		const bTime = getLickLastPracticed(progress, b.id);
		return aTime - bTime;
	});

	const totalSeconds = lickPractice.config.durationMinutes * 60;
	const plan: LickPracticePlanItem[] = [];
	let estimatedTime = 0;

	for (let i = 0; i < sorted.length && estimatedTime < totalSeconds; i++) {
		const lick = sorted[i];
		const keys = shuffleArray([...PITCH_CLASSES]);
		plan.push({
			phraseId: lick.id,
			phraseName: lick.name,
			phraseNumber: i + 1,
			category: lick.category,
			keys
		});
		const tempo = getLickTempo(progress, lick.id) || settings.defaultTempo;
		const barsPerKey = lick.difficulty.lengthBars || 4;
		const secondsPerKey = (barsPerKey * 4 * 60) / tempo + 5;
		estimatedTime += secondsPerKey * 12;
	}

	lickPractice.plan = plan;
}

/** Start the practice session */
export function startSession(): void {
	buildSessionPlan();
	if (lickPractice.plan.length === 0) return;

	lickPractice.currentLickIndex = 0;
	lickPractice.currentKeyIndex = 0;
	lickPractice.keyResults = [];
	lickPractice.lastScore = null;
	lickPractice.startTime = Date.now();
	lickPractice.elapsedSeconds = 0;

	const firstItem = lickPractice.plan[0];
	lickPractice.currentTempo = getLickTempo(lickPractice.progress, firstItem.phraseId)
		|| settings.defaultTempo;

	lickPractice.phase = 'count-in';
}

/** Get the current plan item */
export function getCurrentPlanItem(): LickPracticePlanItem | null {
	return lickPractice.plan[lickPractice.currentLickIndex] ?? null;
}

/** Get the current key being practiced */
export function getCurrentKey(): PitchClass | null {
	const item = getCurrentPlanItem();
	if (!item) return null;
	return item.keys[lickPractice.currentKeyIndex] ?? null;
}

/** Get the current lick transposed to the current key */
export function getCurrentPhrase(): Phrase | null {
	const item = getCurrentPlanItem();
	const key = getCurrentKey();
	if (!item || !key) return null;

	const allLicks = getAllLicks();
	const baseLick = allLicks.find(l => l.id === item.phraseId);
	if (!baseLick) return null;

	return transposeLick(baseLick, key, getEffectiveHighestNote());
}

/** Record the result of the current key attempt */
export function recordKeyAttempt(score: Score): void {
	const item = getCurrentPlanItem();
	const key = getCurrentKey();
	if (!item || !key) return;

	lickPractice.lastScore = score;
	const passed = score.overall >= PASS_THRESHOLD;

	const existing = lickPractice.keyResults.find(r => r.key === key);
	if (existing) {
		existing.attempts++;
		if (passed) existing.passed = true;
		existing.score = Math.max(existing.score, score.overall);
	} else {
		lickPractice.keyResults.push({
			key,
			passed,
			score: score.overall,
			attempts: 1
		});
	}

	if (passed) {
		lickPractice.progress = updateKeyProgress(
			lickPractice.progress,
			item.phraseId,
			key,
			{
				lastPracticedAt: Date.now(),
				passCount: (lickPractice.progress[item.phraseId]?.[key]?.passCount ?? 0) + 1,
				currentTempo: lickPractice.currentTempo
			}
		);
		saveLickPracticeProgress(lickPractice.progress);
	}

	lickPractice.phase = 'scored';
}

/** Advance to the next key or next lick */
export function advance(): 'next-key' | 'next-lick' | 'complete' {
	const item = getCurrentPlanItem();
	if (!item) return 'complete';

	const currentResult = lickPractice.keyResults.find(
		r => r.key === item.keys[lickPractice.currentKeyIndex]
	);
	const passed = currentResult?.passed ?? false;

	if (passed || (currentResult && currentResult.attempts >= 2)) {
		if (lickPractice.currentKeyIndex < item.keys.length - 1) {
			lickPractice.currentKeyIndex++;
			lickPractice.lastScore = null;
			lickPractice.phase = 'count-in';
			return 'next-key';
		} else {
			return advanceToNextLick();
		}
	} else {
		lickPractice.lastScore = null;
		lickPractice.phase = 'listening';
		return 'next-key';
	}
}

function advanceToNextLick(): 'next-lick' | 'complete' {
	const item = getCurrentPlanItem();
	if (item) {
		const allPassed = lickPractice.keyResults.every(r => r.passed);
		if (allPassed) {
			const newTempo = lickPractice.currentTempo + lickPractice.config.tempoIncrement;
			for (const key of item.keys) {
				lickPractice.progress = updateKeyProgress(
					lickPractice.progress,
					item.phraseId,
					key,
					{ currentTempo: newTempo }
				);
			}
			saveLickPracticeProgress(lickPractice.progress);
		}
	}

	const timeUp = lickPractice.elapsedSeconds >= lickPractice.config.durationMinutes * 60;

	if (lickPractice.currentLickIndex < lickPractice.plan.length - 1 && !timeUp) {
		lickPractice.currentLickIndex++;
		lickPractice.currentKeyIndex = 0;
		lickPractice.keyResults = [];
		lickPractice.lastScore = null;

		const nextItem = getCurrentPlanItem();
		if (nextItem) {
			lickPractice.currentTempo = getLickTempo(lickPractice.progress, nextItem.phraseId)
				|| settings.defaultTempo;
		}
		lickPractice.phase = 'count-in';
		return 'next-lick';
	}

	lickPractice.phase = 'complete';
	return 'complete';
}

/** Check if time budget is exceeded */
export function updateElapsedTime(): void {
	if (lickPractice.startTime > 0) {
		lickPractice.elapsedSeconds = Math.floor((Date.now() - lickPractice.startTime) / 1000);
	}
}

/** Reset to setup phase */
export function resetSession(): void {
	lickPractice.phase = 'setup';
	lickPractice.plan = [];
	lickPractice.currentLickIndex = 0;
	lickPractice.currentKeyIndex = 0;
	lickPractice.keyResults = [];
	lickPractice.lastScore = null;
	lickPractice.startTime = 0;
	lickPractice.elapsedSeconds = 0;
}
