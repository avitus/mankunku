import { version } from '$app/env';
import { summarizeSpeakerCheck } from './speaker-metrics';
import { getActiveUid, nsKey } from '$lib/persistence/namespace';
import type { RoomFilter, RoomSamples, RoomSession, RoomTimingCheck } from '$lib/audio/room-filter';
import { encodeRoomSamples } from '$lib/audio/room-profile';

export interface SpeakerCheck {
	monitorSession?: string;
	cueNumber?: number;
	graphLeadSeconds?: number;
	learnedCuesAtStart?: number;
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
	audioExample?: 'saved' | 'capture-off' | 'unavailable' | 'storage-full';
}

export interface SpeakerExample {
	event: SpeakerCheck;
	samples: RoomSamples;
	filter: RoomFilter;
	session?: RoomSession;
	captureUntil?: number;
}

/** A namespace wipe removes the shared marker, invalidating in-flight writers in every tab. */
const journalEpoch = new Map<string, number>();
export function speakerJournalScope(): { uid: string; current(): boolean } {
	const uid = getActiveUid();
	const key = 'mankunku:' + nsKey('speaker-journal-generation');
	let marker: string | null = null;
	try {
		marker = localStorage.getItem(key);
		if (!marker) {
			const value = crypto.randomUUID();
			localStorage.setItem(key, value);
			marker = value;
		}
	} catch { /* Private storage can still support IndexedDB in this realm. */ }
	const epoch = journalEpoch.get(uid);
	return { uid, current(): boolean {
		if (uid !== getActiveUid() || epoch !== journalEpoch.get(uid)) return false;
		try { return !marker || marker === localStorage.getItem(key); } catch { return !marker; }
	} };
}

export function speakerCaptureUntil(): number {
	try {
		const until = Number(localStorage.getItem('mankunku:' + nsKey('speaker-report-audio')));
		return until > Date.now() ? until : 0;
	} catch { return 0; }
}

/** A short, explicit capture session also works when practice opens in a new tab. */
export function startListenAudioCapture(): boolean {
	try {
		const key = 'mankunku:' + nsKey('speaker-report-audio');
		localStorage.setItem(key, String(Date.now() + 10 * 60_000));
		return speakerCaptureUntil() > 0;
	} catch { return false; }
}

export function stopListenAudioCapture(): boolean {
	try {
		const key = 'mankunku:' + nsKey('speaker-report-audio');
		localStorage.removeItem(key);
		return localStorage.getItem(key) === null;
	} catch { return false; }
}

function openChecks(uid = getActiveUid()): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open('mankunku-speaker-checks:' + uid, 1);
		request.onupgradeneeded = () => {
			request.result.createObjectStore('checks', { autoIncrement: true });
			request.result.createObjectStore('examples');
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

/** Best effort even if local storage is unavailable. The identifier belongs to this microphone session. */
function logSpeakerCheck(event: SpeakerCheck): void {
	if (typeof window === 'undefined') return;
	try {
		const session = event.monitorSession ?? crypto.randomUUID();
		const surface = window.location.pathname.split('/')[1];
		const metrics = summarizeSpeakerCheck(event, session, surface, version);
		if (metrics) void fetch('/api/speaker-check', {
			method: 'POST', credentials: 'omit', keepalive: true,
			headers: { 'content-type': 'application/json' }, body: JSON.stringify(metrics)
		}).catch(() => {});
	} catch { /* Offline or restricted browser. Keep the local journal available. */ }
}

/** Scoring never waits for diagnostic storage. All writes for one cue share a transaction. */
export async function recordSpeakerCheck(event: SpeakerCheck, example?: SpeakerExample, owner = speakerJournalScope()): Promise<void> {
	if (!owner.current()) return;
	logSpeakerCheck(event);
	try {
		const db = await openChecks(owner.uid);
		function write(clip: SpeakerExample | undefined, status: SpeakerCheck['audioExample'], captureWindow = 0): Promise<void> {
			if (!owner.current()) return Promise.resolve();
			return new Promise((resolve, reject) => {
				const tx = db.transaction(['checks', 'examples'], 'readwrite');
				tx.oncomplete = () => resolve();
				tx.onabort = () => reject(tx.error);
				const checks = tx.objectStore('checks');
				const examples = tx.objectStore('examples');
				// Wait for the store lock before rechecking capture consent. A clear
				// from another tab may have run while this transaction was queued.
				const keys = checks.getAllKeys();
				keys.onsuccess = () => {
					if (!owner.current()) return;
					const canSave = clip && captureWindow > Date.now() && captureWindow === speakerCaptureUntil();
					const finalStatus = clip && !canSave ? 'capture-off' : status;
					const row = finalStatus ? { ...event, audioExample: finalStatus } : event;
					const added = checks.add(row);
					if (canSave) added.onsuccess = () => examples.put({ ...clip, event: row }, added.result);
					for (const key of keys.result.slice(0, -63)) {
						checks.delete(key);
						examples.delete(key);
					}
				};
			});
		}
		try {
			const until = speakerCaptureUntil();
			const capturing = until > 0 && (example?.captureUntil === undefined || example.captureUntil === until);
			const clip = capturing ? example : undefined;
			const status = event.stage !== 'listen' ? undefined
				: clip ? 'saved' : capturing ? 'unavailable' : 'capture-off';
			try {
				await write(clip, status, until);
			} catch (error) {
				if (!clip || !(error instanceof DOMException) || error.name !== 'QuotaExceededError') throw error;
				await write(undefined, 'storage-full');
			}
		} finally { db.close(); }
	} catch (error) { console.warn('Could not save speaker diagnostics', error); }
}

/** Called by device/account erasure after the user's localStorage namespace has been cleared. */
export async function clearSpeakerJournal(uid: string): Promise<void> {
	journalEpoch.set(uid, (journalEpoch.get(uid) ?? 0) + 1);
	const db = await openChecks(uid);
	try {
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(['checks', 'examples'], 'readwrite');
			tx.oncomplete = () => resolve();
			tx.onabort = () => reject(tx.error);
			tx.objectStore('checks').clear();
			tx.objectStore('examples').clear();
		});
	} finally { db.close(); }
}

/** Inspect only the keys. Sample buffers stay off the diagnostics page until download. */
export async function speakerExampleCount(): Promise<number> {
	const db = await openChecks();
	try {
		return await new Promise<number>((resolve, reject) => {
			const request = db.transaction('examples').objectStore('examples').count();
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	} finally { db.close(); }
}

/** Release the retained Listen clips without deleting the numeric check history. */
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

export async function speakerReport({ includeAudio }: { includeAudio: boolean }): Promise<Blob> {
	const db = await openChecks();
	try {
		const tx = db.transaction(includeAudio ? ['checks', 'examples'] : ['checks']);
		const store = tx.objectStore('checks');
		const rows = store.getAll();
		const keys = store.getAllKeys();
		const parts: BlobPart[] = [];
		const included = new Set<IDBValidKey>();
		const legacy = new Set<string>();
		const legacyId = (e: SpeakerCheck) => JSON.stringify([e.at, e.phraseId, e.attempt, e.result]);
		await new Promise<void>((resolve, reject) => {
			tx.oncomplete = () => resolve();
			tx.onabort = () => reject(tx.error);
			if (!includeAudio) return;
			const request = tx.objectStore('examples').openCursor();
			request.onsuccess = () => {
				const cursor = request.result;
				if (!cursor) return;
				const { event, samples, filter, session } = cursor.value as SpeakerExample;
				if (typeof cursor.key === 'string') legacy.add(legacyId(event));
				else included.add(cursor.key);
				parts.push(new Blob([JSON.stringify({
					event, rate: samples.rate, mic: encodeRoomSamples(samples.mic),
					left: encodeRoomSamples(samples.left), right: encodeRoomSamples(samples.right),
					filter: { left: encodeRoomSamples(filter.left), right: encodeRoomSamples(filter.right) },
					...(session && { session: { cues: session.cues, correction: {
						left: encodeRoomSamples(session.correction.left), right: encodeRoomSamples(session.correction.right)
					} } })
				})]));
				cursor.continue();
			};
		});
		const checks = (rows.result as SpeakerCheck[]).map((event, index) => ({
			...event, ...(event.stage === 'listen' && { audioIncluded: included.has(keys.result[index]) || legacy.has(legacyId(event)) })
		}));
		const json: BlobPart[] = ['{"version":1,"sampleEncoding":"float32-le-base64","checks":', JSON.stringify(checks), ',"examples":['];
		for (const [index, part] of parts.entries()) {
			if (index > 0) json.push(',');
			json.push(part);
		}
		json.push(']}');
		return new Blob(json, { type: 'application/json' });
	} finally { db.close(); }
}
