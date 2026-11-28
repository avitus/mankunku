import { describe, expect, it, vi } from 'vitest';
import type { LickPracticeSessionLogEntry } from '$lib/persistence/lick-practice-sessions';
import { flushLickReports, queueLickReportReset } from '$lib/persistence/lick-report-sync';

const state = vi.hoisted(() => ({
	uid: 'player', generation: 1, entries: [] as LickPracticeSessionLogEntry[],
	values: new Map<string, unknown>(), meta: vi.fn(), ids: new Set<string>()
}));
vi.mock('$lib/persistence/storage', () => ({
	load: (key: string) => state.values.get(key) ?? null,
	save: (key: string, value: unknown) => state.values.set(key, value),
	remove: (key: string) => state.values.delete(key)
}));
vi.mock('$lib/persistence/namespace', () => ({ getActiveUidOrNull: () => state.uid }));
vi.mock('$lib/persistence/user-scope', () => ({ getScopeGeneration: () => state.generation }));
vi.mock('$lib/persistence/lick-practice-sessions', async importActual => ({
	...await importActual<typeof import('$lib/persistence/lick-practice-sessions')>(),
	loadLickPracticeSessions: () => state.entries
}));
vi.mock('$lib/persistence/audio-store', () => ({
	getRecordingIds: async () => state.ids, getRecordingMetadata: (id: string) => state.meta(id)
}));
vi.mock('$lib/persistence/outbox', () => ({ enqueue: vi.fn() }));

function session(n: number, progressionType: 'blues' | 'minor-vamp' = 'blues'): LickPracticeSessionLogEntry {
	const take = n + '-' + progressionType;
	return { id: 'workout-' + n + '-' + progressionType, timestamp: n, progressionType, practiceMode: 'continuous',
		report: { totalAttempts: 1, totalPassed: 1, elapsedMinutes: 4, overallAverage: 1,
			licks: [{ lickId: take, lickName: 'Turn', tempo: 90, newTempo: null, averageScore: 1, passedCount: 1,
				keys: [{ key: 'C', passed: true, score: 1, pitchAccuracy: 1, rhythmAccuracy: 1, sessionId: take }] }] } };
}

describe('lick report sync', () => {
	it('backfills five workouts, combines Daily slices, retries failures and picks up a late recording', async () => {
		state.entries = [1,2,3,4,5,6].map(n => session(n)).concat(session(6, 'minor-vamp'));
		const upsert = vi.fn().mockResolvedValue({ error: null }).mockResolvedValueOnce({ error: new Error('offline') });
		const client = { from: () => ({ upsert }) } as never;
		await expect(flushLickReports(client)).rejects.toThrow('offline');
		await flushLickReports(client);
		const rows = upsert.mock.calls[1][0];
		expect(rows.map((r: { id: string }) => r.id)).toEqual(['workout-6','workout-5','workout-4','workout-3','workout-2']);
		expect(rows[0]).toMatchObject({ attempts: 2, minutes: 4, user_id: 'player' });
		await flushLickReports(client);
		expect(upsert).toHaveBeenCalledTimes(2);
		state.ids.add('6-blues');
		state.meta.mockResolvedValue({ source: 'lick-practice', key: 'C', tempo: 90, swing: 0.55,
			score: { noteResults: [{ extra: false, expected: { pitch: 72, offset: [0,1], duration: [1,4] } }] } });
		await flushLickReports(client);
		expect(upsert.mock.calls[2][0]).toHaveLength(1);
		expect(JSON.stringify(upsert.mock.calls[2][0])).toContain('"pitch":72');
		state.ids.clear();
		await flushLickReports(client);
		expect(upsert).toHaveBeenCalledTimes(3);
	});

	it('retries the original reset cutoff before resuming report uploads', async () => {
		state.entries = [];
		queueLickReportReset();
		const reset = state.values.get('lick-report-reset-at');
		const upsert = vi.fn().mockResolvedValueOnce({ error: new Error('offline') }).mockResolvedValue({ error: null });
		const from = vi.fn(() => ({ upsert }));
		const client = { from } as never;
		await expect(flushLickReports(client)).rejects.toThrow('offline');
		expect(state.values.get('lick-report-reset-at')).toBe(reset);
		await flushLickReports(client);
		expect(from).toHaveBeenLastCalledWith('lick_report_resets');
		expect(upsert).toHaveBeenLastCalledWith({ user_id: state.uid, reset_at: reset }, { onConflict: 'user_id' });
		expect(state.values.has('lick-report-reset-at')).toBe(false);
	});

	it('does not upload when the active account changes while a recording is being read', async () => {
		state.generation++;
		state.entries = [session(8)];
		state.ids.add('8-blues');
		state.meta.mockImplementationOnce(async () => { state.uid = 'other'; return null; });
		const from = vi.fn();
		await flushLickReports({ from } as never);
		expect(from).not.toHaveBeenCalled();
	});
});
