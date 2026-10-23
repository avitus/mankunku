import { defineConfig, devices, type ReporterDescription } from '@playwright/test';
import { assertBrowserTestIsolation } from './scripts/browser-test-boundary.js';

assertBrowserTestIsolation();

// Local sandboxes each own their network and server. Custom isolated executors
// can override the port; CI's shared build/serve step uses 4173.
const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 4173);
const BASE_URL = `http://localhost:${PORT}`;

const isCI = !!process.env.CI;

// `circleci testsuite run "e2e tests"` (.circleci/test-suites.yml) sets the
// JUnit path it reads results from; the junit reporter picks the file up from
// this same variable. Unset, nothing changes.
const junit: ReporterDescription[] = process.env.PLAYWRIGHT_JUNIT_OUTPUT_FILE ? [['junit']] : [];
// Its impact analysis sets CIRCLECI_COVERAGE (tests/e2e/fixtures/circleci-coverage.ts).
const coverage: ReporterDescription[] = process.env.CIRCLECI_COVERAGE
	? [['./tests/e2e/reporters/circleci-coverage.ts']]
	: [];
// Dynamic test splitting runs the suite once per batch of spec files. Each
// batch keeps its own HTML report and traces; sharing the defaults, every
// batch would wipe the traces of the failures before it.
const batch = process.env.PLAYWRIGHT_BATCH;

export default defineConfig({
	testDir: 'tests/e2e',
	outputDir: batch ? `test-results/${batch}` : 'test-results',
	fullyParallel: true,
	forbidOnly: isCI,
	retries: isCI ? 2 : 0,
	workers: isCI ? 2 : undefined,
	reporter: isCI
		? [
				['html', { open: 'never', outputFolder: batch ? `playwright-report/${batch}` : 'playwright-report' }],
				['github'],
				...junit,
				...coverage
			]
		: [['list'], ...junit, ...coverage],
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
						'--autoplay-policy=no-user-gesture-required',
						// Render WebAudio into Chromium's fake output sink instead of the
						// machine's default output device. The AudioContext clock — and so
						// Tone's transport, every count-in and every recording window —
						// still advances in real time, but nothing depends on the hardware
						// and the suite is silent instead of audible. Added 2026-09-03, an
						// evening when every transport-driven spec froze at the count-in
						// with "The AudioContext encountered an error from the audio device
						// or the WebAudio renderer". The cause turned out to be a pending
						// macOS microphone-permission prompt for the process hosting
						// Chromium (see fixtures/audio.ts), not the output device — but a
						// standalone probe showed the fake sink rendering through it
						// regardless, and CI's device-less boxes already got this fallback
						// implicitly.
						'--disable-audio-output'
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
			// One WebKit at a time. On the 2-CPU boxes (CI, the sandbox) WebKit
			// stops delivering requestAnimationFrame for seconds when a second
			// WebKit shares the CPUs, and every click waits two frames for
			// "stable": tricks.spec.ts timed out on every attempt at two WebKit
			// workers and never at one (2026-10-22). The other worker keeps
			// running Chromium and Firefox beside it.
			workers: 1,
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
		// The CI e2e job builds once and serves the app before the suite starts,
		// because dynamic test splitting runs Playwright once per batch and a
		// build per batch would cost ~90s each (PLAYWRIGHT_REUSE_SERVER=1).
		reuseExistingServer: !isCI || process.env.PLAYWRIGHT_REUSE_SERVER === '1',
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
