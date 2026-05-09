/**
 * Tests for /api/chat — the docs assistant endpoint.
 *
 * The full streaming path requires a live Anthropic SDK, so we don't try to
 * test it here.  But the validation gate (request size cap, message length,
 * malformed JSON, missing key) is pure logic that runs unconditionally before
 * any SDK call — and a bug there is either a 500-error leak or, worse, a cost
 * runaway.  All of these paths surface SvelteKit's `error()` helper which
 * throws an `HttpError`-shaped object; we assert the status from the thrown
 * value.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestHandler } from '@sveltejs/kit';

interface HttpError {
	status: number;
	body?: { message?: string };
}

function isHttpError(e: unknown): e is HttpError {
	return typeof e === 'object' && e !== null && 'status' in e;
}

interface CallOpts {
	configured?: boolean;
	contentLength?: string;
}

async function importHandler(configured: boolean): Promise<typeof import('../../../src/routes/api/chat/+server')> {
	vi.resetModules();
	vi.doMock('$lib/docs/context', () => ({
		getDocContext: vi.fn(async () => ''),
		getPageContext: vi.fn(async () => '')
	}));
	vi.doMock('$lib/server/anthropic', () => ({
		getAnthropicClient: vi.fn(() => (configured ? { messages: { stream: vi.fn() } } : null)),
		isAnthropicConfigured: vi.fn(() => configured),
		ANTHROPIC_MODEL: 'claude-sonnet-4-6',
		ANTHROPIC_MAX_TOKENS: 1024
	}));
	return await import('../../../src/routes/api/chat/+server');
}

async function callPost(
	body: BodyInit,
	opts: CallOpts = {}
): Promise<{ status: number; res?: Response; err?: HttpError }> {
	const configured = opts.configured ?? true;
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (opts.contentLength) headers['content-length'] = opts.contentLength;
	const request = new Request('http://localhost/api/chat', {
		method: 'POST',
		headers,
		body
	});
	const event = {
		request,
		getClientAddress: () => '127.0.0.1',
		locals: {
			safeGetSession: async () => ({ user: null, session: null })
		}
	} as unknown as Parameters<RequestHandler>[0];
	const { POST } = await importHandler(configured);
	try {
		const res = await POST(event);
		return { status: res.status, res };
	} catch (e) {
		if (isHttpError(e)) return { status: e.status, err: e };
		throw e;
	}
}

beforeEach(() => {
	vi.restoreAllMocks();
});

describe('POST /api/chat — service availability gate', () => {
	it('returns 503 when ANTHROPIC_API_KEY is not configured', async () => {
		const { status } = await callPost(JSON.stringify({ message: 'hi' }), {
			configured: false
		});
		expect(status).toBe(503);
	});
});

describe('POST /api/chat — request size cap', () => {
	it('rejects requests with declared content-length above 32_000', async () => {
		const { status } = await callPost(JSON.stringify({ message: 'x' }), {
			contentLength: '40000'
		});
		expect(status).toBe(413);
	});
});

describe('POST /api/chat — body validation', () => {
	it('rejects malformed JSON with 400', async () => {
		const { status } = await callPost('{not valid json');
		expect(status).toBe(400);
	});

	it('rejects a body with no message field', async () => {
		const { status, err } = await callPost(JSON.stringify({}));
		expect(status).toBe(400);
		expect(err?.body?.message ?? '').toMatch(/message/);
	});

	it('rejects a body where message is not a string', async () => {
		const { status } = await callPost(JSON.stringify({ message: 123 }));
		expect(status).toBe(400);
	});

	it('rejects messages longer than 4000 characters', async () => {
		const body = JSON.stringify({ message: 'x'.repeat(4001) });
		const { status, err } = await callPost(body);
		expect(status).toBe(400);
		expect(err?.body?.message ?? '').toMatch(/too long/i);
	});
});

describe('GET /api/chat — config probe', () => {
	it('returns the configured model when the SDK is available', async () => {
		const { GET } = await importHandler(true);
		const event = {
			request: new Request('http://localhost/api/chat'),
			locals: { safeGetSession: async () => ({ user: null, session: null }) }
		} as unknown as Parameters<RequestHandler>[0];
		const res = await GET(event);
		const body = (await res.json()) as { configured: boolean; model: string | null };
		expect(body.configured).toBe(true);
		expect(typeof body.model).toBe('string');
	});

	it('returns model=null when not configured', async () => {
		const { GET } = await importHandler(false);
		const event = {
			request: new Request('http://localhost/api/chat'),
			locals: { safeGetSession: async () => ({ user: null, session: null }) }
		} as unknown as Parameters<RequestHandler>[0];
		const res = await GET(event);
		const body = (await res.json()) as { configured: boolean; model: string | null };
		expect(body.configured).toBe(false);
		expect(body.model).toBeNull();
	});
});
