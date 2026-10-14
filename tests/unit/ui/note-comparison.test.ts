import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import NoteComparison from '$lib/components/practice/NoteComparison.svelte';
import type { NoteResult, TimingDiagnostics } from '$lib/types/scoring';

function note(rhythmScore = 1, index = 0): NoteResult {
	return {
		expected: { pitch: 60, offset: [index, 4], duration: [1, 4] },
		detected: { midi: 60, cents: 0, onsetTime: 0, duration: 0.5, clarity: 1 },
		pitchScore: 1, rhythmScore, missed: false, extra: false
	};
}
const timing: TimingDiagnostics = {
	meanOffsetMs: 12, medianOffsetMs: 0, stdDevMs: 30,
	latencyCorrectionMs: 250, perNoteOffsetMs: [0, 12, -12, 48]
};

describe('musician-facing note comparison', () => {
	it('replaces numeric timing diagnostics with independent musical feedback', () => {
		const noteResults = Array.from({ length: 4 }, (_, i) => note(.4, i));
		const { body } = render(NoteComparison, { props: { noteResults, timing, tempo: 120 } });
		expect(body).toContain('Steady pulse.');
		for (const label of ['Offset', 'Bias:', 'Spread:', 'Latency correction:', 'You’ve got the rhythm.']) {
			expect(body).not.toContain(label);
		}
	});

	it('can report rushing even when the recorded rhythm percentage is high', () => {
		const noteResults = Array.from({ length: 4 }, (_, i) => note(1, i));
		const drift = { ...timing, perNoteOffsetMs: [150, 50, -50, -150] };
		const { body } = render(NoteComparison, { props: { noteResults, timing: drift, tempo: 120 } });
		expect(body).toContain('Rushing. Leave more space between the notes.');
		expect(body).toContain('100%');
	});

	it('leaves out musical verdicts when the take lacks reliable timing evidence', () => {
		for (const props of [
			{ noteResults: Array.from({ length: 4 }, (_, i) => note(1, i)), tempo: 120 },
			{ noteResults: [note(), ...Array.from({ length: 5 }, () => ({ ...note(0), missed: true, detected: null }))], timing, tempo: 120 }
		]) {
			const { body } = render(NoteComparison, { props });
			expect(body).not.toContain('data-testid="musical-timing-feedback"');
		}
	});
});

it('keeps technical values aligned with their notes when extras occur between them', () => {
	const noteResults = [note(), { ...note(0), extra: true }, note(), { ...note(0), missed: true, detected: null }, note()];
	const savedTiming = { ...timing, perNoteOffsetMs: [10, null, 22, null, -32] };
	const { body } = render(NoteComparison, { props: { noteResults, timing: savedTiming, diagnostic: true } });
	const text = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
	expect(text).toContain('2 C4 C4 100% 100% +22ms');
	expect(text).toContain('3 C4 -- 0% 0% --');
	expect(text).toContain('4 C4 C4 100% 100% -32ms');
	expect(text).toContain('Bias: +12ms');
	expect(text).toContain('Spread: 30ms');
	expect(text).toContain('Latency correction: +250ms');
	expect(text).not.toContain('Sing the line');
	expect(savedTiming.perNoteOffsetMs).toEqual([10, null, 22, null, -32]);
});
