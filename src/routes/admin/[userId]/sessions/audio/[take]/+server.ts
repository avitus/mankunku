import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin } from '$lib/server/admin-guard';
import { createAdminClient } from '$lib/supabase/admin';

export const GET: RequestHandler = async ({ locals, params }) => {
	await requireAdmin(locals);
	if (process.env.PLAYWRIGHT === '1' || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(params.userId)
		|| !/^[a-zA-Z0-9_-]+$/.test(params.take)) error(404);
	const admin = createAdminClient();
	const { data: eligible, error: lookupError } = await admin.rpc('admin_review_recording_allowed', {
		p_user_id: params.userId, p_take: params.take
	});
	if (lookupError) error(503, 'Session review is temporarily unavailable');
	if (!eligible) error(404, 'Recording unavailable');
	const { data, error: storageError } = await admin.storage.from('recordings')
		.createSignedUrl(params.userId + '/' + params.take + '.webm', 300);
	if (storageError || !data) error(404, 'Recording unavailable');
	return new Response(null, { status: 307, headers: { location: data.signedUrl, 'cache-control': 'private, no-store' } });
};
