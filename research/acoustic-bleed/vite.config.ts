import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
export default defineConfig({
  root,
  publicDir: 'static',
  resolve: { alias: { $lib: `${root}src/lib` } },
  optimizeDeps: { include: ['tone', 'smplr', 'pitchy'] },
  server: { host: '0.0.0.0', port: 5188, strictPort: true, hmr: false, allowedHosts: ['localhost', 'host.docker.internal'],
    proxy: { '/api/clean': 'http://127.0.0.1:8766' } },
  worker: { format: 'es' },
});
