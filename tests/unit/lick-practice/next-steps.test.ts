/**
 * End-of-session "next step" policy — one recommendation, or none.
 *
 * The suite is mostly boundary cases, because every number in the rule set is
 * an existing engine threshold and the whole value of the card is that it
 * names the gate the engine actually applied:
 *  - the weak-key floor is `< 0.75` (KEY_FLOOR_THRESHOLD), so exactly 0.75 is
 *    NOT weak — matching the unlock/tempo gate in lick-practice.svelte.ts
 *  - the rest veto needs BOTH a sub-floor average AND enough attempts, so a
 *    short bad patch never tells the user to stop
 *  - trick report entries carry composite variant keys as their `lickId`;
 *    handing one to a lick start path is a real bug, so they are never targeted
 */

import { describe, it, expect } from 'vitest';
import { buildNextStep } from '$lib/state/lick-practice-next-steps';
import type { LickPracticePlanItem, LickReport, SessionReport } from '$lib/types/lick-practice';
import type { PitchClass, Phrase } from '$lib/types/music';

// ── fixtures ───────────────────────────────────────────────

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

// ── Rule 1: rest veto ──────────────────────────────────────

describe('buildNextStep — rest veto', () => {
	it('recommends stopping when the session average is under the floor over enough keys', () => {
		const report = makeReport(
			[makeLickReport({ keys: [{ key: 'C', score: 0.68 }] })],
			{ overallAverage: 0.68, totalAttempts: 14 }
		);
		const step = buildNextStep({ report, plan: planFor(report) });
		expect(step?.kind).toBe('rest');
		expect(step?.action).toBeNull();
		expect(step?.reason).toContain('68%');
		expect(step?.reason).toContain('14');
	});

	it('does NOT veto at exactly the floor (0.75) — the gate is strictly below', () => {
		const report = makeReport([makeLickReport({ keys: [{ key: 'C', score: 0.75 }] })], {
			overallAverage: 0.75,
			totalAttempts: 20
		});
		expect(buildNextStep({ report, plan: planFor(report) })?.kind).not.toBe('rest');
	});

	it('vetoes at 0.749 with 8 attempts', () => {
		const report = makeReport([makeLickReport({ keys: [{ key: 'C', score: 0.749 }] })], {
			overallAverage: 0.749,
			totalAttempts: 8
		});
		expect(buildNextStep({ report, plan: planFor(report) })?.kind).toBe('rest');
	});

	it('does NOT veto at 0.60 with only 7 attempts — too short to call it grinding', () => {
		const report = makeReport([makeLickReport({ keys: [{ key: 'C', score: 0.6 }] })], {
			overallAverage: 0.6,
			totalAttempts: 7
		});
		expect(buildNextStep({ report, plan: planFor(report) })?.kind).not.toBe('rest');
	});

	it('outranks a weak key: both conditions true still yields the rest step with no action', () => {
		const report = makeReport(
			[
				makeLickReport({
					lickId: 'lick-a',
					keys: [
						{ key: 'C', score: 0.5 },
						{ key: 'F', score: 0.7 }
					]
				})
			],
			{ overallAverage: 0.6, totalAttempts: 10 }
		);
		const step = buildNextStep({ report, plan: planFor(report) });
		expect(step?.kind).toBe('rest');
		expect(step?.action).toBeNull();
	});
});

// ── Rule 2: the one recommendation ─────────────────────────

describe('buildNextStep — weakest key', () => {
	it('does not treat exactly 0.75 as weak', () => {
		const report = makeReport([
			makeLickReport({
				keys: [
					{ key: 'C', score: 0.75 },
					{ key: 'F', score: 0.8 }
				]
			})
		]);
		expect(buildNextStep({ report, plan: planFor(report) })?.kind).not.toBe('drill-weak-key');
	});

	it('treats 0.749 as weak', () => {
		const report = makeReport([
			makeLickReport({
				keys: [
					{ key: 'C', score: 0.749 },
					{ key: 'F', score: 0.95 }
				]
			})
		]);
		expect(buildNextStep({ report, plan: planFor(report) })?.kind).toBe('drill-weak-key');
	});

	it('names the weak key, the lick and the number, and tees up deep practice on it', () => {
		const report = makeReport([
			makeLickReport({
				lickId: 'lick-a',
				lickName: 'Bird Blues',
				keys: [
					{ key: 'C', score: 0.6 },
					{ key: 'F', score: 0.95 }
				]
			})
		]);
		const step = buildNextStep({ report, plan: planFor(report) });
		expect(step?.kind).toBe('drill-weak-key');
		expect(step?.headline).toContain('C');
		expect(step?.headline).toContain('Bird Blues');
		expect(step?.reason).toContain('60%');
		expect(step?.action).toEqual(
			expect.objectContaining({ kind: 'deep', lickId: 'lick-a' })
		);
	});

	it('picks the single lowest key across licks and names THAT key', () => {
		const report = makeReport([
			makeLickReport({
				lickId: 'lick-a',
				lickName: 'Blues Head',
				keys: [{ key: 'C', score: 0.7 }]
			}),
			makeLickReport({
				lickId: 'lick-b',
				lickName: 'Donna Lee',
				keys: [
					{ key: 'Db', score: 0.55 },
					{ key: 'G', score: 0.99 }
				]
			})
		]);
		const step = buildNextStep({ report, plan: planFor(report) });
		expect(step?.kind).toBe('drill-weak-key');
		expect(step?.action?.lickId).toBe('lick-b');
		expect(step?.headline).toContain('Db');
		expect(step?.headline).toContain('Donna Lee');
		expect(step?.headline).not.toContain('Blues Head');
	});

	it('skips trick entries entirely, even when the trick holds the worst key', () => {
		const report = makeReport([
			makeLickReport({
				lickId: 'enclosures:scale=major',
				lickName: 'Enclosures',
				keys: [{ key: 'C', score: 0.3 }]
			}),
			makeLickReport({
				lickId: 'lick-a',
				lickName: 'Bird Blues',
				keys: [{ key: 'F', score: 0.6 }]
			})
		]);
		const plan = [
			makePlanItem({ phraseId: 'enclosures:scale=major', kind: 'trick' }),
			makePlanItem({ phraseId: 'lick-a' })
		];
		const step = buildNextStep({ report, plan });
		expect(step?.action?.lickId).toBe('lick-a');
		expect(step?.headline).toContain('F');
		expect(step?.headline).not.toContain('Enclosures');
	});

	it('adds the time-not-notes clause when rhythm trails pitch by more than 0.15', () => {
		const report = makeReport([
			makeLickReport({
				keys: [{ key: 'C', score: 0.7, pitch: 0.8, rhythm: 0.6 }]
			})
		]);
		const step = buildNextStep({ report, plan: planFor(report) });
		expect(step?.kind).toBe('drill-weak-key');
		expect(step?.reason).toContain('time, not the notes');
	});

	it('omits the time-not-notes clause at a 0.10 gap', () => {
		const report = makeReport([
			makeLickReport({
				keys: [{ key: 'C', score: 0.74, pitch: 0.8, rhythm: 0.7 }]
			})
		]);
		const step = buildNextStep({ report, plan: planFor(report) });
		expect(step?.kind).toBe('drill-weak-key');
		expect(step?.reason).not.toContain('time, not the notes');
	});

	it('renders the key through the injected written-pitch formatter', () => {
		const report = makeReport([makeLickReport({ keys: [{ key: 'C', score: 0.5 }] })]);
		const step = buildNextStep({
			report,
			plan: planFor(report),
			formatKey: (k) => (k === 'C' ? 'D' : k) // tenor sax: concert C reads as D
		});
		expect(step?.headline).toContain('D');
		expect(step?.headline).not.toMatch(/\bC\b/);
	});
});

describe('buildNextStep — weakest lick when no key trips the floor', () => {
	it('targets the lick with the lowest average', () => {
		const report = makeReport([
			makeLickReport({
				lickId: 'lick-a',
				lickName: 'Blues Head',
				keys: [{ key: 'C', score: 0.88 }]
			}),
			makeLickReport({
				lickId: 'lick-b',
				lickName: 'Donna Lee',
				keys: [{ key: 'F', score: 0.79 }]
			})
		]);
		const step = buildNextStep({ report, plan: planFor(report) });
		expect(step?.kind).toBe('drill-weak-lick');
		expect(step?.action?.lickId).toBe('lick-b');
		expect(step?.headline).toContain('Donna Lee');
		expect(step?.reason).toContain('79%');
		expect(step?.reason).toContain('weakest of the set');
	});

	it('drops the "weakest of the set" claim when the session held one lick', () => {
		const report = makeReport([
			makeLickReport({ lickName: 'Donna Lee', keys: [{ key: 'C', score: 0.83 }] })
		]);
		const step = buildNextStep({ report, plan: planFor(report) });
		expect(step?.kind).toBe('drill-weak-lick');
		expect(step?.reason).toContain('83%');
		expect(step?.reason).not.toContain('weakest of the set');
	});

	it('flags nothing when every lick is at or above proficient', () => {
		const report = makeReport([
			makeLickReport({ lickId: 'lick-a', keys: [{ key: 'C', score: 0.9 }] }),
			makeLickReport({ lickId: 'lick-b', keys: [{ key: 'F', score: 0.97 }] })
		]);
		const step = buildNextStep({ report, plan: planFor(report) });
		expect(step?.kind).toBe('done');
		expect(step?.action).toBeNull();
	});

	it('ignores trick entries when picking the lowest average', () => {
		const report = makeReport([
			makeLickReport({ lickId: 'trick:variant', lickName: 'Triad Pairs', keys: [{ key: 'C', score: 0.8 }] }),
			makeLickReport({ lickId: 'lick-a', lickName: 'Bird Blues', keys: [{ key: 'F', score: 0.86 }] })
		]);
		const plan = [
			makePlanItem({ phraseId: 'trick:variant', kind: 'trick' }),
			makePlanItem({ phraseId: 'lick-a' })
		];
		const step = buildNextStep({ report, plan });
		expect(step?.action?.lickId).toBe('lick-a');
	});
});

// ── Rule 3: fallback ───────────────────────────────────────

describe('buildNextStep — fallback', () => {
	it('has nothing to target in an all-trick report and says so without an action', () => {
		const report = makeReport([
			makeLickReport({ lickId: 'trick:a', lickName: 'Enclosures', keys: [{ key: 'C', score: 0.6 }] })
		]);
		const plan = [makePlanItem({ phraseId: 'trick:a', kind: 'trick' })];
		const step = buildNextStep({ report, plan });
		expect(step?.kind).toBe('done');
		expect(step?.action).toBeNull();
	});

	it('returns null for a report with no attempts at all', () => {
		expect(buildNextStep({ report: makeReport([]), plan: [] })).toBeNull();
	});
});

// ── Action plumbing + shape invariants ─────────────────────

describe('buildNextStep — action plumbing', () => {
	it('carries the plan item resolved Phrase so user/community licks survive a getLickById miss', () => {
		const phrase = { id: 'lick-a', name: 'Bird Blues' } as unknown as Phrase;
		const report = makeReport([
			makeLickReport({ lickId: 'lick-a', keys: [{ key: 'C', score: 0.5 }] })
		]);
		const plan = [makePlanItem({ phraseId: 'lick-a', phrase })];
		expect(buildNextStep({ report, plan })?.action?.phrase).toBe(phrase);
	});

	it('falls back to the bare lick id when the plan item carries no phrase', () => {
		const report = makeReport([
			makeLickReport({ lickId: 'lick-a', keys: [{ key: 'C', score: 0.5 }] })
		]);
		const step = buildNextStep({ report, plan: planFor(report) });
		expect(step?.action?.phrase).toBeUndefined();
		expect(step?.action?.lickId).toBe('lick-a');
	});

	it('still targets a lick whose report entry has no matching plan item', () => {
		const report = makeReport([
			makeLickReport({ lickId: 'lick-a', keys: [{ key: 'C', score: 0.5 }] })
		]);
		const step = buildNextStep({ report, plan: [] });
		expect(step?.action?.lickId).toBe('lick-a');
	});
});

describe('buildNextStep — shape invariants', () => {
	const cases: { name: string; input: Parameters<typeof buildNextStep>[0] }[] = [
		{
			name: 'weak key',
			input: (() => {
				const report = makeReport([makeLickReport({ keys: [{ key: 'C', score: 0.5 }] })]);
				return { report, plan: planFor(report) };
			})()
		},
		{
			name: 'weak lick',
			input: (() => {
				const report = makeReport([makeLickReport({ keys: [{ key: 'C', score: 0.82 }] })]);
				return { report, plan: planFor(report) };
			})()
		},
		{
			name: 'rest',
			input: (() => {
				const report = makeReport([makeLickReport({ keys: [{ key: 'C', score: 0.5 }] })], {
					overallAverage: 0.5,
					totalAttempts: 12
				});
				return { report, plan: planFor(report) };
			})()
		},
		{
			name: 'done',
			input: (() => {
				const report = makeReport([makeLickReport({ keys: [{ key: 'C', score: 0.99 }] })]);
				return { report, plan: planFor(report) };
			})()
		}
	];

	for (const c of cases) {
		it(`${c.name}: a startable step always has an action, a do-nothing step never does`, () => {
			const step = buildNextStep(c.input);
			expect(step).not.toBeNull();
			if (step!.kind === 'rest' || step!.kind === 'done') {
				expect(step!.action).toBeNull();
			} else {
				expect(step!.action).not.toBeNull();
				expect(step!.action?.kind).toBe('deep');
				expect(step!.action?.label.length).toBeGreaterThan(0);
			}
			expect(step!.headline.length).toBeGreaterThan(0);
			expect(step!.reason.length).toBeGreaterThan(0);
		});
	}
});
