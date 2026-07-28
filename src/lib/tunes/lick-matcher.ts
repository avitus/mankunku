import type { Fraction, Phrase, PhraseCategory, PitchClass } from '$lib/types/music';
import type {
	ChordProgressionType,
	ChordSubstitutionRule,
	LickPracticeProgress
} from '$lib/types/lick-practice';
import type { Tune } from '$lib/types/tune';
import type { DetectedProgression, DetectedSlot } from './progression-detector';
import {
	PROGRESSION_LICK_CATEGORIES,
	getActiveSubstitution,
	getCompatibleLickCategories,
	resolveLickAlignmentOffset,
	resolveTransposeTarget
} from '$lib/data/progressions';
import { compareFractions, fractionToFloat } from '$lib/music/intervals';
import { planUnlockedKeys } from '$lib/music/key-ordering';
import { baseLickId, getAllLicks } from '$lib/phrases/library-loader';
import {
	getEffectivePracticeLickIds,
	getProgressionTags,
	getUnlockedKeyCount,
	hasLickProgress,
	loadLickPracticeProgress
} from '$lib/persistence/lick-practice-store';

/**
 * Bridge from detected tune progressions to ranked, mastery-aware lick
 * suggestions. Pure core over injected deps (`LickMatcherDeps`) so tests can
 * fake the pool and stores; `buildLickMatcherDeps` is the ONLY function that
 * touches persistence, and it imports loaders exclusively — never the store's
 * setters, which enqueue cloud pushes.
 *
 * Eligibility keys off `prog:*` tags first: category *overrides* are
 * write-only at read time (`getLickCategoryOverrides` has no read-time
 * consumer), so a user's re-categorization survives only as the auto-seeded
 * prog tags. A lick's inline `category` remains a valid secondary signal for
 * curated licks; category-'user' licks with no prog tags land in the
 * `uncategorized` bucket so they surface as needs-setup instead of silently
 * failing to match.
 */

export type MasteryTier = 'known' | 'learning' | 'unknown';
export type MatchSource = 'prog-tag' | 'category' | 'substitution';

export interface LickSuggestion {
	lickId: string;
	lickName: string;
	category: PhraseCategory;
	/** Concert pitch to transpose the lick to for this insertion point. */
	targetKey: PitchClass;
	/** Absolute tune offset (whole notes) where the lick's slot begins. */
	insertionOffset: Fraction;
	/** 0-based bar of `insertionOffset` in the tune's meter. */
	insertionBar: number;
	/** Template-space alignment used (`resolveLickAlignmentOffset` result). */
	templateAlignmentOffset: Fraction;
	masteryTier: MasteryTier;
	/** Every eligibility path that applied; `[0]` is the strongest. */
	matchSources: MatchSource[];
	/** Non-null when playing via `CHORD_SUBSTITUTION_RULES`. */
	substitution: ChordSubstitutionRule | null;
	inPracticeSet: boolean;
	difficultyLevel: number;
}

export interface LickSuggestionResult {
	/** Ranked and deduped by base lick id. */
	suggestions: LickSuggestion[];
	/** Category-'user' licks with zero prog tags — flagged, never ranked. */
	uncategorized: Phrase[];
}

export interface LickMatcherDeps {
	licks: Phrase[];
	/** Tune meter, for expressing insertion offsets as bar numbers. */
	timeSignature: [number, number];
	progress: LickPracticeProgress;
	getProgressionTags: (lickId: string) => ChordProgressionType[];
	getUnlockedKeyCount: (progress: LickPracticeProgress, lickId: string) => number;
	practiceLickIds: ReadonlySet<string>;
}

export interface SuggestLicksOptions {
	enableSubstitutions?: boolean;
	/** Cap the ranked list (applied after ranking and dedupe). */
	limit?: number;
}

const TIER_RANK: Record<MasteryTier, number> = { known: 0, learning: 1, unknown: 2 };
const SOURCE_RANK: Record<MatchSource, number> = { 'prog-tag': 0, category: 1, substitution: 2 };
const EPSILON = 1e-9;

/**
 * Derive how well the user knows a lick in a specific concert key. There is
 * no stored per-key score — `passCount` (sessions at or above
 * `KEY_PROFICIENT_THRESHOLD`) and the unlock ramp are the persisted signals:
 *
 * - `known`: the target key has at least one pass.
 * - `learning`: the target key was attempted but never passed, OR the lick
 *   has been started and the target key sits inside its current unlock ramp
 *   (`planUnlockedKeys`). A lick practiced only in C is NOT "learning" in F#.
 * - `unknown`: otherwise — including a never-practiced lick's own entry key.
 */
export function classifyMasteryTier(args: {
	progress: LickPracticeProgress;
	lickId: string;
	entryKey: PitchClass;
	targetKey: PitchClass;
	unlockedCount: number;
}): MasteryTier {
	const { progress, lickId, entryKey, targetKey, unlockedCount } = args;
	const atKey = progress[lickId]?.[targetKey];
	if (atKey) return atKey.passCount >= 1 ? 'known' : 'learning';
	if (
		hasLickProgress(progress, lickId) &&
		planUnlockedKeys(entryKey, unlockedCount).includes(targetKey)
	) {
		return 'learning';
	}
	return 'unknown';
}

function slotAtTemplateOffset(
	detected: DetectedProgression,
	templateOffset: Fraction
): DetectedSlot | null {
	return (
		detected.slots.find((s) => compareFractions(s.templateOffset, templateOffset) === 0) ?? null
	);
}

/** Position of a category in the progression's compatibility list (lower = more specific). */
function categorySpecificity(type: ChordProgressionType, category: PhraseCategory): number {
	const entries = PROGRESSION_LICK_CATEGORIES[type] ?? [];
	const idx = entries.findIndex((e) => e.category === category);
	return idx === -1 ? entries.length : idx;
}

export function suggestLicksForProgression(
	detected: DetectedProgression,
	deps: LickMatcherDeps,
	options: SuggestLicksOptions = {}
): LickSuggestionResult {
	const { enableSubstitutions = false, limit } = options;
	const type = detected.type;
	const compatibleCategories = getCompatibleLickCategories(type);
	const barFloat = deps.timeSignature[0] / deps.timeSignature[1];

	const suggestions: LickSuggestion[] = [];
	const uncategorized: Phrase[] = [];

	for (const lick of deps.licks) {
		const progTags = deps.getProgressionTags(lick.id);
		if (lick.category === 'user' && progTags.length === 0) {
			uncategorized.push(lick);
			continue;
		}

		const matchSources: MatchSource[] = [];
		if (progTags.includes(type)) matchSources.push('prog-tag');
		if (compatibleCategories.includes(lick.category)) matchSources.push('category');
		const substitution = getActiveSubstitution(type, lick.category, enableSubstitutions);
		if (substitution) matchSources.push('substitution');
		if (matchSources.length === 0) continue;

		const templateAlignmentOffset = resolveLickAlignmentOffset(
			type,
			lick.category,
			enableSubstitutions
		);
		// Segment-based mapping: land on the matched slot mirroring the template
		// chord, not "start + N bars" — correct even when the tune's harmonic
		// rhythm is compressed relative to the template.
		const slot = slotAtTemplateOffset(detected, templateAlignmentOffset);
		const insertionOffset = slot ? slot.startOffset : detected.startOffset;
		const targetKey = resolveTransposeTarget(
			detected.localKey,
			lick.category,
			type,
			templateAlignmentOffset,
			enableSubstitutions
		);

		suggestions.push({
			lickId: lick.id,
			lickName: lick.name,
			category: lick.category,
			targetKey,
			insertionOffset,
			insertionBar: Math.floor(fractionToFloat(insertionOffset) / barFloat + EPSILON),
			templateAlignmentOffset,
			masteryTier: classifyMasteryTier({
				progress: deps.progress,
				lickId: lick.id,
				entryKey: lick.key,
				targetKey,
				unlockedCount: deps.getUnlockedKeyCount(deps.progress, lick.id)
			}),
			matchSources,
			substitution,
			inPracticeSet: deps.practiceLickIds.has(lick.id),
			difficultyLevel: lick.difficulty.level
		});
	}

	suggestions.sort(
		(a, b) =>
			TIER_RANK[a.masteryTier] - TIER_RANK[b.masteryTier] ||
			SOURCE_RANK[a.matchSources[0]] - SOURCE_RANK[b.matchSources[0]] ||
			Number(b.inPracticeSet) - Number(a.inPracticeSet) ||
			categorySpecificity(type, a.category) - categorySpecificity(type, b.category) ||
			a.difficultyLevel - b.difficultyLevel ||
			a.lickName.localeCompare(b.lickName) ||
			a.lickId.localeCompare(b.lickId)
	);

	const seenBase = new Set<string>();
	const deduped = suggestions.filter((s) => {
		const base = baseLickId(s.lickId);
		if (seenBase.has(base)) return false;
		seenBase.add(base);
		return true;
	});

	return {
		suggestions: limit !== undefined ? deduped.slice(0, limit) : deduped,
		uncategorized
	};
}

export function suggestLicksForTune(
	detections: readonly DetectedProgression[],
	deps: LickMatcherDeps,
	options: SuggestLicksOptions = {}
): Array<{ detection: DetectedProgression; result: LickSuggestionResult }> {
	return detections.map((detection) => ({
		detection,
		result: suggestLicksForProgression(detection, deps, options)
	}));
}

/**
 * Live deps assembler — reads the lick pool and practice stores once. Strictly
 * read-only: loaders only, never setters (setters enqueue cloud pushes).
 */
export function buildLickMatcherDeps(tune: Pick<Tune, 'timeSignature'>): LickMatcherDeps {
	const licks = getAllLicks();
	return {
		licks,
		timeSignature: tune.timeSignature,
		progress: loadLickPracticeProgress(),
		getProgressionTags,
		getUnlockedKeyCount,
		practiceLickIds: getEffectivePracticeLickIds(licks)
	};
}
