import { describe, it, expect } from 'vitest';
import {
	buildCaptureTiming,
	describeCaptureAlignment,
	estimateBlobStartOffset,
	predictedGridError,
	snapshotArmTiming,
	type ArmTiming,
	type AudioClockLike,
	type LiveReadingSample
} from '$lib/audio/capture-timing';
import { replayFromAudioBuffer } from '$lib/audio/replay';
import type { PitchReading } from '$lib/audio/pitch-frame';
import { loadWavFixture, makeFakeAudioBuffer } from '../../helpers/audio-fixtures';

/**
 * The capture-timing instrumentation measures where a saved recording's first
 * sample sits relative to the arm instant, the question behind the ear-training
 * click-grid drift (the clicks can only answer it modulo a beat). These pin the
 * estimator on synthetic streams and on a real take, and the grid-error
 * arithmetic that turns the measurement into the observable.
 */

const HOP = 1 / 60;
const REPLAY_WINDOW = 4096 / 44100;
const LIVE_WINDOW = 4096 / 48000;

/** How long the synthetic contour takes to move between notes — about what an analysis window blurs a transition into. */
const GLIDE = 0.06;

/**
 * The performance as a continuous pitch contour over recording time:
 * consecutive notes, `noteSeconds` each, gliding into the next over GLIDE.
 */
function pitchAt(pitches: number[], noteSeconds: number, t: number): number {
	const i = Math.max(0, Math.min(pitches.length - 1, Math.floor(t / noteSeconds)));
	const into = t - i * noteSeconds;
	if (i === 0 || into >= GLIDE) return pitches[i];
	return pitches[i - 1] + (into / GLIDE) * (pitches[i] - pitches[i - 1]);
}

/** The replay's frames: the contour at each window's centre, stamped at window START, from `phase`. */
function replayContour(pitches: number[], noteSeconds: number, phase = 0): PitchReading[] {
	const out: PitchReading[] = [];
	const total = pitches.length * noteSeconds;
	for (let b = phase; b + REPLAY_WINDOW / 2 < total; b += HOP) {
		const midiFloat = pitchAt(pitches, noteSeconds, b + REPLAY_WINDOW / 2);
		out.push({ midiFloat, midi: Math.round(midiFloat), cents: 0, clarity: 0.99, time: b, frequency: 0, rms: 0.1 });
	}
	return out;
}

/**
 * The live stream of the same performance when the recording started
 * `offset` seconds after the arm instant: the contour at each window's
 * centre, on its own frame phase, stamped at window END in seconds from arm.
 */
function liveFor(pitches: number[], noteSeconds: number, offset: number, phase: number): LiveReadingSample[] {
	const out: LiveReadingSample[] = [];
	const total = pitches.length * noteSeconds;
	for (let c = phase; c < total; c += HOP) {
		out.push([offset + c + LIVE_WINDOW / 2, pitchAt(pitches, noteSeconds, c), 0.1]);
	}
	return out;
}

const LICK = [58, 61, 61, 63, 65, 58, 56, 60];

describe('estimateBlobStartOffset', () => {
	for (const offset of [0.366, -0.234, 0, 0.05]) {
		it(`recovers a recording that started ${offset} s from the arm instant`, () => {
			const replay = replayContour(LICK, 0.3);
			// A different frame phase from the replay's, as two independent
			// detector runs have.
			const live = liveFor(LICK, 0.3, offset, 0.0071);
			const est = estimateBlobStartOffset(live, LIVE_WINDOW, replay, REPLAY_WINDOW);
			expect(est).not.toBeNull();
			expect(est!.blobStartOffset).toBeCloseTo(offset, 2);
			expect(est!.meanPitchError).toBeLessThan(0.05);
			expect(est!.matchedFrames).toBeGreaterThan(100);
		});
	}

	it('is not fooled by a beat-periodic answer: two offsets a beat apart read differently', () => {
		// The clicks cannot tell +0.366 from −0.234 at 100 BPM; the pitch contour can.
		const replay = replayContour(LICK, 0.3);
		const late = estimateBlobStartOffset(liveFor(LICK, 0.3, 0.366, 0.004), LIVE_WINDOW, replay, REPLAY_WINDOW);
		const early = estimateBlobStartOffset(liveFor(LICK, 0.3, -0.234, 0.004), LIVE_WINDOW, replay, REPLAY_WINDOW);
		expect(late!.blobStartOffset).toBeCloseTo(0.366, 2);
		expect(early!.blobStartOffset).toBeCloseTo(-0.234, 2);
	});

	it('refuses a single held pitch class — it matches at every lag', () => {
		const held = [61, 61, 61, 73];
		const est = estimateBlobStartOffset(
			liveFor(held, 0.4, 0.2, 0.003),
			LIVE_WINDOW,
			replayContour(held, 0.4),
			REPLAY_WINDOW
		);
		expect(est).toBeNull();
	});

	it('refuses streams that never agree — they did not describe the same audio', () => {
		const replay = replayContour(LICK, 0.3);
		const other = liveFor([50, 53, 57, 50, 53, 57, 50, 53], 0.3, 0.1, 0.002).map(
			([t, mf, rms]): LiveReadingSample => [t, mf + 0.5 + ((t * 37) % 3), rms]
		);
		expect(estimateBlobStartOffset(other, LIVE_WINDOW, replay, REPLAY_WINDOW)).toBeNull();
	});

	it('refuses too few frames', () => {
		const replay = replayContour(LICK, 0.3);
		const live = liveFor(LICK, 0.3, 0.1, 0.002).slice(0, 10);
		expect(estimateBlobStartOffset(live, LIVE_WINDOW, replay, REPLAY_WINDOW)).toBeNull();
	});

	it('measures a real take: the 2026-09-18 Blues Curl Up replayed twice, the second run armed 0.2503 s into the recording', async () => {
		// Two independent detector runs over the same audio, like the live path
		// and the replay: the "live" run starts `k` samples in, so the recording
		// began k/rate BEFORE its arm instant (a negative offset), and its frames
		// fall on a different phase. The live run's frames are then stamped at
		// window END, as the live detector stamps them.
		const wav = loadWavFixture('recordings/2026-09-18-blues-curl-up.wav');
		const k = 11038; // 0.2503 s at 44.1 kHz — not a multiple of the 735-sample hop
		const replay = await replayFromAudioBuffer(makeFakeAudioBuffer(wav.channel, wav.sampleRate));
		const armed = await replayFromAudioBuffer(
			makeFakeAudioBuffer(wav.channel.subarray(k), wav.sampleRate)
		);
		const window = 4096 / wav.sampleRate;
		const live: LiveReadingSample[] = armed.readings.map((r) => [r.time + window, r.midiFloat, r.rms]);
		const est = estimateBlobStartOffset(live, window, replay.readings, window);
		expect(est).not.toBeNull();
		expect(est!.blobStartOffset).toBeCloseTo(-k / wav.sampleRate, 2);
		expect(est!.meanPitchError).toBeLessThan(0.1);
	});
});

describe('predictedGridError', () => {
	const arm = (overrides: Partial<ArmTiming> = {}): ArmTiming => ({
		contextTime: 50,
		performanceNowMs: 1000,
		transportSeconds: 213.4237,
		transportSecondsAtContextTime: 213.3237,
		lookAhead: 0.1,
		sampleRate: 48000,
		liveWindowSeconds: LIVE_WINDOW,
		baseLatency: null,
		outputLatency: null,
		outputTimestamp: null,
		...overrides
	});

	it('is the lookahead alone when the recording starts at the arm instant', () => {
		const e = predictedGridError(arm(), 0, 100)!;
		expect(e.seconds).toBeCloseTo(0.1, 9);
		expect(e.modBeat).toBeCloseTo(0.1, 9);
	});

	it('reads the same +0.334 click residual for a recording 0.234 s early or 0.366 s late at 100 BPM', () => {
		// The ambiguity the clicks leave, reproduced: only the offset tells them apart.
		const early = predictedGridError(arm(), -0.234, 100)!;
		const late = predictedGridError(arm(), 0.366, 100)!;
		expect(early.seconds).toBeCloseTo(0.334, 9);
		expect(late.seconds).toBeCloseTo(-0.266, 9);
		expect(early.modBeat).toBeCloseTo(0.334, 9);
		expect(late.modBeat).toBeCloseTo(0.334, 9);
	});

	it('is unknown without the transport clock', () => {
		expect(predictedGridError(arm({ transportSecondsAtContextTime: null }), 0, 100)).toBeNull();
	});
});

describe('snapshotArmTiming', () => {
	it('reads latencies and the output timestamp through a wrapper that hides them', () => {
		const native: AudioClockLike = {
			currentTime: 12.5,
			sampleRate: 48000,
			baseLatency: 0.005,
			outputLatency: 0.021,
			getOutputTimestamp: () => ({ contextTime: 12.49, performanceTime: 9876.5 })
		};
		const wrapper: AudioClockLike = { currentTime: 12.5, sampleRate: 48000, _nativeAudioContext: native };
		const arm = snapshotArmTiming(wrapper, 213.42, { secondsAtContextTime: 213.32, lookAhead: 0.1 }, 4096, 9880);
		expect(arm).toEqual({
			contextTime: 12.5,
			performanceNowMs: 9880,
			transportSeconds: 213.42,
			transportSecondsAtContextTime: 213.32,
			lookAhead: 0.1,
			sampleRate: 48000,
			liveWindowSeconds: 4096 / 48000,
			baseLatency: 0.005,
			outputLatency: 0.021,
			outputTimestamp: { contextTime: 12.49, performanceTime: 9876.5 }
		});
	});

	it('records what it cannot read as null rather than failing the capture', () => {
		const ctx: AudioClockLike = {
			currentTime: 1,
			sampleRate: 44100,
			getOutputTimestamp: () => {
				throw new Error('not supported');
			}
		};
		const arm = snapshotArmTiming(ctx, 3, null, 4096, 0);
		expect(arm.baseLatency).toBeNull();
		expect(arm.outputLatency).toBeNull();
		expect(arm.outputTimestamp).toBeNull();
		expect(arm.transportSecondsAtContextTime).toBeNull();
		expect(arm.lookAhead).toBeNull();
	});
});

describe('buildCaptureTiming', () => {
	it('compacts live readings to [time, midiFloat, rms]', () => {
		const arm = snapshotArmTiming({ currentTime: 1, sampleRate: 48000 }, 2, null, 4096, 0);
		const timing = buildCaptureTiming({
			arm,
			recorder: null,
			liveOnsets: [0.4],
			liveReadings: [
				{ midiFloat: 61.2, midi: 61, cents: 20, clarity: 0.99, time: 0.5, frequency: 280, rms: 0.18 }
			]
		});
		expect(timing).toEqual({ version: 1, arm, recorder: null, liveOnsets: [0.4], liveReadings: [[0.5, 61.2, 0.18]] });
	});
});

describe('describeCaptureAlignment', () => {
	const arm = snapshotArmTiming(
		{ currentTime: 40, sampleRate: 48000 },
		213.4237,
		{ secondsAtContextTime: 213.3237, lookAhead: 0.1 },
		4096,
		5000
	);

	it('reports the stamp lead, the recorder delays, the start offset and the grid error it implies', () => {
		const replay = replayContour(LICK, 0.3);
		const live = liveFor(LICK, 0.3, 0.366, 0.0071);
		const timing = buildCaptureTiming({
			arm,
			recorder: {
				mimeType: 'audio/webm;codecs=opus',
				startCall: { contextTime: 40.001, performanceNowMs: 5001 },
				startEvent: { contextTime: 40.36, performanceNowMs: 5360 }
			},
			liveOnsets: [],
			liveReadings: []
		});
		const a = describeCaptureAlignment({ ...timing, liveReadings: live }, replay, REPLAY_WINDOW, 100);
		expect(a.stampLead).toBeCloseTo(0.1, 9);
		expect(a.recorderStartCallDelay).toBeCloseTo(0.001, 9);
		expect(a.recorderStartEventDelay).toBeCloseTo(0.36, 9);
		expect(a.blobStart!.blobStartOffset).toBeCloseTo(0.366, 2);
		// 0.1 − 0.366: the grid would sit 0.266 s late, i.e. +0.334 modulo a 0.6 s beat.
		expect(a.gridError!.seconds).toBeCloseTo(-0.266, 2);
		expect(a.gridError!.modBeat).toBeCloseTo(0.334, 2);
	});

	it('still reports the clocks when the performance cannot pin an offset', () => {
		const timing = buildCaptureTiming({ arm, recorder: null, liveOnsets: [], liveReadings: [] });
		const a = describeCaptureAlignment(timing, replayContour(LICK, 0.3), REPLAY_WINDOW, 100);
		expect(a.blobStart).toBeNull();
		expect(a.gridError).toBeNull();
		expect(a.stampLead).toBeCloseTo(0.1, 9);
		expect(a.recorderStartEventDelay).toBeNull();
	});
});
