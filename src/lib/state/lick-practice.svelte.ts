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
 * report. No retries. At the end of each lick, the average score across the
 * attempted keys is fed through `computeAutoTempoAdjustment` to produce a
 * signed BPM delta (+5/+2/−1/−3). That delta is added to the current tempo,
 * clamped to [MIN_TEMPO, MAX_TEMPO], and persisted for every key in the lick
 * so the whole set ratchets up or down together based on overall performance.
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
	SessionReport
} from '$lib/types/lick-practice';
import type { Score } from '$lib/types/scoring';
import { addFractions } from '$lib/music/intervals';
import { planLickKeys, planUnlockedKeys } from '$lib/music/key-ordering';
import {
	loadLickPracticeProgress,
	saveLickPracticeProgress,
	getLickTempo,
	getLickLastPracticed,
	hasLickProgress,
	updateKeyProgress,
	getPracticeTaggedIds,
	getProgressionTags,
	isTaggedForProgression,
	backfillPracticeTags,
	backfillInferredProgressionTags,
	initLickMetadataFromCloud,
	migrateOrphanLickCategories,
	getUnlockedKeyCount,
	bumpUnlockedKeyCount,
	NEW_LICK_DEFAULT_TEMPO,
	computeAutoTempoAdjustment,
	clampTempo
} from '$lib/persistence/lick-practice-store';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/supabase/types';
import {
	PROGRESSION_TEMPLATES,
	getCompatibleLickCategories,
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
	buildUpcomingLicks,
	findStrandedLicks,
	DEFAULT_PROGRESSION,
	type UpcomingLickEntry
} from './lick-practice-picker';

export type { UpcomingLickEntry };

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
	progress: {}
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
	// Retroactive auto-tag for licks categorized before the
	// `updateLickCategory` hook existed. Idempotent — covers existing data
	// once and is a no-op thereafter.
	backfillInferredProgressionTags();

	lickPractice.config.progressionType = pickInitialProgression();
}

/**
 * Get all licks tagged for practice that match the selected progression.
 * A lick must have the 'practice' tag, and matches if either:
 *   1. Its curated category is compatible with the progression, OR
 *   2. It has a user-assigned progression tag for the selected progression type, OR
 *   3. Its category is a substitution source for the progression and
 *      `enableSubstitutions` is on (e.g. `minor-chord` over a `7` chord).
 */
export function getPracticeLicks(): Phrase[] {
	const taggedIds = getPracticeTaggedIds();
	if (taggedIds.size === 0) return [];

	const progressionType = lickPractice.config.progressionType;
	const compatibleCategories = getCompatibleLickCategories(progressionType);
	const substitutionCategories = getSubstitutionCategories(
		progressionType,
		lickPractice.config.enableSubstitutions ?? false
	);
	const allLicks = getAllLicks();

	return allLicks.filter(lick => {
		if (!taggedIds.has(lick.id)) return false;
		const matchesByCategory = compatibleCategories.includes(lick.category);
		const matchesByProgressionTag = isTaggedForProgression(lick.id, progressionType);
		const matchesBySubstitution = substitutionCategories.includes(lick.category);
		return matchesByCategory || matchesByProgressionTag || matchesBySubstitution;
	});
}

/**
 * Practice-tagged licks with no progression mapping at all — they have
 * neither a `prog:*` tag nor a category listed in any progression. Surfaced
 * on the setup screen so the user can finish configuring them in the
 * library; otherwise they sit invisibly in the practice set forever.
 */
export function getStrandedPracticeLicks(): Phrase[] {
	const taggedIds = getPracticeTaggedIds();
	if (taggedIds.size === 0) return [];

	const candidates = getAllLicks().filter((l) => taggedIds.has(l.id));
	return findStrandedLicks({ candidates, getProgressionTags });
}

/**
 * Build the "Upcoming Licks" list for the session-complete screen — runes
 * wrapper that resolves dependencies and delegates to `buildUpcomingLicks`.
 */
export function getUpcomingLicks(): UpcomingLickEntry[] {
	const taggedIds = getPracticeTaggedIds();
	if (taggedIds.size === 0) return [];

	const candidates = getAllLicks().filter((l) => taggedIds.has(l.id));
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
	const taggedIds = getPracticeTaggedIds();
	if (taggedIds.size === 0) return DEFAULT_PROGRESSION;

	const candidates = getAllLicks().filter(l => taggedIds.has(l.id));
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
		// Below the 12-key cap, ramp predictably along the circle of fifths
		// from the lick's entry key so each session adds exactly one neighbour.
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
			keys
		});
		// Mirror the runtime layout: each key consumes `keyBars` (= lickBars in
		// continuous mode, 2 × lickBars in C&R) and continuous mode prepends a
		// demo cycle of `lickBars` before the keys.
		const lickBars = getLickBars(
			lick,
			lickPractice.config.progressionType,
			lickPractice.config.enableSubstitutions ?? false
		);
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
	buildSessionPlan();
	if (lickPractice.plan.length === 0) return;

	lickPractice.currentLickIndex = 0;
	lickPractice.currentKeyIndex = 0;
	lickPractice.keyResults = [];
	lickPractice.allAttempts = [];
	lickPractice.startTime = Date.now();
	lickPractice.elapsedSeconds = 0;

	const firstItem = lickPractice.plan[0];
	lickPractice.currentTempo = resolveLickTempo(lickPractice.progress, firstItem.phraseId);

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
	return buildPhraseFor(item.phraseId, key);
}

/** Get the transposed harmony for the current key (for ChordChart). Includes
 *  the per-lick tail extension if the current lick stretches the cycle. */
export function getCurrentHarmony(): HarmonicSegment[] {
	const key = getCurrentKey();
	if (!key) return [];
	const item = getCurrentPlanItem();
	const lick = item ? getLickById(item.phraseId) : undefined;
	if (!lick) {
		const template = PROGRESSION_TEMPLATES[lickPractice.config.progressionType];
		return transposeProgression(template.harmony, key);
	}
	return harmonyForLick(
		lick,
		key,
		lickPractice.config.progressionType,
		lickPractice.config.enableSubstitutions ?? false
	);
}

/**
 * Build the transposed phrase + harmony for a given lick/key combo.
 * Shared by getCurrentPhrase and the lookahead accessors so they all
 * transpose identically.
 *
 * If the lick's category has an alignment offset configured for the current
 * progression (e.g. a 2-bar V-I lick inside a 4-bar ii-V-I long), every
 * melody note is shifted by that offset so it lands on the matching bar of
 * the parent progression. Harmony always comes from the progression template
 * — the lick's intrinsic harmony is discarded.
 */
function buildPhraseFor(lickId: string, key: PitchClass): Phrase | null {
	const baseLick = getLickById(lickId);
	if (!baseLick) return null;

	const progressionType = lickPractice.config.progressionType;
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
			const phrase = buildPhraseFor(item.phraseId, key);
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
		const phrase = buildPhraseFor(item.phraseId, key);
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

	const baseLick = getLickById(item.phraseId);
	if (!baseLick) return null;

	const progressionType = lickPractice.config.progressionType;
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
	const template = PROGRESSION_TEMPLATES[lickPractice.config.progressionType];
	const item = getCurrentPlanItem();
	if (!item) return template.bars;
	const lick = getLickById(item.phraseId);
	if (!lick) return template.bars;
	return getLickBars(
		lick,
		lickPractice.config.progressionType,
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
	return PROGRESSION_TEMPLATES[lickPractice.config.progressionType].bars;
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
			const delta = computeAutoTempoAdjustment(avgScore);

			// Bump unlock BEFORE writing progress for this session's keys.
			// The grandfather fallback in getUnlockedKeyCount treats a lick
			// with any per-key progress as already at 12 — if we bumped after
			// the writes, even a brand-new lick (just one entry-key result)
			// would look "grandfathered" and stay capped at 12.
			if (delta > 0) {
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
