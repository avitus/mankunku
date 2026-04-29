import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Browsers (and some bots/dev tools) request /favicon.ico unconditionally,
 * even when the document declares `<link rel="icon">` pointing elsewhere.
 * Without this handler the request 404s — noisy in the dev terminal and
 * Sentry. Redirect to the SVG icon we ship in /static.
 */
export const GET: RequestHandler = () => {
	redirect(307, '/favicon.svg');
};
