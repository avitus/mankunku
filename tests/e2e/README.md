# E2E tests (Playwright)

End-to-end tests for Mankunku, covering what Vitest can't reach: a real browser, real DOM, real navigation and hydration, and persistence round-trips through real storage.

## Running

```sh
# All three engines, all specs (the first run builds the production bundle)
npx playwright test

# One engine, one spec
npx playwright test tests/e2e/smoke.spec.ts --project=chromium

# Headed, with the inspector
npx playwright test --project=firefox --headed --debug

# Interactive UI mode, and the HTML report after a run
npx playwright test --ui
npx playwright show-report
```

The `webServer` block in `playwright.config.ts` runs `npm run build && npm run preview` with `PLAYWRIGHT=1` in its environment, which activates the `e2e-test-user` cookie branch in `src/hooks.server.ts`.

**Port and parallel checkouts.** The port defaults to 4173 and sets both the server and `baseURL`. Locally Playwright *reuses* whatever server already holds that port, so a run from one worktree can silently test another checkout's build. Beside another session, pick your own port and check it is free first:

```sh
lsof -nP -iTCP:4273 -sTCP:LISTEN
PLAYWRIGHT_PORT=4273 npx playwright test --project=chromium
```

CI always starts a fresh server and runs all three engines, sharded.

## What's covered, what's not

Every page route is visited by at least one spec — the two unlinked design previews (`/lick-practice/cue-preview`, `/tunes/playhead-preview`) only by smoke's load check — and the server-only routes (the auth callback and logout, the sitemap) are covered in Vitest. Beyond page loads, the suite pins user-visible outcomes: written-pitch labels following the instrument setting, the tricks mastery ladder, lick-practice sessions (stack, lead-sheet row, reading pause, focus ramp, microphone refusal), the tune editor and chart entry, all five tune importers, tune practice, per-user storage isolation, the stub-cloud convergence between devices, the docs tree, the 404 page, and `/api/health`.

E2E tests do **not** cover:

- Audio algorithm correctness (pitch detection, segmentation, scoring). Vitest owns this — `tests/unit/audio/`, `tests/unit/scoring/`, and the recorded-take corpus in `tests/integration/pitch-replay.test.ts`.
- Tone.js scheduling precision.
- Live microphone input. `getUserMedia` and `MediaRecorder` are mocked on every engine (see Fixtures).
- Real Supabase. Signed-in state comes from the `e2e-test-user` cookie; cloud rows come from per-spec route stubs or the in-memory stub cloud.

## Fixtures

```text
tests/e2e/
├── README.md
├── fixtures/
│   ├── test.ts            ← canonical { test, expect } export (anonymous specs)
│   ├── console-errors.ts  ← the automatic console guard + allowDocument404 option
│   ├── auth.ts            ← signedInPage / testUser via the e2e-test-user cookie
│   ├── storage.ts         ← seed localStorage before load; pre-stamps the namespace pointer
│   ├── audio.ts           ← getUserMedia + MediaRecorder mocks, stubCdnInstrumentSamples
│   └── stub-cloud.ts      ← shared in-memory Supabase, bridged by route interception
└── *.spec.ts              ← per-feature flows
```

- **`auth.ts`** provides `signedInPage` and `testUser`. It sets the cookie only; it registers no Supabase mocks, so a signed-in spec stubs its own `**/rest/v1/**` routes (or uses `stub-cloud.ts`).
- **`storage.ts`** seeds keys before the first script runs and pre-stamps the per-user namespace pointer. A signed-in spec must seed **after** the cookie is set, or the root layout re-homes the page with a reload — unless that reload is what the spec tests.
- **`audio.ts`** patches `MediaDevices.prototype.getUserMedia` (WebKit re-creates the `navigator.mediaDevices` wrapper, so an instance patch gets lost — `audio-mock.spec.ts` pins this) and hands back a synthetic oscillator stream. It never calls the real `getUserMedia`, so the suite never waits on an OS microphone prompt. `stubCdnInstrumentSamples` serves instrument samples locally.
- **`stub-cloud.ts`** runs one in-memory Supabase in the Node process and bridges every context to it, so two "devices" can converge (`cloud-convergence`, `stub-cloud-smoke`, `anon-lick-absorption`).

**Import rule:** anonymous specs import from `./fixtures/test`; signed-in specs import from `./fixtures/auth`, which extends the same guarded `test`. Never import `test` from `@playwright/test` (type-only imports are fine). The one exception is `record-omr-fixtures.spec.ts`, a local producer.

## The console guard

The guard is automatic: every test that uses the fixture `test` fails on any unexpected `console.error` or `pageerror`. Warnings are attached to the report but don't fail. Name `consoleCollector` only when a test needs to read the collected output mid-test.

- **Expected 404 pages.** A spec whose subject is a 404 page (the error page, admin's stealth 404s) opts in with `test.use({ allowDocument404: true })`. That admits only the navigated document's own "Failed to load resource … 404" line — never a fetch, asset or API 404, and never a pageerror. A test that only checks a status code should use `page.request.get` instead of navigating.
- **WebKit pageerrors.** Playwright reports every WebKit console message with level `error` and source `javascript` as a pageerror, so a WebKit "pageerror" is not always an uncaught exception.
- **Scope.** The guard listens to the test's own `page`. Extra tabs and contexts a spec opens itself (`cross-tab-switch`, `cloud-convergence`) are not guarded.

**Adding an allowlist entry.** If a real, unavoidable and benign message pollutes tests, add the narrowest possible entry to `IGNORED_PATTERNS` in `fixtures/console-errors.ts`, with a comment naming the spec and engine that need it. Don't suppress real errors: a test that surfaces a console error almost always means the app needs fixing.

## Skips and local-only specs

- Transport-driven specs (ear training, lick practice, tune practice, record-a-lick) skip on headless Linux Firefox in CI, where `Tone.start()` hangs without an audio device. They run on all three engines locally.
- Four specs are local producers or diagnostics, not suite members: `backing-calibration`, `backing-milestone-render` (the WAV producer for the backing listening protocol), `record-omr-fixtures` (re-records OMR fixtures; gated by `RECORD_OMR_FIXTURES=1`) and `backing-render-audio` (needs real CDN samples). Each self-skips unless its environment is set.

## Debugging tips

- `npx playwright show-report` after a failure — traces, screenshots, video, and the captured console output as a JSON attachment.
- `--headed --debug` opens a real browser with the inspector attached; `await page.pause()` stops a spec at that line.
- `DEBUG=pw:api` for verbose Playwright-side logs.
- A hang at a count-in on macOS usually means the host process is waiting on an OS permission dialog; Chromium runs with `--disable-audio-output` so output devices are irrelevant.
- CI's WebKit flakes reproduce under a one-core throttle: `docker run --cpus=1` on the Playwright image.
