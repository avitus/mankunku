import { describe, it, expect } from 'vitest';
import { isAuthVerificationUnavailable } from '$lib/supabase/auth-errors';

describe('isAuthVerificationUnavailable', () => {
	it('returns false for absent errors', () => {
		expect(isAuthVerificationUnavailable(null)).toBe(false);
		expect(isAuthVerificationUnavailable(undefined)).toBe(false);
	});

	it('returns false for non-object errors', () => {
		expect(isAuthVerificationUnavailable('network down')).toBe(false);
		expect(isAuthVerificationUnavailable(503)).toBe(false);
	});

	it('recognizes AuthRetryableFetchError by name (network / 5xx wrapper)', () => {
		expect(
			isAuthVerificationUnavailable({ name: 'AuthRetryableFetchError', status: 0 })
		).toBe(true);
		// Name alone suffices — auth-js sometimes omits status on fetch rejections.
		expect(isAuthVerificationUnavailable({ name: 'AuthRetryableFetchError' })).toBe(true);
	});

	it('recognizes AuthUnknownError by name (transport / parse failure)', () => {
		expect(isAuthVerificationUnavailable({ name: 'AuthUnknownError' })).toBe(true);
	});

	it('recognizes raw fetch TypeErrors', () => {
		expect(isAuthVerificationUnavailable(new TypeError('fetch failed'))).toBe(true);
	});

	it('recognizes verdict-free statuses: 0 and 5xx', () => {
		expect(isAuthVerificationUnavailable({ name: 'AuthApiError', status: 0 })).toBe(true);
		expect(isAuthVerificationUnavailable({ name: 'AuthApiError', status: 500 })).toBe(true);
		expect(isAuthVerificationUnavailable({ name: 'AuthApiError', status: 503 })).toBe(true);
	});

	it('treats 429 rate limiting as verdict-free (auth-js wraps only 502/503/504 as retryable)', () => {
		// After an outage every returning client refreshes at once; the
		// overflow gets AuthApiError(429), which says "busy", not "bad token".
		// Misreading it as a sign-out verdict wipes localStorage — the
		// incident class this module exists to prevent.
		expect(
			isAuthVerificationUnavailable({
				name: 'AuthApiError',
				status: 429,
				code: 'over_request_rate_limit'
			})
		).toBe(true);
	});

	it('treats 408 request timeout as verdict-free', () => {
		expect(isAuthVerificationUnavailable({ name: 'AuthApiError', status: 408 })).toBe(true);
	});

	it('treats 4xx auth rejections as a real verdict (NOT unavailable)', () => {
		expect(isAuthVerificationUnavailable({ name: 'AuthApiError', status: 401 })).toBe(false);
		expect(isAuthVerificationUnavailable({ name: 'AuthApiError', status: 403 })).toBe(false);
		expect(
			isAuthVerificationUnavailable({ name: 'AuthApiError', status: 400, message: 'bad JWT' })
		).toBe(false);
	});

	it('treats signal-free error objects as a real verdict', () => {
		// e.g. the plain `{ message: 'JWT expired' }` shape older mocks use.
		expect(isAuthVerificationUnavailable({ message: 'JWT expired' })).toBe(false);
	});
});
