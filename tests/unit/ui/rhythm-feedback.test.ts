import { describe, expect, it } from 'vitest';
import { rhythmFeedback } from '$lib/ui/rhythm-feedback';
import type { NoteResult, TimingDiagnostics } from '$lib/types/scoring';

/** Same matched line with independent timing evidence and arbitrary grades. */
function take(offsets: Array<number | null>, tempo: number = 120): { noteResults: NoteResult[]; timing: TimingDiagnostics; tempo: number } {
	const noteResults: NoteResult[] = offsets.map((offset, i) => ({
		expected: { pitch: 60 + i, offset: [i, 4], duration: [1, 4] },
		detected: offset === null ? null : { midi: 60 + i, cents: 0, onsetTime: i * 60 / tempo + offset / 1000, duration: .3, clarity: .95 },
		pitchScore: .3, rhythmScore: .4, missed: offset === null, extra: false
	}));
	const timing: TimingDiagnostics = { meanOffsetMs: 0, medianOffsetMs: 0, stdDevMs: 0, latencyCorrectionMs: 250, perNoteOffsetMs: offsets };
	return { noteResults, timing, tempo };
}

function feedback(t: ReturnType<typeof take>): string | null {
	return rhythmFeedback(t.noteResults, t.timing, t.tempo);
}

describe('musical timing feedback independent of grading', () => {
	it('uses distinct-onset pairs when reliable notes share an onset', () => {
		const t = take([100, 50, 50, 0, -50]);
		for (const [i, beat] of [0, 1, 1, 2, 3].entries()) {
			t.noteResults[i].expected.offset = [beat, 4];
			t.noteResults[i].detected!.onsetTime = beat * .5 + t.timing.perNoteOffsetMs[i]! / 1000;
		}
		expect(feedback(t)).toMatch(/^Rushing\./);
		for (const note of t.noteResults) note.expected.offset = [0, 1];
		expect(feedback(t)).toBeNull();
	});
	it.each([
		[[100, 60, 20, -20, -60, -100], 'Rushing.'],
		[[-100, -60, -20, 20, 60, 100], 'Dragging.'],
		[[0, 5, -5, 0, 5, -5], 'Steady pulse.'],
		[[-100, 100, -100, 100, -100, 100], 'Uneven time.']
	] as const)('describes the timing pattern %j', (offsets, label) => {
		expect(feedback(take([...offsets]))).toMatch(new RegExp(`^${label}`));
	});

	it('ignores grade values and constant device delay, without mutating saved data', () => {
		const t = take([100, 60, 20, -20, -60, -100]);
		const before = structuredClone(t);
		const first = feedback(t);
		expect(t).toEqual(before);
		for (const result of t.noteResults) { result.rhythmScore = 1; result.pitchScore = 1; }
		t.timing.latencyCorrectionMs = 950;
		t.timing.meanOffsetMs = 300;
		t.timing.perNoteOffsetMs = t.timing.perNoteOffsetMs.map((v) => v! + 300);
		expect(feedback(t)).toBe(first);
	});

	it('does not label a constant shift as laying back, pushing, dragging or rushing', () => {
		for (const offset of [-300, -30, 0, 30, 300]) {
			expect(feedback(take(Array(6).fill(offset)))).toBe('Steady pulse.');
		}
	});

	it('does not turn one late attack into a claim that the whole line is dragging', () => {
		expect(feedback(take([0, 0, 0, 0, 0, 250]))).toMatch(/^Uneven time\./);
	});

	it('keeps the same interpretation for the same beat-relative change at different tempos', () => {
		for (const tempo of [60, 120, 180]) {
			expect(feedback(take([.2, .12, .04, -.04, -.12, -.2].map((beats) => beats * 60000 / tempo), tempo))).toMatch(/^Rushing\./);
		}
	});

	it('withholds feedback for missing, sparse, short or invalid timing evidence', () => {
		const t = take([0, 5, -5, 0]);
		expect(rhythmFeedback(t.noteResults, undefined, 120)).toBeNull();
		expect(rhythmFeedback(t.noteResults, t.timing, undefined)).toBeNull();
		expect(feedback(take([0, 0, 0]))).toBeNull();
		expect(feedback(take([0, null, null, 0, null, 0]))).toBeNull();
		expect(feedback(take([0, 0, 0, 0], 0))).toBeNull();
		t.timing.perNoteOffsetMs = [NaN, Infinity, null, 0];
		expect(feedback(t)).toBeNull();
	});

	it('preserves timing indices through extra notes and ignores unreliable matches', () => {
		const t = take([100, 60, 20, -20, -60, -100]);
		const extra = { ...t.noteResults[0], extra: true };
		t.noteResults.splice(1, 0, extra);
		t.timing.perNoteOffsetMs.splice(1, 0, null);
		expect(feedback(t)).toMatch(/^Rushing\./);
		for (const note of t.noteResults) if (note.detected) note.detected.clarity = .2;
		expect(feedback(t)).toBeNull();
	});
});
