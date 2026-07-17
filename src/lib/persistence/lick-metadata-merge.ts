/**
 * Pure, symmetric per-entry merge for the lick-metadata blobs.
 *
 * Replaces whole-column last-writer-wins (which silently dropped one device's
 * tags / progress / unlock state) with a per-lick-id merge. The merge is
 * commutative and idempotent, so applying it on PUSH (merge local into cloud
 * before upserting) and on PULL (merge cloud into local) both converge every
 * device to the same result.
 *
 * Recency signals (never the trigger-clobbered `updated_at`):
 *  - `mergeMeta.tags/overrides/catOverrides/unlockMtime[id]` — client mtimes
 *    stamped on each write, driving per-id last-writer-wins.
 *  - `practiceProgress[id][key].lastPracticedAt` — a natural per-key clock, so
 *    two devices practicing the SAME lick in DIFFERENT keys union rather than
 *    clobber.
 *  - `mergeMeta.progressResets[id]` — a reset tombstone; per-key entries older
 *    than the reset are dropped.
 *  - The reserved `__migrations` tag key is ALWAYS unioned, never LWW and never
 *    dropped, so the `prog-backfill-v1` marker can't be erased by a merge.
 */

export interface LickMetaData {
	lickTags: Record<string, string[]>;
	practiceProgress: Record<string, Record<string, { currentTempo: number; lastPracticedAt: number; passCount: number }>>;
	tagOverrides: Record<string, string[]>;
	categoryOverrides: Record<string, string>;
	unlockCounts: Record<string, number>;
}

export interface LickMergeMeta {
	tags?: Record<string, number>;
	overrides?: Record<string, number>;
	catOverrides?: Record<string, number>;
	unlockMtime?: Record<string, number>;
	progressResets?: Record<string, number>;
}

export interface LickMetaBundle {
	data: LickMetaData;
	mergeMeta: LickMergeMeta;
}

const MIGRATIONS_KEY = '__migrations';

function unionStrings(a: readonly string[] = [], b: readonly string[] = []): string[] {
	return [...new Set([...a, ...b])];
}

function keysOf(...objs: Array<Record<string, unknown> | undefined>): string[] {
	const s = new Set<string>();
	for (const o of objs) {
		if (o) for (const k of Object.keys(o)) s.add(k);
	}
	return [...s];
}

/** Reject prototype-polluting keys before any computed-property assignment. */
function isUnsafeKey(key: string): boolean {
	return key === '__proto__' || key === 'constructor' || key === 'prototype';
}

/**
 * Per-id merge over a value map using an mtime map on each side.
 *
 * When both sides hold the key, the newer clock wins (ties deterministically
 * favour local). When only ONE side holds the key, absence on the other side is
 * treated as a deletion ONLY if that other side stamped a strictly-newer write;
 * otherwise the present value is kept. This preserves a legacy value that has no
 * merge_meta (both clocks 0 — a real deletion would carry a newer stamp) while
 * still honouring a genuine remote/local removal (which bumps its mtime).
 */
function mergeById<V>(
	localVals: Record<string, V> | undefined,
	localMtimes: Record<string, number> | undefined,
	cloudVals: Record<string, V> | undefined,
	cloudMtimes: Record<string, number> | undefined
): { vals: Record<string, V>; mtimes: Record<string, number> } {
	const vals: Record<string, V> = {};
	const mtimes: Record<string, number> = {};
	for (const id of keysOf(localVals, cloudVals, localMtimes, cloudMtimes)) {
		if (isUnsafeKey(id)) continue;
		const lm = localMtimes?.[id] ?? 0;
		const cm = cloudMtimes?.[id] ?? 0;
		const mtime = Math.max(lm, cm);
		if (mtime > 0) mtimes[id] = mtime;

		const localHas = !!localVals && id in localVals;
		const cloudHas = !!cloudVals && id in cloudVals;
		if (localHas && cloudHas) {
			vals[id] = lm >= cm ? (localVals as Record<string, V>)[id] : (cloudVals as Record<string, V>)[id];
		} else if (localHas) {
			// Keep unless the cloud deleted it more recently.
			if (cm <= lm) vals[id] = (localVals as Record<string, V>)[id];
		} else if (cloudHas) {
			// Keep unless the local side deleted it more recently.
			if (lm <= cm) vals[id] = (cloudVals as Record<string, V>)[id];
		}
	}
	return { vals, mtimes };
}

/** Merge two lick-metadata bundles. Commutative and idempotent. */
export function mergeLickMetadata(local: LickMetaBundle, cloud: LickMetaBundle): LickMetaBundle {
	const lm = local.mergeMeta ?? {};
	const cm = cloud.mergeMeta ?? {};

	// ── lick_tags: per-id LWW, plus the always-unioned __migrations key ──
	const tagsMerge = mergeById(
		stripKey(local.data.lickTags, MIGRATIONS_KEY),
		lm.tags,
		stripKey(cloud.data.lickTags, MIGRATIONS_KEY),
		cm.tags
	);
	const lickTags: Record<string, string[]> = { ...tagsMerge.vals };
	const migrations = unionStrings(local.data.lickTags?.[MIGRATIONS_KEY], cloud.data.lickTags?.[MIGRATIONS_KEY]);
	if (migrations.length > 0) lickTags[MIGRATIONS_KEY] = migrations;

	// ── tag_overrides / category_overrides: per-id LWW ──
	const overridesMerge = mergeById(local.data.tagOverrides, lm.overrides, cloud.data.tagOverrides, cm.overrides);
	const catMerge = mergeById(local.data.categoryOverrides, lm.catOverrides, cloud.data.categoryOverrides, cm.catOverrides);

	// ── unlock_counts: per-id LWW (a reset removes the id + bumps its mtime) ──
	const unlockMerge = mergeById(local.data.unlockCounts, lm.unlockMtime, cloud.data.unlockCounts, cm.unlockMtime);

	// ── practice_progress: per-(id,key) union by lastPracticedAt + reset tombstones ──
	const progressResets: Record<string, number> = {};
	for (const id of keysOf(lm.progressResets, cm.progressResets)) {
		const t = Math.max(lm.progressResets?.[id] ?? 0, cm.progressResets?.[id] ?? 0);
		if (t > 0) progressResets[id] = t;
	}
	const practiceProgress: LickMetaData['practiceProgress'] = {};
	for (const id of keysOf(local.data.practiceProgress, cloud.data.practiceProgress)) {
		const resetTime = progressResets[id] ?? 0;
		const localKeys = local.data.practiceProgress?.[id] ?? {};
		const cloudKeys = cloud.data.practiceProgress?.[id] ?? {};
		const mergedKeys: Record<string, { currentTempo: number; lastPracticedAt: number; passCount: number }> = {};
		for (const key of keysOf(localKeys, cloudKeys)) {
			const lk = localKeys[key];
			const ck = cloudKeys[key];
			const winner = (lk?.lastPracticedAt ?? -1) >= (ck?.lastPracticedAt ?? -1) ? lk : ck;
			if (!winner) continue;
			if (winner.lastPracticedAt < resetTime) continue; // dropped by a newer reset
			mergedKeys[key] = {
				...winner,
				passCount: Math.max(lk?.passCount ?? 0, ck?.passCount ?? 0)
			};
		}
		if (Object.keys(mergedKeys).length > 0) practiceProgress[id] = mergedKeys;
	}

	return {
		data: {
			lickTags,
			practiceProgress,
			tagOverrides: overridesMerge.vals,
			categoryOverrides: catMerge.vals,
			unlockCounts: unlockMerge.vals
		},
		mergeMeta: {
			tags: tagsMerge.mtimes,
			overrides: overridesMerge.mtimes,
			catOverrides: catMerge.mtimes,
			unlockMtime: unlockMerge.mtimes,
			progressResets
		}
	};
}

function stripKey<V>(obj: Record<string, V> | undefined, key: string): Record<string, V> {
	if (!obj) return {};
	if (!(key in obj)) return obj;
	const { [key]: _omit, ...rest } = obj;
	return rest;
}
