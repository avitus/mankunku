/**
 * Lick practice session state — Svelte 5 runes module.
 *
 * Flow: user picks a progression type (ii-V-I, turnaround, blues, etc.),
 * we build a plan of practice-tagged licks sorted by least-recently-practiced,
 * each lick is played through its currently-unlocked keys. A brand-new lick
 * starts with one unlocked key (its entry key) and earns each next key by
 * alternating sharp- and flat-side neighbours on the circle of fifths from
 * the entry key (see `planUnlockedKeys`). The unlock gate requires both a
 * strong session (avg score ≥ `UNLOCK_AVG_THRESHOLD`) and consolidation on
 * the most-recently-unlocked key (`passCount >= UNLOCK_PASSES_REQUIRED`); see
 * `shouldUnlockNextKey`. Once a lick has earned all 12 keys, `planLickKeys`
 * takes over for staged variety (random starts, chromatic / whole-tone
 * orderings) keyed off the lick's current tempo.
 *
 * Two practice modes, both with continuous backing (the beat never stops):
 * - 'continuous' — app plays the lick once as a demo in the first key, then
 *   the user plays every key back-to-back, each lasting `lengthBars` bars.
 *   See `buildLickSuperPhrase` for the (1 + 12) × P bar layout.
 * - 'call-response' — no upfront demo. For every key the app plays the lick
 *   for `lengthBars` bars, then the user responds for `lengthBars` bars.
 *
 * Scoring runs silently each key and appears only in the end-of-session
 * report. No retries. At the end of each lick, the average score across the
 * attempted keys is fed through `computeAutoTempoAdjustment` to produce a
 * signed BPM delta (+5/+2/−1/−3). That delta is added to the current tempo,
 * clamped to [MIN_TEMPO, MAX_TEMPO], and persisted for every key in the lick
 * so the whole set ratchets up or down together based on overall performance.
 * A per-key floor (`KEY_FLOOR_THRESHOLD`) caps the delta at 0 and blocks
 * the next-key unlock whenever any played key in the session falls below
 * the floor — a strong average can't drag a single weak key along.
 */

import type { PitchClass, Phrase, HarmonicSegment, Note, Fraction } from '$lib/types/music';
import type {
	ChordProgressionType,
	LickPracticeConfig,
	LickPracticePhase,
	LickPracticePlanItem,
	LickPracticeProgress,
	LickPracticeKeyResult,
	LickReport,
	SessionReport,
	SingleLickRoundEntry
} from '$lib/types/lick-practice';
import type { Score } from '$lib/types/scoring';
import { addFractions } from '$lib/music/intervals';
import { planLickKeys, planUnlockedKeys, circleOfFourthsFrom } from '$lib/music/key-ordering';
import {
	loadLickPracticeProgress,
	saveLickPracticeProgress,
	getLickTempo,
	getLickLastPracticed,
	hasLickProgress,
	updateKeyProgress,
	resetLickPersistence,
	getKeyProgress,
	getEffectivePracticeLickIds,
	getProgressionTags,
	isTaggedForProgression,
	backfillPracticeTags,
	initLickMetadataFromCloud,
	migrateOrphanLickCategories,
	getUnlockedKeyCount,
	bumpUnlockedKeyCount,
	shouldUnlockNextKey,
	NEW_LICK_DEFAULT_TEMPO,
	computeAutoTempoAdjustment,
	clampTempo,
	KEY_PROFICIENT_THRESHOLD,
	KEY_FLOOR_THRESHOLD
} from '$lib/persistence/lick-practice-store';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/supabase/types';
import {
	PROGRESSION_TEMPLATES,
	getSubstitutionCategories,
	resolveLickAlignmentOffset,
	resolveTransposeTarget,
	transposeProgression,
	applyPickupBarShift,
	detectPickupBars,
	extendHarmonyTail
} from '$lib/data/progressions';
import { getAllLicks, getLickById, transposeLick } from '$lib/phrases/library-loader';
import { getLickTagOverrides } from '$lib/persistence/user-licks';
import { getInstrument, getEffectiveHighestNote } from '$lib/state/settings.svelte';
import { loadLickPracticeSessions } from '$lib/persistence/lick-practice-sessions';
import {
	selectInitialProgression,
	pickProgressionForLick,
	buildUpcomingLicks,
	findStrandedLicks,
	DEFAULT_PROGRESSION,
	type UpcomingLickEntry
} from './lick-practice-picker';

export type { UpcomingLickEntry };

/**
 * Per-key pass bar — score at or above which a key counts as "passed"
 * (increments `passCount`, drives the green tier in the UI, feeds the
 * unlock gate's per-key consolidation requirement). Aliased from
 * `KEY_PROFICIENT_THRESHOLD` so the proficient bar, the pass bar, and
 * the green-tier color all share one source of truth.
 */
const PASS_THRESHOLD = KEY_PROFICIENT_THRESHOLD;

/**
 * Single-lick deep-practice mastery threshold. A key is considered mastered
 * (and dropped from the round's rotation) when one attempt scores at or
 * above this value. Matches the existing `Grade.perfect` cutoff in
 * `src/lib/scoring/grades.ts`.
 */
const MASTERY_THRESHOLD = 0.95;
/** Default tempo bump applied when all 12 keys are mastered in single-lick mode. */
const DEFAULT_TEMPO_BUMP_BPM = 5;

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
	/** 'standard' = multi-lick rotation; 'single-lick' = endless deep practice. */
	mode: 'standard' | 'single-lick';
	/** Single-lick mode: which round of the 12-key cycle the user is on (1-based). */
	roundNumber: number;
	/** Single-lick mode: keys mastered (score ≥ 0.95) so far in the current round. */
	masteredThisRound: PitchClass[];
	/** Single-lick mode: per-round mastery log, populated at end-of-round for the report. */
	roundHistory: SingleLickRoundEntry[];
}>({
	config: {
		sessionType: 'focused',
		progressionType: 'ii-V-I-major',
		durationMinutes: 15,
		practiceMode: 'continuous',
		backingStyle: 'swing',
		enableSubstitutions: false
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
	progress: {},
	mode: 'standard',
	roundNumber: 0,
	masteredThisRound: [],
	roundHistory: []
});

/**
 * Load persisted progress into state and backfill legacy practice tags.
 *
 * When a Supabase client is provided, also hydrates lick metadata from
 * the cloud (practice tags, progression tags, per-key progress, curated
 * lick overrides). This ensures cross-device sync on first visit.
 */
export async function hydrateLickPracticeProgress(
	supabase?: SupabaseClient<Database> | null
): Promise<void> {
	// Hydrate cloud metadata first so localStorage is populated before
	// we read from it below.  Swallow errors (network/auth failure) so
	// the session can still proceed with local-only data — the app is
	// local-first, cloud sync is best-effort.
	if (supabase) {
		try {
			await initLickMetadataFromCloud(supabase);
		} catch (err) {
			console.warn('Cloud hydration failed, proceeding with local data:', err);
		}
	}

	lickPractice.progress = loadLickPracticeProgress();
	// Migrate legacy 'practice' markers from lick.tags + tag overrides
	// into the new user-lick-tags store so getPracticeLicks can find them.
	backfillPracticeTags(getAllLicks(), getLickTagOverrides());
	// Repair licks still carrying orphan PhraseCategory values (e.g.
	// `long-ii-V-I-major`, removed in commit eae34f1). Each gets a valid
	// category plus an inferred `prog:*` tag so the user's original intent
	// is preserved.
	migrateOrphanLickCategories(supabase ?? undefined);

	lickPractice.config.progressionType = pickInitialProgression();
}

/**
 * Get all licks tagged for practice that match the selected progression.
 * A lick must have the 'practice' tag, and matches if either:
 *   1. It has a user-assigned progression tag for the selected progression type, OR
 *   2. Its category is a substitution source for the progression and
 *      `enableSubstitutions` is on (e.g. `minor-chord` over a `7` chord).
 *
 * Category compatibility alone is no longer an inclusion path — every lick
 * is expected to carry an explicit `prog:*` tag for every progression it
 * should play under. The setup-time backfill in `lick-practice-store` seeds
 * those tags from `getProgressionsForCategory(lick.category)` for legacy
 * licks, and `updateLickCategory` auto-adds them on every new category set.
 */
export function getPracticeLicks(): Phrase[] {
	const allLicks = getAllLicks();
	const taggedIds = getEffectivePracticeLickIds(allLicks);
	if (taggedIds.size === 0) return [];

	const progressionType = lickPractice.config.progressionType;
	const substitutionCategories = getSubstitutionCategories(
		progressionType,
		lickPractice.config.enableSubstitutions ?? false
	);

	return allLicks.filter(lick => {
		if (!taggedIds.has(lick.id)) return false;
		const matchesByProgressionTag = isTaggedForProgression(lick.id, progressionType);
		const matchesBySubstitution = substitutionCategories.includes(lick.category);
		return matchesByProgressionTag || matchesBySubstitution;
	});
}

/**
 * Practice-tagged licks with no progression mapping at all — they have
 * neither a `prog:*` tag nor a category listed in any progression. Surfaced
 * on the setup screen so the user can finish configuring them in the
 * library; otherwise they sit invisibly in the practice set forever.
 */
export function getStrandedPracticeLicks(): Phrase[] {
	const allLicks = getAllLicks();
	const taggedIds = getEffectivePracticeLickIds(allLicks);
	if (taggedIds.size === 0) return [];

	const candidates = allLicks.filter((l) => taggedIds.has(l.id));
	return findStrandedLicks({ candidates, getProgressionTags });
}

/**
 * Build the "Upcoming Licks" list for the session-complete screen — runes
 * wrapper that resolves dependencies and delegates to `buildUpcomingLicks`.
 */
export function getUpcomingLicks(): UpcomingLickEntry[] {
	const allLicks = getAllLicks();
	const taggedIds = getEffectivePracticeLickIds(allLicks);
	if (taggedIds.size === 0) return [];

	const candidates = allLicks.filter((l) => taggedIds.has(l.id));
	return buildUpcomingLicks({
		candidates,
		progress: lickPractice.progress,
		getProgressionTags
	});
}

/**
 * Thin wrapper around `selectInitialProgression` (in lick-practice-picker.ts)
 * that resolves the runtime dependencies — practice-tagged ids, full lick
 * library, current progress, session log, progression-tags lookup. The
 * algorithm itself lives in the pure helper so it can be unit-tested
 * without the runes runtime.
 */
export function pickInitialProgression(): ChordProgressionType {
	const allLicks = getAllLicks();
	const taggedIds = getEffectivePracticeLickIds(allLicks);
	if (taggedIds.size === 0) return DEFAULT_PROGRESSION;

	const candidates = allLicks.filter(l => taggedIds.has(l.id));
	return selectInitialProgression({
		candidates,
		progress: lickPractice.progress,
		sessionLog: loadLickPracticeSessions(),
		getProgressionTags
	});
}

/**
 * Resolve the starting tempo for a lick at session setup:
 *   - New lick (no practice history) → NEW_LICK_DEFAULT_TEMPO (60).
 *   - Known lick → the minimum stored tempo across its 12 keys.
 * Always clamped into the MIN_TEMPO / MAX_TEMPO range.
 */
export function resolveLickTempo(progress: LickPracticeProgress, phraseId: string): number {
	if (!hasLickProgress(progress, phraseId)) {
		return clampTempo(NEW_LICK_DEFAULT_TEMPO);
	}
	return clampTempo(getLickTempo(progress, phraseId));
}

/** Build a session plan sorted by least-recently-practiced, filling the time budget */
export function buildSessionPlan(): void {
	const licks = getPracticeLicks();
	const progress = lickPractice.progress;
	const progressionType = lickPractice.config.progressionType;
	const enableSubstitutions = lickPractice.config.enableSubstitutions ?? false;

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
		const tempo = resolveLickTempo(progress, lick.id);
		const unlockedCount = getUnlockedKeyCount(progress, lick.id);
		// Below the 12-key cap, ramp predictably from the lick's entry key by
		// alternating sharp- and flat-side neighbours on the circle of fifths,
		// so each session adds the next-easiest key by accidental count.
		// Once the lick has earned all 12 keys, hand off to planLickKeys for
		// staged variety (random starts, chromatic / whole-tone orderings).
		const keys = unlockedCount < 12
			? planUnlockedKeys(lick.key, unlockedCount)
			: planLickKeys({
					tempo,
					minBpm: NEW_LICK_DEFAULT_TEMPO,
					instrument: getInstrument()
				});
		plan.push({
			phraseId: lick.id,
			phraseName: lick.name,
			phraseNumber: i + 1,
			category: lick.category,
			keys,
			progressionType
		});
		// Mirror the runtime layout: each key consumes `keyBars` (= lickBars in
		// continuous mode, 2 × lickBars in C&R) and continuous mode prepends a
		// demo cycle of `lickBars` before the keys.
		const lickBars = getLickBars(lick, progressionType, enableSubstitutions);
		const mode = lickPractice.config.practiceMode;
		const keyBars = mode === 'call-response' ? lickBars * 2 : lickBars;
		const demoBars = mode === 'continuous' ? lickBars : 0;
		const totalBars = keys.length * keyBars + demoBars;
		estimatedTime += (totalBars * 4 * 60) / tempo + 5;
	}

	lickPractice.plan = plan;
}

/** Start the practice session */
export function startSession(): void {
	// Defensive: clear single-lick state in case the user toggled into Focused
	// from a single-lick configuration. Mirrors startDailyPracticeSession.
	lickPractice.config.singleLickId = undefined;

	buildSessionPlan();
	if (lickPractice.plan.length === 0) return;

	lickPractice.mode = 'standard';
	lickPractice.currentLickIndex = 0;
	lickPractice.currentKeyIndex = 0;
	lickPractice.keyResults = [];
	lickPractice.allAttempts = [];
	lickPractice.startTime = Date.now();
	lickPractice.elapsedSeconds = 0;
	lickPractice.roundNumber = 0;
	lickPractice.masteredThisRound = [];
	lickPractice.roundHistory = [];

	const firstItem = lickPractice.plan[0];
	lickPractice.currentTempo = resolveLickTempo(lickPractice.progress, firstItem.phraseId);

	lickPractice.phase = 'count-in';
}

/**
 * Practice-tagged licks eligible for Daily Practice: every lick with at least
 * one `prog:*` tag, regardless of which progression. Stranded licks (no tags)
 * are excluded the same way they are from the standard session filter.
 */
export function getDailyPracticeLicks(): Phrase[] {
	const allLicks = getAllLicks();
	const taggedIds = getEffectivePracticeLickIds(allLicks);
	if (taggedIds.size === 0) return [];

	return allLicks.filter(
		(lick) => taggedIds.has(lick.id) && getProgressionTags(lick.id).length > 0
	);
}

/**
 * Build a Daily Practice plan: pool every eligible lick across all tagged
 * progressions, sort least-recently-practiced first, assign each lick its
 * least-recently-practiced compatible progression, and greedily fill the
 * duration budget. Mirrors `buildSessionPlan` but rotates progressions
 * across the lick set instead of pinning to a single one.
 */
export function buildDailyPracticePlan(): void {
	const licks = getDailyPracticeLicks();
	const progress = lickPractice.progress;
	const enableSubstitutions = lickPractice.config.enableSubstitutions ?? false;
	const sessionLog = loadLickPracticeSessions();

	const sorted = [...licks].sort((a, b) => {
		const aTime = getLickLastPracticed(progress, a.id);
		const bTime = getLickLastPracticed(progress, b.id);
		return aTime - bTime;
	});

	const totalSeconds = lickPractice.config.durationMinutes * 60;
	const plan: LickPracticePlanItem[] = [];
	let estimatedTime = 0;

	for (let i = 0; i < sorted.length; i++) {
		const lick = sorted[i];
		const progressionType = pickProgressionForLick({
			lickId: lick.id,
			progressionTags: getProgressionTags(lick.id),
			sessionLog
		});
		// Defensive: `getDailyPracticeLicks` already filters out stranded licks,
		// but if the tag store drifts mid-build (e.g. another tab clears tags)
		// the picker can still return null. Skip the lick rather than crash.
		if (!progressionType) continue;

		const tempo = resolveLickTempo(progress, lick.id);
		const unlockedCount = getUnlockedKeyCount(progress, lick.id);
		const keys = unlockedCount < 12
			? planUnlockedKeys(lick.key, unlockedCount)
			: planLickKeys({
					tempo,
					minBpm: NEW_LICK_DEFAULT_TEMPO,
					instrument: getInstrument()
				});

		// Cost the lick *before* appending so the plan never overshoots the
		// configured duration budget by an extra lick. The previous loop gate
		// (`estimatedTime < totalSeconds`) only blocked the *next* iteration,
		// which let one lick that exceeded the remaining budget through.
		const lickBars = getLickBars(lick, progressionType, enableSubstitutions);
		const mode = lickPractice.config.practiceMode;
		const keyBars = mode === 'call-response' ? lickBars * 2 : lickBars;
		const demoBars = mode === 'continuous' ? lickBars : 0;
		const totalBars = keys.length * keyBars + demoBars;
		const lickSeconds = (totalBars * 4 * 60) / tempo + 5;
		if (estimatedTime + lickSeconds > totalSeconds) break;

		plan.push({
			phraseId: lick.id,
			phraseName: lick.name,
			phraseNumber: plan.length + 1,
			category: lick.category,
			keys,
			progressionType
		});
		estimatedTime += lickSeconds;
	}

	lickPractice.plan = plan;
}

/**
 * Start a Daily Practice session: rotates across every progression the user
 * has tagged licks for, filling the configured time budget. Otherwise
 * identical to `startSession` — same playback, same scoring, same unlock
 * gate. The user's selected `progressionType` on the setup page is ignored
 * for plan construction (each plan item carries its own).
 */
export function startDailyPracticeSession(): void {
	// Defensive: clear single-lick state in case the user toggled into Daily
	// Practice from a single-lick configuration.
	lickPractice.config.singleLickId = undefined;

	buildDailyPracticePlan();
	if (lickPractice.plan.length === 0) return;

	lickPractice.mode = 'standard';
	lickPractice.currentLickIndex = 0;
	lickPractice.currentKeyIndex = 0;
	lickPractice.keyResults = [];
	lickPractice.allAttempts = [];
	lickPractice.startTime = Date.now();
	lickPractice.elapsedSeconds = 0;
	lickPractice.roundNumber = 0;
	lickPractice.masteredThisRound = [];
	lickPractice.roundHistory = [];

	const firstItem = lickPractice.plan[0];
	lickPractice.currentTempo = resolveLickTempo(lickPractice.progress, firstItem.phraseId);

	lickPractice.phase = 'count-in';
}

/**
 * Circle-of-4ths rotation starting at `entryKey`, restricted to the lick's
 * per-lick unlocked-key set (the same `planUnlockedKeys` ramp Standard mode
 * uses). Used by single-lick Deep Practice so a brand-new lick starts at its
 * entry key only and grows as the per-lick unlock count bumps — Deep Practice
 * used to draw from the global tonality unlock pool, which gave new licks
 * unearned keys.
 *
 * Falls back to the full circle if the filter would yield an empty set
 * (defensive — `entryKey` is always in the unlocked set, so this only
 * triggers if `planUnlockedKeys` is somehow malformed).
 */
function unlockedCircleFrom(entryKey: PitchClass, unlockedCount: number): PitchClass[] {
	const unlocked = new Set(planUnlockedKeys(entryKey, unlockedCount));
	const filtered = circleOfFourthsFrom(entryKey).filter(k => unlocked.has(k));
	return filtered.length > 0 ? filtered : circleOfFourthsFrom(entryKey);
}

/**
 * Start a single-lick deep-practice session: cycle the chosen lick through
 * its per-lick unlocked keys (in circle-of-4ths order from the lick's home
 * key), drop keys at score ≥ 0.95, bump tempo by `tempoBumpBpm` once the
 * set is cleared, and repeat until the user ends the session.
 *
 * The session has no time budget — `durationMinutes` is ignored. Mastery
 * does NOT persist between sessions (each visit re-starts with the unlocked
 * set), but the elevated tempo IS persisted via `LickPracticeKeyProgress.currentTempo`.
 * Refills re-read the per-lick unlock count, so any unlocks earned in a
 * Standard-mode session between rounds join on the next cycle.
 */
export function startSingleLickSession(
	lickOrId: string | Phrase,
	tempoBumpBpm: number = DEFAULT_TEMPO_BUMP_BPM
): boolean {
	const lick = typeof lickOrId === 'string' ? getLickById(lickOrId) : lickOrId;
	if (!lick) return false;

	lickPractice.config.singleLickId = lick.id;
	lickPractice.config.tempoBumpBpm = tempoBumpBpm;

	const unlockedCount = getUnlockedKeyCount(lickPractice.progress, lick.id);
	lickPractice.plan = [
		{
			phraseId: lick.id,
			phraseName: lick.name,
			phraseNumber: 1,
			category: lick.category,
			keys: unlockedCircleFrom(lick.key, unlockedCount),
			progressionType: lickPractice.config.progressionType,
			// Persist the resolved Phrase so the helpers below survive a
			// `getLickById` miss for user/community licks not (yet) indexed
			// in the global library.
			phrase: lick
		}
	];

	lickPractice.mode = 'single-lick';
	lickPractice.currentLickIndex = 0;
	lickPractice.currentKeyIndex = 0;
	lickPractice.keyResults = [];
	lickPractice.allAttempts = [];
	lickPractice.startTime = Date.now();
	lickPractice.elapsedSeconds = 0;
	lickPractice.roundNumber = 1;
	lickPractice.masteredThisRound = [];
	lickPractice.roundHistory = [];
	lickPractice.currentTempo = resolveLickTempo(lickPractice.progress, lick.id);

	lickPractice.phase = 'count-in';
	return true;
}

/** Get the current plan item */
export function getCurrentPlanItem(): LickPracticePlanItem | null {
	return lickPractice.plan[lickPractice.currentLickIndex] ?? null;
}

/**
 * Progression in play right now. Daily Practice sessions mix progressions
 * across plan items, so the UI (header label, substitution detection, chord
 * chart) must read from the active plan item rather than `config.progressionType`,
 * which only reflects the user's setup-page selection for standard sessions.
 * Falls back to the config value when no plan is loaded yet (e.g. setup phase).
 */
export function getCurrentProgressionType(): ChordProgressionType {
	return getCurrentPlanItem()?.progressionType ?? lickPractice.config.progressionType;
}

/**
 * Resolve the underlying Phrase for a plan item, preferring the live library
 * lookup so curated edits propagate, and falling back to the Phrase persisted
 * on the item at plan-build time. The fallback matters for user/community
 * licks that may not be in `getAllLicks()` when a helper runs.
 */
function resolveLickFor(item: LickPracticePlanItem): Phrase | undefined {
	return getLickById(item.phraseId) ?? item.phrase;
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
	return buildPhraseFor(item.phraseId, key, item.progressionType, item.phrase);
}

/**
 * Pure variant of getCurrentPhrase that takes explicit indices instead
 * of reading currentLickIndex/currentKeyIndex.  Use this when scoring
 * a key that has just finished — the "current" indices may have already
 * advanced to the next key by the time scoring runs.
 */
export function getPhraseFor(lickIdx: number, keyIdx: number): Phrase | null {
	const item = lickPractice.plan[lickIdx];
	if (!item) return null;
	const key = item.keys[keyIdx];
	if (!key) return null;
	return buildPhraseFor(item.phraseId, key, item.progressionType, item.phrase);
}

/** Get the transposed harmony for the current key (for ChordChart). Includes
 *  the per-lick tail extension if the current lick stretches the cycle. */
export function getCurrentHarmony(): HarmonicSegment[] {
	const key = getCurrentKey();
	if (!key) return [];
	const item = getCurrentPlanItem();
	const itemProgression = item?.progressionType ?? lickPractice.config.progressionType;
	const lick = item ? resolveLickFor(item) : undefined;
	if (!lick) {
		const template = PROGRESSION_TEMPLATES[itemProgression];
		return transposeProgression(template.harmony, key);
	}
	return harmonyForLick(
		lick,
		key,
		itemProgression,
		lickPractice.config.enableSubstitutions ?? false
	);
}

/**
 * Build the transposed phrase + harmony for a given lick/key combo.
 * Shared by getCurrentPhrase and the lookahead accessors so they all
 * transpose identically.
 *
 * If the lick's category has an alignment offset configured for the given
 * progression (e.g. a 2-bar V-I lick inside a 4-bar ii-V-I long), every
 * melody note is shifted by that offset so it lands on the matching bar of
 * the parent progression. Harmony always comes from the progression template
 * — the lick's intrinsic harmony is discarded.
 *
 * `progressionType` is passed in (rather than read from config) so callers
 * can resolve it from the relevant plan item. Daily Practice sessions assign
 * each lick its own progression, so it can change from one plan item to the
 * next within a single session.
 */
function buildPhraseFor(
	lickId: string,
	key: PitchClass,
	progressionType: ChordProgressionType,
	fallback?: Phrase
): Phrase | null {
	const baseLick = getLickById(lickId) ?? fallback;
	if (!baseLick) return null;

	const enableSubstitutions = lickPractice.config.enableSubstitutions ?? false;
	// Two alignment offsets, both needed:
	// - `alignmentOffset` (pickup-shifted) places the melody's notes inside the
	//   progression cycle so the pickup falls on V where applicable.
	// - `bodyAlignment` (un-shifted) is what `resolveTransposeTarget` reads to
	//   pick the lick's body chord — using the shifted version here would
	//   transpose the lick to the pickup chord (e.g. G7) instead of its
	//   intended target (e.g. Cmaj7).
	const alignmentOffset = resolveAlignedLickOffset(baseLick, progressionType, enableSubstitutions);
	const bodyAlignment = resolveLickAlignmentOffset(progressionType, baseLick.category, enableSubstitutions);

	// Chord-quality licks (e.g. a 1-bar `minor-chord` lick) are rooted on a
	// single chord. They must transpose to the ROOT of the target chord in
	// the progression, not the session key — otherwise a Cm7 lick placed at
	// the ii of an F ii-V-I would play in Fm7 instead of Gm7.
	//
	// When a substitution rule applies (e.g. minor-over-dominant), the target
	// root is then shifted by the rule's semitone offset — a Cm7 lick played
	// over G7 transposes to Ab, producing Abm7 over G7 for altered sonority.
	const transposeTarget = resolveTransposeTarget(
		key,
		baseLick.category,
		progressionType,
		bodyAlignment,
		enableSubstitutions
	);

	const instrument = getInstrument();
	const transposed = transposeLick(
		baseLick,
		transposeTarget,
		instrument.concertRangeLow,
		getEffectiveHighestNote()
	);

	const progressionHarmony = harmonyForLick(baseLick, key, progressionType, enableSubstitutions);

	const alignedNotes = alignmentOffset[0] === 0
		? transposed.notes
		: transposed.notes.map(n => ({
			...n,
			offset: addFractions(n.offset, alignmentOffset)
		}));

	// The session's "key" is driven by the progression, not the chord-quality
	// lick's transposition target, so restore it on the returned phrase.
	return { ...transposed, key, notes: alignedNotes, harmony: progressionHarmony };
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
			const phrase = buildPhraseFor(item.phraseId, key, item.progressionType, item.phrase);
			if (!phrase) return null;
			return {
				lickIndex: lickIdx,
				keyIndex: keyIdx,
				key,
				phrase,
				harmony: phrase.harmony,
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

	const result: PlannedKey[] = [];
	for (let i = 0; i < item.keys.length; i++) {
		const key = item.keys[i];
		const phrase = buildPhraseFor(item.phraseId, key, item.progressionType, item.phrase);
		if (!phrase) continue;
		result.push({
			lickIndex: lickIdx,
			keyIndex: i,
			key,
			phrase,
			harmony: phrase.harmony,
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

	const baseLick = resolveLickFor(item);
	if (!baseLick) return null;

	const progressionType = item.progressionType;
	const enableSubstitutions = lickPractice.config.enableSubstitutions ?? false;
	const mode = lickPractice.config.practiceMode;
	// Per-lick cycle length: equals the progression's bar count for licks
	// that fit, otherwise extends to host a long lick's pickup + tail.
	const lickBars = getLickBars(baseLick, progressionType, enableSubstitutions);
	const keyBars = mode === 'call-response' ? lickBars * 2 : lickBars;
	const demoBars = mode === 'continuous' ? lickBars : 0;
	const instrument = getInstrument();
	const highestNote = getEffectiveHighestNote();

	// Shift applied to every melody note so short-form licks (e.g. a 2-bar
	// V-I lick inside a 4-bar ii-V-I) land on the matching bar of the
	// progression cycle. `[0, 1]` means no shift. The resolver also pulls
	// the alignment back by the lick's `pickupBars` so the bulk lands on
	// the same chord as the no-pickup variant of its category. Substitutions
	// fall through to the substitution target chord's offset.
	const alignmentOffset = resolveAlignedLickOffset(baseLick, progressionType, enableSubstitutions);
	// Transposition reads the un-shifted alignment so the lick transposes to
	// its body chord (e.g. the I), not the pickup chord (e.g. the V).
	const bodyAlignment = resolveLickAlignmentOffset(progressionType, baseLick.category, enableSubstitutions);

	// For chord-quality licks, transpose to the target chord's root rather
	// than the session key (see buildPhraseFor for the rationale). When a
	// substitution rule applies, the resolver shifts the root by the rule's
	// semitone offset.
	const targetFor = (sessionKey: PitchClass): PitchClass =>
		resolveTransposeTarget(
			sessionKey,
			baseLick.category,
			progressionType,
			bodyAlignment,
			enableSubstitutions
		);

	const superHarmony: HarmonicSegment[] = [];
	const superNotes: Note[] = [];

	// Continuous-mode demo: the app plays the lick once in keys[0] before
	// the user starts. The lick's notes go in at offset [0, lengthBars] and
	// the harmony for keys[0] goes in at offset [0, P]. The user phase below
	// is then shifted by `demoBars`.
	if (mode === 'continuous') {
		const firstKey = item.keys[0];
		const demoHarmony = harmonyForLick(baseLick, firstKey, progressionType, enableSubstitutions);
		for (const seg of demoHarmony) {
			// startOffset is already in [0, P) for a single progression cycle,
			// so the demo segments land directly at the start of the phrase.
			superHarmony.push({ ...seg });
		}
		const demoLick = transposeLick(
			baseLick,
			targetFor(firstKey),
			instrument.concertRangeLow,
			highestNote
		);
		for (const note of demoLick.notes) {
			superNotes.push({
				...note,
				offset: addFractions(note.offset, alignmentOffset)
			});
		}
	}

	for (let i = 0; i < item.keys.length; i++) {
		const key = item.keys[i];
		// Continuous mode shifts user keys by `demoBars` to leave room for the
		// demo at the start. C&R mode is unaffected (demoBars = 0).
		const keyOffsetWhole: Fraction = [i * keyBars + demoBars, 1];
		const keyHarmony = harmonyForLick(baseLick, key, progressionType, enableSubstitutions);

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
			const userBarsOffset: Fraction = [i * keyBars + lickBars, 1];
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
				targetFor(key),
				instrument.concertRangeLow,
				highestNote
			);
			for (const note of transposed.notes) {
				superNotes.push({
					...note,
					offset: addFractions(
						addFractions(note.offset, alignmentOffset),
						keyOffsetWhole
					)
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
 * Resolve the per-lick alignment offset, including the `pickupBars` shift.
 * Returns the category's base alignment shifted left by the lick's pickup
 * bars (clamped at the start of the progression).
 *
 * Falls back to inferring pickupBars from note positions when the field is
 * absent — this keeps user/community licks authored before the field
 * existed working correctly without forcing a re-save.
 */
function resolveAlignedLickOffset(
	lick: Phrase,
	progressionType: ChordProgressionType,
	enableSubstitutions: boolean
): Fraction {
	const base = resolveLickAlignmentOffset(progressionType, lick.category, enableSubstitutions);
	const pickupBars = lick.difficulty.pickupBars ?? detectPickupBars(lick.notes);
	return applyPickupBarShift(base, pickupBars);
}

/**
 * Number of bars one cycle of this lick occupies in the current progression.
 * Equals `progressionBars` for licks that fit inside the cycle, otherwise
 * extends to `alignmentBars + lengthBars` so the lick's resolution note fits.
 *
 * Call sites use this to (a) stretch the per-key window when a lick is
 * longer than the progression cycle, and (b) lengthen the progression's
 * final chord through the tail so the harmony underneath stays consistent.
 */
export function getLickBars(
	lick: Phrase,
	progressionType: ChordProgressionType,
	enableSubstitutions: boolean
): number {
	const template = PROGRESSION_TEMPLATES[progressionType];
	const alignment = resolveAlignedLickOffset(lick, progressionType, enableSubstitutions);
	const alignmentBars = Math.ceil(alignment[0] / alignment[1]);
	const required = alignmentBars + lick.difficulty.lengthBars;
	return Math.max(template.bars, required);
}

/** lickBars for the lick currently at the head of the plan, or progressionBars
 *  when no plan exists yet. */
function getCurrentLickBars(): number {
	const item = getCurrentPlanItem();
	const progressionType = item?.progressionType ?? lickPractice.config.progressionType;
	const template = PROGRESSION_TEMPLATES[progressionType];
	if (!item) return template.bars;
	const lick = resolveLickFor(item);
	if (!lick) return template.bars;
	return getLickBars(
		lick,
		progressionType,
		lickPractice.config.enableSubstitutions ?? false
	);
}

/**
 * Transpose the current progression's harmony to the given key, with the
 * lick-specific tail extension applied (final chord sustained through any
 * extra bars the lick needs).
 */
function harmonyForLick(
	lick: Phrase,
	key: PitchClass,
	progressionType: ChordProgressionType,
	enableSubstitutions: boolean
): HarmonicSegment[] {
	const template = PROGRESSION_TEMPLATES[progressionType];
	const lickBars = getLickBars(lick, progressionType, enableSubstitutions);
	const extended = extendHarmonyTail(template.harmony, lickBars - template.bars);
	return transposeProgression(extended, key);
}

/**
 * Number of bars each key occupies for the current lick + practice mode.
 * Continuous: lickBars (the lick's effective cycle, ≥ progressionBars).
 * Call-response: 2 × lickBars (app phase + user response).
 */
export function getKeyBars(): number {
	const lickBars = getCurrentLickBars();
	return lickPractice.config.practiceMode === 'call-response'
		? lickBars * 2
		: lickBars;
}

/**
 * Number of bars in the chord progression cycle. Used in call-response
 * mode as the offset between the app's playing bars and the user's
 * response bars within a single key.
 */
export function getProgressionBars(): number {
	const item = getCurrentPlanItem();
	const progressionType = item?.progressionType ?? lickPractice.config.progressionType;
	return PROGRESSION_TEMPLATES[progressionType].bars;
}

/**
 * Record the result of the current key attempt silently — does not change
 * the session phase. The bar-aligned scheduler in the session page drives
 * phase transitions; this function only updates keyResults and writes
 * per-key progress for passed attempts.
 */
export function recordKeyAttempt(score: Score, sessionId?: string): void {
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
		tempo: lickPractice.currentTempo,
		sessionId
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

	// Single-lick deep practice: track keys cleared at "close to perfect" so
	// they can be removed from the rotation at end-of-round.
	if (
		lickPractice.mode === 'single-lick' &&
		score.overall >= MASTERY_THRESHOLD &&
		!lickPractice.masteredThisRound.includes(key)
	) {
		lickPractice.masteredThisRound = [...lickPractice.masteredThisRound, key];
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
 * Archives the lick's results, applies the always-on score-weighted tempo
 * adjustment (average score across attempted keys → signed delta via
 * computeAutoTempoAdjustment, clamped, persisted to every key in the lick),
 * and either advances currentLickIndex or marks the session complete.
 * Called by the scheduler at the start of the 2-bar inter-lick rest.
 *
 * If the lick had no scored keys (e.g. session ended before any attempt
 * landed), the tempo is left unchanged — an empty result set carries no
 * signal about how the user performed.
 */
export function startInterLickTransition(): 'next-lick' | 'complete' {
	const item = getCurrentPlanItem();
	if (item) {
		// Archive results for session report
		lickPractice.allAttempts.push([...lickPractice.keyResults]);

		// Score-weighted tempo adjustment. Skipped when keyResults is empty
		// because avgScore would default to 0 and produce a spurious -3 BPM
		// nudge for a lick the user didn't actually play.
		if (lickPractice.keyResults.length > 0) {
			const totalScore = lickPractice.keyResults.reduce((s, r) => s + r.score, 0);
			const avgScore = totalScore / lickPractice.keyResults.length;
			const worstScore = Math.min(...lickPractice.keyResults.map(r => r.score));
			// Per-key floor: if the weakest played key fell below KEY_FLOOR_THRESHOLD,
			// advancement (both tempo bump and key unlock) is blocked. The avg can't
			// drag a single weak key along — the user has to bring it up first.
			// Tempo decreases are still allowed so a genuinely bad session still slows.
			const floorBreached = worstScore < KEY_FLOOR_THRESHOLD;
			const rawDelta = computeAutoTempoAdjustment(avgScore);
			const delta = floorBreached ? Math.min(0, rawDelta) : rawDelta;

			// Bump unlock BEFORE writing progress for this session's keys.
			// The grandfather fallback in getUnlockedKeyCount treats a lick
			// with any per-key progress as already at 12 — if we bumped after
			// the writes, even a brand-new lick (just one entry-key result)
			// would look "grandfathered" and stay capped at 12.
			//
			// Unlock requires a strong session AND consolidation on the
			// most-recently-unlocked key (passCount, already updated by
			// recordKeyAttempt during the lick) AND no per-key floor breach
			// this session — see shouldUnlockNextKey.
			const unlockedCount = getUnlockedKeyCount(lickPractice.progress, item.phraseId);
			const newestKey = item.keys[item.keys.length - 1];
			const newestKeyPassCount = getKeyProgress(
				lickPractice.progress,
				item.phraseId,
				newestKey
			).passCount;
			if (
				!floorBreached &&
				shouldUnlockNextKey({ avgScore, newestKeyPassCount, unlockedCount })
			) {
				bumpUnlockedKeyCount(lickPractice.progress, item.phraseId);
			}

			const newTempo = clampTempo(lickPractice.currentTempo + delta);
			const now = Date.now();
			for (const key of item.keys) {
				lickPractice.progress = updateKeyProgress(
					lickPractice.progress,
					item.phraseId,
					key,
					{ currentTempo: newTempo, lastPracticedAt: now }
				);
			}
			saveLickPracticeProgress(lickPractice.progress);
		}

		// Clear on both paths so getSessionReport's "include in-progress lick"
		// fallback (which reads from keyResults) doesn't phantom-attribute
		// this lick's results to a plan slot that was never started — matters
		// when the complete path is taken mid-plan due to time-up.
		lickPractice.keyResults = [];
	}

	const timeUp = lickPractice.elapsedSeconds >= lickPractice.config.durationMinutes * 60;

	if (lickPractice.currentLickIndex < lickPractice.plan.length - 1 && !timeUp) {
		lickPractice.currentLickIndex++;
		lickPractice.currentKeyIndex = 0;

		const nextItem = getCurrentPlanItem();
		if (nextItem) {
			lickPractice.currentTempo = resolveLickTempo(lickPractice.progress, nextItem.phraseId);
		}
		lickPractice.phase = 'inter-lick-rest';
		return 'next-lick';
	}

	lickPractice.phase = 'complete';
	return 'complete';
}

/**
 * Single-lick deep-practice end-of-round transition.
 *
 * Drops keys mastered (score ≥ 0.95) during this round from the rotation,
 * archives the round's results to `allAttempts`, and:
 *   - If any keys remain, the next round cycles through the survivors at
 *     the same tempo.
 *   - If all 12 keys cleared, the tempo bumps by `config.tempoBumpBpm` (or
 *     the default of 5 BPM), the rotation refills with a fresh circle of
 *     4ths from the lick's home key, and a new round begins.
 *
 * Mutates `plan[0].keys` so `buildLickSuperPhrase` and `getCurrentPhrase`
 * see the updated active-key list on the next cycle.
 */
export function advanceSingleLickRound(): void {
	const item = lickPractice.plan[0];
	if (!item) return;

	// Archive results for the session report.
	lickPractice.allAttempts.push([...lickPractice.keyResults]);
	lickPractice.keyResults = [];

	// Capture which keys cleared this round (in their original rotation order)
	// so the report can show the per-round breakdown.
	const masteredInOrder = item.keys.filter(k => lickPractice.masteredThisRound.includes(k));
	lickPractice.roundHistory.push({
		round: lickPractice.roundNumber,
		tempo: lickPractice.currentTempo,
		keys: masteredInOrder
	});

	// Drop mastered keys from the active rotation.
	const survivors = item.keys.filter(k => !lickPractice.masteredThisRound.includes(k));

	if (survivors.length === 0) {
		// Whole unlocked set cleared at the current tempo — bump and refill.
		// Re-read the per-lick unlock count so any keys earned in a Standard
		// session between rounds join on this cycle.
		const bump = lickPractice.config.tempoBumpBpm ?? DEFAULT_TEMPO_BUMP_BPM;
		const newTempo = clampTempo(lickPractice.currentTempo + bump);
		const baseLick = resolveLickFor(item);
		const refillStart = baseLick?.key ?? item.keys[0] ?? 'C';
		const unlockedCount = getUnlockedKeyCount(lickPractice.progress, item.phraseId);
		const fullCircle = unlockedCircleFrom(refillStart as PitchClass, unlockedCount);

		// Persist the elevated tempo to every key for this lick so the next
		// session resumes at this BPM (mirrors the per-key write the standard
		// flow does at inter-lick rest).
		const now = Date.now();
		for (const key of fullCircle) {
			lickPractice.progress = updateKeyProgress(
				lickPractice.progress,
				item.phraseId,
				key,
				{ currentTempo: newTempo, lastPracticedAt: now }
			);
		}
		saveLickPracticeProgress(lickPractice.progress);

		lickPractice.currentTempo = newTempo;
		item.keys = fullCircle;
	} else {
		item.keys = survivors;
	}

	lickPractice.masteredThisRound = [];
	lickPractice.currentKeyIndex = 0;
	lickPractice.roundNumber += 1;
	lickPractice.phase = 'inter-lick-rest';
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
	lickPractice.mode = 'standard';
	lickPractice.roundNumber = 0;
	lickPractice.masteredThisRound = [];
	lickPractice.roundHistory = [];
	lickPractice.config.singleLickId = undefined;
}

/**
 * Full-reset a single lick's practice progress back to never-practiced:
 * clears its per-key progress and unlock count (tempo → 60, passCounts → 0,
 * one unlocked key). Reassigns the reactive `progress` rune so both the report
 * and the library detail page re-render. `phraseId` must be the base lick id.
 */
export function resetLick(phraseId: string): void {
	lickPractice.progress = resetLickPersistence(lickPractice.progress, phraseId);
}

/** Build the end-of-session report from archived attempts */
export function getSessionReport(): SessionReport {
	// Include in-progress results (when session ends mid-lick / mid-round)
	const allLickResults: LickPracticeKeyResult[][] = [...lickPractice.allAttempts];
	if (lickPractice.keyResults.length > 0) {
		allLickResults.push([...lickPractice.keyResults]);
	}

	if (lickPractice.mode === 'single-lick') {
		return buildSingleLickReport(allLickResults);
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
			passed: r.passed,
			sessionId: r.sessionId
		}));

		const totalScore = keys.reduce((s, k) => s + k.score, 0);
		const averageScore = keys.length > 0 ? totalScore / keys.length : 0;
		const passedCount = keys.filter(k => k.passed).length;
		// Tempo is the one used for the first attempt (all keys share it within a lick)
		const tempo = results[0]?.tempo ?? lickPractice.currentTempo;

		// Read the persisted tempo to detect if it was adjusted.
		// Only compare when progress exists — getLickTempo returns a store
		// default for brand-new licks which would produce a bogus delta.
		const hasProgress = hasLickProgress(lickPractice.progress, item.phraseId);
		const persistedTempo = hasProgress ? getLickTempo(lickPractice.progress, item.phraseId) : tempo;
		const newTempo = persistedTempo !== tempo ? persistedTempo : null;

		licks.push({
			lickId: item.phraseId,
			lickName: item.phraseName,
			tempo,
			newTempo,
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

/**
 * Single-lick mode report: every round's attempts roll up into a single
 * `LickReport`, and the round-level breakdown rides on the new
 * `roundsCompleted` / `finalTempo` / `keysMasteredByRound` fields so the UI
 * can render a per-round summary without conflating rounds with separate
 * licks.
 */
function buildSingleLickReport(allLickResults: LickPracticeKeyResult[][]): SessionReport {
	const item = lickPractice.plan[0];
	const flat: LickPracticeKeyResult[] = allLickResults.flat();
	const keys = flat.map(r => ({
		key: r.key,
		score: r.score,
		pitchAccuracy: r.pitchAccuracy,
		rhythmAccuracy: r.rhythmAccuracy,
		passed: r.passed,
		sessionId: r.sessionId
	}));

	const totalScore = keys.reduce((s, k) => s + k.score, 0);
	const averageScore = keys.length > 0 ? totalScore / keys.length : 0;
	const passedCount = keys.filter(k => k.passed).length;
	const startTempo = flat[0]?.tempo ?? lickPractice.currentTempo;
	const finalTempo = lickPractice.currentTempo;

	// Always set newTempo when it changed during the session so the UI can
	// surface the delta — single-lick is the rare flow where tempo can rise
	// mid-session, not just between licks.
	const licks: LickReport[] = item
		? [
				{
					lickId: item.phraseId,
					lickName: item.phraseName,
					tempo: startTempo,
					newTempo: finalTempo !== startTempo ? finalTempo : null,
					keys,
					averageScore,
					passedCount
				}
			]
		: [];

	// roundNumber points at the next-round-to-start, so completed = roundNumber - 1
	// (clamped at 0 if the user exits before the first round wraps).
	const roundsCompleted = Math.max(0, lickPractice.roundNumber - 1);

	return {
		licks,
		overallAverage: averageScore,
		totalAttempts: keys.length,
		totalPassed: passedCount,
		elapsedMinutes: Math.round(lickPractice.elapsedSeconds / 60),
		roundsCompleted,
		finalTempo,
		keysMasteredByRound: [...lickPractice.roundHistory]
	};
}
