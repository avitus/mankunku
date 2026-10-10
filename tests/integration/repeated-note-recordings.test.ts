import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { replayFromAudioBuffer } from '$lib/audio/replay';
import { trimToPerformance } from '$lib/audio/capture-window';
import {
	findReArticulations,
	getMetronomeBleedOnsets,
	resolveOnsets,
	segmentNotes
} from '$lib/audio/note-segmenter';
import { runScorePipeline } from '$lib/scoring/score-pipeline';
import type { Phrase } from '$lib/types/music';
import type { PitchReading } from '$lib/audio/pitch-frame';
import { loadWavFixture, makeFakeAudioBuffer } from '../helpers/audio-fixtures';

interface Diagnostic {
	context: { phraseId: string; phraseName: string; tempo: number; swing: number; transportSeconds: number };
	audio: { duration: number; captureTrimSeconds: number };
	detection: { readings: PitchReading[]; rawWorkletOnsets: number[]; weakReadings: PitchReading[] };
	scoring: { savedScore: { notesHit: number; noteResults: { extra: boolean; expected: Phrase['notes'][number] }[] } };
}

/**
 * Three tenor-sax takes in concert G, 100 BPM, metronome on, reported on
 * October 9 (the exports use UTC October 10). All saved only two pitch hits.
 * Blue Note Step-Up: a fading C hides the later tongue from the envelope scan.
 * Climb Through the Blue: click suppression erases the repeated C's onset;
 * the short D's octave vote then prefers stabilizer inertia over raw pitch.
 * Flat Five Chromatic Down: a quiet reed reset interrupts tracking without
 * enough loudness change for the old gap tiers. Both the original diagnostic
 * readings and fresh WAV decoding must recover the exact notes and boundaries.
 */
const cases = [
	{ name: 'blue-note-step-up', pitches: [60, 60, 62], times: [0.41, 1.03, 1.58] },
	{ name: 'climb-through-the-blue', pitches: [60, 60, 62, 65], times: [0.42, 1.00, 1.40, 1.60] },
	{ name: 'flat-five-chromatic-down', pitches: [62, 60, 60], times: [0.32, 0.90, 1.43] }
];

describe.each(['WAV', 'diagnostic'] as const)('2026-10-10 repeated-note recordings (%s)', (source) => {
	it.each(cases)('$name preserves every played note', async ({ name, pitches, times }) => {
		const file = `2026-10-10-${name}`;
		const diag: Diagnostic = JSON.parse(
			readFileSync(new URL(`../fixtures/recordings/${file}.json`, import.meta.url), 'utf8')
		);
		expect(diag.scoring.savedScore.notesHit).toBe(2);
		const { tempo, swing } = diag.context;
		let readings = diag.detection.readings;
		let weakReadings = diag.detection.weakReadings;
		let workletOnsets = diag.detection.rawWorkletOnsets;
		let duration = diag.audio.duration;
		let transport = diag.context.transportSeconds;
		if (source === 'WAV') {
			const wav = loadWavFixture(`recordings/${file}.wav`);
			const raw = await replayFromAudioBuffer(makeFakeAudioBuffer(wav.channel, wav.sampleRate));
			const trimmed = trimToPerformance(raw.readings, raw.onsets, raw.duration, undefined, raw.weakReadings);
			({ readings, weakReadings, workletOnsets, duration } = trimmed);
			// The export's transport already includes the saved trim; the WAV is
			// the whole recording. Mirror the authoritative ear-training rescore.
			transport += trimmed.offset - diag.audio.captureTrimSeconds;
		}
		const bleed = getMetronomeBleedOnsets(transport, tempo, duration);
		const base = resolveOnsets(workletOnsets, readings);
		const articulations = findReArticulations(readings, base, bleed);
		const detected = segmentNotes(
			readings, [...base, ...articulations].sort((a, b) => a - b), duration,
			undefined, undefined, undefined, workletOnsets, bleed, articulations, weakReadings
		);
		const phrase: Phrase = {
			id: diag.context.phraseId,
			name: diag.context.phraseName,
			key: 'G',
			timeSignature: [4, 4],
			notes: diag.scoring.savedScore.noteResults.filter((r) => !r.extra).map((r) => r.expected),
			harmony: [],
			difficulty: { level: 20, pitchComplexity: 20, rhythmComplexity: 20, lengthBars: 1 },
			category: 'blues',
			tags: [],
			source: 'curated'
		};
		const score = runScorePipeline({
			detected, phrase, tempo, transportSeconds: transport, swing,
			bleedFilterEnabled: false, readings
		}).chosen;
		expect(detected.map((n) => n.midi)).toEqual(pitches);
		for (const [i, time] of times.entries()) {
			expect(Math.abs(detected[i].onsetTime - time)).toBeLessThan(0.06);
		}
		expect(score.notesHit).toBe(pitches.length);
		expect(score.pitchAccuracy).toBe(1);
		expect(score.noteResults.some((r) => r.missed || r.extra)).toBe(false);
		expect(score.overall).toBeGreaterThan(0.9);
	});
});
