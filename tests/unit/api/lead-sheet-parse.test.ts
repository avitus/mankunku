/**
 * Guard-gate tests for /api/lead-sheet-parse. The validation gates are pure
 * logic tested exhaustively; the live-SDK document path is not unit-tested
 * (chat.test.ts precedent) beyond a mocked-create happy path.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { RequestHandler } from '@sveltejs/kit';

interface HttpErrorShape {
	status: number;
	body?: { message?: string };
}

function isHttpError(e: unknown): e is HttpErrorShape {
	return typeof e === 'object' && e !== null && 'status' in e;
}

const mockCreate = vi.fn();
let configured = true;

function makeEvent(body: unknown, headers: Record<string, string> = {}, userId: string | null = null) {
	const request = new Request('http://localhost/api/lead-sheet-parse', {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...headers },
		body: typeof body === 'string' ? body : JSON.stringify(body)
	});
	return {
		request,
		getClientAddress: () => '127.0.0.1',
		locals: {
			safeGetSession: async () => ({ user: userId ? { id: userId } : null, session: null })
		}
	} as unknown as Parameters<RequestHandler>[0];
}

async function loadRoute() {
	vi.resetModules();
	vi.doMock('$lib/server/anthropic', () => ({
		isAnthropicConfigured: () => configured,
		getAnthropicClient: () =>
			configured
				? {
						messages: {
							create: mockCreate,
							// The route streams (large max_tokens); the mock resolves the
							// same payload through finalMessage().
							stream: (req: unknown) => ({ finalMessage: () => mockCreate(req) })
						}
					}
				: null,
		ANTHROPIC_MODEL: 'claude-test-model',
		ANTHROPIC_LEAD_SHEET_MAX_TOKENS: 8192
	}));
	return await import('../../../src/routes/api/lead-sheet-parse/+server');
}

beforeEach(() => {
	configured = true;
	mockCreate.mockReset();
});

const TINY_PDF_B64 = Buffer.from('%PDF-1.4 tiny').toString('base64');

describe('POST /api/lead-sheet-parse — guards', () => {
	it('503s when Anthropic is not configured', async () => {
		configured = false;
		const { POST } = await loadRoute();
		try {
			await POST(makeEvent({ pdf: TINY_PDF_B64 }));
			expect.unreachable();
		} catch (e) {
			expect(isHttpError(e) && e.status).toBe(503);
		}
	});

	it('413s when the declared content-length exceeds the cap', async () => {
		const { POST } = await loadRoute();
		try {
			await POST(makeEvent({ pdf: TINY_PDF_B64 }, { 'content-length': '99999999' }));
			expect.unreachable();
		} catch (e) {
			expect(isHttpError(e) && e.status).toBe(413);
		}
	});

	it('400s on invalid JSON', async () => {
		const { POST } = await loadRoute();
		try {
			await POST(makeEvent('{nope'));
			expect.unreachable();
		} catch (e) {
			expect(isHttpError(e) && e.status).toBe(400);
		}
	});

	it('400s when pdf is missing or not base64', async () => {
		const { POST } = await loadRoute();
		for (const body of [{}, { pdf: 42 }, { pdf: 'not base64 at all!!!' }]) {
			try {
				await POST(makeEvent(body));
				expect.unreachable();
			} catch (e) {
				expect(isHttpError(e) && e.status).toBe(400);
			}
		}
	});

	it('429s past the rate limit', async () => {
		const { POST } = await loadRoute();
		mockCreate.mockResolvedValue({ content: [{ type: 'text', text: '{}' }] });
		let sawRateLimit = false;
		for (let i = 0; i < 10; i++) {
			try {
				await POST(makeEvent({ pdf: TINY_PDF_B64 }, {}, 'user-rate-limit-test'));
			} catch (e) {
				if (isHttpError(e) && e.status === 429) {
					sawRateLimit = true;
					break;
				}
				if (isHttpError(e) && e.status === 422) continue; // '{}' fails conversion — fine
				throw e;
			}
		}
		expect(sawRateLimit).toBe(true);
	});
});

describe('POST /api/lead-sheet-parse — extraction path', () => {
	it('returns the converted sheet with a generated id', async () => {
		const { POST } = await loadRoute();
		const doc = {
			title: 'Scanned',
			key: 'C',
			timeSignature: [4, 4],
			sections: [
				{ label: 'A', bars: 2, chords: [{ bar: 0, beat: 0, symbol: 'C6' }], melody: [] }
			]
		};
		mockCreate.mockResolvedValue({
			content: [{ type: 'text', text: '```json\n' + JSON.stringify(doc) + '\n```' }]
		});

		const res = await POST(makeEvent({ pdf: TINY_PDF_B64, filename: 'chart.pdf' }));
		expect(res.status).toBe(200);
		const payload = await res.json();
		expect(payload.sheet.title).toBe('Scanned');
		expect(payload.sheet.id).toMatch(/^sheet-\d+-[a-z0-9]{4}$/);
		expect(payload.sheet.source).toBe('imported-pdf');

		// The document block reached the SDK with the base64 payload.
		const call = mockCreate.mock.calls[0][0];
		expect(call.model).toBe('claude-test-model');
		const docBlock = call.messages[0].content.find(
			(b: { type: string }) => b.type === 'document'
		);
		expect(docBlock.source.data).toBe(TINY_PDF_B64);
	});

	it('422s when the model output fails strict validation', async () => {
		const { POST } = await loadRoute();
		mockCreate.mockResolvedValue({
			content: [{ type: 'text', text: JSON.stringify({ title: 'X' }) }]
		});
		try {
			await POST(makeEvent({ pdf: TINY_PDF_B64 }));
			expect.unreachable();
		} catch (e) {
			expect(isHttpError(e) && e.status).toBe(422);
		}
	});

	it('502s when the model returns non-JSON', async () => {
		const { POST } = await loadRoute();
		mockCreate.mockResolvedValue({ content: [{ type: 'text', text: 'sorry, no' }] });
		try {
			await POST(makeEvent({ pdf: TINY_PDF_B64 }));
			expect.unreachable();
		} catch (e) {
			expect(isHttpError(e) && e.status).toBe(502);
		}
	});
});

describe('GET /api/lead-sheet-parse', () => {
	it('reports configuration state', async () => {
		const { GET } = await loadRoute();
		const res = await GET({} as Parameters<RequestHandler>[0]);
		const payload = await res.json();
		expect(payload.configured).toBe(true);
		expect(payload.model).toBe('claude-test-model');
	});
});
