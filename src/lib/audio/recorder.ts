/**
 * Mix microphone input + master audio output into a single recording.
 * Captures the user's playing along with the metronome click via
 * MediaStreamDestination + MediaRecorder.
 */

import type { RecorderTiming } from './capture-timing';

/** Attenuate raw mic signal (~-8 dB) so it balances with the metronome/playback mix. */
const MIC_RECORDING_GAIN = 0.4;

export interface RecorderHandle {
	/** Begin capturing audio. */
	start(): void;
	/** Stop capturing and return the recorded audio as a Blob. */
	stop(): Promise<Blob>;
	/** Disconnect recording nodes from the audio graph. Safe to call multiple times. */
	dispose(): void;
	/**
	 * When the latest `start()` ran and when the recorder's own `start` event
	 * fired, on the audio and page clocks — diagnostic evidence for where the
	 * recording's first sample sits (capture-timing.ts). Null before `start()`.
	 */
	timing(): RecorderTiming | null;
}

/**
 * Preferred MIME type for recording. WebM/Opus on Chrome/Firefox,
 * MP4/AAC on Safari. Falls back to browser default.
 */
function preferredMimeType(): string {
	if (typeof MediaRecorder === 'undefined') return '';
	if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
	if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4';
	return '';
}

/**
 * Create a recorder that mixes the mic input and master gain (metronome)
 * into a single audio stream.
 *
 * Both sources are connected to a MediaStreamDestinationNode via fan-out —
 * existing connections (mic→analyser, masterGain→speakers) are unaffected.
 */
export function createRecorder(
	micSource: MediaStreamAudioSourceNode,
	masterGain: GainNode,
	audioCtx: AudioContext
): RecorderHandle {
	const dest = audioCtx.createMediaStreamDestination();
	const micGain = audioCtx.createGain();
	micGain.gain.value = MIC_RECORDING_GAIN;
	micSource.connect(micGain);
	micGain.connect(dest);
	masterGain.connect(dest);

	let mediaRecorder: MediaRecorder | null = null;
	let chunks: Blob[] = [];
	let disposed = false;
	let timing: RecorderTiming | null = null;
	const now = () => ({ contextTime: audioCtx.currentTime, performanceNowMs: performance.now() });

	return {
		start() {
			if (disposed) return;
			chunks = [];
			const mimeType = preferredMimeType();
			const recorder = new MediaRecorder(
				dest.stream,
				mimeType ? { mimeType } : undefined
			);
			mediaRecorder = recorder;
			recorder.ondataavailable = (e) => {
				if (e.data.size > 0) chunks.push(e.data);
			};
			const started: RecorderTiming = {
				mimeType: recorder.mimeType || mimeType,
				startCall: now(),
				startEvent: null
			};
			timing = started;
			recorder.onstart = () => {
				started.startEvent = now();
			};
			recorder.start();
		},

		stop(): Promise<Blob> {
			return new Promise((resolve) => {
				if (!mediaRecorder || mediaRecorder.state === 'inactive') {
					resolve(new Blob([], { type: 'audio/webm' }));
					return;
				}
				mediaRecorder.onstop = () => {
					const blob = new Blob(chunks, { type: mediaRecorder!.mimeType });
					chunks = [];
					mediaRecorder = null;
					resolve(blob);
				};
				mediaRecorder.stop();
			});
		},

		timing() {
			return timing;
		},

		dispose() {
			if (disposed) return;
			disposed = true;
			try { micSource.disconnect(micGain); } catch { /* already disconnected */ }
			try { micGain.disconnect(dest); } catch { /* already disconnected */ }
			try { masterGain.disconnect(dest); } catch { /* already disconnected */ }
		}
	};
}
