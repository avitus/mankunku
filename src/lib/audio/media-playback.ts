import { initAudio, getAudioContext, getReplayGain } from './audio-context';

const sources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();
const routed = new WeakSet<HTMLMediaElement>();
const pendingPlayback = new WeakMap<HTMLMediaElement, () => void>();
/** Route a media element through the same listening master, once per element. */
export async function connectMediaPlayback(element: HTMLMediaElement): Promise<void> {
	return routeMediaPlayback(element);
}

/** Prepare every route, including cached sources; an owner can cancel before allocation. */
async function routeMediaPlayback(element: HTMLMediaElement, prepare?: () => boolean): Promise<void> {
	await initAudio();
	const context = await getAudioContext();
	await context.resume();
	if (prepare && !prepare()) return;
	if (!sources.has(element)) {
		sources.set(element, context.createMediaElementSource(element));
	}
	if (!routed.has(element)) {
		sources.get(element)!.connect(getReplayGain());
		routed.add(element);
	}
}

/** Cancel pending Play even when routing has already paused the native element. */
export function pauseMediaPlayback(element: HTMLMediaElement): void {
	pendingPlayback.get(element)?.();
	element.pause();
}

/** Stop and detach a replay element so a completed take does not retain its graph. */
export function disconnectMediaPlayback(element: HTMLMediaElement): void {
	pauseMediaPlayback(element);
	sources.get(element)?.disconnect();
	routed.delete(element);
}

/** Native controls retain transport; silence the element until Master owns its output. */
export function mixAudio(element: HTMLMediaElement): { destroy(): void } {
	let destroyed = false;
	let connected = false;
	let pending = false;
	let wantsPlayback = false;
	let internalPauses = 0;
	const cancelPending = () => { wantsPlayback = false; };
	pendingPlayback.set(element, cancelPending);
	/** Ignore only pause events caused by this action's routing preparation. */
	const pauseForRouting = () => {
		if (!element.paused) internalPauses++;
		element.pause();
	};
	/** Retain a user Pause even when initialization has not finished. */
	const paused = () => {
		if (internalPauses > 0) internalPauses--;
		else wantsPlayback = false;
	};
	const initialVolume = element.volume;
	element.volume = 0;
	/** Attach or resume the shared output before native playback becomes audible. */
	const play = () => {
		if (element.paused) return; // A queued Play may already have been canceled.
		wantsPlayback = true;
		if (pending) return;
		if (connected) {
			void routeMediaPlayback(element, () => !destroyed)
				.catch(error => { pauseMediaPlayback(element); console.warn('Audio playback unavailable', error); });
			return;
		}
		pending = true;
		pauseForRouting();
		void routeMediaPlayback(element, () => {
			if (destroyed) return false;
			pauseForRouting();
			// Restore volume while paused, before the source owns the output.
			// Leave the element's native mute setting under the user's control.
			element.volume = initialVolume;
			return true;
		}).then(async () => {
			if (destroyed) return;
			connected = true;
			if (wantsPlayback) await element.play();
		}).catch(error => {
			pauseMediaPlayback(element);
			console.warn('Audio playback unavailable', error);
		}).finally(() => { pending = false; });
	};
	element.addEventListener('play', play);
	element.addEventListener('pause', paused);
	return {
		/** Cancel pending routing and release this element's audio connection. */
		destroy() {
			destroyed = true;
			element.removeEventListener('play', play);
			element.removeEventListener('pause', paused);
			disconnectMediaPlayback(element);
			if (!connected) element.volume = initialVolume;
			if (pendingPlayback.get(element) === cancelPending) pendingPlayback.delete(element);
		}
	};
}
