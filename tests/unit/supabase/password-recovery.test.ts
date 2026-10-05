import { describe, it, expect } from 'vitest';
import {
	RESET_PASSWORD_PATH,
	classifyRecoveryFailure,
	parseRecoveryProblem,
	passwordRecoveryRedirect
} from '$lib/supabase/password-recovery';

describe('passwordRecoveryRedirect', () => {
	it('sends the emailed link through the code-exchanging callback with the recovery marker', () => {
		// Not /auth: that page exchanges no codes, and its signed-in guard
		// dropped the code on the way to '/' — the original broken flow.
		expect(passwordRecoveryRedirect('https://mankunkujazz.com')).toBe(
			'https://mankunkujazz.com/auth/callback?type=recovery'
		);
	});

	it('lands sessions on the reset page under /auth/ (robots.txt disallows /auth/)', () => {
		expect(RESET_PASSWORD_PATH).toBe('/auth/reset-password');
	});
});

describe('classifyRecoveryFailure', () => {
	it.each([
		['otp_expired', 'expired'],
		['flow_state_expired', 'expired'],
		['flow_state_not_found', 'expired'],
		['pkce_code_verifier_not_found', 'other-browser'],
		['bad_code_verifier', 'invalid'],
		[null, 'invalid'],
		[undefined, 'invalid']
	] as const)('%s → %s', (code, problem) => {
		expect(classifyRecoveryFailure(code)).toBe(problem);
	});
});

describe('parseRecoveryProblem', () => {
	it.each(['expired', 'other-browser', 'invalid'] as const)('accepts %s', (value) => {
		expect(parseRecoveryProblem(value)).toBe(value);
	});

	it.each([null, '', 'ready', 'EXPIRED', '<b>hi</b>'])('rejects %s', (value) => {
		expect(parseRecoveryProblem(value)).toBeNull();
	});
});
