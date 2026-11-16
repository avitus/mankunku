/**
 * Capture separate scoring and playback audio. Microphone PCM goes to the
 * scorer; MediaRecorder preserves the microphone + master listening mix.
 */

import { createScoringCapture, type ScoringCapture } from './scoring-capture';
import type { RecorderTiming } from './capture-timing';

/** Attenuate raw mic signal (~-8 dB) so it balances with the metronome/playback mix. */
const MIC_RECORDING_GAIN = 0.4;

export interface RecordedAudio {
	/** Microphone plus master output, for listening. */
	blob: Blob;
	/** Microphone only, aligned to start(contextTime); null on capture failure. */
	scoringBlob: Blob | null;
}

export interface RecorderHandle {
	/** Begin this single-use take. Create a fresh handle for another take. */
	start(contextTime?: number): void;
	/** Stop both captures and return the playback mix and microphone scoring WAV. */
	stop(): Promise<RecordedAudio>;
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

	let scoring: ScoringCapture | null = null;
	try { scoring = createScoringCapture(micSource, audioCtx); }
	catch (error) { console.warn('Microphone scoring capture unavailable:', error); }
	let mediaRecorder: MediaRecorder | null = null;
	let chunks: Blob[] = [];
	let disposed = false;
	let hasStarted = false;
	let timing: RecorderTiming | null = null;
	let stopping: Promise<RecordedAudio> | null = null;
	const now = () => ({ contextTime: audioCtx.currentTime, performanceNowMs: performance.now() });

	return {
		start(contextTime = audioCtx.currentTime) {
			if (disposed) return;
			if (hasStarted) throw new Error('Recorder handles are single-use. Create a new recorder for each take.');
			hasStarted = true;
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
			scoring?.start(contextTime);
			recorder.start();
		},

		stop(): Promise<RecordedAudio> {
			if (stopping) return stopping;
			const recorder = mediaRecorder;
			if (!recorder) return Promise.resolve({ blob: new Blob([], { type: 'audio/webm' }), scoringBlob: null });
			const scoringAudio = scoring?.stop(audioCtx.currentTime) ?? Promise.resolve(null);
			const playbackAudio = new Promise<Blob>((resolve) => {
				if (recorder.state === 'inactive') {
					resolve(new Blob([], { type: 'audio/webm' }));
					return;
				}
				recorder.onstop = () => {
					const blob = new Blob(chunks, { type: recorder.mimeType });
					chunks = [];
					mediaRecorder = null;
					resolve(blob);
				};
				recorder.stop();
			});
			// stopAll can arrive while a completed window is still saving. Share
			// the pending stop rather than replacing the recorder's callback.
			stopping = Promise.all([playbackAudio, scoringAudio])
				.then(([blob, scoringBlob]) => ({ blob, scoringBlob }))
				.finally(() => { stopping = null; });
			return stopping;
		},

		timing() {
			return timing;
		},

		dispose() {
			if (disposed) return;
			disposed = true;
			scoring?.dispose();
			try { micSource.disconnect(micGain); } catch { /* already disconnected */ }
			try { micGain.disconnect(dest); } catch { /* already disconnected */ }
			try { masterGain.disconnect(dest); } catch { /* already disconnected */ }
		}
	};
}
