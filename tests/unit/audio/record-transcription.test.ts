import { describe, it, expect } from 'vitest';
import { transcribeTake, RECORD_COUNT_IN_BEATS } from '$lib/audio/record-transcription';
import type { PitchReading } from '$lib/audio/pitch-frame';

/**
 * End-to-end tests for the record-a-lick transcription tail: rebase onto the
 * scheduled bar-3 entrance, segmentation with the click grid as bleed
 * evidence, per-beat quantization, and concert-C normalization. This is the
 * seam the record page hands its raw capture to — the e2e spec deliberately
 * pins only the cue state machine, so pitch content is pinned here.
 */

const TEMPO = 120; // beat = 0.5 s
/** The entrance in the capture's own timebase: 8 count-in beats at 120. */
const ANCHOR = RECORD_COUNT_IN_BEATS * (60 / TEMPO); // 4 s

/** Steady 60 fps readings for one held note over [start, end) in RAW capture time. */
function steadyNote(midi: number, start: number, end: number): PitchReading[] {
	const out: PitchReading[] = [];
	for (let t = start; t < end - 1e-9; t += 1 / 60) {
		out.push({ midiFloat: midi, midi, cents: 0, clarity: 0.95, time: t, frequency: 440, rms: 0.1 });
	}
	return out;
}

describe('transcribeTake', () => {
	it('normalizes the take to concert C — key C, pitches shifted by the detected key', () => {
		// D–F#–D quarters starting exactly on the entrance. detectKey → D, so
		// every pitch shifts down 2 and the stored key is the catalog's C.
		const readings = [
			...steadyNote(62, ANCHOR, ANCHOR + 0.5),
			...steadyNote(66, ANCHOR + 0.5, ANCHOR + 1.0),
			...steadyNote(62, ANCHOR + 1.0, ANCHOR + 1.5)
		];
		const workletOnsets = [ANCHOR, ANCHOR + 0.5, ANCHOR + 1.0];

		const phrase = transcribeTake({ readings, workletOnsets, anchorOffset: ANCHOR, tempo: TEMPO });

		expect(phrase).not.toBeNull();
		expect(phrase!.key).toBe('C');
		const pitched = phrase!.notes.filter((n) => n.pitch !== null);
		expect(pitched.map((n) => n.pitch)).toEqual([60, 64, 60]);
		expect(pitched.map((n) => n.offset)).toEqual([
			[0, 1],
			[1, 4],
			[1, 2]
		]);
		expect(phrase!.source).toBe('user-recorded');
		expect(phrase!.category).toBe('user');
		expect(phrase!.tags).toContain('user-recorded');
		expect(phrase!.timeSignature).toEqual([4, 4]);
		expect(phrase!.difficulty.lengthBars).toBeGreaterThanOrEqual(1);
	});

	it('discards the count-in the detectors ran through', () => {
		// A held note during the count-in, well before the anchor tolerance,
		// then one real note on the entrance. Only the real note survives.
		const readings = [
			...steadyNote(70, ANCHOR - 1.0, ANCHOR - 0.5),
			...steadyNote(60, ANCHOR, ANCHOR + 0.5)
		];
		const workletOnsets = [ANCHOR - 1.0, ANCHOR];

		const phrase = transcribeTake({ readings, workletOnsets, anchorOffset: ANCHOR, tempo: TEMPO });

		expect(phrase).not.toBeNull();
		const pitched = phrase!.notes.filter((n) => n.pitch !== null);
		expect(pitched).toHaveLength(1);
		expect(pitched[0].offset).toEqual([0, 1]);
	});

	it('keeps a slightly-early on-the-downbeat attack and clamps it to beat 0', () => {
		// The attack sounds 0.1 s before the anchor — inside rebaseToAnchor's
		// tolerance, so it survives at a negative time, and the quantizer owns
		// the clamp. This is the seam between the two modules; neither test
		// alone crosses it.
		const readings = steadyNote(62, ANCHOR - 0.1, ANCHOR + 0.4);
		const workletOnsets = [ANCHOR - 0.1];

		const phrase = transcribeTake({ readings, workletOnsets, anchorOffset: ANCHOR, tempo: TEMPO });

		expect(phrase).not.toBeNull();
		const pitched = phrase!.notes.filter((n) => n.pitch !== null);
		expect(pitched).toHaveLength(1);
		expect(pitched[0].offset).toEqual([0, 1]);
	});

	it('returns null when nothing was played after the anchor', () => {
		// All readings sit before the anchor tolerance — the player never came
		// in. The rebase leaves nothing, and the caller returns to idle.
		const readings = steadyNote(60, ANCHOR - 2.0, ANCHOR - 1.0);
		const phrase = transcribeTake({
			readings,
			workletOnsets: [ANCHOR - 2.0],
			anchorOffset: ANCHOR,
			tempo: TEMPO
		});
		expect(phrase).toBeNull();
	});

	it('returns null for an empty capture', () => {
		expect(
			transcribeTake({ readings: [], workletOnsets: [], anchorOffset: ANCHOR, tempo: TEMPO })
		).toBeNull();
	});

	it('survives a take whose readings all precede the anchor but sit inside the tolerance', () => {
		// Last reading at ~−0.12 s: the naive duration (last + 0.1) would be
		// negative. The Math.max(0, …) guard keeps segmentation sane — the
		// essential property is no crash and nothing negative in the output;
		// the sliver of pre-anchor audio transcribes as one note clamped to
		// beat 0.
		const readings = steadyNote(60, ANCHOR - 0.15, ANCHOR - 0.11);
		const phrase = transcribeTake({
			readings,
			workletOnsets: [ANCHOR - 0.15],
			anchorOffset: ANCHOR,
			tempo: TEMPO
		});

		expect(phrase).not.toBeNull();
		const pitched = phrase!.notes.filter((n) => n.pitch !== null);
		expect(pitched).toHaveLength(1);
		expect(pitched[0].offset).toEqual([0, 1]);
		for (const n of phrase!.notes) {
			expect(n.offset[0]).toBeGreaterThanOrEqual(0);
			expect(n.duration[0]).toBeGreaterThan(0);
		}
	});

	it('hands the click grid to the segmenter — a worklet onset that is metronome bleed does not split a held note', () => {
		// One D4 held for two beats from the entrance. The worklet fires on the
		// attack and again 80 ms after the beat-2 click (speaker→mic latency,
		// inside the segmenter's 50–200 ms bleed window). The click runs through
		// the whole take, so only the analytic grid derived from the count-in
		// offset tells the merge pass that second onset is not a re-attack;
		// drop the grid at the call site and the half note becomes two D4s.
		const beat = 60 / TEMPO;
		const readings = steadyNote(62, ANCHOR, ANCHOR + 2 * beat);
		const workletOnsets = [ANCHOR, ANCHOR + beat + 0.08];

		const phrase = transcribeTake({ readings, workletOnsets, anchorOffset: ANCHOR, tempo: TEMPO });

		expect(phrase).not.toBeNull();
		const pitched = phrase!.notes.filter((n) => n.pitch !== null);
		expect(pitched).toHaveLength(1);
		expect(pitched[0].offset).toEqual([0, 1]);
	});

	it('hands the click grid to findReArticulations too — a click-masked hole in a held note is not a tongue stop', () => {
		// A D4 held for four beats loses pitch tracking for ~200 ms around the
		// beat-3 click, with the level unchanged either side. Unmasked, a hole
		// that long with the energy sustained IS a tongue stop (bare-gap tier);
		// with a scheduled click inside it the tier demands a real step-up. The
		// articulation onset it would otherwise emit counts as attack evidence
		// whatever the bleed grid says, so the segment-level merge cannot undo it.
		const readings = steadyNote(62, ANCHOR, ANCHOR + 2).filter(
			(r) => r.time - ANCHOR < 0.92 || r.time - ANCHOR >= 1.12
		);

		const phrase = transcribeTake({ readings, workletOnsets: [ANCHOR], anchorOffset: ANCHOR, tempo: TEMPO });

		expect(phrase).not.toBeNull();
		expect(phrase!.notes.filter((n) => n.pitch !== null)).toHaveLength(1);
	});
});
