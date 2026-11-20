import { writable } from 'svelte/store';

const key = 'mankunku.speaker-room-correction.v1';
let temporaryPreference: boolean | undefined;
export const roomStatus = writable('');
/** Read the preference for this browser and its audio setup. */
export function roomCorrectionEnabled(): boolean {
	if (temporaryPreference !== undefined) return temporaryPreference;
	try {
		return localStorage.getItem(key) === 'on';
	} catch {
		return false;
	}
}
/** When storage is restricted, keep the switch usable for this page session. */
export function setRoomCorrection(enabled: boolean) {
	try {
		if (enabled) localStorage.setItem(key, 'on');
		else localStorage.removeItem(key);
		temporaryPreference = undefined;
	} catch {
		temporaryPreference = enabled;
	}
}

/** Route only the scorers connected to this exact capture through the room graph. */
export const roomInputs = new WeakMap<MediaStreamAudioSourceNode, AudioNode>();
export const roomChecks = new WeakMap<
	MediaStreamAudioSourceNode,
	(start: number, seconds: number) => void
>();
const cleanups = new WeakMap<MediaStreamAudioSourceNode, () => void>();
/** Bind teardown to the same microphone track and clock as calibration. */
export function ownRoomGraph(source: MediaStreamAudioSourceNode, dispose: () => void) {
	cleanups.set(source, dispose);
}
/** Stop measurements and detach the reference taps when the microphone closes. */
export function releaseRoomGraph(source: MediaStreamAudioSourceNode) {
	cleanups.get(source)?.();
	cleanups.delete(source);
	roomInputs.delete(source);
	roomChecks.delete(source);
	roomStatus.set('');
}
