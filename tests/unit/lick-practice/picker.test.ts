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
		// Single tagged blues lick; only `blues` fits.
		const got = selectInitialProgression({
			candidates: [lick('lk1', 'blues')],
			progress: {},
			sessionLog: [],
			getProgressionTags: noTags
		});
		expect(got).toBe('blues');
	});

	it('falls back to first fit in pill order when all fits are tied at 0', () => {
		// `major-chord` fits major-vamp (idx 1), ii-V-I-major (idx 2),
		// ii-V-I-major-long (idx 4), turnaround (idx 6). With no session
		// history, the first in pill order wins.
		const got = selectInitialProgression({
			candidates: [lick('lk1', 'major-chord')],
			progress: {},
			sessionLog: [],
			getProgressionTags: noTags
		});
		expect(got).toBe('major-vamp');
	});

	it('rotates among fitting progressions by least-recently-practiced', () => {
		// User has practiced major-vamp recently; picker must skip it.
		const got = selectInitialProgression({
			candidates: [lick('lk1', 'major-chord')],
			progress: {},
			sessionLog: [session('major-vamp', 1000)],
			getProgressionTags: noTags
		});
		// Next fit in pill order with timestamp 0 is ii-V-I-major.
		expect(got).toBe('ii-V-I-major');
	});

	it('uses the max timestamp per progression across multiple sessions', () => {
		// Lick category 'minor-chord' fits 5 progressions. Every fit has
		// history; the picker must pick the one whose MAX timestamp is the
		// smallest. If it used the MIN timestamp instead it would mistakenly
		// pick minor-vamp (since 200 < 1000); using max correctly yields
		// ii-V-I-minor-long with timestamp 1000.
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
			getProgressionTags: noTags
		});
		expect(got).toBe('ii-V-I-minor-long');
	});

	it('honors user prog:* tags as part of the fitting set', () => {
		// User tagged a `pentatonic` (no category-compatible progression) lick
		// for blues. Without the tag, no fits → DEFAULT_PROGRESSION. With the
		// tag, blues fits.
		const got = selectInitialProgression({
			candidates: [lick('lk1', 'pentatonic')],
			progress: {},
			sessionLog: [],
			getProgressionTags: (id) => (id === 'lk1' ? ['blues'] : [])
		});
		expect(got).toBe('blues');
	});

	it('returns DEFAULT when no progression fits the lick', () => {
		// `user` category isn't listed in any progression; with no prog tag,
		// the picker has no fitting progression and falls back to default.
		const got = selectInitialProgression({
			candidates: [lick('lk1', 'user')],
			progress: {},
			sessionLog: [],
			getProgressionTags: noTags
		});
		expect(got).toBe(DEFAULT_PROGRESSION);
	});

	it('picks the most-neglected lick first, then its least-recently-practiced fit', () => {
		// lk_old (category major-chord) has practice history; lk_new
		// (category ii-V-I-minor) does not. Picker picks lk_new (most
		// neglected). Fits for ii-V-I-minor are ii-V-I-minor and
		// ii-V-I-minor-long; with ii-V-I-minor recently played, the picker
		// rotates to ii-V-I-minor-long.
		const got = selectInitialProgression({
			candidates: [
				lick('lk_old', 'major-chord'),
				lick('lk_new', 'ii-V-I-minor')
			],
			progress: progressForLick('lk_old', { C: 5000 }),
			sessionLog: [session('ii-V-I-minor', 9999)],
			getProgressionTags: noTags
		});
		expect(got).toBe('ii-V-I-minor-long');
	});

	it('skips stranded candidates so they cannot starve eligible licks', () => {
		// `lk_orphan` carries an orphan category (e.g. left over from a removed
		// PhraseCategory enum value) and has no prog tags — it can never play
		// in any progression. Without the guard it would win the most-neglected
		// race (lastPracticedAt = 0) and force the picker to DEFAULT_PROGRESSION
		// every session, sidelining `lk_real` even though `lk_real` carries an
		// explicit prog:* tag pointing at long ii-V-I.
		const got = selectInitialProgression({
			candidates: [
				lick('lk_orphan', 'long-ii-V-I-major' as never),
				lick('lk_real', 'V-I-major')
			],
			progress: progressForLick('lk_real', { C: 1000 }),
			sessionLog: [],
			getProgressionTags: (id) => (id === 'lk_real' ? ['ii-V-I-major-long'] : [])
		});
		expect(got).toBe('ii-V-I-major-long');
	});

	it('falls back to DEFAULT when every candidate is stranded', () => {
		const got = selectInitialProgression({
			candidates: [
				lick('lk_orphan_a', 'long-ii-V-I-major' as never),
				lick('lk_orphan_b', 'user')
			],
			progress: {},
			sessionLog: [],
			getProgressionTags: noTags
		});
		expect(got).toBe(DEFAULT_PROGRESSION);
	});

	it('treats max timestamp across keys for the lick selection', () => {
		// lk_a's most recent key practice is later than lk_b's, so lk_b is
		// the most-neglected. Its category (`minor-chord`) → minor-vamp wins
		// the tie-break (first in pill order).
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
			getProgressionTags: noTags
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

	it('drops licks with no compatible progressions', () => {
		// `pentatonic` is not listed in PROGRESSION_LICK_CATEGORIES and the
		// fake getProgressionTags returns nothing — so the lick is hidden.
		const got = buildUpcomingLicks({
			candidates: [lick('lk_pent', 'pentatonic')],
			progress: {},
			getProgressionTags: noTags
		});
		expect(got).toEqual([]);
	});

	it('sorts by lastPracticedAt ascending; never-practiced bubbles to top', () => {
		// lk_old: practiced; lk_new: never. Both `minor-chord`.
		const got = buildUpcomingLicks({
			candidates: [
				lick('lk_old', 'minor-chord'),
				lick('lk_new', 'minor-chord')
			],
			progress: progressForLick('lk_old', { C: 1000 }),
			getProgressionTags: noTags
		});
		expect(got.map((e) => e.lick.id)).toEqual(['lk_new', 'lk_old']);
		expect(got[0].lastPracticedAt).toBe(0);
		expect(got[1].lastPracticedAt).toBe(1000);
	});

	it('returns category-compatible progressions in pill order for major-chord', () => {
		// `major-chord` fits major-vamp, ii-V-I-major, ii-V-I-major-long, turnaround.
		const got = buildUpcomingLicks({
			candidates: [lick('lk1', 'major-chord')],
			progress: {},
			getProgressionTags: noTags
		});
		expect(got).toHaveLength(1);
		expect(got[0].progressions).toEqual([
			'major-vamp',
			'ii-V-I-major',
			'ii-V-I-major-long',
			'turnaround'
		]);
	});

	it('unions user prog:* tags with category-derived progressions, no duplicates', () => {
		// `major-chord` covers major-vamp etc. natively. User adds `blues` via
		// progression tag — must appear once at the end of pill order.
		const got = buildUpcomingLicks({
			candidates: [lick('lk1', 'major-chord')],
			progress: {},
			getProgressionTags: (id) => (id === 'lk1' ? ['blues', 'major-vamp'] : [])
		});
		expect(got[0].progressions).toEqual([
			'major-vamp',
			'ii-V-I-major',
			'ii-V-I-major-long',
			'turnaround',
			'blues'
		]);
	});

	it('promotes a category-incompatible lick when the user tags a progression', () => {
		// `pentatonic` has no native progression. With a `prog:blues` tag, it
		// surfaces — and the only progression chip is the tagged one.
		const got = buildUpcomingLicks({
			candidates: [lick('lk1', 'pentatonic')],
			progress: {},
			getProgressionTags: (id) => (id === 'lk1' ? ['blues'] : [])
		});
		expect(got).toHaveLength(1);
		expect(got[0].progressions).toEqual(['blues']);
	});
});

describe('findStrandedLicks', () => {
	it('returns [] when every candidate has a fitting progression', () => {
		const got = findStrandedLicks({
			candidates: [
				lick('lk1', 'major-chord'),
				lick('lk2', 'blues')
			],
			getProgressionTags: noTags
		});
		expect(got).toEqual([]);
	});

	it('flags licks with neither prog:* tags nor a category-compatible progression', () => {
		const got = findStrandedLicks({
			candidates: [
				lick('lk_orphan', 'long-ii-V-I-major' as never),
				lick('lk_user', 'user'),
				lick('lk_ok', 'major-chord')
			],
			getProgressionTags: noTags
		});
		expect(got.map((l) => l.id)).toEqual(['lk_orphan', 'lk_user']);
	});

	it('does not flag a lick whose orphan category is rescued by a prog:* tag', () => {
		// User tagged the orphan-category lick with a prog:* tag — that single
		// progression is enough to keep it eligible.
		const got = findStrandedLicks({
			candidates: [lick('lk', 'long-ii-V-I-major' as never)],
			getProgressionTags: (id) => (id === 'lk' ? ['ii-V-I-major-long'] : [])
		});
		expect(got).toEqual([]);
	});
});
