/**
 * Lick practice session state — Svelte 5 runes module.
 *
 * Flow: user picks a progression type (ii-V-I, turnaround, blues, etc.),
 * we build a plan of practice-tagged licks sorted by least-recently-practiced,
 * each lick is played through all 12 keys (shuffled order).
 *
 * Two practice modes, both continuous (the beat never stops between keys):
 * - 'continuous' — user plays every key back-to-back, each lasting exactly
 *   `lengthBars` bars. No demo.
 * - 'call-response' — app plays the lick for `lengthBars` bars, user
 *   responds for `lengthBars` bars, repeat for all 12 keys.
 *
 * Scoring runs silently each key and appears only in the end-of-session
 * report. No retries. All 12 keys passed (score ≥ 80%) → tempo bumps for
 * this lick on the next session.
 */

import type { PitchClass, Phrase, HarmonicSegment, Note, Fraction } from '$lib/types/music.ts';
import type {
	LickPracticeConfig,
	LickPracticePhase,
	LickPracticePlanItem,
	LickPracticeProgress,
	LickPracticeKeyResult,
	LickReport,
	SessionReport
} from '$lib/types/lick-practice.ts';
import type { Score } from '$lib/types/scoring.ts';
import { PITCH_CLASSES } from '$lib/types/music.ts';
import { addFractions } from '$lib/music/intervals.ts';
import {
	loadLickPracticeProgress,
	saveLickPracticeProgress,
	getLickTempo,
	getLickLastPracticed,
	updateKeyProgress,
	getPracticeTaggedIds,
	isTaggedForProgression,
	backfillPracticeTags
} from '$lib/persistence/lick-practice-store.ts';
import { PROGRESSION_LICK_CATEGORIES, PROGRESSION_TEMPLATES, transposeProgression } from '$lib/data/progressions.ts';
import { getAllLicks, transposeLick } from '$lib/phrases/library-loader.ts';
import { getLickTagOverrides } from '$lib/persistence/user-licks.ts';
import { settings, getInstrument, getEffectiveHighestNote } from '$lib/state/settings.svelte';

const PASS_THRESHOLD = 0.80;

/** A key within the plan (may cross lick boundaries when looking ahead). */
export interface PlannedKey {
	lickIndex: number;
	keyIndex: number;
	key: PitchClass;
	phrase: Phrase;
	harmony: HarmonicSegment[];
	lickName: string;
	lickId: string;
}

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
	allAttempts: LickPracticeKeyResult[][];
	startTime: number;
	elapsedSeconds: number;
	progress: LickPracticeProgress;
}>({
	config: {
		progressionType: 'ii-V-I-major',
		durationMinutes: 15,
		tempoIncrement: 5,
		practiceMode: 'continuous',
		backingStyle: 'swing'
	},
	phase: 'setup',
	plan: [],
	currentLickIndex: 0,
	currentKeyIndex: 0,
	currentTempo: 100,
	keyResults: [],
	allAttempts: [],
	startTime: 0,
	elapsedSeconds: 0,
	progress: {}
});

/** Load persisted progress into state and backfill legacy practice tags */
export function hydrateLickPracticeProgress(): void {
	lickPractice.progress = loadLickPracticeProgress();
	// Migrate legacy 'practice' markers from lick.tags + tag overrides
	// into the new user-lick-tags store so getPracticeLicks can find them.
	backfillPracticeTags(getAllLicks(), getLickTagOverrides());
}

/**
 * Get all licks tagged for practice that match the selected progression.
 * A lick must have the 'practice' tag, and matches if either:
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
		const barsPerKey = PROGRESSION_TEMPLATES[lickPractice.config.progressionType].bars;
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
	lickPractice.allAttempts = [];
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

/**
 * Get the current phrase: the lick transposed to the current key, with
 * the progression template's harmony substituted in (transposed to the key).
 * This way the chord chart, backing track, and scored phrase all agree.
 */
export function getCurrentPhrase(): Phrase | null {
	const item = getCurrentPlanItem();
	const key = getCurrentKey();
	if (!item || !key) return null;
	return buildPhraseFor(item.phraseId, key);
}

/** Get the transposed harmony for the current key (for ChordChart) */
export function getCurrentHarmony(): HarmonicSegment[] {
	const key = getCurrentKey();
	if (!key) return [];
	const template = PROGRESSION_TEMPLATES[lickPractice.config.progressionType];
	return transposeProgression(template.harmony, key);
}

/**
 * Build the transposed phrase + harmony for a given lick/key combo.
 * Shared by getCurrentPhrase and the lookahead accessors so they all
 * transpose identically.
 */
function buildPhraseFor(lickId: string, key: PitchClass): Phrase | null {
	const allLicks = getAllLicks();
	const baseLick = allLicks.find(l => l.id === lickId);
	if (!baseLick) return null;

	const instrument = getInstrument();
	const transposed = transposeLick(baseLick, key, instrument.concertRangeLow, getEffectiveHighestNote());

	const template = PROGRESSION_TEMPLATES[lickPractice.config.progressionType];
	const progressionHarmony = transposeProgression(template.harmony, key);

	return { ...transposed, harmony: progressionHarmony };
}

/**
 * Return the nth planned key (lookahead by `offset`) from the current
 * position, crossing lick boundaries as needed. Returns null when past
 * the end of the plan.
 */
export function getPlannedKey(offset: number): PlannedKey | null {
	let lickIdx = lickPractice.currentLickIndex;
	let keyIdx = lickPractice.currentKeyIndex + offset;

	while (lickIdx < lickPractice.plan.length) {
		const item = lickPractice.plan[lickIdx];
		if (keyIdx < item.keys.length) {
			const key = item.keys[keyIdx];
			const phrase = buildPhraseFor(item.phraseId, key);
			if (!phrase) return null;
			const template = PROGRESSION_TEMPLATES[lickPractice.config.progressionType];
			return {
				lickIndex: lickIdx,
				keyIndex: keyIdx,
				key,
				phrase,
				harmony: transposeProgression(template.harmony, key),
				lickName: item.phraseName,
				lickId: item.phraseId
			};
		}
		keyIdx -= item.keys.length;
		lickIdx++;
	}
	return null;
}

/** Current, next, and after-next planned keys for the 3-row preview. */
export function getUpcomingKeys(): {
	current: PlannedKey | null;
	next: PlannedKey | null;
	afterNext: PlannedKey | null;
} {
	return {
		current: getPlannedKey(0),
		next: getPlannedKey(1),
		afterNext: getPlannedKey(2)
	};
}

/**
 * Return all planned keys for a given lick — used by the continuous-scroll
 * preview to render the entire lick's chord charts as a tall stack that
 * the scroll animation glides through.
 */
export function getPlannedKeysForLick(lickIdx: number): PlannedKey[] {
	const item = lickPractice.plan[lickIdx];
	if (!item) return [];

	const template = PROGRESSION_TEMPLATES[lickPractice.config.progressionType];
	const result: PlannedKey[] = [];
	for (let i = 0; i < item.keys.length; i++) {
		const key = item.keys[i];
		const phrase = buildPhraseFor(item.phraseId, key);
		if (!phrase) continue;
		result.push({
			lickIndex: lickIdx,
			keyIndex: i,
			key,
			phrase,
			harmony: transposeProgression(template.harmony, key),
			lickName: item.phraseName,
			lickId: item.phraseId
		});
	}
	return result;
}

/**
 * Build a "super phrase" for an entire lick — all 12 keys' harmony
 * (and melody, for call-response mode) concatenated into one phrase.
 *
 * This lets us schedule the whole lick's backing track in one shot via
 * playPhrase / scheduleNextPhrase, avoiding the mid-bar reschedule problem
 * that would arise from per-key scheduling.
 *
 * Layout (`P` = bars in the chord progression cycle, e.g. 2 for short
 * ii-V-I, 4 for long ii-V-I-long, 12 for blues):
 *   - Continuous: (1 + 12) × P bars. The first P bars are a DEMO of the
 *     lick in keys[0] — the app plays the lick once so the user knows what
 *     they'll be playing. Then 12 user cycles where the user plays each
 *     key in turn (harmony only, no melody).
 *   - Call-response: 12 × 2P bars. Each key i has app bars [i*2P, i*2P+P)
 *     and user bars [i*2P+P, (i+1)*2P). The app melody plays during the
 *     app bars of each key; no melody during user bars.
 *
 * Note: We use the progression's bars, not the lick's `difficulty.lengthBars`.
 * Short licks (e.g. lengthBars=1) on a longer progression (e.g. 2-bar
 * ii-V-I) play the melody during the first portion and let the chord
 * progression resolve over the remainder.
 */
export function buildLickSuperPhrase(lickIdx: number): Phrase | null {
	const item = lickPractice.plan[lickIdx];
	if (!item) return null;

	const allLicks = getAllLicks();
	const baseLick = allLicks.find(l => l.id === item.phraseId);
	if (!baseLick) return null;

	const template = PROGRESSION_TEMPLATES[lickPractice.config.progressionType];
	const progressionBars = template.bars;
	const mode = lickPractice.config.practiceMode;
	const keyBars = mode === 'call-response' ? progressionBars * 2 : progressionBars;
	const demoBars = mode === 'continuous' ? progressionBars : 0;
	const instrument = getInstrument();
	const highestNote = getEffectiveHighestNote();

	const superHarmony: HarmonicSegment[] = [];
	const superNotes: Note[] = [];

	// Continuous-mode demo: the app plays the lick once in keys[0] before
	// the user starts. The lick's notes go in at offset [0, lengthBars] and
	// the harmony for keys[0] goes in at offset [0, P]. The user phase below
	// is then shifted by `demoBars`.
	if (mode === 'continuous') {
		const firstKey = item.keys[0];
		const demoHarmony = transposeProgression(template.harmony, firstKey);
		for (const seg of demoHarmony) {
			// startOffset is already in [0, P) for a single progression cycle,
			// so the demo segments land directly at the start of the phrase.
			superHarmony.push({ ...seg });
		}
		const demoLick = transposeLick(
			baseLick,
			firstKey,
			instrument.concertRangeLow,
			highestNote
		);
		for (const note of demoLick.notes) {
			superNotes.push({ ...note });
		}
	}

	for (let i = 0; i < item.keys.length; i++) {
		const key = item.keys[i];
		// Continuous mode shifts user keys by `demoBars` to leave room for the
		// demo at the start. C&R mode is unaffected (demoBars = 0).
		const keyOffsetWhole: Fraction = [i * keyBars + demoBars, 1];
		const keyHarmony = transposeProgression(template.harmony, key);

		// Harmony for the full keyBars span of this key. In continuous mode
		// this is just the transposed progression. In call-response mode we
		// need harmony for both the app bars AND the user bars, so the
		// backing keeps playing — we add the progression twice.
		for (const seg of keyHarmony) {
			superHarmony.push({
				...seg,
				startOffset: addFractions(seg.startOffset, keyOffsetWhole)
			});
		}
		if (mode === 'call-response') {
			const userBarsOffset: Fraction = [i * keyBars + progressionBars, 1];
			for (const seg of keyHarmony) {
				superHarmony.push({
					...seg,
					startOffset: addFractions(seg.startOffset, userBarsOffset)
				});
			}
		}

		// Melody: in call-response mode the app plays the lick during the
		// first half of each key's window. In continuous mode the only melody
		// notes are the demo notes added above the loop — the user keys here
		// don't emit notes because the user plays them.
		if (mode === 'call-response') {
			const transposed = transposeLick(
				baseLick,
				key,
				instrument.concertRangeLow,
				highestNote
			);
			for (const note of transposed.notes) {
				superNotes.push({
					...note,
					offset: addFractions(note.offset, keyOffsetWhole)
				});
			}
		}
	}

	return {
		id: `${baseLick.id}:super:${mode}`,
		name: `${baseLick.name} (all keys)`,
		timeSignature: baseLick.timeSignature,
		key: item.keys[0],
		notes: superNotes,
		harmony: superHarmony,
		difficulty: {
			...baseLick.difficulty,
			lengthBars: item.keys.length * keyBars + demoBars
		},
		category: baseLick.category,
		tags: baseLick.tags,
		source: baseLick.source
	};
}

/**
 * Number of bars each key occupies for the given lick + current mode.
 * Continuous: progression bars. Call-response: 2 × progression bars.
 */
export function getKeyBars(_lickIdx: number): number {
	const template = PROGRESSION_TEMPLATES[lickPractice.config.progressionType];
	const progressionBars = template.bars;
	return lickPractice.config.practiceMode === 'call-response'
		? progressionBars * 2
		: progressionBars;
}

/**
 * Number of bars in the chord progression cycle. Used in call-response
 * mode as the offset between the app's playing bars and the user's
 * response bars within a single key.
 */
export function getProgressionBars(): number {
	return PROGRESSION_TEMPLATES[lickPractice.config.progressionType].bars;
}

/**
 * Record the result of the current key attempt silently — does not change
 * the session phase. The bar-aligned scheduler in the session page drives
 * phase transitions; this function only updates keyResults and writes
 * per-key progress for passed attempts.
 */
export function recordKeyAttempt(score: Score): void {
	const item = getCurrentPlanItem();
	const key = getCurrentKey();
	if (!item || !key) return;

	const passed = score.overall >= PASS_THRESHOLD;

	lickPractice.keyResults.push({
		key,
		passed,
		score: score.overall,
		pitchAccuracy: score.pitchAccuracy,
		rhythmAccuracy: score.rhythmAccuracy,
		attempts: 1,
		tempo: lickPractice.currentTempo
	});

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
}

/**
 * Advance to the next key within the current lick. Returns 'next-key'
 * when another key remains in the current lick, 'end-of-lick' when all
 * keys in the current lick are done (the scheduler should then trigger
 * the inter-lick rest transition).
 */
export function advance(): 'next-key' | 'end-of-lick' {
	const item = getCurrentPlanItem();
	if (!item) return 'end-of-lick';

	if (lickPractice.currentKeyIndex < item.keys.length - 1) {
		lickPractice.currentKeyIndex++;
		return 'next-key';
	}
	return 'end-of-lick';
}

/**
 * Transition from the current lick to the next (or complete the session).
 * Archives results, bumps tempo if all 12 keys passed, and either moves
 * currentLickIndex forward or marks the session complete. Called by the
 * scheduler at the start of the 2-bar inter-lick rest.
 */
export function startInterLickTransition(): 'next-lick' | 'complete' {
	const item = getCurrentPlanItem();
	if (item) {
		// Archive results for session report
		lickPractice.allAttempts.push([...lickPractice.keyResults]);

		const allPassed = lickPractice.keyResults.length === item.keys.length
			&& lickPractice.keyResults.every(r => r.passed);
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

		const nextItem = getCurrentPlanItem();
		if (nextItem) {
			lickPractice.currentTempo = getLickTempo(lickPractice.progress, nextItem.phraseId)
				|| settings.defaultTempo;
		}
		lickPractice.phase = 'inter-lick-rest';
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
	lickPractice.allAttempts = [];
	lickPractice.startTime = 0;
	lickPractice.elapsedSeconds = 0;
}

/** Build the end-of-session report from archived attempts */
export function getSessionReport(): SessionReport {
	// Include in-progress lick results (when session ends mid-lick)
	const allLickResults: LickPracticeKeyResult[][] = [...lickPractice.allAttempts];
	if (lickPractice.keyResults.length > 0) {
		allLickResults.push([...lickPractice.keyResults]);
	}

	const licks: LickReport[] = [];
	for (let i = 0; i < allLickResults.length; i++) {
		const results = allLickResults[i];
		const item = lickPractice.plan[i];
		if (!item) continue;

		const keys = results.map(r => ({
			key: r.key,
			score: r.score,
			pitchAccuracy: r.pitchAccuracy,
			rhythmAccuracy: r.rhythmAccuracy,
			passed: r.passed
		}));

		const totalScore = keys.reduce((s, k) => s + k.score, 0);
		const averageScore = keys.length > 0 ? totalScore / keys.length : 0;
		const passedCount = keys.filter(k => k.passed).length;
		// Tempo is the one used for the first attempt (all keys share it within a lick)
		const tempo = results[0]?.tempo ?? lickPractice.currentTempo;

		licks.push({
			lickId: item.phraseId,
			lickName: item.phraseName,
			tempo,
			keys,
			averageScore,
			passedCount
		});
	}

	const allKeys = licks.flatMap(l => l.keys);
	const totalAttempts = allKeys.length;
	const totalPassed = allKeys.filter(k => k.passed).length;
	const overallAverage = totalAttempts > 0
		? allKeys.reduce((s, k) => s + k.score, 0) / totalAttempts
		: 0;

	return {
		licks,
		overallAverage,
		totalAttempts,
		totalPassed,
		elapsedMinutes: Math.round(lickPractice.elapsedSeconds / 60)
	};
}
