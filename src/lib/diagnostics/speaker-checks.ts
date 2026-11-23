import { getActiveUid, nsKey } from '$lib/persistence/namespace';
import type { RoomFilter, RoomSamples, RoomTimingCheck } from '$lib/audio/room-filter';
import { encodeRoomSamples } from '$lib/audio/room-profile';

export interface SpeakerCheck {
	at: string;
	stage: 'sound-check' | 'listen' | 'practice';
	result: string;
	rate: number;
	phraseId?: string;
	listenSeconds?: number;
	startSeconds?: number;
	captureSeconds?: number;
	attempt?: number;
	calibratedDelaySamples?: number;
	calibrationReductionDb?: number;
	check?: RoomTimingCheck | null;
}

export interface SpeakerExample {
	event: SpeakerCheck;
	samples: RoomSamples;
	filter: RoomFilter;
}

// Keep the opt-in local to this tab and account. Raw Listen audio is optional.
export function includeListenAudio(enabled?: boolean): boolean {
	try {
		const key = 'mankunku:' + nsKey('speaker-report-audio');
		if (enabled !== undefined) sessionStorage.setItem(key, String(enabled));
		return sessionStorage.getItem(key) === 'true';
	} catch { return false; }
}

function openChecks(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open('mankunku-speaker-checks:' + getActiveUid(), 1);
		request.onupgradeneeded = () => {
			request.result.createObjectStore('checks', { autoIncrement: true });
			request.result.createObjectStore('examples');
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

/** Scoring never waits for diagnostic storage. All writes for one cue share a transaction. */
export async function recordSpeakerCheck(event: SpeakerCheck, example?: SpeakerExample): Promise<void> {
	try {
		const db = await openChecks();
		try {
			await new Promise<void>((resolve, reject) => {
				const tx = db.transaction(['checks', 'examples'], 'readwrite');
				tx.oncomplete = () => resolve();
				tx.onabort = () => reject(tx.error);
				const checks = tx.objectStore('checks');
				checks.add(event);
				const keys = checks.getAllKeys();
				keys.onsuccess = () => {
					for (const key of keys.result.slice(0, -64)) checks.delete(key);
				};
				if (example && includeListenAudio()) {
					tx.objectStore('examples').put(example, event.result === 'active' ? 'active' : 'bypassed');
				}
			});
		} finally { db.close(); }
	} catch (error) { console.warn('Could not save speaker diagnostics', error); }
}

/** Release the two retained Listen clips without deleting the numeric check history. */
export async function clearSpeakerExamples(): Promise<void> {
	const db = await openChecks();
	try {
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction('examples', 'readwrite');
			tx.oncomplete = () => resolve();
			tx.onabort = () => reject(tx.error);
			tx.objectStore('examples').clear();
		});
	} finally { db.close(); }
}

export async function speakerReport(): Promise<Blob> {
	const db = await openChecks();
	try {
		const tx = db.transaction(['checks', 'examples']);
		function all<T>(store: string): Promise<T[]> {
			return new Promise((resolve, reject) => {
				const request = tx.objectStore(store).getAll();
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
		}
		const [checks, examples] = await Promise.all([all<SpeakerCheck>('checks'), all<SpeakerExample>('examples')]);
		const audio = examples.map(({ event, samples, filter }) => ({
			event, rate: samples.rate, mic: encodeRoomSamples(samples.mic),
			left: encodeRoomSamples(samples.left), right: encodeRoomSamples(samples.right),
			filter: { left: encodeRoomSamples(filter.left), right: encodeRoomSamples(filter.right) }
		}));
		return new Blob([JSON.stringify({ version: 1, checks, sampleEncoding: 'float32-le-base64', examples: audio })],
			{ type: 'application/json' });
	} finally { db.close(); }
}
