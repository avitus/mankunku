# Automated testing

- Run browser tests with `npm run test:e2e -- <Playwright arguments>` or through
  the `e2e tests` CircleCI Smarter Testing suite. Both route local runs into a
  disposable Linux Docker sandbox, backed by a headless VM on macOS.
- Never run automated browsers, desktop input, microphone prompts, or audible
  test playback on the user's desktop. This includes ad-hoc browser scripts
  and UI verification. Do not bypass `assertBrowserTestIsolation`, set fake CI
  flags to evade it, or fall back to host browsers if Docker is unavailable.
- Use `npm run test:e2e:ui` for interactive debugging. It prints a localhost
  address for the user to open manually; it does not launch a browser.
- Keep each run's checkout, server and artifacts separate. The runner already
  does this, limits CPU/memory, excludes local secrets, and saves results under
  `test-results/sandbox/<run-id>/`. Do not mount host devices or display sockets.
- Node-only tests can run locally through `circleci testsuite run "unit tests"`.
  Optional container commands are `npm run test:sandbox -- unit`, `-- check`,
  and `-- deploy`. CI already runs inside isolated Linux executors.
- Setup, troubleshooting and coverage limits are in `tests/e2e/README.md`.
  Native Safari and real microphone/device checks require an explicitly
  arranged manual session; Linux WebKit does not establish native Safari parity.
