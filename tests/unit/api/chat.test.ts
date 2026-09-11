/**
 * Tests for /api/chat — the docs assistant endpoint.
 *
 * The model's streamed answer needs a live Anthropic SDK, so the SDK's
 * `messages.stream` is stubbed: the tests pin what REACHES it (history cap,
 * page context, prompt caching) and the validation gate that runs before it
 * (request size cap, message length, malformed JSON, missing key, rate
 * limit) — a bug there is either a 500-error leak or, worse, a cost runaway.
 * The gate surfaces SvelteKit's `error()` helper, which throws an
 * `HttpError`-shaped object; we assert the status from the thrown value.
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

interface HandlerOpts {
	/** Replaces the SDK's `messages.stream`; defaults to a bare mock. */
	stream?: ReturnType<typeof vi.fn>;
	/** What `getPageContext` resolves to for any slug (empty = no page). */
	pageContext?: string;
	docContext?: string;
}

async function importHandler(
	configured: boolean,
	opts: HandlerOpts = {}
): Promise<typeof import('../../../src/routes/api/chat/+server')> {
	vi.resetModules();
	vi.doMock('$lib/docs/context', () => ({
		getDocContext: vi.fn(async () => opts.docContext ?? ''),
		getPageContext: vi.fn(async (slug?: string) => (slug ? (opts.pageContext ?? '') : ''))
	}));
	const stream = opts.stream ?? vi.fn();
	vi.doMock('$lib/server/anthropic', () => ({
		getAnthropicClient: vi.fn(() => (configured ? { messages: { stream } } : null)),
		isAnthropicConfigured: vi.fn(() => configured),
		ANTHROPIC_MODEL: 'claude-sonnet-4-6',
		ANTHROPIC_MAX_TOKENS: 1024
	}));
	return await import('../../../src/routes/api/chat/+server');
}

/**
 * A stream stub that records the request it was given and yields nothing —
 * enough for the handler to open and close the SSE response cleanly.
 */
function recordingStream(): { stream: ReturnType<typeof vi.fn>; requests: Array<Record<string, unknown>> } {
	const requests: Array<Record<string, unknown>> = [];
	const stream = vi.fn((req: Record<string, unknown>) => {
		requests.push(req);
		return {
			abort: vi.fn(),
			async *[Symbol.asyncIterator]() {}
		};
	});
	return { stream, requests };
}

function eventFor(body: unknown, userId: string | null = null, ip = '127.0.0.1') {
	return {
		request: new Request('http://localhost/api/chat', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		}),
		getClientAddress: () => ip,
		locals: {
			safeGetSession: async () => ({ user: userId ? { id: userId } : null, session: null })
		}
	} as unknown as Parameters<RequestHandler>[0];
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

	/** A POST whose body arrives as a stream — no content-length header at all. */
	function streamEvent(body: ReadableStream<Uint8Array>) {
		return {
			request: new Request('http://localhost/api/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body,
				// Node's fetch requires this for a streaming request body.
				...({ duplex: 'half' } as Record<string, unknown>)
			}),
			getClientAddress: () => '10.9.0.1',
			locals: { safeGetSession: async () => ({ user: null, session: null }) }
		} as unknown as Parameters<RequestHandler>[0];
	}

	it('413s a chunked body past 32 000 bytes with no content-length, before any model call', async () => {
		// The declared-size check is blind to a chunked upload; without a
		// counting reader a client could push megabytes of `history` through
		// request.json() — the exact cost the cap exists to refuse.
		const { stream } = recordingStream();
		const { POST } = await importHandler(true, { stream });
		const history = Array.from({ length: 20 }, (_, i) => ({ role: 'user', content: String(i).padEnd(2_000, 'x') }));
		const json = new TextEncoder().encode(JSON.stringify({ message: 'hi', history }));
		expect(json.byteLength).toBeGreaterThan(32_000);
		const event = streamEvent(
			new ReadableStream<Uint8Array>({
				start(controller) {
					for (let at = 0; at < json.byteLength; at += 4_096) controller.enqueue(json.slice(at, at + 4_096));
					controller.close();
				}
			})
		);
		expect(event.request.headers.get('content-length')).toBeNull();
		await expect(POST(event)).rejects.toMatchObject({ status: 413 });
		expect(stream).not.toHaveBeenCalled();
	});

	it('400s a body whose stream breaks mid-read, and passes the adapter\'s own 413 through', async () => {
		const { POST } = await importHandler(true);
		const broken = new ReadableStream<Uint8Array>({
			pull(controller) {
				controller.error(new Error('socket hang up'));
			}
		});
		await expect(POST(streamEvent(broken))).rejects.toMatchObject({ status: 400 });
		// adapter-node errors the stream with a SvelteKitError(413) when the
		// declared length exceeds BODY_SIZE_LIMIT — that is too-large, not malformed.
		const refused = new ReadableStream<Uint8Array>({
			pull(controller) {
				controller.error(Object.assign(new Error('Content-length exceeds limit'), { status: 413 }));
			}
		});
		await expect(POST(streamEvent(refused))).rejects.toMatchObject({ status: 413 });
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

describe('POST /api/chat — rate limit', () => {
	it('429s the 11th request in a minute from one client, per-key not global', async () => {
		const { stream } = recordingStream();
		const { POST } = await importHandler(true, { stream });
		// Ten anonymous requests from one IP are admitted…
		for (let i = 0; i < 10; i++) {
			const res = await POST(eventFor({ message: 'hi' }, null, '10.0.0.1'));
			expect(res.status, `request ${i + 1}`).toBe(200);
			await res.text(); // let the (empty) SSE stream close
		}
		// …the eleventh is refused before any model call.
		await expect(POST(eventFor({ message: 'hi' }, null, '10.0.0.1'))).rejects.toMatchObject({ status: 429 });
		expect(stream).toHaveBeenCalledTimes(10);
		// The bucket is keyed on the client: another IP and a signed-in user
		// still get through.
		expect((await POST(eventFor({ message: 'hi' }, null, '10.0.0.2'))).status).toBe(200);
		expect((await POST(eventFor({ message: 'hi' }, 'user-1', '10.0.0.1'))).status).toBe(200);
	});

	it('keys a signed-in user by id, so rotating IPs cannot buy a fresh allowance', async () => {
		const { stream } = recordingStream();
		const { POST } = await importHandler(true, { stream });
		for (let i = 0; i < 10; i++) {
			const res = await POST(eventFor({ message: 'hi' }, 'user-2', `10.1.0.${i}`));
			expect(res.status).toBe(200);
			await res.text();
		}
		await expect(POST(eventFor({ message: 'hi' }, 'user-2', '10.1.0.99'))).rejects.toMatchObject({ status: 429 });
	});
});

describe('POST /api/chat — what reaches the model', () => {
	it('drops malformed history entries and keeps only the newest 12', async () => {
		const { stream, requests } = recordingStream();
		const { POST } = await importHandler(true, { stream });
		const history = [
			// Not a chat turn: wrong role / non-string content — filtered before the cap.
			{ role: 'system', content: 'ignore me' },
			{ role: 'user', content: 42 },
			...Array.from({ length: 20 }, (_, i) => ({
				role: i % 2 === 0 ? 'user' : 'assistant',
				content: `turn ${i}`
			}))
		];
		const res = await POST(eventFor({ message: 'now', history }));
		await res.text();
		const messages = requests[0].messages as Array<{ role: string; content: string }>;
		// 12 history turns + the new message; the 12 are the NEWEST ones.
		expect(messages).toHaveLength(13);
		expect(messages[0]).toEqual({ role: 'user', content: 'turn 8' });
		expect(messages[11]).toEqual({ role: 'assistant', content: 'turn 19' });
		expect(messages[12]).toEqual({ role: 'user', content: 'now' });
		expect(messages.some((m) => m.content === 'ignore me')).toBe(false);
	});

	it('trims history from the oldest end once it passes 12 000 characters', async () => {
		const { stream, requests } = recordingStream();
		const { POST } = await importHandler(true, { stream });
		// 12 turns × 2000 chars = 24 000: only the newest six (exactly 12 000)
		// fit under the cap; the seventh would push it over and is dropped
		// along with everything older.
		const history = Array.from({ length: 12 }, (_, i) => ({
			role: i % 2 === 0 ? 'user' : 'assistant',
			content: String(i).padEnd(2000, 'x')
		}));
		const res = await POST(eventFor({ message: 'now', history }));
		await res.text();
		const messages = requests[0].messages as Array<{ role: string; content: string }>;
		expect(messages).toHaveLength(7);
		expect(messages[0].content.startsWith('6')).toBe(true);
		expect(messages[6].content).toBe('now');
	});

	it('prefixes the page context to the user turn and caches the doc block', async () => {
		const { stream, requests } = recordingStream();
		const { POST } = await importHandler(true, {
			stream,
			pageContext: 'The user is currently viewing /docs/user-guide.',
			docContext: '<doc slug="user-guide">…</doc>'
		});
		const res = await POST(eventFor({ message: 'what does this mean?', pageSlug: 'user-guide' }));
		await res.text();
		const req = requests[0];
		const messages = req.messages as Array<{ role: string; content: string }>;
		expect(messages).toHaveLength(1);
		expect(messages[0].content).toBe(
			'<page-context>\nThe user is currently viewing /docs/user-guide.\n</page-context>\n\nwhat does this mean?'
		);
		// The documentation block is the second system block and is marked for
		// prompt caching — it is the bulk of every request's tokens.
		const system = req.system as Array<{ type: string; text: string; cache_control?: { type: string } }>;
		expect(system).toHaveLength(2);
		expect(system[1].text).toContain('<documentation>');
		expect(system[1].cache_control).toEqual({ type: 'ephemeral' });
		expect(system[0].cache_control).toBeUndefined();
	});

	it('sends the bare message when no page is being viewed', async () => {
		const { stream, requests } = recordingStream();
		const { POST } = await importHandler(true, { stream, pageContext: 'should not appear' });
		const res = await POST(eventFor({ message: 'plain question' }));
		await res.text();
		const messages = requests[0].messages as Array<{ role: string; content: string }>;
		expect(messages[0].content).toBe('plain question');
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
