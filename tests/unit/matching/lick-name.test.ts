import { describe, expect, it } from 'vitest';
import { availableLickName } from '$lib/matching/lick-name';

describe('suggested song titles', () => {
	it('keeps a unique artist and song without an unnecessary number', () => {
		expect(availableLickName('Art Pepper - Stardust', ['Art Pepper - Stardust 2'])).toBe('Art Pepper - Stardust');
	});
	it('adds the first available number, ignoring case and surrounding whitespace', () => {
		expect(availableLickName('Art Pepper - Stardust', [' art pepper - stardust ', 'Art Pepper - Stardust 2', 'Art Pepper - Stardust 4'])).toBe('Art Pepper - Stardust 3');
	});
});
