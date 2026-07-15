import { describe, it, expect } from 'vitest';
import { isEmptyErrorEvent } from '$lib/util/sentry-filters';

describe('isEmptyErrorEvent', () => {
	it('flags an event with no message, no exception value, no frames, no originalException', () => {
		expect(isEmptyErrorEvent({ exception: { values: [{}] } }, undefined)).toBe(true);
		expect(isEmptyErrorEvent({}, {})).toBe(true);
	});

	it('drops the MANKUNKU-K shape: a bare exception type with no value or frames', () => {
		// "Error: undefined" is type "Error" with an empty value. A non-blank TYPE
		// must NOT count as content — nearly every exception event has a type, so
		// counting it would neuter the filter and resurface MANKUNKU-K.
		expect(isEmptyErrorEvent({ exception: { values: [{ type: 'Error' }] } }, undefined)).toBe(true);
	});

	it('keeps events that carry a top-level message', () => {
		expect(isEmptyErrorEvent({ message: 'boom' }, undefined)).toBe(false);
	});

	it('keeps events whose exception has a value', () => {
		expect(isEmptyErrorEvent({ exception: { values: [{ value: 'TypeError: x' }] } }, undefined)).toBe(
			false
		);
	});

	it('keeps events with content in a LATER chained exception value', () => {
		// Scan every exception.values entry, not just the first.
		expect(isEmptyErrorEvent({ exception: { values: [{}, { value: 'root cause' }] } }, undefined)).toBe(
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
