import { describe, it, expect } from 'vitest';
import { recordingBeatAt } from '$lib/audio/recording-cue';
import { RECORD_COUNT_IN_BEATS } from '$lib/audio/record-transcription';

describe('recording entrance clock', () => {
	it('shows no beat before the transport actually starts', () => {
		expect(recordingBeatAt(0, 192, false)).toBe(-1);
	});
	it('includes both full count-in bars, entering only on the ninth downbeat', () => {
		for (let i = 0; i < RECORD_COUNT_IN_BEATS; i++) {
			expect(recordingBeatAt(i * 192, 192, true)).toBe(i);
			expect(recordingBeatAt((i + 1) * 192 - 0.01, 192, true)).toBe(i);
		}
		expect(recordingBeatAt(RECORD_COUNT_IN_BEATS * 192, 192, true)).toBe(8);
	});
});
