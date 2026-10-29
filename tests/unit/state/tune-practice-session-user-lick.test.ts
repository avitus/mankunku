import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Phrase } from '$lib/types/music';
import type { Tune } from '$lib/types/tune';
import { saveUserLick } from '$lib/persistence/user-licks';
import { saveLickPracticeProgress } from '$lib/persistence/lick-practice-store';
import {
	initTunePractice,
	previewSessionPlan,
	resetTunePractice,
	startTunePracticeSession,
	suggestionNameFor,
	tunePractice
} from '$lib/state/tune-practice.svelte';
import { fractionToFloat } from '$lib/music/intervals';

/**
 * The session's OWN path, end to end from storage: a user's Minor Chord lick
 * saved in the book reaches the plan as that chord's window (2026-09-17). The
 * pure planner is covered in tune-practice-role-windows.test.ts; this pins
 * the deps assembler, the expanded timeline and the head shift together.
 */

const store: Record<string, string> = {};
Object.defineProperty(globalThis, 'localStorage', {
	writable: true,
	value: {
		getItem: (k: string) => store[k] ?? null,
		setItem: (k: string, v: string) => {
			store[k] = v;
		},
		removeItem: (k: string) => delete store[k],
		clear: () => {
			for (const k of Object.keys(store)) delete store[k];
		},
		get length() {
			return Object.keys(store).length;
		},
		key: (i: number) => Object.keys(store)[i] ?? null
	}
});

const autumnLeaves = JSON.parse(
	readFileSync(
		resolve('tests/fixtures/leadsheets/pdf-vs-musescore/autumn-leaves.musescore-import.json'),
		'utf8'
	)
) as Tune;

const minorLick: Phrase = {
	id: 'e2e-minor-lick',
	name: 'E2E Minor Lick',
	timeSignature: [4, 4],
	key: 'C',
	notes: [
		{ pitch: 63, duration: [1, 2], offset: [0, 1] },
		{ pitch: 62, duration: [1, 2], offset: [1, 2] },
		{ pitch: 60, duration: [1, 1], offset: [1, 1] }
	],
	harmony: [
		{
			chord: { root: 'C', quality: 'min7' },
			scaleId: 'major.dorian',
			startOffset: [0, 1],
			duration: [2, 1],
			symbol: 'C-7'
		}
	],
	difficulty: { level: 20, pitchComplexity: 20, rhythmComplexity: 20, lengthBars: 2 },
	category: 'minor-chord',
	tags: ['practice'],
	source: 'user-entered'
};

describe('a saved Minor Chord lick reaches the session as its own window', () => {
	beforeEach(() => {
		localStorage.clear();
		resetTunePractice();
		saveUserLick(minorLick);
		// Known in E: the lick the player HAS in the key gets its windows.
		saveLickPracticeProgress({
			'e2e-minor-lick': { E: { passCount: 1, currentTempo: 240, lastPracticedAt: 1 } }
		});
		initTunePractice(autumnLeaves);
		tunePractice.config.mode = 'points';
		tunePractice.config.playHead = true;
		tunePractice.config.choruses = 1;
	});

	it('plans the turnaround licks on returning solos and the closing licks only on the last headless solo', () => {
		const endings: Tune = { ...autumnLeaves, id: 'test-endings', key: 'C', timeSignature: [4, 4], sections: [
			{ label: 'A', bars: 4, repeatStart: true, notes: [{ pitch: 60, offset: [0, 1], duration: [1, 1] }],
				harmony: [{ chord: { root: 'C', quality: 'maj7' }, startOffset: [0, 1], duration: [4, 1], scaleId: 'major.ionian' }] },
			{ label: 'Turnaround', bars: 2, ending: 1, repeatEnd: true, notes: [],
				harmony: [{ chord: { root: 'E', quality: 'min7' }, startOffset: [0, 1], duration: [2, 1], scaleId: 'major.dorian' }] },
			{ label: 'Finish', bars: 3, ending: 2, notes: [],
				harmony: [{ chord: { root: 'F', quality: 'min7' }, startOffset: [0, 1], duration: [3, 1], scaleId: 'major.dorian' }] }
		] };
		for (const playHead of [true, false]) {
			initTunePractice(endings);
			tunePractice.config.playHead = playHead;
			tunePractice.config.choruses = 2;
			const audio = startTunePracticeSession(endings, 480);
			const minorWindows = tunePractice.plan.filter(ip => ip.progressionType === 'minor-vamp');
			expect(minorWindows.map(ip => ip.keyCenter)).toEqual(playHead ? ['E', 'E'] : ['E', 'F']);
			expect(minorWindows.map(ip => ip.notationBarRange.start)).toEqual([4, 4]);
			expect(minorWindows[0].suggestions[0]?.lickId).toBe('e2e-minor-lick');
			expect(audio.playedPhrase.difficulty.lengthBars).toBe(playHead ? 25 : 13);
			const firstSolo = playHead ? 6 : 0;
			expect(minorWindows.map(ip => ip.openTick)).toEqual([
				(audio.countInBars + firstSolo + 4) * 4 * 480,
				(audio.countInBars + firstSolo + 10) * 4 * 480
			]);
			expect(tunePractice.plan.every(ip => ip.closeTick <= (audio.countInBars + (audio.outroStartBar ?? 13)) * 4 * 480)).toBe(true);
			resetTunePractice();
		}
	});

	it('plans Minor windows on the 2-bar E- stretches of the solo chorus, named with the key', () => {
		startTunePracticeSession(autumnLeaves, 480);
		const minors = tunePractice.plan.filter((ip) => ip.progressionType === 'minor-vamp');
		expect(minors.map((ip) => fractionToFloat(ip.startOffset))).toEqual([7, 15, 19, 31]);
		expect(minors.every((ip) => ip.suggestions[0]?.lickId === 'e2e-minor-lick')).toBe(true);
		expect(minors.map((ip) => ip.keyCenter)).toEqual(['E', 'E', 'E', 'E']);
		// Written for the default tenor: concert E- reads F#-.
		expect(suggestionNameFor(minors[0])).toBe('E2E Minor Lick · F#-');
		// The long cadences keep their progression bands but name no lick: the
		// player has no cadence lick, and Points offers only their own book —
		// never a curated lick they have never seen (2026-10-07).
		const longs = tunePractice.plan.filter((ip) => ip.progressionType !== 'minor-vamp');
		expect(longs.length).toBeGreaterThan(0);
		for (const ip of longs) expect(ip.suggestions).toEqual([]);
	});

	it('offers no curated lick anywhere in the plan, in Points or Suggest', () => {
		for (const mode of ['points', 'suggest'] as const) {
			resetTunePractice();
			tunePractice.config.mode = mode;
			startTunePracticeSession(autumnLeaves, 480);
			const offered = new Set(tunePractice.plan.flatMap((ip) => ip.suggestions.map((s) => s.lickId)));
			expect([...offered], mode).toEqual(['e2e-minor-lick']);
		}
	});

	it('passes the full performed form to audio after the head and repeated solo choruses', () => {
		tunePractice.config.choruses = 2;
		const { playedPhrase, leadBars, outroStartBar } = startTunePracticeSession(autumnLeaves, 480);
		const form = playedPhrase.performanceForm!;
		// Preserve the original head/solo contract; main now appends the resolved melody head.
		expect(form.choruses.slice(0, 3).map((c) => c.role)).toEqual(['head', 'solo', 'solo']);
		expect(form.choruses).toHaveLength(4);
		expect(form.choruses[3]).toMatchObject({ role: 'head', startBar: outroStartBar, endBarExclusive: form.totalBars });
		expect(form.choruses[2].endBarExclusive).toBe(outroStartBar);
		expect(form.choruses[1].startBar).toBe(leadBars);
		expect(form.totalBars).toBe(playedPhrase.difficulty.lengthBars);
		expect(form.choruses.at(-1)?.endBarExclusive).toBe(form.totalBars);
		expect(playedPhrase.sectionMap?.at(-1)?.barOffset).toBe(form.sections.at(-1)?.startBar);
		expect(playedPhrase.sectionMap!.some((s) => s.barOffset >= form.choruses[2].startBar)).toBe(true);
	});
});

describe('setup proposes the same known licks as the playing session', () => {
	beforeEach(() => {
		localStorage.clear();
		resetTunePractice();
		saveUserLick(minorLick);
		saveUserLick({ ...minorLick, id: 'second-minor-lick', name: 'Another Minor Line' });
		saveLickPracticeProgress({
			'e2e-minor-lick': { E: { passCount: 1, currentTempo: 120, lastPracticedAt: 1 } },
			'second-minor-lick': { E: { passCount: 1, currentTempo: 120, lastPracticedAt: 1 } }
		});
		initTunePractice(autumnLeaves);
		Object.assign(tunePractice.config, {
			mode: 'suggest', strictness: 'guided', tempo: 100,
			concertKey: autumnLeaves.key, playHead: true, choruses: 2
		});
	});

	it.each([true, false])('previews automatic rotation and role windows without starting a session (head %s)', (playHead) => {
		tunePractice.config.playHead = playHead;
		const startTime = tunePractice.startTime;
		const preview = previewSessionPlan(autumnLeaves, playHead, 2);
		expect(tunePractice.phase).toBe('setup');
		expect(tunePractice.plan).toEqual([]);
		expect(tunePractice.pickedSuggestion).toEqual({});
		expect(tunePractice.startTime).toBe(startTime);
		const names = new Set(preview.markers.map(marker => marker.lickName).filter(Boolean));
		expect(names).toEqual(new Set(['E2E Minor Lick · F#-', 'Another Minor Line · F#-']));
		expect(preview.matchedCount).toBeGreaterThan(0);

		startTunePracticeSession(autumnLeaves, 960);
		expect(preview.total).toBe(tunePractice.plan.length);
		expect(preview.matchedCount).toBe(tunePractice.plan.filter(ip => ip.suggestions.length > 0).length);
		for (const marker of preview.markers) {
			const firstVisit = tunePractice.plan.find(ip => ip.markerKey === marker.id)!;
			expect(marker.lickName).toBe(suggestionNameFor(firstVisit));
			expect(marker.label).toBe(suggestionNameFor(firstVisit) ?? firstVisit.bandName);
			expect(marker.timeRange).toEqual(firstVisit.notationTimeRange);
		}
	});

	it('updates eligibility when tempo or concert key changes, without offering unlearned curated licks', () => {
		expect(previewSessionPlan(autumnLeaves, true).matchedCount).toBeGreaterThan(0);
		tunePractice.config.tempo = 135;
		expect(previewSessionPlan(autumnLeaves, true).matchedCount).toBe(0);
		tunePractice.config.tempo = 100;
		tunePractice.config.concertKey = 'D';
		const transposed = previewSessionPlan(autumnLeaves, true);
		expect(transposed.matchedCount).toBe(0);
		expect(transposed.markers.every(marker => marker.lickName === null)).toBe(true);
		tunePractice.config.concertKey = autumnLeaves.key;
		expect(previewSessionPlan(autumnLeaves, true).matchedCount).toBeGreaterThan(0);
	});
});

// 2026-10-22: the drummer counts the tune in — one bar, two above 150 BPM —
// and the session's windows sit behind that count on the transport.
describe('the session counts in by tempo', () => {
	beforeEach(() => {
		localStorage.clear();
		resetTunePractice();
		saveUserLick(minorLick);
		saveLickPracticeProgress({
			'e2e-minor-lick': { E: { passCount: 1, currentTempo: 240, lastPracticedAt: 1 } }
		});
		initTunePractice(autumnLeaves);
		tunePractice.config.mode = 'points';
	});

	it('counts one bar at 150 BPM and two above, moving every window a bar later', () => {
		tunePractice.config.tempo = 150;
		const slow = startTunePracticeSession(autumnLeaves, 480);
		const slowOpens = tunePractice.plan.map((ip) => ip.openTick);
		expect(slow.countInBars).toBe(1);

		resetTunePractice();
		tunePractice.config.tempo = 151;
		const fast = startTunePracticeSession(autumnLeaves, 480);
		expect(fast.countInBars).toBe(2);
		const barTicks = autumnLeaves.timeSignature[0] * 480;
		expect(tunePractice.plan.map((ip) => ip.openTick)).toEqual(slowOpens.map((t) => t + barTicks));
	});

	// 2026-10-25, Andy: the count stopped at a pickup bar. Autumn Leaves opens
	// on a three-beat pickup, and with the head the count runs on through its
	// bar. Without one the session opens on bar 1 — the pickup bar is the
	// head's alone — so there is nothing to count through. The windows do not
	// move: the pickup bar is the form's bar 0.
	it('counts on through the pickup bar the session opens on', () => {
		tunePractice.config.playHead = true;
		const withHead = startTunePracticeSession(autumnLeaves, 480);
		expect(withHead.countInPickup).toBe(true);
		const opens = tunePractice.plan.map((ip) => ip.openTick);

		resetTunePractice();
		tunePractice.config.playHead = false;
		expect(startTunePracticeSession(autumnLeaves, 480).countInPickup).toBe(false);

		resetTunePractice();
		tunePractice.config.playHead = true;
		const noPickup: Tune = { ...autumnLeaves, id: 'no-pickup', sections: autumnLeaves.sections.slice(1) };
		initTunePractice(noPickup);
		tunePractice.config.playHead = true;
		expect(startTunePracticeSession(noPickup, 480).countInPickup).toBe(false);

		resetTunePractice();
		initTunePractice(autumnLeaves);
		tunePractice.config.mode = 'points';
		tunePractice.config.playHead = true;
		startTunePracticeSession(autumnLeaves, 480);
		expect(tunePractice.plan.map((ip) => ip.openTick)).toEqual(opens);
	});

	// 2026-10-25, Andy: the appended solo chorus replayed the pickup bar — a
	// bar with no chord and, after the head, no melody — so the band dropped
	// out for a bar after the head and before every further chorus. Each
	// chorus now runs bar 1 to the end, as the desk's form loop does.
	it('runs every solo chorus from bar 1, the pickup played once with the head', () => {
		tunePractice.config.playHead = true;
		tunePractice.config.choruses = 2;
		const plan = startTunePracticeSession(autumnLeaves, 480);
		const formBars = plan.flat.totalBars; // 33: the pickup bar and the 32-bar form
		expect(plan.leadBars).toBe(formBars);
		expect(plan.practiceStartBar).toBe(1);
		expect(plan.outroStartBar).toBe(formBars + 2 * (formBars - 1));
		expect(plan.playedPhrase.difficulty.lengthBars).toBe(formBars + 3 * (formBars - 1));
		expect(tunePractice.plan.every(ip => ip.closeTick <= (plan.countInBars + plan.outroStartBar!) * autumnLeaves.timeSignature[0] * 480)).toBe(true);
		// The first solo chord sounds straight after the head's last bar (4/4:
		// a bar is one whole note).
		const solo = plan.playedPhrase.harmony.filter((h) => fractionToFloat(h.startOffset) >= formBars);
		expect(fractionToFloat(solo[0].startOffset)).toBe(formBars);
		// The band reads the same timeline (CodeRabbit on #288): each solo
		// chorus's first section starts on that chorus's bar 1.
		const soloSections = (plan.playedPhrase.sectionMap ?? []).filter((e) => e.barOffset >= formBars && e.barOffset < plan.outroStartBar!);
		expect(soloSections[0]?.barOffset).toBe(formBars);
		expect(soloSections.map((e) => e.barOffset)).toContain(formBars + (formBars - 1));
		expect(Math.max(...soloSections.map((e) => e.barOffset))).toBeLessThan(formBars + 2 * (formBars - 1));
		// Every window opens on its chart position counted from bar 1.
		const barTicks = autumnLeaves.timeSignature[0] * 480;
		const perChorus = tunePractice.plan.length / 2;
		tunePractice.plan.forEach((ip, i) => {
			const chorus = Math.floor(i / perChorus);
			const formBar = fractionToFloat(ip.startOffset) - chorus * (formBars - 1);
			expect(ip.openTick).toBe((plan.countInBars + formBars + chorus * (formBars - 1) + formBar - 1) * barTicks);
		});
		tunePractice.config.choruses = 1;
	});

	// When the Saints writes its C6 from the pickup bar. Skipping that bar in
	// the solo chorus must not lose the vamp it opens: the chord sounds from
	// bar 1, where the band comes in (the setup e2e counts 5 windows).
	it('keeps the window a chord over the pickup bar opens, from bar 1', async () => {
		const { WHEN_THE_SAINTS } = await import('../../fixtures/tunes/when-the-saints');
		expect(previewSessionPlan(WHEN_THE_SAINTS, true).total).toBe(5);
		expect(previewSessionPlan(WHEN_THE_SAINTS, true, 12).total).toBe(60);
		initTunePractice(WHEN_THE_SAINTS);
		tunePractice.config.playHead = true;
		const plan = startTunePracticeSession(WHEN_THE_SAINTS, 480);
		// The head's band enters on bar 1 too, after the counted pickup.
		expect(plan.countInPickup).toBe(true);
		expect(plan.playedPhrase.harmony[0].startOffset).toEqual([1, 1]);
	});
});
