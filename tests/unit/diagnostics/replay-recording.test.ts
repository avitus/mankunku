/**
 * `replayRecording` is the /diagnostics + Flag Scoring Error replay: it must
 * hand the segmenter the SAME bleed evidence and frame the take's own scoring
 * path used, or the export disagrees with the saved score (a phantom split on
 * a click, most often). The detector itself is replaced by a canned replay;
 * the segmenter runs for real, with spies on the calls that carry evidence.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PitchReading } from '$lib/audio/pitch-frame';
import type { ReplayResult } from '$lib/audio/replay';
import type { RecordingMetadata, RecordingRecord } from '$lib/persistence/audio-store';

const replayFromBlob = vi.fn<() => Promise<ReplayResult>>();
vi.mock('$lib/audio/replay', () => ({ replayFromBlob: () => replayFromBlob() }));

vi.mock('$lib/audio/note-segmenter', async (importOriginal) => {
	const real = await importOriginal<typeof import('$lib/audio/note-segmenter')>();
	return {
		...real,
		findReArticulations: vi.fn(real.findReArticulations),
		getMetronomeBleedOnsets: vi.fn(real.getMetronomeBleedOnsets),
		segmentNotes: vi.fn(real.segmentNotes)
	};
});

const segmenter = await import('$lib/audio/note-segmenter');
const { replayRecording } = await import('$lib/diagnostics/recording-export');
const { PERFORMANCE_PREROLL_SECONDS } = await import('$lib/audio/capture-window');

/** A held A3 at performance level from `from`, 60 fps, for `seconds`. */
function heldNote(from: number, seconds: number): PitchReading[] {
	return Array.from({ length: Math.round(seconds * 60) }, (_, i) => ({
		midi: 57,
		midiFloat: 57,
		cents: 0,
		clarity: 0.95,
		time: from + i / 60,
		frequency: 220,
		rms: 0.1
	}));
}

const WEAK: PitchReading = {
	midi: 60, midiFloat: 60, cents: 0, clarity: 0.6, time: 2.3, frequency: 261.63, rms: 0.05
};

/** A 4 s blob whose note enters 2 s in — an armed ear-training lead-in. */
function rawReplay(): ReplayResult {
	return { readings: heldNote(2, 1), weakReadings: [WEAK], onsets: [2], duration: 4, sampleRate: 44100 };
}

function record(md: Partial<RecordingMetadata>): RecordingRecord {
	return {
		sessionId: 's',
		timestamp: 0,
		blob: new Blob([]),
		metadata: {
			phraseId: 'p',
			phraseName: 'P',
			source: 'ear-training',
			tempo: 120,
			key: 'C',
			swing: 0.5,
			score: null,
			detectedNotes: [],
			backingTrackLog: null,
			bleedFilterLog: null,
			...md
		}
	} as RecordingRecord;
}

const bleedArg = () => vi.mocked(segmenter.findReArticulations).mock.calls[0][2];

beforeEach(() => {
	vi.mocked(segmenter.findReArticulations).mockClear();
	vi.mocked(segmenter.getMetronomeBleedOnsets).mockClear();
	vi.mocked(segmenter.segmentNotes).mockClear();
	replayFromBlob.mockResolvedValue(rawReplay());
});

describe('replayRecording', () => {
	it('trims an ear-training take and builds the click grid in the trimmed frame (stored stamp + trim)', async () => {
		const result = await replayRecording(record({ metronomeEnabled: true, transportSeconds: 10 }));
		const trim = 2 - PERFORMANCE_PREROLL_SECONDS;
		expect(result.trimOffset).toBeCloseTo(trim, 9);
		expect(result.readings[0].time).toBeCloseTo(PERFORMANCE_PREROLL_SECONDS, 9);
		expect(result.duration).toBeCloseTo(4 - trim, 9);
		const [stamp, tempo, duration] = vi.mocked(segmenter.getMetronomeBleedOnsets).mock.calls[0];
		expect(stamp).toBeCloseTo(10 + trim, 9);
		expect(tempo).toBe(120);
		expect(duration).toBeCloseTo(4 - trim, 9);
		const grid = vi.mocked(segmenter.getMetronomeBleedOnsets).mock.results[0].value;
		expect(bleedArg()).toBe(grid);
		// …and the same evidence reaches the segmenter's attack-evidence merges.
		expect(vi.mocked(segmenter.segmentNotes).mock.calls[0][7]).toBe(grid);
	});

	it('scores against the stored backing onsets rather than the click grid when a band played', async () => {
		const backing = [0.5, 1.5];
		await replayRecording(
			record({ metronomeEnabled: true, transportSeconds: 10, backingBleedOnsets: backing })
		);
		expect(segmenter.getMetronomeBleedOnsets).not.toHaveBeenCalled();
		expect(bleedArg()).toBe(backing);
		expect(vi.mocked(segmenter.segmentNotes).mock.calls[0][7]).toBe(backing);
	});

	it('runs unsuppressed when nothing audible was playing', async () => {
		await replayRecording(record({ metronomeEnabled: false, transportSeconds: 10 }));
		expect(segmenter.getMetronomeBleedOnsets).not.toHaveBeenCalled();
		expect(bleedArg()).toBeUndefined();
	});

	it('cannot build a click grid without the transport stamp', async () => {
		await replayRecording(record({ metronomeEnabled: true }));
		expect(segmenter.getMetronomeBleedOnsets).not.toHaveBeenCalled();
		expect(bleedArg()).toBeUndefined();
	});

	it('replays a lick-practice take untrimmed, over its close path\'s duration', async () => {
		const result = await replayRecording(
			record({ source: 'lick-practice', metronomeEnabled: true, transportSeconds: 10 })
		);
		expect(result.trimOffset).toBe(0);
		expect(result.readings[0].time).toBe(2);
		expect(result.duration).toBeLessThan(4);
		expect(vi.mocked(segmenter.getMetronomeBleedOnsets).mock.calls[0][0]).toBe(10);
	});

	it('hands the weak readings to the segmenter, so a ghosted note can be carved', async () => {
		const result = await replayRecording(record({}));
		const weak = vi.mocked(segmenter.segmentNotes).mock.calls[0][9];
		expect(weak).toHaveLength(1);
		expect(weak![0].time).toBeCloseTo(2.3 - result.trimOffset, 9);
		expect(result.weakReadings).toBe(weak);
	});
});
