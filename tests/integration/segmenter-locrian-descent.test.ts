import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveOnsets, segmentNotes } from '$lib/audio/note-segmenter';
import { runScorePipeline } from '$lib/scoring/score-pipeline';
import type { PitchReading } from '$lib/audio/pitch-detector';
import type { Phrase } from '$lib/types/music';

const __dirname = dirname(fileURLToPath(import.meta.url));

const FIXTURE_PATH = join(
	__dirname,
	'../fixtures/segmenter/2026-05-07-locrian-descent.json'
);

interface DiagnosticsExport {
	audio: { duration: number; sampleRate: number };
	context: { tempo: number; swing: number };
	detection: { rawWorkletOnsets: number[]; readings: PitchReading[] };
	scoring: { savedScore: { noteResults: Array<{ expected: { pitch: number; duration: [number, number]; offset: [number, number] } }> } };
}

describe('segmenter integration: Locrian Descent (2026-05-07)', () => {
	const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8')) as DiagnosticsExport;
	const { readings, rawWorkletOnsets } = fixture.detection;

	it('segments the recording into 8 notes matching what the player actually played', () => {
		const onsets = resolveOnsets(rawWorkletOnsets, readings);
		const notes = segmentNotes(readings, onsets, fixture.audio.duration);

		// Ground truth from the player: F D C A G F F F (8 notes).
		// MIDI: [65, 62, 60, 57, 55, 53, 53, 53].
		expect(notes.map((n) => n.midi)).toEqual([65, 62, 60, 57, 55, 53, 53, 53]);

		// First F at t≈0.083, A3 at t≈0.95, first F3 at t≈1.5,
		// last F3 attack at t≈2.27 (within 50ms tolerance).
		expect(notes[0].onsetTime).toBeCloseTo(0.083, 2);
		expect(notes[3].onsetTime).toBeCloseTo(0.95, 1);
		expect(notes[5].onsetTime).toBeCloseTo(1.5, 2);
		expect(notes[7].onsetTime).toBeGreaterThan(2.20);
		expect(notes[7].onsetTime).toBeLessThan(2.32);
	});

	it('scores the recording in the expected post-fix range (≈73%)', () => {
		const onsets = resolveOnsets(rawWorkletOnsets, readings);
		const detected = segmentNotes(readings, onsets, fixture.audio.duration);

		const expected = fixture.scoring.savedScore.noteResults.map((nr) => ({
			pitch: nr.expected.pitch,
			duration: nr.expected.duration,
			offset: nr.expected.offset
		}));
		const phrase: Phrase = {
			id: 'fixture',
			name: 'Locrian Descent',
			timeSignature: [4, 4],
			key: 'F',
			notes: expected,
			harmony: [],
			difficulty: { level: 20, pitchComplexity: 18, rhythmComplexity: 18, lengthBars: 1 },
			category: 'diminished-chord',
			tags: [],
			source: 'curated'
		};

		// transportSeconds derived from the saved alignment context.
		const result = runScorePipeline({
			detected,
			phrase,
			tempo: fixture.context.tempo,
			transportSeconds: -0.964,
			swing: fixture.context.swing,
			bleedFilterEnabled: false,
			octaveInsensitive: false
		});

		// Saved score was 0.494. With all three fixes the player gets:
		// 5/8 pitch matches via DTW (in-order with three mismatches), and
		// rhythm aligns much better with the 8 well-distributed onsets.
		// Target: 0.65-0.78 (allows for DTW tie-break variation).
		expect(result.chosen.overall).toBeGreaterThan(0.65);
		expect(result.chosen.overall).toBeLessThan(0.78);
		expect(result.chosen.notesHit).toBeGreaterThanOrEqual(5);
	});
});
