/**
 * Microphone capture setup.
 *
 * Pipeline: getUserMedia → MediaStreamSource → AnalyserNode (for pitch)
 *                                            → AudioWorkletNode (for onset)
 *           NOT connected to destination (no feedback loop).
 */

import type { MicPermissionState } from '$lib/types/audio';
import { initAudio } from './audio-context';

export interface MicCapture {
	stream: MediaStream;
	source: MediaStreamAudioSourceNode;
	analyser: AnalyserNode;
	context: AudioContext;
}

let capture: MicCapture | null = null;

/**
 * Check current microphone permission without prompting.
 *
 * Only returns 'granted' if we're certain; defaults to 'prompt' otherwise.
 * The permissions.query API can report 'denied' even when the user hasn't
 * been prompted (e.g. macOS hasn't granted browser-level mic access yet),
 * so we treat that as 'prompt' and let the actual getUserMedia call
 * trigger the real permission flow.
 */
export async function checkMicPermission(): Promise<MicPermissionState> {
	if (!navigator.mediaDevices?.getUserMedia) return 'unavailable';

	try {
		const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
		return status.state === 'granted' ? 'granted' : 'prompt';
	} catch {
		// permissions.query not supported for mic in some browsers
		return 'prompt';
	}
}

/**
 * Request microphone access and set up the audio graph.
 * Returns the capture nodes needed for pitch and onset detection.
 */
export async function startMicCapture(): Promise<MicCapture> {
	if (capture) return capture;

	const audioCtx = await initAudio();

	const stream = await navigator.mediaDevices.getUserMedia({
		audio: {
			echoCancellation: false,
			noiseSuppression: false,
			autoGainControl: false
		}
	});

	const source = audioCtx.createMediaStreamSource(stream);

	// AnalyserNode for pitch detection (time-domain data)
	// Use factory method — Tone.js v15 returns a standardized-audio-context
	// wrapper, not a native AudioContext, so the AnalyserNode constructor rejects it.
	const analyser = audioCtx.createAnalyser();
	analyser.fftSize = 4096;
	analyser.smoothingTimeConstant = 0;

	source.connect(analyser);
	// Deliberately NOT connecting to destination — no feedback loop

	capture = { stream, source, analyser, context: audioCtx };
	return capture;
}

/**
 * Stop microphone capture and release resources.
 */
export function stopMicCapture(): void {
	if (!capture) return;

	capture.source.disconnect();
	for (const track of capture.stream.getTracks()) {
		track.stop();
	}
	capture = null;
}

/**
 * Get the current capture (null if not started).
 */
export function getMicCapture(): MicCapture | null {
	return capture;
}

/**
 * Read current input level (RMS) from the analyser. Returns 0-1.
 */
export function getInputLevel(): number {
	if (!capture) return 0;

	const buffer = new Float32Array(capture.analyser.fftSize);
	capture.analyser.getFloatTimeDomainData(buffer);

	let sum = 0;
	for (let i = 0; i < buffer.length; i++) {
		sum += buffer[i] * buffer[i];
	}
	const rms = Math.sqrt(sum / buffer.length);

	// Scale to roughly 0-1 (typical mic RMS is 0-0.3)
	return Math.min(1, rms * 4);
}
