import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOpenaiSystemRecognizer, OPENAI_SYSTEM_MODEL } from '$lib/server/pdf-import/openai-system';
import type { SystemRecognitionInput } from '$lib/tunes/import/pdf-recognition';

vi.mock('$app/env/private', () => ({
	ANTHROPIC_API_KEY: '', OPENAI_API_KEY: 'test-only',
	PDF_IMPORT_SYSTEM_MODEL: 'gpt-6.2-astra'
}));

const input: SystemRecognitionInput = {
	image: 'data:image/png;base64,cG5n',
	barCount: 1,
	timeSignature: [4, 4],
	context: { clef: 'treble', fifths: 1, timeSignature: [4, 4] }
};

function recognize(extra: Partial<SystemRecognitionInput> = {}) {
	return createOpenaiSystemRecognizer().recognize({ ...input, ...extra }, new AbortController().signal);
}

function response(text: string) {
	return { status: 'completed', output: [
		{ type: 'reasoning' },
		{ type: 'message', content: [{ type: 'output_text', text }] }
	] };
}

afterEach(() => vi.unstubAllGlobals());

describe('OpenAI cropped-staff reader', () => {
	it('sends the selected crop and retains only the first header’s printed credit and marking', async () => {
		const heading = { title: 'Example', composer: '<script>', style: '  Swing  ♩=144 ' };
		const fetchMock = vi.fn(async (_url: string, _options: RequestInit) =>
			Response.json(response(JSON.stringify({ fifths: 1, clef: 'treble', heading }))));
		vi.stubGlobal('fetch', fetchMock);
		expect((await recognize({ contextOnly: true, first: true })).heading)
			.toEqual({ title: 'Example', style: 'Swing ♩=144' });
		const [url, options] = fetchMock.mock.calls[0];
		expect(url).toBe('https://api.openai.com/v1/responses');
		const body = JSON.parse(String(options.body));
		expect(body).toMatchObject({ model: OPENAI_SYSTEM_MODEL, store: false });
		expect(body.input[0].content[0].image_url).toBe(input.image);
		expect((await recognize({ contextOnly: true, first: false })).heading).toBeUndefined();
	});

	it('reports a treble staff-position disagreement even when the count and rhythm agree', async () => {
		const raw = { bars: [{ melody: [[0, 4, 'G4']], chords: [[0, 'G7']] }] };
		vi.stubGlobal('fetch', async () => Response.json(response(JSON.stringify(raw))));
		const barEvidence = [{ count: 1, letters: ['B4'] }];
		const result = await recognize({ barEvidence, readHarmony: true });
		expect(result.bars[0].melody).toEqual([[0, 4, 'G4']]);
		expect(result.harmony).toEqual([[[0, 'G7']]]);
		expect(result.warnings.join(' ')).toContain('B4');
		expect((await recognize({ barEvidence, context: { clef: 'bass', fifths: 1, timeSignature: [4, 4] } })).warnings).toEqual([]);
	});

	it.each([
		[{ status: 'incomplete' }, 502],
		[{ status: 'completed' }, 502],
		[{ status: 'completed', output: [{ content: [{ type: 'refusal' }] }] }, 502],
		[response('a broken response'), 422],
		[response('{"bars":[]}'), 422]
	])('surfaces unreadable provider output', async (raw, status) => {
		vi.stubGlobal('fetch', async () => Response.json(raw));
		await expect(recognize({ readHarmony: true })).rejects.toMatchObject({ status });
	});

	it('uses the selected OpenAI project for a whole PDF even with no Anthropic key', async () => {
		const document = { title: 'Recovered full score', keySignature: { fifths: 0 }, timeSignature: [4, 4],
			systems: [{ bars: [{ chords: [[0, 'C']], melody: [[0, 4, 'C4']] }] }] };
		const fetchMock = vi.fn(async (_url: string, _options: RequestInit) => Response.json(response(JSON.stringify(document))));
		vi.stubGlobal('fetch', fetchMock);
		const { POST, GET } = await import('../../../src/routes/api/tune-parse/+server');
		const event = {
			request: new Request('http://localhost/api/tune-parse', { method: 'POST', body: JSON.stringify({ pdf: 'cGRm' }) }),
			getClientAddress: () => '127.0.0.1', locals: { safeGetSession: async () => ({ user: null }) }
		} as unknown as Parameters<typeof POST>[0];
		expect(await (await GET(event)).json()).toMatchObject({ configured: true, wholePdf: true, model: OPENAI_SYSTEM_MODEL });
		expect((await (await POST(event)).json()).sheet.title).toBe(document.title);
		const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
		expect(body.input[0].content[0]).toMatchObject({ type: 'input_file', file_data: 'data:application/pdf;base64,cGRm' });
		expect(body.store).toBe(false);
	});

	it('returns a readable gateway error when the provider rejects the project key', async () => {
		vi.stubGlobal('fetch', async () => new Response(null, { status: 401 }));
		await expect(recognize()).rejects.toMatchObject({ status: 502, body: { message: expect.stringContaining('HTTP 401') } });
	});
});
