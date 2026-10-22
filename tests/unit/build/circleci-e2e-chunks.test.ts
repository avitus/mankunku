import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { appChunk, recordAppChunks } from '../../e2e/fixtures/app-chunks';

/** A stand-in for a Playwright BrowserContext: it only emits 'request'. */
class FakeContext extends EventEmitter {
	request(url: string): void {
		this.emit('request', { url: () => url });
	}
}

describe('appChunk', () => {
	it('names the /_app/ script a URL points at', () => {
		expect(appChunk('http://localhost:4173/_app/immutable/chunks/abc.js')).toBe('/_app/immutable/chunks/abc.js');
	});

	it('ignores everything that is not an app script', () => {
		expect(appChunk('http://localhost:4173/_app/immutable/assets/app.css')).toBeNull();
		expect(appChunk('http://localhost:4173/api/health')).toBeNull();
		expect(appChunk('https://cdn.example.com/lib.js')).toBeNull();
		expect(appChunk('not a url')).toBeNull();
	});
});

describe('recordAppChunks', () => {
	// 2026-10-21: the e2e-analysis job ran every spec under page.coverage,
	// which always starts V8's precise block coverage. It deoptimises the
	// page's JavaScript, the PDF-import tests ran 2–2.5× slower and timed
	// out on CI's 2-vCPU box, and every main workflow went red. The analysis
	// only needs which chunks LOADED, which the requests already say.
	it('records each app chunk the context requests, from every page, once', () => {
		const context = new FakeContext();
		const recorder = recordAppChunks(context);
		context.request('http://localhost:4173/_app/immutable/entry/app.js');
		context.request('http://localhost:4173/_app/immutable/chunks/pdf.js');
		context.request('http://localhost:4173/_app/immutable/chunks/pdf.js');
		context.request('http://localhost:4173/favicon.ico');
		expect(recorder.stop()).toEqual(['/_app/immutable/entry/app.js', '/_app/immutable/chunks/pdf.js']);
	});

	it('stops listening when stopped', () => {
		const context = new FakeContext();
		const recorder = recordAppChunks(context);
		recorder.stop();
		expect(context.listenerCount('request')).toBe(0);
	});
});
