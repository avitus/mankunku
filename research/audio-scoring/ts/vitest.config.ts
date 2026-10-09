// Research-only vitest config: runs the scorer variants over every saved take.
//   npx vitest run -c research/audio-scoring/ts/vitest.config.ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
export default defineConfig({
	root,
	resolve: { alias: { $lib: fileURLToPath(new URL('../../../src/lib', import.meta.url)) } },
	test: { include: ['research/audio-scoring/ts/**/*.test.ts'], environment: 'node', testTimeout: 600_000 }
});
