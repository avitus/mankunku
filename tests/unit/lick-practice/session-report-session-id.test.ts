/**
 * Verifies that the per-key recording's IndexedDB sessionId survives the
 * archive → getSessionReport pipeline so the /progress page can drill from
 * a key chip back into the recording's stored note-by-note breakdown.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
	lickPractice,
	startInterLickTransition,
	getSessionReport
} from '$lib/state/lick-practice.svelte';
import type {
	LickPracticePlanItem,
	LickPracticeKeyResult
} from '$lib/types/lick-practice';
import type { PitchClass } from '$lib/types/music';

// Minimal localStorage mock so saveLickPracticeProgress doesn't warn.
const store: Record<string, string> = {};
Object.defineProperty(globalThis, 'localStorage', {
	value: {
		getItem: (k: string) => store[k] ?? null,
		setItem: (k: string, v: string) => {
			store[k] = v;
		},
		removeItem: (k: string) => {
			delete store[k];
		},
		clear: () => {
			for (const k of Object.keys(store)) delete store[k];
		},
		get length() {
			return Object.keys(store).length;
		},
		key: (i: number) => Object.keys(store)[i] ?? null
	},
	writable: true
});

const LICK_ID = 'test-lick-session-id';

function makeResult(
	key: PitchClass,
	score: number,
	tempo: number,
	sessionId?: string
): LickPracticeKeyResult {
	return {
		key,
		passed: score >= 0.8,
		score,
		pitchAccuracy: score,
		rhythmAccuracy: score,
		attempts: 1,
		tempo,
		sessionId
	};
}

beforeEach(() => {
	for (const k of Object.keys(store)) delete store[k];
});

describe('getSessionReport — sessionId round-trip', () => {
	it('preserves sessionId from each key result through to the report', () => {
		const plan: LickPracticePlanItem[] = [
			{
				phraseId: LICK_ID,
				phraseName: LICK_ID,
				phraseNumber: 1,
				category: 'ii-V-I-major',
				keys: ['C', 'F']
			}
		];
		lickPractice.plan = plan;
		lickPractice.currentLickIndex = 0;
		lickPractice.currentKeyIndex = 0;
		lickPractice.currentTempo = 100;
		lickPractice.keyResults = [
			makeResult('C', 0.9, 100, 'rec-c-1'),
			makeResult('F', 0.7, 100, 'rec-f-1')
		];
		lickPractice.allAttempts = [];
		lickPractice.progress = {};
		lickPractice.elapsedSeconds = 0;

		startInterLickTransition();
		const report = getSessionReport();

		expect(report.licks).toHaveLength(1);
		const keys = report.licks[0].keys;
		expect(keys).toHaveLength(2);
		expect(keys[0].sessionId).toBe('rec-c-1');
		expect(keys[1].sessionId).toBe('rec-f-1');
	});

	it('leaves sessionId undefined when none was recorded', () => {
		// Legacy / fallback path: a key result archived without a sessionId
		// (e.g., from a build where the recorder failed) should still produce
		// a valid report — sessionId just stays undefined for that entry.
		const plan: LickPracticePlanItem[] = [
			{
				phraseId: LICK_ID,
				phraseName: LICK_ID,
				phraseNumber: 1,
				category: 'ii-V-I-major',
				keys: ['C']
			}
		];
		lickPractice.plan = plan;
		lickPractice.currentLickIndex = 0;
		lickPractice.currentKeyIndex = 0;
		lickPractice.currentTempo = 100;
		lickPractice.keyResults = [makeResult('C', 0.9, 100)];
		lickPractice.allAttempts = [];
		lickPractice.progress = {};
		lickPractice.elapsedSeconds = 0;

		startInterLickTransition();
		const report = getSessionReport();

		expect(report.licks[0].keys[0].sessionId).toBeUndefined();
	});
});
