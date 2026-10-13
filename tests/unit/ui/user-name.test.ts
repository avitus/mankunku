import { describe, expect, it } from 'vitest';
import { accountLabel, greetingName } from '../../../src/lib/ui/user-name';

describe('greetingName', () => {
	it('greets by the display name over the email (2026-10-13: the home page said "Avitus")', () => {
		expect(greetingName('Andy Vitus', 'avitus@gmail.com')).toBe('Andy');
	});

	it('keeps a one-word display name as written', () => {
		expect(greetingName('  dizzy ', 'jbg@example.com')).toBe('dizzy');
	});

	it('falls back to the email local part when the display name is unset or blank', () => {
		expect(greetingName(null, 'john.coltrane42@example.com')).toBe('John');
		expect(greetingName('   ', 'avitus@gmail.com')).toBe('Avitus');
		expect(greetingName(undefined, 'avitus@gmail.com')).toBe('Avitus');
	});

	it('is empty with neither', () => {
		expect(greetingName(null, null)).toBe('');
	});
});

describe('accountLabel', () => {
	it('shows the full display name', () => {
		expect(accountLabel('Andy Vitus', 'avitus@gmail.com')).toBe('Andy Vitus');
	});

	it('falls back to the email local part, then "Account"', () => {
		expect(accountLabel('', 'avitus@gmail.com')).toBe('avitus');
		expect(accountLabel(null, '@example.com')).toBe('Account');
		expect(accountLabel(null, null)).toBe('Account');
	});
});
