import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Phrase } from '$lib/types/music';
import type { Tune } from '$lib/types/tune';
import { saveUserLick } from '$lib/persistence/user-licks';
import { saveLickPracticeProgress } from '$lib/persistence/lick-practice-store';
import {
	initTunePractice,
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
		// Known in E: Points mode admits the whole catalog, and a lick the
		// player HAS in the key outranks a longer one they have never touched.
		saveLickPracticeProgress({
			'e2e-minor-lick': { E: { passCount: 1, currentTempo: 240, lastPracticedAt: 1 } }
		});
		initTunePractice(autumnLeaves);
		tunePractice.config.mode = 'points';
		tunePractice.config.playHead = true;
	});

	it('plans Minor windows on the 2-bar E- stretches of the solo chorus, named with the key', () => {
		startTunePracticeSession(autumnLeaves, 480);
		const minors = tunePractice.plan.filter((ip) => ip.progressionType === 'minor-vamp');
		expect(minors.map((ip) => fractionToFloat(ip.startOffset))).toEqual([7, 15, 19, 31]);
		expect(minors.every((ip) => ip.suggestions[0]?.lickId === 'e2e-minor-lick')).toBe(true);
		expect(minors.map((ip) => ip.keyCenter)).toEqual(['E', 'E', 'E', 'E']);
		// Written for the default tenor: concert E- reads F#m.
		expect(suggestionNameFor(minors[0])).toBe('E2E Minor Lick · F#m');
		// The long cadences carry catalog cadence licks (Points admits new
		// material), capped at the pick card's five — never the minor lick.
		const longs = tunePractice.plan.filter((ip) => ip.progressionType !== 'minor-vamp');
		expect(longs.length).toBeGreaterThan(0);
		for (const ip of longs) {
			expect(ip.suggestions.length).toBeLessThanOrEqual(5);
			expect(ip.suggestions.some((s) => s.lickId === 'e2e-minor-lick')).toBe(false);
		}
	});
});
