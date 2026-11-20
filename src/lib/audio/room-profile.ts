import type { RoomFilter } from './room-filter';

// An incompatible filter or storage format gets a new key.
const key = 'mankunku.speaker-room-profile.v1';
type Output = Pick<AudioContext, 'sampleRate'> & { readonly sinkId?: string | { type: string } };

/** Default outputs can change without changing ID. Listen must still verify the acoustic path. */
export function roomSetup(track: Pick<MediaStreamTrack, 'getSettings' | 'label'>, context: Output): string {
	const settings = track.getSettings();
	return JSON.stringify([
		settings.deviceId, track.label, settings.channelCount,
		settings.sampleRate, context.sampleRate, context.sinkId ?? 'default'
	]);
}

/** Read a snapshot so an older measurement can defer to a newer calibration. */
export function readProfile(): string | null {
	try { return localStorage.getItem(key); } catch { return null; }
}

function encode(values: Float32Array): string {
	const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
	let binary = '';
	for (let i = 0; i < bytes.length; i += 4096) {
		binary += String.fromCharCode(...bytes.subarray(i, i + 4096));
	}
	return btoa(binary);
}

/** Save fitted taps or a completed negative measurement (e.g. headphones). No microphone PCM. */
export function saveProfile(previous: string | null, setup: string, filter: RoomFilter | null): boolean {
	try {
		if (localStorage.getItem(key) !== previous) return false;
		const record = filter
			? { setup, left: encode(filter.left), right: encode(filter.right) }
			: { setup, rejected: true };
		localStorage.setItem(key, JSON.stringify(record));
		return true;
	} catch { return false; }
}

/** Undefined means measure this setup. Null records a check that could not demonstrate bleed. */
export function restoreProfile(snapshot: string | null, setup: string, rate: number): RoomFilter | null | undefined {
	if (!snapshot || snapshot.length > 600_000) return undefined;
	try {
		const data = JSON.parse(snapshot);
		if (data.setup !== setup) return undefined;
		if (data.rejected === true) return null;
		if (typeof data.left !== 'string' || typeof data.right !== 'string' ||
			data.left.length !== data.right.length) return undefined;
		function decode(value: string): Float32Array<ArrayBuffer> {
			const bytes = Uint8Array.from(atob(value), character => character.charCodeAt(0));
			return new Float32Array(bytes.buffer);
		}
		const left = decode(data.left), right = decode(data.right);
		if (left.length < Math.round(rate * 0.12) || left.length > Math.ceil(rate * 0.53) ||
			right.length !== left.length || !left.every(Number.isFinite) || !right.every(Number.isFinite) ||
			!(left.some(Boolean) || right.some(Boolean))) return undefined;
		return { left, right };
	} catch { return undefined; }
}
