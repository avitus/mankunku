import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { createAdminClient } from '$lib/supabase/admin';
import { requireAdmin } from '$lib/server/admin-guard';
import { earSession, lickSession } from '$lib/server/admin-sessions';
import { isInstrumentId } from '$lib/types/instruments';
import { melodySwingForStyle } from '$lib/audio/backing-styles';
import type { BackingStyle } from '$lib/types/instruments';

export const load: PageServerLoad = async ({ locals, params, setHeaders, cookies }) => {
	await requireAdmin(locals);
	setHeaders({ 'cache-control': 'private, no-store' });
	const id = params.userId;
	if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id)) error(404);
	if (process.env.PLAYWRIGHT === '1') {
		const { adminTestSessions } = await import('$lib/server/admin-test-fixture');
		if (cookies.get('e2e-admin-fixture') !== '1') error(503);
		return adminTestSessions(id) ?? error(404);
	}
	const admin = createAdminClient();
	const [account, settings, ear, lick] = await Promise.all([
		admin.auth.admin.getUserById(id),
		admin.from('user_settings').select('instrument_id, swing, backing_style').eq('user_id', id).maybeSingle(),
		admin.from('session_results').select('*').eq('user_id', id).or('source.is.null,source.eq.ear-training')
			.order('timestamp', { ascending: false }).order('id', { ascending: false }).limit(5),
		admin.from('lick_session_reports').select('*').eq('user_id', id)
			.order('timestamp', { ascending: false }).order('id', { ascending: false }).limit(5)
	]);
	if (account.error?.status === 404) error(404);
	if (account.error || ear.error || lick.error || settings.error) error(503, 'Session review is temporarily unavailable.');
	const instrument = settings.data?.instrument_id;
	return { userId: id, name: account.data.user.email ?? id, instrument: instrument && isInstrumentId(instrument) ? instrument : null,
		swing: melodySwingForStyle(settings.data?.swing ?? 0.62, (settings.data?.backing_style ?? 'swing') as BackingStyle),
		ear: ear.data.map(earSession), lick: lick.data.map(lickSession) };
};
