import { describe, it, expect } from 'vitest';
import {
	mergeLickMetadata,
	type LickMetaBundle
} from '$lib/persistence/lick-metadata-merge';

function bundle(partial: Partial<LickMetaBundle['data']>, mergeMeta: LickMetaBundle['mergeMeta'] = {}): LickMetaBundle {
	return {
		data: {
			lickTags: partial.lickTags ?? {},
			practiceProgress: partial.practiceProgress ?? {},
			tagOverrides: partial.tagOverrides ?? {},
			categoryOverrides: partial.categoryOverrides ?? {},
			unlockCounts: partial.unlockCounts ?? {}
		},
		mergeMeta
	};
}

describe('mergeLickMetadata', () => {
	it('resolves lick_tags per id by client mtime (last writer wins)', () => {
		const local = bundle({ lickTags: { a: ['practice'] } }, { tags: { a: 100 } });
		const cloud = bundle({ lickTags: { a: ['practice:removed'] } }, { tags: { a: 200 } });
		const merged = mergeLickMetadata(local, cloud);
		// cloud's edit is newer → its value wins.
		expect(merged.data.lickTags.a).toEqual(['practice:removed']);
		expect(merged.mergeMeta.tags?.a).toBe(200);
	});

	it('keeps distinct licks from both sides (union of ids)', () => {
		const local = bundle({ lickTags: { a: ['prog:x'] } }, { tags: { a: 5 } });
		const cloud = bundle({ lickTags: { b: ['prog:y'] } }, { tags: { b: 5 } });
		const merged = mergeLickMetadata(local, cloud);
		expect(merged.data.lickTags.a).toEqual(['prog:x']);
		expect(merged.data.lickTags.b).toEqual(['prog:y']);
	});

	it('ALWAYS unions the __migrations marker and never drops it', () => {
		const local = bundle({ lickTags: { __migrations: ['prog-backfill-v1'] } });
		const cloud = bundle({ lickTags: {} }); // cloud lost the marker
		const merged = mergeLickMetadata(local, cloud);
		expect(merged.data.lickTags.__migrations).toEqual(['prog-backfill-v1']);
		// and symmetrically
		const merged2 = mergeLickMetadata(cloud, local);
		expect(merged2.data.lickTags.__migrations).toEqual(['prog-backfill-v1']);
	});

	it('unlock_counts: per-id LWW so a reset (absence + newer mtime) wins over a stale higher count', () => {
		const local = bundle({ unlockCounts: {} }, { unlockMtime: { a: 300 } }); // a was reset locally
		const cloud = bundle({ unlockCounts: { a: 7 } }, { unlockMtime: { a: 200 } });
		const merged = mergeLickMetadata(local, cloud);
		expect(merged.data.unlockCounts.a).toBeUndefined(); // reset wins
	});

	it('unlock_counts: a newer higher count wins over an older one', () => {
		const local = bundle({ unlockCounts: { a: 3 } }, { unlockMtime: { a: 100 } });
		const cloud = bundle({ unlockCounts: { a: 5 } }, { unlockMtime: { a: 200 } });
		const merged = mergeLickMetadata(local, cloud);
		expect(merged.data.unlockCounts.a).toBe(5);
	});

	it('practice_progress: unions per (lick,key) by lastPracticedAt', () => {
		const local = bundle({
			practiceProgress: { a: { C: { currentTempo: 100, lastPracticedAt: 50, passCount: 1 } } }
		});
		const cloud = bundle({
			practiceProgress: { a: { F: { currentTempo: 90, lastPracticedAt: 60, passCount: 2 } } }
		});
		const merged = mergeLickMetadata(local, cloud);
		// Two devices practised the same lick in different keys → union, not clobber.
		expect(Object.keys(merged.data.practiceProgress.a).sort()).toEqual(['C', 'F']);
	});

	it('practice_progress: takes the more-recent entry and the max passCount per key', () => {
		const local = bundle({
			practiceProgress: { a: { C: { currentTempo: 100, lastPracticedAt: 50, passCount: 3 } } }
		});
		const cloud = bundle({
			practiceProgress: { a: { C: { currentTempo: 120, lastPracticedAt: 80, passCount: 1 } } }
		});
		const merged = mergeLickMetadata(local, cloud);
		expect(merged.data.practiceProgress.a.C.currentTempo).toBe(120); // newer
		expect(merged.data.practiceProgress.a.C.passCount).toBe(3); // max
	});

	it('practice_progress: a reset tombstone drops per-key entries older than the reset', () => {
		const local = bundle(
			{ practiceProgress: {} },
			{ progressResets: { a: 100 } } // reset at t=100 locally
		);
		const cloud = bundle({
			practiceProgress: { a: { C: { currentTempo: 90, lastPracticedAt: 50, passCount: 2 } } }
		});
		const merged = mergeLickMetadata(local, cloud);
		// cloud's key predates the reset → dropped.
		expect(merged.data.practiceProgress.a).toBeUndefined();
	});

	it('practice_progress: practice NEWER than a reset survives it', () => {
		const local = bundle({ practiceProgress: {} }, { progressResets: { a: 100 } });
		const cloud = bundle({
			practiceProgress: { a: { C: { currentTempo: 90, lastPracticedAt: 150, passCount: 2 } } }
		});
		const merged = mergeLickMetadata(local, cloud);
		expect(merged.data.practiceProgress.a?.C?.lastPracticedAt).toBe(150);
	});

	it('preserves a legacy cloud value that has no merge_meta (both clocks 0)', () => {
		// An existing user's tags written before merge_meta existed: cloud holds
		// them with NO mtime; a fresh device has empty local. The value must NOT
		// be dropped by the zero-clock tie.
		const local = bundle({ lickTags: {} }, {});
		const cloud = bundle({ lickTags: { a: ['practice', 'prog:ii-V-I-major'] } }, {});
		const merged = mergeLickMetadata(local, cloud);
		expect(merged.data.lickTags.a).toEqual(['practice', 'prog:ii-V-I-major']);
		// symmetric
		expect(mergeLickMetadata(cloud, local).data.lickTags.a).toEqual(['practice', 'prog:ii-V-I-major']);
	});

	it('still drops a value the other side deleted with a strictly-newer stamp', () => {
		// local removed `a` (stamped 300); cloud still has the stale legacy value.
		const local = bundle({ lickTags: {} }, { tags: { a: 300 } });
		const cloud = bundle({ lickTags: { a: ['practice'] } }, {});
		const merged = mergeLickMetadata(local, cloud);
		expect(merged.data.lickTags.a).toBeUndefined();
	});

	it('legacy both-sides tags with NO mtime union instead of clobbering (regression: prog tags stripped)', () => {
		// The 2026-07-17 incident: a stale device held ["practice"] while the cloud
		// held ["practice","prog:ii-V-I-major"], NEITHER side stamped (legacy data).
		// The zero-clock tie used to favour local and drop the prog tag, then push
		// the loss up. Union preserves both sides' tags.
		const stale = bundle({ lickTags: { a: ['practice'] } }, {});
		const good = bundle({ lickTags: { a: ['practice', 'prog:ii-V-I-major'] } }, {});
		expect([...mergeLickMetadata(stale, good).data.lickTags.a].sort()).toEqual([
			'practice',
			'prog:ii-V-I-major'
		]);
		// Symmetric — the stale side must not strip the prog tag in either order.
		expect([...mergeLickMetadata(good, stale).data.lickTags.a].sort()).toEqual([
			'practice',
			'prog:ii-V-I-major'
		]);
		// A zero-clock union writes no phantom mtime.
		expect(mergeLickMetadata(stale, good).mergeMeta.tags?.a).toBeUndefined();
	});

	it('legacy zero-clock union also applies to tag_overrides', () => {
		const a = bundle({ tagOverrides: { c: ['practice'] } }, {});
		const b = bundle({ tagOverrides: { c: ['prog:blues'] } }, {});
		expect([...mergeLickMetadata(a, b).data.tagOverrides.c].sort()).toEqual(['practice', 'prog:blues']);
	});

	it('a stamped edit (mtime > 0) still wins over a legacy value — union fires only with no signal', () => {
		// One side recorded a deliberate edit; LWW must win, not union, so a real
		// user change (incl. removing tags) is honoured.
		const edited = bundle({ lickTags: { a: ['prog:minor-vamp'] } }, { tags: { a: 500 } });
		const legacy = bundle({ lickTags: { a: ['practice', 'prog:ii-V-I-major'] } }, {});
		const merged = mergeLickMetadata(edited, legacy);
		expect(merged.data.lickTags.a).toEqual(['prog:minor-vamp']);
		expect(merged.mergeMeta.tags?.a).toBe(500);
	});

	it('unlock_counts: legacy both-mtime-0 entries take the MAX, not favour-local', () => {
		// A stale device with a LOWER unlock count must not overwrite a higher one
		// when neither side has a merge_meta signal (same no-signal clobber class as
		// lick_tags). A real decrease only comes from a reset, which stamps mtime>0.
		const stale = bundle({ unlockCounts: { a: 3 } }, {});
		const higher = bundle({ unlockCounts: { a: 8 } }, {});
		expect(mergeLickMetadata(stale, higher).data.unlockCounts.a).toBe(8);
		expect(mergeLickMetadata(higher, stale).data.unlockCounts.a).toBe(8);
	});

	it('ignores prototype-polluting ids', () => {
		// JSON.parse creates an OWN enumerable "__proto__" key (an object literal
		// would set the prototype instead), so this actually exercises the guard.
		const lickTags = JSON.parse('{"__proto__":["x"]}') as Record<string, string[]>;
		const local = bundle({ lickTags }, {});
		const cloud = bundle({ lickTags: {} }, {});
		const merged = mergeLickMetadata(local, cloud);
		expect(Object.prototype.hasOwnProperty.call(merged.data.lickTags, '__proto__')).toBe(false);
		expect(({} as Record<string, unknown>).x).toBeUndefined(); // no pollution
	});

	it('is commutative for the data it produces', () => {
		const a = bundle(
			{ lickTags: { x: ['practice'] }, unlockCounts: { x: 4 } },
			{ tags: { x: 10 }, unlockMtime: { x: 10 } }
		);
		const b = bundle(
			{ lickTags: { x: ['prog:z'] }, unlockCounts: { x: 8 } },
			{ tags: { x: 20 }, unlockMtime: { x: 20 } }
		);
		const ab = mergeLickMetadata(a, b);
		const ba = mergeLickMetadata(b, a);
		expect(ab.data.lickTags.x).toEqual(ba.data.lickTags.x);
		expect(ab.data.unlockCounts.x).toEqual(ba.data.unlockCounts.x);
	});
});
