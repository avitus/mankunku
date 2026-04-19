import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock note-segmenter
vi.mock('$lib/audio/note-segmenter.ts', () => ({
	validateOnsets: vi.fn(() => []),
	segmentNotes: vi.fn(() => []),
}));

// Mock bleed-filter
vi.mock('$lib/audio/bleed-filter.ts', () => ({
	filterBleed: vi.fn(() => ({ kept: [], filtered: [] })),
}));

// Mock scorer
vi.mock('$lib/scoring/scorer.ts', () => ({
	scoreAttempt: vi.fn(() => ({
		overall: 0.85,
		pitchAccuracy: 0.90,
		rhythmAccuracy: 0.78,
		grade: 'great' as const,
		noteResults: [],
		notesHit: 1,
		notesTotal: 1,
		timing: {
			meanOffsetMs: 0,
			medianOffsetMs: 0,
			stdDevMs: 0,
			latencyCorrectionMs: 0,
			perNoteOffsetMs: [],
		},
	})),
}));

import {
	extractOnsetsFromReadings,
	resolveOnsets,
	runScorePipeline,
} from '$lib/scoring/score-pipeline';
import type { ScorePipelineInputs } from '$lib/scoring/score-pipeline';
import { validateOnsets, segmentNotes } from '$lib/audio/note-segmenter';
import { filterBleed } from '$lib/audio/bleed-filter';
import { scoreAttempt } from '$lib/scoring/scorer';
import type { PitchReading } from '$lib/audio/pitch-detector';
import type { DetectedNote } from '$lib/types/audio';
import type { Phrase } from '$lib/types/music';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReading(midi: number, time: number, clarity = 0.95): PitchReading {
	return { midi, midiFloat: midi, cents: 0, clarity, time, frequency: 440 };
}

const minimalPhrase: Phrase = {
	id: 'test',
	name: 'Test',
	category: 'blues' as const,
	notes: [{ pitch: 60, offset: [0, 1] as [number, number], duration: [1, 4] as [number, number] }],
	key: 'C',
	harmony: [],
	difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
	source: 'curated' as const,
	tags: [],
	timeSignature: [4, 4] as [number, number],
};

function makePipelineInputs(overrides: Partial<ScorePipelineInputs> = {}): ScorePipelineInputs {
	return {
		readings: [],
		workletOnsets: [],
		phrase: minimalPhrase,
		phraseDuration: 2,
		tempo: 120,
		transportSeconds: 0,
		swing: 0.5,
		schedule: null,
		bleedFilterEnabled: false,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// extractOnsetsFromReadings
// ---------------------------------------------------------------------------

describe('extractOnsetsFromReadings', () => {
	it('returns empty array for empty readings', () => {
		expect(extractOnsetsFromReadings([])).toEqual([]);
	});

	it('returns [readings[0].time] for a single reading', () => {
		const readings = [makeReading(60, 0.5)];
		expect(extractOnsetsFromReadings(readings)).toEqual([0.5]);
	});

	it('detects onset from time gap > 0.1s', () => {
		// Two readings 0.15s apart — gap exceeds 0.1s threshold
		const readings = [makeReading(60, 1.0), makeReading(60, 1.15)];
		const onsets = extractOnsetsFromReadings(readings);
		expect(onsets).toHaveLength(2);
		expect(onsets[0]).toBe(1.0);
		// Gap-based onset gets ATTACK_LATENCY (0.05) subtracted
		expect(onsets[1]).toBeCloseTo(1.15 - 0.05);
	});

	it('applies ATTACK_LATENCY offset (-0.05) on gap-based onsets', () => {
		const readings = [makeReading(60, 0.0), makeReading(60, 0.2)];
		const onsets = extractOnsetsFromReadings(readings);
		expect(onsets[1]).toBeCloseTo(0.2 - 0.05);
	});

	it('detects onset from MIDI note change without latency offset', () => {
		// Same time proximity (gap < 0.1s), different MIDI note
		const readings = [makeReading(60, 0.0), makeReading(64, 0.09)];
		const onsets = extractOnsetsFromReadings(readings);
		expect(onsets).toHaveLength(2);
		// Note-change onset uses raw reading time — no ATTACK_LATENCY
		expect(onsets[1]).toBe(0.09);
	});

	it('suppresses onsets within MIN_ONSET_INTERVAL (0.08s) of previous onset', () => {
		// Three readings: the third is only 0.06s after the second onset
		const readings = [
			makeReading(60, 0.0),
			makeReading(64, 0.09), // note change → onset at 0.09
			makeReading(67, 0.14), // note change but only 0.05s later → suppressed
		];
		const onsets = extractOnsetsFromReadings(readings);
		expect(onsets).toHaveLength(2);
		expect(onsets[0]).toBe(0.0);
		expect(onsets[1]).toBe(0.09);
	});

	it('handles multiple gaps and note changes in sequence', () => {
		const readings = [
			makeReading(60, 0.0),   // onset 0: first reading
			makeReading(60, 0.05),  // too close, same note — skipped
			makeReading(64, 0.10),  // note change, 0.10 - 0.0 = 0.10 >= 0.08 → onset
			makeReading(64, 0.30),  // gap = 0.20 > 0.1 → gap onset at 0.30 - 0.05 = 0.25
			makeReading(67, 0.50),  // gap = 0.20 > 0.1 AND note change → gap wins (checked first), onset at 0.45
		];
		const onsets = extractOnsetsFromReadings(readings);
		expect(onsets).toHaveLength(4);
		expect(onsets[0]).toBe(0.0);
		expect(onsets[1]).toBe(0.10);
		expect(onsets[2]).toBeCloseTo(0.25);
		expect(onsets[3]).toBeCloseTo(0.45);
	});
});

// ---------------------------------------------------------------------------
// resolveOnsets
// ---------------------------------------------------------------------------

describe('resolveOnsets', () => {
	beforeEach(() => {
		vi.mocked(validateOnsets).mockReset().mockReturnValue([]);
	});

	it('returns empty when both workletOnsets and readings are empty', () => {
		expect(resolveOnsets([], [])).toEqual([]);
	});

	it('uses validated worklet onsets when validateOnsets returns non-empty', () => {
		vi.mocked(validateOnsets).mockReturnValue([0.1, 0.5]);
		const readings = [makeReading(60, 0.1), makeReading(64, 0.5)];
		const result = resolveOnsets([0.1, 0.5], readings);
		expect(validateOnsets).toHaveBeenCalledWith([0.1, 0.5], readings);
		expect(result).toContain(0.1);
		expect(result).toContain(0.5);
	});

	it('falls back to reading-based onsets when validateOnsets returns empty', () => {
		vi.mocked(validateOnsets).mockReturnValue([]);
		// Two readings with a gap > 0.1s → extractOnsetsFromReadings produces 2 onsets
		const readings = [makeReading(60, 0.0), makeReading(64, 0.20)];
		const result = resolveOnsets([1.0, 2.0], readings);
		expect(validateOnsets).toHaveBeenCalled();
		// Should contain first reading time and the note-change onset
		expect(result).toContain(0.0);
		expect(result.length).toBeGreaterThanOrEqual(2);
	});

	it('prepends synthesized onset when reading exists before first onset within 0.5s window', () => {
		// Validated onsets start at 0.3, but there's a reading at 0.1 (within 0.5s backward)
		vi.mocked(validateOnsets).mockReturnValue([0.3, 0.8]);
		const readings = [
			makeReading(60, 0.1),
			makeReading(60, 0.3),
			makeReading(64, 0.8),
		];
		const result = resolveOnsets([0.3, 0.8], readings);
		// Should prepend 0.1 since 0.3 - 0.1 = 0.2 > PREPEND_MIN_GAP (0.05)
		expect(result[0]).toBe(0.1);
		expect(result[1]).toBe(0.3);
		expect(result).toHaveLength(3);
	});

	it('does NOT prepend when gap between anchor and first onset < PREPEND_MIN_GAP (0.05s)', () => {
		vi.mocked(validateOnsets).mockReturnValue([0.3]);
		const readings = [
			makeReading(60, 0.28), // 0.3 - 0.28 = 0.02 < 0.05
			makeReading(60, 0.3),
		];
		const result = resolveOnsets([0.3], readings);
		expect(result[0]).toBe(0.3);
		expect(result).toHaveLength(1);
	});

	it('does NOT prepend when no reading falls within backward window', () => {
		vi.mocked(validateOnsets).mockReturnValue([1.0]);
		// Reading at 0.1 is 0.9s before first onset — exceeds 0.5s window
		const readings = [
			makeReading(60, 0.1),
			makeReading(60, 1.0),
		];
		const result = resolveOnsets([1.0], readings);
		// The loop breaks when r.time >= firstOnset, and r.time=0.1 is within
		// the backward window check: 1.0 - 0.1 = 0.9 > 0.5 so anchor stays -1
		expect(result[0]).toBe(1.0);
		expect(result).toHaveLength(1);
	});

	it('does not mutate input arrays', () => {
		vi.mocked(validateOnsets).mockReturnValue([0.5]);
		const workletOnsets = [0.5];
		const readings = [makeReading(60, 0.2), makeReading(60, 0.5)];
		const workletCopy = [...workletOnsets];
		const readingsCopy = [...readings];
		resolveOnsets(workletOnsets, readings);
		expect(workletOnsets).toEqual(workletCopy);
		expect(readings).toEqual(readingsCopy);
	});
});

// ---------------------------------------------------------------------------
// runScorePipeline
// ---------------------------------------------------------------------------

describe('runScorePipeline', () => {
	const mockDetected: DetectedNote[] = [
		{ midi: 60, cents: 0, onsetTime: 0, duration: 0.5, clarity: 0.95 },
	];

	const mockScore = {
		overall: 0.85,
		pitchAccuracy: 0.90,
		rhythmAccuracy: 0.78,
		grade: 'great' as const,
		noteResults: [],
		notesHit: 1,
		notesTotal: 1,
		timing: {
			meanOffsetMs: 0,
			medianOffsetMs: 0,
			stdDevMs: 0,
			latencyCorrectionMs: 0,
			perNoteOffsetMs: [],
		},
	};

	const mockFilteredScore = {
		...mockScore,
		overall: 0.92,
		pitchAccuracy: 0.95,
	};

	beforeEach(() => {
		vi.mocked(validateOnsets).mockReset().mockReturnValue([]);
		vi.mocked(segmentNotes).mockReset().mockReturnValue(mockDetected);
		vi.mocked(scoreAttempt).mockReset().mockReturnValue(mockScore);
		vi.mocked(filterBleed).mockReset().mockReturnValue({
			kept: mockDetected,
			filtered: [],
		});
	});

	it('calls resolveOnsets, segmentNotes, and scoreAttempt', () => {
		const readings = [makeReading(60, 0.0)];
		const inputs = makePipelineInputs({ readings, workletOnsets: [0.0] });

		runScorePipeline(inputs);

		expect(validateOnsets).toHaveBeenCalled();
		expect(segmentNotes).toHaveBeenCalled();
		expect(scoreAttempt).toHaveBeenCalled();
	});

	it('sets filteredScore to null when no schedule provided', () => {
		const inputs = makePipelineInputs({ schedule: null });
		const result = runScorePipeline(inputs);
		expect(result.filteredScore).toBeNull();
	});

	it('sets bleedLog to null when no schedule provided', () => {
		const inputs = makePipelineInputs({ schedule: null });
		const result = runScorePipeline(inputs);
		expect(result.bleedLog).toBeNull();
	});

	it('calls filterBleed when schedule is provided', () => {
		const schedule = { notes: [], activeMidiAt: () => [] };
		const inputs = makePipelineInputs({ schedule });
		runScorePipeline(inputs);
		expect(filterBleed).toHaveBeenCalled();
	});

	it('chosen equals unfilteredScore when bleedFilterEnabled is false', () => {
		const schedule = { notes: [], activeMidiAt: () => [] };
		vi.mocked(scoreAttempt)
			.mockReturnValueOnce(mockScore)         // unfiltered
			.mockReturnValueOnce(mockFilteredScore); // filtered
		const inputs = makePipelineInputs({
			schedule,
			bleedFilterEnabled: false,
		});
		const result = runScorePipeline(inputs);
		expect(result.chosen).toBe(result.unfilteredScore);
		expect(result.useFiltered).toBe(false);
	});

	it('chosen equals filteredScore when bleedFilterEnabled is true and schedule provided', () => {
		const schedule = { notes: [], activeMidiAt: () => [] };
		vi.mocked(scoreAttempt)
			.mockReturnValueOnce(mockScore)         // unfiltered
			.mockReturnValueOnce(mockFilteredScore); // filtered
		const inputs = makePipelineInputs({
			schedule,
			bleedFilterEnabled: true,
		});
		const result = runScorePipeline(inputs);
		expect(result.chosen).toBe(result.filteredScore);
		expect(result.useFiltered).toBe(true);
	});

	it('chosen falls back to unfilteredScore when bleedFilterEnabled is true but no schedule', () => {
		const inputs = makePipelineInputs({
			schedule: null,
			bleedFilterEnabled: true,
		});
		const result = runScorePipeline(inputs);
		// No schedule → filteredScore is null → falls back to unfiltered
		expect(result.chosen).toBe(result.unfilteredScore);
		expect(result.useFiltered).toBe(false);
	});

	it('useFiltered is true only when bleedFilterEnabled and filteredScore exists', () => {
		const schedule = { notes: [], activeMidiAt: () => [] };
		vi.mocked(scoreAttempt)
			.mockReturnValueOnce(mockScore)
			.mockReturnValueOnce(mockFilteredScore);

		// Case 1: both conditions met
		const result1 = runScorePipeline(
			makePipelineInputs({ schedule, bleedFilterEnabled: true })
		);
		expect(result1.useFiltered).toBe(true);

		// Case 2: bleedFilterEnabled but no schedule
		const result2 = runScorePipeline(
			makePipelineInputs({ schedule: null, bleedFilterEnabled: true })
		);
		expect(result2.useFiltered).toBe(false);

		// Case 3: schedule provided but bleedFilterEnabled false
		vi.mocked(scoreAttempt)
			.mockReturnValueOnce(mockScore)
			.mockReturnValueOnce(mockFilteredScore);
		const result3 = runScorePipeline(
			makePipelineInputs({ schedule, bleedFilterEnabled: false })
		);
		expect(result3.useFiltered).toBe(false);
	});

	it('detected array comes from segmentNotes output', () => {
		const customDetected: DetectedNote[] = [
			{ midi: 62, cents: 5, onsetTime: 0.1, duration: 0.4, clarity: 0.88 },
			{ midi: 65, cents: -3, onsetTime: 0.5, duration: 0.3, clarity: 0.91 },
		];
		vi.mocked(segmentNotes).mockReturnValue(customDetected);

		const inputs = makePipelineInputs();
		const result = runScorePipeline(inputs);
		expect(result.detected).toBe(customDetected);
	});

	it('defaults octaveInsensitive to false when omitted (passed to scoreAttempt as 6th arg)', () => {
		const inputs = makePipelineInputs();
		runScorePipeline(inputs);
		// scoreAttempt(phrase, detected, tempo, transportSeconds, swing, octaveInsensitive)
		expect(vi.mocked(scoreAttempt)).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			expect.anything(),
			expect.anything(),
			expect.anything(),
			false
		);
	});

	it('forwards octaveInsensitive=true to scoreAttempt on the unfiltered path', () => {
		const inputs = makePipelineInputs({ octaveInsensitive: true });
		runScorePipeline(inputs);
		expect(vi.mocked(scoreAttempt)).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			expect.anything(),
			expect.anything(),
			expect.anything(),
			true
		);
	});

	it('forwards octaveInsensitive=true to both scoreAttempt calls when schedule is present', () => {
		const schedule = { notes: [], activeMidiAt: () => [] };
		vi.mocked(scoreAttempt)
			.mockReturnValueOnce(mockScore)
			.mockReturnValueOnce(mockFilteredScore);
		const inputs = makePipelineInputs({ schedule, octaveInsensitive: true });
		runScorePipeline(inputs);
		const calls = vi.mocked(scoreAttempt).mock.calls;
		expect(calls.length).toBe(2);
		expect(calls[0][5]).toBe(true); // unfiltered scoreAttempt
		expect(calls[1][5]).toBe(true); // filtered scoreAttempt
	});
});
