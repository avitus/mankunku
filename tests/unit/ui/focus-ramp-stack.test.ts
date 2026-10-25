/**
 * The focus ramp on the key stack (Andy, 2026-10-24): the takes still to
 * come are drawn under the current take, each tagged with its tempo, and the
 * takes join on the downbeat. Two rows of one key are on screen at once
 * there, so a take's score must stay on its OWN row as it scrolls out — the
 * key-only rule would hand it to the next take of the same key.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import UpcomingKeysDisplay from '$lib/components/lick-practice/UpcomingKeysDisplay.svelte';
import { precedingCycleRow } from '$lib/ui/key-stack-layout';
import type { PlannedKey } from '$lib/state/lick-practice.svelte';
import type { PitchClass } from '$lib/types/music';
import { INSTRUMENTS } from '$lib/types/instruments';

function row(key: PitchClass, keyIndex: number, extra: Partial<PlannedKey> = {}): PlannedKey {
	return {
		key, keyIndex, lickIndex: 0, lickId: 'test', lickName: 'Test', reveal: false, passes: 1, harmony: [],
		phrase: {
			id: 'test', name: 'Test', key, timeSignature: [4, 4],
			notes: [{ pitch: 62, duration: [1, 4], offset: [0, 1] }], harmony: [],
			difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
			category: 'short-ii-V-I-major', tags: [], source: 'curated'
		},
		...extra
	};
}

const base = {
	deep: true, currentBeat: 0, isPlaying: true, isRecording: true, scrollFraction: 0,
	instrument: INSTRUMENTS['tenor-sax'],
	cue: { phase: 'play' as const, next: null, beatsUntilNext: null, countdown: 0 }
};

/** Each rendered row's markup, from its class list to the next row, in order. */
function rows(body: string): string[] {
	return body.split('<div class="row ').slice(1);
}

/** Does this row's class list mark it current? */
const isCurrent = (markup: string): boolean => /^[^"]*\bcurrent\b/.test(markup);

describe('focus ramp on the key stack', () => {
	it('draws the takes to come under the current take, each with its tempo', () => {
		const { body } = render(UpcomingKeysDisplay, { props: {
			...base,
			plannedKeys: [row('D', 0, { tempo: 51, cycle: 1 })],
			projectedRows: [52, 53, 54, 55, 56].map((tempo, i) => row('D', 1 + i, { tempo, cycle: 2 + i }))
		} });
		const drawn = rows(body);
		expect(drawn).toHaveLength(6);
		expect(drawn.map((r) => r.match(/data-testid="row-tempo">(\d+) BPM/)?.[1])).toEqual(
			['51', '52', '53', '54', '55', '56']
		);
		expect(drawn.map(isCurrent)).toEqual([true, false, false, false, false, false]);
	});

	it('holds the current take through the cycle end instead of scrolling into a projected row', () => {
		const { body } = render(UpcomingKeysDisplay, { props: {
			...base, scrollFraction: 1,
			plannedKeys: [row('D', 0, { tempo: 51 })],
			projectedRows: [row('D', 1, { tempo: 52 })]
		} });
		expect(rows(body).map(isCurrent)).toEqual([true, false]);
	});

	it("keeps a finished take's score on its own row as it scrolls out above the next take of the key", () => {
		const { body } = render(UpcomingKeysDisplay, { props: {
			...base,
			precedingKey: row('D', 0, { tempo: 51, cycle: 3 }),
			plannedKeys: [row('D', 0, { tempo: 52, cycle: 4 })],
			projectedRows: [row('D', 1, { tempo: 53, cycle: 5 })],
			scoreFlash: { key: 'D', score: 0.97, at: 1, cycle: 3 }
		} });
		const [finished, current, next] = rows(body);
		expect(finished).toContain('score-flash');
		expect(finished).toContain('97%');
		expect(isCurrent(current)).toBe(true);
		expect(current).not.toContain('score-flash');
		expect(next).not.toContain('score-flash');
	});

	it('a same-key retry that stays still still shows the score where it was played', () => {
		const { body } = render(UpcomingKeysDisplay, { props: {
			...base,
			plannedKeys: [row('D', 0, { cycle: 4 })],
			scoreFlash: { key: 'D', score: 0.8, at: 1, cycle: 3 }
		} });
		expect(rows(body)[0]).toContain('80%');
	});

	it('does not engrave a projected sheet take below the viewport', () => {
		const sheet = { reveal: true, passes: 3 };
		const { body } = render(UpcomingKeysDisplay, { props: {
			...base,
			plannedKeys: [row('D', 0, { ...sheet, tempo: 51 })],
			projectedRows: [52, 53, 54, 55].map((tempo, i) => row('D', 1 + i, { ...sheet, tempo }))
		} });
		const drawn = rows(body);
		expect(drawn).toHaveLength(5);
		// The current take and the two under it are on screen; the rest are not.
		expect(drawn.map((r) => r.includes('data-testid="lead-sheet-row"'))).toEqual(
			[true, true, true, false, false]
		);
		// Still a sheet row's height, so the stack's geometry is unchanged.
		expect(drawn.every((r) => r.includes('height: 204.8px'))).toBe(true);
	});

	it('scrolls a focus take in even when it repeats the key just played', () => {
		const d = { lickId: 'test', key: 'D' };
		expect(precedingCycleRow([d], [d], true)).toBe(d);
		expect(precedingCycleRow([d], [d])).toBeNull();
	});
});
