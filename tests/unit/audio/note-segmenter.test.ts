import { describe, it, expect } from 'vitest';
import { findReArticulations, mergeWholeNoteOctaveUpLocks } from '$lib/audio/note-segmenter';
import type { DetectedNote } from '$lib/types/audio';
import type { PitchReading } from '$lib/audio/pitch-frame';

function note(midi: number, onsetTime: number, duration: number): DetectedNote {
	return { midi, cents: 0, onsetTime, duration, clarity: 0.95 };
}

function reading(
	midi: number,
	time: number,
	opts: { octaveUp?: boolean; warmup?: boolean } = {}
): PitchReading {
	const r: PitchReading = { midiFloat: midi, midi, cents: 0, clarity: 0.95, time, frequency: 440, rms: 0.1 };
	if (opts.octaveUp) r.octaveUp = true;
	if (opts.warmup) r.warmup = true;
	return r;
}

/** N evenly-spaced readings inside [0,1). */
function frames(specs: Array<{ midi: number; octaveUp?: boolean; warmup?: boolean }>): PitchReading[] {
	return specs.map((s, i) => reading(s.midi, 0.1 + i * 0.05, s));
}

describe('mergeWholeNoteOctaveUpLocks', () => {
	it('drops a whole-note 2nd-harmonic lock an octave (majority of frames flagged)', () => {
		const notes = [note(64, 0, 1)]; // detected E4, actually a locked E3
		const readings = frames([
			{ midi: 64, octaveUp: true },
			{ midi: 64, octaveUp: true },
			{ midi: 64, octaveUp: true },
			{ midi: 64, octaveUp: true },
			{ midi: 64, octaveUp: true }
		]);
		expect(mergeWholeNoteOctaveUpLocks(notes, readings)[0].midi).toBe(52);
	});

	it('does NOT drop a note an earlier pass already lowered, even if it still holds flagged higher-octave frames', () => {
		// The C1 regression: mergeOctaveBoundariesWithoutAttack merged an E4 lock
		// segment (5 frames, midi 64, flagged) with a true-fundamental E3 segment
		// (2 frames, midi 52) into ONE note voted E3 (52). The flagged E4 frames are
		// a 5/7 majority — without the r.midi === note.midi guard this note would be
		// dropped a SECOND octave to E2 (40).
		const notes = [note(52, 0, 1)];
		const readings = frames([
			{ midi: 64, octaveUp: true },
			{ midi: 64, octaveUp: true },
			{ midi: 64, octaveUp: true },
			{ midi: 64, octaveUp: true },
			{ midi: 64, octaveUp: true },
			{ midi: 52 },
			{ midi: 52 }
		]);
		expect(mergeWholeNoteOctaveUpLocks(notes, readings)[0].midi).toBe(52);
	});

	it('leaves a genuine note (no flagged frames) untouched', () => {
		const notes = [note(62, 0, 1)];
		const readings = frames([{ midi: 62 }, { midi: 62 }, { midi: 62 }, { midi: 62 }]);
		expect(mergeWholeNoteOctaveUpLocks(notes, readings)[0].midi).toBe(62);
	});

	it('does not judge a note with fewer than the minimum confident frames', () => {
		const notes = [note(64, 0, 1)];
		const readings = frames([{ midi: 64, octaveUp: true }, { midi: 64, octaveUp: true }]);
		expect(mergeWholeNoteOctaveUpLocks(notes, readings)[0].midi).toBe(64);
	});

	it('keeps a note whose flagged fraction is below the majority threshold', () => {
		const notes = [note(64, 0, 1)];
		const readings = frames([
			{ midi: 64, octaveUp: true },
			{ midi: 64, octaveUp: true },
			{ midi: 64 },
			{ midi: 64 },
			{ midi: 64 }
		]); // 2/5 = 0.4 < 0.6
		expect(mergeWholeNoteOctaveUpLocks(notes, readings)[0].midi).toBe(64);
	});

	it('excludes warmup frames — flagged warmup readings do not drive a drop', () => {
		const notes = [note(64, 0, 1)];
		const readings = frames([
			{ midi: 64 },
			{ midi: 64 },
			{ midi: 64 },
			{ midi: 64, octaveUp: true, warmup: true },
			{ midi: 64, octaveUp: true, warmup: true },
			{ midi: 64, octaveUp: true, warmup: true }
		]); // 3 confident (unflagged) + 3 flagged-but-warmup → 0/3 flagged
		expect(mergeWholeNoteOctaveUpLocks(notes, readings)[0].midi).toBe(64);
	});
});

/**
 * Waveform-shape ("reed reset") re-articulation tier — see the SHAPE_* block
 * comment in note-segmenter.ts. These pin the gates directly, so a future
 * change to a threshold fails here with a named reason rather than only as a
 * note-count diff in a WAV fixture.
 */
describe('findReArticulations: waveform-shape tier', () => {
	/** A steady same-MIDI run at 60 fps, optionally broken at one reading. */
	function shapeRun(opts: {
		breakIndex?: number;
		breakValue?: number;
		baseline?: number;
		rmsAfter?: number;
		frames?: number;
		/**
		 * Positive for replay's window-START anchor, negative for the live
		 * path's window-END anchor (offset − fftSize/sampleRate). Both are
		 * exercised: the gates must not depend on which one produced them.
		 */
		shapeBreakAt?: number;
	}): PitchReading[] {
		const baseline = opts.baseline ?? 0.99;
		const shapeBreakAt = opts.shapeBreakAt ?? 0.045;
		const frames = opts.frames ?? 45; // 0.75 s — comfortably past the settle gate
		const out: PitchReading[] = [];
		for (let i = 0; i < frames; i++) {
			const broken = i === opts.breakIndex;
			out.push({
				midiFloat: 55,
				midi: 55,
				cents: 0,
				clarity: 0.98,
				time: 0.1 + i * (1 / 60),
				frequency: 196,
				rms: opts.breakIndex != null && i > opts.breakIndex ? (opts.rmsAfter ?? 0.12) : 0.1,
				hfRms: 0.008,
				rmsMin: 0.095,
				shapeBreak: broken ? (opts.breakValue ?? 0.955) : baseline,
				shapeBreakAt
			});
		}
		return out;
	}

	it('splits a shallow break on a clean run — the legato-tongue signature', () => {
		const onsets = findReArticulations(shapeRun({ breakIndex: 30 }), []);
		expect(onsets).toHaveLength(1);
		// Anchored at the measured discontinuity, not the reading grid.
		expect(onsets[0]).toBeCloseTo(0.1 + 30 / 60 + 0.045, 3);
	});

	it('does NOT split a steady run', () => {
		expect(findReArticulations(shapeRun({}), [])).toEqual([]);
	});

	it('does NOT split a DEEP break — destroyed periodicity is impulsive contamination', () => {
		// The crux of the tier. A click/thump/handling noise adds an
		// uncorrelated signal and drives similarity toward zero; a legato
		// tongue only reshapes an oscillation that never stops. Blue Monk's
		// held E reads 0.33 here and must stay one note.
		expect(findReArticulations(shapeRun({ breakIndex: 30, breakValue: 0.33 }), [])).toEqual([]);
	});

	it('does NOT split when the run is too noisy for the measure to mean anything', () => {
		// A breathy tone's own similarity floor is lower than the effect being
		// measured (the sustained-C fixture sits at 0.81).
		expect(
			findReArticulations(shapeRun({ breakIndex: 30, baseline: 0.9, breakValue: 0.88 }), [])
		).toEqual([]);
	});

	it('does NOT split while the tone is still settling after the note attack', () => {
		// A breathy attack blooms for 100-200 ms and reads as a shape break.
		expect(findReArticulations(shapeRun({ breakIndex: 6 }), [])).toEqual([]);
	});

	it('does NOT split in the wake of an onset another tier already found', () => {
		const readings = shapeRun({ breakIndex: 30 });
		const breakTime = 0.1 + 30 / 60 + 0.045;
		expect(findReArticulations(readings, [breakTime - 0.1])).toEqual([]);
	});

	it('does NOT split when energy falls across the break — that is a release', () => {
		expect(
			findReArticulations(shapeRun({ breakIndex: 30, rmsAfter: 0.08 }), [])
		).toEqual([]);
	});

	it('does NOT split inside a scheduled metronome click window', () => {
		const readings = shapeRun({ breakIndex: 30 });
		const breakTime = 0.1 + 30 / 60 + 0.045;
		expect(findReArticulations(readings, [], [breakTime - 0.05])).toEqual([]);
	});

	it('ignores readings with no shapeBreak (pre-2026-07-30 diagnostic JSON)', () => {
		const readings = shapeRun({ breakIndex: 30 }).map(({ shapeBreak, shapeBreakAt, ...r }) => {
			void shapeBreak;
			void shapeBreakAt;
			return r as PitchReading;
		});
		expect(findReArticulations(readings, [])).toEqual([]);
	});
});

/**
 * The same tier under the LIVE path's window-END anchor, where `shapeBreakAt`
 * is negative so a break's time precedes the reading that reported it. The
 * run-exit gates must not quietly become inert there — the live score is
 * what gets persisted immediately, and it is the display fallback whenever
 * the authoritative rescore can't produce a score.
 */
describe('findReArticulations: waveform-shape tier under the live window-end anchor', () => {
	const LIVE_ANCHOR = 0.045 - 4096 / 44100; // ≈ −0.048 s

	function liveRun(opts: {
		breakIndex?: number;
		breakValue?: number;
		frames?: number;
	}): PitchReading[] {
		const frames = opts.frames ?? 45;
		const out: PitchReading[] = [];
		for (let i = 0; i < frames; i++) {
			const broken = i === opts.breakIndex;
			out.push({
				midiFloat: 55,
				midi: 55,
				cents: 0,
				clarity: 0.98,
				time: 0.1 + i * (1 / 60),
				frequency: 196,
				rms: opts.breakIndex != null && i > opts.breakIndex ? 0.12 : 0.1,
				hfRms: 0.008,
				rmsMin: 0.095,
				shapeBreak: broken ? (opts.breakValue ?? 0.955) : 0.99,
				shapeBreakAt: LIVE_ANCHOR
			});
		}
		return out;
	}

	it('still splits a shallow mid-run break', () => {
		const onsets = findReArticulations(liveRun({ breakIndex: 30 }), []);
		expect(onsets).toHaveLength(1);
		expect(onsets[0]).toBeCloseTo(0.1 + 30 / 60 + LIVE_ANCHOR, 3);
	});

	it('does NOT split at the run exit', () => {
		// Two independent gates cover this, which is why the tier survived the
		// anchor bug the run-exit filter used to carry: the trailing-frames
		// guard (now counted by reading INDEX, so it holds under either
		// anchor — a `breakTime <= lastReadingTime` test excluded nothing here,
		// since breakTime precedes its reading) AND the energy-sustain gate,
		// which finds no readings after the break and so measures no sustain.
		// The sustain gate is what actually rejects these two cases; the index
		// guard is the structural statement of the same requirement.
		expect(findReArticulations(liveRun({ breakIndex: 44 }), [])).toEqual([]);
		expect(findReArticulations(liveRun({ breakIndex: 43 }), [])).toEqual([]);
	});

	it('still rejects a deep break', () => {
		expect(findReArticulations(liveRun({ breakIndex: 30, breakValue: 0.33 }), [])).toEqual([]);
	});
});

describe('findReArticulations: stop-and-hold short-gap path', () => {
	/**
	 * A same-MIDI run at 60 fps with a 117 ms true-silence hole. The level
	 * after the hole and the instrument-band floor across it are the knobs;
	 * every other signal is held steady so no other tier can fire.
	 */
	function holeRun(opts: { bandAfter: number; rmsAfter: number; holdRms: number }): PitchReading[] {
		const out: PitchReading[] = [];
		const push = (time: number, rms: number, band: number) =>
			out.push({
				midiFloat: 55,
				midi: 55,
				cents: 0,
				clarity: 0.98,
				time,
				frequency: 196,
				rms,
				hfRms: 0.008,
				rmsMin: rms * 0.95,
				bandRmsMin: band,
				shapeBreak: 0.99,
				shapeBreakAt: 0.045
			});
		// 0.5 s of steady note, then the hole (7 frames skipped), then the rest.
		for (let i = 0; i < 30; i++) push(0.1 + i * (1 / 60), 0.1, 0.09);
		const resume = 0.1 + 37 * (1 / 60);
		for (let i = 0; i < 30; i++) {
			const t = resume + i * (1 / 60);
			const early = t - resume <= 0.1;
			push(t, early ? opts.rmsAfter : opts.holdRms, early ? opts.bandAfter : 0.09);
		}
		return out;
	}

	it('splits when the band floor collapses across the hole and the note then holds', () => {
		// 2026-09-09 blue-note-drop beat 3: band 0.65×, resumes at 0.81×, holds 0.84×.
		const readings = holeRun({ bandAfter: 0.058, rmsAfter: 0.081, holdRms: 0.084 });
		const onsets = findReArticulations(readings, [0.1]);
		expect(onsets).toHaveLength(1);
		expect(onsets[0]).toBeCloseTo(0.1 + 37 / 60 - 0.02, 3);
	});

	it('does not split a click-blanked sustain — the band floor barely moves', () => {
		// The 2026-08-01 down-to-the-third kick hole measures 0.83×; the corpus
		// impostor the STOP gate is cut against.
		const readings = holeRun({ bandAfter: 0.075, rmsAfter: 0.089, holdRms: 0.082 });
		expect(findReArticulations(readings, [0.1])).toEqual([]);
	});

	it('does not split a note decaying under a click — the level never holds', () => {
		const readings = holeRun({ bandAfter: 0.045, rmsAfter: 0.069, holdRms: 0.04 });
		expect(findReArticulations(readings, [0.1])).toEqual([]);
	});
});

/**
 * Bare-gap tier (≥ 150 ms hole) with a scheduled click INSIDE the hole — see
 * RE_ARTICULATION_GAP_CLICK_RISE. A click can mask tracking for a whole
 * analyser window but only ever ADDS energy, so when one lands in the hole the
 * sustain floor (0.85) can't separate a masked held note from a tongue stop;
 * the tier must demand the short-gap tier's genuine step-up (1.2) instead.
 * The 2026-08-10 pent run pins this end to end; these pin the rule itself.
 */
describe('findReArticulations: bare-gap tier, a click inside the hole', () => {
	const PRE_FRAMES = 30;
	const HOLE_FRAMES = 10; // 11/60 s ≈ 183 ms — past the 150 ms bare-gap threshold
	const holeStart = 0.1 + (PRE_FRAMES - 1) / 60; // last reading before the hole
	const resume = 0.1 + (PRE_FRAMES + HOLE_FRAMES) / 60; // first reading after it

	/** A same-MIDI run at 60 fps; the level after the hole is the only knob. */
	function bareGapRun(rmsAfter: number): PitchReading[] {
		const out: PitchReading[] = [];
		const push = (time: number, rms: number) =>
			out.push({
				midiFloat: 55,
				midi: 55,
				cents: 0,
				clarity: 0.98,
				time,
				frequency: 196,
				rms,
				hfRms: 0.008,
				rmsMin: rms * 0.95,
				bandRmsMin: 0.09,
				shapeBreak: 0.99,
				shapeBreakAt: 0.045
			});
		for (let i = 0; i < PRE_FRAMES; i++) push(0.1 + i / 60, 0.1);
		for (let i = 0; i < 30; i++) push(resume + i / 60, rmsAfter);
		return out;
	}

	it('splits a hole the note sustains its energy across when no click landed in it', () => {
		// 0.95× across the hole clears the 0.85 sustain floor — a tongue stop.
		const onsets = findReArticulations(bareGapRun(0.095), [0.1]);
		expect(onsets).toHaveLength(1);
		expect(onsets[0]).toBeCloseTo(resume - 0.02, 3);
	});

	it('demands a genuine step-up when a scheduled click sits inside the hole', () => {
		// The same 0.95× is now a click-masked held note: no step-up, no split.
		const click = (holeStart + resume) / 2;
		expect(findReArticulations(bareGapRun(0.095), [0.1], [click])).toEqual([]);
	});

	it('still splits a real re-attack on the click — it steps up through the hole', () => {
		const click = (holeStart + resume) / 2;
		const onsets = findReArticulations(bareGapRun(0.13), [0.1], [click]);
		expect(onsets).toHaveLength(1);
		expect(onsets[0]).toBeCloseTo(resume - 0.02, 3);
	});

	it('counts a click just ahead of the hole as inside it — the last reading\'s window already held it', () => {
		// Readings are stamped at their window END, so a click one bleed-latency
		// floor (50 ms) before the last clean reading is what wiped the tracking.
		expect(findReArticulations(bareGapRun(0.095), [0.1], [holeStart - 0.04])).toEqual([]);
	});

	it('leaves the sustain floor in force for a click elsewhere in the take', () => {
		const onsets = findReArticulations(bareGapRun(0.095), [0.1], [holeStart - 0.3, resume + 0.3]);
		expect(onsets).toHaveLength(1);
		expect(onsets[0]).toBeCloseTo(resume - 0.02, 3);
	});
});

/**
 * Broken-entry path of the short-gap tier — see RE_ARTICULATION_BROKEN_ENTRY_SHAPE.
 * A tongue that damps the reed on the way INTO a true-silence hole leaves two
 * deep tracked frames (shapeBreak ≤ 0.25) before it while the energy holds
 * across; an impulse abrupt enough to blank tracking leaves at most one. The
 * 2026-08-18 crescendo take pins this end to end; these pin the gates.
 */
describe('findReArticulations: broken-entry short-gap path', () => {
	const resume = 0.1 + 37 / 60; // 7 frames skipped — a 117 ms hole

	/**
	 * A same-MIDI run at 60 fps with a 117 ms hole. `entry` is the shapeBreak
	 * of the last two frames before the hole; the level after it defaults to
	 * 1.1× — enough to defeat the step-up (1.2) and the bloom (no trough), so
	 * only the shape evidence can split it.
	 */
	function entryRun(entry: [number, number], rmsAfter = 0.11): PitchReading[] {
		const out: PitchReading[] = [];
		const push = (time: number, rms: number, shapeBreak: number) =>
			out.push({
				midiFloat: 55,
				midi: 55,
				cents: 0,
				clarity: 0.98,
				time,
				frequency: 196,
				rms,
				hfRms: 0.008,
				rmsMin: rms * 0.95,
				bandRmsMin: 0.09,
				shapeBreak,
				shapeBreakAt: 0.045
			});
		for (let i = 0; i < 30; i++) {
			const shape = i === 28 ? entry[0] : i === 29 ? entry[1] : 0.99;
			push(0.1 + i / 60, 0.1, shape);
		}
		for (let i = 0; i < 30; i++) push(resume + i / 60, rmsAfter, 0.99);
		return out;
	}

	it('splits when both tracked frames before the hole are collapsed and energy holds across', () => {
		// 2026-08-18 blues-curl-up: 0.06 / 0.17 on the way in, 1.12× across.
		const onsets = findReArticulations(entryRun([0.06, 0.17]), [0.1]);
		expect(onsets).toHaveLength(1);
		expect(onsets[0]).toBeCloseTo(resume - 0.02, 3);
	});

	it('does not split on one deep frame — an impulse leaves at most one before it blanks tracking', () => {
		// down-to-the-third's kick: −0.18 preceded by 0.99.
		expect(findReArticulations(entryRun([0.99, 0.06]), [0.1])).toEqual([]);
	});

	it('does not split a partial decorrelation — a click on an intact tone sits above the ceiling', () => {
		// Every impulsive contaminant that leaves TWO tracked frames sits ≥ 0.33.
		expect(findReArticulations(entryRun([0.4, 0.4]), [0.1])).toEqual([]);
	});

	it('does not split when energy falls through the hole — a release that broke shape', () => {
		expect(findReArticulations(entryRun([0.06, 0.17], 0.08), [0.1])).toEqual([]);
	});
});

/**
 * Feather-tongue rescue of the HF tier's click suppression — see
 * `feathersTongueShape`. Inside a click window the HF tier trusts the schedule
 * and drops the spike, unless the frames carry a tongue signature a click
 * cannot fake: here a multi-frame shape dip in the shallow 0.80–0.92 band on a
 * clean-baseline run, with energy sustained. The 2026-08-13 repeated-Eb pair
 * pins this end to end; these pin the rescue's gates.
 */
describe('findReArticulations: feather-tongue rescue inside a click window', () => {
	const SPIKE_FROM = 30;
	const SPIKE_TO = 33;
	const spikeStart = 0.1 + SPIKE_FROM / 60;
	const click = spikeStart - 0.05;

	/** A same-MIDI run at 60 fps with an hfRms spike over [SPIKE_FROM, SPIKE_TO). */
	function spikeRun(opts: {
		spanShape: number;
		spanFrames?: number;
		baseline?: number;
		rmsAfter?: number;
	}): PitchReading[] {
		const spanTo = SPIKE_FROM + (opts.spanFrames ?? SPIKE_TO - SPIKE_FROM);
		const out: PitchReading[] = [];
		for (let i = 0; i < 60; i++) {
			const inSpan = i >= SPIKE_FROM && i < spanTo;
			const rms = i >= spanTo ? (opts.rmsAfter ?? 0.1) : 0.1;
			out.push({
				midiFloat: 55,
				midi: 55,
				cents: 0,
				clarity: 0.98,
				time: 0.1 + i / 60,
				frequency: 196,
				rms,
				hfRms: inSpan ? 0.03 : 0.008,
				rmsMin: rms * 0.95,
				bandRmsMin: 0.09,
				shapeBreak: inSpan ? opts.spanShape : (opts.baseline ?? 0.99),
				shapeBreakAt: 0.045
			});
		}
		return out;
	}

	it('rescues a shallow multi-frame shape dip on a clean run — the tongue that never stops the air', () => {
		const onsets = findReArticulations(spikeRun({ spanShape: 0.85 }), [0.1], [click]);
		expect(onsets).toHaveLength(1);
		// Anchored on the spike's peak frame, minus the attack latency.
		expect(onsets[0]).toBeCloseTo(spikeStart - 0.02, 3);
	});

	it('keeps the suppression when the shape dips deep — that is the click', () => {
		expect(findReArticulations(spikeRun({ spanShape: 0.7 }), [0.1], [click])).toEqual([]);
	});

	it('keeps the suppression for a single-frame dip', () => {
		expect(
			findReArticulations(spikeRun({ spanShape: 0.85, spanFrames: 1 }), [0.1], [click])
		).toEqual([]);
	});

	it('keeps the suppression on a noisy run — the shape measure is not trusted there', () => {
		expect(
			findReArticulations(spikeRun({ spanShape: 0.85, baseline: 0.95 }), [0.1], [click])
		).toEqual([]);
	});

	it('keeps the suppression when energy falls past the spike — a release, not a re-attack', () => {
		expect(
			findReArticulations(spikeRun({ spanShape: 0.85, rmsAfter: 0.082 }), [0.1], [click])
		).toEqual([]);
	});
});

/**
 * Slow-bloom path of the short-gap tier — see RE_ARTICULATION_GAP_BLOOM_*.
 * When the hole swallows a reed attack's whole transient, tracking resumes on
 * a note that is still climbing, so the 50 ms step-up test reads a dip; the
 * bloom path accepts the full V instead: resume under the old level, then
 * climb past it. The 2026-08-01 flat-five-chromatic-down take is its
 * reference, but the corpus now finds that note through other tiers too, so
 * nothing else fails if the path goes — these pin it and each of its gates.
 */
describe('findReArticulations: slow-bloom short-gap path', () => {
	const resume = 0.1 + 37 / 60; // 7 frames skipped — a 117 ms true-silence hole

	/**
	 * A same-MIDI run at 60 fps. After the hole the level ramps from `from` to
	 * `to` (× the 0.1 pre-hole level) over 10 frames (~170 ms), then holds.
	 * Band floor and shape stay flat, so stop-and-hold and broken-entry can't fire.
	 */
	function bloomRun(from: number, to: number): PitchReading[] {
		const out: PitchReading[] = [];
		const push = (time: number, rms: number) =>
			out.push({
				midiFloat: 55,
				midi: 55,
				cents: 0,
				clarity: 0.98,
				time,
				frequency: 196,
				rms,
				hfRms: 0.008,
				rmsMin: rms * 0.95,
				bandRmsMin: 0.09,
				shapeBreak: 0.99,
				shapeBreakAt: 0.045
			});
		for (let i = 0; i < 30; i++) push(0.1 + i / 60, 0.1);
		for (let i = 0; i < 30; i++) {
			const level = i >= 10 ? to : from + ((to - from) * i) / 10;
			push(resume + i / 60, 0.1 * level);
		}
		return out;
	}

	it('splits a re-attack that resumes under the old level and then climbs past it', () => {
		// flat-five-chromatic-down: resumes at 0.84×, peaks at 1.20× ~170 ms later.
		const onsets = findReArticulations(bloomRun(0.84, 1.2), [0.1]);
		expect(onsets).toHaveLength(1);
		expect(onsets[0]).toBeCloseTo(resume - 0.02, 3);
	});

	it('does not split a crescendo through a dropout — a swell has no trough (TROUGH)', () => {
		expect(findReArticulations(bloomRun(1.0, 1.3), [0.1])).toEqual([]);
	});

	it('does not split a note tracked back on without an attack — no climb (RISE)', () => {
		// Clears the old level (1.11×) but rises only 1.23× from the trough.
		expect(findReArticulations(bloomRun(0.9, 1.11), [0.1])).toEqual([]);
	});

	it('does not split a note that only recovers to where it was (EXCEED)', () => {
		// Climbs 1.31× from the trough but tops out at 1.05× the old level.
		expect(findReArticulations(bloomRun(0.8, 1.05), [0.1])).toEqual([]);
	});
});

/**
 * The short-gap tier (75–150 ms) fires only on a TRUE detector silence. A
 * stabiliser reset mid-note keeps emitting WARMUP frames through the hole;
 * `findSameMidiRuns` skips them, so the stable run shows a phantom gap. The
 * C-D-C upper-neighbor fixture's final C rises ~1.27× across exactly such a
 * hole, and the two-deep-frame Blue Monk thump sits behind one — the silence
 * gate, not any ratio, is what rejects both.
 */
describe('findReArticulations: the short-gap tier demands a true detector silence', () => {
	const resume = 0.1 + 37 / 60; // 7 frames skipped — a 117 ms hole

	function holeRun(opts: { bridged: boolean; rmsAfter: number; entry?: [number, number] }): PitchReading[] {
		const out: PitchReading[] = [];
		const push = (time: number, rms: number, shapeBreak: number, warmup = false) => {
			const r: PitchReading = {
				midiFloat: 55,
				midi: 55,
				cents: 0,
				clarity: 0.98,
				time,
				frequency: 196,
				rms,
				hfRms: 0.008,
				rmsMin: rms * 0.95,
				bandRmsMin: 0.09,
				shapeBreak,
				shapeBreakAt: 0.045
			};
			if (warmup) r.warmup = true;
			out.push(r);
		};
		for (let i = 0; i < 30; i++) {
			const shape = opts.entry && i === 28 ? opts.entry[0] : opts.entry && i === 29 ? opts.entry[1] : 0.99;
			push(0.1 + i / 60, 0.1, shape);
		}
		if (opts.bridged) for (let i = 30; i < 37; i++) push(0.1 + i / 60, 0.1, 0.99, true);
		for (let i = 0; i < 30; i++) push(resume + i / 60, opts.rmsAfter, 0.99);
		return out;
	}

	it('splits a 1.27× step-up across a true silence', () => {
		const onsets = findReArticulations(holeRun({ bridged: false, rmsAfter: 0.127 }), [0.1]);
		expect(onsets).toHaveLength(1);
		expect(onsets[0]).toBeCloseTo(resume - 0.02, 3);
	});

	it('does not split the same step-up when warmup frames bridge the hole — a stabiliser reset', () => {
		expect(findReArticulations(holeRun({ bridged: true, rmsAfter: 0.127 }), [0.1])).toEqual([]);
	});

	it('does not take the broken-entry shape across a warmup-bridged hole', () => {
		const readings = holeRun({ bridged: true, rmsAfter: 0.11, entry: [0.06, 0.17] });
		expect(findReArticulations(readings, [0.1])).toEqual([]);
	});
});

/**
 * Envelope dip-recover tier — see ENV_DIP_RATIO. The window-level `rms` smooths
 * a 20–60 ms tongue stop away; the sub-window floor `rmsMin` keeps it. A bare
 * dip also matches a breath pulse on a held note (the 2026-07-23 Blue Monk
 * held E: a 42%/25 ms dip that must NOT split), so the tier fires only with a
 * corroborator — a tongue-noise burst or a reed-reset pitch wobble.
 */
describe('findReArticulations: envelope dip-recover tier', () => {
	const DIP = [30, 31];

	function dipRun(opts: { hfBurst?: boolean; wobble?: boolean }): PitchReading[] {
		const out: PitchReading[] = [];
		for (let i = 0; i < 60; i++) {
			const inDip = DIP.includes(i);
			const rms = inDip ? 0.085 : 0.1;
			out.push({
				// 0.12 st — the 2026-07-25 blue-step-down tongue's fundamental wobble.
				midiFloat: inDip && opts.wobble ? 55.12 : 55,
				midi: 55,
				cents: 0,
				clarity: 0.98,
				time: 0.1 + i / 60,
				frequency: 196,
				rms,
				// 2.5× the run median: tongue noise, but under the HF tier's 3× trigger.
				hfRms: inDip && opts.hfBurst ? 0.02 : 0.008,
				rmsMin: inDip ? 0.058 : rms * 0.95,
				bandRmsMin: 0.09,
				shapeBreak: 0.99,
				shapeBreakAt: 0.045
			});
		}
		return out;
	}
	const recovery = 0.1 + 32 / 60;

	it('splits a floor dip that recovers when tongue noise corroborates it', () => {
		const onsets = findReArticulations(dipRun({ hfBurst: true }), [0.1]);
		expect(onsets).toHaveLength(1);
		expect(onsets[0]).toBeCloseTo(recovery - 0.02, 3);
	});

	it('splits a floor dip that recovers when the fundamental wobbles — the near-silent tongue', () => {
		const onsets = findReArticulations(dipRun({ wobble: true }), [0.1]);
		expect(onsets).toHaveLength(1);
		expect(onsets[0]).toBeCloseTo(recovery - 0.02, 3);
	});

	it('does not split the same dip with neither corroborator — a breath pulse on a held note', () => {
		expect(findReArticulations(dipRun({}), [0.1])).toEqual([]);
	});
});
