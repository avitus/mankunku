import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock scorer
vi.mock('$lib/scoring/scorer', () => ({
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
} from '$lib/audio/note-segmenter';
import {
	runScorePipeline,
} from '$lib/scoring/score-pipeline';
import type { ScorePipelineInputs } from '$lib/scoring/score-pipeline';
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
		detected: [],
		phrase: minimalPhrase,
		tempo: 120,
		transportSeconds: 0,
		swing: 0.5,
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
	function makeStableRun(midi: number, startTime: number, count: number, step = 0.017): PitchReading[] {
		return Array.from({ length: count }, (_, i) => makeReading(midi, startTime + i * step));
	}

	it('returns empty when both workletOnsets and readings are empty', () => {
		expect(resolveOnsets([], [])).toEqual([]);
	});

	it('uses validated worklet onsets when validateOnsets returns non-empty', () => {
		// Readings at the same times as worklet onsets → validateOnsets keeps them
		const readings = [makeReading(60, 0.1), makeReading(64, 0.5)];
		const result = resolveOnsets([0.1, 0.5], readings);
		expect(result).toContain(0.1);
		expect(result).toContain(0.5);
	});

	it('falls back to reading-based onsets when validateOnsets returns empty', () => {
		// Worklet onsets at 1.0 and 2.0 have no readings nearby → validation rejects all
		// Two readings with a gap > 0.1s → extractOnsetsFromReadings produces 2 onsets
		const readings = [makeReading(60, 0.0), makeReading(64, 0.20)];
		const result = resolveOnsets([1.0, 2.0], readings);
		// Should contain first reading time and the note-change onset
		expect(result).toContain(0.0);
		expect(result.length).toBeGreaterThanOrEqual(2);
	});

	it('prepends a stable-run start when ≥3 same-midi pre-onset readings exist', () => {
		// 3 stable C4 readings at 0.10–0.134, then worklet onset at 1.0.
		const readings = [
			...makeStableRun(60, 0.10, 3),
			makeReading(64, 1.0),
		];
		const result = resolveOnsets([1.0], readings);
		expect(result[0]).toBe(0.10);
		expect(result[1]).toBe(1.0);
	});

	it('prepends one onset per pitch transition for multiple pre-onset notes', () => {
		// 3 frames of C4 at 0.10–0.134, then 3 frames of D4 at 0.50–0.534, then worklet at 1.5.
		const readings = [
			...makeStableRun(60, 0.10, 3),
			...makeStableRun(62, 0.50, 3),
			makeReading(64, 1.5),
		];
		const result = resolveOnsets([1.5], readings);
		expect(result).toEqual([0.10, 0.50, 1.5]);
	});

	it('does NOT prepend when fewer than 3 stable pre-onset readings exist', () => {
		// 2 readings at midi 60 — below PITCH_CHANGE_MIN_HOLD threshold.
		const readings = [
			makeReading(60, 0.10),
			makeReading(60, 0.13),
			makeReading(64, 1.0),
		];
		const result = resolveOnsets([1.0], readings);
		expect(result).toEqual([1.0]);
	});

	it('skips warmup readings — a warmup-only pre-onset region produces no prepend', () => {
		// 5 high-clarity warmup readings (e.g. mic rumble or McLeod attack
		// subharmonic) shouldn't synthesize an onset.
		const readings = [
			{ ...makeReading(28, 0.10), warmup: true },
			{ ...makeReading(28, 0.13), warmup: true },
			{ ...makeReading(28, 0.16), warmup: true },
			{ ...makeReading(28, 0.19), warmup: true },
			{ ...makeReading(28, 0.22), warmup: true },
			makeReading(60, 1.5),
		];
		const result = resolveOnsets([1.5], readings);
		expect(result).toEqual([1.5]);
	});

	it('drops a trailing stable-run start within PREPEND_MIN_GAP of first worklet onset', () => {
		// User played one note before the worklet caught up; the stable run
		// and the worklet onset describe the same attack — only one onset.
		const readings = [
			...makeStableRun(60, 0.90, 4), // stable run starts at 0.90
			makeReading(60, 1.0),
		];
		const result = resolveOnsets([1.0], readings);
		// 1.0 - 0.90 = 0.10 < PREPEND_MIN_GAP (0.15) → drop the prepend.
		expect(result).toEqual([1.0]);
	});

	it('does not mutate input arrays', () => {
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
		vi.mocked(scoreAttempt).mockReset().mockReturnValue(mockScore);
	});

	it('calls scoreAttempt with the detected notes', () => {
		const inputs = makePipelineInputs({ detected: mockDetected });
		runScorePipeline(inputs);
		expect(scoreAttempt).toHaveBeenCalledWith(
			minimalPhrase,
			mockDetected,
			120,
			0,
			0.5,
			false
		);
	});

	it('sets filteredScore to null when no bleedResult provided', () => {
		const inputs = makePipelineInputs();
		const result = runScorePipeline(inputs);
		expect(result.filteredScore).toBeNull();
	});

	it('sets bleedLog to null when no bleedResult provided', () => {
		const inputs = makePipelineInputs();
		const result = runScorePipeline(inputs);
		expect(result.bleedLog).toBeNull();
	});

	it('computes filteredScore when bleedResult is provided', () => {
		vi.mocked(scoreAttempt)
			.mockReturnValueOnce(mockScore)         // unfiltered
			.mockReturnValueOnce(mockFilteredScore); // filtered
		const bleedResult = { kept: mockDetected, filtered: [] as DetectedNote[] };
		const inputs = makePipelineInputs({ detected: mockDetected, bleedResult });
		const result = runScorePipeline(inputs);
		expect(result.filteredScore).toBe(mockFilteredScore);
		expect(scoreAttempt).toHaveBeenCalledTimes(2);
	});

	it('chosen equals unfilteredScore when bleedFilterEnabled is false', () => {
		vi.mocked(scoreAttempt)
			.mockReturnValueOnce(mockScore)         // unfiltered
			.mockReturnValueOnce(mockFilteredScore); // filtered
		const bleedResult = { kept: mockDetected, filtered: [] as DetectedNote[] };
		const inputs = makePipelineInputs({
			detected: mockDetected,
			bleedResult,
			bleedFilterEnabled: false,
		});
		const result = runScorePipeline(inputs);
		expect(result.chosen).toBe(result.unfilteredScore);
		expect(result.useFiltered).toBe(false);
	});

	it('chosen equals filteredScore when bleedFilterEnabled is true and bleedResult provided', () => {
		vi.mocked(scoreAttempt)
			.mockReturnValueOnce(mockScore)         // unfiltered
			.mockReturnValueOnce(mockFilteredScore); // filtered
		const bleedResult = { kept: mockDetected, filtered: [] as DetectedNote[] };
		const inputs = makePipelineInputs({
			detected: mockDetected,
			bleedResult,
			bleedFilterEnabled: true,
		});
		const result = runScorePipeline(inputs);
		expect(result.chosen).toBe(result.filteredScore);
		expect(result.useFiltered).toBe(true);
	});

	it('chosen falls back to unfilteredScore when bleedFilterEnabled is true but no bleedResult', () => {
		const inputs = makePipelineInputs({
			bleedFilterEnabled: true,
		});
		const result = runScorePipeline(inputs);
		// No bleedResult → filteredScore is null → falls back to unfiltered
		expect(result.chosen).toBe(result.unfilteredScore);
		expect(result.useFiltered).toBe(false);
	});

	it('useFiltered is true only when bleedFilterEnabled and filteredScore exists', () => {
		const bleedResult = { kept: mockDetected, filtered: [] as DetectedNote[] };

		vi.mocked(scoreAttempt)
			.mockReturnValueOnce(mockScore)
			.mockReturnValueOnce(mockFilteredScore);

		// Case 1: both conditions met
		const result1 = runScorePipeline(
			makePipelineInputs({ detected: mockDetected, bleedResult, bleedFilterEnabled: true })
		);
		expect(result1.useFiltered).toBe(true);

		// Case 2: bleedFilterEnabled but no bleedResult
		const result2 = runScorePipeline(
			makePipelineInputs({ bleedFilterEnabled: true })
		);
		expect(result2.useFiltered).toBe(false);

		// Case 3: bleedResult provided but bleedFilterEnabled false
		vi.mocked(scoreAttempt)
			.mockReturnValueOnce(mockScore)
			.mockReturnValueOnce(mockFilteredScore);
		const result3 = runScorePipeline(
			makePipelineInputs({ detected: mockDetected, bleedResult, bleedFilterEnabled: false })
		);
		expect(result3.useFiltered).toBe(false);
	});

	it('detected array comes from input', () => {
		const customDetected: DetectedNote[] = [
			{ midi: 62, cents: 5, onsetTime: 0.1, duration: 0.4, clarity: 0.88 },
			{ midi: 65, cents: -3, onsetTime: 0.5, duration: 0.3, clarity: 0.91 },
		];

		const inputs = makePipelineInputs({ detected: customDetected });
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

	it('forwards octaveInsensitive=true to both scoreAttempt calls when bleedResult is present', () => {
		vi.mocked(scoreAttempt)
			.mockReturnValueOnce(mockScore)
			.mockReturnValueOnce(mockFilteredScore);
		const bleedResult = { kept: mockDetected, filtered: [] as DetectedNote[] };
		const inputs = makePipelineInputs({ detected: mockDetected, bleedResult, octaveInsensitive: true });
		runScorePipeline(inputs);
		const calls = vi.mocked(scoreAttempt).mock.calls;
		expect(calls.length).toBe(2);
		expect(calls[0][5]).toBe(true); // unfiltered scoreAttempt
		expect(calls[1][5]).toBe(true); // filtered scoreAttempt
	});

	it('builds bleedLog from bleedResult data', () => {
		const keptNotes: DetectedNote[] = [
			{ midi: 60, cents: 0, onsetTime: 0, duration: 0.5, clarity: 0.95 },
		];
		const filteredNotes: DetectedNote[] = [
			{ midi: 62, cents: 0, onsetTime: 0.6, duration: 0.3, clarity: 0.82 },
		];
		const allDetected = [...keptNotes, ...filteredNotes];
		const bleedResult = { kept: keptNotes, filtered: filteredNotes };

		vi.mocked(scoreAttempt)
			.mockReturnValueOnce(mockScore)
			.mockReturnValueOnce(mockFilteredScore);

		const inputs = makePipelineInputs({ detected: allDetected, bleedResult });
		const result = runScorePipeline(inputs);

		expect(result.bleedLog).not.toBeNull();
		expect(result.bleedLog!.totalNotes).toBe(2);
		expect(result.bleedLog!.keptNotes).toBe(1);
		expect(result.bleedLog!.filteredNotes).toBe(filteredNotes);
	});
});
