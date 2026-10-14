import type { Database } from '$lib/supabase/types';
import type { Phrase } from '$lib/types/music';
import { validateAdoptedPhrase } from '$lib/phrases/adopted-phrase-validator';
import type { createAdminClient } from '$lib/supabase/admin';
import { selectAllRows } from './select-all';

type AdminClient = ReturnType<typeof createAdminClient>;
export type AdminAction = Database['public']['Tables']['admin_actions']['Row'];
export interface AdminContent {
	licks: { id: string; name: string; adoptionCount: number; phrase: Phrase | null; errors: string[] }[];
	tunes: { id: string; title: string; adoptionCount: number }[];
	affectedUsers: number;
}

/** Inspect one user's content and every adoption; fail closed if any query fails. */
export async function getAdminContent(admin: AdminClient, userId: string): Promise<AdminContent> {
	const [licks, tunes, lickAdoptions, tuneAdoptions] = await Promise.all([
		selectAllRows((from, to) => admin.from('user_licks').select('*').eq('user_id', userId).is('deleted_at', null).order('id').range(from, to)),
		selectAllRows((from, to) => admin.from('tunes').select('id, title').eq('user_id', userId).is('deleted_at', null).order('id').range(from, to)),
		selectAllRows((from, to) => admin.from('lick_adoptions').select('user_id, lick_id, user_licks!inner(user_id)').eq('user_licks.user_id', userId).order('lick_id').order('user_id').range(from, to)),
		selectAllRows((from, to) => admin.from('tune_adoptions').select('user_id, tune_id, tunes!inner(user_id)').eq('tunes.user_id', userId).order('tune_id').order('user_id').range(from, to))
	]);
	const others = [...lickAdoptions, ...tuneAdoptions].filter(a => a.user_id !== userId);
	return {
		affectedUsers: new Set(others.map(a => a.user_id)).size,
		licks: licks.map(row => {
			// Validate before notation/audio sees externally entered data. Malformed
			// licks remain inspectable and removable without trying to render them.
			const candidate = {
				id: row.id, name: row.name, key: row.key, timeSignature: row.time_signature,
				notes: row.notes, harmony: row.harmony, difficulty: row.difficulty,
				category: row.category, tags: row.tags ?? [], source: row.source,
				...(row.mode ? { mode: row.mode } : {})
			};
			const validation = validateAdoptedPhrase(candidate);
			return { id: row.id, name: row.name, adoptionCount: lickAdoptions.filter(a => a.lick_id === row.id && a.user_id !== userId).length,
				phrase: validation.valid ? candidate as unknown as Phrase : null, errors: validation.errors };
		}),
		tunes: tunes.map(t => ({ ...t, adoptionCount: tuneAdoptions.filter(a => a.tune_id === t.id && a.user_id !== userId).length }))
	};
}
