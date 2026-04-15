/**
 * Offline replay of a captured audio buffer through the same pitch +
 * onset pipeline used by the live path.
 *
 * Deterministic: same buffer in → same readings/onsets out, because
 * there is no rAF jitter and no AudioWorklet scheduling.
 *
 * Used by:
 *   - tests/integration/pitch-replay.test.ts (regression fixture)
 *   - post-hoc rescore in the record / practice / lick-practice flows
 *     (authoritative score is computed from the saved recording, not
 *     the noisy live readings)
 *   - /diagnostics "Pitch Replay" panel
 */

import {
	createOctaveStabilizer,
	detectFrame,
	type FrameOptions,
	type PitchReading
} from './pitch-frame.ts';
import {
	createOnsetState,
	processOnsetFrame
} from './onset-core.ts';

/** AudioWorklet render quantum — onsets are detected per 128-sample block */
const WORKLET_BLOCK_SIZE = 128;

export interface ReplayOptions {
	/** Samples between successive pitch frames (default: sampleRate / 60, matches live 60fps) */
	hopSize?: number;
	/** Window size for pitch detection (default: 4096 — matches AnalyserNode.fftSize) */
	fftSize?: number;
	clarityThreshold?: number;
	minFrequency?: number;
	maxFrequency?: number;
}

export interface ReplayResult {
	readings: PitchReading[];
	onsets: number[];
	duration: number;
	sampleRate: number;
}

type PitchyModule = typeof import('pitchy');

let pitchyModulePromise: Promise<PitchyModule> | null = null;

function loadPitchy(): Promise<PitchyModule> {
	if (!pitchyModulePromise) pitchyModulePromise = import('pitchy');
	return pitchyModulePromise;
}

/**
 * Minimal AudioBuffer-like contract used by the replay harness.
 * Real browsers supply a full AudioBuffer; tests pass a shim.
 */
interface AudioBufferLike {
	sampleRate: number;
	length: number;
	numberOfChannels: number;
	duration: number;
	getChannelData(channel: number): Float32Array;
}

/**
 * Replay through the detection pipeline.
 *
 * Deterministic: produces the same readings/onsets for the same input.
 * Time base starts at 0.
 */
export async function replayFromAudioBuffer(
	buffer: AudioBufferLike,
	opts: ReplayOptions = {}
): Promise<ReplayResult> {
	const Pitchy = await loadPitchy();

	const sampleRate = buffer.sampleRate;
	const channel = buffer.getChannelData(0);
	const totalSamples = channel.length;

	const fftSize = opts.fftSize ?? 4096;
	const hopSize = opts.hopSize ?? Math.max(1, Math.round(sampleRate / 60));

	const detector = Pitchy.PitchDetector.forFloat32Array(fftSize);
	const stabilizer = createOctaveStabilizer();

	const frameOpts: FrameOptions = {
		sampleRate,
		clarityThreshold: opts.clarityThreshold,
		minFrequency: opts.minFrequency,
		maxFrequency: opts.maxFrequency
	};

	// ─── Onsets ──────────────────────────────────
	// Computed first so the pitch loop can reset the octave stabilizer at
	// each note boundary (Phase 4b). Matches the worklet's 128-sample block
	// granularity so timestamps line up with the live path. Worklet
	// currentTime starts at the context's clock; in replay we start at 0.
	const onsetState = createOnsetState();
	const onsets: number[] = [];
	const block = new Float32Array(WORKLET_BLOCK_SIZE);

	for (let start = 0; start + WORKLET_BLOCK_SIZE <= totalSamples; start += WORKLET_BLOCK_SIZE) {
		for (let i = 0; i < WORKLET_BLOCK_SIZE; i++) block[i] = channel[start + i];
		const time = (start + WORKLET_BLOCK_SIZE) / sampleRate;
		const event = processOnsetFrame(block, onsetState, time);
		if (event) onsets.push(event.time);
	}

	// ─── Pitch readings ──────────────────────────
	// Reset the stabilizer when we cross an onset so each note warms up
	// independently; no cross-note octave leak.
	const readings: PitchReading[] = [];
	const window = new Float32Array(fftSize);
	let nextOnsetIdx = 0;

	for (let start = 0; start + fftSize <= totalSamples; start += hopSize) {
		const time = start / sampleRate;
		while (nextOnsetIdx < onsets.length && onsets[nextOnsetIdx] <= time) {
			stabilizer.reset();
			nextOnsetIdx++;
		}
		for (let i = 0; i < fftSize; i++) window[i] = channel[start + i];
		const { reading } = detectFrame(window, time, detector, stabilizer, frameOpts);
		if (reading) readings.push(reading);
	}

	return {
		readings,
		onsets,
		duration: buffer.duration,
		sampleRate
	};
}

/**
 * Decode a Blob (e.g. from MediaRecorder) and replay it.
 *
 * Requires a BaseAudioContext — either pass one explicitly (preferred:
 * reuse the shared AudioContext) or one will be constructed with the
 * platform default rate.
 */
export async function replayFromBlob(
	blob: Blob,
	audioCtx?: BaseAudioContext,
	opts?: ReplayOptions
): Promise<ReplayResult> {
	const ctx = audioCtx ?? new (globalThis.AudioContext ?? globalThis.OfflineAudioContext)();
	const arrayBuffer = await blob.arrayBuffer();
	const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
	return replayFromAudioBuffer(audioBuffer, opts);
}
