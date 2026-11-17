import { initAudio, getAudioContext, getReplayGain } from './audio-context';

const sources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();
const routed = new WeakSet<HTMLMediaElement>();
/** Route a media element through the same listening master, once per element. */
export async function connectMediaPlayback(element: HTMLMediaElement, initialMuted?: boolean): Promise<void> {
	await initAudio();
	const context = await getAudioContext();
	await context.resume();
	if (!sources.has(element)) {
		// Restore the native mute state while paused, before creating the source.
		// WebKit can otherwise retain a silent media source after initialization.
		if (initialMuted !== undefined) {
			element.pause();
			element.muted = initialMuted;
		}
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

/** Native controls retain transport; mute the element until Master owns its output. */
export function mixAudio(element: HTMLMediaElement): { destroy(): void } {
	let destroyed = false;
	let connected = false;
	let pending = false;
	const initiallyMuted = element.muted;
	element.muted = true;
	/** Attach or resume the shared output before native playback becomes audible. */
	const play = () => {
		if (pending) return;
		if (connected) {
			void connectMediaPlayback(element).then(() => {
				if (destroyed) disconnectMediaPlayback(element);
			}).catch(error => { element.pause(); console.warn('Audio playback unavailable', error); });
			return;
		}
		pending = true;
		element.pause();
		void connectMediaPlayback(element, initiallyMuted).then(async () => {
			if (destroyed) {
				disconnectMediaPlayback(element);
				return;
			}
			connected = true;
			await element.play();
		}).catch(error => {
			element.pause();
			console.warn('Audio playback unavailable', error);
		}).finally(() => { pending = false; });
	};
	element.addEventListener('play', play);
	return {
		/** Cancel pending routing and release this element's audio connection. */
		destroy() {
			destroyed = true;
			element.removeEventListener('play', play);
			disconnectMediaPlayback(element);
		}
	};
}
