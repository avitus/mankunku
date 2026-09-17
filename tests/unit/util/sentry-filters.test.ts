import { describe, it, expect } from 'vitest';
import {
	isAnthropicContentFilterBlock,
	isEmptyErrorEvent,
	isLocalHostname,
	isLocalRequestEvent
} from '$lib/util/sentry-filters';

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

describe('isLocalHostname', () => {
	it('names the loopback hosts a preview or test server listens on', () => {
		expect(isLocalHostname('localhost')).toBe(true);
		expect(isLocalHostname('127.0.0.1')).toBe(true);
		expect(isLocalHostname('[::1]')).toBe(true);
	});

	it('does not name a public host, even one that starts with "localhost"', () => {
		expect(isLocalHostname('mankunkujazz.com')).toBe(false);
		expect(isLocalHostname('localhost.mankunkujazz.com')).toBe(false);
	});
});

describe('isLocalRequestEvent (MANKUNKU-1V)', () => {
	it('flags an event about a request to a local server, IPv6 included', () => {
		expect(isLocalRequestEvent({ request: { url: 'http://localhost:4174/api/tune-parse' } })).toBe(true);
		expect(isLocalRequestEvent({ request: { url: 'http://[::1]:4173/' } })).toBe(true);
	});

	it('keeps an event about a request to the public site, or with no usable URL', () => {
		expect(isLocalRequestEvent({ request: { url: 'https://mankunkujazz.com/api/tune-parse' } })).toBe(false);
		expect(isLocalRequestEvent({ request: { url: 'not a url' } })).toBe(false);
		expect(isLocalRequestEvent({})).toBe(false);
	});
});

describe('isAnthropicContentFilterBlock (MANKUNKU-1V)', () => {
	const blocked =
		'{"type":"error","error":{"details":null,"type":"invalid_request_error","message":"Output blocked by content filtering policy"},"request_id":"req_011Cf88o1ARLHcqks5nKvbWU"}';

	it('flags the content-filter block the Anthropic integration captured from a stream', () => {
		expect(
			isAnthropicContentFilterBlock({
				exception: { values: [{ value: blocked, mechanism: { type: 'auto.ai.anthropic.stream_error' } }] }
			})
		).toBe(true);
	});

	it('keeps every other Anthropic API error — a bad key or no credit is an outage', () => {
		const badKey =
			'{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}';
		expect(
			isAnthropicContentFilterBlock({
				exception: { values: [{ value: badKey, mechanism: { type: 'auto.ai.anthropic' } }] }
			})
		).toBe(false);
	});

	it('keeps the same text when it did not come from the Anthropic integration', () => {
		expect(
			isAnthropicContentFilterBlock({
				exception: { values: [{ value: blocked, mechanism: { type: 'generic' } }] }
			})
		).toBe(false);
	});
});
