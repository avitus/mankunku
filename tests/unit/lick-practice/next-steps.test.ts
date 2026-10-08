/** Recent session evidence, learning priority, and the report-to-focus-ramp boundary. */
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { buildNextStep, type NextStepInput } from '$lib/state/lick-practice-next-steps';
import { getNextStep, lickPractice } from '$lib/state/lick-practice.svelte';
import { settings } from '$lib/state/settings.svelte';
import { saveLickPracticeSessions, type LickPracticeSessionLogEntry } from '$lib/persistence/lick-practice-sessions';
import { save } from '$lib/persistence/storage';
import type { LickPracticePlanItem, LickReport, SessionReport } from '$lib/types/lick-practice';
import type { PitchClass, Phrase } from '$lib/types/music';

interface KeySpec {
	key: PitchClass;
	score: number;
	pitch?: number;
	rhythm?: number;
}

function makeLickReport(args: {
	lickId?: string;
	lickName?: string;
	keys: KeySpec[];
	averageScore?: number;
	tempo?: number;
	newTempo?: number | null;
}): LickReport {
	const keys = args.keys.map((k) => ({
		key: k.key,
		score: k.score,
		pitchAccuracy: k.pitch ?? k.score,
		rhythmAccuracy: k.rhythm ?? k.score,
		passed: k.score >= 0.9
	}));
	const average =
		args.averageScore ?? (keys.reduce((sum, k) => sum + k.score, 0) / (keys.length || 1));
	return {
		lickId: args.lickId ?? 'lick-a',
		lickName: args.lickName ?? 'Bird Blues',
		tempo: args.tempo ?? 100,
		newTempo: args.newTempo ?? null,
		keys,
		averageScore: average,
		passedCount: keys.filter((k) => k.passed).length
	};
}

function makeReport(licks: LickReport[], overrides: Partial<SessionReport> = {}): SessionReport {
	const totalAttempts = licks.reduce((sum, l) => sum + l.keys.length, 0);
	const flat = licks.flatMap((l) => l.keys);
	return {
		licks,
		overallAverage: flat.length ? flat.reduce((s, k) => s + k.score, 0) / flat.length : 0,
		totalAttempts,
		totalPassed: flat.filter((k) => k.passed).length,
		elapsedMinutes: 10,
		...overrides
	};
}

function makePlanItem(args: {
	phraseId: string;
	kind?: 'lick' | 'trick';
	phrase?: Phrase;
}): LickPracticePlanItem {
	return {
		phraseId: args.phraseId,
		phraseName: args.phraseId,
		phraseNumber: 1,
		category: 'ii-V-I-major',
		keys: ['C'],
		progressionType: 'ii-V-I-major',
		kind: args.kind,
		phrase: args.phrase
	};
}

/** Plan mirroring a report where every entry is an ordinary lick. */
function planFor(report: SessionReport): LickPracticePlanItem[] {
	return report.licks.map((l) => makePlanItem({ phraseId: l.lickId }));
}


function entry(id: string, report: SessionReport, timestamp = 1): LickPracticeSessionLogEntry {
	return { id, timestamp, report, progressionType: 'ii-V-I-major', practiceMode: 'continuous' };
}

function reportFor(scores: number[], ids = ['learning', 'unlocked']): SessionReport {
	return makeReport(scores.map((score, i) => makeLickReport({
		lickId: ids[i], lickName: ids[i], keys: [{ key: 'C', score }]
	})));
}

function inputFor(report: SessionReport, overrides: Partial<NextStepInput> = {}): NextStepInput {
	return {
		report, plan: planFor(report), currentSessionId: 'current', sessionLog: [],
		unlockedKeyCounts: Object.fromEntries(report.licks.map((lick) => [lick.lickId, 4])),
		...overrides
	};
}

/** Oldest to newest, so fixtures describe the player's actual sequence. */
function history(...scores: number[][]): LickPracticeSessionLogEntry[] {
	return scores.map((values, i) => entry(`prior-${i}`, reportFor(values), i + 1));
}

describe('learning keys before persistent all-key weaknesses', () => {
	it('prioritizes a learning key even when a fully unlocked key is much weaker', () => {
		const step = buildNextStep(inputFor(reportFor([0.84, 0.2]), {
			unlockedKeyCounts: { learning: 4, unlocked: 12 },
			sessionLog: history([0.8, 0.3], [0.85, 0.25])
		}));
		expect(step?.action).toMatchObject({ lickId: 'learning', focusKey: 'C' });
		expect(step?.reason).toContain('4/12 keys unlocked');
	});

	it('targets the weak key rather than falling back to the whole lick average', () => {
		const report = makeReport([makeLickReport({ keys: [
			{ key: 'C', score: 0.99 }, { key: 'F', score: 0.8 }
		] })]);
		expect(buildNextStep(inputFor(report))?.action?.focusKey).toBe('F');
	});

	it('can help a newly learned key after its first attempt', () => {
		const step = buildNextStep(inputFor(reportFor([0.7])));
		expect(step?.action?.lickId).toBe('learning');
		expect(step?.reason).toContain('70% this session');
	});

	it('uses the median to rank learning keys instead of today’s lowest score', () => {
		const step = buildNextStep(inputFor(reportFor([0.05, 0.7]), {
			sessionLog: history([0.85, 0.6], [0.8, 0.65])
		}));
		expect(step?.action?.lickId).toBe('unlocked'); // both are learning in this fixture
		expect(step?.reason).toContain('typical score 65%');
	});

	it('does not let one lapse turn a consistently good learning key into a target', () => {
		const step = buildNextStep(inputFor(reportFor([0]), {
			sessionLog: history([0.96], [0.98], [0.95], [0.99])
		}));
		expect(step?.kind).toBe('done');
	});

	it('requires a strict weak majority even with only two sessions', () => {
		expect(buildNextStep(inputFor(reportFor([0]), {
			sessionLog: history([0.99])
		}))?.kind).toBe('done');
	});

	it('recommends persistent weakness on a fully unlocked lick when learning keys are healthy', () => {
		const step = buildNextStep(inputFor(reportFor([0.97, 0.8]), {
			unlockedKeyCounts: { learning: 4, unlocked: 12 },
			sessionLog: history([0.98, 0.7], [0.95, 0.75])
		}));
		expect(step?.action?.lickId).toBe('unlocked');
		expect(step?.reason).toContain('All 12 keys unlocked');
		expect(step?.reason).toContain('3 of its last 3 sessions');
		expect(step?.reason).not.toContain('next key');
	});

	it.each([{ prior: [] }, { prior: [[0.6]] }])('does not infer persistence from one or two poor sessions ($prior)', ({ prior }) => {
		expect(buildNextStep(inputFor(reportFor([0.5]), {
			unlockedKeyCounts: { learning: 12 }, sessionLog: history(...prior)
		}))?.kind).toBe('done');
	});

	it('needs three weak sittings, not just three sittings with a low average', () => {
		expect(buildNextStep(inputFor(reportFor([0.1]), {
			unlockedKeyCounts: { learning: 12 }, sessionLog: history([0.95], [0.1])
		}))?.kind).toBe('done');
	});

	it('retains a persistent weakness through one good session', () => {
		expect(buildNextStep(inputFor(reportFor([0.95]), {
			unlockedKeyCounts: { learning: 12 }, sessionLog: history([0.6], [0.7], [0.65])
		}))?.action?.lickId).toBe('learning');
	});

	it('forgets old weakness outside the most recent five sessions, regardless of log order', () => {
		expect(buildNextStep(inputFor(reportFor([0.95]), {
			unlockedKeyCounts: { learning: 12 },
			sessionLog: history([0.1], [0.1], [0.1], [0.95], [0.95], [0.95], [0.95]).reverse()
		}))?.kind).toBe('done');
	});

	it('treats exactly 90% as proficient and 89.9% as needing practice', () => {
		expect(buildNextStep(inputFor(reportFor([0.9])))?.kind).toBe('done');
		expect(buildNextStep(inputFor(reportFor([0.899])))?.kind).toBe('drill-weak-key');
	});
});

describe('one observation per actual session', () => {
	it('replaces the current incremental log with the current report', () => {
		const report = reportFor([0.2]);
		expect(buildNextStep(inputFor(report, {
			unlockedKeyCounts: { learning: 12 },
			sessionLog: [entry('prior', report), entry('current-ii-V-I-major', report)]
		}))?.kind).toBe('done');
	});

	it('does not count multiple progression slices as multiple sittings', () => {
		const report = reportFor([0.2]);
		expect(buildNextStep(inputFor(report, {
			unlockedKeyCounts: { learning: 12 }, sessionLog: [
				entry('prior-ii-V-I-major', report),
				{ ...entry('prior-major-vamp', report), progressionType: 'major-vamp' }
			]
		}))?.kind).toBe('done');
	});

	it('does not treat repeated rounds in one deep-practice session as persistent weakness', () => {
		const repeated = makeReport([makeLickReport({ lickId: 'learning', keys: [
			{ key: 'C', score: 0.4 }, { key: 'C', score: 0.3 }, { key: 'C', score: 0.2 }
		] })]);
		expect(buildNextStep(inputFor(repeated, {
			unlockedKeyCounts: { learning: 12 }
		}))?.kind).toBe('done');
	});

	it('skips sessions that did not attempt this key', () => {
		const otherKey = makeReport([makeLickReport({ lickId: 'learning', keys: [{ key: 'F', score: 0 }] })]);
		expect(buildNextStep(inputFor(reportFor([0.5]), {
			unlockedKeyCounts: { learning: 12 },
			sessionLog: [entry('one', otherKey), entry('two', otherKey)]
		}))?.kind).toBe('done');
	});
});

describe('report boundaries and action plumbing', () => {
	it('retains the broad poor-session rest veto', () => {
		const report = reportFor([0.6]);
		report.totalAttempts = 8;
		expect(buildNextStep(inputFor(report))).toMatchObject({ kind: 'rest', action: null });
		report.totalAttempts = 7;
		expect(buildNextStep(inputFor(report))?.kind).toBe('drill-weak-key');
		report.totalAttempts = 8;
		report.overallAverage = 0.75;
		expect(buildNextStep(inputFor(report))?.kind).not.toBe('rest');
	});

	it('never targets a trick, even if it has the worst score', () => {
		const report = reportFor([0.1, 0.8]);
		const plan = planFor(report);
		plan[0].kind = 'trick';
		expect(buildNextStep(inputFor(report, { plan }))?.action?.lickId).toBe('unlocked');
		plan[1].kind = 'trick';
		expect(buildNextStep(inputFor(report, { plan }))?.action).toBeNull();
	});

	it('returns null for an empty report and avoids recommendations without unlock evidence', () => {
		expect(buildNextStep(inputFor(makeReport([])))).toBeNull();
		expect(buildNextStep(inputFor(reportFor([0.5]), { unlockedKeyCounts: {} }))?.kind).toBe('done');
	});

	it('preserves resolved user phrases and concert focus keys while formatting written pitch', () => {
		const report = reportFor([0.7]);
		const phrase = { id: 'learning' } as Phrase;
		const plan = [makePlanItem({ phraseId: 'learning', phrase })];
		const step = buildNextStep(inputFor(report, { plan, formatKey: () => 'D' }));
		expect(step?.headline).toBe('Drill D on learning.');
		expect(step?.reason).toContain('starts on D alone');
		expect(step?.action).toMatchObject({ kind: 'deep', lickId: 'learning', focusKey: 'C' });
		expect(step?.action?.phrase).toBe(phrase);
	});
});

describe('getNextStep reads persisted learning state and history', () => {
	const store = new Map<string, string>();
	beforeEach(() => {
		vi.stubGlobal('localStorage', {
			getItem: (key: string) => store.get(key) ?? null,
			setItem: (key: string, value: string) => store.set(key, value),
			removeItem: (key: string) => store.delete(key)
		});
		lickPractice.progress = {};
	});
	afterEach(() => {
		store.clear();
		vi.unstubAllGlobals();
		lickPractice.plan = [];
		lickPractice.progress = {};
		settings.instrumentId = 'tenor-sax';
	});

	it('uses explicit unlock counts and persisted history, excluding current-session writes', () => {
		const report = reportFor([0.85, 0.2]);
		lickPractice.plan = planFor(report);
		save('lick-unlock-count', { learning: 4, unlocked: 12 });
		saveLickPracticeSessions([...history([0.8, 0.3], [0.85, 0.25]), entry('current-ii-V-I-major', report)]);
		expect(getNextStep(report, 'current')?.action?.lickId).toBe('learning');
	});

	it('does not classify a short report for a fully unlocked lick as learning', () => {
		const report = reportFor([0.2]);
		lickPractice.plan = planFor(report);
		save('lick-unlock-count', { learning: 12 });
		expect(getNextStep(report, 'current')?.kind).toBe('done');
	});

	it('honors legacy all-key progress when no explicit count exists', () => {
		const keys: PitchClass[] = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
		lickPractice.progress.learning = Object.fromEntries(keys.map((key) => [key, {
			currentTempo: 120, lastPracticedAt: 1, passCount: 4
		}]));
		const report = reportFor([0.2]);
		lickPractice.plan = planFor(report);
		expect(getNextStep(report, 'current')?.kind).toBe('done');
	});

	it('uses the session log to suppress a one-off lapse on a learning key', () => {
		const report = reportFor([0]);
		lickPractice.plan = planFor(report);
		saveLickPracticeSessions(history([0.96], [0.98], [0.95]));
		expect(getNextStep(report, 'current')?.kind).toBe('done');
	});

	it.each([['concert', 'C-'], ['tenor-sax', 'D-'], ['alto-sax', 'A-']])(
		'labels a minor recommendation in %s as %s and keeps concert pitch in the action', (instrumentId, written) => {
			settings.instrumentId = instrumentId;
			const report = reportFor([0.69]);
			report.licks[0].lickName = 'Sonny Stitt - Indiana';
			report.licks[0].progressionType = 'ii-V-I-minor';
			// The report's played progression owns the label even if another
			// progression for the same lick appears earlier in the plan.
			lickPractice.plan = planFor(report);
			const step = getNextStep(report, 'current');
			expect(step?.headline).toBe(`Drill ${written} on Sonny Stitt - Indiana.`);
			expect(step?.reason).toContain(`${written} scored 69%`);
			expect(step?.reason).toContain(`starts on ${written} alone`);
			expect(step?.action?.focusKey).toBe('C');
		}
	);

	it('uses the plan progression for older reports without one', () => {
		settings.instrumentId = 'concert';
		const report = reportFor([0.69]);
		lickPractice.plan = planFor(report).map(item => ({ ...item, progressionType: 'ii-V-I-minor' }));
		expect(getNextStep(report, 'current')?.headline).toBe('Drill C- on learning.');
	});

	it.each([['tenor-sax', 'D'], ['alto-sax', 'A'], ['concert', 'C']])(
		'formats concert C as %s written %s without changing the focus key', (instrumentId, written) => {
			settings.instrumentId = instrumentId;
			const report = reportFor([0.6]);
			lickPractice.plan = planFor(report);
			const step = getNextStep(report, 'current');
			expect(step?.headline).toBe(`Drill ${written} on learning.`);
			expect(step?.action?.focusKey).toBe('C');
		}
	);
});
