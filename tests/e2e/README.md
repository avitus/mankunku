# E2E tests (Playwright)

End-to-end tests for Mankunku, covering UI flows that Vitest can't reach (real browser, real DOM, real navigation).

## Running

```sh
# All browsers, all specs (slow on first run — builds the production bundle)
npx playwright test

# Single browser, headed, debugger
npx playwright test --project=firefox --headed --debug

# A specific spec
npx playwright test tests/e2e/smoke.spec.ts

# Interactive UI mode
npx playwright test --ui

# Open the HTML report after a run
npx playwright show-report
```

The webServer config builds the app and runs `vite preview` on port 4173 the first time. Subsequent runs reuse the build cache. If you already have a preview server running on 4173, Playwright reuses it (locally only — CI always starts fresh).

## What's covered, what's not

E2E tests cover **user flows in a real browser** — navigation, console error catching, form submissions, persistence round-trips. Three browsers (Chromium, Firefox, WebKit) run in CI on every PR.

E2E tests do **not** cover:

- Audio algorithm correctness (pitch detection, scoring, onset detection). Vitest unit/integration tests own this — see `tests/unit/audio/` and `tests/integration/`.
- Tone.js scheduling precision.
- Live microphone input. The `MediaRecorder` is mocked in audio specs (see `fixtures/audio.ts`) so the same fixture WAV produces the same readings every time.
- Real Supabase auth or backend. Authenticated states are simulated via an env-gated branch in `src/hooks.server.ts` keyed off the `e2e-test-user` cookie. See `fixtures/auth.ts`.

## Architecture

```text
tests/e2e/
├── README.md                  ← you are here
├── fixtures/
│   ├── test.ts                ← canonical { test, expect } export
│   ├── console-errors.ts      ← console + pageerror capture, fails on uncaught
│   ├── storage.ts             ← seed localStorage before page load
│   ├── auth.ts                ← signedInPage fixture, Supabase route mocks
│   └── audio.ts               ← MediaRecorder + getUserMedia mocks (synthetic mic stream only — the real API is never called)
└── *.spec.ts                  ← per-feature flows
```

Always import from `fixtures/test.ts`, never from `@playwright/test` directly:

```ts
import { test, expect } from './fixtures/test';
```

## Adding a console-error allowlist entry

The console-error fixture fails any test that emits an uncaught error or `pageerror`. If you find a real, unavoidable, benign log that's polluting tests, add an entry to `IGNORED_PATTERNS` in `fixtures/console-errors.ts` with a comment explaining why.

Don't suppress real errors. If a test surfaces a console error, the right fix is almost always to fix the underlying code.

## Debugging tips

- `npx playwright show-report` after a failure — the HTML report has traces, screenshots, video, and the captured console output as a JSON attachment.
- `--headed --debug` opens a real browser with the Playwright Inspector attached.
- `await page.pause()` inside a spec drops you into the Inspector at that point.
- Set `DEBUG=pw:api` for verbose Playwright-side logs.
