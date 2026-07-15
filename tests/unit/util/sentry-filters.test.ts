import { describe, it, expect } from 'vitest';
import { isEmptyErrorEvent, isTransientDevReferenceError } from '$lib/util/sentry-filters';

describe('isEmptyErrorEvent', () => {
	it('flags an event with no message, no exception value, no frames, no originalException', () => {
		// The shape of Sentry MANKUNKU-K: "Error: undefined" with nothing usable.
		expect(isEmptyErrorEvent({ exception: { values: [{}] } }, undefined)).toBe(true);
		expect(isEmptyErrorEvent({}, {})).toBe(true);
	});

	it('keeps events that carry a top-level message', () => {
		expect(isEmptyErrorEvent({ message: 'boom' }, undefined)).toBe(false);
	});

	it('keeps events whose exception has a value', () => {
		expect(isEmptyErrorEvent({ exception: { values: [{ value: 'TypeError: x' }] } }, undefined)).toBe(
			false
		);
	});

	it('keeps events that have stack frames', () => {
		expect(
			isEmptyErrorEvent(
				{ exception: { values: [{ stacktrace: { frames: [{ filename: 'a.js' }] } }] } },
				undefined
			)
		).toBe(false);
	});

	it('keeps events that carry an originalException even if otherwise empty', () => {
		expect(isEmptyErrorEvent({ exception: { values: [{}] } }, { originalException: new Error() })).toBe(
			false
		);
	});

	it('treats blank/whitespace message and value as empty', () => {
		expect(isEmptyErrorEvent({ message: '   ', exception: { values: [{ value: '' }] } }, undefined)).toBe(
			true
		);
	});
});

describe('isTransientDevReferenceError', () => {
	it('flags "X is not defined" ReferenceErrors (MANKUNKU-W family HMR churn)', () => {
		expect(
			isTransientDevReferenceError({
				exception: { values: [{ type: 'ReferenceError', value: 'awaitHydration is not defined' }] }
			})
		).toBe(true);
	});

	it('ignores other ReferenceError messages', () => {
		expect(
			isTransientDevReferenceError({
				exception: { values: [{ type: 'ReferenceError', value: 'Cannot access before initialization' }] }
			})
		).toBe(false);
	});

	it('ignores non-ReferenceError types even with a matching message', () => {
		expect(
			isTransientDevReferenceError({
				exception: { values: [{ type: 'TypeError', value: 'foo is not defined' }] }
			})
		).toBe(false);
	});

	it('ignores events with no exception', () => {
		expect(isTransientDevReferenceError({})).toBe(false);
	});
});
