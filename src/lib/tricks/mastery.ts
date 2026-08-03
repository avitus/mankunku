/**
 * Trick mastery ladders and variant unlocking.
 *
 * Each trick exposes an ordered ladder of parameter variants. A variant's
 * `prerequisites` follow the SCALE_PREREQUISITES / isScaleTypeUnlocked model
 * in src/lib/tonality/tonality.ts: the outer array is an AND of clauses, and
 * every variant listed in a clause needs `totalVariantPasses >= passes`. An
 * empty prerequisites array means always unlocked; missing progress
 * coalesces to 0 passes.
 *
 * Variant keys are computed with `trickVariantKey` from the params objects
 * themselves, so the ladder keys can never drift from the parameters.
 *
 * Everything here is pure over a passed-in TrickUnlockContext — only
 * `loadTrickUnlockContext()` touches storage.
 */

import type { TrickParameters, TrickPracticeProgress } from '$lib/types/tricks';
import { trickVariantKey } from '$lib/types/tricks';
import { loadTrickPracticeProgress } from '$lib/persistence/trick-practice-store';

// ── Types ────────────────────────────────────────────────────────────

export interface TrickVariantDefinition {
	/** trickVariantKey(trickId, params) — the stable progress key */
	key: string;
	trickId: string;
	params: TrickParameters;
	/** Short human label, e.g. "Single chromatic approach" */
	label: string;
	/** AND of clauses; every variant in a clause needs >= passes total passes */
	prerequisites: { variants: string[]; passes: number }[];
}

export interface TrickUnlockContext {
	progress: TrickPracticeProgress;
}

// ── Ladder construction ──────────────────────────────────────────────

/** Total passes required per prerequisite variant unless a clause overrides it. */
const DEFAULT_PASSES = 3;

function defineVariant(
	trickId: string,
	params: TrickParameters,
	label: string,
	prerequisites: TrickVariantDefinition['prerequisites'] = []
): TrickVariantDefinition {
	return { key: trickVariantKey(trickId, params), trickId, params, label, prerequisites };
}

/** One prerequisite clause: ALL listed variants need >= passes total passes. */
function needs(
	variants: TrickVariantDefinition[],
	passes: number = DEFAULT_PASSES
): { variants: string[]; passes: number } {
	return { variants: variants.map((v) => v.key), passes };
}

// ── Enclosures ladder ────────────────────────────────────────────────

const e1 = defineVariant(
	'enclosures',
	{ noteCount: '1', shape: 'chromatic-below', targetTone: 'root', beatPlacement: 'downbeat' },
	'Single chromatic approach'
);
const e2 = defineVariant(
	'enclosures',
	{ noteCount: '1', shape: 'scale-above', targetTone: 'third', beatPlacement: 'downbeat' },
	'Scale step down to the 3rd',
	[needs([e1])]
);
const e3 = defineVariant(
	'enclosures',
	{ noteCount: '2', shape: 'above-below', targetTone: 'third', beatPlacement: 'downbeat' },
	'Enclose the 3rd, above then below',
	[needs([e2])]
);
const e4 = defineVariant(
	'enclosures',
	{ noteCount: '2', shape: 'below-above', targetTone: 'fifth', beatPlacement: 'downbeat' },
	'Enclose the 5th, below then above',
	[needs([e3])]
);
const e5 = defineVariant(
	'enclosures',
	{ noteCount: '3', shape: 'above-below', targetTone: 'third', beatPlacement: 'downbeat' },
	'Three-note enclosure of the 3rd',
	[needs([e3])]
);
const e6 = defineVariant(
	'enclosures',
	{ noteCount: '2', shape: 'double-chromatic', targetTone: 'third', beatPlacement: 'downbeat' },
	'Double chromatic to the 3rd',
	[needs([e3])]
);
const e7 = defineVariant(
	'enclosures',
	{ noteCount: '2', shape: 'above-below', targetTone: 'third', beatPlacement: 'offbeat' },
	'Enclosed 3rd landing off the beat',
	[needs([e3])]
);
const e8 = defineVariant(
	'enclosures',
	{ noteCount: '3', shape: 'double-chromatic', targetTone: 'seventh', beatPlacement: 'offbeat' },
	'Double chromatic → 7th, off the beat',
	[needs([e5, e6])]
);

// ── Triad-pairs ladder ───────────────────────────────────────────────

const t1 = defineVariant(
	'triad-pairs',
	{ pair: '4+5', order: 'low-first', beatPlacement: 'downbeat' },
	'Pair on 4 & 5'
);
const t2 = defineVariant(
	'triad-pairs',
	{ pair: '4+5', order: 'high-first', beatPlacement: 'downbeat' },
	'Pair on 4 & 5, upper triad first',
	[needs([t1])]
);
const t3 = defineVariant(
	'triad-pairs',
	{ pair: '1+2', order: 'low-first', beatPlacement: 'downbeat' },
	'Pair on 1 & 2',
	[needs([t1])]
);
const t4 = defineVariant(
	'triad-pairs',
	{ pair: '5+6', order: 'low-first', beatPlacement: 'downbeat' },
	'Pair on 5 & 6',
	[needs([t3])]
);
const t5 = defineVariant(
	'triad-pairs',
	{ pair: '4+5', order: 'low-first', beatPlacement: 'offbeat' },
	'Pair on 4 & 5, off the beat',
	[needs([t2])]
);
const t6 = defineVariant(
	'triad-pairs',
	{ pair: '1+2', order: 'high-first', beatPlacement: 'offbeat' },
	'Pair on 1 & 2, upper first, off the beat',
	[needs([t3, t5])]
);

// ── Mastery paths ────────────────────────────────────────────────────

export const TRICK_MASTERY_PATHS: Record<string, TrickVariantDefinition[]> = {
	'enclosures': [e1, e2, e3, e4, e5, e6, e7, e8],
	'triad-pairs': [t1, t2, t3, t4, t5, t6]
};

const VARIANTS_BY_KEY = new Map<string, TrickVariantDefinition>();
for (const ladder of Object.values(TRICK_MASTERY_PATHS)) {
	for (const variant of ladder) {
		VARIANTS_BY_KEY.set(variant.key, variant);
	}
}

// ── Queries ──────────────────────────────────────────────────────────

/** The ordered variant ladder for a trick (empty for unknown trick ids). */
export function getVariantsForTrick(trickId: string): TrickVariantDefinition[] {
	// Own-property check: the id arrives from the /tricks/[id] route param, and
	// a prototype-chain key like 'constructor' would otherwise return a function.
	return Object.hasOwn(TRICK_MASTERY_PATHS, trickId) ? TRICK_MASTERY_PATHS[trickId] : [];
}

/** Look up a variant definition by its composite variant key. */
export function getVariantByKey(variantKey: string): TrickVariantDefinition | undefined {
	return VARIANTS_BY_KEY.get(variantKey);
}

/** Sum passCount for a variant across all practiced keys (missing → 0). */
export function totalVariantPasses(progress: TrickPracticeProgress, variantKey: string): number {
	const perKey = progress[variantKey];
	if (!perKey) return 0;
	let total = 0;
	for (const keyProgress of Object.values(perKey)) {
		total += keyProgress?.passCount ?? 0;
	}
	return total;
}

/** Check whether a specific variant is unlocked (mirrors isScaleTypeUnlocked). */
export function isVariantUnlocked(variantKey: string, ctx: TrickUnlockContext): boolean {
	const prereqs = getVariantByKey(variantKey)?.prerequisites;
	if (!prereqs || prereqs.length === 0) return true;
	return prereqs.every((clause) =>
		clause.variants.every((v) => totalVariantPasses(ctx.progress, v) >= clause.passes)
	);
}

/** All currently unlocked variants of a trick, in ladder order. */
export function getUnlockedVariants(trickId: string, ctx: TrickUnlockContext): TrickVariantDefinition[] {
	return getVariantsForTrick(trickId).filter((v) => isVariantUnlocked(v.key, ctx));
}

/**
 * The unlock frontier: locked variants all of whose prerequisite variants
 * are themselves unlocked — the next things worth highlighting.
 */
export function getNextLockedVariants(trickId: string, ctx: TrickUnlockContext): TrickVariantDefinition[] {
	return getVariantsForTrick(trickId).filter((v) => {
		if (isVariantUnlocked(v.key, ctx)) return false;
		return v.prerequisites.every((clause) =>
			clause.variants.every((prereqKey) => isVariantUnlocked(prereqKey, ctx))
		);
	});
}

/** Build an unlock context from persisted progress (the only storage touch). */
export function loadTrickUnlockContext(): TrickUnlockContext {
	return { progress: loadTrickPracticeProgress() };
}
