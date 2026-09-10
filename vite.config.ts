import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sentrySvelteKit } from "@sentry/sveltekit";
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

// Release creation + source-map upload need a Sentry auth token (SENTRY_AUTH_TOKEN
// env var or the local .env.sentry-build-plugin file). Skip the upload step for
// throwaway e2e builds (PLAYWRIGHT=1, set by playwright.config.ts webServer) and
// for token-less environments (e.g. CI e2e), where sentry-vite-plugin would only
// emit "No auth token" warnings on every build. autoInstrument is unaffected, so
// the built app matches production either way.
const uploadSourceMaps =
    process.env.PLAYWRIGHT !== '1' &&
    (Boolean(process.env.SENTRY_AUTH_TOKEN) || existsSync('.env.sentry-build-plugin'));

// Claude Code worktrees are full checkouts nested at .claude/worktrees/<name>/,
// and Vite watches the whole root (ignoring only .git, node_modules and
// SvelteKit's outDir), so a tsconfig.json created, removed or checked out in
// any of them fired reloadOnTsconfigChange in THIS server — module graph
// invalidated, browser tab force-reloaded (measured 2026-09-10). Anchored to
// this file rather than `**/.claude/worktrees/**`: chokidar matches ignore
// globs against absolute paths, so the unanchored form would also blank the
// watcher of a dev server started inside a worktree. Vite concatenates this
// with SvelteKit's own `<outDir>/!(generated)` entry rather than replacing it.
const claudeWorktrees = fileURLToPath(new URL('.claude/worktrees/**', import.meta.url));

export default defineConfig({
	// No PWA/service-worker plugin — removed 2026-07-25. The generated worker
	// was never registered by SSR pages (the registerSW <script> injection
	// only applies to prerendered HTML, and this app SSRs everything), and the
	// sw.js it produced threw mid-evaluation (createHandlerBoundToURL('/')
	// with '/' never precached), silently disabling its own runtime caching.
	// Devices that registered a worker under older builds are cleaned up by
	// the kill-switch worker at static/sw.js. Installability is preserved via
	// static/manifest.webmanifest. If offline support is ever a real goal, it
	// needs a prerendered shell + injectManifest SW, registered explicitly —
	// not a resurrected copy of this config.
	plugins: [sentrySvelteKit({
        org: "veetle",
        project: "mankunku",
        autoUploadSourceMaps: uploadSourceMaps
    }), tailwindcss(), sveltekit()],
	server: { watch: { ignored: [claudeWorktrees] } },
	test: {
		include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
		environment: 'node',
		setupFiles: ['./vitest.setup.ts']
	}
});
