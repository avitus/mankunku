# E2E tests (Playwright)

End-to-end tests for Mankunku, covering what Vitest can't reach: a real browser, real DOM, real navigation and hydration, and persistence round-trips through real storage.

## Running safely

Browser tests run in disposable Linux containers. On macOS the container engine
runs in a headless VM: tests cannot open desktop windows, steal focus, request
macOS microphone access, or play through the host's audio devices. This follows
Veetbot's VM-first automation policy, using the same Linux browser image as
Mankunku's CI instead of a macOS/Xcode VM.

Install Docker Desktop, OrbStack, or Docker Engine, or use this dedicated Colima
VM on macOS (Homebrew required):

```sh
brew install colima docker
colima start --profile mankunku-tests --cpu 2 --memory 6 --disk 40 --vm-type vz --activate=false
```

The runner automatically uses `colima-mankunku-tests` when that context exists;
otherwise it uses your Docker context. `MANKUNKU_DOCKER_CONTEXT` selects an
explicit context. Standard `DOCKER_CONTEXT` and `DOCKER_HOST` settings take
precedence over automatic Colima selection. Start the VM again with the same
command after a reboot; stop it with `colima stop --profile mankunku-tests`.
No login service or automatic VM startup is installed.

```sh
# All three engines; first run downloads the image and installs dependencies.
npm run test:e2e

# One spec or engine; arguments are forwarded literally.
npm run test:e2e -- tests/e2e/smoke.spec.ts --project=chromium

# Headed browsers remain on the container's virtual display.
npm run test:e2e -- tests/e2e/smoke.spec.ts --headed

# Interactive UI: manually open the localhost address printed by the runner.
npm run test:e2e:ui -- tests/e2e/smoke.spec.ts

# Optional isolation for Node tests, type checks, and deploy-script tests.
npm run test:sandbox -- unit tests/unit/build/browser-test-sandbox.test.ts
npm run test:sandbox -- check
npm run test:sandbox -- deploy
```

`test:e2e:debug` is an alias for the sandbox UI. `--debug` is refused because the
native inspector would be invisible in the VM; use the web UI's trace/source
views instead. Ctrl-C stops the container and saves diagnostics. UI mode copies
the checkout once, so restart it after local edits.

Each run snapshots tracked and non-ignored untracked files, including local
edits and deletions. Host dependencies, `.env*` secrets (except `.env.example`),
registry credentials, Git metadata and nested agent worktrees are excluded.
Symlinks are refused. No host directories, Docker socket, audio devices or
display sockets are mounted into tests. This is desktop isolation for trusted
repository tests, not a security boundary for hostile code: containers retain
network access, and intentionally committed source/fixtures are included.

The Playwright image version comes from `package-lock.json`; dependencies are
cached in image layers. Each run has a separate container filesystem and network,
a two-CPU/four-GiB limit, two workers by default, and its own production server on
internal port 4173. Normal runs expose no ports. UI mode exposes only an ephemeral
localhost port. Parallel worktrees cannot reuse each other's preview servers or
overwrite each other's reports. Image builds share the VM's resource ceiling.

Reports, traces, screenshots and videos are copied to the printed
`test-results/sandbox/<run-id>/` directory on success, failure and interruption.
Open a saved report explicitly with:

```sh
npm run test:e2e:report -- test-results/sandbox/<run-id>/playwright-report
```

Containers are removed after artifact recovery. If copying fails, the stopped
container is retained and its name is printed for `docker cp` recovery and
`docker rm` cleanup. Docker image caches persist; periodically use your engine's
normal cache management. Do not prune containers belonging to another session.

Direct host `npx playwright test` is blocked in `playwright.config.ts`, including
headless runs and `CI=1`. A missing Docker engine fails with setup guidance and
never falls back to the host. Browser tests are admitted inside Linux Docker
containers or CircleCI Linux executors. Node-only Vitest and Python tests can
still run locally. For ad-hoc browser scripts and agent-driven UI verification,
use the sandbox too; do not bypass the guard or launch host browsers.

The `webServer` block builds and serves with `PLAYWRIGHT=1`, activating the
test-user cookie branch in `src/hooks.server.ts`. The sandbox uses `CI=1`, so the
existing Linux Firefox transport/audio skips and local-producer skips still
apply. Linux WebKit is useful coverage, but does not claim native Safari parity.
Real microphone/device checks require a separately arranged manual session.

Smarter Testing also routes local browser batches through this sandbox:

```sh
circleci testsuite run "e2e tests" --local --run-tests=all --analyze-tests=none -t '^smoke\.spec\.ts$'
```

The runner forwards only the requested JUnit/coverage output paths (mapped into
private container paths) and the sourcemap flag, then copies the result files
back for the CLI. Inside CircleCI or an existing Mankunku sandbox it invokes
Playwright directly, so CI needs no nested Docker daemon.

CI runs all three engines through CircleCI Smarter Testing (`.circleci/test-suites.yml`, suite `e2e tests`). Each node builds and serves the app once, then Playwright runs once per batch of spec files handed out by dynamic test splitting, against that server (`PLAYWRIGHT_REUSE_SERVER=1`). Each batch writes its own `playwright-report/<batch>/` and `test-results/<batch>/` (`PLAYWRIGHT_BATCH`), so a later batch can't wipe an earlier failure's traces. On branches only the spec files a change reaches run (test impact analysis).

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
│   ├── stub-cloud.ts      ← shared in-memory Supabase, bridged by route interception
│   ├── date.ts            ← freezeDate: a fixed "today" with native timers
│   ├── lick-practice-seeds.ts ← progress seeds shared by the lick-practice session specs
│   ├── circleci-coverage.ts ← per-test impact data for CircleCI's analysis (inert by default)
│   └── app-chunks.ts      ← maps the app chunks a page requested to their source files
├── reporters/
│   └── circleci-coverage.ts ← writes that coverage as CircleCI's coverage JSON
└── *.spec.ts              ← per-feature flows
```

- **`date.ts`** pins "now" for a spec that needs a fixed calendar. Use it instead of `page.clock.setFixedTime`, which fakes every timer as well: Sentry then takes `setTimeout` from a sandbox iframe with its own fake clock, Replay's debounce clears that timer through the page's clock, and the colliding ids made progress-trend-chart throw 1 run in 10.
- **`circleci-coverage.ts`** is the base of the console guard's `test`, so it reaches every spec, and it does nothing unless `CIRCLECI_COVERAGE` is set. That happens only in the `e2e tests` suite's `analysis` command (the CI `e2e-analysis` job on main, or a local `circleci testsuite run "e2e tests" --analyze-tests=…`). Coverage is by chunk: a test covers every source file in the sourcemap of every app script its page loaded, so the build needs `E2E_SOURCEMAPS=1` (hidden maps). Server-only code never reaches the browser, so the suite lists those paths under `full-test-run-paths` instead.

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

- Transport-driven specs (ear training, lick practice, tune practice, record-a-lick) skip on headless Linux Firefox in CI, where `Tone.start()` hangs without an audio device. The sandbox uses the same skips; Chromium and WebKit still exercise those flows.
- Four specs are local producers or diagnostics, not suite members: `backing-calibration`, `backing-milestone-render` (the WAV producer for the backing listening protocol), `record-omr-fixtures` (re-records OMR fixtures; gated by `RECORD_OMR_FIXTURES=1`) and `backing-render-audio` (needs real CDN samples). Each self-skips unless its environment is set.

## Debugging tips

- Open the run-specific saved HTML report after a failure — traces, screenshots, video, and the captured console output as a JSON attachment.
- `npm run test:e2e:ui` serves the inspector UI from the sandbox; open its printed localhost URL manually.
- Host secrets and arbitrary environment variables are not forwarded to tests; add diagnostic settings explicitly inside the sandbox when needed.
- A hang at a count-in on macOS usually means the host process is waiting on an OS permission dialog; Chromium runs with `--disable-audio-output` so output devices are irrelevant.
- CI's WebKit flakes reproduce under a one-core throttle: `docker run --cpus=1` on the Playwright image.
- WebKit runs one worker at a time (`workers: 1` on the `webkit` project). Two WebKits on two CPUs stop delivering `requestAnimationFrame` for seconds, and every click waits two frames for "stable": `tricks.spec.ts` timed out on every attempt at two WebKit workers, on `/docs` as much as the enclosure canvas. A click stuck at "waiting for element to be visible, enabled and stable" on WebKit is CPU starvation before it is the component.
