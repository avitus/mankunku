import { initAudio, getAudioContext, getReplayGain } from './audio-context';

const sources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();
const routed = new WeakSet<HTMLMediaElement>();
/** Route a media element through the same listening master, once per element. */
export async function connectMediaPlayback(element: HTMLMediaElement): Promise<void> {
	return routeMediaPlayback(element);
}

/** Pause through the owner's callback so initialization cannot erase user intent. */
async function routeMediaPlayback(element: HTMLMediaElement, beforeSource?: () => void): Promise<void> {
	await initAudio();
	const context = await getAudioContext();
	await context.resume();
	if (!sources.has(element)) {
		beforeSource?.();
		sources.set(element, context.createMediaElementSource(element));
	}
	if (!routed.has(element)) {
		sources.get(element)!.connect(getReplayGain());
		routed.add(element);
	}
}

/** Stop and detach a replay element so a completed take does not retain its graph. */
export function disconnectMediaPlayback(element: HTMLMediaElement): void {
	element.pause();
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
		wantsPlayback = true;
		if (pending) return;
		if (connected) {
			void connectMediaPlayback(element).then(() => {
				if (destroyed) disconnectMediaPlayback(element);
			}).catch(error => { element.pause(); console.warn('Audio playback unavailable', error); });
			return;
		}
		pending = true;
		pauseForRouting();
		void routeMediaPlayback(element, () => {
			pauseForRouting();
			// Restore volume while paused, before the source owns the output.
			// Leave the element's native mute setting under the user's control.
			element.volume = initialVolume;
		}).then(async () => {
			if (destroyed) {
				disconnectMediaPlayback(element);
				return;
			}
			connected = true;
			if (wantsPlayback) await element.play();
		}).catch(error => {
			element.pause();
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
		}
	};
}
