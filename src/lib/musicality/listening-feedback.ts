import type { ListeningSnapshot } from './listening-player';
import type { ListeningTuneSession } from './listening-tunes';
import { getListeningReviewExtent } from './listening-review';
import { isMusicalityRelease, type MusicalityRelease } from './release';
import { PITCH_CLASSES, type PitchClass } from '$lib/types/music';
import type { BackingInstrument, BackingStyle } from '$lib/types/instruments';
import { DEFAULT_BACKING_MIX, type BackingMixLevels } from '$lib/audio/backing-mix';
import { nsKey, isAnonActive, markAnonSessionActive } from '$lib/persistence/namespace';

export type ListeningVerdict = 'promising' | 'needs-work' | 'unsure';
export interface ListeningMark { barIndex: number; elapsedBeats: number; note: string }
export interface ListeningFeedbackInput {
	playback: ListeningSnapshot;
	session: ListeningTuneSession;
	buildVersion: string;
	marks: ListeningMark[];
	note: string;
	verdict: ListeningVerdict;
}
/** A listener's impression, not a musical acceptance or reproducible score export. */
export interface ListeningFeedback {
	readonly version: 1;
	readonly id: string;
	readonly createdAt: string;
	readonly buildVersion: string;
	readonly musicalityRelease?: Readonly<MusicalityRelease>;
	readonly tune: { readonly id: string; readonly title: string };
	readonly settings: {
		readonly style: BackingStyle; readonly mode: 'original' | 'coordinated'; readonly tempo: number; readonly key: PitchClass; readonly soloChoruses: number;
		/** Absent together on early v1 summaries; never reconstruct missing historic settings. */
		readonly phraseId?: string; readonly swing?: number; readonly volume?: number;
		readonly mix?: Readonly<BackingMixLevels>; readonly ending?: 'continue' | 'hold-release'; readonly instrument?: BackingInstrument;
	};
	readonly completion: 'partial' | 'complete';
	readonly reachedBars: number;
	readonly totalBars: number;
	readonly marks: readonly Readonly<ListeningMark>[];
	readonly note: string;
	readonly verdict: ListeningVerdict;
}
export const LISTENING_FEEDBACK_STORAGE_KEY = 'mankunku:musicality-listening-feedback:v1';
/** Resolve at the storage boundary so a shared browser never exposes another account's feedback. */
export function listeningFeedbackStorageKey(): string {
	return `mankunku:${nsKey('musicality-listening-feedback:v1')}`;
}
const MAX_ARCHIVE_BYTES = 1_000_000;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max: number, empty = false): value is string => typeof value === 'string' && value.length <= max && (empty || value.trim().length > 0);
const integer = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const within = (value: unknown, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;
const capturedSettingNames = ['phraseId', 'swing', 'volume', 'mix', 'ending', 'instrument'];
const mixKeys = Object.keys(DEFAULT_BACKING_MIX) as (keyof BackingMixLevels)[];
function freeze<T>(value: T): T {
	if (value !== null && typeof value === 'object') {
		for (const child of Object.values(value)) freeze(child);
		Object.freeze(value);
	}
	return value;
}
function isFeedback(value: unknown): value is ListeningFeedback {
	if (!object(value) || value.version !== 1 || !text(value.id, 200) || !text(value.createdAt, 50) || !Number.isFinite(Date.parse(value.createdAt)) ||
		!text(value.buildVersion, 200) || (value.musicalityRelease !== undefined && !isMusicalityRelease(value.musicalityRelease)) ||
		!object(value.tune) || !text(value.tune.id, 200) || !text(value.tune.title, 500) || !object(value.settings) ||
		!['partial', 'complete'].includes(String(value.completion)) || !integer(value.totalBars, 1, 1024) || !integer(value.reachedBars, 1, value.totalBars) ||
		(value.completion === 'complete' && value.reachedBars !== value.totalBars) ||
		!['promising', 'needs-work', 'unsure'].includes(String(value.verdict)) || !text(value.note, 2000, true) ||
		!Array.isArray(value.marks) || value.marks.length > 50) return false;
	const settings = value.settings;
	if (!['swing', 'straight', 'bossa-nova', 'ballad'].includes(String(settings.style)) || !['original', 'coordinated'].includes(String(settings.mode)) ||
		typeof settings.tempo !== 'number' || !Number.isFinite(settings.tempo) || settings.tempo < 40 || settings.tempo > 240 ||
		!PITCH_CLASSES.includes(settings.key as PitchClass) || !integer(settings.soloChoruses, 1, 4)) return false;
	if (capturedSettingNames.some(key => settings[key] !== undefined) &&
		(!text(settings.phraseId, 500) || !within(settings.swing, 1) || !within(settings.volume, 1) ||
		!['continue', 'hold-release'].includes(String(settings.ending)) || !['piano', 'organ'].includes(String(settings.instrument)) ||
		!object(settings.mix) || mixKeys.some(key => !within((settings.mix as Record<string, unknown>)[key], 3)))) return false;
	const reachedBars = value.reachedBars;
	const totalBars = value.totalBars;
	return value.marks.every(mark => object(mark) && integer(mark.barIndex, 0, reachedBars - 1) && typeof mark.elapsedBeats === 'number' &&
		Number.isFinite(mark.elapsedBeats) && mark.elapsedBeats >= mark.barIndex * 4 && mark.elapsedBeats <= reachedBars * 4 &&
		(mark.elapsedBeats < (mark.barIndex + 1) * 4 || (mark.barIndex === totalBars - 1 && mark.elapsedBeats === totalBars * 4)) && text(mark.note, 500, true));
}

/** Save only a stopped/completed take, using its captured settings rather than editable controls. */
export function createListeningFeedback(input: ListeningFeedbackInput, options: { id?: string; createdAt?: string } = {}): ListeningFeedback {
	const { playback, session } = input;
	const extent = getListeningReviewExtent(playback, session.bars.length);
	const params = playback.params;
	if (!extent || !params || JSON.stringify(params.phrase) !== JSON.stringify(session.phrase) || playback.elapsedBeats <= 0 ||
		input.marks.some(mark => mark.elapsedBeats > playback.elapsedBeats)) {
		throw new Error('Stop a played take before saving feedback. Marks must belong to the reached part of this take.');
	}
	const complete = playback.status === 'completed';
	if (complete && (extent.barCount !== session.bars.length || playback.elapsedBeats !== playback.durationBeats)) {
		throw new Error('This take has not reached its complete performance.');
	}
	const record: ListeningFeedback = {
		version: 1, id: options.id ?? crypto.randomUUID(), createdAt: options.createdAt ?? new Date().toISOString(),
		buildVersion: input.buildVersion,
		...(playback.musicalityRelease !== undefined ? { musicalityRelease: { ...playback.musicalityRelease } } : {}),
		tune: { id: session.tune.id, title: session.tune.title },
		settings: { style: params.style, mode: params.orchestration ?? 'original', tempo: params.tempo, key: params.phrase.key, soloChoruses: session.soloChoruses,
			phraseId: params.phrase.id, swing: params.swing, volume: params.volume, ending: params.ending ?? 'continue', instrument: params.instrument,
			mix: Object.fromEntries(mixKeys.map(key => [key, params.mix[key]])) as unknown as BackingMixLevels },
		completion: complete ? 'complete' : 'partial', reachedBars: extent.barCount, totalBars: session.bars.length,
		marks: input.marks.map(({ barIndex, elapsedBeats, note }) => ({ barIndex, elapsedBeats, note })), note: input.note.trim(), verdict: input.verdict
	};
	if (!isFeedback(record)) throw new Error('Feedback is invalid or too long. Keep up to 50 marked moments and 2,000 note characters.');
	return freeze(record);
}

/** Historical summaries remain historical; never supply today's release to missing provenance. */
export function restoreListeningFeedback(json: string): ListeningFeedback | null {
	if (json.length > 50_000) return null;
	try { const value: unknown = JSON.parse(json); return isFeedback(value) ? freeze(value) : null; }
	catch { return null; }
}
export function serializeListeningFeedback(record: unknown): string {
	if (!isFeedback(record)) throw new Error('Only valid listening feedback can be exported.');
	return JSON.stringify(record, null, 2);
}
/** Storage exceptions deliberately reach the UI so it cannot announce a save that failed. */
export function readListeningFeedback(storage: Pick<Storage, 'getItem'>): ListeningFeedback[] {
	const raw = storage.getItem(listeningFeedbackStorageKey()) ?? '[]';
	if (raw.length > MAX_ARCHIVE_BYTES) throw new Error('Saved listening feedback exceeds the browser archive limit.');
	const values: unknown = JSON.parse(raw);
	if (!Array.isArray(values)) throw new Error('Saved listening feedback is not an archive.');
	const seen = new Set<string>();
	return values.slice(0, 20).flatMap(value => {
		if (!isFeedback(value) || seen.has(value.id)) return [];
		seen.add(value.id); return [freeze(value)];
	});
}
export function saveListeningFeedback(storage: Pick<Storage, 'getItem' | 'setItem'>, record: ListeningFeedback): ListeningFeedback[] {
	const captured = restoreListeningFeedback(serializeListeningFeedback(record));
	if (!captured) throw new Error('The listening feedback could not be saved.');
	const next = [captured, ...readListeningFeedback(storage).filter(item => item.id !== captured.id)].slice(0, 20);
	storage.setItem(listeningFeedbackStorageKey(), JSON.stringify(next));
	if (isAnonActive()) markAnonSessionActive();
	return next;
}
