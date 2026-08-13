/**
 * One-time trick-state migrations — pure rewrites over the syncable blob.
 *
 * `enclosure-type-v1` (2026-08-11): the enclosures device gained a `type`
 * parameter (major/minor/dominant) that is part of every variant key. All
 * pre-existing enclosure state was implicitly major (the old drills always
 * ran over the C maj7 major-vamp bed), so legacy keys — enclosure signatures
 * without a `type=` pair — re-key to `type=major`.
 *
 * The rewrite runs at TWO seams:
 *  - once locally, gated by the `enclosure-type-v1` marker
 *    (`runLocalTrickMigrations` in trick-practice-store.ts);
 *  - on BOTH sides of every cloud merge (init/flushTrickStateToCloud),
 *    because `mergeTrickState` unions variant keys — a stale cloud row or an
 *    old-code device would otherwise resurrect legacy keys forever. The merge
 *    seam folds stragglers whenever they are seen; the marker only gates the
 *    local pass. This also keeps sync.ts free of device knowledge.
 */

import type { PitchClass } from '$lib/types/music';
import { PITCH_CLASSES } from '$lib/types/music';
import type {
	TrickPracticeKeyProgress,
	TrickPracticeProgress,
	TrickProgressHistory,
	TrickProgressPoint
} from '$lib/types/tricks';
import { trickVariantKey } from '$lib/types/tricks';
import type { SyncableTrickState } from './sync';
import { MAX_HISTORY_POINTS } from './limits';

/**
 * The exact parameter set every pre-`type` enclosure ladder variant carried.
 * Only signatures with precisely these names are legacy keys; anything else
 * (unknown/missing/duplicate names, empty values) was never produced by the
 * old ladder and must pass through unchanged.
 */
const LEGACY_ENCLOSURE_PARAMS = ['beatPlacement', 'noteCount', 'shape', 'targetTone'] as const;

/**
 * Re-key one variant key: a signature matching the exact legacy enclosure
 * schema gains `type=major`; everything else — other tricks, already-typed
 * keys, and anything malformed or foreign — passes through untouched.
 * Idempotent.
 */
export function migrateEnclosureVariantKey(key: string): string {
	const sep = key.indexOf(':');
	if (sep === -1 || key.slice(0, sep) !== 'enclosures') return key;
	const signature = key.slice(sep + 1);
	if (signature.length === 0) return key;

	const pairs = signature.split(',');
	const params: Record<string, string> = {};
	for (const pair of pairs) {
		const eq = pair.indexOf('=');
		if (eq <= 0 || eq === pair.length - 1) return key; // malformed / empty value
		params[pair.slice(0, eq)] = pair.slice(eq + 1);
	}
	if ('type' in params) return key; // already migrated
	const names = Object.keys(params);
	const isLegacySchema =
		pairs.length === LEGACY_ENCLOSURE_PARAMS.length && // no duplicate names
		names.length === LEGACY_ENCLOSURE_PARAMS.length &&
		LEGACY_ENCLOSURE_PARAMS.every((name) => name in params);
	if (!isLegacySchema) return key;
	return trickVariantKey('enclosures', { ...params, type: 'major' });
}

/** Collision fold for per-key progress: later lastPracticedAt wins per key. */
function foldProgress(
	a: Partial<Record<PitchClass, TrickPracticeKeyProgress>>,
	b: Partial<Record<PitchClass, TrickPracticeKeyProgress>>
): Partial<Record<PitchClass, TrickPracticeKeyProgress>> {
	const merged: Partial<Record<PitchClass, TrickPracticeKeyProgress>> = {};
	for (const pc of PITCH_CLASSES) {
		const x = a[pc];
		const y = b[pc];
		const winner = !x ? y : !y ? x : y.lastPracticedAt > x.lastPracticedAt ? y : x;
		if (winner) merged[pc] = winner;
	}
	return merged;
}

/** Collision fold for history: union by t (first writer wins), sorted, capped. */
function foldHistory(a: TrickProgressPoint[], b: TrickProgressPoint[]): TrickProgressPoint[] {
	const byT = new Map<number, TrickProgressPoint>();
	for (const p of [...a, ...b]) {
		if (!byT.has(p.t)) byT.set(p.t, p);
	}
	const points = [...byT.values()].sort((x, y) => x.t - y.t);
	return points.length > MAX_HISTORY_POINTS
		? points.slice(points.length - MAX_HISTORY_POINTS)
		: points;
}

/**
 * Rewrite every keyed store in a trick-state blob through
 * `migrateEnclosureVariantKey`. When a legacy key and its typed successor
 * both exist (pre- and post-migration devices), the collision folds with the
 * `mergeTrickState` rules: progress per key by later `lastPracticedAt`,
 * unlock counts by max, history unioned by timestamp, selection as a set.
 * `migrations` and `selectedUpdatedAt` are untouched — a rewrite is not a
 * user edit and must not win LWW races. Pure and idempotent.
 */
export function migrateTrickState(state: SyncableTrickState): SyncableTrickState {
	const progress: TrickPracticeProgress = {};
	for (const [key, perKey] of Object.entries(state.progress)) {
		const next = migrateEnclosureVariantKey(key);
		progress[next] = progress[next] ? foldProgress(progress[next]!, perKey) : perKey;
	}

	const unlockCounts: Record<string, number> = {};
	for (const [key, count] of Object.entries(state.unlockCounts)) {
		const next = migrateEnclosureVariantKey(key);
		unlockCounts[next] = Math.max(unlockCounts[next] ?? 0, count);
	}

	const history: TrickProgressHistory = {};
	for (const [key, points] of Object.entries(state.history)) {
		const next = migrateEnclosureVariantKey(key);
		history[next] = history[next] ? foldHistory(history[next]!, points) : points;
	}

	const selectedVariants = [...new Set(state.selectedVariants.map(migrateEnclosureVariantKey))];

	return { ...state, selectedVariants, progress, unlockCounts, history };
}
