import { describe, it, expect } from 'vitest';
import {
	selectInitialProgression,
	buildUpcomingLicks,
	findStrandedLicks,
	DEFAULT_PROGRESSION
} from '$lib/state/lick-practice-picker';
import type {
	ChordProgressionType,
	LickPracticeProgress
} from '$lib/types/lick-practice';
import type { LickPracticeSessionLogEntry } from '$lib/persistence/lick-practice-sessions';
import type { Phrase, PhraseCategory } from '$lib/types/music';

function lick(id: string, category: PhraseCategory): Phrase {
	return {
		id,
		name: id,
		timeSignature: [4, 4],
		key: 'C',
		notes: [{ pitch: 60, duration: [1, 4], offset: [0, 1] }],
		harmony: [],
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category,
		tags: [],
		source: 'test'
	};
}

function progressForLick(
	id: string,
	keyTimes: Record<string, number>
): LickPracticeProgress {
	const keys: Record<string, { currentTempo: number; lastPracticedAt: number; passCount: number }> = {};
	for (const [k, t] of Object.entries(keyTimes)) {
		keys[k] = { currentTempo: 120, lastPracticedAt: t, passCount: 0 };
	}
	return { [id]: keys as never };
}

function session(
	progressionType: ChordProgressionType,
	timestamp: number
): LickPracticeSessionLogEntry {
	return {
		id: `s-${timestamp}`,
		timestamp,
		progressionType,
		practiceMode: 'continuous',
		report: {
			licks: [],
			totalAttempts: 1,
			totalKeys: 1,
			totalPasses: 1,
			overall: 1,
			pitchAccuracy: 1,
			rhythmAccuracy: 1
		} as never
	};
}

const noTags = (): ChordProgressionType[] => [];

/**
 * Lift a plain map into a `getProgressionTags` callback. The picker treats
 * `prog:*` tags as the sole inclusion path now, so most tests need to seed
 * tags up-front rather than rely on category compatibility.
 */
function tagsFromMap(
	map: Record<string, ChordProgressionType[]>
): (id: string) => ChordProgressionType[] {
	return (id: string) => map[id] ?? [];
}

describe('selectInitialProgression', () => {
	it('returns default when there are no tagged candidates', () => {
		const got = selectInitialProgression({
			candidates: [],
			progress: {},
			sessionLog: [],
			getProgressionTags: noTags
		});
		expect(got).toBe(DEFAULT_PROGRESSION);
	});

	it('picks the only fitting progression for a brand-new user', () => {
		// Single tagged blues lick, opted in to `blues` only.
		const got = selectInitialProgression({
			candidates: [lick('lk1', 'blues')],
			progress: {},
			sessionLog: [],
			getProgressionTags: tagsFromMap({ lk1: ['blues'] })
		});
		expect(got).toBe('blues');
	});

	it('falls back to first fit in pill order when all fits are tied at 0', () => {
		// User has opted lk1 into every category-compatible progression for
		// `major-chord` — the same set the setup-time backfill produces. With
		// no session history, the first in pill order wins.
		const got = selectInitialProgression({
			candidates: [lick('lk1', 'major-chord')],
			progress: {},
			sessionLog: [],
			getProgressionTags: tagsFromMap({
				lk1: ['major-vamp', 'ii-V-I-major', 'ii-V-I-major-long', 'turnaround']
			})
		});
		expect(got).toBe('major-vamp');
	});

	it('rotates among fitting progressions by least-recently-practiced', () => {
		// User has practiced major-vamp recently; picker must skip it.
		const got = selectInitialProgression({
			candidates: [lick('lk1', 'major-chord')],
			progress: {},
			sessionLog: [session('major-vamp', 1000)],
			getProgressionTags: tagsFromMap({
				lk1: ['major-vamp', 'ii-V-I-major', 'ii-V-I-major-long', 'turnaround']
			})
		});
		// Next fit in pill order with timestamp 0 is ii-V-I-major.
		expect(got).toBe('ii-V-I-major');
	});

	it('uses the max timestamp per progression across multiple sessions', () => {
		// Lick opted in to 5 progressions. Every fit has history; the picker
		// must pick the one whose MAX timestamp is the smallest. If it used the
		// MIN timestamp instead it would mistakenly pick minor-vamp (since
		// 200 < 1000); using max correctly yields ii-V-I-minor-long with 1000.
		const got = selectInitialProgression({
			candidates: [lick('lk1', 'minor-chord')],
			progress: {},
			sessionLog: [
				session('minor-vamp', 200),
				session('minor-vamp', 5000),
				session('ii-V-I-minor', 3000),
				session('ii-V-I-major-long', 4000),
				session('ii-V-I-minor-long', 1000),
				session('turnaround', 2000)
			],
			getProgressionTags: tagsFromMap({
				lk1: [
					'minor-vamp',
					'ii-V-I-minor',
					'ii-V-I-major-long',
					'ii-V-I-minor-long',
					'turnaround'
				]
			})
		});
		expect(got).toBe('ii-V-I-minor-long');
	});

	it('honors user prog:* tags regardless of category compatibility', () => {
		// `pentatonic` is not listed in any progression's compat list. The
		// `prog:blues` tag is the sole inclusion path here.
		const got = selectInitialProgression({
			candidates: [lick('lk1', 'pentatonic')],
			progress: {},
			sessionLog: [],
			getProgressionTags: tagsFromMap({ lk1: ['blues'] })
		});
		expect(got).toBe('blues');
	});

	it('returns DEFAULT when the lick has no progression tags', () => {
		// With opt-in semantics, a practice-tagged lick without prog:* tags
		// has no fitting progression — even one whose category previously
		// implied compatibility (e.g. `major-chord`).
		const got = selectInitialProgression({
			candidates: [lick('lk1', 'major-chord')],
			progress: {},
			sessionLog: [],
			getProgressionTags: noTags
		});
		expect(got).toBe(DEFAULT_PROGRESSION);
	});

	it('picks the most-neglected lick first, then its least-recently-practiced fit', () => {
		// lk_old has practice history; lk_new does not. Picker picks lk_new
		// (most neglected). lk_new is opted into ii-V-I-minor and
		// ii-V-I-minor-long; with ii-V-I-minor recently played, the picker
		// rotates to ii-V-I-minor-long.
		const got = selectInitialProgression({
			candidates: [
				lick('lk_old', 'major-chord'),
				lick('lk_new', 'ii-V-I-minor')
			],
			progress: progressForLick('lk_old', { C: 5000 }),
			sessionLog: [session('ii-V-I-minor', 9999)],
			getProgressionTags: tagsFromMap({
				lk_old: ['major-vamp', 'ii-V-I-major', 'ii-V-I-major-long', 'turnaround'],
				lk_new: ['ii-V-I-minor', 'ii-V-I-minor-long']
			})
		});
		expect(got).toBe('ii-V-I-minor-long');
	});

	it('skips stranded candidates so they cannot starve eligible licks', () => {
		// `lk_strand` has no prog:* tag at all — under opt-in semantics it
		// can never play in any progression. Without the guard it would win
		// the most-neglected race (lastPracticedAt = 0) and force the picker
		// to DEFAULT_PROGRESSION every session, sidelining `lk_real`.
		const got = selectInitialProgression({
			candidates: [
				lick('lk_strand', 'major-chord'),
				lick('lk_real', 'V-I-major')
			],
			progress: progressForLick('lk_real', { C: 1000 }),
			sessionLog: [],
			getProgressionTags: tagsFromMap({
				lk_real: ['ii-V-I-major-long']
			})
		});
		expect(got).toBe('ii-V-I-major-long');
	});

	it('falls back to DEFAULT when every candidate is stranded', () => {
		const got = selectInitialProgression({
			candidates: [
				lick('lk_strand_a', 'major-chord'),
				lick('lk_strand_b', 'user')
			],
			progress: {},
			sessionLog: [],
			getProgressionTags: noTags
		});
		expect(got).toBe(DEFAULT_PROGRESSION);
	});

	it('treats max timestamp across keys for the lick selection', () => {
		// lk_a's most recent key practice is later than lk_b's, so lk_b is
		// the most-neglected. Both licks are opted into their full compat
		// set; minor-vamp wins the tie-break for lk_b (first in pill order).
		const got = selectInitialProgression({
			candidates: [
				lick('lk_a', 'major-chord'),
				lick('lk_b', 'minor-chord')
			],
			progress: {
				...progressForLick('lk_a', { C: 1000, D: 9000 }),
				...progressForLick('lk_b', { C: 500, D: 600 })
			},
			sessionLog: [],
			getProgressionTags: tagsFromMap({
				lk_a: ['major-vamp', 'ii-V-I-major', 'ii-V-I-major-long', 'turnaround'],
				lk_b: [
					'minor-vamp',
					'ii-V-I-minor',
					'ii-V-I-major-long',
					'ii-V-I-minor-long',
					'turnaround'
				]
			})
		});
		expect(got).toBe('minor-vamp');
	});
});

describe('buildUpcomingLicks', () => {
	it('returns [] when no candidates are supplied', () => {
		const got = buildUpcomingLicks({
			candidates: [],
			progress: {},
			getProgressionTags: noTags
		});
		expect(got).toEqual([]);
	});

	it('drops licks with no prog:* tags', () => {
		// Even a category-compatible lick (`major-chord`) is hidden when the
		// user hasn't opted it into any progression.
		const got = buildUpcomingLicks({
			candidates: [lick('lk_mc', 'major-chord')],
			progress: {},
			getProgressionTags: noTags
		});
		expect(got).toEqual([]);
	});

	it('sorts by lastPracticedAt ascending; never-practiced bubbles to top', () => {
		// lk_old: practiced; lk_new: never. Both opted into minor-vamp.
		const got = buildUpcomingLicks({
			candidates: [
				lick('lk_old', 'minor-chord'),
				lick('lk_new', 'minor-chord')
			],
			progress: progressForLick('lk_old', { C: 1000 }),
			getProgressionTags: tagsFromMap({
				lk_old: ['minor-vamp'],
				lk_new: ['minor-vamp']
			})
		});
		expect(got.map((e) => e.lick.id)).toEqual(['lk_new', 'lk_old']);
		expect(got[0].lastPracticedAt).toBe(0);
		expect(got[1].lastPracticedAt).toBe(1000);
	});

	it('returns user-tagged progressions in pill order', () => {
		// lk1 is opted into the full `major-chord` compat set — the same set
		// the setup-time backfill produces — and the result is rendered in
		// PROGRESSION_TEMPLATES key order.
		const got = buildUpcomingLicks({
			candidates: [lick('lk1', 'major-chord')],
			progress: {},
			getProgressionTags: tagsFromMap({
				lk1: ['turnaround', 'major-vamp', 'ii-V-I-major-long', 'ii-V-I-major']
			})
		});
		expect(got).toHaveLength(1);
		expect(got[0].progressions).toEqual([
			'major-vamp',
			'ii-V-I-major',
			'ii-V-I-major-long',
			'turnaround'
		]);
	});

	it('surfaces a category-incompatible lick when the user tags a progression', () => {
		// `pentatonic` has no native progression. With a `prog:blues` tag,
		// the only progression chip shown is the tagged one.
		const got = buildUpcomingLicks({
			candidates: [lick('lk1', 'pentatonic')],
			progress: {},
			getProgressionTags: tagsFromMap({ lk1: ['blues'] })
		});
		expect(got).toHaveLength(1);
		expect(got[0].progressions).toEqual(['blues']);
	});
});

describe('findStrandedLicks', () => {
	it('returns [] when every candidate has at least one prog:* tag', () => {
		const got = findStrandedLicks({
			candidates: [
				lick('lk1', 'major-chord'),
				lick('lk2', 'blues')
			],
			getProgressionTags: tagsFromMap({
				lk1: ['major-vamp'],
				lk2: ['blues']
			})
		});
		expect(got).toEqual([]);
	});

	it('flags any practice-tagged lick without prog:* tags, regardless of category', () => {
		// Under opt-in semantics a `major-chord` lick with no tags is just
		// as stranded as one with an orphan category — both are dropped by
		// the inclusion filter and must be surfaced to the user for fixing.
		const got = findStrandedLicks({
			candidates: [
				lick('lk_orphan', 'long-ii-V-I-major' as never),
				lick('lk_user', 'user'),
				lick('lk_mc', 'major-chord')
			],
			getProgressionTags: noTags
		});
		expect(got.map((l) => l.id)).toEqual(['lk_orphan', 'lk_user', 'lk_mc']);
	});

	it('does not flag a lick whose orphan category is rescued by a prog:* tag', () => {
		// User tagged the orphan-category lick with a prog:* tag — that single
		// progression is enough to keep it eligible.
		const got = findStrandedLicks({
			candidates: [lick('lk', 'long-ii-V-I-major' as never)],
			getProgressionTags: tagsFromMap({ lk: ['ii-V-I-major-long'] })
		});
		expect(got).toEqual([]);
	});
});
