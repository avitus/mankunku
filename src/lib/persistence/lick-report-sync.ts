import type { SupabaseClient } from '@supabase/supabase-js';
import type { Phrase } from '$lib/types/music';
import type { Database, Json } from '$lib/supabase/types';
import { load, save, remove } from './storage';
import { getActiveUidOrNull } from './namespace';
import { getScopeGeneration } from './user-scope';
import { getRecordingIds, getRecordingMetadata } from './audio-store';
import { enqueue } from './outbox';
import { baseSessionId, loadLickPracticeSessions, type LickPracticeSessionLogEntry } from './lick-practice-sessions';

const SYNCED = 'synced-lick-report-revisions';
const RESET_AT = 'lick-report-reset-at';
type Revision = { signature: string; recordings: string[] };
type RecentWorkouts = Map<string, LickPracticeSessionLogEntry[]>;
type TakeReference = Pick<Phrase, 'notes' | 'timeSignature'> & { tempo: number; swing: number };
// A long workout appends one key at a time. Keep only its small reference lines
// across drains so each append doesn't reread every previous recording's PCM.
let cacheOwner = '';
const references = new Map<string, TakeReference | null>();

export function queueLickReportReset(): void {
	if (!getActiveUidOrNull()) return;
	save(RESET_AT, Date.now());
	remove(SYNCED);
	enqueue('lickReports');
}

/** The log can have several progression entries for a single Daily Practice workout. */
export function recentLickWorkouts(entries: LickPracticeSessionLogEntry[]): RecentWorkouts {
	const sessions = new Map<string, LickPracticeSessionLogEntry[]>();
	for (const entry of [...entries].sort((a, b) => b.timestamp - a.timestamp || b.id.localeCompare(a.id))) {
		const id = baseSessionId(entry);
		const session = sessions.get(id);
		if (session) session.push(entry);
		else if (sessions.size < 5) sessions.set(id, [entry]);
	}
	return sessions;
}

export function queueHistoricalLickReports(): void {
	if (getActiveUidOrNull() && !load(SYNCED) && loadLickPracticeSessions().length) enqueue('lickReports');
}

/** Only changed workouts cross the network. Revisions belong to this device and account. */
export async function flushLickReports(client: SupabaseClient<Database>): Promise<void> {
	const userId = getActiveUidOrNull();
	if (!userId) return;
	const generation = getScopeGeneration();
	const previous = load<Record<string, Revision>>(SYNCED) ?? {};
	const next: Record<string, Revision> = Object.create(null);
	const sameAccount = () => getScopeGeneration() === generation && getActiveUidOrNull() === userId;
	// Serialize reset with uploads in the same outbox worker. Retrying a reset
	// must preserve workouts begun on another device after the reset.
	const reset = load<number>(RESET_AT);
	if (reset !== null) {
		const { error } = await client.from('lick_report_resets')
			.upsert({ user_id: userId, reset_at: reset }, { onConflict: 'user_id' });
		if (error) throw error;
		if (!sameAccount() || load(RESET_AT) !== reset) return;
		remove(RESET_AT);
	}
	const workouts = recentLickWorkouts(loadLickPracticeSessions());
	if (!workouts.size) return;
	const recordings = await getRecordingIds().catch(() => new Set<string>());
	if (!sameAccount()) return;
	const owner = userId + '/' + generation;
	if (cacheOwner !== owner) references.clear();
	cacheOwner = owner;
	for (const id of references.keys()) if (!recordings.has(id)) references.delete(id);
	const rows: Database['public']['Tables']['lick_session_reports']['Insert'][] = [];
	for (const [id, entries] of workouts) {
		const licks = entries.flatMap(e => e.report.licks);
		const row = {
			user_id: userId, id, timestamp: entries[0].timestamp,
			attempts: entries.reduce((n, e) => n + e.report.totalAttempts, 0),
			minutes: Math.max(0, ...entries.map(e => e.report.elapsedMinutes ?? 0)),
			licks
		};
		const linked = licks.flatMap(l => l.keys.flatMap(k => k.sessionId && recordings.has(k.sessionId) ? [k.sessionId] : []));
		const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(row)));
		const signature = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
		const last = previous[id];
		// Evicting a local recording must not overwrite a complete uploaded report.
		if (last?.signature === signature && linked.every(take => last.recordings.includes(take))) {
			next[id] = last;
			continue;
		}
		next[id] = { signature, recordings: linked };
		const detailed = [];
		for (const lick of licks) {
			const keys = [];
			for (const key of lick.keys) {
				if (!sameAccount()) return;
				const take = key.sessionId;
				if (take && recordings.has(take) && !references.has(take)) {
					const ref = await readReference(take, key.key);
					if (!sameAccount()) return;
					references.set(take, ref);
				}
				const reference = take && references.get(take);
				keys.push(reference ? { ...key, reference } : key);
			}
			detailed.push({ ...lick, keys });
		}
		rows.push({ ...row, licks: JSON.parse(JSON.stringify(detailed)) as Json });
	}
	if (!sameAccount()) return;
	if (rows.length) {
		const { error } = await client.from('lick_session_reports').upsert(rows, { onConflict: 'user_id,id' });
		if (error) throw error;
	}
	if (sameAccount()) save(SYNCED, next);
}

/** Older recordings retain the scorer's target notes even when the original chart is gone. */
async function readReference(id: string, key: string): Promise<TakeReference | null> {
	const meta = await getRecordingMetadata(id);
	if (!meta || meta.source !== 'lick-practice' || meta.key !== key) return null;
	// A fluency score can use a placeholder realization for a trick. Only the
	// saved demonstration is a reliable reference for those historical takes.
	const scoredNotes = meta.score && !('conformance' in meta.score)
		? meta.score.noteResults.filter(result => !result.extra).map(result => result.expected) : null;
	const notes = meta.reference?.notes ?? scoredNotes;
	if (!notes?.length) return null;
	return { notes, timeSignature: meta.reference?.timeSignature ?? [4, 4], tempo: meta.tempo, swing: meta.swing };
}
