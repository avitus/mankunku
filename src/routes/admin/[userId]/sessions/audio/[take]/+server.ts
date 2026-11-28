import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin } from '$lib/server/admin-guard';
import { createAdminClient } from '$lib/supabase/admin';

export const GET: RequestHandler = async ({ locals, params }) => {
	await requireAdmin(locals);
	if (process.env.PLAYWRIGHT === '1' || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(params.userId)
		|| !/^[a-zA-Z0-9_-]+$/.test(params.take)) error(404);
	const { data, error: storageError } = await createAdminClient().storage.from('recordings')
		.createSignedUrl(params.userId + '/' + params.take + '.webm', 300);
	if (storageError || !data) error(404, 'Recording unavailable');
	return new Response(null, { status: 307, headers: { location: data.signedUrl, 'cache-control': 'private, no-store' } });
};
