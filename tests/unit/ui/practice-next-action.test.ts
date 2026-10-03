import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import UpcomingKeysDisplay from '$lib/components/lick-practice/UpcomingKeysDisplay.svelte';
import type { PlannedKey } from '$lib/state/lick-practice.svelte';
import type { PitchClass } from '$lib/types/music';
import { INSTRUMENTS } from '$lib/types/instruments';

function row(key: PitchClass, keyIndex: number, passes = 1): PlannedKey {
	return {
		key, keyIndex, lickIndex: 0, lickId: 'test', lickName: 'Test', reveal: false, passes, harmony: [],
		phrase: {
			id: 'test', name: 'Test', key, timeSignature: [4, 4], notes: [], harmony: [],
			difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 2 },
			category: 'short-ii-V-I-major', tags: [], source: 'curated'
		}
	};
}

const base = {
	currentBeat: 0, isPlaying: true, isRecording: true, scrollFraction: 0,
	instrument: INSTRUMENTS['tenor-sax'],
	cue: { phase: 'play' as const, next: null, beatsUntilNext: null, countdown: 0 }
};

describe('chart next-action contract', () => {
	it('names another pass in written pitch even with a different chart underneath', () => {
		const { body } = render(UpcomingKeysDisplay, { props: {
			...base, plannedKeys: [row('G', 0, 3), row('C', 1)]
		} });
		expect(body).toContain('Play · 1/3 · A again next');
		expect(body).not.toContain('D next');
		expect(body).toContain('role="status"');
	});
	it('names the lower chart only on the final pass', () => {
		const { body } = render(UpcomingKeysDisplay, { props: {
			...base, scrollFraction: 0.8, plannedKeys: [row('G', 0, 3), row('C', 1)]
		} });
		expect(body).toContain('Play · 3/3 · D next');
	});
	it('explains a memory graduation before opening the microphone', () => {
		const { body } = render(UpcomingKeysDisplay, { props: {
			...base, isRecording: false,
			plannedKeys: [{ ...row('G', 0), cycleEntry: { repeat: true, fromMemory: true, prepareBars: 1 } }],
			nextCycleKey: row('C', 1),
			cue: { phase: 'read', next: 'play', beatsUntilNext: 4, countdown: 4 }
		} });
		expect(body).toContain('A once more · from memory · in');
		expect(body).toContain('data-kind="play-in"');
		expect(body).not.toContain('chart-wrap recording');
	});
	it('keeps the promised chart inactive while explaining the current-key repeat', () => {
		const { body } = render(UpcomingKeysDisplay, { props: {
			...base, plannedKeys: [row('G', 0)], nextCycleKey: row('C', 1)
		} });
		expect(body).toContain('A once more · D next');
		expect(body).toMatch(/class="row [^"]*current" data-key="G"/);
		expect(body).not.toMatch(/class="row [^"]*current" data-key="C"/);
	});
	it('keeps an armed capture visually closed until the audible entrance', () => {
		const { body } = render(UpcomingKeysDisplay, { props: {
			...base, plannedKeys: [row('G', 0)], isRecording: true, isArming: true,
			cue: { phase: 'read', next: 'play', beatsUntilNext: 1, countdown: 1 }
		} });
		expect(body).toMatch(/class="chart-wrap [^"]*arming"/);
		expect(body).not.toMatch(/class="chart-wrap [^"]*recording"/);
	});
});
