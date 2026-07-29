import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const BASE_URL = `http://localhost:${PORT}`;

const isCI = !!process.env.CI;

export default defineConfig({
	testDir: 'tests/e2e',
	fullyParallel: true,
	forbidOnly: isCI,
	retries: isCI ? 2 : 0,
	workers: isCI ? 2 : undefined,
	reporter: isCI ? [['html', { open: 'never' }], ['github']] : 'list',
	timeout: 30_000,
	// 10s, up from the 5s Playwright default: with ~75 specs × 3 engines fully
	// parallel on one machine (plus abcjs SVG re-renders on every lead-sheet
	// state change), individually-instant assertions intermittently exceed 5s
	// under full-suite CPU contention. Local retries are 0, so a single slow
	// poll fails the run — the CI boxes run 2 workers and never hit this.
	expect: { timeout: 10_000 },

	use: {
		baseURL: BASE_URL,
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
		video: 'retain-on-failure',
		// `permissions: ['microphone']` is set per-project below — Firefox and
		// WebKit reject the 'microphone' permission name at the Playwright API
		// level, so only Chromium opts in. Firefox uses the
		// media.navigator.permission.disabled pref instead; WebKit relies on
		// the in-page MediaRecorder/getUserMedia mock from fixtures/audio.ts.
		actionTimeout: 10_000,
		navigationTimeout: 15_000
	},

	projects: [
		{
			name: 'chromium',
			use: {
				...devices['Desktop Chrome'],
				permissions: ['microphone'],
				launchOptions: {
					args: [
						'--use-fake-ui-for-media-stream',
						'--use-fake-device-for-media-stream',
						'--autoplay-policy=no-user-gesture-required'
					]
				}
			}
		},
		{
			name: 'firefox',
			use: {
				...devices['Desktop Firefox'],
				launchOptions: {
					firefoxUserPrefs: {
						'media.navigator.permission.disabled': true,
						'media.navigator.streams.fake': true,
						'media.autoplay.default': 0,
						'media.autoplay.blocking_policy': 0
					}
				}
			}
		},
		{
			name: 'webkit',
			use: {
				...devices['Desktop Safari']
				// WebKit ignores fake-media browser flags. Audio-dependent specs
				// rely on the in-page MediaRecorder/getUserMedia mock from
				// tests/e2e/fixtures/audio.ts, which works across all engines.
			}
		}
	],

	webServer: {
		// Test the production bundle — matches what CI builds and what users
		// run in the deployed app. Slow on first invocation; subsequent runs
		// reuse Vite's build cache.
		command: 'npm run build && npm run preview -- --port ' + PORT,
		url: BASE_URL,
		reuseExistingServer: !isCI,
		timeout: 180_000,
		stdout: 'ignore',
		stderr: 'pipe',
		env: {
			// Activates the env-gated test branch in src/hooks.server.ts that
			// honors the e2e-test-user cookie. Without this, all auth flows
			// would require a live Supabase backend.
			PLAYWRIGHT: '1'
		}
	}
});
