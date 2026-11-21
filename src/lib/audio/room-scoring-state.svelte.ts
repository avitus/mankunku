const key = 'mankunku.speaker-room-correction.v1';
let temporaryPreference: boolean | undefined;
export const roomStatus = $state({ text: '' });
/** Explicit browser preference. Backing enables correction by default. */
export function roomPreference(): boolean | undefined {
	if (temporaryPreference !== undefined) return temporaryPreference;
	try {
		const stored = localStorage.getItem(key);
		return stored === null ? undefined : stored === 'on';
	} catch { return undefined; }
}
export function roomCorrectionEnabled(backing = false): boolean {
	return roomPreference() ?? backing;
}
/** When storage is restricted, keep the switch usable for this page session. */
export function setRoomCorrection(enabled: boolean): void {
	try {
		localStorage.setItem(key, enabled ? 'on' : 'off');
		temporaryPreference = undefined;
	} catch {
		temporaryPreference = enabled;
	}
}

/** Route only the scorers connected to this exact capture through the room graph. */
export const roomInputs = new WeakMap<MediaStreamAudioSourceNode, AudioNode>();
export const roomChecks = new WeakMap<
	MediaStreamAudioSourceNode,
	{ measure: (start: number, seconds: number) => Promise<void>; cancel: () => void }
>();
const cleanups = new WeakMap<MediaStreamAudioSourceNode, () => void>();
/** Bind teardown to the same microphone track and clock as calibration. */
export function ownRoomGraph(source: MediaStreamAudioSourceNode, dispose: () => void): void {
	cleanups.set(source, dispose);
}
/** Stop measurements and detach the reference taps when the microphone closes. */
export function releaseRoomGraph(source: MediaStreamAudioSourceNode): void {
	cleanups.get(source)?.();
	cleanups.delete(source);
	roomInputs.delete(source);
	roomChecks.delete(source);
	roomStatus.text = '';
}
