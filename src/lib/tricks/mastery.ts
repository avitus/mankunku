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
import { ENCLOSURE_TYPES } from './devices/enclosures';
import { TRIAD_PAIR_FAMILIES } from './devices/triad-pairs';

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

/** One pedagogical step of the enclosure ladder, without the chord-type axis. */
interface EnclosureStepDef {
	/** Step id ('e1'…'e8') — referenced by later steps' `needs` clauses. */
	id: string;
	params: TrickParameters;
	label: string;
	/** AND of clauses; each clause lists step ids within the SAME type chain. */
	needs: string[][];
}

const ENCLOSURE_STEPS: EnclosureStepDef[] = [
	{
		id: 'e1',
		params: { noteCount: '1', shape: 'chromatic-below', targetTone: 'root', beatPlacement: 'downbeat' },
		label: 'Single chromatic approach',
		needs: []
	},
	{
		id: 'e2',
		params: { noteCount: '1', shape: 'scale-above', targetTone: 'third', beatPlacement: 'downbeat' },
		label: 'Scale step down to the 3rd',
		needs: [['e1']]
	},
	{
		id: 'e3',
		params: { noteCount: '2', shape: 'above-below', targetTone: 'third', beatPlacement: 'downbeat' },
		label: 'Enclose the 3rd, above then below',
		needs: [['e2']]
	},
	{
		id: 'e4',
		params: { noteCount: '2', shape: 'below-above', targetTone: 'fifth', beatPlacement: 'downbeat' },
		label: 'Enclose the 5th, below then above',
		needs: [['e3']]
	},
	{
		id: 'e5',
		params: { noteCount: '3', shape: 'above-below', targetTone: 'third', beatPlacement: 'downbeat' },
		label: 'Three-note enclosure of the 3rd',
		needs: [['e3']]
	},
	{
		id: 'e6',
		params: { noteCount: '2', shape: 'double-chromatic', targetTone: 'third', beatPlacement: 'downbeat' },
		label: 'Double chromatic to the 3rd',
		needs: [['e3']]
	},
	{
		id: 'e7',
		params: { noteCount: '2', shape: 'above-below', targetTone: 'third', beatPlacement: 'offbeat' },
		label: 'Enclosed 3rd landing off the beat',
		needs: [['e3']]
	},
	{
		id: 'e8',
		params: { noteCount: '3', shape: 'double-chromatic', targetTone: 'seventh', beatPlacement: 'offbeat' },
		label: 'Double chromatic → 7th, off the beat',
		needs: [['e5', 'e6']]
	}
];

// Three parallel self-contained chains — one per chord type from the device's
// ENCLOSURE_TYPES table, identical internal prerequisites, NO cross-type
// gating: each chain's e1 starts unlocked so all three types are selectable
// from day one. Built from the table so keys/labels can never drift from the
// device's parameter values (the triad-pairs pattern below).
const enclosureLadder: TrickVariantDefinition[] = [];
for (const family of ENCLOSURE_TYPES) {
	const byId = new Map<string, TrickVariantDefinition>();
	// Steps may only reference ids declared EARLIER in ENCLOSURE_STEPS; a
	// forward or unknown reference must fail module load, not silently build
	// a malformed prerequisite clause that gates on a nonexistent key.
	const resolve = (id: string): TrickVariantDefinition => {
		const prior = byId.get(id);
		if (!prior) throw new Error(`Enclosure step '${id}' referenced before it is defined`);
		return prior;
	};
	for (const step of ENCLOSURE_STEPS) {
		const variant = defineVariant(
			'enclosures',
			{ ...step.params, type: family.value },
			`${step.label} — ${family.label.toLowerCase()}`,
			step.needs.map((ids) => needs(ids.map(resolve)))
		);
		byId.set(step.id, variant);
		enclosureLadder.push(variant);
	}
}

// ── Triad-pairs ladder ───────────────────────────────────────────────

// A strictly linear chain over the pedagogical stage order pinned in
// TRIAD_PAIR_FAMILIES (diatonic pairs → altered pairs → whole-tone): stage
// n+1 unlocks after 3 total passes of stage n. Built from the family array
// so ladder keys/labels can never drift from the device's parameter values.
const triadPairLadder: TrickVariantDefinition[] = [];
for (const family of TRIAD_PAIR_FAMILIES) {
	const prev = triadPairLadder.at(-1);
	triadPairLadder.push(
		defineVariant('triad-pairs', { pair: family.value }, family.label, prev ? [needs([prev])] : [])
	);
}

// ── Mastery paths ────────────────────────────────────────────────────

export const TRICK_MASTERY_PATHS: Record<string, TrickVariantDefinition[]> = {
	'enclosures': enclosureLadder,
	'triad-pairs': triadPairLadder
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
