import { build } from 'vite';
import { resolve } from 'node:path';

/** Bundle production audio modules for an isolated native offline render. */
export async function audioReferenceBundle(): Promise<string> {
 const result = await build({ configFile: false, logLevel: 'silent',
  resolve: { alias: { $lib: resolve('src/lib') } },
  build: { write: false, minify: false, lib: { entry: resolve('tests/e2e/fixtures/audio-reference-entry.ts'), formats: ['es'] },
   rolldownOptions: { output: { codeSplitting: false } } }
 });
 const outputs = Array.isArray(result) ? result : [result];
 return outputs.flatMap(item => 'output' in item ? item.output : []).filter(item => item.type === 'chunk').map(item => item.code).join('\n');
}
