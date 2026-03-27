import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * POST /auth/logout — Signs the user out and redirects to the auth page.
 *
 * This endpoint is intentionally POST-only to prevent CSRF attacks — GET-based
 * logout could be triggered by prefetch, <img>, or <link> tags. The form in
 * +layout.svelte submits a POST request here via <form method="POST" action="/auth/logout">.
 *
 * The Supabase server client on event.locals (set by hooks.server.ts) handles
 * cookie clearing automatically via the @supabase/ssr setAll cookie handler
 * when signOut() is called — no manual cookie manipulation is needed.
 */
export const POST: RequestHandler = async ({ locals: { supabase } }) => {
	await supabase.auth.signOut();
	redirect(303, '/auth');
};
