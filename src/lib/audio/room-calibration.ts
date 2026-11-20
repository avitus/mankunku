import type { MicCapture } from './capture';
import { getMasterGain, getNativeAudioContext } from './audio-context';
import { ownRoomGraph, roomChecks, roomInputs, roomStatus } from './room-scoring-state.svelte';
import type { RoomFilter, RoomTimingCheck } from './room-filter';
import { loadWorklet } from './load-worklet';
import { readProfile, restoreProfile, roomSetup, saveProfile } from './room-profile';

const duration = 5.6;
const active = 'Speaker bleed reduction active';
const fallback = 'Room check unavailable · scoring the original microphone';
const rejected = 'Room check did not pass · scoring the original microphone';

interface Measurement {
	reduction?: number;
	filter?: RoomFilter;
	check?: RoomTimingCheck | null;
}

/** Low-level, decorrelated stereo calibration noise, ramped at both ends. */
function probe(ctx: AudioContext): AudioBuffer {
	const buffer = ctx.createBuffer(2, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
	for (let channel = 0; channel < 2; channel++) {
		const samples = buffer.getChannelData(channel);
		let brown = 0;
		let seed = 0x67185 + channel;
		for (let i = 0; i < samples.length; i++) {
			seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
			const white = seed / 2147483648 - 1;
			brown = 0.976 * brown + 0.024 * white;
			const ramp = Math.min(
				1,
				i / (0.04 * ctx.sampleRate),
				(samples.length - i) / (0.04 * ctx.sampleRate)
			);
			samples[i] = ramp * (0.065 * white + 0.29 * brown);
		}
	}
	return buffer;
}

/** Collect both speakers and the microphone over one exact audio-clock interval. */
async function measure(
	ctx: AudioContext,
	mic: AudioNode,
	master: AudioNode,
	start: number,
	frames: number,
	deadline: number,
	signal: AbortSignal,
	filter?: RoomFilter
): Promise<Measurement> {
	signal.throwIfAborted();
	const capture = new AudioWorkletNode(ctx, 'room-calibration-capture', {
		numberOfInputs: 2,
		numberOfOutputs: 1,
		outputChannelCount: [1],
		processorOptions: { start, frames }
	});
	let worker: Worker | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let interrupt: (() => void) | undefined;
	try {
		mic.connect(capture, 0, 0);
		master.connect(capture, 0, 1);
		capture.connect(ctx.destination); // The worklet's output is silence.
		return await new Promise<Measurement>((resolve, reject) => {
			interrupt = () => reject(new Error('Room measurement interrupted'));
			signal.addEventListener('abort', interrupt, { once: true });
			timer = setTimeout(
				() => reject(new Error('Room measurement timed out')),
				Math.max(0, deadline - ctx.currentTime) * 1000
			);
			capture.onprocessorerror = () => reject(new Error('Room capture processor failed'));
			capture.port.onmessage = ({ data: [input, left, right] }) => {
				try {
					worker = new Worker(new URL('./room-calibration-worker.ts', import.meta.url), {
						type: 'module'
					});
					worker.onmessage = ({ data }) => resolve(data);
					worker.onerror = (event) =>
						reject(new Error(event.message || 'Room estimation worker failed'));
					worker.postMessage({ mic: input, left, right, rate: ctx.sampleRate, filter }, [
						input.buffer,
						left.buffer,
						right.buffer
					]);
				} catch (error) {
					reject(error);
				}
			};
		});
	} finally {
		clearTimeout(timer);
		if (interrupt) signal.removeEventListener('abort', interrupt);
		worker?.terminate();
		capture.port.close();
		capture.disconnect();
		try {
			mic.disconnect(capture);
		} catch {
			/* partially installed or disposed */
		}
		try {
			master.disconnect(capture);
		} catch {
			/* partially installed or disposed */
		}
	}
}

/** Fit once on a continuous mic clock. Practice audio can verify alignment but never retrain the taps. */
export async function calibrateRoom(
	capture: MicCapture,
	settingsCheck?: { force: boolean; signal: AbortSignal }
): Promise<'saved' | 'matched' | 'rejected' | 'unsaved' | undefined> {
	const { source, stream, analyser } = capture;
	const track = stream.getAudioTracks()[0];
	const ctx = await getNativeAudioContext();
	if (track.readyState !== 'live' || settingsCheck?.signal.aborted) return;
	const settings = track.getSettings();
	if (
		settings.autoGainControl ||
		settings.echoCancellation ||
		settings.noiseSuppression ||
		!ctx.audioWorklet ||
		ctx.sampleRate > 96000
	) {
		if (!settingsCheck) roomStatus.text = fallback;
		return;
	}
	const wrapped = getMasterGain() as GainNode & { _nativeAudioNode?: GainNode };
	const master = wrapped._nativeAudioNode ?? wrapped;
	// Speaker upmix duplicates a mono program into L and R. Use this exact
	// two-channel reference for both the worklet and the native convolvers.
	const reference = ctx.createGain();
	reference.channelCountMode = 'explicit';
	reference.channelCount = 2;
	reference.channelInterpretation = 'speakers';
	const micSource = ctx.createMediaStreamSource(stream);
	const mic = ctx.createGain();
	mic.channelCount = 1;
	mic.channelCountMode = 'explicit';
	micSource.connect(mic);
	const life = new AbortController();
	const nodes: AudioNode[] = [micSource, mic, reference];
	let listen: AbortController | undefined;
	let sound: AudioBufferSourceNode | undefined;
	let inverse: GainNode | undefined;
	let expiry: ReturnType<typeof setTimeout> | undefined;

	/** Mute the predicted echo immediately while preserving the microphone path. */
	function bypass(status: string): void {
		clearTimeout(expiry);
		if (inverse) inverse.gain.value = 0;
		if (!settingsCheck) roomStatus.text = status;
	}
	function invalidate(): void {
		life.abort();
		listen?.abort();
		bypass(fallback);
	}
	const stateChanged = (): void => {
		if (ctx.state !== 'running') invalidate();
	};
	const options = { signal: life.signal };
	settingsCheck?.signal.addEventListener('abort', invalidate, options);
	track.addEventListener('ended', invalidate, options);
	track.addEventListener('mute', invalidate, options);
	ctx.addEventListener('statechange', stateChanged, options);
	ctx.addEventListener('sinkchange', invalidate, options);
	navigator.mediaDevices.addEventListener('devicechange', invalidate, options);
	function dispose(): void {
		life.abort();
		listen?.abort();
		clearTimeout(expiry);
		sound?.disconnect();
		try {
			master.disconnect(reference);
		} catch {
			/* partially installed or already disposed */
		}
		for (const node of nodes) node.disconnect();
		capture.analyser = analyser;
	}
	if (!settingsCheck) ownRoomGraph(source, dispose);
	try {
		const setup = roomSetup(track, ctx);
		const snapshot = readProfile();
		const saved = settingsCheck?.force ? undefined : restoreProfile(snapshot, setup, ctx.sampleRate);
		if (saved === null) {
			bypass(rejected);
			return 'rejected';
		}
		if (settingsCheck && saved) return 'matched';
		if (!settingsCheck && !saved) roomStatus.text = 'Calibrating speakers · stay quiet for six seconds';
		await loadWorklet(ctx, new URL('./room-calibration-worklet.js', import.meta.url), life.signal);
		life.signal.throwIfAborted();
		master.connect(reference);
		let measured: Measurement | undefined;
		if (!saved) {
			const buffer = probe(ctx);
			sound = ctx.createBufferSource();
			sound.buffer = buffer;
			sound.connect(master);
			const start = Math.ceil((ctx.currentTime + 0.12) * ctx.sampleRate);
			sound.start(start / ctx.sampleRate);
			measured = await measure(ctx, mic, reference, start, buffer.length, ctx.currentTime + 15, life.signal);
			life.signal.throwIfAborted();
		}
		const filter = saved ?? measured?.filter;
		if (!filter) {
			// Only remember completed negative measurements; a worker failure is retryable.
			if (!Number.isFinite(measured?.reduction)) {
				bypass(fallback);
				return;
			}
			saveProfile(snapshot, setup, null);
			bypass(rejected);
			return 'rejected';
		}
		if (settingsCheck) return saveProfile(snapshot, setup, filter) ? 'saved' : 'unsaved';

		const output = ctx.createGain();
		output.channelCountMode = 'explicit';
		output.channelCount = 1;
		const splitter = ctx.createChannelSplitter(2);
		inverse = ctx.createGain();
		inverse.gain.value = 0;
		const delay = ctx.createDelay(1);
		const pitch = ctx.createAnalyser();
		pitch.fftSize = analyser.fftSize;
		pitch.smoothingTimeConstant = analyser.smoothingTimeConstant;
		nodes.push(output, splitter, inverse, delay, pitch);
		// Move the common leading silence to an adjustable delay, preserving both FIRs.
		const firstTap = filter.left.findIndex((value, i) => value !== 0 || filter.right[i] !== 0);
		if (firstTap < 0) {
			bypass(rejected);
			return;
		}
		delay.delayTime.value = firstTap / ctx.sampleRate;
		for (const [channel, taps] of [filter.left, filter.right].entries()) {
			const convolution = ctx.createConvolver();
			nodes.push(convolution);
			convolution.normalize = false;
			const impulse = ctx.createBuffer(1, taps.length - firstTap, ctx.sampleRate);
			impulse.copyToChannel(taps.subarray(firstTap), 0);
			convolution.buffer = impulse;
			splitter.connect(convolution, channel);
			convolution.connect(delay);
		}
		delay.connect(inverse);
		reference.connect(splitter);
		mic.connect(output);
		inverse.connect(output);
		output.connect(pitch);
		capture.analyser = pitch;
		roomInputs.set(source, output);

		function enable(gain: number): void {
			clearTimeout(expiry);
			inverse!.gain.value = -gain;
			roomStatus.text = active;
			expiry = setTimeout(() => bypass('Room check expired · scoring the original microphone'), 300_000);
		}
		if (!saved) {
			enable(1);
			saveProfile(snapshot, setup, filter);
		}

		async function verifyListen(startTime: number, seconds: number): Promise<void> {
			listen?.abort();
			if (life.signal.aborted || seconds < 1.8) return;
			const current = new AbortController();
			listen = current;
			const start = Math.ceil(Math.max(ctx.currentTime + 0.025, startTime + 0.04) * ctx.sampleRate);
			const deadline = startTime + seconds - 0.15;
			const frames = Math.floor(Math.min(3, deadline - start / ctx.sampleRate - 0.4) * ctx.sampleRate);
			if (frames < ctx.sampleRate) {
				bypass(rejected);
				return;
			}
			try {
				const { check } = await measure(
					ctx,
					mic,
					reference,
					start,
					frames,
					deadline,
					current.signal,
					filter
				);
				if (current.signal.aborted) return;
				if (ctx.currentTime >= deadline || !check?.accepted ||
					(saved && check.transientReduction < 1) || firstTap + check.offset < 0) {
					bypass(saved ? 'Saved speaker check did not pass · scoring the original microphone' : rejected);
					return;
				}
				delay.delayTime.value = (firstTap + check.offset) / ctx.sampleRate;
				enable(check.gain);
			} catch {
				if (!current.signal.aborted) bypass(fallback);
			}
		}
		roomChecks.set(source, { measure: verifyListen, cancel: () => listen?.abort() });
		if (saved) roomStatus.text = 'Checking saved speaker calibration during Listen';
	} catch (error) {
		if (!life.signal.aborted) {
			console.warn('Speaker room check unavailable', error);
			bypass(fallback);
		}
	} finally {
		sound?.disconnect();
		sound = undefined;
		if (settingsCheck || !roomInputs.has(source)) dispose();
	}
}
