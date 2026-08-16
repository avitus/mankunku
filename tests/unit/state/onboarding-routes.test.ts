import { describe, it, expect } from 'vitest';
import { isOnboardingRoute } from '$lib/state/onboarding-routes';

/**
 * Table-driven pins for the onboarding overlay's route gate. The negatives
 * are the point: every browsable/indexable URL must render clean for a fresh
 * profile (crawlers render with empty localStorage), and the prefix
 * boundaries are one character away from regressing — `'/licks'` as a prefix
 * would blanket the licks book in the overlay for every first-time visitor,
 * the exact incident the gate exists to prevent.
 */
describe('isOnboardingRoute', () => {
	it.each([
		'/ear-training',
		'/ear-training/',
		'/lick-practice',
		'/tricks',
		'/tricks/enclosures',
		'/licks/record',
		'/tunes/abc123/practice',
		'/tunes/abc123/practice/'
	])('mic-driven practice surface %s triggers onboarding', (path) => {
		expect(isOnboardingRoute(path)).toBe(true);
	});

	it.each([
		'/',
		'/docs',
		'/docs/getting-started',
		'/licks',
		'/licks/community',
		'/licks/editor',
		'/licks/some-lick-id',
		'/tunes',
		'/tunes/abc123',
		'/tunes/community',
		'/tunes/add',
		'/scales',
		'/settings',
		'/progress',
		'/auth'
	])('browsable surface %s renders clean', (path) => {
		expect(isOnboardingRoute(path)).toBe(false);
	});
});
