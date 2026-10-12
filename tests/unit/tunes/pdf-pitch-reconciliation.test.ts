import { describe, expect, it } from 'vitest';
import {
	reconcilePitchReview,
	retainDisputedAccidentals
} from '$lib/tunes/import/pdf-pitch-reconciliation';
import type { RecognizedBar } from '$lib/tunes/import/pdf-recognition';

const original: RecognizedBar = {
	startRepeat: true,
	endRepeat: false,
	ending: 1,
	pickup: false,
	melody: [
		[0, 1.5, 'E5'],
		[1.5, 0.5, 'C#5'],
		[2, 2, 'A4', true]
	]
};
const candidate: RecognizedBar = {
	...original,
	startRepeat: false,
	ending: null,
	melody: [
		[0, 1.5, 'B4'],
		[1.5, 0.5, 'F#4'],
		[2, 2, 'E4']
	]
};
const evidence = { count: 3, letters: ['B4', 'E4', 'E4'] };

describe('independent pitch reconciliation', () => {
	it.each([
		['C5', 'Cb5'],
		['C#5', 'C5']
	])('retains %s when the reviewer instead reads %s', (before, after) => {
		const first: RecognizedBar = {
			...original,
			melody: [
				[0, 2, before, true],
				[2, 2, 'A4']
			]
		};
		const second: RecognizedBar = {
			...candidate,
			melody: [
				[0, 2, after, true],
				[2, 2, 'B4']
			]
		};
		expect(retainDisputedAccidentals(first, second).melody).toEqual([
			[0, 2, before, true],
			[2, 2, 'B4']
		]);
		expect(second.melody[0][2]).toBe(after);
	});
	it('aligns pitches across harmless decimal rounding in full-notation readings', () => {
		const before = {
			...original,
			melody: [
				[0, 2 / 3, 'C5'],
				[2 / 3, 2 / 3, 'D5']
			]
		} as RecognizedBar;
		const after = {
			...candidate,
			melody: [
				[0, 0.6667, 'E4'],
				[0.6667, 0.6666, 'F#4']
			]
		} as RecognizedBar;
		expect(reconcilePitchReview(before, after, { count: 2, letters: ['E4', 'F4'] }).melody).toEqual(
			[
				[0, 2 / 3, 'E4'],
				[2 / 3, 2 / 3, 'F#4']
			]
		);
	});
	it('retains disputed accidentals when corroborated notation changes timing', () => {
		const before = {
			...original,
			melody: [
				[0, 3, 'C5'],
				[3, 1, 'C5']
			]
		} as RecognizedBar;
		const after = {
			...candidate,
			melody: [
				[0, 2, 'Cb5'],
				[2, 2, 'Cb5']
			]
		} as RecognizedBar;
		expect(retainDisputedAccidentals(before, after).melody).toEqual([
			[0, 2, 'C5'],
			[2, 2, 'C5']
		]);
	});
	it('keeps useful corrections, original ties and form without mutating either reading', () => {
		const before = structuredClone(original);
		const after = structuredClone(candidate);
		expect(reconcilePitchReview(original, candidate, evidence)).toEqual({
			...original,
			melody: [
				[0, 1.5, 'B4'],
				[1.5, 0.5, 'C#5'],
				[2, 2, 'E4', true]
			]
		});
		expect(original).toEqual(before);
		expect(candidate).toEqual(after);
	});
	it.each([
		null,
		undefined,
		{ count: 2, letters: ['B4', 'E4'] },
		{ count: 3, letters: [] },
		{ count: 3, letters: ['B4', '', 'E4'] },
		{ count: 3, letters: ['B4', 'E4', 'E4', 'A4'] }
	])('declines incomplete or unaligned evidence: %j', (heads) => {
		expect(reconcilePitchReview(original, candidate, heads)).toBe(original);
	});
	it.each([
		[
			[0, 1, 'B4'],
			[1, 1, 'F#4'],
			[2, 2, 'E4']
		],
		[
			[0, 1.5, 'B4'],
			[1.5, 0.5, 'rest'],
			[2, 2, 'E4']
		],
		[
			[0, 2, 'B4'],
			[2, 2, 'E4']
		]
	] as RecognizedBar['melody'][])(
		'declines changed timing or note/rest alignment: %j',
		(...melody) => {
			expect(reconcilePitchReview(original, { ...candidate, melody }, evidence)).toBe(original);
		}
	);
	it('aligns noteheads past rests without altering the rests', () => {
		const before = {
			...original,
			melody: [
				[0, 1, 'rest'],
				[1, 3, 'A4', true]
			]
		} as RecognizedBar;
		const after = {
			...candidate,
			melody: [
				[0, 1, 'rest'],
				[1, 3, 'E4']
			]
		} as RecognizedBar;
		expect(reconcilePitchReview(before, after, { count: 1, letters: ['E4'] }).melody).toEqual([
			[0, 1, 'rest'],
			[1, 3, 'E4', true]
		]);
	});
});
