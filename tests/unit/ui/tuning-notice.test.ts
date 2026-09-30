import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import TuningNotice from '$lib/components/practice/TuningNotice.svelte';

describe('tuning notice', () => {
	it.each(['sharp', 'flat'] as const)('names the %s direction in a polite status region', direction => {
		const { body } = render(TuningNotice, { props: { alert: { direction, cents: direction === 'sharp' ? 22 : -22 } } });
		expect(body).toContain(`Consistently ${direction} · check your tuning`);
		expect(body).toContain('role="status"');
		expect(body).toContain('aria-atomic="true"');
		expect(body).not.toContain('role="alert"');
	});

	it('keeps an empty status slot when there is no reliable offset', () => {
		const { body } = render(TuningNotice, { props: { alert: null } });
		expect(body).toContain('role="status"');
		expect(body).toContain('h-6');
		expect(body).not.toContain('check your tuning');
	});
});
