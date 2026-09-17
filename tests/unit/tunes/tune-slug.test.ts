import { describe, it, expect } from 'vitest';
import type { Tune } from '$lib/types/tune';
import { resolveTuneRef, tunePath, tunePracticePath, tuneSlug } from '$lib/tunes/tune-slug';
import { transposeTune } from '$lib/tunes/book-loader';
import { sheet } from '../../helpers/tune-fixtures';

const t = (id: string, title: string): Tune => sheet({ id, title });

describe('tuneSlug', () => {
	it('is the kebab-cased title', () => {
		expect(tuneSlug(t('sheet-1789579191100-55iq', 'Autumn Leaves'), [])).toBe('autumn-leaves');
	});

	it('folds punctuation and accents the way a URL wants', () => {
		expect(tuneSlug(t('a', "'Round Midnight"), [])).toBe('round-midnight');
		expect(tuneSlug(t('b', 'Bésame Mucho'), [])).toBe('besame-mucho');
		expect(tuneSlug(t('c', "Take the 'A' Train  "), [])).toBe('take-the-a-train');
	});

	it('falls back to the id when the title leaves nothing sluggable', () => {
		expect(tuneSlug(t('sheet-1-abcd', '枯葉'), [])).toBe('sheet-1-abcd');
	});

	it('disambiguates duplicate titles by creation order, earliest keeps the bare slug', () => {
		const older = t('sheet-1784830742610-apys', 'Autumn Leaves');
		const newer = t('sheet-1789579191100-55iq', 'Autumn Leaves');
		const book = [newer, older];
		expect(tuneSlug(older, book)).toBe('autumn-leaves');
		expect(tuneSlug(newer, book)).toBe('autumn-leaves-2');
	});

	it('gives a curated tune precedence over a user tune of the same title', () => {
		const curated = sheet({ id: 'ls-amazing-grace', title: 'Amazing Grace', source: 'curated' });
		const mine = t('sheet-1789579191100-55iq', 'Amazing Grace');
		expect(tuneSlug(mine, [mine, curated])).toBe('amazing-grace-2');
		expect(tuneSlug(curated, [mine, curated])).toBe('amazing-grace');
	});

	it('never carries a transposed copy’s suffixed id into the path', () => {
		const base = t('sheet-1789579191100-55iq', 'Autumn Leaves');
		const transposed = transposeTune(base, 'Eb');
		expect(transposed.id).toBe('sheet-1789579191100-55iq_Eb');
		expect(tunePath(base, [base])).toBe('/tunes/autumn-leaves');
		expect(tunePracticePath(base, [base])).toBe('/tunes/autumn-leaves/practice');
	});
});

describe('resolveTuneRef', () => {
	const older = t('sheet-1784830742610-apys', 'Autumn Leaves');
	const newer = t('sheet-1789579191100-55iq', 'Autumn Leaves');
	const book = [newer, older];

	it('resolves an id first — old URLs and bookmarks keep working', () => {
		expect(resolveTuneRef('sheet-1789579191100-55iq', book)).toBe(newer);
	});

	it('resolves a slug, disambiguated the same way it was minted', () => {
		expect(resolveTuneRef('autumn-leaves', book)).toBe(older);
		expect(resolveTuneRef('autumn-leaves-2', book)).toBe(newer);
	});

	it('returns undefined for an unknown ref', () => {
		expect(resolveTuneRef('giant-steps', book)).toBeUndefined();
		expect(resolveTuneRef('', book)).toBeUndefined();
	});
});
